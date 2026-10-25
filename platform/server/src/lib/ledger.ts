// Double-entry postings. A failed, expired or unpaid booking never reaches the ledger; refunds post explicit reversals.
import { randomUUID } from 'node:crypto';
import type { Q } from '../db';

type Line = { account: 'provider_clearing' | 'platform_service_fee' | 'platform_commission' | 'partner_payable'; debit?: number; credit?: number };

async function post(q: Q, kind: 'PAYMENT_CAPTURED' | 'REFUND', ref: { bookingId: string; paymentOrderId: string; partnerId: string }, lines: Line[], memo: string) {
  const txn = randomUUID();
  for (const l of lines) {
    const debit = l.debit ?? 0;
    const credit = l.credit ?? 0;
    if (debit === 0 && credit === 0) continue;
    await q`INSERT INTO ledger_entries (txn_id, booking_id, payment_order_id, partner_id, account, debit_paise, credit_paise, kind, memo)
            VALUES (${txn}, ${ref.bookingId}, ${ref.paymentOrderId}, ${ref.partnerId}, ${l.account}, ${debit}, ${credit}, ${kind}, ${memo})`;
  }
  return txn;
}

/** Payment captured: customer total arrives at the provider; split into service fee, commission and partner payable. */
export function postCapture(q: Q, ref: { bookingId: string; paymentOrderId: string; partnerId: string }, b: { customerTotalPaise: number; customerFeePaise: number; providerCommissionPaise: number; partnerAmountPaise: number }) {
  return post(
    q,
    'PAYMENT_CAPTURED',
    ref,
    [
      { account: 'provider_clearing', debit: b.customerTotalPaise },
      { account: 'platform_service_fee', credit: b.customerFeePaise },
      { account: 'platform_commission', credit: b.providerCommissionPaise },
      { account: 'partner_payable', credit: b.partnerAmountPaise },
    ],
    'Payment captured',
  );
}

/** Refund of basePart + feePart: reverses the service fee, the commission on that base and the partner's share. */
export function postRefund(q: Q, ref: { bookingId: string; paymentOrderId: string; partnerId: string }, basePart: number, feePart: number, commissionBps: number, memo: string) {
  const commissionPart = Math.round((basePart * commissionBps) / 10000);
  return post(
    q,
    'REFUND',
    ref,
    [
      { account: 'platform_service_fee', debit: feePart },
      { account: 'platform_commission', debit: commissionPart },
      { account: 'partner_payable', debit: basePart - commissionPart },
      { account: 'provider_clearing', credit: basePart + feePart },
    ],
    memo,
  );
}
