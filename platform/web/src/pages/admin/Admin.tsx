import { useState } from 'react';
import { ApiError, get, patch, post } from '../../lib/api';
import { connectorLabel, dateTime, rupees, statusLabel } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { useToast } from '../../lib/toast';
import { Icon } from '../../components/Icon';
import { Btn, Card, DemoTag, Empty, ErrorNote, Field, Input, Loading, Modal, PageHead, Pill, Select, Stat, Textarea } from '../../components/ui';

function Decision({ title, onSubmit, onClose, requireNote }: { title: string; onSubmit: (note: string) => Promise<void>; onClose: () => void; requireNote: boolean }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={title} onClose={onClose}>
      <Field label="Note to the partner" optional={!requireNote}>
        {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <ErrorNote error={err} />
      <div className="modal-actions">
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn
          busy={busy}
          disabled={requireNote && !note.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(note);
              onClose();
            } catch (e) {
              setErr(e as ApiError);
            } finally {
              setBusy(false);
            }
          }}
          data-testid="confirm-decision"
        >
          Confirm
        </Btn>
      </div>
    </Modal>
  );
}

export function AdminOverview() {
  const r = useApi<any>('/api/admin/overview');
  if (r.error) return <ErrorNote error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const { counts: c, money: m, settings } = r.data;
  return (
    <div>
      <PageHead kicker="Admin" title="Platform overview">
        Approvals, live listings, bookings and the commission ledger. Admin access is checked on the server for every request.
      </PageHead>
      <div className="stats">
        <Stat icon="badge-check" label="Partner applications" value={c.partnersPending} sub={<Link to="/admin/partners">review queue →</Link>} />
        <Stat icon="plug-zap" label="Stations in review" value={c.stationsPending} sub={<Link to="/admin/stations">review queue →</Link>} />
        <Stat icon="map-pin" label="Published stations" value={c.stationsLive} />
        <Stat icon="calendar-clock" label="Active bookings" value={c.bookingsActive} sub={`${c.bookingsCompleted} completed`} />
        <Stat icon="indian-rupee" label="Platform revenue (net)" value={rupees(m.platformRevenuePaise)} sub={`fees ${rupees(m.serviceFees)} + commission ${rupees(m.commissions)}`} />
        <Stat icon="hand-coins" label="Owed to partners" value={rupees(m.partnerPayable)} sub={`net collected ${rupees(m.netCollected)}`} />
        <Stat icon="scale" label="Commercial model" value={`${settings.customerFeeBps / 100}% + ${settings.providerCommissionBps / 100}%`} sub={<Link to="/admin/settings">customer fee + provider commission →</Link>} />
        <Stat icon="life-buoy" label="Open support cases" value={c.ticketsOpen} sub={<Link to="/admin/support">support →</Link>} />
      </div>
      <p className={`notice ${m.ledgerBalanced ? '' : 'notice-bad'}`}>
        <Icon name={m.ledgerBalanced ? 'circle-check' : 'triangle-alert'} /> Ledger {m.ledgerBalanced ? 'balanced' : 'NOT balanced'}: debits {rupees(m.totalDebits)} = credits {rupees(m.totalCredits)}. All amounts are test-mode.
      </p>
    </div>
  );
}

