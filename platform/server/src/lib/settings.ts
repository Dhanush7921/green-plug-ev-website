import type { Q } from '../db';

export type Settings = { customerFeeBps: number; providerCommissionBps: number; holdMinutes: number; cancellationCutoffMinutes: number };
export async function getSettings(q: Q): Promise<Settings> {
  const rows = await q`SELECT key, value FROM platform_settings`;
  const m = Object.fromEntries(rows.map((r) => [r.key as string, Number(r.value)]));
  return {
    customerFeeBps: m.customer_fee_bps ?? 1500,
    providerCommissionBps: m.provider_commission_bps ?? 1500,
    holdMinutes: m.hold_minutes ?? 10,
    cancellationCutoffMinutes: m.cancellation_cutoff_minutes ?? 30,
  };
}
