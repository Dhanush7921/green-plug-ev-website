import { config, publicConfig } from '../config';
import { sql } from '../db';
import { deliver } from '../adapters/messaging';
import { audit, createSession, generateCode, hashPassword, sha256, SESSION_COOKIE, verifyPassword, type AuthUser } from '../lib/auth';
import { ApiError, badRequest, conflict, unauthorized } from '../lib/errors';
import { cookie, type Ctx, type Router } from '../lib/http';
import { EMAIL, obj, oneOf, PHONE, str } from '../lib/validate';

export function publicUser(u: AuthUser | null) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    emailVerified: u.emailVerified,
    roles: u.roles,
    partner: u.partnerId ? { id: u.partnerId, status: u.partnerStatus } : null,
    preferences: u.preferences,
  };
}

async function sendVerification(userId: string, email: string) {
  const code = generateCode();
  await sql.begin(async (tx) => {
    await tx`UPDATE verification_codes SET consumed_at = now() WHERE user_id = ${userId} AND purpose = 'email_verify' AND consumed_at IS NULL`;
    await tx`INSERT INTO verification_codes (user_id, purpose, code_hash, expires_at) VALUES (${userId}, 'email_verify', ${sha256(code)}, now() + interval '15 minutes')`;
    await deliver(tx, 'email', userId, email, 'Your GREEN PLUG EV verification code', `Your verification code is ${code}. It expires in 15 minutes.`);
  });
}

function validPassword(pw: string) {
  if (pw.length < 10 || pw.length > 128) throw badRequest('Password must be 10–128 characters.', { field: 'password' });
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) throw badRequest('Password must include letters and numbers.', { field: 'password' });
}

