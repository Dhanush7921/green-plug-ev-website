// Station Partner workspace. Every route re-checks on the server that the caller's partner organisation is
// APPROVED and that the station/booking belongs to that organisation.
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { sql, type Q } from '../db';
import { notify } from '../adapters/messaging';
import { audit } from '../lib/auth';
import { lockBooking, refundBooking, refundRemaining, transition } from '../lib/bookingFlow';
import { CONNECTORS } from '../lib/compat';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { Ctx, Router } from '../lib/http';
import { connectorsFor, hoursFor, STATION_COLS } from '../lib/stationData';
import { TIME, arr, bool, EMAIL, num, obj, oneOf, PHONE, str, uuid } from '../lib/validate';
import { requireVerified } from './auth';
import { bookingView } from './bookings';

const AMENITIES = ['parking', 'restroom', 'cafe', 'wifi', 'waiting_area', 'covered', 'cctv', 'accessible', 'two_wheeler_parking', 'security'] as const;
const P = { approvedPartner: true } as const;

async function ownStation(q: Q, ctx: Ctx, id: string) {
  const [s] = await q`SELECT id, partner_id, listing_status FROM stations WHERE id = ${id}`;
  if (!s) throw notFound('Station');
  if (s.partnerId !== ctx.user!.partnerId) {
    await audit(sql, ctx, 'partner', 'ownership.denied', 'station', id);
    throw forbidden('This station belongs to another partner.', 'OWNERSHIP_REQUIRED');
  }
  return s;
}

function stationInput(b: Record<string, unknown>, partial: boolean) {
  const o: Record<string, unknown> = {};
  const has = (k: string) => !partial || b[k] !== undefined;
  if (has('name')) o.name = str(b, 'name', { min: 3, max: 90, label: 'Station name' });
  if (has('description')) o.description = str(b, 'description', { optional: true, max: 600, label: 'Description' });
  if (has('address')) o.address = str(b, 'address', { min: 5, max: 200, label: 'Address' });
  if (has('area')) o.area = str(b, 'area', { min: 2, max: 80, label: 'Area / locality' });
  if (has('city')) o.city = str(b, 'city', { min: 2, max: 60, label: 'City' });
  if (has('latitude')) o.latitude = num(b, 'latitude', { min: 6, max: 37.5, label: 'Latitude' }); // India bounding box
  if (has('longitude')) o.longitude = num(b, 'longitude', { min: 68, max: 97.5, label: 'Longitude' });
  if (has('accessType')) o.accessType = oneOf(b, 'accessType', ['PUBLIC', 'PRIVATE', 'HOME'] as const, { label: 'Access type' });
  if (b.discloseExactLocation !== undefined || !partial) o.discloseExactLocation = bool(b, 'discloseExactLocation', false);
  if (has('accessNotes')) o.accessNotes = str(b, 'accessNotes', { optional: true, max: 300, label: 'Access notes' });
  if (b.amenities !== undefined || !partial) o.amenities = arr(b, 'amenities', AMENITIES);
  if (b.slotMinutes !== undefined || !partial) o.slotMinutes = b.slotMinutes === undefined ? 60 : oneOf({ v: String(b.slotMinutes) }, 'v', ['15', '30', '45', '60', '90', '120'] as const, { label: 'Slot length' }) && Number(b.slotMinutes);
  return o;
}

function hoursInput(b: Record<string, unknown>) {
  if (!Array.isArray(b.hours)) throw badRequest('hours must be a list of {weekday, opensAt, closesAt}.');
  const seen = new Set<number>();
  return (b.hours as Record<string, unknown>[]).map((h) => {
    const weekday = num(h, 'weekday', { min: 0, max: 6, int: true });
    if (seen.has(weekday)) throw badRequest('Each weekday may appear once.');
    seen.add(weekday);
    const opensAt = str(h, 'opensAt', { pattern: TIME, label: 'Opening time' });
    const closesAt = str(h, 'closesAt', { pattern: /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, label: 'Closing time' });
    if (closesAt !== '24:00' && closesAt <= opensAt) throw badRequest('Closing time must be after opening time.');
    return { weekday, opensAt, closesAt: closesAt === '24:00' ? '00:00' : closesAt };
  });
}

