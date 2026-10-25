// TEST-mode checkout. It never marks anything paid itself: the server signs a provider event and delivers it to
// the webhook endpoint, and the booking only changes after that webhook is verified. Live collection is disabled.
import { useState } from 'react';
import { post } from '../lib/api';
import { rupees } from '../lib/format';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { Btn, DemoTag, Modal } from './ui';

export function Checkout({ open, order, amountPaise, onClose, onResult }: { open: boolean; order: { id: string; provider: string; providerOrderRef?: string } | null; amountPaise: number; onClose: () => void; onResult: (r: { orderStatus: string; bookingStatus: string; bookingId: string }) => void }) {
  const { config } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState<'upi' | 'card' | 'netbanking' | 'wallet'>('upi');
  const run = async (outcome: 'success' | 'failure', deliveries = 1) => {
    if (!order) return;
    setBusy(outcome + deliveries);
    setErr(null);
    try {
      const r = await post(`/api/payments/test-checkout/${order.id}`, { outcome, deliveries });
      onResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const live = config?.payments.live;
  return (
    <Modal open={open} title="Payment" onClose={onClose}>
      <div className="checkout" data-testid="checkout">
        <div className="checkout-amount">
          <span className="muted">Amount due</span>
          <strong>{rupees(amountPaise)}</strong>
        </div>
        {!live ? (
          <>
            <div className="notice notice-warn">
              <DemoTag>Test payment mode</DemoTag>
              <p>No real money is collected and no card or UPI details are requested. Choose a simulated gateway outcome. The booking is confirmed only after the server verifies the signed payment webhook.</p>
            </div>
            <fieldset className="choice-group seg" aria-label="Payment method (preference only)">
              {(['upi', 'card', 'netbanking', 'wallet'] as const).map((m) => (
                <button key={m} type="button" className={`seg-btn ${method === m ? 'is-active' : ''}`} aria-pressed={method === m} onClick={() => setMethod(m)}>
                  {m === 'upi' ? 'UPI' : m === 'netbanking' ? 'Net banking' : m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </fieldset>
            <div className="checkout-actions">
              <Btn icon="circle-check" busy={busy === 'success1'} disabled={!!busy} onClick={() => run('success')} data-testid="pay-success">
                Simulate successful payment
              </Btn>
              <Btn variant="glass" icon="ban" busy={busy === 'failure1'} disabled={!!busy} onClick={() => run('failure')} data-testid="pay-failure">
                Simulate failed payment
              </Btn>
              <button type="button" className="link-btn small" disabled={!!busy} onClick={() => run('success', 3)} data-testid="pay-duplicate">
                Developer check: deliver the success webhook 3 times (duplicates must be ignored)
              </button>
            </div>
          </>
        ) : (
          <div className="notice">
            <Icon name="lock" /> Live payments are configured on the server. Continue on the provider's secure page.
          </div>
        )}
        {err && (
          <p className="field-error" role="alert">
            <Icon name="circle-alert" /> {err}
          </p>
        )}
        <p className="muted small">
          Order {order?.providerOrderRef || order?.id} · provider: {order?.provider}
        </p>
      </div>
    </Modal>
  );
}
