// Acceptance 10 and 12: partners cannot touch another partner's stations, bookings or revenue;
// drivers cannot see other drivers' bookings; private/home locations stay private.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { admin, approvedPartnerWithStation, book, Client, db, futureSlot, newDriver, pay } from '../helpers.mjs';

let adm, A, B, driver, other, bookingA;
before(async () => {
  adm = await admin();
  A = await approvedPartnerWithStation(adm, { name: 'Owner A', business: 'Partner A Co', stationName: 'Partner A Station' });
  B = await approvedPartnerWithStation(adm, { name: 'Owner B', business: 'Partner B Co', stationName: 'Partner B Station' });
  driver = await newDriver('Iso Driver');
  other = await newDriver('Nosy Driver');
  const r = await book(driver, A.stationId, A.connectors[0], futureSlot(5, '10:00'));
  await pay(driver, r.body.paymentOrder.id);
  bookingA = r.body.booking.id;
});
after(() => db.end());

describe('ownership isolation', () => {
  it("partner B cannot read or change partner A's station or connectors", async () => {
    const b = B.client;
    assert.equal((await b.get(`/api/partner/stations/${A.stationId}`)).status, 403);
    assert.equal((await b.patch(`/api/partner/stations/${A.stationId}`, { operationalStatus: 'TEMPORARILY_CLOSED' })).status, 403);
    assert.equal((await b.patch(`/api/partner/connectors/${A.connectors[0]}`, { pricePerKwh: 1 })).status, 403);
    assert.equal((await b.post(`/api/partner/stations/${A.stationId}/connectors`, { label: 'X', standard: 'TYPE2', currentType: 'AC', maxPowerKw: 7, pricePerKwh: 5 })).status, 403);
    const [s] = await db`SELECT operational_status FROM stations WHERE id = ${A.stationId}`;
    assert.equal(s.operationalStatus, 'AVAILABLE', 'unchanged');
    const [c] = await db`SELECT price_per_kwh_paise FROM connectors WHERE id = ${A.connectors[0]}`;
    assert.equal(c.pricePerKwhPaise, 1800, 'price unchanged');
    const list = await b.get('/api/partner/stations');
    assert.ok(list.body.stations.every((s2) => s2.id !== A.stationId));
  });

  it("partner B cannot see or act on partner A's bookings or revenue", async () => {
    const b = B.client;
    assert.equal((await b.get(`/api/partner/bookings/${bookingA}`)).status, 403);
    assert.equal((await b.post(`/api/partner/bookings/${bookingA}/cancel`, { reason: 'malicious' })).status, 403);
    const listB = await b.get('/api/partner/bookings');
    assert.ok(listB.body.bookings.every((x) => x.id !== bookingA));
    const revB = await b.get('/api/partner/revenue');
    assert.ok(revB.body.bookings.every((x) => x.id !== bookingA));
    assert.equal(revB.body.summary.grossBasePaise, 0);
    const revA = await A.client.get('/api/partner/revenue');
    assert.ok(revA.body.bookings.some((x) => x.id === bookingA));
    assert.equal((await b.get(`/api/admin/partners/${A.partnerId}/revenue`)).status, 403, 'admin revenue view needs admin');
    const [{ n }] = await db`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ownership.denied' AND entity_id = ${bookingA}`;
    assert.ok(n >= 1, 'denied attempts are audited');
  });

  it("a driver cannot see another driver's booking or receipt", async () => {
    assert.equal((await other.get(`/api/bookings/${bookingA}`)).status, 403);
    assert.equal((await other.get(`/api/bookings/${bookingA}/receipt`)).status, 403);
    assert.equal((await other.get('/api/bookings')).body.bookings.length, 0);
    assert.equal((await new Client().get(`/api/bookings/${bookingA}`)).status, 401);
  });

  it('partners cannot book their own station', async () => {
    const r = await book(A.client, A.stationId, A.connectors[1], futureSlot(5, '13:00'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'OWN_STATION');
  });

  it('never publishes the exact location or owner contact of a home charger', async () => {
    const pub = await new Client().get('/api/stations?access=HOME');
    const home = pub.body.stations.find((s) => s.name === 'Seethammadhara Home Charger');
    assert.ok(home, 'seeded home charger is listed');
    assert.equal(home.exactLocation, false);
    assert.equal(home.operator, 'Private home host');
    assert.notEqual(home.location.latitude, 17.7432);
    const det = await new Client().get(`/api/stations/${home.id}`);
    assert.equal(det.body.station.directionsUrl, null);
    assert.equal(det.body.station.contact, null);
    assert.ok(!JSON.stringify(det.body).includes('17.7432'), 'exact coordinates absent from the payload');
    assert.ok(!JSON.stringify(det.body).includes('+91'), 'no phone numbers');
  });
});
