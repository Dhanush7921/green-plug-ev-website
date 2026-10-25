import { useMemo, useState } from 'react';
import { ApiError, del, get, patch, post } from '../../lib/api';
import { CONFIDENCE_LABELS, connectorLabel, CONNECTOR_LABELS, dateTime, rupees, statusLabel } from '../../lib/format';
import { useApi, useDraft } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { useTheme } from '../../../../../src/lib/theme';
import { Icon } from '../../components/Icon';
import { Btn, Card, DemoTag, Empty, ErrorNote, Field, Input, Loading, PageHead, Pill, Select, Textarea } from '../../components/ui';
import { MapView, type MapPoint } from '../../map/MapView';
import { DemoInbox } from '../auth/Auth';
import { NewTicket } from './Bookings';
import { StationCard } from './Discover';

// ------------------------------------------------------------------ trip planner
function PlaceInput({ label, value, onPick }: { label: string; value: any; onPick: (p: any) => void }) {
  const [q, setQ] = useState(value?.label || '');
  const [opts, setOpts] = useState<any[]>([]);
  return (
    <Field label={label}>
      {(id) => (
        <div className="place-field">
          <Input
            id={id}
            value={q}
            placeholder="Search a city or area"
            onChange={async (e) => {
              setQ(e.target.value);
              if (e.target.value.trim().length < 2) return setOpts([]);
              const r = await get(`/api/geo/search?q=${encodeURIComponent(e.target.value)}`).catch(() => ({ places: [] }));
              setOpts(r.places);
            }}
          />
          {opts.length > 0 && (
            <ul className="suggest glass">
              {opts.map((p) => (
                <li key={p.label}>
                  <button type="button" onClick={() => (onPick(p), setQ(p.label), setOpts([]))}>
                    {p.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

export function Trips() {
  const toast = useToast();
  const d = useDraft('trip', { origin: null as any, destination: null as any, rangeKm: '180' });
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const saved = useApi<{ trips: any[] }>('/api/trips');
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post('/api/trips/plan', { origin: d.value.origin, destination: d.value.destination, rangeKm: Number(d.value.rangeKm) });
      setPlan(r);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    await post('/api/trips', { title: `${plan.plan.origin.label} → ${plan.plan.destination.label}`, plan: plan.plan });
    toast('Trip saved', 'good');
    d.clear();
    saved.reload();
  };
  const points: MapPoint[] = plan
    ? [
        { id: 'origin', lat: plan.plan.origin.latitude, lng: plan.plan.origin.longitude, label: 'Start', title: `Start: ${plan.plan.origin.label}`, tone: 'neutral' },
        ...plan.plan.stops.map((s: any, i: number) => ({ id: s.stationId, lat: s.location.latitude, lng: s.location.longitude, label: `Stop ${i + 1}`, title: s.name, tone: 'good' as const, approximate: !s.exactLocation })),
        { id: 'destination', lat: plan.plan.destination.latitude, lng: plan.plan.destination.longitude, label: 'End', title: `Destination: ${plan.plan.destination.label}`, tone: 'neutral' },
      ]
    : [];
  return (
    <div>
      <PageHead kicker="EV Driver" title="Trip planner">
        Plan charging stops along a route using your usable range. A 20% range reserve is kept at every stop.
      </PageHead>
      <Card className="trip-form">
        <div className="form-grid">
          <PlaceInput label="From" value={d.value.origin} onPick={(p) => d.update({ origin: { label: p.label, latitude: p.latitude, longitude: p.longitude } })} />
          <PlaceInput label="To" value={d.value.destination} onPick={(p) => d.update({ destination: { label: p.label, latitude: p.latitude, longitude: p.longitude } })} />
          <Field label="Usable range (km)" hint="What your EV can drive on a full charge in real conditions.">
            {(id) => <Input id={id} type="number" min={20} max={1000} value={d.value.rangeKm} onChange={(e) => d.update({ rangeKm: e.target.value })} />}
          </Field>
        </div>
        <ErrorNote error={err} />
        <Btn icon="route" busy={busy} disabled={!d.value.origin || !d.value.destination} onClick={run} data-testid="plan-trip">
          Plan route
        </Btn>
      </Card>
      {plan && (
        <div className="trip-result">
          <div className="notice">
            <DemoTag>Demo routing</DemoTag> {plan.plan.routeNote}
          </div>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Estimated distance</span>
              <strong className="stat-value">{plan.plan.distanceKm} km</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Charging stops</span>
              <strong className="stat-value">{plan.plan.stops.length}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Reserve kept</span>
              <strong className="stat-value">{plan.plan.reserveKm} km</strong>
            </div>
          </div>
          {!plan.plan.feasible && (
            <div className="notice notice-bad">
              <Icon name="triangle-alert" /> No published station is reachable within your range on part of this route. Increase the range or choose another route.
            </div>
          )}
          <MapView points={points} path={plan.plan.path} height={360} label="Trip route" />
          <ol className="stops">
            {plan.plan.stops.map((s: any, i: number) => (
              <li key={s.stationId} className="card">
                <span className="stop-n">{i + 1}</span>
                <div>
                  <Link to={`/stations/${s.stationId}`}>
                    <strong>{s.name}</strong>
                  </Link>
                  <p className="muted small">
                    {s.kmFromStart} km from start · {s.detourKm} km detour · up to {s.maxPowerKw} kW · from {rupees(s.minPricePaise)}/kWh · {s.connectors.map(connectorLabel).join(', ')}
                  </p>
                  <p className="small">{CONFIDENCE_LABELS[s.availabilityConfidence]}</p>
                </div>
              </li>
            ))}
          </ol>
          <Btn variant="glass" icon="heart" onClick={save}>
            Save trip
          </Btn>
        </div>
      )}
      <h2 className="h3 section-title">Saved trips</h2>
      {saved.data && !saved.data.trips.length && <p className="muted">No saved trips.</p>}
      <div className="list">
        {saved.data?.trips.map((t) => (
          <div key={t.id} className="row-card card">
            <div className="row-main">
              <strong>{t.title}</strong>
              <span className="muted small">
                {t.distanceKm} km · {t.stops.length} stop(s) · range {t.rangeKm} km · {dateTime(t.createdAt)}
              </span>
            </div>
            <button type="button" className="icon-btn" aria-label={`Delete trip ${t.title}`} onClick={() => del(`/api/trips/${t.id}`).then(saved.reload)}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ favourites
export function Saved() {
  const r = useApi<{ stations: any[] }>('/api/stations?saved=1');
  return (
    <div>
      <PageHead kicker="EV Driver" title="Favourite stations" />
      {r.loading && !r.data && <Loading />}
      {r.data && !r.data.stations.length && (
        <Empty icon="heart" title="No favourites yet">
          Tap the heart on a station to save it here.
        </Empty>
      )}
      <div className="card-grid">
        {r.data?.stations.map((s) => (
          <StationCard key={s.id} s={s} onToggleSave={() => del(`/api/me/saved-stations/${s.id}`).then(r.reload)} />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ garage
export function Garage() {
  const toast = useToast();
  const mine = useApi<{ vehicles: any[] }>('/api/me/vehicles');
  const cat = useApi<{ variants: any[]; note: string }>('/api/catalog/vehicles');
  const d = useDraft('vehicle', { brand: '', variantId: '', nickname: '', manual: false, connectors: [] as string[] });
  const [err, setErr] = useState<ApiError | null>(null);
  const brands = useMemo(() => [...new Set(cat.data?.variants.map((v) => v.brand))], [cat.data]);
  const add = async () => {
    setErr(null);
    try {
      await post('/api/me/vehicles', d.value.manual ? { nickname: d.value.nickname, connectors: d.value.connectors } : { nickname: d.value.nickname, variantId: d.value.variantId });
      d.clear();
      d.setValue({ brand: '', variantId: '', nickname: '', manual: false, connectors: [] });
      toast('Vehicle saved', 'good');
      mine.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  return (
    <div>
      <PageHead kicker="EV Driver" title="My vehicles">
        Saved vehicles are used to check connector compatibility and estimate charging time. They are shared across both modes.
      </PageHead>
      <div className="list">
        {mine.data?.vehicles.map((v) => (
          <div key={v.id} className="row-card card" data-testid="vehicle-row">
            <div className="row-main">
              <strong>
                {v.nickname} {v.isDefault && <Pill tone="good">Default</Pill>}
              </strong>
              <span className="muted small">
                {v.brand ? `${v.brand} ${v.model} ${v.variant || ''}` : 'Custom vehicle'} · inlets: {v.connectors.map(connectorLabel).join(', ')}
                {v.maxDcKw ? ` · DC up to ${v.maxDcKw} kW` : ''}
                {v.maxAcKw ? ` · AC up to ${v.maxAcKw} kW` : ''}
              </span>
              {v.evidenceState !== 'verified' && <span className="small warn-text">Specs unverified — confirm with your vehicle manual.</span>}
            </div>
            <div className="row-side">
              {!v.isDefault && (
                <button type="button" className="link-btn" onClick={() => patch(`/api/me/vehicles/${v.id}`, { isDefault: true }).then(mine.reload)}>
                  Make default
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={`Remove ${v.nickname}`} onClick={() => del(`/api/me/vehicles/${v.id}`).then(mine.reload)}>
                <Icon name="trash" />
              </button>
            </div>
          </div>
        ))}
        {mine.data && !mine.data.vehicles.length && <Empty icon="car" title="No vehicles yet" />}
      </div>
      <Card className="add-vehicle">
        <h2 className="h3">Add a vehicle</h2>
        <div className="seg">
          <button type="button" className={`seg-btn ${!d.value.manual ? 'is-active' : ''}`} onClick={() => d.update({ manual: false })}>
            From catalogue
          </button>
          <button type="button" className={`seg-btn ${d.value.manual ? 'is-active' : ''}`} onClick={() => d.update({ manual: true })}>
            Enter connectors
          </button>
        </div>
        <div className="form-grid">
          {!d.value.manual ? (
            <>
              <Field label="Brand">
                {(id) => (
                  <Select id={id} value={d.value.brand} onChange={(e) => d.update({ brand: e.target.value, variantId: '' })}>
                    <option value="">Choose…</option>
                    {brands.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Model">
                {(id) => (
                  <Select id={id} value={d.value.variantId} onChange={(e) => d.update({ variantId: e.target.value })} disabled={!d.value.brand}>
                    <option value="">Choose…</option>
                    {cat.data?.variants
                      .filter((v) => v.brand === d.value.brand)
                      .map((v) => (
                        <option key={v.variantId} value={v.variantId}>
                          {v.model} {v.variant} · {v.connectors.map(connectorLabel).join('/')}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            </>
          ) : (
            <fieldset className="field">
              <legend>Charging inlets</legend>
              <div className="chip-row">
                {Object.keys(CONNECTOR_LABELS).map((c) => (
                  <button key={c} type="button" className={`chip-btn ${d.value.connectors.includes(c) ? 'is-on' : ''}`} aria-pressed={d.value.connectors.includes(c)} onClick={() => d.update({ connectors: d.value.connectors.includes(c) ? d.value.connectors.filter((x) => x !== c) : [...d.value.connectors, c] })}>
                    {CONNECTOR_LABELS[c]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <Field label="Nickname">{(id) => <Input id={id} value={d.value.nickname} onChange={(e) => d.update({ nickname: e.target.value })} placeholder="e.g. Family car" />}</Field>
        </div>
        {cat.data && <p className="muted small">{cat.data.note}</p>}
        <ErrorNote error={err} />
        <Btn icon="plus" onClick={add} disabled={!d.value.nickname || (!d.value.manual && !d.value.variantId)}>
          Save vehicle
        </Btn>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ payments
export function Payments() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const r = useApi<{ orders: any[]; refunds: any[] }>('/api/payments/transactions');
  const pref = (user?.preferences.preferredPaymentMethod as string) || 'upi';
  const setPref = async (m: string) => {
    await patch('/api/me', { preferences: { preferredPaymentMethod: m } });
    await refresh();
    toast('Preferred payment method saved', 'good');
  };
  return (
    <div>
      <PageHead kicker="EV Driver" title="Payments">
        Payment methods, transactions and refunds.
      </PageHead>
      <Card>
        <h2 className="h3">Payment method</h2>
        <div className="notice notice-warn">
          <DemoTag>Test mode</DemoTag> Real payment collection is disabled until a merchant account, credentials and webhook verification are configured. Card and UPI details are never stored by GREEN PLUG EV — they are entered on the payment provider's secure page.
        </div>
        <div className="seg">
          {[
            ['upi', 'UPI'],
            ['card', 'Card'],
            ['netbanking', 'Net banking'],
            ['wallet', 'Wallet'],
          ].map(([k, l]) => (
            <button key={k} type="button" className={`seg-btn ${pref === k ? 'is-active' : ''}`} aria-pressed={pref === k} onClick={() => setPref(k)}>
              {l}
            </button>
          ))}
        </div>
      </Card>
      <h2 className="h3 section-title">Transactions</h2>
      {r.loading && !r.data && <Loading />}
      {r.data && !r.data.orders.length && <Empty icon="receipt" title="No transactions yet" />}
      <div className="table-wrap">
        {!!r.data?.orders.length && (
          <table className="table" data-testid="transactions">
            <thead>
              <tr>
                <th>Date</th>
                <th>Booking</th>
                <th>Amount</th>
                <th>Refunded</th>
                <th>Status</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {r.data.orders.map((o) => (
                <tr key={o.id}>
                  <td>{dateTime(o.createdAt)}</td>
                  <td>
                    <Link to={`/bookings/${o.bookingId}`}>{o.code}</Link> <span className="muted small">{o.stationName}</span>
                  </td>
                  <td>{rupees(o.amountPaise)}</td>
                  <td>{o.refundedPaise ? rupees(o.refundedPaise) : '—'}</td>
                  <td>
                    <Pill status={o.status}>{o.status.toLowerCase().replace('_', ' ')}</Pill>
                    {o.failureReason && <span className="muted small"> {o.failureReason}</span>}
                  </td>
                  <td>{o.provider === 'test' ? <DemoTag>test</DemoTag> : o.provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!!r.data?.refunds.length && (
        <>
          <h2 className="h3 section-title">Refunds</h2>
          <ul className="plain-list">
            {r.data.refunds.map((x) => (
              <li key={x.id}>
                {dateTime(x.createdAt)} · {rupees(x.amountPaise)} · {x.reason} · <Pill status={x.status}>{x.status.toLowerCase()}</Pill>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ profile
export function Profile() {
  const { user, refresh, logout } = useSession();
  const { setTheme, theme } = useTheme();
  const { navigate } = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ fullName: user?.fullName || '', phone: user?.phone || '' });
  const [err, setErr] = useState<ApiError | null>(null);
  if (!user) return null;
  const prefs = user.preferences as Record<string, unknown>;
  const save = async () => {
    setErr(null);
    try {
      await patch('/api/me', { fullName: f.fullName, phone: f.phone });
      await refresh();
      toast('Profile saved', 'good');
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const setPref = async (p: Record<string, unknown>) => {
    await patch('/api/me', { preferences: p });
    await refresh();
  };
  return (
    <div>
      <PageHead kicker="Account" title="Profile & settings">
        One account for EV Driver and Station Partner. Your details, vehicles and booking history stay the same in both modes.
      </PageHead>
      <div className="two-col">
        <Card>
          <h2 className="h3">Your details</h2>
          <Field label="Full name">{(id) => <Input id={id} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}</Field>
          <Field label="Mobile" optional>
            {(id) => <Input id={id} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
          </Field>
          <p className="small muted">
            Email: {user.email} {user.emailVerified ? <Pill tone="good">verified</Pill> : <Link to="/verify">verify now</Link>}
          </p>
          <ErrorNote error={err} />
          <Btn icon="check" onClick={save}>
            Save
          </Btn>
        </Card>
        <Card>
          <h2 className="h3">Roles & access</h2>
          <p className="small">These come from the server and decide what SWITCH MODE can open.</p>
          <div className="chips">
            {user.roles.map((r) => (
              <Pill key={r} tone="neutral">
                {r}
              </Pill>
            ))}
            {user.partner ? <Pill status={user.partner.status}>partner {user.partner.status.toLowerCase()}</Pill> : <Pill tone="neutral">no partner application</Pill>}
          </div>
          <h2 className="h3">Preferences</h2>
          <div className="seg" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} type="button" className={`seg-btn ${theme === t ? 'is-active' : ''}`} onClick={() => (setTheme(t), setPref({ theme: t }))}>
                <Icon name={t === 'light' ? 'sun' : 'moon'} /> {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={prefs.notifyBookingUpdates !== false} onChange={(e) => setPref({ notifyBookingUpdates: e.target.checked })} /> <span>Booking updates</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.notifyPromotions === true} onChange={(e) => setPref({ notifyPromotions: e.target.checked })} /> <span>Offers and news</span>
          </label>
          <Btn
            variant="glass"
            icon="log-out"
            onClick={async () => {
              await logout();
              navigate('/welcome');
            }}
          >
            Sign out
          </Btn>
        </Card>
      </div>
      <Card>
        <DemoInbox />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ support
export function Support({ workspace = 'driver' }: { workspace?: 'driver' | 'partner' }) {
  const { navigate } = useRouter();
  const r = useApi<{ tickets: any[] }>('/api/support/tickets');
  const [open, setOpen] = useState(false);
  const base = workspace === 'partner' ? '/partner/support' : '/support';
  const tickets = r.data?.tickets.filter((t) => t.workspace === workspace) || [];
  return (
    <div>
      <PageHead kicker={workspace === 'partner' ? 'Station Partner' : 'EV Driver'} title={workspace === 'partner' ? 'Partner support' : 'Help & support'} actions={<Btn icon="plus" onClick={() => setOpen(true)}>New request</Btn>}>
        Requests are answered by the GREEN PLUG EV team in the Admin workspace. For emergencies call 112.
      </PageHead>
      {r.data && !tickets.length && <Empty icon="headset" title="No support requests" />}
      <div className="list">
        {tickets.map((t) => (
          <Link key={t.id} to={`${base}/${t.id}`} className="row-card card">
            <div className="row-main">
              <strong>{t.subject}</strong>
              <span className="muted small">
                {t.category} {t.bookingCode ? `· ${t.bookingCode}` : ''} · updated {dateTime(t.updatedAt)}
              </span>
            </div>
            <Pill status={t.status}>{t.status.toLowerCase().replace('_', ' ')}</Pill>
          </Link>
        ))}
      </div>
      <NewTicket open={open} onClose={() => setOpen(false)} workspace={workspace} onCreated={(id) => navigate(`${base}/${id}`)} />
    </div>
  );
}

export function Ticket({ id, workspace = 'driver' }: { id: string; workspace?: 'driver' | 'partner' }) {
  const r = useApi<{ ticket: any; messages: any[] }>(`/api/support/tickets/${id}`);
  const [msg, setMsg] = useState('');
  if (!r.data) return r.error ? <ErrorNote error={r.error} /> : <Loading />;
  return (
    <div>
      <Link to={workspace === 'partner' ? '/partner/support' : '/support'} className="back-link">
        <Icon name="arrow-left" /> Support
      </Link>
      <PageHead title={r.data.ticket.subject}>
        <Pill status={r.data.ticket.status}>{r.data.ticket.status.toLowerCase()}</Pill> · {r.data.ticket.category}
      </PageHead>
      <div className="thread">
        {r.data.messages.map((m, i) => (
          <div key={i} className={`msg ${m.authorRole === 'admin' ? 'from-admin' : 'from-me'}`}>
            <span className="muted small">
              {m.authorRole === 'admin' ? 'GREEN PLUG EV support' : 'You'} · {dateTime(m.createdAt)}
            </span>
            <p>{m.body}</p>
          </div>
        ))}
      </div>
      <Card>
        <Field label="Reply">{(fid) => <Textarea id={fid} rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />}</Field>
        <Btn icon="send" disabled={!msg.trim()} onClick={() => post(`/api/support/tickets/${id}/messages`, { body: msg }).then(() => (setMsg(''), r.reload()))}>
          Send
        </Btn>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ safety and integrations
export function Safety() {
  return (
    <div>
      <PageHead kicker="EV Driver" title="Charging safety">
        Simple checks for every session. In an emergency, call <a href="tel:112">112</a>.
      </PageHead>
      <div className="card-grid">
        {[
          ['shield-check', 'Before plugging in', 'Check the cable, plug and inlet for damage, water or debris. Do not use a charger with exposed wires or burn marks.'],
          ['plug-zap', 'Use the right connector', 'Only use the connector your vehicle lists. Never force a plug or use adapters that are not approved by your manufacturer.'],
          ['triangle-alert', 'If something is wrong', 'Stop the session from the vehicle or charger, unplug only when it is safe, step away and report it from the booking page.'],
          ['circle-parking', 'At the station', 'Park within the bay, keep cables off walkways, and follow host instructions — especially at private and home chargers.'],
          ['users', 'Home and private hosts', 'Meet in visible areas, share your booking code only with the host, and use in-app support rather than personal contact details.'],
          ['phone', 'Emergency', 'For fire, injury or electric shock call 112 immediately. Do not touch a person who may still be in contact with a live source.'],
        ].map(([icon, title, body]) => (
          <Card key={title}>
            <Icon name={icon as never} className="icon tile-icon" />
            <h2 className="h3">{title}</h2>
            <p>{body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function Integrations() {
  const r = useApi<{ demoMode: boolean; integrations: any[] }>('/api/integrations/status');
  return (
    <div>
      <PageHead kicker="System" title="Integrations & demo mode">
        What is connected and what is simulated in this environment. Nothing is purchased or charged.
      </PageHead>
      <div className="table-wrap">
        <table className="table" data-testid="integrations">
          <thead>
            <tr>
              <th>Integration</th>
              <th>Provider</th>
              <th>Status</th>
              <th>What this means</th>
            </tr>
          </thead>
          <tbody>
            {r.data?.integrations.map((i) => (
              <tr key={i.key}>
                <td>{i.key.replace('_', ' ')}</td>
                <td>{i.provider}</td>
                <td>
                  <Pill tone={i.status === 'CONFIGURED' ? 'good' : i.status === 'NOT_CONNECTED' || i.status === 'DISABLED' ? 'bad' : 'warn'}>{i.status.replace('_', ' ').toLowerCase()}</Pill>
                </td>
                <td className="small">{i.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Booking states shown in the app: {['RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].map((s) => statusLabel(s)).join(' → ')}.</p>
    </div>
  );
}
