// Shared helpers for API tests: a cookie-keeping HTTP client and direct database access for assertions.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

export const BASE = process.env.API_BASE || 'http://127.0.0.1:8091';
export const db = postgres(process.env.DATABASE_URL || 'postgres://postgres:devpassword@127.0.0.1:5433/gpev_test', { onnotice: () => {}, max: 3, transform: postgres.camel });

export class Client {
  constructor(name = 'client') {
    this.name = name;
    this.cookie = '';
  }
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-gpev-csrf': '1' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b = {}, h) { return this.req('POST', p, b, h); }
  patch(p, b = {}, h) { return this.req('PATCH', p, b, h); }
  put(p, b = {}, h) { return this.req('PUT', p, b, h); }
  del(p, b, h) { return this.req('DELETE', p, b, h); }
}

export const uniq = (p) => `${p}-${randomUUID().slice(0, 8)}@test.greenplug`;

/** Registers a driver and verifies the email through the demo inbox. */
export async function newDriver(name = 'Test Driver', { verify = true } = {}) {
  const c = new Client(name);
  const email = uniq(name.toLowerCase().replace(/\s+/g, '-'));
  const r = await c.post('/api/auth/register', { fullName: name, email, password: 'Charging2026ok' });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  c.email = email;
  if (verify) {
    const inbox = await c.get('/api/demo/inbox');
    const code = /(\d{6})/.exec(inbox.body.messages[0].body)[1];
    const v = await c.post('/api/auth/verify-email', { code });
    if (v.status !== 200) throw new Error('verify failed');
  }
  return c;
}

export async function login(email, password) {
  const c = new Client(email);
  const r = await c.post('/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  c.email = email;
  return c;
}
export const admin = () => login('admin@greenplug.test', 'AdminDemo2026');

/** Creates an approved partner with one published 24h station; returns { client, stationId, connectors }. */
export async function approvedPartnerWithStation(adm, opts = {}) {
  const p = await newDriver(opts.name || 'Partner Owner');
  const app = await p.post('/api/partner/application', {
    businessName: opts.business || 'Test Charging Co',
    businessType: 'company',
    contactEmail: 'ops@example.test',
    contactPhone: '+91 90000 22222',
    address: 'Test Street, Visakhapatnam',
    verifications: [{ documentType: 'operating_authority', reference: 'TEST-AUTH-001' }],
    declaration: true,
  });
  if (app.status !== 201) throw new Error('apply failed ' + JSON.stringify(app.body));
  const d = await adm.post(`/api/admin/partners/${app.body.partnerId}/decision`, { decision: 'APPROVE' });
  if (d.status !== 200) throw new Error('approve failed ' + JSON.stringify(d.body));
  const s = await p.post('/api/partner/stations', {
    name: opts.stationName || 'Test 24h Station',
    address: '1 Test Road, Visakhapatnam',
    area: opts.area || 'Test Area',
    city: 'Visakhapatnam',
    latitude: opts.lat ?? 17.73,
    longitude: opts.lng ?? 83.31,
    accessType: opts.accessType || 'PUBLIC',
    amenities: ['parking'],
    slotMinutes: 15,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '24:00' })),
  });
  if (s.status !== 201) throw new Error('station failed ' + JSON.stringify(s.body));
  const connectors = [];
  for (const c of opts.connectors || [{ label: 'DC-1', standard: 'CCS2', currentType: 'DC', maxPowerKw: 60, pricePerKwh: 18 }, { label: 'AC-1', standard: 'TYPE2', currentType: 'AC', maxPowerKw: 7.4, pricePerKwh: 12 }]) {
    const r = await p.post(`/api/partner/stations/${s.body.id}/connectors`, c);
    if (r.status !== 201) throw new Error('connector failed ' + JSON.stringify(r.body));
    connectors.push(r.body.id);
  }
  const sub = await p.post(`/api/partner/stations/${s.body.id}/submit`);
  if (sub.status !== 200) throw new Error('submit failed ' + JSON.stringify(sub.body));
  const ap = await adm.post(`/api/admin/stations/${s.body.id}/decision`, { decision: 'APPROVE' });
  if (ap.status !== 200) throw new Error('station approve failed ' + JSON.stringify(ap.body));
  // reload the session so the partner role is visible
  return { client: p, stationId: s.body.id, connectors, partnerId: app.body.partnerId };
}

/** Next slot boundary (15-minute grid, IST == UTC+5:30 aligned on quarter hours) at least `minAhead` minutes ahead. */
export function nextSlot(minAhead = 3, extraSlots = 0) {
  const q = 15 * 60_000;
  const t = Math.ceil((Date.now() + minAhead * 60_000) / q) * q + extraSlots * q;
  return new Date(t).toISOString();
}
/** A slot on a future day at a given IST hour (for non-time-sensitive tests). */
export function futureSlot(daysAhead, hhmm) {
  const d = new Date(Date.now() + daysAhead * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);
  return new Date(`${d}T${hhmm}:00+05:30`).toISOString();
}

let keyN = 0;
export const idem = () => ({ 'Idempotency-Key': `test-${Date.now()}-${keyN++}-${Math.random().toString(36).slice(2, 8)}` });

export async function book(client, stationId, connectorId, startsAt, extra = {}, headers = idem()) {
  return client.post('/api/bookings', { stationId, connectorId, startsAt, durationMinutes: 60, plannedKwh: 10, paymentMethod: 'upi', ...extra }, headers);
}
export async function pay(client, orderId, outcome = 'success', deliveries = 1) {
  return client.post(`/api/payments/test-checkout/${orderId}`, { outcome, deliveries });
}