function connectorInput(b: Record<string, unknown>, partial: boolean) {
  const o: Record<string, unknown> = {};
  const has = (k: string) => !partial || b[k] !== undefined;
  if (has('label')) o.label = str(b, 'label', { max: 40, label: 'Connector label' });
  if (has('standard')) o.standard = oneOf(b, 'standard', CONNECTORS as readonly string[], { label: 'Connector type' });
  if (has('currentType')) o.currentType = oneOf(b, 'currentType', ['AC', 'DC'] as const, { label: 'AC/DC' });
  if (has('maxPowerKw')) o.maxPowerKw = num(b, 'maxPowerKw', { min: 0.5, max: 400, label: 'Charging power (kW)' });
  if (has('pricePerKwh')) o.pricePerKwhPaise = Math.round(num(b, 'pricePerKwh', { min: 1, max: 100, label: 'Price per kWh (₹)' }) * 100);
  if (b.status !== undefined) o.status = oneOf(b, 'status', ['AVAILABLE', 'OUT_OF_SERVICE'] as const);
  // basic physical sanity: DC-only and AC-only standards
  const std = o.standard as string | undefined;
  const cur = o.currentType as string | undefined;
  if (std && cur) {
    if (['CCS2', 'CHADEMO', 'BHARAT_DC001', 'TYPE6_LEVDC'].includes(std) && cur !== 'DC') throw badRequest(`${std} is a DC connector.`);
    if (['TYPE2', 'BHARAT_AC001', 'SOCKET_15A'].includes(std) && cur !== 'AC') throw badRequest(`${std} is an AC connector.`);
  }
  return o;
}

