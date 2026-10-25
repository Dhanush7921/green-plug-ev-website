// End-to-end acceptance run through the real UI, API and PostgreSQL database (Playwright + Chromium).
//
//   node tests/e2e/workflow.mjs            builds, resets a dedicated e2e database, starts the server, runs, stops
//   E2E_BASE_URL=http://127.0.0.1:8080 node tests/e2e/workflow.mjs     runs against an already running server
//
// Screenshots and a results file are written to tests/e2e/artifacts/ (git-ignored).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ART = path.join(root, 'tests/e2e/artifacts');
fs.rmSync(ART, { recursive: true, force: true });
fs.mkdirSync(ART, { recursive: true });

const PORT = process.env.E2E_PORT || '8092';
const OWN = !process.env.E2E_BASE_URL;
const BASE = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL || 'postgres://postgres:devpassword@127.0.0.1:5433/gpev_e2e', PORT, LOG_REQUESTS: '0', RATE_LIMIT_FACTOR: '20', DEMO_MODE: 'true', PAYMENT_PROVIDER: 'test', APP_ORIGIN: BASE, STORAGE_DIR: path.join(root, '.test-storage') };

let server = null;
async function startServer() {
  server = spawn('node', ['dist/server.mjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}
async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise((r) => (s.once('exit', r), s.kill('SIGTERM')));
}
if (OWN) {
  for (const [cmd, args] of [
    ['node', ['scripts/build.mjs', 'all', '--prod']],
    ['node', ['dist/cli.mjs', 'reset']],
  ]) {
    const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  await startServer();
}

// ------------------------------------------------------------------ helpers
const results = [];
let n = 0;
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function step(id, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, ok: true, ms: Date.now() - t0, detail: detail ?? null });
    console.log(`  ✓ [${id}] ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  } catch (e) {
    results.push({ id, name, ok: false, ms: Date.now() - t0, error: e.message.split('\n')[0] });
    console.log(`  ✗ [${id}] ${name} — ${e.message.split('\n')[0]}`);
    let i = 0;
    for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(ART, `FAIL-${++i}.png`) }).catch(() => {});
    throw e;
  }
}
async function shot(page, name) {
  const f = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ART, f), fullPage: false });
  return f;
}
const consoleErrors = [];
async function newContext(browser, opts = {}) {
  const { skipIntro = true, ...rest } = opts;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, baseURL: BASE, ...rest });
  if (skipIntro)
    await ctx.addInitScript(() => {
      try {
        sessionStorage.setItem('gpev-app-intro', '1');
        localStorage.setItem('gpev-effects', 'off'); // plain cursor in screenshots
      } catch {
        /* about:blank has no storage */
      }
    });
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => consoleErrors.push(`${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !/status of (4\d\d)/.test(m.text()) && consoleErrors.push(m.text()));
  });
  return ctx;
}
const api = (page) => ({
  get: async (p) => {
    const r = await page.request.get(p);
    return { status: r.status(), body: await r.json().catch(() => null) };
  },
  post: async (p, data, headers = {}) => {
    const r = await page.request.post(p, { data, headers: { 'x-gpev-csrf': '1', ...headers } });
    return { status: r.status(), body: await r.json().catch(() => null) };
  },
  patch: async (p, data) => {
    const r = await page.request.patch(p, { data, headers: { 'x-gpev-csrf': '1' } });
    return { status: r.status(), body: await r.json().catch(() => null) };
  },
});
async function signIn(page, email, password) {
  await page.goto('/app/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/signin'));
}
async function switchMode(page, mode, mobile = false) {
  await page.locator(`${mobile ? '.mobile-switch' : '.topbar'} .switch-mode-btn[data-mode=${mode}]`).click();
}
async function pickConnector(page, label) {
  const sel = page.getByTestId('connector-select');
  const value = await sel.locator('option', { hasText: label }).first().getAttribute('value');
  await sel.selectOption(value);
}
async function prepareSlot(page, { connector, duration = '60', dayIndex = 0, kwh = '10' }) {
  await page.getByTestId('booking-panel').waitFor();
  await pickConnector(page, connector);
  await page.getByTestId('duration-select').selectOption(duration);
  const chip = page.locator('.date-chips .chip-btn').nth(dayIndex);
  const date = await chip.getAttribute('data-date');
  await chip.click();
  // wait until the grid shows availability for exactly this date and duration
  await page.locator(`[data-testid=slot-grid][data-date="${date}"][data-duration="${duration}"] .slot`).first().waitFor();
  await page.getByTestId('kwh-input').fill(kwh);
}
const text = async (loc) => (await loc.innerText()).trim();
const ts = Date.now().toString(36).slice(-5).toUpperCase();
const DRIVER = { name: 'Kiran E2E', email: `kiran.e2e.${ts.toLowerCase()}@greenplug.test`, password: 'KiranTest2026' };
const BIZ = `E2E Volt ${ts}`;
const STATION = `E2E Siripuram Hub ${ts}`;
const state = {};