export function authRoutes(r: Router) {
  r.get('/api/auth/me', (ctx) => ({ user: publicUser(ctx.user), config: publicConfig() }), { auth: 'public' });

  r.post(
    '/api/auth/register',
    async (ctx) => {
      const b = obj(ctx.body);
      const fullName = str(b, 'fullName', { max: 120, label: 'Full name' });
      const email = str(b, 'email', { max: 160, pattern: EMAIL, label: 'Email' }).toLowerCase();
      const phone = str(b, 'phone', { optional: true, max: 16, pattern: PHONE, label: 'Phone' }) || null;
      const password = typeof b.password === 'string' ? b.password : '';
      validPassword(password);
      const hash = await hashPassword(password);
      let userId = '';
      try {
        await sql.begin(async (tx) => {
          const [u] = await tx`INSERT INTO users (email, password_hash, full_name, phone) VALUES (${email}, ${hash}, ${fullName}, ${phone}) RETURNING id`;
          userId = u.id as string;
          // Every account starts with the EV Driver role. Partner and admin roles are granted only by an administrator.
          await tx`INSERT INTO user_roles (user_id, role) VALUES (${userId}, 'driver')`;
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
        throw e;
      }
      await sendVerification(userId, email);
      await createSession(ctx, userId);
      ctx.status = 201;
      return { ok: true, verificationSent: true, demoInbox: config.demoMode };
    },
    { auth: 'public', rateLimit: { key: 'register', max: 10, perSeconds: 600 } },
  );

  r.post(
    '/api/auth/login',
    async (ctx) => {
      const b = obj(ctx.body);
      const email = str(b, 'email', { max: 160, label: 'Email' }).toLowerCase();
      const password = typeof b.password === 'string' ? b.password : '';
      const [u] = await sql`SELECT id, password_hash, disabled_at FROM users WHERE email = ${email}`;
      // same response for unknown email and wrong password
      const ok = u && !u.disabledAt && (await verifyPassword(password, u.passwordHash as string));
      if (!ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      await createSession(ctx, u.id as string);
      return { ok: true };
    },
    { auth: 'public', rateLimit: { key: 'login', max: 12, perSeconds: 300 } },
  );

  r.post('/api/auth/logout', async (ctx) => {
    if (ctx.user) await sql`UPDATE sessions SET revoked_at = now() WHERE id = ${ctx.user.sessionId}`;
    ctx.headers['Set-Cookie'] = cookie(SESSION_COOKIE, '', 0);
    return { ok: true };
  }, { auth: 'public' });

  r.post(
    '/api/auth/verify-email',
    async (ctx) => {
      const u = ctx.user!;
      if (u.emailVerified) return { ok: true, alreadyVerified: true };
      const code = str(obj(ctx.body), 'code', { min: 6, max: 6, pattern: /^\d{6}$/, label: 'Code' });
      const [vc] = await sql`SELECT id, code_hash, attempts FROM verification_codes
                             WHERE user_id = ${u.id} AND purpose = 'email_verify' AND consumed_at IS NULL AND expires_at > now()
                             ORDER BY created_at DESC LIMIT 1`;
      if (!vc) throw badRequest('The code has expired. Request a new one.');
      if ((vc.attempts as number) >= 5) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Request a new code.');
      if (vc.codeHash !== sha256(code)) {
        await sql`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ${vc.id as string}`;
        throw badRequest('That code is not correct.', { field: 'code' });
      }
      await sql.begin(async (tx) => {
        await tx`UPDATE verification_codes SET consumed_at = now() WHERE id = ${vc.id as string}`;
        await tx`UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = ${u.id}`;
      });
      return { ok: true };
    },
    { rateLimit: { key: 'verify', max: 20, perSeconds: 600 } },
  );

  r.post('/api/auth/resend-code', async (ctx) => {
    if (ctx.user!.emailVerified) return { ok: true, alreadyVerified: true };
    await sendVerification(ctx.user!.id, ctx.user!.email);
    return { ok: true };
  }, { rateLimit: { key: 'resend', max: 5, perSeconds: 600 } });

  // ---- profile
  r.patch('/api/me', async (ctx) => {
    const b = obj(ctx.body);
    const u = ctx.user!;
    const fullName = b.fullName !== undefined ? str(b, 'fullName', { max: 120, label: 'Full name' }) : u.fullName;
    const phone = b.phone !== undefined ? str(b, 'phone', { optional: true, max: 16, pattern: PHONE, label: 'Phone' }) || null : u.phone;
    const prefs = { ...u.preferences };
    if (b.preferences && typeof b.preferences === 'object') {
      const p = b.preferences as Record<string, unknown>;
      if (p.theme !== undefined) prefs.theme = oneOf(p, 'theme', ['light', 'dark', 'system'] as const);
      if (p.notifyBookingUpdates !== undefined) prefs.notifyBookingUpdates = !!p.notifyBookingUpdates;
      if (p.notifyPromotions !== undefined) prefs.notifyPromotions = !!p.notifyPromotions;
      // only the preferred method type is stored; card/UPI details belong to the payment provider's hosted page
      if (p.preferredPaymentMethod !== undefined) prefs.preferredPaymentMethod = oneOf(p, 'preferredPaymentMethod', ['upi', 'card', 'netbanking', 'wallet'] as const);
    }
    await sql`UPDATE users SET full_name = ${fullName}, phone = ${phone}, preferences = ${sql.json(prefs as never)}, updated_at = now() WHERE id = ${u.id}`;
    return { ok: true };
  });

  /**
   * SWITCH MODE: tells the client which workspace the account may actually open. The answer is computed from
   * server-side roles and partner status; every partner/admin endpoint re-checks independently.
   */
  r.post('/api/me/workspace', async (ctx) => {
    const mode = oneOf(obj(ctx.body), 'mode', ['driver', 'partner', 'admin'] as const);
    const u = ctx.user!;
    let granted: 'driver' | 'partner-dashboard' | 'partner-onboarding' | 'admin' | 'denied' = 'driver';
    if (mode === 'partner') granted = u.roles.includes('partner') && u.partnerStatus === 'APPROVED' ? 'partner-dashboard' : 'partner-onboarding';
    if (mode === 'admin') granted = u.roles.includes('admin') ? 'admin' : 'denied';
    if (granted !== 'denied') {
      await sql`UPDATE users SET preferences = preferences || ${sql.json({ lastWorkspace: mode })} WHERE id = ${u.id}`;
    } else {
      await audit(sql, ctx, 'driver', 'workspace.denied', 'user', u.id, { mode });
    }
    return { mode, granted, partnerStatus: u.partnerStatus ?? 'NONE' };
  });

  r.get('/api/me/notifications', async (ctx) => {
    const rows = await sql`SELECT id, kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = ${ctx.user!.id} ORDER BY created_at DESC LIMIT 50`;
    return { notifications: rows, unread: rows.filter((n) => !n.readAt).length };
  });
  r.post('/api/me/notifications/read-all', async (ctx) => {
    await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${ctx.user!.id} AND read_at IS NULL`;
    return { ok: true };
  });

  // Demo inbox: shows what the demo email/SMS/push adapters would have sent to THIS user. Demo mode only.
  r.get('/api/demo/inbox', async (ctx) => {
    if (!config.demoMode) throw new ApiError(404, 'NOT_FOUND', 'Not available.');
    const rows = await sql`SELECT id, channel, recipient, subject, body, created_at FROM dev_outbox WHERE user_id = ${ctx.user!.id} ORDER BY created_at DESC LIMIT 30`;
    return { demo: true, messages: rows };
  });

  r.get('/api/integrations/status', () => ({
    demoMode: config.demoMode,
    integrations: [
      { key: 'maps', provider: config.maps.provider, status: config.maps.provider === 'demo' ? 'DEMO' : config.maps.serverKey ? 'CONFIGURED' : 'MISSING_CREDENTIALS', note: 'Demo map, gazetteer geocoding and straight-line routes when no provider key is set.' },
      { key: 'payments', provider: config.payments.provider, status: config.payments.provider === 'test' ? 'TEST_MODE' : config.payments.liveEnabled ? 'CONFIGURED' : 'DISABLED', note: 'No real money is collected. Bookings confirm only after a signed provider webhook.' },
      { key: 'email', provider: config.messaging.emailProvider, status: config.messaging.emailProvider === 'demo' ? 'DEMO' : 'CONFIGURED', note: 'Verification codes go to the in-app demo inbox.' },
      { key: 'sms', provider: config.messaging.smsProvider, status: config.messaging.smsProvider === 'demo' ? 'DEMO' : 'CONFIGURED', note: 'No SMS is sent.' },
      { key: 'push', provider: config.messaging.pushProvider, status: config.messaging.pushProvider === 'demo' ? 'DEMO' : 'CONFIGURED', note: 'In-app notifications only.' },
      { key: 'charger_telemetry', provider: 'none', status: 'NOT_CONNECTED', note: 'No OCPP/OCPI integration. Availability is host-declared; energy is host-entered.' },
      { key: 'payouts', provider: 'none', status: 'NOT_CONNECTED', note: 'Payout statements are records only; no money is transferred.' },
    ],
  }), { auth: 'public' });
}

export async function requireVerified(ctx: Ctx) {
  if (!ctx.user) throw unauthorized();
  if (!ctx.user.emailVerified) throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address first.');
}
