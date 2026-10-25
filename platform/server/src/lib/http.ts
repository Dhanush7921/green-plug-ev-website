import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { ApiError, forbidden, unauthorized } from './errors';
import type { AuthUser } from './auth';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  rawBody: Buffer;
  user: AuthUser | null;
  requestId: string;
  ip: string;
  status: number;
  headers: Record<string, string | string[]>;
};

export type Role = 'driver' | 'partner' | 'admin';
type Opts = {
  /** 'public' = no session needed; 'user' = any signed-in user (default) */
  auth?: 'public' | 'user';
  /** role that must be granted server-side (from user_roles), e.g. 'admin' */
  role?: Role;
  /** for partner routes: the caller's partner organisation must be APPROVED */
  approvedPartner?: boolean;
  bodyLimit?: number;
  /** skip the CSRF header requirement (signed provider webhooks) */
  noCsrf?: boolean;
  rateLimit?: { key: string; max: number; perSeconds: number };
};
type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler; opts: Opts };

export class Router {
  routes: Route[] = [];
  private add(method: string, path: string, handler: Handler, opts: Opts = {}) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        path.replace(/:([a-zA-Z]+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, re, keys, handler, opts });
  }
  get = (p: string, h: Handler, o?: Opts) => this.add('GET', p, h, o);
  post = (p: string, h: Handler, o?: Opts) => this.add('POST', p, h, o);
  patch = (p: string, h: Handler, o?: Opts) => this.add('PATCH', p, h, o);
  put = (p: string, h: Handler, o?: Opts) => this.add('PUT', p, h, o);
  delete = (p: string, h: Handler, o?: Opts) => this.add('DELETE', p, h, o);
  match(method: string, path: string) {
    let methodMismatch = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return methodMismatch ? 'METHOD' : null;
  }
}

// ---- simple in-memory rate limiter (per process; use a shared store when running several instances)
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, perSeconds: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + perSeconds * 1000 });
    return;
  }
  b.n++;
  if (b.n > max) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function cookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${config.cookieSecure ? '; Secure' : ''}`;
}
export function readCookie(req: IncomingMessage, name: string) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

export function newRequestId() {
  return randomUUID();
}

export async function runRoute(router: Router, ctx: Ctx, loadUser: (ctx: Ctx) => Promise<AuthUser | null>) {
  const m = router.match(ctx.method, ctx.url.pathname);
  if (m === 'METHOD') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  if (!m) throw new ApiError(404, 'NOT_FOUND', 'No such API endpoint.');
  const { route, params } = m;
  ctx.params = params;
  const opts = route.opts;
  const mutating = ctx.method !== 'GET' && ctx.method !== 'HEAD';

  if (opts.rateLimit) rateLimit(`${opts.rateLimit.key}:${ctx.ip}`, opts.rateLimit.max * config.rateLimitFactor, opts.rateLimit.perSeconds);

  ctx.user = await loadUser(ctx);
  if (mutating && !opts.noCsrf) {
    // CSRF defence for cookie-authenticated requests: custom header + same-origin check.
    if (ctx.req.headers['x-gpev-csrf'] !== '1') throw forbidden('Missing request verification header.', 'CSRF_FAILED');
    const origin = ctx.req.headers.origin;
    if (origin && !sameOrigin(origin)) throw forbidden('Cross-site request blocked.', 'CSRF_FAILED');
  }
  if ((opts.auth ?? 'user') === 'user' && !ctx.user) throw unauthorized();
  if (opts.role && !ctx.user?.roles.includes(opts.role)) {
    if (opts.role === 'partner') throw partnerDenied(ctx.user);
    throw forbidden(`This action needs the ${opts.role} role.`, 'ROLE_REQUIRED');
  }
  if (opts.approvedPartner && (!ctx.user?.partnerId || ctx.user.partnerStatus !== 'APPROVED')) throw partnerDenied(ctx.user);

  if (mutating || ctx.method === 'POST') {
    ctx.rawBody = await readBody(ctx.req, opts.bodyLimit ?? 256 * 1024);
    if (ctx.rawBody.length) {
      try {
        ctx.body = JSON.parse(ctx.rawBody.toString('utf8'));
      } catch {
        throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
      }
    } else ctx.body = {};
  }
  return route.handler(ctx);
}

function partnerDenied(user: AuthUser | null) {
  const status = user?.partnerStatus;
  const message =
    status === 'PENDING'
      ? 'Your station-partner application is awaiting approval.'
      : status === 'REJECTED'
        ? 'Your station-partner application was not approved.'
        : status === 'SUSPENDED'
          ? 'Your station-partner account is suspended.'
          : 'Register as a station partner to use the partner workspace.';
  return new ApiError(403, 'PARTNER_NOT_APPROVED', message, { partnerStatus: status ?? 'NONE' });
}

function sameOrigin(origin: string) {
  try {
    const o = new URL(origin);
    const a = new URL(config.appOrigin);
    if (o.host === a.host) return true;
    // local development: any localhost/127.0.0.1 port
    return config.nodeEnv !== 'production' && ['localhost', '127.0.0.1'].includes(o.hostname);
  } catch {
    return false;
  }
}
