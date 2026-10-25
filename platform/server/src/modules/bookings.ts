// Driver bookings and payments: holds, test checkout, signed webhooks, cancellation, receipts.
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { sql } from '../db';
import { providerFor, signTestEvent } from '../adapters/payments';
import { audit } from '../lib/auth';
import { ACTIVE, applyPaymentEvent, createPaymentOrder, expireHolds, lockBooking, refundRemaining, transition } from '../lib/bookingFlow';
import { evaluate } from '../lib/compat';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { computeQuote } from '../lib/money';
import type { Ctx, Router } from '../lib/http';
import { getSettings } from '../lib/settings';
import { exposure, hoursFor, type StationRow } from '../lib/stationData';
import { closeMinutes, istParts, toMinutes } from '../lib/time';
import { num, obj, oneOf, uuid } from '../lib/validate';
import { requireVerified } from './auth';
import { vehicleSpec } from './stations';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => 'GP-' + Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

async function bookingView(id: string, viewer: { id: string; isAdmin: boolean; partnerId: string | null }) {
  const [b] = await sql`
    SELECT b.id, b.code, b.driver_id, b.station_id, b.connector_id, b.vehicle_id, b.starts_at, b.ends_at, b.status, b.hold_expires_at,
           b.planned_kwh::float8 AS planned_kwh, b.rate_paise, b.fee_bps, b.commission_bps, b.base_paise, b.customer_fee_paise,
           b.customer_total_paise, b.provider_commission_paise, b.partner_amount_paise, b.payment_state, b.cancellation_reason,
           b.cancelled_at, b.completed_at, b.created_at,
           s.name AS station_name, s.area, s.city, s.address, s.access_type, s.access_notes, s.disclose_exact_location,
           s.latitude::float8 AS latitude, s.longitude::float8 AS longitude, s.partner_id, s.is_demo, p.business_name,
           c.label AS connector_label, c.standard, c.current_type, c.max_power_kw::float8 AS max_power_kw,
           u.full_name AS driver_name, uv.nickname AS vehicle_nickname,
           cs.energy_kwh::float8 AS energy_kwh, cs.started_at AS session_started_at, cs.ended_at AS session_ended_at, cs.source AS energy_source
    FROM bookings b
    JOIN stations s ON s.id = b.station_id JOIN partners p ON p.id = s.partner_id
    JOIN connectors c ON c.id = b.connector_id JOIN users u ON u.id = b.driver_id
    LEFT JOIN user_vehicles uv ON uv.id = b.vehicle_id
    LEFT JOIN charging_sessions cs ON cs.booking_id = b.id
    WHERE b.id = ${id}`;
  if (!b) throw notFound('Booking');
  const isDriver = b.driverId === viewer.id;
  const isPartner = !!viewer.partnerId && b.partnerId === viewer.partnerId;
  if (!isDriver && !isPartner && !viewer.isAdmin) throw forbidden('You cannot view this booking.', 'OWNERSHIP_REQUIRED');
  const [events, payments, refunds] = await Promise.all([
    sql`SELECT actor_role, from_status, to_status, note, created_at FROM booking_events WHERE booking_id = ${id} ORDER BY created_at`,
    sql`SELECT id, provider, provider_order_ref, amount_paise, refunded_paise, status, method_hint, failure_reason, created_at, paid_at FROM payment_orders WHERE booking_id = ${id} ORDER BY created_at`,
    sql`SELECT id, amount_paise, base_part_paise, fee_part_paise, reason, status, created_at FROM refunds WHERE booking_id = ${id} ORDER BY created_at`,
  ]);
  const confirmed = ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].includes(b.status as string);
  const ex = exposure(b as unknown as StationRow & { businessName: string });
  // Exact address and access notes for private/home chargers only for the confirmed driver, the station's partner or admin.
  const reveal = ex.exactLocation || isPartner || viewer.isAdmin || (isDriver && confirmed);
  return {
    id: b.id,
    code: isDriver || isPartner || viewer.isAdmin ? b.code : null,
    status: b.status,
    paymentState: b.paymentState,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    holdExpiresAt: b.holdExpiresAt,
    plannedKwh: b.plannedKwh,
    station: {
      id: b.stationId,
      name: b.stationName,
      area: b.area,
      city: b.city,
      accessType: b.accessType,
      isDemo: b.isDemo,
      operator: ex.operator,
      address: reveal ? b.address : ex.address,
      accessNotes: reveal ? b.accessNotes : null,
      location: reveal ? { latitude: b.latitude, longitude: b.longitude } : ex.location,
      directionsUrl: reveal ? `https://www.google.com/maps/dir/?api=1&destination=${b.latitude},${b.longitude}` : null,
    },
    connector: { id: b.connectorId, label: b.connectorLabel, standard: b.standard, currentType: b.currentType, maxPowerKw: b.maxPowerKw },
    driver: isPartner || viewer.isAdmin ? { firstName: String(b.driverName).split(' ')[0], vehicle: b.vehicleNickname } : undefined,
    vehicle: isDriver ? { id: b.vehicleId, nickname: b.vehicleNickname } : undefined,
    pricing: {
      ratePaise: b.ratePaise,
      basePaise: b.basePaise,
      feeBps: b.feeBps,
      customerFeePaise: b.customerFeePaise,
      customerTotalPaise: b.customerTotalPaise,
      // the partner sees its own deduction and payout; the driver sees what they pay
      ...(isPartner || viewer.isAdmin ? { commissionBps: b.commissionBps, providerCommissionPaise: b.providerCommissionPaise, partnerAmountPaise: b.partnerAmountPaise, platformRevenuePaise: (b.customerFeePaise as number) + (b.providerCommissionPaise as number) } : {}),
    },
    session: b.sessionStartedAt ? { startedAt: b.sessionStartedAt, endedAt: b.sessionEndedAt, energyKwh: b.energyKwh, source: b.energySource } : null,
    cancellationReason: b.cancellationReason,
    events,
    payments: isDriver || viewer.isAdmin ? payments : payments.map((p) => ({ status: p.status, amountPaise: p.amountPaise, refundedPaise: p.refundedPaise, paidAt: p.paidAt })),
    refunds,
    createdAt: b.createdAt,
  };
}

