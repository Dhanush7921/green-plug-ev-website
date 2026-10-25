// Email / SMS / push adapters. In demo mode messages are written to dev_outbox (shown in the app's
// clearly labelled "Demo inbox"); nothing is actually delivered. Real providers plug in here.
import { config } from '../config';
import type { Q } from '../db';
import { ApiError } from '../lib/errors';

export type Channel = 'email' | 'sms' | 'push';

export async function deliver(q: Q, channel: Channel, userId: string | null, recipient: string, subject: string, body: string) {
  const provider = channel === 'email' ? config.messaging.emailProvider : channel === 'sms' ? config.messaging.smsProvider : config.messaging.pushProvider;
  if (provider === 'demo') {
    await q`INSERT INTO dev_outbox (user_id, channel, recipient, subject, body) VALUES (${userId}, ${channel}, ${recipient}, ${subject}, ${body})`;
    return { delivered: false, demo: true };
  }
  // A real provider (e.g. an email API, SMS gateway or FCM) needs an account and credentials. Not connected.
  throw new ApiError(503, 'MESSAGING_NOT_CONFIGURED', `${channel} provider "${provider}" is not connected in this build.`);
}

/** In-app notification plus a (demo) push message. */
export async function notify(q: Q, userId: string, kind: string, title: string, body: string, link: string | null = null) {
  await q`INSERT INTO notifications (user_id, kind, title, body, link) VALUES (${userId}, ${kind}, ${title}, ${body}, ${link})`;
  if (config.messaging.pushProvider === 'demo') await deliver(q, 'push', userId, userId, title, body);
}
