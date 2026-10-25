// Acceptance 2, 3, 4: switch mode, partner access before approval, station registration and admin approval.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { admin, Client, db, newDriver } from '../helpers.mjs';

after(() => db.end());

describe('switch mode and server-side permissions', () => {
  it('denies the partner workspace before approval, even when the client asks for it', async () => {
    const d = await newDriver('Mode Switcher');
    const sw = await d.post('/api/me/workspace', { mode: 'partner' });
    assert.equal(sw.status, 200);
    assert.equal(sw.body.granted, 'partner-onboarding');
    for (const [m, p] of [['GET', '/api/partner/overview'], ['GET', '/api/partner/stations'], ['POST', '/api/partner/stations'], ['GET', '/api/partner/revenue']]) {
      const r = await d.req(m, p, m === 'POST' ? { name: 'x' } : undefined);
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal(r.body.error.code, 'PARTNER_NOT_APPROVED');
    }
    const adminTry = await d.post('/api/me/workspace', { mode: 'admin' });
    assert.equal(adminTry.body.granted, 'denied');
    assert.equal((await d.get('/api/admin/overview')).status, 403);
    // Switching back keeps the driver workspace and data
    assert.equal((await d.post('/api/me/workspace', { mode: 'driver' })).body.granted, 'driver');
  });

  it('runs the partner application → admin approval → station submission → publication flow', async () => {
    const adm = await admin();
    const p = await newDriver('Station Owner');
    const app = await p.post('/api/partner/application', {
      businessName: 'Roles Test Chargers',
      businessType: 'individual',
      contactEmail: 'owner@example.test',
      contactPhone: '+91 91234 56789',
      address: 'Plot 4, Test Nagar, Visakhapatnam',
      verifications: [{ documentType: 'ownership_proof', reference: 'SALE-DEED-TEST-1' }],
      declaration: true,
    });
    assert.equal(app.status, 201);
    assert.equal(app.body.status, 'PENDING');
    assert.equal((await p.get('/api/partner/overview')).status, 403, 'pending partner is still denied');
    assert.equal((await p.post('/api/me/workspace', { mode: 'partner' })).body.granted, 'partner-onboarding');
    // a non-admin cannot approve themselves
    const self = await p.post(`/api/admin/partners/${app.body.partnerId}/decision`, { decision: 'APPROVE' });
    assert.equal(self.status, 403);
    const queue = await adm.get('/api/admin/partners?status=PENDING');
    assert.ok(queue.body.partners.some((x) => x.id === app.body.partnerId));
    assert.equal((await adm.post(`/api/admin/partners/${app.body.partnerId}/decision`, { decision: 'APPROVE' })).status, 200);
    assert.equal((await p.post('/api/me/workspace', { mode: 'partner' })).body.granted, 'partner-dashboard');
    assert.equal((await p.get('/api/partner/overview')).status, 200);
    const [{ roles }] = await db`SELECT array_agg(role ORDER BY role) AS roles FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.email = ${p.email}`;
    assert.deepEqual(roles, ['driver', 'partner']);

    const st = await p.post('/api/partner/stations', {
      name: 'Roles Test Hub', address: '9 Harbour Road, Visakhapatnam', area: 'Harbour', city: 'Visakhapatnam', latitude: 17.69, longitude: 83.29, accessType: 'PUBLIC',
      amenities: ['parking', 'cafe'], slotMinutes: 30, hours: [{ weekday: 1, opensAt: '08:00', closesAt: '20:00' }],
    });
    assert.equal(st.status, 201);
    const early = await p.post(`/api/partner/stations/${st.body.id}/submit`);
    assert.equal(early.status, 400, 'cannot submit without a connector');
    assert.equal((await p.post(`/api/partner/stations/${st.body.id}/connectors`, { label: 'CCS-1', standard: 'CCS2', currentType: 'AC', maxPowerKw: 30, pricePerKwh: 19 })).status, 400, 'CCS2 must be DC');
    assert.equal((await p.post(`/api/partner/stations/${st.body.id}/connectors`, { label: 'CCS-1', standard: 'CCS2', currentType: 'DC', maxPowerKw: 30, pricePerKwh: 19 })).status, 201);
    assert.equal((await p.post(`/api/partner/stations/${st.body.id}/submit`)).status, 200);
    const pub = await new Client().get('/api/stations?q=Roles%20Test%20Hub');
    assert.equal(pub.body.count, 0, 'not public before admin approval');
    assert.equal((await adm.post(`/api/admin/stations/${st.body.id}/decision`, { decision: 'APPROVE' })).status, 200);
    const pub2 = await new Client().get('/api/stations?q=Roles%20Test%20Hub');
    assert.equal(pub2.body.count, 1, 'published after approval');
    const audit = await db`SELECT action FROM audit_logs WHERE entity_id IN (${app.body.partnerId}, ${st.body.id}) ORDER BY id`;
    assert.ok(audit.some((a) => a.action === 'partner.approve') && audit.some((a) => a.action === 'station.approve'));
  });

  it('suspending a partner revokes partner permissions immediately', async () => {
    const adm = await admin();
    const p = await newDriver('Suspend Me');
    const app = await p.post('/api/partner/application', {
      businessName: 'Suspend Test', businessType: 'company', contactEmail: 's@example.test', contactPhone: '+91 91111 11111', address: 'Somewhere, Visakhapatnam',
      verifications: [{ documentType: 'operating_authority', reference: 'OPS-1' }], declaration: true,
    });
    await adm.post(`/api/admin/partners/${app.body.partnerId}/decision`, { decision: 'APPROVE' });
    assert.equal((await p.get('/api/partner/stations')).status, 200);
    assert.equal((await adm.post(`/api/admin/partners/${app.body.partnerId}/decision`, { decision: 'SUSPEND', note: 'Safety review' })).status, 200);
    const r = await p.get('/api/partner/stations');
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'PARTNER_NOT_APPROVED');
  });
});
