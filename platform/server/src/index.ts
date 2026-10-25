import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { config, productionProblems } from './config';
import { sql } from './db';
import { loadUser } from './lib/auth';
import { expireHolds } from './lib/bookingFlow';
import { ApiError } from './lib/errors';
import { newRequestId, Router, runRoute, send, type Ctx } from './lib/http';
import { adminRoutes } from './modules/admin';
import { authRoutes } from './modules/auth';
import { bookingRoutes } from './modules/bookings';
import { driverRoutes } from './modules/driver';
import { partnerRoutes } from './modules/partner';
import { stationRoutes } from './modules/stations';

export const router = new Router();
router.get('/api/health', async () => {
  await sql`SELECT 1`;
  return { ok: true, database: 'up', demoMode: config.demoMode, time: new Date().toISOString() };
}, { auth: 'public' });
authRoutes(router);
stationRoutes(router);
bookingRoutes(router);
driverRoutes(router);
partnerRoutes(router);
adminRoutes(router);

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon' };

function securityHeaders(res: http.ServerResponse) {
  const maps = config.maps.provider === 'google' ? ' https://maps.googleapis.com https://maps.gstatic.com' : '';
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${maps}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:${maps}; font-src 'self' https://fonts.gstatic.com; connect-src 'self'${maps}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
}

function serveFile(res: http.ServerResponse, file: string, cache: string) {
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  createReadStream(file).pipe(res);
}

function serveStatic(res: http.ServerResponse, pathname: string) {
  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { Location: '/app/' });
    return res.end();
  }
  if (pathname.startsWith('/media/photos/')) {
    const f = path.join(config.storageDir, 'photos', path.basename(pathname));
    if (existsSync(f)) return serveFile(res, f, 'public, max-age=86400');
  }
  if (pathname.startsWith('/app')) {
    const rel = decodeURIComponent(pathname.replace(/^\/app\/?/, ''));
    const f = path.join(config.webDir, rel);
    if (f.startsWith(config.webDir) && rel && existsSync(f) && statSync(f).isFile()) return serveFile(res, f, rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    const index = path.join(config.webDir, 'index.html');
    if (existsSync(index)) return serveFile(res, index, 'no-cache'); // SPA fallback
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

export function createServer() {
  return http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url || '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    const ctx: Ctx = {
      req,
      res,
      method: req.method || 'GET',
      url,
      params: {},
      query: url.searchParams,
      body: {},
      rawBody: Buffer.alloc(0),
      user: null,
      requestId: newRequestId(),
      ip: (req.socket.remoteAddress || '').replace('::ffff:', ''),
      status: 200,
      headers: {},
    };
    const t0 = Date.now();
    try {
      const out = await runRoute(router, ctx, loadUser);
      send(res, ctx.status, out, { ...ctx.headers, 'X-Request-Id': ctx.requestId });
    } catch (e) {
      let err = e as ApiError;
      if (!(e instanceof ApiError)) {
        const pg = e as { code?: string; message?: string };
        if (pg.code === '23514' || pg.code === '22P02' || pg.code === '22007') err = new ApiError(400, 'VALIDATION_FAILED', 'Some values are not valid.');
        else if (pg.code === '23505') err = new ApiError(409, 'DUPLICATE', 'That record already exists.');
        else if (pg.code === '23503') err = new ApiError(409, 'REFERENCE_CONFLICT', 'A related record is missing or still in use.');
        else {
          console.error(`[${ctx.requestId}] ${ctx.method} ${url.pathname}`, e);
          err = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
        }
      }
      send(res, err.status, { error: { code: err.code, message: err.message, details: err.details, requestId: ctx.requestId } }, { ...ctx.headers, 'X-Request-Id': ctx.requestId });
    } finally {
      if (process.env.LOG_REQUESTS !== '0') console.log(`${new Date().toISOString()} ${ctx.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms ${ctx.requestId.slice(0, 8)}`);
    }
  });
}

if (process.argv[1] && /server\.m?js$/.test(process.argv[1])) {
  const server = createServer();
  const problems = productionProblems();
  if (problems.length) {
    console.error('Refusing to start with unsafe production configuration:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  server.listen(config.port, config.host, () => console.log(`GREEN PLUG EV platform API on http://${config.host}:${config.port}  (demo mode: ${config.demoMode}, payments: ${config.payments.provider})`));
  const sweep = setInterval(() => expireHolds(sql).catch((e) => console.error('hold sweep failed', e)), config.sweepSeconds * 1000);
  const stop = async () => {
    clearInterval(sweep);
    server.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
