// Admin-only configuration (commission rates), payouts statements, audit and integration status.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { admin, approvedPartnerWithStation, book, Client, db, futureSlot, newDriver, pay } from '../helpers.mjs';

after(async () => {
  const adm = await admin();
  await adm.patch('/api/admin/settings', { customerFeeBps: 1500, providerCommissionBps: 1500 });
  await db.end();
});

describe('admin configuration', () => {
  it('only administrators can change the fee and commission rates; new quotes use them, old bookings keep their snapshot', async () => {
    const adm = await admin();
    const { stationId, connectors } = await approvedPartnerWithStation(adm, { stationName: 'Rates Test Station' });
    const d = await newDriver('Rate Driver');
    const before = await book(d, stationId, connectors[0], futureSlot(6, '10:00'));
    assert.equal(before.body.paymentOrder.amountPaise, 20700);
    assert.equal((await d.patch('/api/admin/settings', { customerFeeBps: 0 })).status, 403);
    assert.equal((await adm.patch('/api/admin/settings', { customerFeeBps: 99999 })).status, 400);
    const ch = await adm.patch('/api/admin/settings', { customerFeeBps: 1000, providerCommissionBps: 1200 });
    assert.equal(ch.status, 200);
    const est = await new Client().post(`/api/stations/${stationId}/estimate`, { connectorId: connectors[0], plannedKwh: 10 });
    assert.equal(est.body.quote.customerFeePaise, 1800);
    assert.equal(est.body.quote.providerCommissionPaise, 2160);
    await pay(d, before.body.paymentOrder.id);
    const [b] = await db`SELECT fee_bps, customer_total_paise FROM bookings WHERE id = ${before.body.booking.id}`;
    assert.equal(b.feeBps, 1500, 'existing booking keeps its quoted rate');
    assert.equal(b.customerTotalPaise, 20700);
    const [a] = await db`SELECT action FROM audit_logs WHERE action = 'settings.updated' ORDER BY id DESC LIMIT 1`;
    assert.ok(a);
    await adm.patch('/api/admin/settings', { customerFeeBps: 1500, providerCommissionBps: 1500 });
  });

  it('records payout statements without moving money and reports integration status honestly', async () => {
    const adm = await admin();
    const parts = await adm.get('/api/admin/partners?status=APPROVED');
    const p = parts.body.partners[0];
    const today = new Date().toISOString().slice(0, 10);
    const r = await adm.post('/api/admin/payouts', { partnerId: p.id, periodStart: '2026-01-01', periodEnd: today });
    assert.equal(r.status, 201);
    assert.equal(r.body.payout.status, 'PENDING_INTEGRATION');
    const st = await new Client().get('/api/integrations/status');
    const byKey = Object.fromEntries(st.body.integrations.map((i) => [i.key, i.status]));
    assert.equal(byKey.payments, 'TEST_MODE');
    assert.equal(byKey.charger_telemetry, 'NOT_CONNECTED');
    assert.equal(byKey.payouts, 'NOT_CONNECTED');
    const ov = await adm.get('/api/admin/overview');
    assert.equal(ov.body.money.ledgerBalanced, true);
  });

  it('support tickets flow between users and admins', async () => {
    const d = await newDriver('Support Driver');
    const t = await d.post('/api/support/tickets', { workspace: 'driver', category: 'booking', subject: 'Question about my booking', message: 'Hello, can I change the time?' });
    assert.equal(t.status, 201);
    assert.equal((await d.post('/api/support/tickets', { workspace: 'partner', category: 'station', subject: 'x y z', message: 'abc' })).status, 403);
    const adm = await admin();
    assert.equal((await adm.post(`/api/admin/support/${t.body.id}/reply`, { body: 'Yes — cancel and rebook.', status: 'RESOLVED' })).status, 200);
    const view = await d.get(`/api/support/tickets/${t.body.id}`);
    assert.equal(view.body.ticket.status, 'RESOLVED');
    assert.equal(view.body.messages.length, 2);
    const other = await newDriver('Other Support');
    assert.equal((await other.get(`/api/support/tickets/${t.body.id}`)).status, 403);
  });

  it('plans a trip with charging stops along the route', async () => {
    const d = await newDriver('Trip Driver');
    const r = await d.post('/api/trips/plan', {
      origin: { label: 'Visakhapatnam', latitude: 17.6868, longitude: 83.2185 },
      destination: { label: 'Vijayawada', latitude: 16.5062, longitude: 80.648 },
      rangeKm: 180,
      corridorKm: 15,
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.plan.distanceKm > 300);
    assert.ok(r.body.plan.stops.length >= 1, 'needs at least one stop with 180 km range');
    assert.equal(r.body.plan.routeSource, 'demo-straight-line');
    const save = await d.post('/api/trips', { title: 'Vizag to Vijayawada', plan: r.body.plan });
    assert.equal(save.status, 201);
    assert.equal((await d.get('/api/trips')).body.trips.length, 1);
  });
});