export function bookingRoutes(r: Router) {
  r.post(
    '/api/bookings',
    async (ctx) => {
      await requireVerified(ctx);
      const user = ctx.user!;
      const idemKey = String(ctx.req.headers['idempotency-key'] || '');
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(idemKey)) throw badRequest('An Idempotency-Key header (8–80 characters) is required.');
      const b = obj(ctx.body);
      const reqHash = createHash('sha256').update(JSON.stringify(b)).digest('hex');
      const [prev] = await sql`SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = ${user.id} AND scope = 'booking' AND key = ${idemKey}`;
      if (prev) {
        if (prev.requestHash !== reqHash) throw new ApiError(422, 'IDEMPOTENCY_MISMATCH', 'This Idempotency-Key was already used with different details.');
        if (prev.responseStatus) {
          ctx.status = prev.responseStatus as number;
          return { ...(prev.responseBody as object), idempotentReplay: true };
        }
        throw conflict('The same booking request is still being processed.', 'REQUEST_IN_PROGRESS');
      }
      await sql`INSERT INTO idempotency_keys (user_id, scope, key, request_hash) VALUES (${user.id}, 'booking', ${idemKey}, ${reqHash}) ON CONFLICT DO NOTHING`;

      try {
        const stationId = uuid(b.stationId, 'stationId');
        const connectorId = uuid(b.connectorId, 'connectorId');
        const startsAt = new Date(String(b.startsAt || ''));
        if (Number.isNaN(startsAt.getTime())) throw badRequest('startsAt must be an ISO date-time.', { field: 'startsAt' });
        const durationMinutes = num(b, 'durationMinutes', { min: 15, max: 240, int: true, label: 'Duration' });
        const plannedKwh = num(b, 'plannedKwh', { min: 0.5, max: 200, label: 'Planned energy' });
        const vehicleId = b.vehicleId ? uuid(b.vehicleId, 'vehicleId') : null;
        const methodHint = oneOf(b, 'paymentMethod', ['upi', 'card', 'netbanking', 'wallet'] as const, { optional: true }) || null;
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
        const vehicle = vehicleId ? await vehicleSpec(sql, user.id, vehicleId) : null;
        const settings = await getSettings(sql);

        const booking = await sql.begin(async (tx) => {
          // Lock the connector row: concurrent holds for the same connector are serialised here, and the
          // bookings_no_overlap exclusion constraint is the final guarantee against double-booking.
          const [c] = await tx`SELECT c.id, c.station_id, c.standard, c.current_type, c.max_power_kw::float8 AS max_power_kw, c.price_per_kwh_paise, c.status,
                                      s.listing_status, s.operational_status, s.slot_minutes, s.partner_id, s.name AS station_name, p.status AS partner_status, p.owner_user_id
                               FROM connectors c JOIN stations s ON s.id = c.station_id JOIN partners p ON p.id = s.partner_id
                               WHERE c.id = ${connectorId} AND c.station_id = ${stationId} FOR UPDATE OF c`;
          if (!c || c.listingStatus !== 'APPROVED' || c.partnerStatus !== 'APPROVED') throw notFound('Station connector');
          if (c.partnerId === user.partnerId) throw forbidden('Partners cannot book their own stations.', 'OWN_STATION');
          if (c.operationalStatus !== 'AVAILABLE' || c.status !== 'AVAILABLE') throw conflict('This charger is not accepting bookings right now.', 'STATION_UNAVAILABLE');
          if (vehicle) {
            const compat = evaluate(vehicle, { standard: c.standard as string, currentType: c.currentType as 'AC' | 'DC', maxPowerKw: c.maxPowerKw as number, status: c.status as string });
            if (compat.state === 'INCOMPATIBLE') throw conflict(compat.reasons[0], 'INCOMPATIBLE_CONNECTOR');
          }
          const slot = c.slotMinutes as number;
          if (durationMinutes % slot !== 0) throw badRequest(`Duration must be a multiple of ${slot} minutes.`, { field: 'durationMinutes' });
          if (startsAt.getTime() < Date.now() + 2 * 60_000) throw badRequest('Choose a start time in the future.', { field: 'startsAt' });
          if (startsAt.getTime() > Date.now() + 60 * 864e5) throw badRequest('Bookings can be made up to 60 days ahead.', { field: 'startsAt' });
          const st = istParts(startsAt);
          const en = istParts(new Date(endsAt.getTime() - 1));
          const [h] = await hoursFor(tx, [stationId]).then((hs) => hs.filter((x) => x.weekday === st.weekday));
          if (!h || st.date !== en.date || st.minutes < toMinutes(h.opensAt) || en.minutes + 1 > closeMinutes(h.closesAt) || (st.minutes - toMinutes(h.opensAt)) % slot !== 0)
            throw badRequest('That time is outside the station’s bookable hours or slot grid.', { field: 'startsAt' });
          const blocks = await tx`SELECT 1 FROM availability_blocks WHERE station_id = ${stationId} AND (connector_id IS NULL OR connector_id = ${connectorId}) AND starts_at < ${endsAt} AND ends_at > ${startsAt}`;
          if (blocks.length) throw conflict('The host has blocked this time.', 'SLOT_UNAVAILABLE');

          await expireHolds(tx, connectorId);
          const quote = computeQuote(c.pricePerKwhPaise as number, plannedKwh, settings.customerFeeBps, settings.providerCommissionBps);
          let row;
          try {
            [row] = await tx`
              INSERT INTO bookings (code, driver_id, station_id, connector_id, vehicle_id, starts_at, ends_at, status, hold_expires_at, planned_kwh,
                                    rate_paise, fee_bps, commission_bps, base_paise, customer_fee_paise, customer_total_paise,
                                    provider_commission_paise, partner_amount_paise, quote)
              VALUES (${newCode()}, ${user.id}, ${stationId}, ${connectorId}, ${vehicleId}, ${startsAt}, ${endsAt}, 'RESERVED',
                      now() + make_interval(mins => ${settings.holdMinutes}), ${plannedKwh},
                      ${quote.ratePaise}, ${quote.feeBps}, ${quote.commissionBps}, ${quote.basePaise}, ${quote.customerFeePaise}, ${quote.customerTotalPaise},
                      ${quote.providerCommissionPaise}, ${quote.partnerAmountPaise}, ${tx.json({ ...quote, quotedAt: new Date().toISOString() })})
              RETURNING id, code, customer_total_paise`;
          } catch (e) {
            if ((e as { code?: string }).code === '23P01') throw conflict('Sorry, that slot was just taken. Please choose another time.', 'SLOT_UNAVAILABLE');
            throw e;
          }
          await tx`INSERT INTO booking_events (booking_id, actor_user_id, actor_role, to_status, note) VALUES (${row.id as string}, ${user.id}, 'driver', 'RESERVED', 'Slot held pending payment')`;
          return row;
        });

        const order = await createPaymentOrder(booking.id as string, user.id, booking.customerTotalPaise as number, booking.code as string, methodHint, idemKey);
        const view = await bookingView(booking.id as string, { id: user.id, isAdmin: false, partnerId: user.partnerId });
        const body = {
          booking: view,
          paymentOrder: order,
          checkout: order.provider === 'test' ? { mode: 'TEST', note: 'Test payment mode: no real money is collected. Choose a simulated outcome.' } : { mode: 'LIVE' },
        };
        ctx.status = 201;
        await sql`UPDATE idempotency_keys SET response_status = 201, response_body = ${sql.json(body as never)} WHERE user_id = ${user.id} AND scope = 'booking' AND key = ${idemKey}`;
        return body;
      } catch (e) {
        // failed attempts may be retried with the same key
        await sql`DELETE FROM idempotency_keys WHERE user_id = ${user.id} AND scope = 'booking' AND key = ${idemKey} AND response_status IS NULL`;
        throw e;
      }
    },
    { rateLimit: { key: 'booking', max: 40, perSeconds: 300 } },
  );

  r.get('/api/bookings', async (ctx) => {
    const scope = ctx.query.get('scope') || 'all';
    const rows = await sql`
      SELECT b.id, b.code, b.status, b.payment_state, b.starts_at, b.ends_at, b.customer_total_paise, b.planned_kwh::float8 AS planned_kwh, b.hold_expires_at,
             s.id AS station_id, s.name AS station_name, s.area, s.is_demo, c.label AS connector_label, c.standard, c.current_type
      FROM bookings b JOIN stations s ON s.id = b.station_id JOIN connectors c ON c.id = b.connector_id
      WHERE b.driver_id = ${ctx.user!.id}
      ${scope === 'upcoming' ? sql`AND b.status = ANY(${ACTIVE}) AND b.ends_at > now()` : scope === 'past' ? sql`AND NOT (b.status = ANY(${ACTIVE}) AND b.ends_at > now())` : sql``}
      ORDER BY b.starts_at DESC LIMIT 100`;
    return { bookings: rows };
  });

  r.get('/api/bookings/:id', async (ctx) => {
    const u = ctx.user!;
    return { booking: await bookingView(uuid(ctx.params.id), { id: u.id, isAdmin: u.roles.includes('admin'), partnerId: u.partnerStatus === 'APPROVED' ? u.partnerId : null }) };
  });

  r.post('/api/bookings/:id/cancel', async (ctx) => {
    const id = uuid(ctx.params.id);
    const user = ctx.user!;
    const reason = typeof (ctx.body as { reason?: unknown })?.reason === 'string' ? String((ctx.body as { reason: string }).reason).slice(0, 200) : 'Cancelled by driver';
    const settings = await getSettings(sql);
    const result = await sql.begin(async (tx) => {
      const b = await lockBooking(tx, id);
      if (!b) throw notFound('Booking');
      if (b.driverId !== user.id) throw forbidden('You can only cancel your own bookings.', 'OWNERSHIP_REQUIRED');
      if (b.status === 'CONFIRMED' && new Date(b.startsAt).getTime() - Date.now() < settings.cancellationCutoffMinutes * 60_000)
        throw conflict(`Bookings can be cancelled up to ${settings.cancellationCutoffMinutes} minutes before the start. Contact support for help.`, 'CANCELLATION_WINDOW_PASSED');
      await transition(tx, b, 'CANCELLED_DRIVER', { userId: user.id, role: 'driver' }, reason, { cancellationReason: reason });
      await tx`UPDATE payment_orders SET status = 'EXPIRED', updated_at = now() WHERE booking_id = ${b.id} AND status = 'CREATED'`;
      const refund = b.paymentState === 'PAID' || b.paymentState === 'PARTIALLY_REFUNDED' ? await refundRemaining(tx, b, 'Cancelled by driver', user.id) : null;
      return { status: b.status, refund };
    });
    return { ok: true, ...result, slotReleased: true };
  });

  r.get('/api/bookings/:id/receipt', async (ctx) => {
    const v = await bookingView(uuid(ctx.params.id), { id: ctx.user!.id, isAdmin: ctx.user!.roles.includes('admin'), partnerId: null });
    const paid = (v.payments as { status: string }[]).some((p) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status));
    if (!paid) throw conflict('A receipt is available after payment.', 'NOT_PAID');
    const refunded = (v.refunds as unknown as { amountPaise: number; status: string }[]).filter((x) => x.status === 'PROCESSED').reduce((a, x) => a + x.amountPaise, 0);
    return {
      receipt: {
        number: `RCPT-${v.code}`,
        issuedAt: new Date().toISOString(),
        booking: { id: v.id, code: v.code, status: v.status, startsAt: v.startsAt, endsAt: v.endsAt },
        station: v.station.name,
        connector: v.connector,
        lines: [
          { label: `Charging energy (${v.plannedKwh} kWh × ₹${(v.pricing.ratePaise as number) / 100}/kWh, booked)`, amountPaise: v.pricing.basePaise },
          { label: `Service fee (${(v.pricing.feeBps as number) / 100}%)`, amountPaise: v.pricing.customerFeePaise },
        ],
        totalPaidPaise: v.pricing.customerTotalPaise,
        refundedPaise: refunded,
        netPaise: (v.pricing.customerTotalPaise as number) - refunded,
        taxNote: 'Taxes are not included in this demo receipt; tax treatment depends on the final business and invoicing setup.',
        testMode: (v.payments as { provider?: string }[]).some((p) => p.provider === 'test'),
      },
    };
  });

  // ---- payments
  r.get('/api/payments/transactions', async (ctx) => {
    const orders = await sql`
      SELECT o.id, o.provider, o.provider_order_ref, o.amount_paise, o.refunded_paise, o.status, o.method_hint, o.failure_reason, o.created_at, o.paid_at,
             b.id AS booking_id, b.code, s.name AS station_name
      FROM payment_orders o JOIN bookings b ON b.id = o.booking_id JOIN stations s ON s.id = b.station_id
      WHERE o.user_id = ${ctx.user!.id} ORDER BY o.created_at DESC LIMIT 100`;
    const refunds = await sql`SELECT r.id, r.booking_id, r.amount_paise, r.reason, r.status, r.created_at FROM refunds r JOIN bookings b ON b.id = r.booking_id
                              WHERE b.driver_id = ${ctx.user!.id} ORDER BY r.created_at DESC LIMIT 100`;
    return { orders, refunds };
  });

  /**
   * TEST checkout (demo mode only). Plays the role of the payment gateway: it produces a provider event signed
   * with the webhook secret and delivers it to the public webhook endpoint over HTTP. The booking changes only
   * when that webhook is verified and processed; this endpoint itself never marks anything paid.
   */
  r.post('/api/payments/test-checkout/:orderId', async (ctx) => {
    if (!config.demoMode || config.payments.provider !== 'test') throw new ApiError(404, 'NOT_FOUND', 'Test checkout is not available.');
    const id = uuid(ctx.params.orderId, 'order id');
    const b = obj(ctx.body);
    const outcome = oneOf(b, 'outcome', ['success', 'failure'] as const);
    const deliveries = Number.isInteger(b.deliveries) ? Math.min(3, Math.max(1, b.deliveries as number)) : 1;
    const [o] = await sql`SELECT id, user_id, provider, provider_order_ref, amount_paise, status FROM payment_orders WHERE id = ${id}`;
    if (!o || o.userId !== ctx.user!.id) throw notFound('Payment order');
    if (o.provider !== 'test') throw badRequest('Not a test-mode order.');
    const { body, signature } = signTestEvent(outcome === 'success' ? 'payment.captured' : 'payment.failed', o.providerOrderRef as string, o.amountPaise as number, outcome === 'failure' ? 'Simulated decline (test mode)' : undefined);
    const results = [];
    for (let i = 0; i < deliveries; i++) {
      const res = await fetch(`http://127.0.0.1:${config.port}/api/webhooks/payments/test`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gpev-test-signature': signature }, body });
      results.push(await res.json());
    }
    const [after] = await sql`SELECT o.status AS order_status, b.status AS booking_status, b.id AS booking_id FROM payment_orders o JOIN bookings b ON b.id = o.booking_id WHERE o.id = ${id}`;
    return { testMode: true, deliveries: results, orderStatus: after.orderStatus, bookingStatus: after.bookingStatus, bookingId: after.bookingId };
  });

  // Provider webhooks: signature verified, stored once (unique provider event id), processed idempotently.
  r.post(
    '/api/webhooks/payments/:provider',
    async (ctx) => {
      const provider = providerFor(ctx.params.provider);
      let ev;
      try {
        ev = provider.verifyWebhook(ctx.rawBody, ctx.req.headers as Record<string, string>);
      } catch (e) {
        await audit(sql, ctx, 'payment_provider', 'webhook.rejected', 'payment_webhook', null, { provider: provider.name, reason: (e as Error).message });
        throw e;
      }
      const [ins] = await sql`
        INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, signature_verified, payload, processing_status)
        VALUES (${provider.name}, ${ev.id}, ${ev.type}, true, ${sql.json(JSON.parse(ctx.rawBody.toString('utf8')))}, 'RECEIVED')
        ON CONFLICT (provider, provider_event_id) DO UPDATE SET duplicate_count = payment_webhook_events.duplicate_count + 1
        RETURNING id, (xmax = 0) AS inserted, processing_status`;
      // Replays of an event that was already handled are acknowledged and ignored (at-least-once delivery).
      // An event whose earlier processing errored is processed again.
      if (!ins.inserted && ins.processingStatus !== 'ERROR') return { ok: true, duplicate: true, status: ins.processingStatus };
      try {
        const outcome = await sql.begin((tx) => applyPaymentEvent(tx, ev));
        await sql`UPDATE payment_webhook_events SET processing_status = ${outcome.startsWith('ignored') || outcome.startsWith('unknown') || outcome.startsWith('rejected') ? 'IGNORED' : 'PROCESSED'}, processing_note = ${outcome}, processed_at = now() WHERE id = ${ins.id as string}`;
        return { ok: true, duplicate: false, outcome };
      } catch (e) {
        await sql`UPDATE payment_webhook_events SET processing_status = 'ERROR', processing_note = ${(e as Error).message.slice(0, 300)}, processed_at = now() WHERE id = ${ins.id as string}`;
        throw e;
      }
    },
    { auth: 'public', noCsrf: true, bodyLimit: 64 * 1024 },
  );
}

export { bookingView };
export type { Ctx };
