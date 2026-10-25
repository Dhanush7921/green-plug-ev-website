import { useEffect, useState } from 'react';
import { ApiError, get, post } from '../../lib/api';
import { connectorLabel, dateTime, rupees, statusLabel, time } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useToast } from '../../lib/toast';
import { Checkout } from '../../components/Checkout';
import { Icon } from '../../components/Icon';
import { Btn, Card, DemoTag, Empty, ErrorNote, Field, Loading, Modal, PageHead, Pill, Textarea } from '../../components/ui';

export function Bookings() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const r = useApi<{ bookings: any[] }>(`/api/bookings?scope=${scope}`);
  return (
    <div>
      <PageHead kicker="EV Driver" title="My bookings">
        Upcoming reservations and your charging history.
      </PageHead>
      <div className="seg tabs" role="tablist">
        {(['upcoming', 'past'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={scope === t} className={`seg-btn ${scope === t ? 'is-active' : ''}`} onClick={() => setScope(t)}>
            {t === 'upcoming' ? 'Upcoming' : 'History'}
          </button>
        ))}
      </div>
      <ErrorNote error={r.error} onRetry={r.reload} />
      {r.loading && !r.data && <Loading />}
      {r.data && !r.data.bookings.length && (
        <Empty icon="calendar" title={scope === 'upcoming' ? 'No upcoming bookings' : 'No past bookings yet'}>
          <Link to="/">Find a charger</Link>
        </Empty>
      )}
      <div className="list">
        {r.data?.bookings.map((b) => (
          <Link key={b.id} to={`/bookings/${b.id}`} className="row-card card" data-testid="booking-row" data-code={b.code}>
            <div className="row-main">
              <strong>{b.stationName}</strong>
              <span className="muted small">
                {dateTime(b.startsAt)} – {time(b.endsAt)} · {b.connectorLabel} ({connectorLabel(b.standard)} {b.currentType}) · {b.plannedKwh} kWh
              </span>
            </div>
            <div className="row-side">
              <Pill status={b.status}>{statusLabel(b.status)}</Pill>
              <strong>{rupees(b.customerTotalPaise)}</strong>
              <span className="muted small mono">{b.code}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return (
    <span className="mono">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

const STEPS = ['RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'];
export function Lifecycle({ status, events }: { status: string; events: any[] }) {
  const terminalBad = ['CANCELLED_DRIVER', 'CANCELLED_PARTNER', 'EXPIRED', 'PAYMENT_FAILED', 'NO_SHOW'].includes(status);
  const reached = new Set(events.map((e) => e.toStatus));
  return (
    <ol className="lifecycle" aria-label="Booking lifecycle">
      {STEPS.map((s) => (
        <li key={s} className={reached.has(s) ? 'is-done' : ''} aria-current={status === s ? 'step' : undefined}>
          <span className="dot" />
          {statusLabel(s)}
        </li>
      ))}
      {terminalBad && (
        <li className="is-bad" aria-current="step">
          <span className="dot" />
          {statusLabel(status)}
        </li>
      )}
    </ol>
  );
}

export function BookingDetail({ id }: { id: string }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const r = useApi<{ booking: any }>(`/api/bookings/${id}`);
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [ticket, setTicket] = useState(false);
  const b = r.data?.booking;
  if (r.loading && !b) return <Loading />;
  if (r.error) return <ErrorNote error={r.error} onRetry={r.reload} />;
  if (!b) return null;
  const openOrder = b.payments.find((p: any) => p.status === 'CREATED');
  const canCancel = ['RESERVED', 'CONFIRMED'].includes(b.status);
  const doCancel = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await post(`/api/bookings/${id}/cancel`, { reason: reason || 'Cancelled by driver' });
      toast(res.refund ? `Booking cancelled. ${rupees(res.refund.amountPaise)} refunded (test mode).` : 'Booking cancelled. The slot is released.', 'good');
      setCancel(false);
      r.reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const showReceipt = () =>
    get(`/api/bookings/${id}/receipt`)
      .then((x) => setReceipt(x.receipt))
      .catch((e) => toast(e.message, 'bad'));
  const refunded = b.refunds.filter((x: any) => x.status === 'PROCESSED').reduce((a: number, x: any) => a + x.amountPaise, 0);

  return (
    <div className="booking-detail" data-testid="booking-detail" data-status={b.status}>
      <Link to="/bookings" className="back-link">
        <Icon name="arrow-left" /> My bookings
      </Link>
      <header className="sd-head">
        <div>
          <span className="kicker">Booking {b.code}</span>
          <h1 className="h2">{b.station.name}</h1>
          <div className="chips">
            <Pill status={b.status}>
              <span data-testid="booking-status">{statusLabel(b.status)}</span>
            </Pill>
            <Pill status={b.paymentState}>Payment: {b.paymentState.toLowerCase().replace('_', ' ')}</Pill>
            {b.station.isDemo && <DemoTag>Demo station</DemoTag>}
          </div>
        </div>
        <div className="sd-head-actions">
          {b.station.directionsUrl && (
            <a className="btn btn-glass" href={b.station.directionsUrl} target="_blank" rel="noopener noreferrer" data-gloss>
              <span className="btn-inner">
                <Icon name="navigation" /> Directions
              </span>
            </a>
          )}
          {['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(b.paymentState) && (
            <Btn variant="glass" icon="receipt" onClick={showReceipt} data-testid="receipt-button">
              Receipt
            </Btn>
          )}
        </div>
      </header>

      {b.status === 'RESERVED' && openOrder && (
        <div className="notice notice-warn hold">
          <Icon name="hourglass" />
          <div>
            <strong>
              Slot held — complete payment within <Countdown until={b.holdExpiresAt} />
            </strong>
            <p className="small">If payment is not verified before the hold expires, the slot is released automatically.</p>
          </div>
          <Btn icon="wallet" onClick={() => setPay(true)} data-testid="complete-payment">
            Pay {rupees(b.pricing.customerTotalPaise)}
          </Btn>
        </div>
      )}
      {b.status === 'PAYMENT_FAILED' && (
        <div className="notice notice-bad">
          <Icon name="circle-alert" /> Payment failed, so the slot was released and nothing was charged. <Link to={`/stations/${b.station.id}`}>Book again</Link>
        </div>
      )}

      <div className="sd-grid">
        <div className="sd-main">
          <Card>
            <Lifecycle status={b.status} events={b.events} />
            <dl className="facts">
              <div>
                <dt>When</dt>
                <dd>
                  {dateTime(b.startsAt)} – {time(b.endsAt)}
                </dd>
              </div>
              <div>
                <dt>Connector</dt>
                <dd>
                  {b.connector.label} · {connectorLabel(b.connector.standard)} {b.connector.currentType} · {b.connector.maxPowerKw} kW
                </dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{b.station.address}</dd>
              </div>
              {b.station.accessNotes && (
                <div>
                  <dt>Access</dt>
                  <dd>{b.station.accessNotes}</dd>
                </div>
              )}
              <div>
                <dt>Operator</dt>
                <dd>{b.station.operator}</dd>
              </div>
              {b.vehicle?.nickname && (
                <div>
                  <dt>Vehicle</dt>
                  <dd>{b.vehicle.nickname}</dd>
                </div>
              )}
              {b.session && (
                <div>
                  <dt>Session</dt>
                  <dd>
                    {b.session.energyKwh !== null ? `${b.session.energyKwh} kWh delivered (${b.session.source === 'HOST_ENTERED' ? 'entered by host — no charger telemetry' : b.session.source})` : 'Charging in progress'}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          {['CONFIRMED', 'CHECKED_IN'].includes(b.status) && (
            <Card className="checkin-code">
              <span className="muted small">Show this code to the host at check-in</span>
              <strong className="mono big-code" data-testid="booking-code">
                {b.code}
              </strong>
            </Card>
          )}
          <Card>
            <h2 className="h3">Timeline</h2>
            <ul className="timeline">
              {b.events.map((e: any, i: number) => (
                <li key={i}>
                  <time>{dateTime(e.createdAt)}</time>
                  <span>
                    {e.fromStatus ? `${statusLabel(e.fromStatus)} → ` : ''}
                    <strong>{statusLabel(e.toStatus)}</strong> <span className="muted">({e.actorRole.replace('_', ' ')})</span>
                    {e.note && <span className="muted"> — {e.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <aside className="sd-book card glass">
          <h2 className="h3">Price breakdown</h2>
          <div className="estimate">
            <div className="est-row">
              <span>
                Charging ({b.plannedKwh} kWh × {rupees(b.pricing.ratePaise)})
              </span>
              <strong>{rupees(b.pricing.basePaise)}</strong>
            </div>
            <div className="est-row">
              <span>Service fee ({b.pricing.feeBps / 100}%)</span>
              <strong>{rupees(b.pricing.customerFeePaise)}</strong>
            </div>
            <div className="est-row est-total">
              <span>Total</span>
              <strong data-testid="booking-total">{rupees(b.pricing.customerTotalPaise)}</strong>
            </div>
            {refunded > 0 && (
              <div className="est-row good">
                <span>Refunded</span>
                <strong data-testid="booking-refunded">−{rupees(refunded)}</strong>
              </div>
            )}
          </div>
          {b.refunds.map((x: any) => (
            <p key={x.id} className="small muted">
              Refund {rupees(x.amountPaise)} · {x.reason} · {x.status.toLowerCase()} (test mode)
            </p>
          ))}
          {canCancel && (
            <Btn variant="danger" icon="ban" onClick={() => setCancel(true)} className="btn-block" data-testid="cancel-booking">
              Cancel booking
            </Btn>
          )}
          <Btn variant="ghost" icon="headset" onClick={() => setTicket(true)} className="btn-block">
            Get help with this booking
          </Btn>
        </aside>
      </div>

      <Modal open={cancel} title="Cancel this booking?" onClose={() => setCancel(false)}>
        <p>{b.paymentState === 'PAID' ? `The full amount of ${rupees(b.pricing.customerTotalPaise)} is refunded (test mode) and the slot is released for other drivers.` : 'The slot hold is released for other drivers.'}</p>
        <Field label="Reason" optional>
          {(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />}
        </Field>
        <ErrorNote error={err} />
        <div className="modal-actions">
          <Btn variant="ghost" onClick={() => setCancel(false)}>
            Keep booking
          </Btn>
          <Btn variant="danger" busy={busy} onClick={doCancel} data-testid="confirm-cancel">
            Cancel booking
          </Btn>
        </div>
      </Modal>
      <Checkout
        open={pay}
        order={openOrder}
        amountPaise={b.pricing.customerTotalPaise}
        onClose={() => setPay(false)}
        onResult={(x) => {
          setPay(false);
          toast(x.bookingStatus === 'CONFIRMED' ? 'Payment verified — booking confirmed.' : `Booking is now ${statusLabel(x.bookingStatus).toLowerCase()}.`, x.bookingStatus === 'CONFIRMED' ? 'good' : 'bad');
          r.reload();
        }}
      />
      <Modal open={!!receipt} title="Receipt" onClose={() => setReceipt(null)}>
        {receipt && (
          <div className="receipt" data-testid="receipt">
            {receipt.testMode && <DemoTag>Test-mode payment — not a tax invoice</DemoTag>}
            <p className="mono">
              {receipt.number} · {dateTime(receipt.issuedAt)}
            </p>
            <p>
              <strong>{receipt.station}</strong> · {dateTime(receipt.booking.startsAt)}
            </p>
            {receipt.lines.map((l: any) => (
              <div key={l.label} className="est-row">
                <span>{l.label}</span>
                <strong>{rupees(l.amountPaise)}</strong>
              </div>
            ))}
            <div className="est-row est-total">
              <span>Paid</span>
              <strong>{rupees(receipt.totalPaidPaise)}</strong>
            </div>
            {receipt.refundedPaise > 0 && (
              <div className="est-row">
                <span>Refunded</span>
                <strong>−{rupees(receipt.refundedPaise)}</strong>
              </div>
            )}
            <div className="est-row est-total">
              <span>Net</span>
              <strong>{rupees(receipt.netPaise)}</strong>
            </div>
            <p className="muted small">{receipt.taxNote}</p>
            <Btn variant="glass" icon="file-text" onClick={() => window.print()}>
              Print
            </Btn>
          </div>
        )}
      </Modal>
      <NewTicket open={ticket} onClose={() => setTicket(false)} bookingId={id} workspace="driver" onCreated={(tid) => navigate(`/support/${tid}`)} />
    </div>
  );
}

export function NewTicket({ open, onClose, bookingId, workspace, onCreated }: { open: boolean; onClose: () => void; bookingId?: string; workspace: 'driver' | 'partner'; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ category: bookingId ? 'booking' : 'other', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post('/api/support/tickets', { ...f, workspace, bookingId });
      onCreated(r.id);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title="Contact support" onClose={onClose}>
      <Field label="Topic">
        {(id) => (
          <select id={id} className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {['booking', 'payment', 'station', 'safety', 'account', 'other'].map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Subject">{(id) => <input id={id} className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
      <Field label="Message">{(id) => <Textarea id={id} rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
      <ErrorNote error={err} />
      <div className="modal-actions">
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn icon="send" busy={busy} onClick={submit}>
          Send
        </Btn>
      </div>
    </Modal>
  );
}
