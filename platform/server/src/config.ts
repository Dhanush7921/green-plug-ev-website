// Runtime configuration. Everything comes from environment variables (see platform/.env.example).
// Secrets stay on the server; nothing here is ever sent to the browser except the public flags in publicConfig().
const env = process.env;

function bool(v: string | undefined, d: boolean) {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(env.PORT || 8080),
  host: env.HOST || '127.0.0.1',
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:devpassword@127.0.0.1:5433/gpev_dev',
  appOrigin: env.APP_ORIGIN || `http://localhost:${env.PORT || 8080}`,
  nodeEnv: env.NODE_ENV || 'development',
  sessionDays: Number(env.SESSION_TTL_DAYS || 7),
  cookieSecure: bool(env.COOKIE_SECURE, false),
  // Demo mode exposes clearly labelled demo helpers (demo inbox, test checkout). Must be false in production.
  demoMode: bool(env.DEMO_MODE, true),
  payments: {
    provider: (env.PAYMENT_PROVIDER || 'test') as 'test' | 'razorpay',
    // Real collection stays off until merchant onboarding, credentials and webhook verification are done.
    liveEnabled: bool(env.PAYMENTS_LIVE_ENABLED, false),
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET || 'local-test-webhook-secret-change-me',
    razorpayKeyId: env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || '',
  },
  maps: {
    provider: (env.MAPS_PROVIDER || 'demo') as 'demo' | 'google',
    serverKey: env.MAPS_SERVER_API_KEY || '',
    browserKey: env.MAPS_BROWSER_API_KEY || '',
  },
  messaging: {
    emailProvider: env.EMAIL_PROVIDER || 'demo',
    smsProvider: env.SMS_PROVIDER || 'demo',
    pushProvider: env.PUSH_PROVIDER || 'demo',
  },
  storageDir: env.STORAGE_DIR || new URL('../storage/', import.meta.url).pathname,
  webDir: env.WEB_DIR || new URL('./web/', import.meta.url).pathname,
  sweepSeconds: Number(env.HOLD_SWEEP_SECONDS || 30),
  // multiplies every per-IP rate limit (automated test runs share one IP)
  rateLimitFactor: Number(env.RATE_LIMIT_FACTOR || 1),
};

export function publicConfig() {
  return {
    demoMode: config.demoMode,
    payments: { provider: config.payments.provider, live: config.payments.liveEnabled && config.payments.provider !== 'test' },
    maps: { provider: config.maps.provider, browserKey: config.maps.provider === 'google' ? config.maps.browserKey : '' },
  };
}

/** Refuses unsafe production settings at startup instead of failing silently later. */
export function productionProblems(): string[] {
  if (config.nodeEnv !== 'production') return [];
  const p: string[] = [];
  if (config.payments.webhookSecret === 'local-test-webhook-secret-change-me' || config.payments.webhookSecret.length < 24) p.push('PAYMENT_WEBHOOK_SECRET must be a strong secret (24+ characters).');
  if (config.demoMode) p.push('DEMO_MODE must be false in production (it enables the demo inbox and test checkout).');
  if (config.payments.provider === 'test') p.push('PAYMENT_PROVIDER=test cannot be used in production.');
  if (!config.cookieSecure) p.push('COOKIE_SECURE must be true in production (HTTPS only).');
  if (!/^https:\/\//.test(config.appOrigin)) p.push('APP_ORIGIN must be the public https:// origin.');
  return p;
}
