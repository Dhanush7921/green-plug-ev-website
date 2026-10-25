import { createHash, randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config';
import { sql, type Q } from '../db';
import { cookie, readCookie, type Ctx } from './http';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'gpev_sid';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  emailVerified: boolean;
  roles: ('driver' | 'partner' | 'admin')[];
  partnerId: string | null;
  partnerStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | null;
  preferences: Record<string, unknown>;
  sessionId: string;
};

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), expected.length, SCRYPT);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(ctx: Ctx, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  await sql`INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at)
            VALUES (${userId}, ${sha256(token)}, ${String(ctx.req.headers['user-agent'] || '').slice(0, 200)}, ${ctx.ip}, ${expires})`;
  ctx.headers['Set-Cookie'] = cookie(SESSION_COOKIE, token, config.sessionDays * 86400);
}

export async function loadUser(ctx: Ctx): Promise<AuthUser | null> {
  const token = readCookie(ctx.req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const rows = await sql`
    SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.full_name, u.phone, u.email_verified_at, u.preferences,
           ARRAY(SELECT role FROM user_roles r WHERE r.user_id = u.id ORDER BY role) AS roles,
           p.id AS partner_id, p.status AS partner_status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN partners p ON p.owner_user_id = u.id
    WHERE s.token_hash = ${sha256(token)} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL`;
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.lastSeenAt as string).getTime() > 5 * 60_000) {
    sql`UPDATE sessions SET last_seen_at = now() WHERE id = ${r.sessionId as string}`.catch(() => {});
  }
  return {
    id: r.id as string,
    email: r.email as string,
    fullName: r.fullName as string,
    phone: (r.phone as string) ?? null,
    emailVerified: !!r.emailVerifiedAt,
    roles: r.roles as AuthUser['roles'],
    partnerId: (r.partnerId as string) ?? null,
    partnerStatus: (r.partnerStatus as AuthUser['partnerStatus']) ?? null,
    preferences: (r.preferences as Record<string, unknown>) || {},
    sessionId: r.sessionId as string,
  };
}

export function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function audit(q: Q, ctx: Ctx | null, actorRole: string, action: string, entityType: string, entityId: string | null, detail: object = {}) {
  await q`INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, detail, request_id, ip)
          VALUES (${ctx?.user?.id ?? null}, ${actorRole}, ${action}, ${entityType}, ${entityId}, ${q.json(detail as never)}, ${ctx?.requestId ?? null}, ${ctx?.ip ?? null})`;
}
