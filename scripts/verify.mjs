// End-to-end checks with Playwright against the production build, served the way GitHub Pages
// serves it (files under BASE_PATH, unknown paths -> 404.html). Screenshots go to test-results/.
// Usage: npm run build && npm run verify        (or BASE_PATH=/green-plug-ev-website/ for both)
// Set VERIFY_QUICK=1 to skip the slow per-page theme/viewport sweep.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root, normalizeBase } from './build.mjs';
import { startPreview } from './preview.mjs';

const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try {
    playwright = require(p);
    break;
  } catch {
    /* try next */
  }
}
if (!playwright) throw new Error('Playwright is required: npm i -D playwright && npx playwright install chromium');

const base = normalizeBase(process.env.BASE_PATH || '/');
const port = 4321;
const origin = `http://localhost:${port}`;
const out = path.join(root, 'test-results');
fs.mkdirSync(out, { recursive: true });
const ROUTES = ['/', '/how-it-works', '/drivers', '/hosts', '/safety', '/faq', '/contact'];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const url = (p) => `${origin}${base}${p.replace(/^\//, '')}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const IGNORE = /KHR_parallel_shader_compile|GPU stall|Automatic fallback to software WebGL|GL_CLOSE_PATH/i;

const server = await startPreview(port);
const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function newPage(vp, opts = {}, { lag = true } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: 1, hasTouch: vp === 'mobile', isMobile: vp === 'mobile', ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  // This container renders WebGL in software (~1 fps), and shader compilation blocks the main
  // thread. Make GSAP follow wall-clock time so animations reach their end states; real browsers
  // do not need this.
  if (lag)
    await page.addInitScript(() => {
      const t = setInterval(() => {
        if (window.__gsap) {
          window.__gsap.ticker.lagSmoothing(0);
          clearInterval(t);
        }
      }, 5);
    });
  const errors = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.test(m.text())) errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // ERR_ABORTED = a download cancelled by navigating away, not a failure
  page.on('requestfailed', (r) => !/ERR_ABORTED/.test(r.failure()?.errorText || '') && errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  return { ctx, page, errors };
}

async function waitScene(page) {
  if (!(await page.locator('.cine').count())) return null;
  await page.waitForFunction(() => ['3d', 'fallback'].includes(document.querySelector('.cine')?.dataset.mode), null, { timeout: 300000 });
  return page.getAttribute('.cine', 'data-mode');
}
/** Fast-forward entrance timelines (not scroll-linked or repeating ones). */
async function settle(page, ms = 1500) {
  await page.evaluate(() => {
    const g = window.__gsap;
    if (!g) return;
    g.globalTimeline.getChildren(true, true, true).forEach((t) => {
      let skip = false;
      for (let p = t; p && p !== g.globalTimeline; p = p.parent) if (p.scrollTrigger || p.paused() || p.repeat() === -1) skip = true;
      if (!skip) t.progress(1);
    });
  });
  await wait(ms);
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const diag = (page) => page.evaluate(() => window.__scene?.diagnostics());

try {
  // ---------- 1. logo ----------
  {
    const { ctx, page } = await newPage('desktop');
    await page.goto(url('/faq'), { waitUntil: 'load' });
    await wait(1200);
    const nav = await page.evaluate(() => {
      const svg = document.querySelector('.nav .logo');
      const r = svg?.getBoundingClientRect();
      return { glyphs: svg?.querySelectorAll('.glyph').length, pill: !!svg?.querySelector('.logo-pill'), w: r?.width, h: r?.height, fill: svg && getComputedStyle(svg.querySelector('.logo-word')).fill };
    });
    check('Logo: nav wordmark renders (9 glyphs + EV pill)', nav.glyphs === 9 && nav.pill && nav.w > 120 && nav.h > 20, JSON.stringify(nav));
    const footer = await page.locator('.footer-logo .glyph').count();
    check('Logo: footer logo renders', footer === 9);
    for (const f of ['favicon.svg', 'brand/logo-on-light.svg', 'brand/logo-on-dark.svg', 'brand/app-icon.svg', 'brand/mark.svg']) {
      const res = await page.request.get(url(`/${f}`));
      check(`Logo asset ${f} served`, res.ok() && (await res.text()).includes('<svg'));
    }
    await page.locator('.nav-logo').screenshot({ path: path.join(out, 'logo-nav-light.png') });
    await ctx.close();
  }

  // ---------- 2. intro: once per session, skippable ----------
  {
    const { ctx, page, errors } = await newPage('desktop', {}, { lag: false });
    await page.goto(url('/?nowebgl'), { waitUntil: 'load' });
    await wait(1800);
    const shown = await page.locator('.intro').count();
    const skip = await page.locator('.ii-skip').isVisible().catch(() => false);
    check('Intro plays on first home visit', shown === 1);
    check('Intro has a visible Skip button', skip);
    await wait(1800);
    await page.screenshot({ path: path.join(out, 'intro-mid.png') });
    await page.locator('.ii-skip').click();
    await wait(900);
    const gone = await page.locator('.intro').count();
    const locked = await page.evaluate(() => document.documentElement.classList.contains('intro-active'));
    check('Skip removes the intro and unlocks scrolling', gone === 0 && !locked);
    await page.reload({ waitUntil: 'load' });
    await wait(1200);
    check('Intro does not replay in the same session', (await page.locator('.intro').count()) === 0);
    check('Intro: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
    // natural completion + hand-off
    const n = await newPage('desktop', {}, { lag: false });
    await n.page.goto(url('/?nowebgl'), { waitUntil: 'load' });
    await n.page.waitForSelector('.intro', { state: 'detached', timeout: 15000 }).catch(() => {});
    const elapsed = await n.page.evaluate(() => performance.now());
    check('Intro hands over to the page by itself (≤ 8 s safety cap)', (await n.page.locator('.intro').count()) === 0 && !(await n.page.evaluate(() => document.documentElement.classList.contains('intro-active'))), `${(elapsed / 1000).toFixed(1)} s after navigation`);
    await n.ctx.close();
    const r = await newPage('desktop', { reducedMotion: 'reduce' });
    await r.page.goto(url('/?nowebgl'), { waitUntil: 'load' });
    await wait(800);
    check('Reduced motion: intro skipped entirely', (await r.page.locator('.intro').count()) === 0);
    await r.ctx.close();
    const o = await newPage('desktop');
    await o.page.goto(url('/faq'), { waitUntil: 'load' });
    await wait(800);
    check('Intro does not block secondary pages', (await o.page.locator('.intro').count()) === 0);
    await o.ctx.close();
  }

  // ---------- 3-9. hero scene, connection, scroll story ----------
  {
    const { ctx, page, errors } = await newPage('desktop');
    await page.goto(url('/?nointro'), { waitUntil: 'load' });
    const mode = await waitScene(page);
    check('Hero renders a genuine WebGL scene', mode === '3d', `mode=${mode}`);
    const car = await page.getAttribute('.cine-canvas', 'data-car');
    check('Hero uses the detailed car model (not the fallback car)', car === 'model', car);
    // let the connection play to the end
    await page.evaluate(() => void (window.__tl = window.__scene.replayConnection()).pause().progress(0.15));
    await wait(1500);
    const d1 = await diag(page);
    await page.screenshot({ path: path.join(out, 'connect-early.png') });
    await page.evaluate(() => void (window.__tl = window.__scene.replayConnection()).pause().progress(0.27));
    await wait(1500);
    await page.screenshot({ path: path.join(out, 'connect-aligning.png') });
    await page.evaluate(() => void (window.__tl = window.__scene.replayConnection()).pause().progress(0.36));
    await wait(1500);
    const dIns = await diag(page);
    await page.screenshot({ path: path.join(out, 'connect-inserting.png') });
    await page.evaluate(() => void window.__tl.progress(1).play());
    await wait(4000);
    const d = await diag(page);
    await page.screenshot({ path: path.join(out, 'connect-final.png') });
    check('Connection sequence passes through opening/aligning/inserting', d1 && ['opening', 'aligning'].includes(d1.step) && dIns && ['inserting', 'locked', 'charging'].includes(dIns.step), `${d1?.step} -> ${dIns?.step}`);
    check('Connector seats on the inlet (position)', d && d.seatGap < 0.002, `gap=${d?.seatGap?.toFixed(4)} m`);
    check('Connector aligned with the inlet axis', d && d.axisErrorDeg < 1, `${d?.axisErrorDeg?.toFixed(2)}°`);
    check('Inlet door open in final state', d && d.doorOpen > 1.5, d?.doorOpen?.toFixed(2));
    check('Cable stays attached at both ends', d && d.carCable.endGap < 0.01 && d.carCable.startGap < 0.01, JSON.stringify(d?.carCable));
    check('Cable does not pass through the car body collider or floor', d && d.carCable.inside === 0 && d.carCable.belowGround === 0, `inside=${d?.carCable.inside}, below=${d?.carCable.belowGround}`);
    check('Charging indicator active after connection', d && d.step === 'charging' && d.ledIntensity > 0.5, `step=${d?.step}, led=${d?.ledIntensity?.toFixed(2)}`);
    const hud = await page.getAttribute('.hud', 'data-step');
    const pct = await page.locator('.hud-pct').textContent();
    check('HUD shows charging state (labelled simulation)', hud === 'charging' && /%/.test(pct) && (await page.locator('.hud .badge', { hasText: 'Simulation' }).count()) === 1, `${hud} ${pct}`);
    const anchor = await page.locator('.anchor').first().evaluate((el) => el.style.transform);
    check('Labels anchored to 3D positions', /translate3d\(\d/.test(anchor), anchor);
    const shot = () => page.screenshot({ clip: { x: 500, y: 150, width: 900, height: 600 } });
    const a = await shot();
    await wait(1200);
    const b = await shot();
    check('Energy animation: scene changes between frames while charging', Buffer.compare(a, b) !== 0);
    await page.mouse.move(200, 200);
    await page.mouse.move(1300, 700, { steps: 8 });
    await wait(1200);
    const c = await shot();
    check('Scene responds to pointer (parallax)', Buffer.compare(b, c) !== 0);
    // scroll story
    const vh = 900;
    const shots = [
      ['story-bike', vh * 1.0],
      ['story-energy', vh * 2.0],
      ['story-city', -1],
    ];
    for (const [name, y] of shots) {
      await page.evaluate((v) => {
        const t = document.querySelector('.cine-track');
        window.scrollTo(0, v >= 0 ? v : t.offsetTop + t.offsetHeight - innerHeight - 5);
      }, y);
      await wait(3500);
      await page.screenshot({ path: path.join(out, `${name}.png`) });
    }
    const s = (await diag(page))?.scroll;
    check('Scroll drives the 3D camera through the story', s > 0.95, `scroll=${s?.toFixed(2)}`);
    const chapter = await page.getAttribute('.cine', 'data-chapter');
    check('Story reaches the discovery chapter', chapter === 'city', chapter);
    await page.locator('.seg-btn', { hasText: 'Bike' }).click();
    await wait(1500);
    const activePins = await page.locator('.anchor[data-chapter="city"][data-active]').count();
    check('Vehicle filter updates discovery pins', activePins === 1, `${activePins} active`);
    await page.screenshot({ path: path.join(out, 'story-city-bike.png') });
    // rest of home
    for (const sel of ['.features', '.benefits', '.preview', '.store-section']) {
      await page.evaluate((q) => document.querySelector(q).scrollIntoView({ block: 'start' }), sel);
      await wait(q(sel));
      await page.screenshot({ path: path.join(out, `home-${sel.slice(1)}.png`) });
    }
    const pv = await page.locator('.pv-card').first().evaluate((el) => el.style.transform);
    check('App preview cards fly out on scroll', /translate/.test(pv), pv.slice(0, 70));
    const store = await page.locator('.store-card').allTextContents();
    check('Store cards show Coming soon, no invented links', store.length === 2 && store.every((t) => /Coming soon/i.test(t)) && (await page.locator('a.store-card').count()) === 0);
    check('Home: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
    await ctx.close();
  }

  // ---------- 10. pointer system ----------
  {
    const { ctx, page } = await newPage('desktop');
    await page.goto(url('/how-it-works'), { waitUntil: 'load' });
    await wait(1500);
    await page.mouse.move(300, 300);
    await page.mouse.move(420, 380, { steps: 6 });
    await wait(700);
    check('Custom cursor active on desktop', await page.evaluate(() => document.documentElement.classList.contains('has-cursor')));
    const bead = await page.locator('.cursor-bead').evaluate((el) => el.style.transform);
    check('Glossy cursor follows the pointer', /translate/.test(bead) && /4\d\d/.test(bead), bead);
    const light = await page.locator('.cursor-light').evaluate((el) => el.style.transform);
    check('Mint light tracks the pointer', /translate/.test(light), light);
    const btn = page.locator('.cta-band .btn').first();
    await btn.scrollIntoViewIfNeeded();
    await wait(1200);
    const box = await btn.boundingBox();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.2, { steps: 6 });
    await wait(800);
    const mt = await btn.evaluate((el) => el.style.transform);
    check('Magnetic button pulls toward the pointer', /translate/.test(mt) && !/translate\(0px, 0px\)/.test(mt), mt);
    const gloss = await btn.evaluate((el) => [el.style.getPropertyValue('--mx'), el.style.getPropertyValue('--gloss')]);
    check('Glossy reflection follows the pointer (--mx, --gloss)', gloss[0].endsWith('px') && gloss[1] === '1', gloss.join(' '));
    const bs = await page.locator('.cursor-bead').evaluate((el) => el.style.transform);
    check('Cursor reacts to interactive hover', /scale\(2/.test(bs), bs);
    await page.goto(url('/drivers'), { waitUntil: 'load' });
    await wait(1500);
    const fb = page.locator('[data-tilt]').first();
    await fb.scrollIntoViewIfNeeded();
    await wait(2500);
    const fbb = await fb.boundingBox();
    await page.mouse.move(fbb.x + fbb.width * 0.8, fbb.y + fbb.height * 0.25, { steps: 8 });
    await wait(900);
    const tt = await fb.evaluate((el) => el.style.transform);
    check('3D card tilt responds to the pointer', /rotate[XY]\(-?[1-9]/.test(tt) || /rotateX\(-?\d+\.\d+deg\)/.test(tt), tt);
    await page.screenshot({ path: path.join(out, 'pointer-tilt.png') });
    await ctx.close();
  }

  // ---------- 11-12, 14. all pages, both themes, both viewports ----------
  if (!process.env.VERIFY_QUICK) {
    for (const vp of Object.keys(VIEWPORTS)) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page, errors } = await newPage(vp, { colorScheme: theme });
        for (const r of ROUTES) {
          await page.goto(url(r === '/' ? '/?nointro' : r), { waitUntil: 'load' });
          if (r === '/') await waitScene(page);
          await wait(1200);
          await settle(page, r === '/' ? 3000 : 1000);
          const h1 = (await page.locator('h1').first().textContent())?.trim();
          const t = await page.evaluate(() => document.documentElement.dataset.theme);
          const ox = await overflow(page);
          check(`[${vp}/${theme}] ${r} renders`, h1 && h1.length > 5 && t === theme, `h1="${h1?.slice(0, 40)}"`);
          check(`[${vp}/${theme}] ${r} no horizontal overflow`, ox <= 0, `overflow=${ox}px`);
          const name = `${vp}-${theme}-${r === '/' ? 'home' : r.slice(1)}`;
          await page.screenshot({ path: path.join(out, `${name}.png`) });
          if (r !== '/') {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
            await wait(1800);
            await settle(page, 600);
            await page.screenshot({ path: path.join(out, `${name}-mid.png`) });
            check(`[${vp}/${theme}] ${r} no overflow after scroll`, (await overflow(page)) <= 0);
          }
        }
        check(`[${vp}/${theme}] no console errors`, errors.length === 0, errors.slice(0, 4).join(' | '));
        await ctx.close();
      }
    }
  }

  // ---------- navigation, deep links, base path, mobile menu ----------
  {
    const { ctx, page, errors } = await newPage('desktop');
    await page.goto(url('/faq'), { waitUntil: 'load' });
    await wait(1500);
    check('Deep link renders the right page', (await page.locator('h1').textContent())?.includes('Straight answers'));
    for (const [label, p] of [
      ['How it works', '/how-it-works'],
      ['Drivers', '/drivers'],
      ['Hosts', '/hosts'],
      ['Safety', '/safety'],
      ['Contact', '/contact'],
      ['FAQ', '/faq'],
    ]) {
      await page.locator('.nav-links a', { hasText: label }).click();
      await wait(2000);
      check(`Nav "${label}" navigates`, page.url() === url(p), page.url());
    }
    await page.goBack();
    await wait(2000);
    check('Browser back works', page.url() === url('/contact'), page.url());
    await page.locator('.nav-logo').click();
    await wait(2500);
    check('Logo returns home', page.url() === url('/'), page.url());
    const assets = await page.evaluate(() => [...document.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="icon"]')].map((e) => e.getAttribute('src') || e.getAttribute('href')));
    check('Asset URLs use the base path', assets.length >= 3 && assets.every((a) => a.startsWith(base)), assets.join(', '));
    check('Navigation: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
    // (the browser logs the expected HTTP 404 for an unknown path, so this runs after the error check)
    await page.goto(url('/no-such-page'), { waitUntil: 'load' });
    await wait(1000);
    check('Unknown route shows the not-found page', /not plugged in/.test((await page.locator('h1').textContent()) || ''));
    await ctx.close();

    const m = await newPage('mobile');
    await m.page.goto(url('/drivers'), { waitUntil: 'load' });
    await wait(1500);
    check('Custom cursor disabled on touch devices', (await m.page.locator('.cursor-bead').count()) === 0);
    await m.page.locator('.menu-btn').click();
    await wait(1400);
    await m.page.screenshot({ path: path.join(out, 'mobile-menu.png') });
    check('Mobile menu opens', (await m.page.locator('.mobile-menu').evaluate((el) => getComputedStyle(el).visibility)) === 'visible');
    await m.page.keyboard.press('Escape');
    await wait(1000);
    check('Mobile menu closes with Escape', (await m.page.locator('.menu-btn').getAttribute('aria-expanded')) === 'false');
    await m.page.locator('.menu-btn').click();
    await wait(1400);
    await m.page.locator('.mobile-menu a', { hasText: 'FAQ' }).click();
    await wait(2500);
    check('Mobile menu navigation works', m.page.url() === url('/faq'), m.page.url());
    await m.ctx.close();
  }

  // ---------- theme toggle persistence ----------
  {
    const { ctx, page } = await newPage('desktop', { colorScheme: 'light' });
    await page.goto(url('/safety'), { waitUntil: 'load' });
    await wait(1200);
    await page.locator('.nav .theme-toggle').click();
    await wait(1400);
    const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.reload({ waitUntil: 'load' });
    await wait(800);
    const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
    check('Theme toggle switches and persists after reload', t1 === 'dark' && t2 === 'dark', `${t1} -> ${t2}`);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('Dark theme applies a deep-forest background', bg === 'rgb(4, 25, 26)', bg);
    await ctx.close();
  }

  // ---------- keyboard focus ----------
  {
    const { ctx, page } = await newPage('desktop');
    await page.goto(url('/contact'), { waitUntil: 'load' });
    await wait(1200);
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.className);
    check('First Tab reaches the skip link', /skip-link/.test(first || ''), first);
    let outline = '';
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    check('Focused controls show a visible focus ring', outline && outline !== 'none', outline);
    await ctx.close();
  }

  // ---------- 13. forms ----------
  {
    const { ctx, page, errors } = await newPage('desktop');
    await page.goto(url('/contact?form=general'), { waitUntil: 'load' });
    await wait(1500);
    const notice = await page.locator('.notice').first().textContent();
    check('Form shows a clear demo state when no endpoint is configured', /Demo mode/.test(notice), notice.slice(0, 70));
    await page.locator('form button[type="submit"]').click();
    await wait(600);
    const errs = await page.locator('.field-error').count();
    check('Empty submit shows validation errors', errs >= 4, `${errs} errors`);
    await page.fill('#f-general-name', 'Test Rider');
    await page.fill('#f-general-email', 'not-an-email');
    await page.locator('#f-general-email').blur();
    await wait(200);
    check('Invalid email rejected', (await page.locator('.field-error', { hasText: 'email' }).count()) === 1);
    await page.fill('#f-general-email', 'rider@example.com');
    await page.selectOption('#f-general-topic', { index: 1 });
    await page.fill('#f-general-message', 'Testing the general enquiry form.');
    await page.locator('input[name="consent"]').check();
    await page.locator('form button[type="submit"]').dblclick();
    await wait(1500);
    const res = await page.locator('.result').first().textContent();
    check('Valid submit in demo mode says nothing was sent or saved', /nothing was sent or saved/i.test(res), res.slice(0, 80));
    await page.screenshot({ path: path.join(out, 'form-demo-result.png') });
    for (const t of ['driver', 'host', 'partner']) {
      await page.goto(url(`/contact?form=${t}`), { waitUntil: 'load' });
      await wait(1200);
      const sel = await page.locator('.tab[aria-selected="true"]').getAttribute('data-tab');
      const form = await page.locator('form .field').count();
      check(`Contact: ${t} form selected from link and rendered`, sel === t && form >= 4, `${sel}, ${form} fields`);
    }
    check('Forms: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
    await ctx.close();
  }

  // ---------- reduced motion ----------
  {
    const { ctx, page, errors } = await newPage('desktop', { reducedMotion: 'reduce' });
    await page.goto(url('/'), { waitUntil: 'load' });
    const mode = await waitScene(page);
    await wait(2500);
    const d = await diag(page);
    check('Reduced motion: scene shows the connected end state without animating', mode === '3d' && d?.step === 'charging', `${mode} ${d?.step}`);
    check('Reduced motion: custom cursor off', (await page.locator('.cursor-bead').count()) === 0);
    const op = await page.locator('.hero-title').evaluate((el) => getComputedStyle(el).opacity);
    check('Reduced motion: content visible immediately', op === '1');
    await page.screenshot({ path: path.join(out, 'reduced-motion-home.png') });
    await page.locator('.nav-links a', { hasText: 'FAQ' }).click();
    await wait(700);
    check('Reduced motion: navigation is instant', page.url() === url('/faq'));
    check('Reduced motion: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
    await ctx.close();
  }

  // ---------- 15. WebGL unavailable ----------
  {
    const { ctx, page, errors } = await newPage('desktop');
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (/webgl/.test(type)) return null;
        return orig.call(this, type, ...rest);
      };
    });
    await page.goto(url('/?nointro'), { waitUntil: 'load' });
    await wait(2500);
    check('No-WebGL: fallback illustration shown', (await page.locator('.scene-fallback').count()) === 1);
    check('No-WebGL: page content still works', (await page.locator('.hero-title').count()) === 1 && (await overflow(page)) <= 0);
    await page.screenshot({ path: path.join(out, 'webgl-fallback.png') });
    check('No-WebGL: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

function q(sel) {
  return sel === '.preview' ? 4000 : 2600;
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ base, total: results.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ''}`);
process.exit(failed.length ? 1 : 0);
