import { useEffect, useState } from 'react';
import { ApiError, get, post } from '../../lib/api';
import { addDays, connectorLabel, dateTime, day, isoDateIST, rupees, statusLabel, time } from '../../lib/format';
import { useApi, useDraft } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { Icon } from '../../components/Icon';
import { Btn, Card, DemoTag, Empty, ErrorNote, Field, Input, Loading, Modal, PageHead, Pill, Select, Stat, Textarea } from '../../components/ui';

// ------------------------------------------------------------------ onboarding (shown to anyone without an approved partner account)
const DOC_TYPES = [
  ['ownership_proof', 'Proof of station ownership'],
  ['operating_authority', 'Operating authority / lease'],
  ['electrical_safety', 'Electrical safety certificate'],
  ['identity', 'Owner identity'],
];
export function PartnerApply() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const app = useApi<{ application: any; verifications: any[] }>(user ? '/api/partner/application' : null);
  const gate = useApi<any>(user ? '/api/partner/overview' : null); // server-side permission probe
  const d = useDraft('partner-apply', {
    businessName: '',
    businessType: 'individual',
    contactEmail: user?.email || '',
    contactPhone: user?.phone || '',
    gstin: '',
    address: '',
    docs: [{ documentType: 'ownership_proof', reference: '' }],
    declaration: false,
  });
  const f = d.value;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const a = app.data?.application;
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post('/api/partner/application', { businessName: f.businessName, businessType: f.businessType, contactEmail: f.contactEmail, contactPhone: f.contactPhone, gstin: f.gstin || undefined, address: f.address, verifications: f.docs.filter((x) => x.reference.trim()), declaration: f.declaration });
      d.clear();
      toast('Application submitted. An administrator will review your documents.', 'good');
      await refresh();
      app.reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  if (!user) return null;
  return (
    <div className="partner-apply">
      <PageHead kicker="Station Partner" title="Become a station partner">
        List your charging station, set prices and manage bookings. Station tools unlock only after an administrator verifies your ownership or operating authority.
      </PageHead>
      <div className="notice" data-testid="partner-gate">
        <Icon name="lock" />
        <div>
          <strong>Station-management permissions: {gate.error ? 'denied by the server' : gate.data ? 'granted' : 'checking…'}</strong>
          {gate.error && (
            <p className="small mono">
              GET /api/partner/overview → {gate.error.status} {gate.error.code}: {gate.error.message}
            </p>
          )}
          {gate.data && (
            <p className="small">
              Your partner account is approved. <Link to="/partner">Open the dashboard</Link>
            </p>
          )}
        </div>
      </div>
      {!user.emailVerified && (
        <div className="notice notice-warn">
          <Icon name="mail" /> Verify your email before applying. <Link to="/verify">Verify now</Link>
        </div>
      )}
      {a && a.status !== 'REJECTED' ? (
        <Card className="application-status" data-testid="application-status">
          <h2 className="h3">
            {a.businessName} <Pill status={a.status}>{a.status === 'PENDING' ? 'Under review' : a.status.toLowerCase()}</Pill>
          </h2>
          <p className="muted">Submitted {dateTime(a.createdAt)}. {a.status === 'PENDING' ? 'You will get a notification when an administrator has reviewed your application.' : a.status === 'SUSPENDED' ? `Suspended: ${a.reviewNote}` : ''}</p>
          <ol className="lifecycle">
            <li className="is-done">
              <span className="dot" />
              Registered
            </li>
            <li className={a.status !== 'PENDING' ? 'is-done' : ''} aria-current={a.status === 'PENDING' ? 'step' : undefined}>
              <span className="dot" />
              Verification
            </li>
            <li className={a.status === 'APPROVED' ? 'is-done' : ''}>
              <span className="dot" />
              Approved
            </li>
            <li>
              <span className="dot" />
              Add & publish stations
            </li>
          </ol>
          <h3 className="h3">Documents</h3>
          <ul className="plain-list">
            {app.data!.verifications.map((v) => (
              <li key={v.id}>
                {DOC_TYPES.find(([k]) => k === v.documentType)?.[1]} · {v.reference} · <Pill status={v.status === 'ACCEPTED' ? 'APPROVED' : v.status === 'SUBMITTED' ? 'PENDING' : v.status}>{v.status.toLowerCase()}</Pill>
              </li>
            ))}
          </ul>
          <p className="small muted">
            <DemoTag>Demo</DemoTag> Document references are recorded for manual review by an administrator. No automated KYC or ownership verification service is connected.
          </p>
        </Card>
      ) : (
        <Card>
          {a?.status === 'REJECTED' && (
            <div className="notice notice-bad">
              <Icon name="circle-alert" /> Your previous application was not approved: {a.reviewNote}. Update the details and submit again.
            </div>
          )}
          <h2 className="h3">Owner & business information</h2>
          <div className="form-grid">
            <Field label="Business or owner name">{(id) => <Input id={id} value={f.businessName} onChange={(e) => d.update({ businessName: e.target.value })} data-testid="biz-name" />}</Field>
            <Field label="Business type">
              {(id) => (
                <Select id={id} value={f.businessType} onChange={(e) => d.update({ businessType: e.target.value })}>
                  <option value="individual">Individual / home host</option>
                  <option value="company">Company</option>
                  <option value="society">Housing society</option>
                  <option value="government">Government body</option>
                  <option value="other">Other</option>
                </Select>
              )}
            </Field>
            <Field label="Contact email" hint="Never shown publicly.">
              {(id) => <Input id={id} type="email" value={f.contactEmail} onChange={(e) => d.update({ contactEmail: e.target.value })} />}
            </Field>
            <Field label="Contact phone" hint="Never shown publicly.">
              {(id) => <Input id={id} type="tel" value={f.contactPhone} onChange={(e) => d.update({ contactPhone: e.target.value })} data-testid="biz-phone" />}
            </Field>
            <Field label="GSTIN" optional>
              {(id) => <Input id={id} value={f.gstin} onChange={(e) => d.update({ gstin: e.target.value.toUpperCase() })} maxLength={15} />}
            </Field>
            <Field label="Business address">{(id) => <Input id={id} value={f.address} onChange={(e) => d.update({ address: e.target.value })} data-testid="biz-address" />}</Field>
          </div>
          <h2 className="h3">Ownership or operating-authority verification</h2>
          {f.docs.map((doc, i) => (
            <div key={i} className="form-grid doc-row">
              <Field label="Document">
                {(id) => (
                  <Select id={id} value={doc.documentType} onChange={(e) => d.update({ docs: f.docs.map((x, j) => (j === i ? { ...x, documentType: e.target.value } : x)) })}>
                    {DOC_TYPES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Reference" hint="Document number, registry ID or file reference for the reviewer.">
                {(id) => <Input id={id} value={doc.reference} onChange={(e) => d.update({ docs: f.docs.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)) })} data-testid={`doc-ref-${i}`} />}
              </Field>
            </div>
          ))}
          {f.docs.length < 4 && (
            <button type="button" className="link-btn" onClick={() => d.update({ docs: [...f.docs, { documentType: 'electrical_safety', reference: '' }] })}>
              + Add another document
            </button>
          )}
          <label className="check">
            <input type="checkbox" checked={f.declaration} onChange={(e) => d.update({ declaration: e.target.checked })} data-testid="declaration" />
            <span>I declare that I own or am authorised to operate the charging equipment I will list, and that it meets applicable electrical safety rules.</span>
          </label>
          {d.dirty && <p className="small muted">Draft saved on this device — switching mode will not lose it.</p>}
          <ErrorNote error={err} />
          <Btn icon="send" busy={busy} onClick={submit} disabled={!user.emailVerified} data-testid="submit-application">
            Submit for verification
          </Btn>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dashboard
export function PartnerDashboard() {
  const r = useApi<any>('/api/partner/overview');
  if (r.error) return <ErrorNote error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const { counts, revenue, upcoming } = r.data;
  return (
    <div>
      <PageHead
        kicker="Station Partner"
        title="Partner dashboard"
        actions={
          <Link to="/partner/stations/new" className="btn btn-primary" data-gloss>
            <span className="btn-inner">
              <Icon name="plus" /> Add station
            </span>
          </Link>
        }
      >
        Your stations, upcoming reservations and earnings. Figures come from the booking ledger.
      </PageHead>
      <div className="stats">
        <Stat icon="plug-zap" label="Stations" value={counts.stations} sub={`${counts.published} published · ${counts.inReview} in review`} />
        <Stat icon="calendar-clock" label="Upcoming bookings" value={counts.upcoming} />
        <Stat icon="check-check" label="Completed sessions" value={counts.completed} />
        <Stat icon="indian-rupee" label="Expected payout" value={rupees(revenue.expectedPayoutPaise)} sub="completed sessions, not yet paid out" />
      </div>
      <div className="two-col">
        <Card>
          <h2 className="h3">Next reservations</h2>
          {!upcoming.length && <p className="muted">No upcoming bookings.</p>}
          <ul className="plain-list">
            {upcoming.map((b: any) => (
              <li key={b.id}>
                <Link to={`/partner/bookings?focus=${b.id}`}>
                  <strong>{dateTime(b.startsAt)}</strong> · {b.stationName} · {b.connectorLabel} · {b.driverFirstName} · <Pill status={b.status}>{statusLabel(b.status, true)}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="h3">Earnings so far</h2>
          <div className="estimate">
            <div className="est-row">
              <span>Charging revenue (base)</span>
              <strong>{rupees(revenue.grossBasePaise)}</strong>
            </div>
            <div className="est-row">
              <span>Platform commission</span>
              <strong>−{rupees(revenue.commissionPaise)}</strong>
            </div>
            <div className="est-row est-total">
              <span>Your share</span>
              <strong>{rupees(revenue.partnerNetPaise)}</strong>
            </div>
          </div>
          <Link to="/partner/revenue">Revenue & payouts →</Link>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bookings calendar
export function PartnerBookings() {
  const toast = useToast();
  const { loc } = useRouter();
  const [dayF, setDayF] = useState<string>('all');
  const r = useApi<{ bookings: any[] }>('/api/partner/bookings');
  const [act, setAct] = useState<{ b: any; action: string } | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const focus = loc.search.get('focus');
  useEffect(() => {
    if (focus) get(`/api/partner/bookings/${focus}`).then((x) => setDetail(x.booking)).catch(() => {});
  }, [focus]);
  const today = isoDateIST();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const all = r.data?.bookings || [];
  const LIVE = ['RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'];
  const upcoming = all.filter((b) => LIVE.includes(b.status) && (new Date(b.endsAt).getTime() > Date.now() || b.status !== 'RESERVED'));
  const list = dayF === 'all' ? upcoming : dayF === 'history' ? [...all].reverse() : all.filter((b) => isoDateIST(new Date(b.startsAt)) === dayF);
  const run = async () => {
    if (!act) return;
    setBusy(true);
    setErr(null);
    try {
      const body = act.action === 'check-in' ? { code: val } : act.action === 'complete' ? { energyKwh: Number(val) } : act.action === 'cancel' ? { reason: val } : {};
      await post(`/api/partner/bookings/${act.b.id}/${act.action}`, body);
      toast(act.action === 'check-in' ? 'Driver checked in' : act.action === 'start' ? 'Charging started' : act.action === 'complete' ? 'Session completed and energy recorded' : act.action === 'cancel' ? 'Booking cancelled; the driver is refunded in full' : 'Recorded', 'good');
      setAct(null);
      setVal('');
      r.reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const ACTIONS: Record<string, [string, string][]> = {
    CONFIRMED: [
      ['check-in', 'Check in'],
      ['cancel', 'Cancel'],
      ['no-show', 'No-show'],
    ],
    CHECKED_IN: [
      ['start', 'Start charging'],
      ['cancel', 'Cancel'],
    ],
    IN_PROGRESS: [['complete', 'Complete session']],
    RESERVED: [['cancel', 'Cancel hold']],
  };
  return (
    <div>
      <PageHead kicker="Station Partner" title="Booking calendar">
        Reservations at your stations. Check drivers in with their booking code. Energy is entered by you — no charger telemetry is connected.
      </PageHead>
      <div className="day-strip" role="tablist" aria-label="Day">
        <button role="tab" aria-selected={dayF === 'all'} className={`day-cell ${dayF === 'all' ? 'is-on' : ''}`} onClick={() => setDayF('all')}>
          <strong>Upcoming</strong>
          <span>{upcoming.length}</span>
        </button>
        {days.map((dd) => {
          const n = all.filter((b) => isoDateIST(new Date(b.startsAt)) === dd && LIVE.concat('COMPLETED').includes(b.status)).length;
          return (
            <button key={dd} role="tab" aria-selected={dayF === dd} className={`day-cell ${dayF === dd ? 'is-on' : ''}`} onClick={() => setDayF(dd)}>
              <strong>{day(`${dd}T12:00:00+05:30`)}</strong>
              <span>{n}</span>
            </button>
          );
        })}
        <button role="tab" aria-selected={dayF === 'history'} className={`day-cell ${dayF === 'history' ? 'is-on' : ''}`} onClick={() => setDayF('history')}>
          <strong>History</strong>
          <span>{all.length}</span>
        </button>
      </div>
      <ErrorNote error={r.error} onRetry={r.reload} />
      {r.data && !list.length && <Empty icon="calendar" title="No bookings here" />}
      <div className="list">
        {list.map((b) => (
          <div key={b.id} className="row-card card" data-testid="partner-booking" data-code={b.code} data-status={b.status}>
            <div className="row-main">
              <strong>
                {day(b.startsAt)} {time(b.startsAt)}–{time(b.endsAt)} · {b.stationName}
              </strong>
              <span className="muted small">
                {b.connectorLabel} ({connectorLabel(b.standard)}) · driver {b.driverFirstName} · {b.plannedKwh} kWh booked{b.energyKwh !== null && b.energyKwh !== undefined ? ` · ${b.energyKwh} kWh delivered` : ''}
                {b.status.startsWith('CANCELLED') ? ' · cancelled — any payment refunded to the driver' : ` · your share ${rupees(b.partnerAmountPaise)}`}
              </span>
            </div>
            <div className="row-side">
              <Pill status={b.status}>{statusLabel(b.status, true)}</Pill>
              <div className="row-actions">
                {(ACTIONS[b.status] || []).map(([a, l]) => (
                  <Btn key={a} size="sm" variant={a === 'cancel' || a === 'no-show' ? 'ghost' : 'primary'} onClick={() => (setAct({ b, action: a }), setVal(''), setErr(null))} data-action={a}>
                    {l}
                  </Btn>
                ))}
                <button type="button" className="link-btn small" onClick={() => get(`/api/partner/bookings/${b.id}`).then((x) => setDetail(x.booking))}>
                  Details
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!act} title={act ? `${act.action === 'check-in' ? 'Check in' : act.action === 'complete' ? 'Complete session' : act.action === 'cancel' ? 'Cancel booking' : act.action === 'start' ? 'Start charging' : 'Record no-show'} · ${act.b.code}` : ''} onClose={() => setAct(null)}>
        {act?.action === 'check-in' && <Field label="Booking code from the driver">{(id) => <Input id={id} value={val} onChange={(e) => setVal(e.target.value.toUpperCase())} placeholder="GP-XXXXXX" data-testid="checkin-code" />}</Field>}
        {act?.action === 'complete' && (
          <Field label="Energy delivered (kWh)" hint={`Booked: ${act.b.plannedKwh} kWh. If less is delivered, the driver is refunded the unused part automatically.`}>
            {(id) => <Input id={id} type="number" min={0} step={0.1} value={val} onChange={(e) => setVal(e.target.value)} data-testid="energy-input" />}
          </Field>
        )}
        {act?.action === 'cancel' && <Field label="Reason (shared with the driver)">{(id) => <Textarea id={id} rows={2} value={val} onChange={(e) => setVal(e.target.value)} />}</Field>}
        {act?.action === 'start' && <p>Confirm the vehicle is connected and charging has started on the charger.</p>}
        {act?.action === 'no-show' && <p>Record that the driver did not arrive. Available 30 minutes after the booked start.</p>}
        <ErrorNote error={err} />
        <div className="modal-actions">
          <Btn variant="ghost" onClick={() => setAct(null)}>
            Close
          </Btn>
          <Btn icon="check" busy={busy} onClick={run} data-testid="confirm-action">
            Confirm
          </Btn>
        </div>
      </Modal>
      <Modal open={!!detail} title={detail ? `Booking ${detail.code}` : ''} onClose={() => setDetail(null)}>
        {detail && (
          <div className="estimate" data-testid="partner-booking-detail">
            <p>
              {detail.station.name} · {dateTime(detail.startsAt)} · driver {detail.driver?.firstName} {detail.driver?.vehicle ? `(${detail.driver.vehicle})` : ''}
            </p>
            <div className="est-row">
              <span>
                Charging amount ({detail.plannedKwh} kWh × {rupees(detail.pricing.ratePaise)})
              </span>
              <strong>{rupees(detail.pricing.basePaise)}</strong>
            </div>
            <div className="est-row">
              <span>Platform commission ({detail.pricing.commissionBps / 100}%)</span>
              <strong>−{rupees(detail.pricing.providerCommissionPaise)}</strong>
            </div>
            <div className="est-row est-total">
              <span>Your amount (before other deductions)</span>
              <strong>{rupees(detail.pricing.partnerAmountPaise)}</strong>
            </div>
            <p className="muted small">
              The driver also paid a {detail.pricing.feeBps / 100}% service fee ({rupees(detail.pricing.customerFeePaise)}) to the platform; it is not deducted from your amount. Total platform commission: {rupees(detail.pricing.platformRevenuePaise)}.
            </p>
            <p className="small">Payment: {detail.payments.map((p: any) => p.status.toLowerCase()).join(', ') || 'none'}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ revenue
export function PartnerRevenue() {
  const r = useApi<any>('/api/partner/revenue');
  const st = useApi<{ entries: any[] }>('/api/partner/statement');
  if (r.error) return <ErrorNote error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const s = r.data.summary;
  const csv = () => {
    const rows = [['date', 'booking', 'kind', 'debit_inr', 'credit_inr', 'memo'], ...(st.data?.entries || []).map((e) => [new Date(e.createdAt).toISOString(), e.bookingCode || '', e.kind, (e.debitPaise / 100).toFixed(2), (e.creditPaise / 100).toFixed(2), String(e.memo || '').replace(/"/g, "'")])];
    const blob = new Blob([rows.map((x) => x.map((c) => `"${c}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `greenplug-statement-${isoDateIST()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <PageHead kicker="Station Partner" title="Revenue & payouts">
        Only payments verified by the payment provider count. Refunds reverse revenue and commission explicitly.
      </PageHead>
      <div className="stats" data-testid="revenue-stats">
        <Stat label="Charging revenue (base)" value={<span data-testid="rev-gross">{rupees(s.grossBasePaise)}</span>} />
        <Stat label="Platform commission" value={<span data-testid="rev-commission">{rupees(s.commissionPaise)}</span>} />
        <Stat label="Your share" value={<span data-testid="rev-net">{rupees(s.partnerNetPaise)}</span>} sub={`${rupees(s.earnedCompletedPaise)} from completed sessions`} />
        <Stat label="Expected payout" value={<span data-testid="rev-payout">{rupees(s.expectedPayoutPaise)}</span>} sub={`${rupees(s.pendingSessionsPaise)} more after upcoming sessions complete`} />
      </div>
      <div className="notice notice-warn">
        <DemoTag>Not connected</DemoTag> {r.data.note} Taxes and payment-processing fees are not yet deducted; they depend on the final business and provider configuration.
      </div>
      <h2 className="h3 section-title">Per booking</h2>
      <div className="table-wrap">
        <table className="table" data-testid="revenue-table">
          <thead>
            <tr>
              <th>Booking</th>
              <th>Station</th>
              <th>Status</th>
              <th>Base</th>
              <th>Commission</th>
              <th>Refunded (total)</th>
              <th>Your net</th>
            </tr>
          </thead>
          <tbody>
            {r.data.bookings.map((b: any) => (
              <tr key={b.id} data-code={b.code}>
                <td className="mono">{b.code}</td>
                <td>{b.stationName}</td>
                <td>
                  <Pill status={b.status}>{statusLabel(b.status, true)}</Pill>
                </td>
                <td>{rupees(b.basePaise)}</td>
                <td>−{rupees(b.providerCommissionPaise)}</td>
                <td>{b.refundedPaise ? rupees(b.refundedPaise) : '—'}</td>
                <td>
                  <strong>{rupees(b.partnerNetPaise)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!r.data.bookings.length && <p className="muted">No paid bookings yet.</p>}
      </div>
      <div className="section-title row-between">
        <h2 className="h3">Statement</h2>
        <Btn size="sm" variant="glass" icon="file-text" onClick={csv} disabled={!st.data?.entries.length}>
          Download CSV
        </Btn>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Booking</th>
              <th>Entry</th>
              <th>Debit</th>
              <th>Credit</th>
            </tr>
          </thead>
          <tbody>
            {st.data?.entries.map((e, i) => (
              <tr key={i}>
                <td>{dateTime(e.createdAt)}</td>
                <td className="mono">{e.bookingCode}</td>
                <td>{e.memo || e.kind}</td>
                <td>{e.debitPaise ? rupees(e.debitPaise) : ''}</td>
                <td>{e.creditPaise ? rupees(e.creditPaise) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="h3 section-title">Payout records</h2>
      {!r.data.payouts.length && <p className="muted">No payout statements yet. Administrators create them per period.</p>}
      <ul className="plain-list">
        {r.data.payouts.map((p: any) => (
          <li key={p.id}>
            {String(p.periodStart).slice(0, 10)} – {String(p.periodEnd).slice(0, 10)} · {rupees(p.amountPaise)} · {p.bookingCount} booking(s) · <Pill status={p.status}>{p.status.replace('_', ' ').toLowerCase()}</Pill>
          </li>
        ))}
      </ul>
    </div>
  );
}