export function partnerRoutes(r: Router) {
  // ---------------------------------------------------------------- application (any verified user)
  r.get('/api/partner/application', async (ctx) => {
    const [p] = await sql`SELECT id, business_name, business_type, contact_email, contact_phone, gstin, address, status, review_note, created_at, reviewed_at FROM partners WHERE owner_user_id = ${ctx.user!.id}`;
    const docs = p ? await sql`SELECT id, document_type, reference, status, created_at FROM partner_verifications WHERE partner_id = ${p.id as string} ORDER BY created_at` : [];
    return { application: p ?? null, verifications: docs };
  });

  r.post('/api/partner/application', async (ctx) => {
    await requireVerified(ctx);
    const b = obj(ctx.body);
    const businessName = str(b, 'businessName', { min: 2, max: 120, label: 'Business name' });
    const businessType = oneOf(b, 'businessType', ['individual', 'company', 'society', 'government', 'other'] as const, { label: 'Business type' });
    const contactEmail = str(b, 'contactEmail', { max: 160, pattern: EMAIL, label: 'Contact email' });
    const contactPhone = str(b, 'contactPhone', { max: 16, pattern: PHONE, label: 'Contact phone' });
    const gstin = str(b, 'gstin', { optional: true, max: 15, pattern: /^[0-9A-Z]{15}$/, label: 'GSTIN' }) || null;
    const address = str(b, 'address', { min: 5, max: 300, label: 'Business address' });
    if (!Array.isArray(b.verifications) || b.verifications.length < 1) throw badRequest('Add at least one ownership or operating-authority document reference.');
    const docs = (b.verifications as Record<string, unknown>[]).slice(0, 6).map((d) => ({
      documentType: oneOf(d, 'documentType', ['ownership_proof', 'operating_authority', 'electrical_safety', 'identity'] as const, { label: 'Document type' }),
      reference: str(d, 'reference', { min: 3, max: 200, label: 'Document reference' }),
    }));
    if (!docs.some((d) => d.documentType === 'ownership_proof' || d.documentType === 'operating_authority')) throw badRequest('Include proof of station ownership or operating authority.');
    if (b.declaration !== true) throw badRequest('Please confirm the declaration.', { field: 'declaration' });

    const id = await sql.begin(async (tx) => {
      const [existing] = await tx`SELECT id, status FROM partners WHERE owner_user_id = ${ctx.user!.id} FOR UPDATE`;
      if (existing && existing.status !== 'REJECTED') throw conflict(`You already have a ${String(existing.status).toLowerCase()} partner application.`, 'APPLICATION_EXISTS');
      let pid: string;
      if (existing) {
        pid = existing.id as string;
        await tx`UPDATE partners SET business_name = ${businessName}, business_type = ${businessType}, contact_email = ${contactEmail}, contact_phone = ${contactPhone},
                   gstin = ${gstin}, address = ${address}, status = 'PENDING', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now() WHERE id = ${pid}`;
        await tx`DELETE FROM partner_verifications WHERE partner_id = ${pid}`;
      } else {
        const [p] = await tx`INSERT INTO partners (owner_user_id, business_name, business_type, contact_email, contact_phone, gstin, address)
                             VALUES (${ctx.user!.id}, ${businessName}, ${businessType}, ${contactEmail}, ${contactPhone}, ${gstin}, ${address}) RETURNING id`;
        pid = p.id as string;
      }
      for (const d of docs) await tx`INSERT INTO partner_verifications (partner_id, document_type, reference) VALUES (${pid}, ${d.documentType}, ${d.reference})`;
      await audit(tx, ctx, 'driver', 'partner.applied', 'partner', pid, { businessName });
      const admins = await tx`SELECT user_id FROM user_roles WHERE role = 'admin'`;
      for (const a of admins) await notify(tx, a.userId as string, 'admin_queue', 'New partner application', `${businessName} applied to become a station partner.`, '/admin/partners');
      return pid;
    });
    ctx.status = 201;
    return { ok: true, partnerId: id, status: 'PENDING' };
  });

  // ---------------------------------------------------------------- dashboard
  r.get('/api/partner/overview', async (ctx) => {
    const pid = ctx.user!.partnerId!;
    const [counts] = await sql`
      SELECT (SELECT count(*)::int FROM stations WHERE partner_id = ${pid}) AS stations,
             (SELECT count(*)::int FROM stations WHERE partner_id = ${pid} AND listing_status = 'APPROVED') AS published,
             (SELECT count(*)::int FROM stations WHERE partner_id = ${pid} AND listing_status = 'SUBMITTED') AS in_review,
             (SELECT count(*)::int FROM bookings b JOIN stations s ON s.id = b.station_id WHERE s.partner_id = ${pid} AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS') AND b.ends_at > now()) AS upcoming,
             (SELECT count(*)::int FROM bookings b JOIN stations s ON s.id = b.station_id WHERE s.partner_id = ${pid} AND b.status = 'COMPLETED') AS completed`;
    const rev = await revenue(pid);
    const next = await sql`
      SELECT b.id, b.code, b.status, b.starts_at, b.ends_at, s.name AS station_name, c.label AS connector_label, split_part(u.full_name, ' ', 1) AS driver_first_name
      FROM bookings b JOIN stations s ON s.id = b.station_id JOIN connectors c ON c.id = b.connector_id JOIN users u ON u.id = b.driver_id
      WHERE s.partner_id = ${pid} AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS') AND b.ends_at > now()
      ORDER BY b.starts_at LIMIT 8`;
    return { counts, revenue: rev.summary, upcoming: next };
  }, P);

  // ---------------------------------------------------------------- stations
  r.get('/api/partner/stations', async (ctx) => {
    const rows = await sql`SELECT ${STATION_COLS(sql)} FROM stations s WHERE s.partner_id = ${ctx.user!.partnerId!} ORDER BY s.created_at`;
    const ids = rows.map((s) => s.id as string);
    const [cs, hs] = await Promise.all([connectorsFor(sql, ids), hoursFor(sql, ids)]);
    return { stations: rows.map((s) => ({ ...s, connectors: cs.filter((c) => c.stationId === s.id), hours: hs.filter((h) => h.stationId === s.id) })) };
  }, P);

  r.get('/api/partner/stations/:id', async (ctx) => {
    const id = uuid(ctx.params.id);
    await ownStation(sql, ctx, id);
    const [s] = await sql`SELECT ${STATION_COLS(sql)} FROM stations s WHERE s.id = ${id}`;
    const [cs, hs, blocks, prices] = await Promise.all([
      connectorsFor(sql, [id]),
      hoursFor(sql, [id]),
      sql`SELECT id, connector_id, starts_at, ends_at, reason FROM availability_blocks WHERE station_id = ${id} AND ends_at > now() ORDER BY starts_at`,
      sql`SELECT ph.connector_id, ph.price_per_kwh_paise, ph.effective_from FROM pricing_history ph JOIN connectors c ON c.id = ph.connector_id WHERE c.station_id = ${id} ORDER BY ph.effective_from DESC LIMIT 30`,
    ]);
    return { station: { ...s, connectors: cs, hours: hs, blocks, pricingHistory: prices } };
  }, P);

  r.post('/api/partner/stations', async (ctx) => {
    const b = obj(ctx.body);
    const s = stationInput(b, false);
    const hours = b.hours ? hoursInput(b) : [];
    const id = await sql.begin(async (tx) => {
      const [row] = await tx`INSERT INTO stations (partner_id, name, description, address, area, city, latitude, longitude, access_type, disclose_exact_location, access_notes, amenities, slot_minutes)
                             VALUES (${ctx.user!.partnerId!}, ${s.name as string}, ${s.description as string}, ${s.address as string}, ${s.area as string}, ${s.city as string},
                                     ${s.latitude as number}, ${s.longitude as number}, ${s.accessType as string}, ${s.discloseExactLocation as boolean}, ${s.accessNotes as string},
                                     ${s.amenities as string[]}, ${s.slotMinutes as number}) RETURNING id`;
      for (const h of hours) await tx`INSERT INTO station_hours (station_id, weekday, opens_at, closes_at) VALUES (${row.id as string}, ${h.weekday}, ${h.opensAt}, ${h.closesAt})`;
      await audit(tx, ctx, 'partner', 'station.created', 'station', row.id as string);
      return row.id as string;
    });
    ctx.status = 201;
    return { ok: true, id };
  }, P);

  r.patch('/api/partner/stations/:id', async (ctx) => {
    const id = uuid(ctx.params.id);
    const b = obj(ctx.body);
    const s = stationInput(b, true);
    const operational = b.operationalStatus !== undefined ? oneOf(b, 'operationalStatus', ['AVAILABLE', 'UNAVAILABLE', 'TEMPORARILY_CLOSED'] as const) : null;
    const hours = b.hours !== undefined ? hoursInput(b) : null;
    const result = await sql.begin(async (tx) => {
      const cur = await ownStation(tx, ctx, id);
      // Changes to identity, location or access of a published listing go back to admin review.
      const material = ['name', 'address', 'latitude', 'longitude', 'accessType', 'discloseExactLocation'].some((k) => s[k] !== undefined);
      const reReview = material && cur.listingStatus === 'APPROVED';
      await tx`UPDATE stations SET
          name = coalesce(${(s.name as string) ?? null}, name), description = coalesce(${(s.description as string) ?? null}, description),
          address = coalesce(${(s.address as string) ?? null}, address), area = coalesce(${(s.area as string) ?? null}, area), city = coalesce(${(s.city as string) ?? null}, city),
          latitude = coalesce(${(s.latitude as number) ?? null}, latitude), longitude = coalesce(${(s.longitude as number) ?? null}, longitude),
          access_type = coalesce(${(s.accessType as string) ?? null}, access_type),
          disclose_exact_location = coalesce(${(s.discloseExactLocation as boolean) ?? null}, disclose_exact_location),
          access_notes = coalesce(${(s.accessNotes as string) ?? null}, access_notes),
          amenities = coalesce(${(s.amenities as string[]) ?? null}, amenities),
          slot_minutes = coalesce(${(s.slotMinutes as number) ?? null}, slot_minutes),
          operational_status = coalesce(${operational}, operational_status),
          status_confirmed_at = CASE WHEN ${operational !== null} THEN now() ELSE status_confirmed_at END,
          listing_status = CASE WHEN ${reReview} THEN 'SUBMITTED' ELSE listing_status END,
          submitted_at = CASE WHEN ${reReview} THEN now() ELSE submitted_at END,
          updated_at = now()
        WHERE id = ${id}`;
      if (hours) {
        await tx`DELETE FROM station_hours WHERE station_id = ${id}`;
        for (const h of hours) await tx`INSERT INTO station_hours (station_id, weekday, opens_at, closes_at) VALUES (${id}, ${h.weekday}, ${h.opensAt}, ${h.closesAt})`;
      }
      await audit(tx, ctx, 'partner', 'station.updated', 'station', id, { fields: Object.keys(b), reReview });
      return { reReview };
    });
    return { ok: true, ...result };
  }, P);

  r.post('/api/partner/stations/:id/submit', async (ctx) => {
    const id = uuid(ctx.params.id);
    await sql.begin(async (tx) => {
      const s = await ownStation(tx, ctx, id);
      if (!['DRAFT', 'REJECTED'].includes(s.listingStatus as string)) throw conflict(`A ${String(s.listingStatus).toLowerCase()} listing cannot be submitted.`, 'INVALID_STATE');
      const [{ c }] = await tx`SELECT count(*)::int AS c FROM connectors WHERE station_id = ${id}`;
      const [{ h }] = await tx`SELECT count(*)::int AS h FROM station_hours WHERE station_id = ${id}`;
      if (!c) throw badRequest('Add at least one connector before submitting.');
      if (!h) throw badRequest('Set operating hours before submitting.');
      await tx`UPDATE stations SET listing_status = 'SUBMITTED', submitted_at = now(), review_note = NULL, updated_at = now() WHERE id = ${id}`;
      await audit(tx, ctx, 'partner', 'station.submitted', 'station', id);
      const admins = await tx`SELECT user_id FROM user_roles WHERE role = 'admin'`;
      for (const a of admins) await notify(tx, a.userId as string, 'admin_queue', 'Station submitted for review', 'A station listing is waiting for review.', '/admin/stations');
    });
    return { ok: true, listingStatus: 'SUBMITTED' };
  }, P);

  // photos (stored locally under STORAGE_DIR; swap for private object storage + moderation in production)
  r.post('/api/partner/stations/:id/photos', async (ctx) => {
    const id = uuid(ctx.params.id);
    await ownStation(sql, ctx, id);
    const dataUrl = str(obj(ctx.body), 'dataUrl', { max: 3_000_000, label: 'Photo' });
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw badRequest('Upload a PNG, JPEG or WebP image.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 2 * 1024 * 1024) throw badRequest('Photos must be 2 MB or smaller.');
    const magic = { png: [0x89, 0x50], jpeg: [0xff, 0xd8], webp: [0x52, 0x49] }[m[1] as 'png' | 'jpeg' | 'webp'];
    if (buf[0] !== magic[0] || buf[1] !== magic[1]) throw badRequest('The file content does not match its image type.');
    const [{ n }] = await sql`SELECT cardinality(photo_paths) AS n FROM stations WHERE id = ${id}`;
    if ((n as number) >= 6) throw badRequest('A station can have up to 6 photos.');
    const name = `${randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    await mkdir(path.join(config.storageDir, 'photos'), { recursive: true });
    await writeFile(path.join(config.storageDir, 'photos', name), buf);
    const url = `/media/photos/${name}`;
    await sql`UPDATE stations SET photo_paths = array_append(photo_paths, ${url}), updated_at = now() WHERE id = ${id}`;
    ctx.status = 201;
    return { ok: true, url };
  }, { ...P, bodyLimit: 3_200_000 });

  r.delete('/api/partner/stations/:id/photos', async (ctx) => {
    const id = uuid(ctx.params.id);
    await ownStation(sql, ctx, id);
    const url = str(obj(ctx.body), 'url', { max: 200 });
    const [s] = await sql`UPDATE stations SET photo_paths = array_remove(photo_paths, ${url}), updated_at = now() WHERE id = ${id} AND ${url} = ANY(photo_paths) RETURNING id`;
    if (!s) throw notFound('Photo');
    await unlink(path.join(config.storageDir, 'photos', path.basename(url))).catch(() => {});
    return { ok: true };
  }, P);

  // connectors and pricing
  r.post('/api/partner/stations/:id/connectors', async (ctx) => {
    const id = uuid(ctx.params.id);
    const c = connectorInput(obj(ctx.body), false);
    const cid = await sql.begin(async (tx) => {
      await ownStation(tx, ctx, id);
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM connectors WHERE station_id = ${id}`;
      if ((n as number) >= 12) throw badRequest('A station can have up to 12 connectors.');
      const [row] = await tx`INSERT INTO connectors (station_id, label, standard, current_type, max_power_kw, price_per_kwh_paise)
                             VALUES (${id}, ${c.label as string}, ${c.standard as string}, ${c.currentType as string}, ${c.maxPowerKw as number}, ${c.pricePerKwhPaise as number}) RETURNING id`;
      await tx`INSERT INTO pricing_history (connector_id, price_per_kwh_paise, changed_by) VALUES (${row.id as string}, ${c.pricePerKwhPaise as number}, ${ctx.user!.id})`;
      await audit(tx, ctx, 'partner', 'connector.created', 'connector', row.id as string, c);
      return row.id as string;
    });
    ctx.status = 201;
    return { ok: true, id: cid };
  }, P);

  r.patch('/api/partner/connectors/:id', async (ctx) => {
    const id = uuid(ctx.params.id);
    const c = connectorInput(obj(ctx.body), true);
    await sql.begin(async (tx) => {
      const [cur] = await tx`SELECT station_id, standard, current_type, price_per_kwh_paise FROM connectors WHERE id = ${id} FOR UPDATE`;
      if (!cur) throw notFound('Connector');
      await ownStation(tx, ctx, cur.stationId as string);
      const std = (c.standard as string) ?? cur.standard;
      const curr = (c.currentType as string) ?? cur.currentType;
      connectorInput({ standard: std, currentType: curr }, true);
      await tx`UPDATE connectors SET label = coalesce(${(c.label as string) ?? null}, label), standard = ${std}, current_type = ${curr},
                 max_power_kw = coalesce(${(c.maxPowerKw as number) ?? null}, max_power_kw),
                 price_per_kwh_paise = coalesce(${(c.pricePerKwhPaise as number) ?? null}, price_per_kwh_paise),
                 status = coalesce(${(c.status as string) ?? null}, status), updated_at = now()
               WHERE id = ${id}`;
      // Existing bookings keep their quoted price (snapshot on the booking); only new bookings use the new rate.
      if (c.pricePerKwhPaise !== undefined && c.pricePerKwhPaise !== cur.pricePerKwhPaise)
        await tx`INSERT INTO pricing_history (connector_id, price_per_kwh_paise, changed_by) VALUES (${id}, ${c.pricePerKwhPaise as number}, ${ctx.user!.id})`;
      if (c.status !== undefined) await tx`UPDATE stations SET status_confirmed_at = now() WHERE id = ${cur.stationId as string}`;
      await audit(tx, ctx, 'partner', 'connector.updated', 'connector', id, c);
    });
    return { ok: true };
  }, P);

  r.delete('/api/partner/connectors/:id', async (ctx) => {
    const id = uuid(ctx.params.id);
    await sql.begin(async (tx) => {
      const [cur] = await tx`SELECT station_id FROM connectors WHERE id = ${id} FOR UPDATE`;
      if (!cur) throw notFound('Connector');
      await ownStation(tx, ctx, cur.stationId as string);
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM bookings WHERE connector_id = ${id}`;
      if (n) throw conflict('This connector has booking history. Mark it out of service instead of deleting it.', 'HAS_BOOKINGS');
      await tx`DELETE FROM connectors WHERE id = ${id}`;
      await audit(tx, ctx, 'partner', 'connector.deleted', 'connector', id);
    });
    return { ok: true };
  }, P);

  r.post('/api/partner/stations/:id/blocks', async (ctx) => {
    const id = uuid(ctx.params.id);
    const b = obj(ctx.body);
    const startsAt = new Date(String(b.startsAt || ''));
    const endsAt = new Date(String(b.endsAt || ''));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw badRequest('Provide a valid start and end time.');
    const connectorId = b.connectorId ? uuid(b.connectorId, 'connectorId') : null;
    const reason = str(b, 'reason', { optional: true, max: 120 });
    await ownStation(sql, ctx, id);
    const clash = await sql`SELECT code FROM bookings WHERE station_id = ${id} AND status IN ('RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS')
                            ${connectorId ? sql`AND connector_id = ${connectorId}` : sql``} AND starts_at < ${endsAt} AND ends_at > ${startsAt}`;
    if (clash.length) throw conflict(`This window overlaps ${clash.length} active booking(s). Cancel or move them first.`, 'BOOKINGS_IN_WINDOW', { codes: clash.map((c) => c.code) });
    const [row] = await sql`INSERT INTO availability_blocks (station_id, connector_id, starts_at, ends_at, reason, created_by) VALUES (${id}, ${connectorId}, ${startsAt}, ${endsAt}, ${reason}, ${ctx.user!.id}) RETURNING id`;
    ctx.status = 201;
    return { ok: true, id: row.id };
  }, P);

  // ---------------------------------------------------------------- bookings at own stations
  r.get('/api/partner/bookings', async (ctx) => {
    const from = ctx.query.get('from') ? new Date(String(ctx.query.get('from'))) : new Date(Date.now() - 30 * 864e5);
    const to = ctx.query.get('to') ? new Date(String(ctx.query.get('to'))) : new Date(Date.now() + 60 * 864e5);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Invalid date range.');
    const stationId = ctx.query.get('stationId') ? uuid(ctx.query.get('stationId'), 'stationId') : null;
    const rows = await sql`
      SELECT b.id, b.code, b.status, b.payment_state, b.starts_at, b.ends_at, b.planned_kwh::float8 AS planned_kwh, b.base_paise,
             b.provider_commission_paise, b.partner_amount_paise, s.id AS station_id, s.name AS station_name, c.label AS connector_label, c.standard,
             split_part(u.full_name, ' ', 1) AS driver_first_name, cs.energy_kwh::float8 AS energy_kwh
      FROM bookings b JOIN stations s ON s.id = b.station_id JOIN connectors c ON c.id = b.connector_id JOIN users u ON u.id = b.driver_id
      LEFT JOIN charging_sessions cs ON cs.booking_id = b.id
      WHERE s.partner_id = ${ctx.user!.partnerId!} AND b.starts_at >= ${from} AND b.starts_at < ${to}
      ${stationId ? sql`AND s.id = ${stationId}` : sql``}
      AND b.status NOT IN ('EXPIRED', 'PAYMENT_FAILED')
      ORDER BY b.starts_at`;
    return { bookings: rows };
  }, P);

  r.post('/api/partner/bookings/:id/:action', async (ctx) => {
    const id = uuid(ctx.params.id);
    const action = oneOf({ a: ctx.params.action }, 'a', ['check-in', 'start', 'complete', 'cancel', 'no-show'] as const, { label: 'action' });
    const b = obj(ctx.body);
    const out = await sql.begin(async (tx) => {
      const bk = await lockBooking(tx, id);
      if (!bk) throw notFound('Booking');
      if (bk.partnerId !== ctx.user!.partnerId) {
        await audit(sql, ctx, 'partner', 'ownership.denied', 'booking', id); // outside the transaction so it survives the rollback
        throw forbidden('This booking belongs to another partner.', 'OWNERSHIP_REQUIRED');
      }
      const actor = { userId: ctx.user!.id, role: 'partner' as const };
      if (action === 'check-in') {
        const code = str(b, 'code', { max: 12, label: 'Booking code' }).toUpperCase();
        if (code !== bk.code) throw badRequest('The booking code does not match.', { field: 'code' });
        if (Date.now() < new Date(bk.startsAt).getTime() - 30 * 60_000) throw conflict('Check-in opens 30 minutes before the booked time.', 'TOO_EARLY');
        await transition(tx, bk, 'CHECKED_IN', actor, 'Driver arrival verified with booking code');
        await notify(tx, bk.driverId, 'checked_in', 'Checked in', `You are checked in at ${bk.stationName}.`, `/bookings/${bk.id}`);
      } else if (action === 'start') {
        await transition(tx, bk, 'IN_PROGRESS', actor, 'Host started charging (manual charger)');
        await tx`INSERT INTO charging_sessions (booking_id, recorded_by) VALUES (${bk.id}, ${ctx.user!.id})`;
      } else if (action === 'complete') {
        const energy = num(b, 'energyKwh', { min: 0, max: 500, label: 'Delivered energy (kWh)' });
        await tx`UPDATE charging_sessions SET ended_at = now(), energy_kwh = ${energy}, source = 'HOST_ENTERED', recorded_by = ${ctx.user!.id} WHERE booking_id = ${bk.id}`;
        await transition(tx, bk, 'COMPLETED', actor, `Session ended; ${energy} kWh recorded by host`);
        // Charge for delivered energy only (capped at the prepaid amount); refund the unused part.
        if (energy < bk.plannedKwh) {
          const usedBase = Math.round(bk.ratePaise * energy);
          const baseRefund = bk.basePaise - usedBase;
          const feeRefund = bk.customerFeePaise - Math.round((usedBase * bk.feeBps) / 10000);
          if (baseRefund + feeRefund > 0) await refundBooking(tx, bk, baseRefund, feeRefund, `Unused energy: ${(bk.plannedKwh - energy).toFixed(2)} kWh`, ctx.user!.id);
        }
        await notify(tx, bk.driverId, 'completed', 'Charging session completed', `${energy} kWh recorded at ${bk.stationName}. Your receipt is ready.`, `/bookings/${bk.id}`);
      } else if (action === 'cancel') {
        const reason = str(b, 'reason', { min: 3, max: 200, label: 'Reason' });
        await transition(tx, bk, 'CANCELLED_PARTNER', actor, reason, { cancellationReason: reason });
        await tx`UPDATE payment_orders SET status = 'EXPIRED', updated_at = now() WHERE booking_id = ${bk.id} AND status = 'CREATED'`;
        if (bk.paymentState === 'PAID' || bk.paymentState === 'PARTIALLY_REFUNDED') await refundRemaining(tx, bk, 'Cancelled by station partner', ctx.user!.id);
        await notify(tx, bk.driverId, 'cancelled_by_host', 'Booking cancelled by the station', `${bk.stationName} cancelled booking ${bk.code}: ${reason}. Any payment is refunded in full.`, `/bookings/${bk.id}`);
      } else if (action === 'no-show') {
        if (Date.now() < new Date(bk.startsAt).getTime() + 30 * 60_000) throw conflict('A no-show can be recorded 30 minutes after the booked start.', 'TOO_EARLY');
        await transition(tx, bk, 'NO_SHOW', actor, 'Driver did not arrive');
      }
      await audit(tx, ctx, 'partner', `booking.${action}`, 'booking', id);
      return bk.status;
    });
    return { ok: true, status: out };
  }, P);

  r.get('/api/partner/bookings/:id', async (ctx) => {
    return { booking: await bookingView(uuid(ctx.params.id), { id: ctx.user!.id, isAdmin: false, partnerId: ctx.user!.partnerId }) };
  }, P);

  // ---------------------------------------------------------------- revenue and statements
  r.get('/api/partner/revenue', async (ctx) => {
    const rev = await revenue(ctx.user!.partnerId!);
    const payouts = await sql`SELECT id, period_start, period_end, amount_paise::int AS amount_paise, booking_count, status, created_at FROM payouts WHERE partner_id = ${ctx.user!.partnerId!} ORDER BY created_at DESC`;
    return { ...rev, payouts, note: 'Payout amounts are records only. No transfer happens until a payout provider is connected.' };
  }, P);

  r.get('/api/partner/statement', async (ctx) => {
    const rows = await sql`
      SELECT le.created_at, le.kind, le.account, le.debit_paise::int AS debit_paise, le.credit_paise::int AS credit_paise, le.memo, b.code AS booking_code
      FROM ledger_entries le LEFT JOIN bookings b ON b.id = le.booking_id
      WHERE le.partner_id = ${ctx.user!.partnerId!} AND le.account = 'partner_payable'
      ORDER BY le.created_at DESC LIMIT 200`;
    return { entries: rows };
  }, P);
}

/** Revenue figures from the ledger (only verified, captured money counts; refunds are reversed explicitly). */
export async function revenue(partnerId: string) {
  const [sum] = await sql`
    SELECT coalesce(sum(credit_paise - debit_paise) FILTER (WHERE account = 'partner_payable'), 0)::int AS partner_net,
           coalesce(sum(credit_paise - debit_paise) FILTER (WHERE account = 'platform_commission'), 0)::int AS commission,
           coalesce(sum(credit_paise - debit_paise) FILTER (WHERE account = 'platform_service_fee'), 0)::int AS customer_fees
    FROM ledger_entries WHERE partner_id = ${partnerId}`;
  const [split] = await sql`
    SELECT coalesce(sum(le.credit_paise - le.debit_paise) FILTER (WHERE b.status = 'COMPLETED'), 0)::int AS earned,
           coalesce(sum(le.credit_paise - le.debit_paise) FILTER (WHERE b.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS')), 0)::int AS pending_sessions
    FROM ledger_entries le JOIN bookings b ON b.id = le.booking_id WHERE le.partner_id = ${partnerId} AND le.account = 'partner_payable'`;
  const [{ paidOut }] = await sql`SELECT coalesce(sum(amount_paise), 0)::int AS paid_out FROM payouts WHERE partner_id = ${partnerId}`;
  const perBooking = await sql`
    SELECT b.id, b.code, b.status, b.starts_at, s.name AS station_name, b.base_paise, b.provider_commission_paise, b.partner_amount_paise,
           coalesce((SELECT sum(credit_paise - debit_paise) FROM ledger_entries le WHERE le.booking_id = b.id AND le.account = 'partner_payable'), 0)::int AS partner_net_paise,
           coalesce((SELECT sum(amount_paise) FROM refunds r WHERE r.booking_id = b.id AND r.status = 'PROCESSED'), 0)::int AS refunded_paise
    FROM bookings b JOIN stations s ON s.id = b.station_id
    WHERE s.partner_id = ${partnerId} AND b.payment_state <> 'UNPAID' AND b.payment_state <> 'PENDING' AND b.payment_state <> 'FAILED'
    ORDER BY b.starts_at DESC LIMIT 100`;
  const grossBase = (sum.partnerNet as number) + (sum.commission as number);
  return {
    summary: {
      grossBasePaise: grossBase,
      commissionPaise: sum.commission as number,
      partnerNetPaise: sum.partnerNet as number,
      earnedCompletedPaise: split.earned as number,
      pendingSessionsPaise: split.pendingSessions as number,
      expectedPayoutPaise: (split.earned as number) - (paidOut as number),
      customerFeesPaise: sum.customerFees as number,
    },
    bookings: perBooking,
  };
}
