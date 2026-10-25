// Payment-provider adapters. The TEST provider simulates a gateway locally (no money moves) and signs its
// webhooks exactly like a real provider would, so the trusted-webhook path is exercised end to end.
// The Razorpay adapter is written against the provider's documented REST/webhook contract but stays disabled
// until merchant onboarding, credentials and webhook verification are configured (PAYMENTS_LIVE_ENABLED).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { ApiError } from '../lib/errors';

export type WebhookEvent = {
  id: string;
  type: 'payment.captured' | 'payment.failed';
  orderRef: string;
  paymentRef: string | null;
  amountPaise: number;
  reason?: string;
};

export interface PaymentProvider {
  name: 'test' | 'razorpay';
  createOrder(input: { amountPaise: number; receipt: string }): Promise<{ providerOrderRef: string }>;
  refund(input: { providerPaymentRef: string; amountPaise: number }): Promise<{ status: 'PROCESSED' | 'FAILED'; providerRefundRef: string | null }>;
  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent;
}

const hmac = (secret: string, raw: Buffer | string) => createHmac('sha256', secret).update(raw).digest('hex');
function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export const testProvider: PaymentProvider = {
  name: 'test',
  async createOrder() {
    return { providerOrderRef: `test_order_${randomBytes(9).toString('hex')}` };
  },
  async refund({ amountPaise }) {
    if (amountPaise <= 0) return { status: 'FAILED', providerRefundRef: null };
    return { status: 'PROCESSED', providerRefundRef: `test_rfnd_${randomBytes(8).toString('hex')}` };
  },
  verifyWebhook(raw, headers) {
    const sig = String(headers['x-gpev-test-signature'] || '');
    if (!safeEqualHex(sig, hmac(config.payments.webhookSecret, raw))) throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed.');
    const e = JSON.parse(raw.toString('utf8'));
    if (!e || typeof e.id !== 'string' || !['payment.captured', 'payment.failed'].includes(e.type)) throw new ApiError(400, 'WEBHOOK_INVALID', 'Unsupported webhook payload.');
    return { id: e.id, type: e.type, orderRef: String(e.data?.order_ref || ''), paymentRef: e.data?.payment_ref ?? null, amountPaise: Number(e.data?.amount_paise || 0), reason: e.data?.reason };
  },
};

/** Builds and signs a webhook as the TEST gateway would send it. Demo mode only. */
export function signTestEvent(type: WebhookEvent['type'], orderRef: string, amountPaise: number, reason?: string) {
  const body = JSON.stringify({
    id: `evt_test_${randomBytes(10).toString('hex')}`,
    type,
    created_at: new Date().toISOString(),
    data: { order_ref: orderRef, payment_ref: type === 'payment.captured' ? `test_pay_${randomBytes(8).toString('hex')}` : null, amount_paise: amountPaise, reason },
  });
  return { body, signature: hmac(config.payments.webhookSecret, body) };
}

export const razorpayProvider: PaymentProvider = {
  name: 'razorpay',
  async createOrder({ amountPaise, receipt }) {
    assertLive();
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.payments.razorpayKeyId}:${config.payments.razorpayKeySecret}`).toString('base64')}` },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
    });
    if (!res.ok) throw new ApiError(502, 'PAYMENT_PROVIDER_ERROR', `Payment provider rejected the order (HTTP ${res.status}).`);
    const j = (await res.json()) as { id: string };
    return { providerOrderRef: j.id };
  },
  async refund({ providerPaymentRef, amountPaise }) {
    assertLive();
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(providerPaymentRef)}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.payments.razorpayKeyId}:${config.payments.razorpayKeySecret}`).toString('base64')}` },
      body: JSON.stringify({ amount: amountPaise }),
    });
    if (!res.ok) return { status: 'FAILED', providerRefundRef: null };
    const j = (await res.json()) as { id: string };
    // Refund completion is confirmed asynchronously by the provider's refund webhooks (to be wired with credentials).
    return { status: 'PROCESSED', providerRefundRef: j.id };
  },
  verifyWebhook(raw, headers) {
    assertLive();
    const sig = String(headers['x-razorpay-signature'] || '');
    if (!safeEqualHex(sig, hmac(config.payments.webhookSecret, raw))) throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed.');
    const e = JSON.parse(raw.toString('utf8'));
    const p = e?.payload?.payment?.entity;
    const type = e?.event === 'payment.captured' ? 'payment.captured' : e?.event === 'payment.failed' ? 'payment.failed' : null;
    if (!type || !p) throw new ApiError(400, 'WEBHOOK_INVALID', 'Unsupported webhook event.');
    const eventId = String(headers['x-razorpay-event-id'] || `${e.event}:${p.id}`);
    return { id: eventId, type, orderRef: p.order_id, paymentRef: p.id, amountPaise: Number(p.amount), reason: p.error_description };
  },
};

function assertLive() {
  if (!config.payments.liveEnabled || !config.payments.razorpayKeyId || !config.payments.razorpayKeySecret)
    throw new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', 'Live payment collection is disabled until merchant credentials and webhook verification are configured.');
}

export function providerFor(name: string): PaymentProvider {
  if (name === 'test') {
    if (config.nodeEnv === 'production' && !config.demoMode) throw new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', 'The test payment provider is disabled in production.');
    return testProvider;
  }
  if (name === 'razorpay') return razorpayProvider;
  throw new ApiError(400, 'UNKNOWN_PROVIDER', 'Unknown payment provider.');
}
export const activeProvider = () => providerFor(config.payments.provider);