const browser = await chromium.launch();
console.log(`\nGREEN PLUG EV — end-to-end workflow against ${BASE}\n`);
try {
  // ---------------------------------------------------------------- 13: intro, reduced motion
  const introCtx = await newContext(browser, { skipIntro: false });
  const ip = await introCtx.newPage();
  await step('13', 'Cinematic intro plays on first visit and can be skipped', async () => {
    await ip.goto('/app/');
    await ip.locator('.app-intro').waitFor({ timeout: 5000 });
    await ip.waitForTimeout(1500);
    const f = await shot(ip, 'intro');
    await ip.getByRole('button', { name: 'Skip intro' }).click();
    await ip.locator('.app-intro').waitFor({ state: 'detached', timeout: 3000 });
    return f;
  });
  await introCtx.close();
  const rmCtx = await newContext(browser, { skipIntro: false, reducedMotion: 'reduce' });
  const rp = await rmCtx.newPage();
  await step('13', 'Reduced motion: no intro, app usable immediately', async () => {
    await rp.goto('/app/');
    await rp.getByTestId('station-card').first().waitFor();
    expect((await rp.locator('.app-intro').count()) === 0, 'intro rendered under reduced motion');
    expect(!(await rp.evaluate(() => document.documentElement.className)).includes('intro'), 'intro class left on <html>');
    return 'no intro element';
  });
  await rmCtx.close();

  // ---------------------------------------------------------------- 12: auth errors
  const anonCtx = await newContext(browser);
  const an = await anonCtx.newPage();
  await step('12', 'Wrong password is rejected; protected pages require sign-in; API returns 401', async () => {
    await an.goto('/app/signin');
    await an.getByLabel('Email').fill('asha@greenplug.test');
    await an.getByLabel('Password').fill('not-the-password1');
    await an.getByRole('button', { name: 'Sign in', exact: true }).click();
    await an.getByText('Email or password is incorrect.').waitFor();
    await an.goto('/app/bookings');
    await an.waitForURL(/\/app\/signin\?next=/);
    const r = await api(an).post('/api/bookings', {}, { 'Idempotency-Key': 'anon-attempt-1' });
    expect(r.status === 401, `expected 401, got ${r.status}`);
    return 'login error shown, redirect to sign-in, 401 from API';
  });

  // ---------------------------------------------------------------- 1: register + verify
  const kCtx = await newContext(browser);
  const k = await kCtx.newPage();
  await step('1', 'Register a new EV Driver account and verify the email (demo inbox)', async () => {
    await k.goto('/app/register');
    await k.getByLabel('Full name').fill(DRIVER.name);
    await k.getByLabel('Email').fill(DRIVER.email);
    await k.getByLabel('Mobile number').fill('+91 90000 12345');
    await k.getByLabel('Password').fill(DRIVER.password);
    await k.getByLabel(/I agree/).check();
    await k.getByRole('button', { name: 'Create account' }).click();
    await k.waitForURL(/\/app\/verify/);
    await k.getByTestId('demo-inbox').getByText(/verification code is/).waitFor();
    const f = await shot(k, 'verify-demo-inbox');
    const code = (await text(k.getByTestId('demo-inbox'))).match(/verification code is (\d{6})/)[1];
    await k.getByLabel('Verification code').fill(code);
    await k.getByRole('button', { name: 'Verify', exact: true }).click();
    await k.waitForURL((u) => u.pathname === '/app/' || u.pathname === '/app');
    const me = (await api(k).get('/api/auth/me')).body.user;
    expect(me.emailVerified && me.roles.join() === 'driver', 'user not verified driver');
    return `${DRIVER.email} verified; roles=${me.roles}; ${f}`;
  });
  await step('1', 'Save a vehicle to the garage', async () => {
    await k.goto('/app/garage');
    await k.getByRole('button', { name: 'Enter connectors' }).click();
    await k.locator('.add-vehicle .chip-btn', { hasText: 'CCS2' }).click();
    await k.locator('.add-vehicle .chip-btn', { hasText: 'Type 2' }).click();
    await k.getByLabel('Nickname').fill('Kiran’s EV');
    await k.getByRole('button', { name: 'Save vehicle' }).click();
    await k.getByTestId('vehicle-row').first().waitFor();
    return `${await k.getByTestId('vehicle-row').count()} vehicle`;
  });

  // ---------------------------------------------------------------- 2/3: switch mode before approval
  await step('3', 'SWITCH MODE to Station Partner before approval → onboarding; server denies partner APIs', async () => {
    await k.goto('/app/');
    await switchMode(k, 'partner');
    await k.waitForURL(/\/app\/partner\/apply/);
    await k.getByTestId('partner-gate').getByText('denied by the server').waitFor();
    const gate = await text(k.getByTestId('partner-gate'));
    expect(gate.includes('403'), 'gate does not show 403');
    const a = await api(k).get('/api/partner/stations');
    const b = await api(k).post('/api/partner/stations', { name: 'Sneaky' });
    expect(a.status === 403 && a.body.error.code === 'PARTNER_NOT_APPROVED', `GET partner stations → ${a.status}`);
    expect(b.status === 403, `POST partner station → ${b.status}`);
    await k.goto('/app/partner/stations');
    await k.getByRole('heading', { name: 'Become a station partner' }).waitFor();
    const ws = await api(k).post('/api/me/workspace', { mode: 'admin' });
    const adm = await api(k).get('/api/admin/overview');
    expect(ws.body.granted === 'denied' && adm.status === 403, 'admin not denied');
    const f = await shot(k, 'partner-denied-onboarding');
    return `GET /api/partner/stations → ${a.status} ${a.body.error.code}; POST → ${b.status}; admin → ${adm.status}; ${f}`;
  });
  await step('2', 'Unsaved partner form survives switching to EV Driver and back', async () => {
    await k.getByTestId('biz-name').fill(BIZ);
    await k.getByTestId('biz-address').fill('12-3-45 Beach Road, Visakhapatnam 530017');
    await switchMode(k, 'driver');
    await k.waitForURL((u) => u.pathname === '/app/');
    await k.getByTestId('station-card').first().waitFor();
    await switchMode(k, 'partner');
    await k.waitForURL(/\/app\/partner\/apply/);
    const kept = await k.getByTestId('biz-name').inputValue();
    expect(kept === BIZ, `draft lost: "${kept}"`);
    return `draft kept: "${kept}"`;
  });
  await step('3', 'Submit partner registration with ownership verification reference', async () => {
    await k.getByTestId('biz-phone').fill('+91 90000 54321');
    await k.getByTestId('doc-ref-0').fill('SALE-DEED-VSP-2026-0042');
    await k.getByTestId('declaration').check();
    await k.getByTestId('submit-application').click();
    await k.getByTestId('application-status').getByText('Under review').waitFor();
    const still = await api(k).get('/api/partner/overview');
    expect(still.status === 403, 'pending partner got access');
    return `${BIZ}: PENDING; partner API still ${still.status}; ${await shot(k, 'application-pending')}`;
  });

  // ---------------------------------------------------------------- admin approves partner
  const aCtx = await newContext(browser);
  const ad = await aCtx.newPage();
  await step('4', 'Admin signs in, switches to Admin and approves the partner', async () => {
    await signIn(ad, 'admin@greenplug.test', 'AdminDemo2026');
    await switchMode(ad, 'admin');
    await ad.waitForURL(/\/app\/admin$/);
    await ad.locator('.rail-link', { hasText: 'Partners' }).click();
    const card = ad.locator(`[data-testid=partner-application][data-name="${BIZ}"]`);
    await card.waitFor();
    await shot(ad, 'admin-partner-queue');
    await card.getByTestId('approve-partner').click();
    await ad.getByTestId('confirm-decision').click();
    await card.waitFor({ state: 'detached' });
    return 'approved';
  });

  // ---------------------------------------------------------------- 2/4: approved partner registers a station
  await step('2', 'SWITCH MODE now opens the Station Partner dashboard (role granted by admin)', async () => {
    await k.goto('/app/');
    await switchMode(k, 'partner');
    await k.waitForURL((u) => u.pathname === '/app/partner');
    await k.getByRole('heading', { name: 'Partner dashboard' }).waitFor();
    const me = (await api(k).get('/api/auth/me')).body.user;
    return `roles=${me.roles}; partner=${me.partner.status}; ${await shot(k, 'partner-dashboard')}`;
  });
  await step('4', 'Register a station: details, coordinates, hours, 15-min slots, two connectors with pricing', async () => {
    await k.goto('/app/partner/stations');
    await k.getByTestId('add-station').click();
    await k.getByTestId('st-name').fill(STATION);
    await k.getByTestId('st-area').fill('Siripuram');
    await k.getByTestId('st-city').fill('Visakhapatnam');
    await k.getByTestId('st-address').fill('Waltair Main Road, Siripuram, Visakhapatnam 530003');
    await k.getByTestId('st-lat').fill('17.7302');
    await k.getByTestId('st-lng').fill('83.3196');
    await k.getByRole('button', { name: 'Open 24 hours' }).click();
    await k.getByLabel('Booking slot length').selectOption('15');
    await k.locator('.chip-btn', { hasText: 'Café' }).click();
    await shot(k, 'station-form');
    await k.getByTestId('save-station').click();
    await k.waitForURL(/\/app\/partner\/stations\/[0-9a-f-]{36}$/);
    state.stationId = k.url().split('/').pop();
    await k.getByTestId('conn-label').fill('DC-1');
    await k.getByTestId('conn-standard').selectOption('CCS2');
    await k.getByTestId('conn-kw').fill('60');
    await k.getByTestId('conn-price').fill('18');
    await k.getByTestId('add-connector').click();
    await k.getByTestId('connector-table').getByText('DC-1').waitFor();
    await k.getByTestId('conn-label').fill('AC-1');
    await k.getByTestId('conn-standard').selectOption('TYPE2');
    await k.getByTestId('conn-kw').fill('7.4');
    await k.getByTestId('conn-price').fill('12');
    await k.getByTestId('add-connector').click();
    await k.getByTestId('connector-table').getByText('AC-1').waitFor();
    await k.getByTestId('submit-station').click();
    await k.locator('.listing-bar').getByText('In review').waitFor();
    const pub = await api(k).get(`/api/stations/${state.stationId}`);
    expect(pub.status === 404, 'unapproved station is public');
    return `station ${state.stationId.slice(0, 8)} submitted; public before approval → ${pub.status}; ${await shot(k, 'station-submitted')}`;
  });
  await step('4', 'Admin approves the station listing → published', async () => {
    await ad.goto('/app/admin/stations');
    const card = ad.locator(`[data-testid=station-review][data-name="${STATION}"]`);
    await card.waitFor();
    await card.getByTestId('approve-station').click();
    await ad.getByTestId('confirm-decision').click();
    await card.waitFor({ state: 'detached' });
    const pub = await api(ad).get(`/api/stations/${state.stationId}`);
    expect(pub.status === 200, 'not published');
    return 'published (public API 200)';
  });

  // ---------------------------------------------------------------- 5/6/7/9: driver search, estimate, reserve
  const rCtx = await newContext(browser);
  const rv = await rCtx.newPage();
  await step('5', 'Driver searches and filters (CCS2 + DC) and finds the new station', async () => {
    await signIn(rv, 'ravi@greenplug.test', 'DriverDemo2026');
    await rv.goto('/app/');
    await rv.getByTestId('station-card').first().waitFor();
    const all = Number((await text(rv.getByTestId('result-count'))).split(' ')[0]);
    await rv.getByTestId('filters-toggle').click();
    await rv.getByTestId('filters').locator('.chip-btn', { hasText: 'CHAdeMO' }).click();
    await rv.waitForTimeout(700);
    const chademo = Number((await text(rv.getByTestId('result-count'))).split(' ')[0]);
    await rv.getByTestId('filters').locator('.chip-btn', { hasText: 'CHAdeMO' }).click();
    await rv.getByTestId('filters').locator('.chip-btn', { hasText: 'CCS2' }).click();
    await rv.getByTestId('filters').locator('.seg-btn', { hasText: 'DC' }).click();
    await rv.getByTestId('search-input').fill('Siripuram');
    await rv.locator(`[data-testid=station-card][data-station="${state.stationId}"]`).waitFor();
    await rv.waitForFunction((max) => Number(document.querySelector('[data-testid=result-count]')?.textContent?.split(' ')[0]) < max, chademo + all);
    await rv.waitForFunction(() => document.querySelectorAll('[data-testid=station-card]').length <= 3);
    const filtered = Number((await text(rv.getByTestId('result-count'))).split(' ')[0]);
    const f = await shot(rv, 'driver-search-filters');
    return `all=${all}, CHAdeMO=${chademo}, CCS2+DC+"Siripuram"=${filtered}; ${f}`;
  });
  await step('6/9', 'Estimate uses the configured ₹18/kWh: 10 kWh → base ₹180, fee ₹27, total ₹207', async () => {
    await rv.locator(`[data-testid=station-card][data-station="${state.stationId}"] .station-card-link`).click();
    await rv.getByTestId('station-title').waitFor();
    await prepareSlot(rv, { connector: 'DC-1', duration: '60', dayIndex: 0, kwh: '10' });
    await rv.getByTestId('estimate').waitFor();
    await rv.waitForFunction(() => document.querySelector('[data-testid=est-base]')?.textContent === '₹180');
    const base = await text(rv.getByTestId('est-base'));
    const fee = await text(rv.getByTestId('est-fee'));
    const total = await text(rv.getByTestId('est-total'));
    expect(base === '₹180' && fee === '₹27' && total === '₹207', `${base}/${fee}/${total}`);
    return `${base} + ${fee} = ${total}`;
  });
  await step('7', 'Reserve the first open slot today and pay in TEST mode (confirmed only by verified webhook)', async () => {
    const slot = rv.locator('[data-testid=slot-grid] .slot:not([disabled])').first();
    state.slotTime = await slot.getAttribute('data-slot');
    await slot.click();
    await shot(rv, 'booking-panel');
    await rv.getByTestId('book-button').click();
    await rv.getByTestId('checkout').waitFor();
    await shot(rv, 'test-checkout');
    await rv.getByTestId('pay-success').click();
    await rv.waitForURL(/\/app\/bookings\/[0-9a-f-]{36}$/);
    state.raviBooking = rv.url().split('/').pop();
    await rv.waitForFunction(() => document.querySelector('[data-testid=booking-status]')?.textContent === 'Confirmed');
    state.raviCode = await text(rv.getByTestId('booking-code'));
    const f = await shot(rv, 'booking-confirmed');
    return `${state.raviCode} at ${state.slotTime} IST — Confirmed; ${f}`;
  });

  const sCtx = await newContext(browser);
  const as = await sCtx.newPage();
  await step('7', 'Another customer sees the same slot as Booked and cannot reserve it (UI + API race)', async () => {
    await signIn(as, 'asha@greenplug.test', 'DriverDemo2026');
    await as.goto(`/app/stations/${state.stationId}`);
    await prepareSlot(as, { connector: 'DC-1', duration: '60', dayIndex: 0, kwh: '10' });
    const same = as.locator(`[data-testid=slot-grid] .slot[data-slot="${state.slotTime}"]`);
    expect(await same.isDisabled(), 'slot still enabled');
    expect((await same.getAttribute('data-reason')) === 'Booked', 'reason not Booked');
    const f = await shot(as, 'slot-taken-for-second-driver');
    // API: direct attempt at the taken slot, then a true race for a fresh slot
    const av = await api(as).get(`/api/stations/${state.stationId}/availability?date=${new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10)}&durationMinutes=60`);
    const dc = av.body.connectors.find((c) => c.label === 'DC-1');
    const taken = dc.slots.find((x) => x.time === state.slotTime);
    const direct = await api(as).post('/api/bookings', { stationId: state.stationId, connectorId: dc.connectorId, startsAt: taken.startsAt, durationMinutes: 60, plannedKwh: 10 }, { 'Idempotency-Key': `e2e-direct-${ts}` });
    const tomorrow = new Date(Date.now() + 5.5 * 36e5 + 864e5).toISOString().slice(0, 10);
    const startsAt = new Date(`${tomorrow}T12:00:00+05:30`).toISOString();
    const body = { stationId: state.stationId, connectorId: dc.connectorId, startsAt, durationMinutes: 60, plannedKwh: 5 };
    const race = await Promise.all([api(as).post('/api/bookings', body, { 'Idempotency-Key': `e2e-race-a-${ts}` }), api(rv).post('/api/bookings', body, { 'Idempotency-Key': `e2e-race-r-${ts}` })]);
    const codes = race.map((x) => x.status).sort();
    expect(direct.status === 409 && direct.body.error.code === 'SLOT_UNAVAILABLE', `direct → ${direct.status}`);
    expect(codes.join() === '201,409', `race → ${codes}`);
    const winner = race.find((x) => x.status === 201);
    await api(winner === race[0] ? as : rv).post(`/api/bookings/${winner.body.booking.id}/cancel`, { reason: 'e2e race cleanup' });
    return `UI slot ${state.slotTime} disabled ("Booked"); direct API → 409 SLOT_UNAVAILABLE; simultaneous race → [${codes}]; ${f}`;
  });
  await step('11', 'Payment failure: booking becomes PAYMENT_FAILED and nothing is charged', async () => {
    await as.goto(`/app/stations/${state.stationId}`);
    await prepareSlot(as, { connector: 'DC-1', duration: '60', dayIndex: 1, kwh: '10' });
    await as.locator('[data-testid=slot-grid] .slot[data-slot="10:00"]').click();
    await as.getByTestId('book-button').click();
    await as.getByTestId('pay-failure').click();
    await as.waitForURL(/\/app\/bookings\//);
    await as.waitForFunction(() => document.querySelector('[data-testid=booking-status]')?.textContent === 'Payment failed');
    const id = as.url().split('/').pop();
    const b = (await api(as).get(`/api/bookings/${id}`)).body.booking;
    expect(b.paymentState === 'FAILED' && b.refunds.length === 0, `payment ${b.paymentState}`);
    return `status ${b.status}, payment ${b.paymentState}; ${await shot(as, 'payment-failed')}`;
  });
  await step('11', 'Duplicate webhooks: success delivered 3× → processed once, duplicates ignored', async () => {
    await as.goto(`/app/stations/${state.stationId}`);
    await prepareSlot(as, { connector: 'DC-1', duration: '60', dayIndex: 1, kwh: '10' });
    const s10 = as.locator('[data-testid=slot-grid] .slot[data-slot="10:00"]');
    expect(!(await s10.isDisabled()), 'failed payment did not release the slot');
    await s10.click();
    await as.getByTestId('book-button').click();
    await as.getByTestId('pay-duplicate').click();
    await as.waitForURL(/\/app\/bookings\//);
    await as.waitForFunction(() => document.querySelector('[data-testid=booking-status]')?.textContent === 'Confirmed');
    state.ashaBooking = as.url().split('/').pop();
    const led = (await api(ad).get('/api/admin/ledger')).body;
    const dup = led.webhooks.find((w) => w.duplicateCount >= 2);
    expect(dup, 'no duplicate recorded');
    const code = (await api(as).get(`/api/bookings/${state.ashaBooking}`)).body.booking.code;
    const captures = led.recent.filter((e) => e.code === code && e.kind === 'PAYMENT_CAPTURED' && e.account === 'provider_clearing').length;
    expect(captures === 1, `captured ${captures} times`);
    return `slot released after failure; event delivered 3×: duplicates ignored=${dup.duplicateCount}, ledger capture posted once for ${code}; ledger balanced=${led.unbalancedTransactions === 0}`;
  });
  await step('8/11', 'Cancel a permitted booking → full refund, ledger reversal, slot released', async () => {
    await as.getByTestId('cancel-booking').click();
    await as.getByTestId('confirm-cancel').click();
    await as.waitForFunction(() => document.querySelector('[data-testid=booking-status]')?.textContent === 'Cancelled by you');
    await as.getByTestId('booking-refunded').waitFor();
    const refunded = await text(as.getByTestId('booking-refunded'));
    const f = await shot(as, 'cancelled-refunded');
    await as.goto(`/app/stations/${state.stationId}`);
    await prepareSlot(as, { connector: 'DC-1', duration: '60', dayIndex: 1, kwh: '10' });
    const s10 = as.locator('[data-testid=slot-grid] .slot[data-slot="10:00"]');
    expect(!(await s10.isDisabled()), 'slot not released after cancellation');
    expect(refunded === '−₹207', `refund ${refunded}`);
    return `refund ${refunded}; 10:00 bookable again; ${f}`;
  });

  // ---------------------------------------------------------------- partner check-in / session / revenue
  await step('—', 'Partner booking calendar: check in with code → start → complete with 10 kWh recorded', async () => {
    await k.goto('/app/partner/bookings');
    const row = k.locator(`[data-testid=partner-booking][data-code="${state.raviCode}"]`);
    await row.waitFor();
    await shot(k, 'partner-calendar');
    await row.locator('[data-action=check-in]').click();
    await k.getByTestId('checkin-code').fill(state.raviCode);
    await k.getByTestId('confirm-action').click();
    await k.locator(`[data-testid=partner-booking][data-code="${state.raviCode}"][data-status=CHECKED_IN]`).waitFor();
    await row.locator('[data-action=start]').click();
    await k.getByTestId('confirm-action').click();
    await k.locator(`[data-testid=partner-booking][data-code="${state.raviCode}"][data-status=IN_PROGRESS]`).waitFor();
    await row.locator('[data-action=complete]').click();
    await k.getByTestId('energy-input').fill('10');
    await k.getByTestId('confirm-action').click();
    await k.getByRole('tab', { name: /History/ }).click();
    await k.locator(`[data-testid=partner-booking][data-code="${state.raviCode}"][data-status=COMPLETED]`).waitFor();
    return `${state.raviCode}: CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED (energy host-entered); ${await shot(k, 'partner-completed')}`;
  });
  await step('9', 'Commission recorded accurately: base ₹180 → commission ₹27, partner ₹153, platform ₹54', async () => {
    const d = (await api(k).get(`/api/partner/bookings/${state.raviBooking}`)).body.booking.pricing;
    expect(d.basePaise === 18000 && d.customerFeePaise === 2700 && d.customerTotalPaise === 20700 && d.providerCommissionPaise === 2700 && d.partnerAmountPaise === 15300 && d.platformRevenuePaise === 5400, JSON.stringify(d));
    await k.goto('/app/partner/revenue');
    await k.getByTestId('revenue-stats').waitFor();
    const g = await text(k.getByTestId('rev-gross'));
    const c = await text(k.getByTestId('rev-commission'));
    const nn = await text(k.getByTestId('rev-net'));
    expect(g === '₹180' && c === '₹27' && nn === '₹153', `${g}/${c}/${nn}`);
    const f = await shot(k, 'partner-revenue');
    const ov = (await api(ad).get('/api/admin/overview')).body.money;
    expect(ov.platformRevenuePaise === 5400 && ov.ledgerBalanced, `platform ${ov.platformRevenuePaise}`);
    await ad.goto('/app/admin');
    await ad.locator('.stat', { hasText: 'Platform revenue' }).waitFor();
    const f2 = await shot(ad, 'admin-overview');
    return `partner page ${g} − ${c} = ${nn}; admin platform revenue ₹${ov.platformRevenuePaise / 100} (fee ₹${ov.serviceFees / 100} + commission ₹${ov.commissions / 100}); cancelled/failed bookings excluded; ledger balanced; ${f}, ${f2}`;
  });
  await step('—', 'Driver sees the completed session and a receipt', async () => {
    await rv.goto(`/app/bookings/${state.raviBooking}`);
    await rv.waitForFunction(() => document.querySelector('[data-testid=booking-status]')?.textContent === 'Completed');
    await rv.getByTestId('receipt-button').click();
    await rv.getByTestId('receipt').waitFor();
    return await shot(rv, 'driver-receipt');
  });

  // ---------------------------------------------------------------- 10: isolation
  const pCtx = await newContext(browser);
  const vv = await pCtx.newPage();
  await step('10', "Another partner cannot open this partner's station, booking or revenue", async () => {
    await signIn(vv, 'partner@greenplug.test', 'PartnerDemo2026');
    await vv.goto(`/app/partner/stations/${state.stationId}`);
    await vv.getByTestId('station-access-denied').getByText('This station belongs to another partner.').waitFor();
    const f = await shot(vv, 'cross-partner-denied');
    const c = api(vv);
    const s = await c.get(`/api/partner/stations/${state.stationId}`);
    const e = await c.patch(`/api/partner/stations/${state.stationId}`, { name: 'Hijacked' });
    const bk = await c.get(`/api/partner/bookings/${state.raviBooking}`);
    const act = await c.post(`/api/partner/bookings/${state.raviBooking}/cancel`, { reason: 'not mine' });
    const list = await c.get('/api/partner/bookings');
    const rev = await c.get('/api/partner/revenue');
    const drv = await api(as).get(`/api/bookings/${state.raviBooking}`);
    expect([s.status, e.status, bk.status, act.status].every((x) => x === 403), `${s.status}/${e.status}/${bk.status}/${act.status}`);
    expect(!list.body.bookings.some((b) => b.code === state.raviCode) && !rev.body.bookings.some((b) => b.code === state.raviCode), 'leak in lists');
    expect(drv.status === 403, `other driver → ${drv.status}`);
    const audit = (await api(ad).get('/api/admin/audit')).body.entries.filter((x) => x.action === 'ownership.denied').length;
    return `station GET/PATCH, booking GET/cancel → 403; not in other partner's lists/revenue; other driver → 403; ${audit} ownership.denied audit entries; ${f}`;
  });
  await step('—', 'Home charger privacy: approximate location, no host contact, no directions', async () => {
    const r = (await api(vv).get('/api/stations?access=HOME')).body.stations[0];
    expect(!r.exactLocation && r.operator === 'Private home host' && /exact address shared/.test(r.address), JSON.stringify(r).slice(0, 200));
    await rv.goto(`/app/stations/${r.id}`);
    await rv.getByText(/Private listing: the map shows an approximate area/).waitFor();
    expect((await rv.getByRole('link', { name: 'Directions' }).count()) === 0, 'directions exposed');
    return `${r.name}: operator "${r.operator}", ${await shot(rv, 'home-charger-private')}`;
  });

  // ---------------------------------------------------------------- active booking survives mode switch
  await step('2', 'Active booking stays intact while switching EV Driver ⇄ Station Partner', async () => {
    const mvp = (await api(k).get('/api/stations?q=MVP')).body.stations[0];
    await k.goto(`/app/stations/${mvp.id}`);
    await prepareSlot(k, { connector: 'DC', duration: '60', dayIndex: 1, kwh: '8' });
    await k.locator('[data-testid=slot-grid] .slot:not([disabled])').first().click();
    await k.getByTestId('book-button').click();
    await k.getByTestId('pay-success').click();
    await k.waitForURL(/\/app\/bookings\//);
    await k.waitForFunction(() => document.querySelector('[data-testid=booking-status]')?.textContent === 'Confirmed');
    const id = k.url().split('/').pop();
    const code = await text(k.getByTestId('booking-code'));
    await switchMode(k, 'partner');
    await k.waitForURL((u) => u.pathname === '/app/partner');
    await k.getByTestId('active-booking').getByText(code).waitFor();
    const f = await shot(k, 'partner-mode-with-active-booking');
    await switchMode(k, 'driver');
    await k.waitForURL((u) => u.pathname === '/app/');
    const b = (await api(k).get(`/api/bookings/${id}`)).body.booking;
    const vehicles = (await api(k).get('/api/me/vehicles')).body.vehicles.length;
    expect(b.status === 'CONFIRMED' && vehicles === 1, `${b.status}, vehicles ${vehicles}`);
    return `${code} remained CONFIRMED and visible in both modes; vehicles & history preserved; ${f}`;
  });

  // ---------------------------------------------------------------- admin restricted
  await step('12', 'Admin workspace is restricted for non-admins (UI + API)', async () => {
    await as.goto('/app/admin');
    await as.getByTestId('access-denied').waitFor();
    const r = await api(as).get('/api/admin/overview');
    const s = await api(as).patch('/api/admin/settings', { customerFeeBps: 0 });
    expect(r.status === 403 && s.status === 403, `${r.status}/${s.status}`);
    return `GET overview ${r.status}, PATCH settings ${s.status}; ${await shot(as, 'admin-denied')}`;
  });

  // ---------------------------------------------------------------- 13: themes + mobile
  await step('13', 'Dark theme toggles and persists across reloads', async () => {
    await as.goto('/app/');
    await as.getByTestId('station-card').first().waitFor();
    await as.locator('.topbar .theme-toggle').click();
    await as.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await as.waitForTimeout(800);
    const f = await shot(as, 'discover-dark');
    await as.reload();
    await as.getByTestId('station-card').first().waitFor();
    expect((await as.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'theme not persisted');
    await as.goto(`/app/bookings/${state.ashaBooking}`);
    await as.getByTestId('booking-detail').waitFor();
    const f2 = await shot(as, 'booking-dark');
    await as.locator('.topbar .theme-toggle').click();
    return `${f}, ${f2}`;
  });
  const mCtx = await newContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mb = await mCtx.newPage();
  await step('13', 'Mobile 390×844: layout fits, bottom navigation, SWITCH MODE works', async () => {
    await signIn(mb, 'asha@greenplug.test', 'DriverDemo2026');
    await mb.goto('/app/');
    await mb.getByTestId('station-card').first().waitFor();
    const over = await mb.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over <= 0, `horizontal overflow ${over}px`);
    expect(await mb.locator('.bottombar').isVisible(), 'no bottom bar');
    const f1 = await shot(mb, 'mobile-discover');
    await mb.goto(`/app/stations/${state.stationId}`);
    await mb.getByTestId('booking-panel').scrollIntoViewIfNeeded();
    const f2 = await shot(mb, 'mobile-booking-panel');
    await switchMode(mb, 'partner', true);
    await mb.waitForURL(/\/app\/partner\/apply/);
    await mb.getByRole('heading', { name: 'Become a station partner' }).waitFor();
    const f3 = await shot(mb, 'mobile-partner-onboarding');
    return `no overflow; ${f1}, ${f2}, ${f3}`;
  });
  const mkCtx = await newContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mk = await mkCtx.newPage();
  await step('13', 'Mobile: approved partner switches to the partner dashboard', async () => {
    await signIn(mk, DRIVER.email, DRIVER.password);
    await mk.goto('/app/');
    await switchMode(mk, 'partner', true);
    await mk.waitForURL((u) => u.pathname === '/app/partner');
    await mk.getByRole('heading', { name: 'Partner dashboard' }).waitFor();
    return await shot(mk, 'mobile-partner-dashboard');
  });

  // ---------------------------------------------------------------- 12: persistence across a server restart
  if (OWN) {
    await step('12', 'Data persists in PostgreSQL across a server restart', async () => {
      await stopServer();
      await startServer();
      await rv.goto(`/app/bookings/${state.raviBooking}`);
      await rv.waitForFunction(() => document.querySelector('[data-testid=booking-status]')?.textContent === 'Completed');
      const st = (await api(k).get(`/api/partner/stations/${state.stationId}`)).body.station;
      expect(st.listingStatus === 'APPROVED' && st.connectors.length === 2, 'station lost');
      return 'server restarted; booking, session cookie, station and connectors intact';
    });
  }
  await step('—', 'No uncaught errors in the browser console', async () => {
    expect(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    return 'clean';
  });
} catch {
  /* reported below */
} finally {
  await browser.close();
  if (OWN) await stopServer();
  const passed = results.filter((r) => r.ok).length;
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), passed, total: results.length, results, consoleErrors }, null, 2));
  console.log(`\n${passed}/${results.length} steps passed. Screenshots: tests/e2e/artifacts/\n`);
  process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
}
