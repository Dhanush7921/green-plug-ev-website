// Driver extras: vehicle catalogue and garage, saved stations, trip planning, place search and support.
import { sql } from '../db';
import { geocode, route } from '../adapters/maps';
import { CONNECTORS } from '../lib/compat';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { distanceToSegmentKm, haversineKm } from '../lib/geo';
import type { Router } from '../lib/http';
import { confidence, exposure, STATION_COLS, type StationRow } from '../lib/stationData';
import { arr, bool, num, obj, oneOf, str, uuid } from '../lib/validate';

export function driverRoutes(r: Router) {
  // ---- vehicle catalogue (public)
  r.get('/api/catalog/vehicles', async () => {
    const rows = await sql`
      SELECT b.id AS brand_id, b.name AS brand, b.segment, m.id AS model_id, m.name AS model, v.id AS variant_id, v.label AS variant,
             v.battery_kwh::float8 AS battery_kwh, v.max_ac_kw::float8 AS max_ac_kw, v.max_dc_kw::float8 AS max_dc_kw, v.connectors, v.evidence_state, v.source_note
      FROM ev_brands b JOIN ev_models m ON m.brand_id = b.id JOIN ev_variants v ON v.model_id = m.id
      ORDER BY b.segment, b.name, m.name, v.label`;
    return { variants: rows, note: 'Catalogue specifications marked unverified must be confirmed against the manufacturer’s documentation.' };
  }, { auth: 'public' });

  // ---- garage
  r.get('/api/me/vehicles', async (ctx) => {
    const rows = await sql`
      SELECT uv.id, uv.nickname, uv.is_default, uv.variant_id, coalesce(v.connectors, uv.connectors) AS connectors,
             b.name AS brand, m.name AS model, v.label AS variant, v.max_ac_kw::float8 AS max_ac_kw, v.max_dc_kw::float8 AS max_dc_kw,
             v.battery_kwh::float8 AS battery_kwh, coalesce(v.evidence_state, 'unverified') AS evidence_state
      FROM user_vehicles uv LEFT JOIN ev_variants v ON v.id = uv.variant_id LEFT JOIN ev_models m ON m.id = v.model_id LEFT JOIN ev_brands b ON b.id = m.brand_id
      WHERE uv.user_id = ${ctx.user!.id} ORDER BY uv.is_default DESC, uv.created_at`;
    return { vehicles: rows };
  });

  r.post('/api/me/vehicles', async (ctx) => {
    const b = obj(ctx.body);
    const nickname = str(b, 'nickname', { max: 60, label: 'Nickname' });
    const variantId = b.variantId ? uuid(b.variantId, 'variantId') : null;
    const connectors = variantId ? [] : arr(b, 'connectors', CONNECTORS as readonly string[], { min: 1, max: 4 });
    const makeDefault = bool(b, 'isDefault', false);
    if (variantId) {
      const [v] = await sql`SELECT id FROM ev_variants WHERE id = ${variantId}`;
      if (!v) throw notFound('Vehicle variant');
    }
    const id = await sql.begin(async (tx) => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM user_vehicles WHERE user_id = ${ctx.user!.id}`;
      if ((n as number) >= 10) throw badRequest('You can save up to 10 vehicles.');
      const isDefault = makeDefault || n === 0;
      if (isDefault) await tx`UPDATE user_vehicles SET is_default = false WHERE user_id = ${ctx.user!.id}`;
      const [row] = await tx`INSERT INTO user_vehicles (user_id, variant_id, nickname, connectors, is_default) VALUES (${ctx.user!.id}, ${variantId}, ${nickname}, ${connectors}, ${isDefault}) RETURNING id`;
      return row.id;
    });
    ctx.status = 201;
    return { ok: true, id };
  });

  r.patch('/api/me/vehicles/:id', async (ctx) => {
    const id = uuid(ctx.params.id);
    const b = obj(ctx.body);
    await sql.begin(async (tx) => {
      const [v] = await tx`SELECT user_id FROM user_vehicles WHERE id = ${id} FOR UPDATE`;
      if (!v) throw notFound('Vehicle');
      if (v.userId !== ctx.user!.id) throw forbidden('Not your vehicle.', 'OWNERSHIP_REQUIRED');
      if (b.isDefault === true) {
        await tx`UPDATE user_vehicles SET is_default = false WHERE user_id = ${ctx.user!.id}`;
        await tx`UPDATE user_vehicles SET is_default = true WHERE id = ${id}`;
      }
      if (b.nickname !== undefined) await tx`UPDATE user_vehicles SET nickname = ${str(b, 'nickname', { max: 60 })} WHERE id = ${id}`;
    });
    return { ok: true };
  });

  r.delete('/api/me/vehicles/:id', async (ctx) => {
    const id = uuid(ctx.params.id);
    const [v] = await sql`DELETE FROM user_vehicles WHERE id = ${id} AND user_id = ${ctx.user!.id} RETURNING is_default`;
    if (!v) throw notFound('Vehicle');
    if (v.isDefault) await sql`UPDATE user_vehicles SET is_default = true WHERE id = (SELECT id FROM user_vehicles WHERE user_id = ${ctx.user!.id} ORDER BY created_at LIMIT 1)`;
    return { ok: true };
  });

  // ---- favourites
  r.get('/api/me/saved-stations', async (ctx) => {
    const rows = await sql`SELECT ss.station_id, ss.created_at, s.name, s.area, s.city, s.access_type FROM saved_stations ss JOIN stations s ON s.id = ss.station_id
                           WHERE ss.user_id = ${ctx.user!.id} AND s.listing_status = 'APPROVED' ORDER BY ss.created_at DESC`;
    return { saved: rows };
  });
  r.put('/api/me/saved-stations/:stationId', async (ctx) => {
    const id = uuid(ctx.params.stationId);
    const [s] = await sql`SELECT id FROM stations WHERE id = ${id} AND listing_status = 'APPROVED'`;
    if (!s) throw notFound('Station');
    await sql`INSERT INTO saved_stations (user_id, station_id) VALUES (${ctx.user!.id}, ${id}) ON CONFLICT DO NOTHING`;
    return { ok: true, saved: true };
  });
  r.delete('/api/me/saved-stations/:stationId', async (ctx) => {
    await sql`DELETE FROM saved_stations WHERE user_id = ${ctx.user!.id} AND station_id = ${uuid(ctx.params.stationId)}`;
    return { ok: true, saved: false };
  });

  // ---- places + trips
  r.get('/api/geo/search', async (ctx) => ({ places: await geocode((ctx.query.get('q') || '').slice(0, 80)) }), { auth: 'public', rateLimit: { key: 'geo', max: 60, perSeconds: 60 } });

  r.post('/api/trips/plan', async (ctx) => {
    const b = obj(ctx.body);
    const point = (k: string) => {
      const p = obj(b[k]);
      return { label: str(p, 'label', { max: 120 }), latitude: num(p, 'latitude', { min: 6, max: 37.5 }), longitude: num(p, 'longitude', { min: 68, max: 97.5 }) };
    };
    const origin = point('origin');
    const destination = point('destination');
    const rangeKm = num(b, 'rangeKm', { min: 20, max: 1000, int: true, label: 'Usable range' });
    const corridorKm = num(b, 'corridorKm', { min: 1, max: 30, optional: true }) || 10;
    const reserveKm = Math.round(rangeKm * 0.2); // keep a 20 % buffer
    const rt = route(origin, destination);
    const factor = rt.distanceKm / Math.max(rt.straightKm, 0.1);
    const stations = (await sql`SELECT ${STATION_COLS(sql)}, p.business_name FROM stations s JOIN partners p ON p.id = s.partner_id
                                WHERE s.listing_status = 'APPROVED' AND p.status = 'APPROVED'`) as unknown as (StationRow & { businessName: string })[];
    const conns = await sql`SELECT station_id, standard, current_type, max_power_kw::float8 AS max_power_kw, price_per_kwh_paise FROM connectors WHERE status = 'AVAILABLE'`;
    const candidates = stations
      .map((s) => {
        const ex = exposure(s);
        const d = distanceToSegmentKm([ex.location.latitude, ex.location.longitude], [origin.latitude, origin.longitude], [destination.latitude, destination.longitude]);
        return { s, ex, offRouteKm: d.km, alongKm: d.t * rt.distanceKm };
      })
      .filter((c) => c.offRouteKm <= corridorKm && c.s.operationalStatus === 'AVAILABLE')
      .sort((a, b2) => a.alongKm - b2.alongKm);
    // Greedy plan: from each position, drive as far as possible while keeping the reserve, then stop at the farthest reachable station.
    const stops: unknown[] = [];
    let pos = 0;
    let feasible = true;
    while (rt.distanceKm - pos > rangeKm - reserveKm) {
      const reachable = candidates.filter((c) => c.alongKm > pos + 5 && c.alongKm - pos + c.offRouteKm * factor <= rangeKm - reserveKm);
      if (!reachable.length) {
        feasible = false;
        break;
      }
      const next = reachable[reachable.length - 1];
      const cs = conns.filter((c) => c.stationId === next.s.id);
      stops.push({
        stationId: next.s.id,
        name: next.s.name,
        area: next.s.area,
        city: next.s.city,
        accessType: next.s.accessType,
        location: next.ex.location,
        exactLocation: next.ex.exactLocation,
        kmFromStart: Math.round(next.alongKm),
        detourKm: Math.round(next.offRouteKm * 2 * 10) / 10,
        maxPowerKw: cs.length ? Math.max(...cs.map((c) => c.maxPowerKw as number)) : null,
        minPricePaise: cs.length ? Math.min(...cs.map((c) => c.pricePerKwhPaise as number)) : null,
        connectors: [...new Set(cs.map((c) => c.standard as string))],
        availabilityConfidence: confidence(next.s),
        isDemo: next.s.isDemo,
      });
      pos = next.alongKm;
    }
    const nearby = candidates.slice(0, 12).map((c) => ({ stationId: c.s.id, name: c.s.name, kmFromStart: Math.round(c.alongKm), offRouteKm: Math.round(c.offRouteKm * 10) / 10 }));
    return {
      plan: { origin, destination, rangeKm, reserveKm, distanceKm: rt.distanceKm, path: rt.path, stops, feasible, routeSource: rt.source, routeNote: rt.note },
      corridorStations: nearby,
      haversineKm: Math.round(haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude)),
    };
  });

  r.post('/api/trips', async (ctx) => {
    const b = obj(ctx.body);
    const title = str(b, 'title', { max: 120 });
    const plan = obj(b.plan);
    const origin = obj(plan.origin);
    const destination = obj(plan.destination);
    const rangeKm = num(plan, 'rangeKm', { min: 20, max: 1000, int: true });
    const distanceKm = num(plan, 'distanceKm', { min: 0, max: 5000 });
    if (!Array.isArray(plan.stops) || plan.stops.length > 20) throw badRequest('Invalid stops.');
    const [row] = await sql`INSERT INTO trip_plans (user_id, title, origin, destination, range_km, distance_km, stops)
                            VALUES (${ctx.user!.id}, ${title}, ${sql.json(origin as never)}, ${sql.json(destination as never)}, ${rangeKm}, ${distanceKm}, ${sql.json(plan.stops as never)}) RETURNING id`;
    ctx.status = 201;
    return { ok: true, id: row.id };
  });
  r.get('/api/trips', async (ctx) => ({ trips: await sql`SELECT id, title, origin, destination, range_km, distance_km::float8 AS distance_km, stops, created_at FROM trip_plans WHERE user_id = ${ctx.user!.id} ORDER BY created_at DESC` }));
  r.delete('/api/trips/:id', async (ctx) => {
    const [t] = await sql`DELETE FROM trip_plans WHERE id = ${uuid(ctx.params.id)} AND user_id = ${ctx.user!.id} RETURNING id`;
    if (!t) throw notFound('Trip');
    return { ok: true };
  });

  // ---- support (drivers and partners)
  r.get('/api/support/tickets', async (ctx) => ({
    tickets: await sql`SELECT t.id, t.workspace, t.category, t.subject, t.status, t.created_at, t.updated_at, b.code AS booking_code
                       FROM support_tickets t LEFT JOIN bookings b ON b.id = t.booking_id WHERE t.user_id = ${ctx.user!.id} ORDER BY t.updated_at DESC`,
  }));
  r.post('/api/support/tickets', async (ctx) => {
    const b = obj(ctx.body);
    const workspace = oneOf(b, 'workspace', ['driver', 'partner'] as const);
    if (workspace === 'partner' && ctx.user!.partnerStatus !== 'APPROVED') throw forbidden('Partner support is for approved partners.', 'PARTNER_NOT_APPROVED');
    const category = oneOf(b, 'category', ['booking', 'payment', 'station', 'safety', 'account', 'other'] as const);
    const subject = str(b, 'subject', { min: 3, max: 120, label: 'Subject' });
    const message = str(b, 'message', { min: 3, max: 2000, label: 'Message' });
    let bookingId: string | null = null;
    if (b.bookingId) {
      bookingId = uuid(b.bookingId, 'bookingId');
      const [bk] = await sql`SELECT b.driver_id, s.partner_id FROM bookings b JOIN stations s ON s.id = b.station_id WHERE b.id = ${bookingId}`;
      if (!bk || (bk.driverId !== ctx.user!.id && bk.partnerId !== ctx.user!.partnerId)) throw forbidden('That booking is not yours.', 'OWNERSHIP_REQUIRED');
    }
    const id = await sql.begin(async (tx) => {
      const [t] = await tx`INSERT INTO support_tickets (user_id, workspace, booking_id, category, subject) VALUES (${ctx.user!.id}, ${workspace}, ${bookingId}, ${category}, ${subject}) RETURNING id`;
      await tx`INSERT INTO support_messages (ticket_id, author_id, author_role, body) VALUES (${t.id as string}, ${ctx.user!.id}, ${workspace}, ${message})`;
      return t.id;
    });
    ctx.status = 201;
    return { ok: true, id };
  });
  r.get('/api/support/tickets/:id', async (ctx) => {
    const id = uuid(ctx.params.id);
    const [t] = await sql`SELECT id, user_id, workspace, category, subject, status, created_at FROM support_tickets WHERE id = ${id}`;
    if (!t) throw notFound('Ticket');
    if (t.userId !== ctx.user!.id && !ctx.user!.roles.includes('admin')) throw forbidden('Not your ticket.', 'OWNERSHIP_REQUIRED');
    const messages = await sql`SELECT author_role, body, created_at FROM support_messages WHERE ticket_id = ${id} ORDER BY created_at`;
    return { ticket: t, messages };
  });
  r.post('/api/support/tickets/:id/messages', async (ctx) => {
    const id = uuid(ctx.params.id);
    const body = str(obj(ctx.body), 'body', { max: 2000, label: 'Message' });
    const [t] = await sql`SELECT user_id, workspace, status FROM support_tickets WHERE id = ${id}`;
    if (!t || t.userId !== ctx.user!.id) throw forbidden('Not your ticket.', 'OWNERSHIP_REQUIRED');
    await sql`INSERT INTO support_messages (ticket_id, author_id, author_role, body) VALUES (${id}, ${ctx.user!.id}, ${t.workspace as string}, ${body})`;
    await sql`UPDATE support_tickets SET status = CASE WHEN status IN ('RESOLVED', 'CLOSED') THEN 'OPEN' ELSE status END, updated_at = now() WHERE id = ${id}`;
    return { ok: true };
  });
}
