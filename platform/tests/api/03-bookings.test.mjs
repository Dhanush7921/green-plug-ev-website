// Acceptance 5–9 and 11: search/filters, estimates, slot reservation and conflicts, cancellation,
// commission and fee accounting, payment failure, duplicate webhooks, late payments and refunds.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { admin, approvedPartnerWithStation, BASE, book, Client, db, futureSlot, idem, newDriver, nextSlot, pay } from '../helpers.mjs';

let adm, partner, stationId, dc, ac, d1, d2;
before(async () => {
  adm = await admin();
  ({ client: partner, stationId, connectors: [dc, ac] } = await approvedPartnerWithStation(adm, { stationName: 'Booking Test Hub', area: 'Booking Area' }));
  d1 = await newDriver('Driver One');
  d2 = await newDriver('Driver Two');
});
after(() => db.end());

const ledgerFor = async (bookingId) => [...(await db`SELECT account, sum(debit_paise)::int AS debit, sum(credit_paise)::int AS credit FROM ledger_entries WHERE booking_id = ${bookingId} GROUP BY account ORDER BY account`)].map((r) => ({ ...r }));

describe('search and estimates', () => {
  it('searches and filters published stations', async () => {
    const c = new Client();
    const byName = await c.get('/api/stations?q=Booking%20Test');
    assert.equal(byName.body.count, 1);
    const s = byName.body.stations[0];
    assert.equal(s.id, stationId);
    assert.equal(s.minPricePaise, 1200);
    assert.ok((await c.get('/api/stations?connector=CCS2&current=DC&minKw=50')).body.stations.some((x) => x.id === stationId));
    assert.ok(!(await c.get('/api/stations?connector=CHADEMO')).body.stations.some((x) => x.id === stationId));
    assert.ok(!(await c.get('/api/stations?current=DC&maxPricePaise=1500')).body.stations.some((x) => x.id === stationId), 'DC is ₹18 > ₹15');
    assert.ok((await c.get('/api/stations?current=AC&maxPricePaise=1500')).body.stations.some((x) => x.id === stationId), 'AC is ₹12');
    assert.ok(!(await c.get('/api/stations?access=HOME')).body.stations.some((x) => x.id === stationId));
    const near = await c.get('/api/stations?lat=17.73&lng=83.31&radiusKm=2');
    assert.ok(near.body.stations.some((x) => x.id === stationId));
    assert.ok(near.body.stations.every((x) => x.distanceKm <= 2));
    const seeded = await c.get('/api/stations?q=Visakhapatnam');
    assert.ok(seeded.body.stations.every((x) => x.availabilityConfidence !== 'LIVE_VERIFIED'), 'never claims live status');
  });

  it('calculates the session estimate from the configured per-kWh rate (₹180 example)', async () => {
    const r = await new Client().post(`/api/stations/${stationId}/estimate`, { connectorId: dc, plannedKwh: 10, durationMinutes: 60 });
    assert.equal(r.status, 200);
    const q = r.body.quote;
    assert.equal(q.basePaise, 18000);
    assert.equal(q.customerFeePaise, 2700);
    assert.equal(q.customerTotalPaise, 20700);
    assert.equal(q.providerCommissionPaise, 2700);
    assert.equal(q.partnerAmountPaise, 15300);
    assert.equal(q.platformRevenuePaise, 5400);
    assert.equal(r.body.compatibility.state, 'NEEDS_CONFIRMATION', 'no vehicle → explicit unknown, not compatible');
  });

  it('marks incompatible connectors for a saved vehicle and refuses to book them', async () => {
    const cat = await d1.get('/api/catalog/vehicles');
    const ather = cat.body.variants.find((v) => v.model === '450X');
    const v = await d1.post('/api/me/vehicles', { nickname: 'Scooter', variantId: ather.variantId });
    assert.equal(v.status, 201);
    const det = await d1.get(`/api/stations/${stationId}?vehicleId=${v.body.id}`);
    assert.ok(det.body.station.connectors.every((c) => c.compatibility.state === 'INCOMPATIBLE'));
    const r = await book(d1, stationId, dc, futureSlot(3, '06:00'), { vehicleId: v.body.id });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'INCOMPATIBLE_CONNECTOR');
    await d1.del(`/api/me/vehicles/${v.body.id}`);
  });
});

