// Booking state machine and money flows shared by driver, partner, admin and webhook handlers.
import { sql, type Q, type Tx } from '../db';
import { activeProvider, providerFor } from '../adapters/payments';
import { notify } from '../adapters/messaging';
import { ApiError, conflict } from './errors';
import { postCapture, postRefund } from './ledger';
import { rupees } from './money';

export type Status = 'RESERVED' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED_DRIVER' | 'CANCELLED_PARTNER' | 'EXPIRED' | 'PAYMENT_FAILED' | 'NO_SHOW';
export const ACTIVE: Status[] = ['RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'];

// Allowed transitions; anything else is rejected.
const NEXT: Record<Status, Status[]> = {
  RESERVED: ['CONFIRMED', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED_DRIVER', 'CANCELLED_PARTNER'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED_DRIVER', 'CANCELLED_PARTNER', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED_PARTNER'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED_DRIVER: [],
  CANCELLED_PARTNER: [],
  EXPIRED: [],
  PAYMENT_FAILED: [],
  NO_SHOW: [],
};

export type BookingRow = {
  id: string;
  code: string;
  driverId: string;
  stationId: string;
  connectorId: string;
  partnerId: string;
  status: Status;
  startsAt: Date;
  endsAt: Date;
  holdExpiresAt: Date | null;
  plannedKwh: number;
  ratePaise: number;
  feeBps: number;
  commissionBps: number;
  basePaise: number;
  customerFeePaise: number;
  customerTotalPaise: number;
  providerCommissionPaise: number;
  partnerAmountPaise: number;
  paymentState: string;
  stationName: string;
  partnerOwnerId: string;
};

export async function lockBooking(tx: Q, id: string): Promise<BookingRow | null> {
  const [b] = await tx`SELECT b.*, b.planned_kwh::float8 AS planned_kwh, s.partner_id, s.name AS station_name, p.owner_user_id AS partner_owner_id
                       FROM bookings b JOIN stations s ON s.id = b.station_id JOIN partners p ON p.id = s.partner_id
                       WHERE b.id = ${id} FOR UPDATE OF b`;
  return (b as unknown as BookingRow) ?? null;
}

export async function transition(tx: Q, b: BookingRow, to: Status, actor: { userId: string | null; role: 'driver' | 'partner' | 'admin' | 'system' | 'payment_provider' }, note?: string, extra?: Partial<{ cancellationReason: string }>) {
  if (!NEXT[b.status].includes(to)) throw conflict(`A ${b.status.toLowerCase().replace('_', ' ')} booking cannot become ${to.toLowerCase().replace('_', ' ')}.`, 'INVALID_TRANSITION', { from: b.status, to });
  await tx`UPDATE bookings SET status = ${to}, updated_at = now(),
             cancelled_at = CASE WHEN ${to} IN ('CANCELLED_DRIVER', 'CANCELLED_PARTNER') THEN now() ELSE cancelled_at END,
             completed_at = CASE WHEN ${to} = 'COMPLETED' THEN now() ELSE completed_at END,
             cancellation_reason = coalesce(${extra?.cancellationReason ?? null}, cancellation_reason),
             hold_expires_at = CASE WHEN ${to} = 'RESERVED' THEN hold_expires_at ELSE NULL END
           WHERE id = ${b.id}`;
  await tx`INSERT INTO booking_events (booking_id, actor_user_id, actor_role, from_status, to_status, note) VALUES (${b.id}, ${actor.userId}, ${actor.role}, ${b.status}, ${to}, ${note ?? null})`;
  b.status = to;
}

/** Refund (part of) a paid booking through its provider, record it and post the ledger reversal. */
export async function refundBooking(tx: Tx, b: BookingRow, basePart: number, feePart: number, reason: string, requestedBy: string | null) {
  const [order] = await tx`SELECT * FROM payment_orders WHERE booking_id = ${b.id} AND status IN ('PAID', 'PARTIALLY_REFUNDED') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
  if (!order) return null;
  const amount = basePart + feePart;
  if (amount <= 0) return null;
  if ((order.refundedPaise as number) + amount > (order.amountPaise as number)) throw conflict('Refund would exceed the amount paid.', 'REFUND_EXCEEDS_PAYMENT');
  const provider = providerFor(order.provider as string);
  const result = await provider.refund({ providerPaymentRef: order.providerPaymentRef as string, amountPaise: amount });
  const [refund] = await tx`INSERT INTO refunds (payment_order_id, booking_id, amount_paise, base_part_paise, fee_part_paise, reason, status, provider_refund_ref, requested_by, processed_at)
                            VALUES (${order.id as string}, ${b.id}, ${amount}, ${basePart}, ${feePart}, ${reason}, ${result.status}, ${result.providerRefundRef}, ${requestedBy}, ${result.status === 'PROCESSED' ? new Date() : null})
                            RETURNING id`;
  if (result.status !== 'PROCESSED') throw new ApiError(502, 'REFUND_FAILED', 'The payment provider could not process the refund. Support has been notified.');
  const refunded = (order.refundedPaise as number) + amount;
  const full = refunded >= (order.amountPaise as number);
  await tx`UPDATE payment_orders SET refunded_paise = ${refunded}, status = ${full ? 'REFUNDED' : 'PARTIALLY_REFUNDED'}, updated_at = now() WHERE id = ${order.id as string}`;
  await tx`UPDATE bookings SET payment_state = ${full ? 'REFUNDED' : 'PARTIALLY_REFUNDED'}, updated_at = now() WHERE id = ${b.id}`;
  await postRefund(tx, { bookingId: b.id, paymentOrderId: order.id as string, partnerId: b.partnerId }, basePart, feePart, b.commissionBps, reason);
  await notify(tx, b.driverId, 'refund', 'Refund processed', `${rupees(amount)} for booking ${b.code} was refunded (${reason}).`, `/bookings/${b.id}`);
  return { id: refund.id as string, amountPaise: amount };
}

/** Full refund of whatever is still refundable. */
export async function refundRemaining(tx: Tx, b: BookingRow, reason: string, requestedBy: string | null) {
  const [order] = await tx`SELECT amount_paise, refunded_paise FROM payment_orders WHERE booking_id = ${b.id} AND status IN ('PAID', 'PARTIALLY_REFUNDED') ORDER BY created_at DESC LIMIT 1`;
  if (!order) return null;
  const [done] = await tx`SELECT coalesce(sum(base_part_paise), 0)::int AS base, coalesce(sum(fee_part_paise), 0)::int AS fee FROM refunds WHERE booking_id = ${b.id} AND status = 'PROCESSED'`;
  return refundBooking(tx, b, b.basePaise - (done.base as number), b.customerFeePaise - (done.fee as number), reason, requestedBy);
}

/** Processes a VERIFIED provider event. Idempotent: replays of the same order state are no-ops. */
export async function applyPaymentEvent(tx: Tx, ev: { type: 'payment.captured' | 'payment.failed'; orderRef: string; paymentRef: string | null; amountPaise: number; reason?: string }) {
  const [order] = await tx`SELECT * FROM payment_orders WHERE provider_order_ref = ${ev.orderRef} FOR UPDATE`;
  if (!order) return 'unknown order';
  const b = await lockBooking(tx, order.bookingId as string);
  if (!b) return 'unknown booking';
  if (ev.type === 'payment.failed') {
    if (order.status !== 'CREATED') return `ignored: order already ${order.status}`;
    await tx`UPDATE payment_orders SET status = 'FAILED', failure_reason = ${ev.reason ?? 'Payment failed'}, updated_at = now() WHERE id = ${order.id as string}`;
    await tx`UPDATE bookings SET payment_state = 'FAILED', updated_at = now() WHERE id = ${b.id}`;
    if (b.status === 'RESERVED') {
      await transition(tx, b, 'PAYMENT_FAILED', { userId: null, role: 'payment_provider' }, ev.reason ?? 'Payment failed');
      await notify(tx, b.driverId, 'payment_failed', 'Payment failed', `Payment for booking ${b.code} did not go through, so the slot was released.`, `/bookings/${b.id}`);
    }
    return 'payment failed';
  }
  // payment.captured
  if (order.status !== 'CREATED' && order.status !== 'EXPIRED' && order.status !== 'FAILED') return `ignored: order already ${order.status}`;
  if (ev.amountPaise !== order.amountPaise) {
    await tx`UPDATE payment_orders SET failure_reason = ${`amount mismatch: ${ev.amountPaise}`}, updated_at = now() WHERE id = ${order.id as string}`;
    return 'rejected: amount mismatch';
  }
  await tx`UPDATE payment_orders SET status = 'PAID', provider_payment_ref = ${ev.paymentRef}, paid_at = now(), updated_at = now() WHERE id = ${order.id as string}`;
  await tx`UPDATE bookings SET payment_state = 'PAID', updated_at = now() WHERE id = ${b.id}`;
  await postCapture(tx, { bookingId: b.id, paymentOrderId: order.id as string, partnerId: b.partnerId }, b);
  if (b.status === 'RESERVED' && b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() > Date.now()) {
    await transition(tx, b, 'CONFIRMED', { userId: null, role: 'payment_provider' }, 'Payment verified by provider webhook');
    await notify(tx, b.driverId, 'booking_confirmed', 'Booking confirmed', `${b.stationName}: booking ${b.code} is confirmed.`, `/bookings/${b.id}`);
    await notify(tx, b.partnerOwnerId, 'partner_booking', 'New confirmed booking', `${b.stationName}: booking ${b.code} was confirmed.`, `/partner/bookings`);
    return 'confirmed';
  }
  // Money arrived but the hold is gone (expired/cancelled). Never invent capacity: refund in full.
  if (b.status === 'RESERVED') await transition(tx, b, 'EXPIRED', { userId: null, role: 'system' }, 'Payment arrived after the hold expired');
  await refundRemaining(tx, b, 'Payment received after the reservation had expired', null);
  return 'late payment refunded';
}

/** Expires unpaid holds. Runs periodically and before new holds on the same connector. */
export async function expireHolds(q: Q, connectorId?: string) {
  const rows = await q`UPDATE bookings SET status = 'EXPIRED', hold_expires_at = NULL, updated_at = now()
                       WHERE status = 'RESERVED' AND hold_expires_at < now() ${connectorId ? q`AND connector_id = ${connectorId}` : q``}
                       RETURNING id`;
  for (const r of rows) {
    await q`INSERT INTO booking_events (booking_id, actor_role, from_status, to_status, note) VALUES (${r.id as string}, 'system', 'RESERVED', 'EXPIRED', 'Unpaid hold expired')`;
    await q`UPDATE payment_orders SET status = 'EXPIRED', updated_at = now() WHERE booking_id = ${r.id as string} AND status = 'CREATED'`;
  }
  return rows.length;
}

export async function createPaymentOrder(bookingId: string, userId: string, amountPaise: number, code: string, methodHint: string | null, idemKey: string) {
  const provider = activeProvider();
  const { providerOrderRef } = await provider.createOrder({ amountPaise, receipt: code });
  const [o] = await sql`INSERT INTO payment_orders (booking_id, user_id, provider, provider_order_ref, amount_paise, method_hint)
                        VALUES (${bookingId}, ${userId}, ${provider.name}, ${providerOrderRef}, ${amountPaise}, ${methodHint})
                        RETURNING id, provider, provider_order_ref, amount_paise, status, method_hint, created_at`;
  await sql`UPDATE bookings SET payment_state = 'PENDING' WHERE id = ${bookingId}`;
  void idemKey;
  return o;
}
