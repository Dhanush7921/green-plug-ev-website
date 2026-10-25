// Public discovery: search, filters, station details, slot availability and session estimates.
import { sql, type Q } from '../db';
import { directionsUrl } from '../adapters/maps';
import { CONNECTORS, evaluate, timeEstimate, type VehicleSpec } from '../lib/compat';
import { badRequest, notFound } from '../lib/errors';
import { computeQuote } from '../lib/money';
import type { Ctx, Router } from '../lib/http';
import { getSettings } from '../lib/settings';
import { confidence, connectorsFor, distanceFrom, exposure, hoursFor, isOpenAt, STATION_COLS, type ConnectorRow, type HoursRow, type StationRow } from '../lib/stationData';
import { closeMinutes, fromMinutes, istDateTimeToUtc, todayIst, toMinutes } from '../lib/time';
import { DATE, num, obj, uuid } from '../lib/validate';

const ACTIVE = ['RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'];

export async function vehicleSpec(q: Q, userId: string | undefined, vehicleId: string | null): Promise<(VehicleSpec & { id: string; nickname: string }) | null> {
  if (!userId) return null;
  const rows = vehicleId
    ? await q`SELECT uv.id, uv.nickname, coalesce(v.connectors, uv.connectors) AS connectors, v.max_ac_kw::float8 AS max_ac_kw, v.max_dc_kw::float8 AS max_dc_kw, coalesce(v.evidence_state, 'unverified') AS evidence_state
              FROM user_vehicles uv LEFT JOIN ev_variants v ON v.id = uv.variant_id WHERE uv.id = ${vehicleId} AND uv.user_id = ${userId}`
    : await q`SELECT uv.id, uv.nickname, coalesce(v.connectors, uv.connectors) AS connectors, v.max_ac_kw::float8 AS max_ac_kw, v.max_dc_kw::float8 AS max_dc_kw, coalesce(v.evidence_state, 'unverified') AS evidence_state
              FROM user_vehicles uv LEFT JOIN ev_variants v ON v.id = uv.variant_id WHERE uv.user_id = ${userId} AND uv.is_default`;
  const r = rows[0];
  if (!r) {
    if (vehicleId) throw notFound('Vehicle');
    return null;
  }
  return { id: r.id as string, nickname: r.nickname as string, connectors: r.connectors as string[], maxAcKw: (r.maxAcKw as number) ?? null, maxDcKw: (r.maxDcKw as number) ?? null, evidenceState: r.evidenceState as 'verified' | 'unverified' };
}

function connectorPublic(c: ConnectorRow) {
  return { id: c.id, label: c.label, standard: c.standard, currentType: c.currentType, maxPowerKw: c.maxPowerKw, pricePerKwhPaise: c.pricePerKwhPaise, status: c.status };
}

async function activeNow(q: Q, connectorIds: string[]) {
  if (!connectorIds.length) return new Set<string>();
  const rows = await q`SELECT DISTINCT connector_id FROM bookings WHERE connector_id = ANY(${connectorIds}) AND status = ANY(${ACTIVE}) AND starts_at <= now() AND ends_at > now()`;
  return new Set(rows.map((r) => r.connectorId as string));
}