describe('reservations', () => {
  it('reserves a slot; another customer cannot take the same slot', async () => {
    const t = futureSlot(2, '10:00');
    const a = await book(d1, stationId, dc, t);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.booking.status, 'RESERVED');
    assert.equal(a.body.checkout.mode, 'TEST');
    const b = await book(d2, stationId, dc, t);
    assert.equal(b.status, 409);
    assert.equal(b.body.error.code, 'SLOT_UNAVAILABLE');
    // overlapping (starts 30 minutes into the same hour) is also refused
    const c = await book(d2, stationId, dc, futureSlot(2, '10:30'));
    assert.equal(c.status, 409);
    // a different connector at the same time is fine
    const other = await book(d2, stationId, ac, t);
    assert.equal(other.status, 201);
    const avail = await new Client().get(`/api/stations/${stationId}/availability?date=${t.slice(0, 10)}&durationMinutes=60`);
    assert.ok(avail.body.connectors.find((x) => x.connectorId === dc).slots.some((s) => s.startsAt === t && s.reason === 'Booked'));
  });

  it('allows exactly one winner when two customers race for the same slot', async () => {
    const t = futureSlot(2, '14:00');
    const results = await Promise.all([book(d1, stationId, dc, t), book(d2, stationId, dc, t), book(d1, stationId, dc, t), book(d2, stationId, dc, t)]);
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [201, 409, 409, 409]);
    const [{ n }] = await db`SELECT count(*)::int AS n FROM bookings WHERE connector_id = ${dc} AND starts_at = ${t} AND status = 'RESERVED'`;
    assert.equal(n, 1);
  });

  it('replays a duplicate request with the same Idempotency-Key instead of double-booking', async () => {
    const h = idem();
    const t = futureSlot(2, '16:00');
    const a = await book(d1, stationId, dc, t, {}, h);
    const b = await book(d1, stationId, dc, t, {}, h);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.body.idempotentReplay, true);
    assert.equal(a.body.booking.id, b.body.booking.id);
    const mismatch = await book(d1, stationId, dc, futureSlot(2, '17:00'), {}, h);
    assert.equal(mismatch.status, 422);
  });

  it('confirms only after a verified webhook, and posts the 15% + 15% split to the ledger once (duplicate webhooks)', async () => {
    const r = await book(d1, stationId, dc, futureSlot(2, '18:00'));
    const order = r.body.paymentOrder;
    assert.equal(order.amountPaise, 20700);
    // a forged webhook is rejected
    const forged = await fetch(`${BASE}/api/webhooks/payments/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gpev-test-signature': createHmac('sha256', 'wrong-secret').update('{}').digest('hex') },
      body: JSON.stringify({ id: 'evt_forged', type: 'payment.captured', data: { order_ref: order.providerOrderRef, amount_paise: 20700 } }),
    });
    assert.equal(forged.status, 401);
    assert.equal((await d1.get(`/api/bookings/${r.body.booking.id}`)).body.booking.status, 'RESERVED');
    // the same signed event delivered three times
    const p = await pay(d1, order.id, 'success', 3);
    assert.equal(p.status, 200);
    assert.equal(p.body.bookingStatus, 'CONFIRMED');
    assert.deepEqual(p.body.deliveries.map((d) => d.duplicate), [false, true, true]);
    const [{ dup }] = await db`SELECT duplicate_count AS dup FROM payment_webhook_events WHERE payload->'data'->>'order_ref' = ${order.providerOrderRef}`;
    assert.equal(dup, 2);
    const l = await ledgerFor(r.body.booking.id);
    assert.deepEqual(l, [
      { account: 'partner_payable', debit: 0, credit: 15300 },
      { account: 'platform_commission', debit: 0, credit: 2700 },
      { account: 'platform_service_fee', debit: 0, credit: 2700 },
      { account: 'provider_clearing', debit: 20700, credit: 0 },
    ]);
    // partner sees its deduction and payout; driver does not see the partner split
    const pv = await partner.get(`/api/partner/bookings/${r.body.booking.id}`);
    assert.equal(pv.body.booking.pricing.providerCommissionPaise, 2700);
    assert.equal(pv.body.booking.pricing.partnerAmountPaise, 15300);
    const dv = await d1.get(`/api/bookings/${r.body.booking.id}`);
    assert.equal(dv.body.booking.pricing.partnerAmountPaise, undefined);
    const receipt = await d1.get(`/api/bookings/${r.body.booking.id}/receipt`);
    assert.equal(receipt.body.receipt.totalPaidPaise, 20700);
  });

  it('handles payment failure: no revenue, booking marked failed and the slot released', async () => {
    const t = futureSlot(2, '20:00');
    const r = await book(d1, stationId, dc, t);
    const p = await pay(d1, r.body.paymentOrder.id, 'failure');
    assert.equal(p.body.bookingStatus, 'PAYMENT_FAILED');
    assert.equal(p.body.orderStatus, 'FAILED');
    assert.equal((await ledgerFor(r.body.booking.id)).length, 0, 'failed payments never reach the ledger');
    const again = await book(d2, stationId, dc, t);
    assert.equal(again.status, 201, 'slot is free again');
    // a later success event for the failed order is not silently accepted
    assert.equal((await pay(d1, r.body.paymentOrder.id, 'success')).body.bookingStatus, 'PAYMENT_FAILED');
  });

  it('cancels a confirmed booking: full refund, explicit ledger reversal, slot released', async () => {
    const t = futureSlot(3, '09:00');
    const r = await book(d1, stationId, dc, t);
    await pay(d1, r.body.paymentOrder.id);
    const other = await d2.post(`/api/bookings/${r.body.booking.id}/cancel`, {});
    assert.equal(other.status, 403, 'only the owner can cancel');
    const c = await d1.post(`/api/bookings/${r.body.booking.id}/cancel`, { reason: 'Plans changed' });
    assert.equal(c.status, 200);
    assert.equal(c.body.status, 'CANCELLED_DRIVER');
    assert.equal(c.body.refund.amountPaise, 20700);
    const l = await ledgerFor(r.body.booking.id);
    for (const a of l) assert.equal(a.debit, a.credit, `${a.account} nets to zero after a full refund`);
    const [o] = await db`SELECT status, refunded_paise FROM payment_orders WHERE id = ${r.body.paymentOrder.id}`;
    assert.equal(o.status, 'REFUNDED');
    assert.equal((await book(d2, stationId, dc, t)).status, 201, 'released slot can be booked');
    const twice = await d1.post(`/api/bookings/${r.body.booking.id}/cancel`, {});
    assert.equal(twice.status, 409);
  });

  it('enforces the cancellation window', async () => {
    const r = await book(d1, stationId, ac, nextSlot(3, 0));
    await pay(d1, r.body.paymentOrder.id);
    const c = await d1.post(`/api/bookings/${r.body.booking.id}/cancel`, {});
    assert.equal(c.status, 409);
    assert.equal(c.body.error.code, 'CANCELLATION_WINDOW_PASSED');
  });

  it('expires unpaid holds and refunds a payment that arrives after expiry (never overbooks)', async () => {
    const t = futureSlot(3, '12:00');
    const r = await book(d1, stationId, dc, t);
    await db`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = ${r.body.booking.id}`;
    const takeover = await book(d2, stationId, dc, t);
    assert.equal(takeover.status, 201, 'expired hold no longer blocks the slot');
    const late = await pay(d1, r.body.paymentOrder.id, 'success');
    assert.equal(late.body.bookingStatus, 'EXPIRED');
    assert.equal(late.body.orderStatus, 'REFUNDED');
    const l = await ledgerFor(r.body.booking.id);
    for (const a of l) assert.equal(a.debit, a.credit);
  });
});

describe('partner session handling and commission', () => {
  it('checks in with the booking code, starts, completes and refunds unused energy', async () => {
    // the next 15-minute slot always starts within 3–18 min, inside the 30-minute check-in window
    const r = await book(d1, stationId, dc, nextSlot(3, 0), { plannedKwh: 20 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await pay(d1, r.body.paymentOrder.id);
    const id = r.body.booking.id;
    const code = (await d1.get(`/api/bookings/${id}`)).body.booking.code;
    assert.equal((await partner.post(`/api/partner/bookings/${id}/start`, {})).status, 409, 'cannot start before check-in');
    assert.equal((await partner.post(`/api/partner/bookings/${id}/check-in`, { code: 'GP-WRONG1' })).status, 400);
    assert.equal((await partner.post(`/api/partner/bookings/${id}/check-in`, { code })).status, 200);
    assert.equal((await partner.post(`/api/partner/bookings/${id}/start`, {})).status, 200);
    const done = await partner.post(`/api/partner/bookings/${id}/complete`, { energyKwh: 15 });
    assert.equal(done.status, 200);
    const v = (await d1.get(`/api/bookings/${id}`)).body.booking;
    assert.equal(v.status, 'COMPLETED');
    assert.equal(v.session.energyKwh, 15);
    assert.equal(v.paymentState, 'PARTIALLY_REFUNDED');
    // 20 kWh prepaid at ₹18 (₹360 + ₹54 fee = ₹414); 15 kWh used (₹270 + ₹40.50 fee) → refund ₹103.50
    assert.equal(v.refunds[0].amountPaise, 10350);
    const l = Object.fromEntries((await ledgerFor(id)).map((a) => [a.account, a.credit - a.debit]));
    assert.equal(l.platform_service_fee, 4050);
    assert.equal(l.platform_commission, 4050);
    assert.equal(l.partner_payable, 22950);
    const rev = await partner.get('/api/partner/revenue');
    assert.ok(rev.body.summary.earnedCompletedPaise >= 22950);
    assert.ok(rev.body.bookings.some((b) => b.id === id && b.partnerNetPaise === 22950));
  });

  it('partner cancellation refunds the driver in full', async () => {
    const r = await book(d2, stationId, ac, futureSlot(4, '11:00'));
    await pay(d2, r.body.paymentOrder.id);
    const c = await partner.post(`/api/partner/bookings/${r.body.booking.id}/cancel`, { reason: 'Charger maintenance' });
    assert.equal(c.status, 200);
    const v = (await d2.get(`/api/bookings/${r.body.booking.id}`)).body.booking;
    assert.equal(v.status, 'CANCELLED_PARTNER');
    assert.equal(v.paymentState, 'REFUNDED');
  });

  it('keeps the whole ledger balanced', async () => {
    const [x] = await db`SELECT sum(debit_paise)::bigint AS d, sum(credit_paise)::bigint AS c FROM ledger_entries`;
    assert.equal(String(x.d), String(x.c));
    const unbalanced = await db`SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING sum(debit_paise) <> sum(credit_paise)`;
    assert.equal(unbalanced.length, 0);
    await assert.rejects(
      db.begin(async (tx) => {
        await tx`INSERT INTO ledger_entries (txn_id, account, debit_paise, kind) VALUES (gen_random_uuid(), 'provider_clearing', 100, 'PAYMENT_CAPTURED')`;
      }),
      /unbalanced/,
      'the database refuses an unbalanced posting',
    );
  });
});