export function AdminPartners() {
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const r = useApi<{ partners: any[] }>(`/api/admin/partners${status ? `?status=${status}` : ''}`);
  const [dec, setDec] = useState<{ p: any; d: 'APPROVE' | 'REJECT' | 'SUSPEND' } | null>(null);
  return (
    <div>
      <PageHead kicker="Admin" title="Station partners">
        Verify ownership or operating authority before approving. Approval grants the partner role; rejection or suspension removes it.
      </PageHead>
      <div className="seg tabs">
        {['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', ''].map((s) => (
          <button key={s || 'all'} className={`seg-btn ${status === s ? 'is-active' : ''}`} onClick={() => setStatus(s)}>
            {s ? s.toLowerCase() : 'all'}
          </button>
        ))}
      </div>
      {r.data && !r.data.partners.length && <Empty icon="badge-check" title="Nothing in this queue" />}
      <div className="list">
        {r.data?.partners.map((p) => (
          <Card key={p.id} className="review-card">
            <div className="row-between" data-testid="partner-application" data-name={p.businessName}>
              <div>
                <h2 className="h3">
                  {p.businessName} <Pill status={p.status}>{p.status.toLowerCase()}</Pill>
                </h2>
                <p className="muted small">
                  {p.businessType} · owner {p.ownerName} ({p.ownerEmail}) · {p.contactPhone} · {p.stationCount} station(s) · applied {dateTime(p.createdAt)}
                </p>
                <p className="small">{p.address}</p>
                <ul className="plain-list small">
                  {p.verifications.map((v: any, i: number) => (
                    <li key={i}>
                      <Icon name="file-text" /> {v.documentType.replace('_', ' ')}: <span className="mono">{v.reference}</span> · {v.status.toLowerCase()}
                    </li>
                  ))}
                </ul>
                {p.reviewNote && <p className="small muted">Note: {p.reviewNote}</p>}
              </div>
              <div className="row-actions">
                {p.status !== 'APPROVED' && (
                  <Btn size="sm" icon="check" onClick={() => setDec({ p, d: 'APPROVE' })} data-testid="approve-partner">
                    Approve
                  </Btn>
                )}
                {p.status === 'PENDING' && (
                  <Btn size="sm" variant="ghost" onClick={() => setDec({ p, d: 'REJECT' })}>
                    Reject
                  </Btn>
                )}
                {p.status === 'APPROVED' && (
                  <Btn size="sm" variant="ghost" onClick={() => setDec({ p, d: 'SUSPEND' })}>
                    Suspend
                  </Btn>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="muted small">
        <DemoTag>Manual review</DemoTag> No automated KYC/ownership verification service is connected; document references are checked by the reviewer.
      </p>
      {dec && (
        <Decision
          title={`${dec.d === 'APPROVE' ? 'Approve' : dec.d === 'REJECT' ? 'Reject' : 'Suspend'} ${dec.p.businessName}`}
          requireNote={dec.d !== 'APPROVE'}
          onClose={() => setDec(null)}
          onSubmit={async (note) => {
            await post(`/api/admin/partners/${dec.p.id}/decision`, { decision: dec.d, note: note || undefined });
            toast('Decision recorded and the partner was notified.', 'good');
            r.reload();
          }}
        />
      )}
    </div>
  );
}

export function AdminStations() {
  const toast = useToast();
  const [status, setStatus] = useState('SUBMITTED');
  const r = useApi<{ stations: any[] }>(`/api/admin/stations${status ? `?status=${status}` : ''}`);
  const [dec, setDec] = useState<{ s: any; d: 'APPROVE' | 'REJECT' | 'SUSPEND' } | null>(null);
  return (
    <div>
      <PageHead kicker="Admin" title="Station listings">
        Approve listings to publish them to drivers.
      </PageHead>
      <div className="seg tabs">
        {['SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT', ''].map((s) => (
          <button key={s || 'all'} className={`seg-btn ${status === s ? 'is-active' : ''}`} onClick={() => setStatus(s)}>
            {s ? s.toLowerCase() : 'all'}
          </button>
        ))}
      </div>
      {r.data && !r.data.stations.length && <Empty icon="plug-zap" title="Nothing in this queue" />}
      <div className="list">
        {r.data?.stations.map((s) => (
          <Card key={s.id} className="review-card">
            <div className="row-between" data-testid="station-review" data-name={s.name}>
              <div>
                <h2 className="h3">
                  {s.name} <Pill status={s.listingStatus}>{s.listingStatus.toLowerCase()}</Pill> {s.isDemo && <DemoTag>demo</DemoTag>}
                </h2>
                <p className="muted small">
                  {s.businessName} (partner {s.partnerStatus.toLowerCase()}) · {s.accessType.toLowerCase()} {s.accessType !== 'PUBLIC' ? (s.discloseExactLocation ? '· exact location public' : '· location hidden') : ''} · {s.daysOpen} day(s) open
                </p>
                <p className="small">
                  {s.address}, {s.area}, {s.city} · {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                </p>
                <p className="small">
                  {(s.connectors || []).map((c: any) => `${c.label}: ${connectorLabel(c.standard)} ${c.currentType} ${c.maxPowerKw} kW ${rupees(c.pricePerKwhPaise)}/kWh`).join(' · ') || 'No connectors'}
                </p>
              </div>
              <div className="row-actions">
                {['SUBMITTED', 'SUSPENDED'].includes(s.listingStatus) && (
                  <Btn size="sm" icon="check" onClick={() => setDec({ s, d: 'APPROVE' })} data-testid="approve-station">
                    Approve & publish
                  </Btn>
                )}
                {s.listingStatus === 'SUBMITTED' && (
                  <Btn size="sm" variant="ghost" onClick={() => setDec({ s, d: 'REJECT' })}>
                    Request changes
                  </Btn>
                )}
                {s.listingStatus === 'APPROVED' && (
                  <Btn size="sm" variant="ghost" onClick={() => setDec({ s, d: 'SUSPEND' })}>
                    Suspend
                  </Btn>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      {dec && (
        <Decision
          title={`${dec.d === 'APPROVE' ? 'Publish' : dec.d === 'REJECT' ? 'Request changes to' : 'Suspend'} ${dec.s.name}`}
          requireNote={dec.d !== 'APPROVE'}
          onClose={() => setDec(null)}
          onSubmit={async (note) => {
            await post(`/api/admin/stations/${dec.s.id}/decision`, { decision: dec.d, note: note || undefined });
            toast('Listing decision recorded.', 'good');
            r.reload();
          }}
        />
      )}
    </div>
  );
}

export function AdminBookings() {
  const toast = useToast();
  const r = useApi<{ bookings: any[] }>('/api/admin/bookings');
  const [ref, setRef] = useState<any>(null);
  const [f, setF] = useState({ amount: '', reason: '' });
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div>
      <PageHead kicker="Admin" title="Bookings & refunds" />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Booking</th>
              <th>Station</th>
              <th>Driver</th>
              <th>When</th>
              <th>Status</th>
              <th>Paid</th>
              <th>Fee</th>
              <th>Commission</th>
              <th>Partner</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.data?.bookings.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.code}</td>
                <td>
                  {b.stationName}
                  <br />
                  <span className="muted small">{b.businessName}</span>
                </td>
                <td>{b.driverName}</td>
                <td>{dateTime(b.startsAt)}</td>
                <td>
                  <Pill status={b.status}>{statusLabel(b.status)}</Pill>
                  <br />
                  <span className="muted small">{b.paymentState.toLowerCase()}</span>
                </td>
                <td>{rupees(b.customerTotalPaise)}</td>
                <td>{rupees(b.customerFeePaise)}</td>
                <td>{rupees(b.providerCommissionPaise)}</td>
                <td>{rupees(b.partnerAmountPaise)}</td>
                <td>
                  {['PAID', 'PARTIALLY_REFUNDED'].includes(b.paymentState) && (
                    <button type="button" className="link-btn" onClick={() => (setRef(b), setF({ amount: '', reason: '' }), setErr(null))}>
                      Refund
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!ref} title={ref ? `Refund ${ref.code}` : ''} onClose={() => setRef(null)}>
        <Field label="Amount (₹)" optional hint="Leave empty to refund everything that remains. Partial refunds are split proportionally between charging amount and service fee; commission is reversed accordingly.">
          {(id) => <Input id={id} type="number" min={1} step={0.01} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}
        </Field>
        <Field label="Reason">{(id) => <Input id={id} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <ErrorNote error={err} />
        <div className="modal-actions">
          <Btn
            icon="rotate-ccw"
            disabled={f.reason.length < 3}
            onClick={() =>
              post(`/api/admin/bookings/${ref.id}/refund`, { reason: f.reason, amountPaise: f.amount ? Math.round(Number(f.amount) * 100) : undefined })
                .then((x) => (toast(`Refunded ${rupees(x.refund.amountPaise)} (test mode)`, 'good'), setRef(null), r.reload()))
                .catch(setErr)
            }
          >
            Refund
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

export function AdminSettings() {
  const toast = useToast();
  const r = useApi<{ settings: any }>('/api/admin/settings');
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  if (!r.data) return r.error ? <ErrorNote error={r.error} /> : <Loading />;
  const s = r.data.settings;
  const v = f || { fee: String(s.customerFeeBps / 100), commission: String(s.providerCommissionBps / 100), hold: String(s.holdMinutes), cutoff: String(s.cancellationCutoffMinutes) };
  const base = 18000;
  const fee = Math.round((base * Number(v.fee) * 100) / 10000);
  const com = Math.round((base * Number(v.commission) * 100) / 10000);
  return (
    <div>
      <PageHead kicker="Admin" title="Commission & booking rules">
        Rates apply to new bookings only; existing bookings keep the rates they were quoted (stored on each booking).
      </PageHead>
      <div className="two-col">
        <Card>
          <div className="form-grid">
            <Field label="Customer service fee (%)">{(id) => <Input id={id} type="number" min={0} max={50} step={0.01} value={v.fee} onChange={(e) => setF({ ...v, fee: e.target.value })} data-testid="fee-input" />}</Field>
            <Field label="Station-provider commission (%)">{(id) => <Input id={id} type="number" min={0} max={50} step={0.01} value={v.commission} onChange={(e) => setF({ ...v, commission: e.target.value })} data-testid="commission-input" />}</Field>
            <Field label="Payment hold (minutes)">{(id) => <Input id={id} type="number" min={2} max={60} value={v.hold} onChange={(e) => setF({ ...v, hold: e.target.value })} />}</Field>
            <Field label="Free-cancellation cutoff (minutes before start)">{(id) => <Input id={id} type="number" min={0} max={1440} value={v.cutoff} onChange={(e) => setF({ ...v, cutoff: e.target.value })} />}</Field>
          </div>
          <ErrorNote error={err} />
          <Btn
            icon="check"
            disabled={!f}
            onClick={() =>
              patch('/api/admin/settings', { customerFeeBps: Math.round(Number(v.fee) * 100), providerCommissionBps: Math.round(Number(v.commission) * 100), holdMinutes: Number(v.hold), cancellationCutoffMinutes: Number(v.cutoff) })
                .then(() => (toast('Settings saved and audited.', 'good'), setF(null), r.reload()))
                .catch(setErr)
            }
          >
            Save settings
          </Btn>
        </Card>
        <Card>
          <h2 className="h3">Example: ₹180 charging session</h2>
          <div className="estimate" data-testid="commission-example">
            <div className="est-row">
              <span>Base charging amount</span>
              <strong>{rupees(base)}</strong>
            </div>
            <div className="est-row">
              <span>Customer service fee ({v.fee}%)</span>
              <strong>{rupees(fee)}</strong>
            </div>
            <div className="est-row est-total">
              <span>Customer pays (before taxes)</span>
              <strong>{rupees(base + fee)}</strong>
            </div>
            <div className="est-row">
              <span>Provider commission ({v.commission}%)</span>
              <strong>−{rupees(com)}</strong>
            </div>
            <div className="est-row est-total">
              <span>Station provider receives</span>
              <strong>{rupees(base - com)}</strong>
            </div>
            <div className="est-row est-total">
              <span>Total platform commission</span>
              <strong>{rupees(fee + com)}</strong>
            </div>
          </div>
          <p className="muted small">Taxes and payment-processing fees are accounted for separately once the business and provider configuration is final.</p>
        </Card>
      </div>
    </div>
  );
}

export function AdminLedger() {
  const r = useApi<any>('/api/admin/ledger');
  if (!r.data) return r.error ? <ErrorNote error={r.error} /> : <Loading />;
  return (
    <div>
      <PageHead kicker="Admin" title="Ledger & payment webhooks">
        Double-entry ledger: every capture and refund posts balanced entries. Only verified provider webhooks change payment state.
      </PageHead>
      <p className={`notice ${r.data.unbalancedTransactions ? 'notice-bad' : ''}`}>
        <Icon name={r.data.unbalancedTransactions ? 'triangle-alert' : 'circle-check'} /> {r.data.unbalancedTransactions} unbalanced transaction(s).
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {r.data.accounts.map((a: any) => (
              <tr key={a.account}>
                <td className="mono">{a.account}</td>
                <td>{rupees(a.debit)}</td>
                <td>{rupees(a.credit)}</td>
                <td>{rupees(Math.abs(a.credit - a.debit))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PayoutForm />
      <h2 className="h3 section-title">Webhook events</h2>
      <div className="table-wrap">
        <table className="table" data-testid="webhooks">
          <thead>
            <tr>
              <th>Received</th>
              <th>Provider</th>
              <th>Event</th>
              <th>Signature</th>
              <th>Processing</th>
              <th>Duplicates ignored</th>
            </tr>
          </thead>
          <tbody>
            {r.data.webhooks.map((w: any) => (
              <tr key={w.providerEventId}>
                <td>{dateTime(w.receivedAt)}</td>
                <td>{w.provider === 'test' ? <DemoTag>test</DemoTag> : w.provider}</td>
                <td className="small">{w.eventType}</td>
                <td>{w.signatureVerified ? <Pill tone="good">verified</Pill> : <Pill tone="bad">invalid</Pill>}</td>
                <td>
                  <Pill status={w.processingStatus === 'PROCESSED' ? 'APPROVED' : w.processingStatus === 'ERROR' ? 'FAILED' : 'PENDING'}>{w.processingStatus.toLowerCase()}</Pill> <span className="muted small">{w.processingNote}</span>
                </td>
                <td>{w.duplicateCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="h3 section-title">Recent entries</h2>
      <div className="table-wrap">
        <table className="table small">
          <thead>
            <tr>
              <th>When</th>
              <th>Booking</th>
              <th>Kind</th>
              <th>Account</th>
              <th>Debit</th>
              <th>Credit</th>
            </tr>
          </thead>
          <tbody>
            {r.data.recent.map((e: any, i: number) => (
              <tr key={i}>
                <td>{dateTime(e.createdAt)}</td>
                <td className="mono">{e.code}</td>
                <td>{e.kind}</td>
                <td className="mono">{e.account}</td>
                <td>{e.debitPaise ? rupees(e.debitPaise) : ''}</td>
                <td>{e.creditPaise ? rupees(e.creditPaise) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayoutForm() {
  const toast = useToast();
  const partners = useApi<{ partners: any[] }>('/api/admin/partners?status=APPROVED');
  const [f, setF] = useState({ partnerId: '', periodStart: '', periodEnd: '' });
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <Card>
      <h2 className="h3">Payout statement</h2>
      <p className="muted small">
        <DemoTag>Not connected</DemoTag> Creates a payout record (PENDING_INTEGRATION) from completed sessions. No money is transferred until a payout provider is connected.
      </p>
      <div className="form-grid">
        <Field label="Partner">
          {(id) => (
            <Select id={id} value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })}>
              <option value="">Choose…</option>
              {partners.data?.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.businessName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">{(id) => <Input id={id} type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} />}</Field>
      </div>
      <ErrorNote error={err} />
      <Btn variant="glass" icon="file-text" disabled={!f.partnerId || !f.periodStart || !f.periodEnd} onClick={() => post('/api/admin/payouts', f).then((x) => toast(`Statement recorded: ${rupees(x.payout.amountPaise)} (${x.payout.status})`, 'good')).catch(setErr)}>
        Create statement
      </Btn>
    </Card>
  );
}

export function AdminSupport() {
  const toast = useToast();
  const r = useApi<{ tickets: any[] }>('/api/admin/support');
  const [open, setOpen] = useState<any>(null);
  const [thread, setThread] = useState<any>(null);
  const [f, setF] = useState({ body: '', status: 'RESOLVED' });
  const show = async (t: any) => {
    setOpen(t);
    setThread((await get(`/api/support/tickets/${t.id}`)).messages);
  };
  return (
    <div>
      <PageHead kicker="Admin" title="Support cases" />
      {r.data && !r.data.tickets.length && <Empty icon="life-buoy" title="No support cases" />}
      <div className="list">
        {r.data?.tickets.map((t) => (
          <button key={t.id} type="button" className="row-card card" onClick={() => show(t)}>
            <div className="row-main">
              <strong>{t.subject}</strong>
              <span className="muted small">
                {t.fullName} · {t.workspace} · {t.category} {t.bookingCode ? `· ${t.bookingCode}` : ''} · {t.messages} message(s) · {dateTime(t.updatedAt)}
              </span>
            </div>
            <Pill status={t.status}>{t.status.toLowerCase().replace('_', ' ')}</Pill>
          </button>
        ))}
      </div>
      <Modal open={!!open} title={open?.subject || ''} onClose={() => setOpen(null)} wide>
        <div className="thread">
          {thread?.map((m: any, i: number) => (
            <div key={i} className={`msg ${m.authorRole === 'admin' ? 'from-me' : 'from-admin'}`}>
              <span className="muted small">
                {m.authorRole} · {dateTime(m.createdAt)}
              </span>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
        <Field label="Reply">{(id) => <Textarea id={id} rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <Field label="Set status">
          {(id) => (
            <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {['IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase().replace('_', ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Btn icon="send" disabled={!f.body.trim()} onClick={() => post(`/api/admin/support/${open.id}/reply`, f).then(() => (toast('Reply sent', 'good'), setOpen(null), setF({ body: '', status: 'RESOLVED' }), r.reload()))}>
          Send reply
        </Btn>
      </Modal>
    </div>
  );
}

export function AdminAudit() {
  const r = useApi<{ entries: any[] }>('/api/admin/audit');
  return (
    <div>
      <PageHead kicker="Admin" title="Audit log">
        Security-relevant actions, including denied access attempts.
      </PageHead>
      <div className="table-wrap">
        <table className="table small" data-testid="audit">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {r.data?.entries.map((e) => (
              <tr key={e.id} className={e.action.includes('denied') ? 'row-bad' : ''}>
                <td>{dateTime(e.createdAt)}</td>
                <td>
                  {e.actorEmail || '—'} <span className="muted">({e.actorRole})</span>
                </td>
                <td className="mono">{e.action}</td>
                <td className="mono small">
                  {e.entityType} {e.entityId ? String(e.entityId).slice(0, 8) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