function likeEscape(s: string) {
  return `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function stationRoutes(r: Router) {
  r.get(
    '/api/stations',
    async (ctx: Ctx) => {
      const qp = ctx.query;
      const text = (qp.get('q') || '').trim().slice(0, 80);
      const connectorsF = (qp.get('connector') || '').split(',').filter((c) => CONNECTORS.includes(c));
      const current = qp.get('current');
      if (current && !['AC', 'DC'].includes(current)) throw badRequest('current must be AC or DC');
      const minKw = Number(qp.get('minKw') || 0) || 0;
      const maxPricePaise = Number(qp.get('maxPricePaise') || 0) || 0;
      const access = (qp.get('access') || '').split(',').filter((a) => ['PUBLIC', 'PRIVATE', 'HOME'].includes(a));
      const lat = qp.get('lat') ? Number(qp.get('lat')) : undefined;
      const lng = qp.get('lng') ? Number(qp.get('lng')) : undefined;
      const radiusKm = Math.min(500, Number(qp.get('radiusKm') || 0) || 0);
      const availableOnly = qp.get('availableOnly') === '1';
      const openNow = qp.get('openNow') === '1';
      const savedOnly = qp.get('saved') === '1';
      const compatibleOnly = qp.get('compatibleOnly') === '1';
      const vehicleId = qp.get('vehicleId') ? uuid(qp.get('vehicleId'), 'vehicleId') : null;
      const hasConnFilter = connectorsF.length || current || minKw || maxPricePaise;

      const rows = (await sql`
        SELECT ${STATION_COLS(sql)}, p.business_name
        FROM stations s JOIN partners p ON p.id = s.partner_id
        WHERE s.listing_status = 'APPROVED' AND p.status = 'APPROVED'
        ${text ? sql`AND (s.name ILIKE ${likeEscape(text)} OR s.area ILIKE ${likeEscape(text)} OR s.city ILIKE ${likeEscape(text)} OR EXISTS (SELECT 1 FROM unnest(s.amenities) a WHERE a ILIKE ${likeEscape(text)}))` : sql``}
        ${access.length ? sql`AND s.access_type = ANY(${access})` : sql``}
        ${savedOnly && ctx.user ? sql`AND EXISTS (SELECT 1 FROM saved_stations ss WHERE ss.station_id = s.id AND ss.user_id = ${ctx.user.id})` : sql``}
        ${availableOnly ? sql`AND s.operational_status = 'AVAILABLE'` : sql``}
        ${
          hasConnFilter
            ? sql`AND EXISTS (SELECT 1 FROM connectors c WHERE c.station_id = s.id AND c.status = 'AVAILABLE'
                  ${connectorsF.length ? sql`AND c.standard = ANY(${connectorsF})` : sql``}
                  ${current ? sql`AND c.current_type = ${current}` : sql``}
                  ${minKw ? sql`AND c.max_power_kw >= ${minKw}` : sql``}
                  ${maxPricePaise ? sql`AND c.price_per_kwh_paise <= ${maxPricePaise}` : sql``})`
            : sql``
        }
        ORDER BY s.name
        LIMIT 200`) as unknown as (StationRow & { businessName: string })[];

      const ids = rows.map((s) => s.id);
      const [conns, hours, saved, vehicle] = await Promise.all([
        connectorsFor(sql, ids),
        hoursFor(sql, ids),
        ctx.user ? sql`SELECT station_id FROM saved_stations WHERE user_id = ${ctx.user.id}` : Promise.resolve([]),
        vehicleSpec(sql, ctx.user?.id, vehicleId),
      ]);
      const busy = await activeNow(sql, conns.map((c) => c.id));
      const savedSet = new Set(saved.map((x) => x.stationId as string));
      const now = new Date();

      let out = rows.map((s) => {
        const cs = conns.filter((c) => c.stationId === s.id);
        const hs = hours.filter((h) => h.stationId === s.id);
        const ex = exposure(s);
        const open = isOpenAt(hs, now);
        const freeNow = s.operationalStatus === 'AVAILABLE' && open && cs.some((c) => c.status === 'AVAILABLE' && !busy.has(c.id));
        const comps = cs.map((c) => evaluate(vehicle, c, s.operationalStatus === 'AVAILABLE'));
        const best = vehicle ? (['COMPATIBLE_VERIFIED', 'NEEDS_CONFIRMATION', 'INCOMPATIBLE', 'OUT_OF_SERVICE'] as const).find((st) => comps.some((x) => x.state === st)) : null;
        const prices = cs.map((c) => c.pricePerKwhPaise);
        return {
          id: s.id,
          name: s.name,
          area: s.area,
          city: s.city,
          accessType: s.accessType,
          ...ex,
          distanceKm: distanceFrom(ex.location, lat, lng),
          operationalStatus: s.operationalStatus,
          availabilityConfidence: confidence(s),
          statusConfirmedAt: s.statusConfirmedAt,
          isDemo: s.isDemo,
          openNow: open,
          freeNow,
          minPricePaise: prices.length ? Math.min(...prices) : null,
          maxPowerKw: cs.length ? Math.max(...cs.map((c) => c.maxPowerKw)) : null,
          connectors: cs.map(connectorPublic),
          amenities: s.amenities,
          photo: (s.photoPaths as string[])[0] ?? null,
          saved: savedSet.has(s.id),
          compatibility: best,
        };
      });
      if (lat !== undefined && radiusKm) out = out.filter((s) => s.distanceKm !== null && s.distanceKm <= radiusKm);
      if (openNow) out = out.filter((s) => s.openNow);
      if (availableOnly) out = out.filter((s) => s.freeNow);
      if (compatibleOnly && vehicle) out = out.filter((s) => s.compatibility === 'COMPATIBLE_VERIFIED' || s.compatibility === 'NEEDS_CONFIRMATION');
      if (lat !== undefined) out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
      return { stations: out, vehicle: vehicle ? { id: vehicle.id, nickname: vehicle.nickname } : null, count: out.length };
    },
    { auth: 'public' },
  );

  r.get(
    '/api/stations/:id',
    async (ctx) => {
      const id = uuid(ctx.params.id, 'station id');
      const [s] = (await sql`SELECT ${STATION_COLS(sql)}, p.business_name FROM stations s JOIN partners p ON p.id = s.partner_id
                               WHERE s.id = ${id} AND s.listing_status = 'APPROVED' AND p.status = 'APPROVED'`) as unknown as (StationRow & { businessName: string })[];
      if (!s) throw notFound('Station');
      const [cs, hs, vehicle, saved] = await Promise.all([
        connectorsFor(sql, [id]),
        hoursFor(sql, [id]),
        vehicleSpec(sql, ctx.user?.id, ctx.query.get('vehicleId') ? uuid(ctx.query.get('vehicleId'), 'vehicleId') : null),
        ctx.user ? sql`SELECT 1 FROM saved_stations WHERE user_id = ${ctx.user.id} AND station_id = ${id}` : Promise.resolve([]),
      ]);
      const ex = exposure(s);
      return {
        station: {
          id: s.id,
          name: s.name,
          description: s.description,
          area: s.area,
          city: s.city,
          accessType: s.accessType,
          ...ex,
          accessNotes: s.accessType === 'PUBLIC' ? s.accessNotes : 'Access instructions are shared with confirmed bookings.',
          directionsUrl: ex.exactLocation ? directionsUrl(s.latitude, s.longitude) : null,
          amenities: s.amenities,
          photos: s.photoPaths,
          operationalStatus: s.operationalStatus,
          availabilityConfidence: confidence(s),
          statusConfirmedAt: s.statusConfirmedAt,
          isDemo: s.isDemo,
          slotMinutes: s.slotMinutes,
          timezone: s.timezone,
          openNow: isOpenAt(hs, new Date()),
          hours: hs.map((h) => ({ weekday: h.weekday, opensAt: h.opensAt, closesAt: h.closesAt })),
          connectors: cs.map((c) => ({ ...connectorPublic(c), compatibility: evaluate(vehicle, c, s.operationalStatus === 'AVAILABLE') })),
          saved: saved.length > 0,
          contact: null, // owner contact details are never public
        },
        vehicle: vehicle ? { id: vehicle.id, nickname: vehicle.nickname } : null,
      };
    },
    { auth: 'public' },
  );

  r.get(
    '/api/stations/:id/availability',
    async (ctx) => {
      const id = uuid(ctx.params.id, 'station id');
      const date = ctx.query.get('date') || todayIst();
      if (!DATE.test(date)) throw badRequest('date must be YYYY-MM-DD');
      const duration = Number(ctx.query.get('durationMinutes') || 60);
      const result = await availability(sql, id, date, duration);
      return result;
    },
    { auth: 'public' },
  );

  r.post(
    '/api/stations/:id/estimate',
    async (ctx) => {
      const id = uuid(ctx.params.id, 'station id');
      const b = obj(ctx.body);
      const connectorId = uuid(b.connectorId, 'connectorId');
      const plannedKwh = num(b, 'plannedKwh', { min: 0.5, max: 200, label: 'Planned energy (kWh)' });
      const durationMinutes = num(b, 'durationMinutes', { min: 15, max: 240, int: true, optional: true });
      const [c] = (await sql`SELECT c.id, c.station_id, c.label, c.standard, c.current_type, c.max_power_kw::float8 AS max_power_kw, c.price_per_kwh_paise, c.status, s.operational_status
                               FROM connectors c JOIN stations s ON s.id = c.station_id
                               WHERE c.id = ${connectorId} AND c.station_id = ${id} AND s.listing_status = 'APPROVED'`) as unknown as (ConnectorRow & { operationalStatus: string })[];
      if (!c) throw notFound('Connector');
      const vehicle = await vehicleSpec(sql, ctx.user?.id, typeof b.vehicleId === 'string' && b.vehicleId ? uuid(b.vehicleId, 'vehicleId') : null);
      const settings = await getSettings(sql);
      const quote = computeQuote(c.pricePerKwhPaise, plannedKwh, settings.customerFeeBps, settings.providerCommissionBps);
      const compat = evaluate(vehicle, c, c.operationalStatus === 'AVAILABLE');
      const time = timeEstimate(plannedKwh, compat.effectiveKwCeiling, c.currentType);
      const maxDeliverable = Number.isNaN(durationMinutes) || !compat.effectiveKwCeiling ? null : Math.round(compat.effectiveKwCeiling * (durationMinutes / 60) * 10) / 10;
      return {
        quote,
        compatibility: compat,
        time,
        warnings: maxDeliverable !== null && maxDeliverable < plannedKwh ? [`At most about ${maxDeliverable} kWh fits in ${durationMinutes} minutes at this connector; consider a longer slot or less energy.`] : [],
        note: 'The base amount is the per-kWh rate times planned energy. If less energy is delivered, the unused part is refunded after the session.',
      };
    },
    { auth: 'public' },
  );
}

/** Slot grid for a date (station timezone), per connector. Shared by the availability API and booking validation. */
export async function availability(q: Q, stationId: string, date: string, durationMinutes: number, opts: { includeUnapproved?: boolean } = {}) {
  const [s] = (await q`SELECT id, slot_minutes, operational_status, listing_status, is_demo, status_confirmed_at FROM stations WHERE id = ${stationId}`) as unknown as StationRow[];
  if (!s || (!opts.includeUnapproved && s.listingStatus !== 'APPROVED')) throw notFound('Station');
  if (!Number.isInteger(durationMinutes) || durationMinutes < s.slotMinutes || durationMinutes > 240 || durationMinutes % s.slotMinutes !== 0)
    throw badRequest(`Duration must be a multiple of ${s.slotMinutes} minutes, up to 240.`, { field: 'durationMinutes' });
  const [cs, hs] = await Promise.all([connectorsFor(q, [stationId]), hoursFor(q, [stationId])]);
  const dayStart = istDateTimeToUtc(date, '00:00');
  const dayEnd = new Date(dayStart.getTime() + 864e5);
  const weekday = new Date(`${date}T12:00:00+05:30`).getUTCDay();
  const h = hs.find((x) => x.weekday === weekday) as HoursRow | undefined;
  const ids = cs.map((c) => c.id);
  const [booked, blocks] = await Promise.all([
    ids.length
      ? q`SELECT connector_id, starts_at, ends_at FROM bookings WHERE connector_id = ANY(${ids}) AND status = ANY(${ACTIVE})
          AND NOT (status = 'RESERVED' AND hold_expires_at < now()) AND starts_at < ${dayEnd} AND ends_at > ${dayStart}`
      : Promise.resolve([]),
    q`SELECT connector_id, starts_at, ends_at FROM availability_blocks WHERE station_id = ${stationId} AND starts_at < ${dayEnd} AND ends_at > ${dayStart}`,
  ]);
  const now = Date.now() + 2 * 60_000;
  const connectors = cs.map((c) => {
    const slots: { startsAt: string; endsAt: string; time: string; available: boolean; reason?: string }[] = [];
    if (h) {
      const open = toMinutes(h.opensAt);
      const close = closeMinutes(h.closesAt);
      for (let m = open; m + durationMinutes <= close; m += s.slotMinutes) {
        const st = istDateTimeToUtc(date, fromMinutes(m));
        const en = new Date(st.getTime() + durationMinutes * 60_000);
        let reason = '';
        if (s.operationalStatus !== 'AVAILABLE') reason = s.operationalStatus === 'TEMPORARILY_CLOSED' ? 'Temporarily closed' : 'Unavailable';
        else if (c.status !== 'AVAILABLE') reason = 'Out of service';
        else if (st.getTime() < now) reason = 'Past';
        else if (booked.some((b) => b.connectorId === c.id && new Date(b.startsAt as string) < en && new Date(b.endsAt as string) > st)) reason = 'Booked';
        else if (blocks.some((b) => (!b.connectorId || b.connectorId === c.id) && new Date(b.startsAt as string) < en && new Date(b.endsAt as string) > st)) reason = 'Blocked by host';
        slots.push({ startsAt: st.toISOString(), endsAt: en.toISOString(), time: fromMinutes(m), available: !reason, ...(reason ? { reason } : {}) });
      }
    }
    return { connectorId: c.id, label: c.label, standard: c.standard, currentType: c.currentType, maxPowerKw: c.maxPowerKw, pricePerKwhPaise: c.pricePerKwhPaise, slots };
  });
  return {
    stationId,
    date,
    durationMinutes,
    slotMinutes: s.slotMinutes,
    open: h ? { opensAt: h.opensAt, closesAt: h.closesAt } : null,
    confidence: confidence(s),
    note: 'Availability reflects bookings on this platform and host-declared status. It is not live charger telemetry.',
    connectors,
  };
}
