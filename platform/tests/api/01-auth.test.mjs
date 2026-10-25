// Acceptance 1 and 12: registration, authentication, verification, CSRF, injection resistance, persistence.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { BASE, Client, db, newDriver, uniq } from '../helpers.mjs';

after(() => db.end());

describe('authentication', () => {
  it('registers an EV Driver, persists it and starts a session', async () => {
    const c = new Client();
    const email = uniq('reg');
    const r = await c.post('/api/auth/register', { fullName: 'Reg Test', email, password: 'Charging2026ok' });
    assert.equal(r.status, 201);
    const me = await c.get('/api/auth/me');
    assert.equal(me.body.user.email, email);
    assert.deepEqual(me.body.user.roles, ['driver']);
    assert.equal(me.body.user.emailVerified, false);
    const [row] = await db`SELECT u.id, array_agg(r.role) AS roles FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.email = ${email} GROUP BY u.id`;
    assert.deepEqual(row.roles, ['driver']);
    const [pw] = await db`SELECT password_hash FROM users WHERE email = ${email}`;
    assert.match(pw.passwordHash, /^scrypt\$/, 'password is stored hashed');
  });

  it('rejects weak passwords, bad emails and duplicate accounts', async () => {
    const c = new Client();
    assert.equal((await c.post('/api/auth/register', { fullName: 'X', email: 'not-an-email', password: 'Charging2026ok' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { fullName: 'X', email: uniq('w'), password: 'short' })).status, 400);
    const email = uniq('dup');
    assert.equal((await c.post('/api/auth/register', { fullName: 'X', email, password: 'Charging2026ok' })).status, 201);
    const d = await new Client().post('/api/auth/register', { fullName: 'Y', email, password: 'Charging2026ok' });
    assert.equal(d.status, 409);
    assert.equal(d.body.error.code, 'EMAIL_TAKEN');
  });

  it('verifies email through the demo OTP adapter and blocks booking until verified', async () => {
    const c = await newDriver('Unverified', { verify: false });
    const blocked = await c.post('/api/bookings', {}, { 'Idempotency-Key': 'abcdefgh-1' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await c.post('/api/auth/verify-email', { code: '000000' })).status, 400);
    const inbox = await c.get('/api/demo/inbox');
    assert.equal(inbox.body.demo, true);
    const code = /(\d{6})/.exec(inbox.body.messages[0].body)[1];
    assert.equal((await c.post('/api/auth/verify-email', { code })).status, 200);
    assert.equal((await c.get('/api/auth/me')).body.user.emailVerified, true);
  });

  it('logs in and out; wrong passwords and missing sessions are rejected', async () => {
    const c = await newDriver('Login Test');
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal((await c.get('/api/auth/me')).body.user, null);
    assert.equal((await c.get('/api/bookings')).status, 401);
    const bad = await new Client().post('/api/auth/login', { email: c.email, password: 'wrong-password-1' });
    assert.equal(bad.status, 401);
    const good = new Client();
    assert.equal((await good.post('/api/auth/login', { email: c.email, password: 'Charging2026ok' })).status, 200);
    assert.equal((await good.get('/api/bookings')).status, 200);
  });

  it('requires the CSRF header and same origin on cookie-authenticated writes', async () => {
    const c = await newDriver('Csrf Test');
    const res = await fetch(BASE + '/api/me', { method: 'PATCH', headers: { Cookie: c.cookie, 'Content-Type': 'application/json' }, body: '{"fullName":"Hacked"}' });
    assert.equal(res.status, 403);
    const res2 = await fetch(BASE + '/api/me', { method: 'PATCH', headers: { Cookie: c.cookie, 'Content-Type': 'application/json', 'x-gpev-csrf': '1', Origin: 'https://evil.example' }, body: '{"fullName":"Hacked"}' });
    assert.equal(res2.status, 403);
  });

  it('treats SQL-like input as plain data', async () => {
    const r = await new Client().get(`/api/stations?q=${encodeURIComponent("'; DROP TABLE users; --")}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 0);
    const [{ n }] = await db`SELECT count(*)::int AS n FROM users`;
    assert.ok(n > 0, 'users table intact');
    const bad = await new Client().get('/api/stations/not-a-uuid');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'VALIDATION_FAILED');
  });

  it('returns consistent JSON errors', async () => {
    const r = await new Client().get('/api/nope');
    assert.equal(r.status, 404);
    assert.ok(r.body.error.code && r.body.error.message && r.body.error.requestId);
  });
});
