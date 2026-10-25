import { useEffect, useState } from 'react';
import { ApiError, del, get, patch, post } from '../../lib/api';
import { AMENITY_LABELS, connectorLabel, CONNECTOR_LABELS, dateTime, rupees, WEEKDAYS } from '../../lib/format';
import { useApi, useDraft } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useToast } from '../../lib/toast';
import { Icon } from '../../components/Icon';
import { Btn, Card, DemoTag, Empty, ErrorNote, Field, Input, Loading, PageHead, Pill, Select, Textarea } from '../../components/ui';
import { MapView } from '../../map/MapView';

const LISTING: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'In review', APPROVED: 'Published', REJECTED: 'Changes requested', SUSPENDED: 'Suspended' };

export function PartnerStations() {
  const r = useApi<{ stations: any[] }>('/api/partner/stations');
  return (
    <div>
      <PageHead
        kicker="Station Partner"
        title="My stations"
        actions={
          <Link to="/partner/stations/new" className="btn btn-primary" data-gloss data-testid="add-station">
            <span className="btn-inner">
              <Icon name="plus" /> Add station
            </span>
          </Link>
        }
      >
        Listings go live after an administrator approves them. Changes to name, location or access send a published listing back to review.
      </PageHead>
      <ErrorNote error={r.error} onRetry={r.reload} />
      {r.loading && !r.data && <Loading />}
      {r.data && !r.data.stations.length && (
        <Empty icon="plug-zap" title="No stations yet">
          Add your first charging station.
        </Empty>
      )}
      <div className="list">
        {r.data?.stations.map((s) => (
          <Link key={s.id} to={`/partner/stations/${s.id}`} className="row-card card" data-testid="partner-station" data-name={s.name}>
            <div className="row-main">
              <strong>
                {s.name} {s.isDemo && <DemoTag>demo</DemoTag>}
              </strong>
              <span className="muted small">
                {s.area}, {s.city} · {s.accessType.toLowerCase()} · {s.connectors.length} connector(s){s.connectors.length ? ` · from ${rupees(Math.min(...s.connectors.map((c: any) => c.pricePerKwhPaise)))}/kWh` : ''}
              </span>
            </div>
            <div className="row-side">
              <Pill status={s.listingStatus}>{LISTING[s.listingStatus]}</Pill>
              <Pill status={s.operationalStatus}>{s.operationalStatus.replace('_', ' ').toLowerCase()}</Pill>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

type Hours = { weekday: number; open: boolean; opensAt: string; closesAt: string }[];
const DEFAULT_HOURS: Hours = WEEKDAYS.map((_, i) => ({ weekday: i, open: true, opensAt: '07:00', closesAt: '22:00' }));
type Details = { name: string; description: string; address: string; area: string; city: string; latitude: string; longitude: string; accessType: string; discloseExactLocation: boolean; accessNotes: string; amenities: string[]; slotMinutes: string; hours: Hours };
const EMPTY: Details = { name: '', description: '', address: '', area: '', city: '', latitude: '', longitude: '', accessType: 'PUBLIC', discloseExactLocation: false, accessNotes: '', amenities: ['parking'], slotMinutes: '30', hours: DEFAULT_HOURS };

function fromStation(s: any): Details {
  return {
    name: s.name,
    description: s.description || '',
    address: s.address,
    area: s.area,
    city: s.city,
    latitude: String(s.latitude),
    longitude: String(s.longitude),
    accessType: s.accessType,
    discloseExactLocation: s.discloseExactLocation,
    accessNotes: s.accessNotes || '',
    amenities: s.amenities,
    slotMinutes: String(s.slotMinutes),
    hours: WEEKDAYS.map((_, i) => {
      const h = s.hours.find((x: any) => x.weekday === i);
      return h ? { weekday: i, open: true, opensAt: h.opensAt, closesAt: h.closesAt === '00:00' ? '24:00' : h.closesAt } : { weekday: i, open: false, opensAt: '07:00', closesAt: '22:00' };
    }),
  };
}

export function StationEditor({ id }: { id: string | null }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const r = useApi<{ station: any }>(id ? `/api/partner/stations/${id}` : null);
  const s = r.data?.station;
  const d = useDraft<Details>(id ? `station-${id}` : 'station-new', EMPTY);
  const f = d.value;
  useEffect(() => {
    if (s && !d.hasDraft) d.setValue(fromStation(s));
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [places, setPlaces] = useState<any[]>([]);

  if (id && r.error?.status === 403)
    return (
      <div data-testid="station-access-denied">
        <Empty icon="lock" title="You cannot manage this station">
          <p>
            {r.error.message} <span className="mono small">({r.error.status} {r.error.code})</span>
          </p>
          <p>Partners can only view and edit their own stations, bookings and revenue. The attempt was recorded in the audit log.</p>
          <Link to="/partner/stations">Back to my stations</Link>
        </Empty>
      </div>
    );
  if (id && r.error) return <ErrorNote error={r.error} onRetry={r.reload} />;
  if (id && !s) return <Loading />;

  const toPayload = (x: Details): Record<string, unknown> => ({
    name: x.name,
    description: x.description,
    address: x.address,
    area: x.area,
    city: x.city,
    latitude: Number(x.latitude),
    longitude: Number(x.longitude),
    accessType: x.accessType,
    discloseExactLocation: x.accessType === 'PUBLIC' ? true : x.discloseExactLocation,
    accessNotes: x.accessNotes,
    amenities: x.amenities,
    slotMinutes: Number(x.slotMinutes),
    hours: x.hours.filter((h) => h.open).map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })),
  });
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!id) {
        const res = await post('/api/partner/stations', toPayload(f));
        d.clear();
        toast('Station draft created. Add connectors and pricing next.', 'good');
        navigate(`/partner/stations/${res.id}`, { replace: true });
      } else {
        // send only fields that changed, so unrelated edits do not send a published listing back to review
        const p = toPayload(f);
        const cur = toPayload(fromStation(s));
        for (const key of Object.keys(p)) if (JSON.stringify(p[key]) === JSON.stringify(cur[key])) delete p[key];
        const res = await patch(`/api/partner/stations/${id}`, p);
        d.clear();
        toast(res.reReview ? 'Saved. Material changes were sent back to admin review.' : 'Station saved.', 'good');
        r.reload();
      }
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const setHour = (i: number, p: Partial<Hours[number]>) => d.update({ hours: f.hours.map((h, j) => (j === i ? { ...h, ...p } : h)) });

  return (
    <div className="station-editor">
      <Link to="/partner/stations" className="back-link">
        <Icon name="arrow-left" /> My stations
      </Link>
      <PageHead kicker="Station Partner" title={id ? s.name : 'Register a station'}>
        {id ? (
          <span className="chips">
            <Pill status={s.listingStatus}>{LISTING[s.listingStatus]}</Pill>
            {s.reviewNote && <span className="field-error">Reviewer note: {s.reviewNote}</span>}
          </span>
        ) : (
          'Step 1: station details, location, access and hours. Step 2: connectors and pricing. Step 3: submit for approval.'
        )}
      </PageHead>
      {id && <ListingBar s={s} reload={r.reload} />}

      <Card>
        <h2 className="h3">Station details</h2>
        <div className="form-grid">
          <Field label="Station name">{(fid) => <Input id={fid} value={f.name} onChange={(e) => d.update({ name: e.target.value })} data-testid="st-name" />}</Field>
          <Field label="Area / locality">{(fid) => <Input id={fid} value={f.area} onChange={(e) => d.update({ area: e.target.value })} data-testid="st-area" />}</Field>
          <Field label="City">{(fid) => <Input id={fid} value={f.city} onChange={(e) => d.update({ city: e.target.value })} data-testid="st-city" />}</Field>
          <Field label="Street address">{(fid) => <Input id={fid} value={f.address} onChange={(e) => d.update({ address: e.target.value })} data-testid="st-address" />}</Field>
        </div>
        <Field label="Description" optional>
          {(fid) => <Textarea id={fid} rows={2} value={f.description} onChange={(e) => d.update({ description: e.target.value })} />}
        </Field>
        <h3 className="h3">Location</h3>
        <div className="form-grid">
          <Field label="Find a place" hint="Demo geocoder: a small list of Andhra Pradesh places. Then click the map to set the exact point.">
            {(fid) => (
              <div className="place-field">
                <Input
                  id={fid}
                  onChange={async (e) => {
                    if (e.target.value.length < 2) return setPlaces([]);
                    setPlaces((await get(`/api/geo/search?q=${encodeURIComponent(e.target.value)}`).catch(() => ({ places: [] }))).places);
                  }}
                />
                {places.length > 0 && (
                  <ul className="suggest glass">
                    {places.map((p) => (
                      <li key={p.label}>
                        <button type="button" onClick={() => (d.update({ latitude: String(p.latitude), longitude: String(p.longitude), city: f.city || p.label.split(', ').pop() }), setPlaces([]))}>
                          {p.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <Field label="Latitude">{(fid) => <Input id={fid} inputMode="decimal" value={f.latitude} onChange={(e) => d.update({ latitude: e.target.value })} data-testid="st-lat" />}</Field>
          <Field label="Longitude">{(fid) => <Input id={fid} inputMode="decimal" value={f.longitude} onChange={(e) => d.update({ longitude: e.target.value })} data-testid="st-lng" />}</Field>
        </div>
        <MapView points={[]} pick={f.latitude && f.longitude ? { lat: Number(f.latitude), lng: Number(f.longitude) } : null} onPick={(lat, lng) => d.update({ latitude: String(lat), longitude: String(lng) })} height={300} label="Station location picker" />

        <h3 className="h3">Access</h3>
        <div className="seg" role="group" aria-label="Access type">
          {[
            ['PUBLIC', 'Public station'],
            ['PRIVATE', 'Private (members/guests)'],
            ['HOME', 'Home charger'],
          ].map(([v, l]) => (
            <button key={v} type="button" className={`seg-btn ${f.accessType === v ? 'is-active' : ''}`} aria-pressed={f.accessType === v} onClick={() => d.update({ accessType: v })}>
              {l}
            </button>
          ))}
        </div>
        {f.accessType !== 'PUBLIC' && (
          <label className="check">
            <input type="checkbox" checked={f.discloseExactLocation} onChange={(e) => d.update({ discloseExactLocation: e.target.checked })} />
            <span>Show my exact location and name publicly. Leave unticked to show only an approximate area and "Private host"; drivers see the address after a confirmed booking. Your phone and email are never shown.</span>
          </label>
        )}
        <Field label="Access instructions" optional hint={f.accessType === 'PUBLIC' ? 'Shown on the listing.' : 'Shared only with drivers who have a confirmed booking.'}>
          {(fid) => <Textarea id={fid} rows={2} value={f.accessNotes} onChange={(e) => d.update({ accessNotes: e.target.value })} />}
        </Field>
        <fieldset className="field">
          <legend>Amenities</legend>
          <div className="chip-row">
            {Object.entries(AMENITY_LABELS).map(([a, l]) => (
              <button key={a} type="button" className={`chip-btn ${f.amenities.includes(a) ? 'is-on' : ''}`} aria-pressed={f.amenities.includes(a)} onClick={() => d.update({ amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a] })}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>

        <h3 className="h3">Opening hours & booking slots</h3>
        <Field label="Booking slot length">
          {(fid) => (
            <Select id={fid} value={f.slotMinutes} onChange={(e) => d.update({ slotMinutes: e.target.value })}>
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="hours-editor">
          {f.hours.map((h, i) => (
            <div key={i} className="hours-row">
              <label className="check">
                <input type="checkbox" checked={h.open} onChange={(e) => setHour(i, { open: e.target.checked })} /> <span>{WEEKDAYS[i]}</span>
              </label>
              <input type="time" className="input" value={h.opensAt} disabled={!h.open} onChange={(e) => setHour(i, { opensAt: e.target.value })} aria-label={`${WEEKDAYS[i]} opens`} />
              <span>–</span>
              <input type="text" className="input" value={h.closesAt} disabled={!h.open} onChange={(e) => setHour(i, { closesAt: e.target.value })} aria-label={`${WEEKDAYS[i]} closes (HH:MM, 24:00 for midnight)`} pattern="\d{2}:\d{2}" />
            </div>
          ))}
          <div className="row-actions">
            <button type="button" className="link-btn" onClick={() => d.update({ hours: f.hours.map((h) => ({ ...h, open: true, opensAt: f.hours[1].opensAt, closesAt: f.hours[1].closesAt })) })}>
              Copy Monday to all days
            </button>
            <button type="button" className="link-btn" onClick={() => d.update({ hours: f.hours.map((h) => ({ ...h, open: true, opensAt: '00:00', closesAt: '24:00' })) })}>
              Open 24 hours
            </button>
          </div>
        </div>
        {d.dirty && <p className="small muted">Unsaved changes are kept as a draft on this device, even if you switch mode.</p>}
        <ErrorNote error={err} />
        <Btn icon="check" busy={busy} onClick={save} data-testid="save-station">
          {id ? 'Save changes' : 'Create station draft'}
        </Btn>
      </Card>

      {id && (
        <>
          <Connectors s={s} reload={r.reload} />
          <Photos s={s} reload={r.reload} />
          <Blocks s={s} reload={r.reload} />
          {s.pricingHistory.length > 0 && (
            <Card>
              <h2 className="h3">Price history</h2>
              <ul className="plain-list small">
                {s.pricingHistory.map((p: any, i: number) => (
                  <li key={i}>
                    {dateTime(p.effectiveFrom)} · {s.connectors.find((c: any) => c.id === p.connectorId)?.label || 'connector'} · {rupees(p.pricePerKwhPaise)}/kWh
                  </li>
                ))}
              </ul>
              <p className="muted small">Existing bookings keep the price they were quoted.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ListingBar({ s, reload }: { s: any; reload: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<ApiError | null>(null);
  const submit = () =>
    post(`/api/partner/stations/${s.id}/submit`)
      .then(() => (toast('Submitted for admin approval.', 'good'), reload()))
      .catch(setErr);
  const setOp = (v: string) =>
    patch(`/api/partner/stations/${s.id}`, { operationalStatus: v })
      .then(() => (toast('Status updated', 'good'), reload()))
      .catch(setErr);
  return (
    <Card className="listing-bar">
      <div>
        <span className="label">Listing</span>
        <ol className="lifecycle compact">
          {['DRAFT', 'SUBMITTED', 'APPROVED'].map((x, i) => (
            <li key={x} className={['DRAFT', 'SUBMITTED', 'APPROVED'].indexOf(s.listingStatus) >= i ? 'is-done' : ''}>
              <span className="dot" />
              {LISTING[x]}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <span className="label">Operating status</span>
        <div className="seg">
          {[
            ['AVAILABLE', 'Available'],
            ['UNAVAILABLE', 'Unavailable'],
            ['TEMPORARILY_CLOSED', 'Temporarily closed'],
          ].map(([v, l]) => (
            <button key={v} type="button" className={`seg-btn ${s.operationalStatus === v ? 'is-active' : ''}`} aria-pressed={s.operationalStatus === v} onClick={() => setOp(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {['DRAFT', 'REJECTED'].includes(s.listingStatus) && (
        <Btn icon="send" onClick={submit} data-testid="submit-station">
          Submit for approval
        </Btn>
      )}
      <ErrorNote error={err} />
    </Card>
  );
}

function Connectors({ s, reload }: { s: any; reload: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ label: '', standard: 'CCS2', currentType: 'DC', maxPowerKw: '60', pricePerKwh: '18' });
  const [err, setErr] = useState<ApiError | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const DC = ['CCS2', 'CHADEMO', 'BHARAT_DC001', 'TYPE6_LEVDC'];
  const add = async () => {
    setErr(null);
    try {
      await post(`/api/partner/stations/${s.id}/connectors`, { ...f, maxPowerKw: Number(f.maxPowerKw), pricePerKwh: Number(f.pricePerKwh) });
      toast('Connector added', 'good');
      setF({ ...f, label: '' });
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const update = (cid: string, body: object) =>
    patch(`/api/partner/connectors/${cid}`, body)
      .then(() => (toast('Connector updated', 'good'), reload()))
      .catch(setErr);
  return (
    <Card>
      <h2 className="h3">Connectors & pricing</h2>
      {!s.connectors.length && <p className="muted">Add at least one connector before submitting.</p>}
      <div className="table-wrap">
        {!!s.connectors.length && (
          <table className="table" data-testid="connector-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Power</th>
                <th>₹/kWh</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.connectors.map((c: any) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    {connectorLabel(c.standard)} · {c.currentType}
                  </td>
                  <td>{c.maxPowerKw} kW</td>
                  <td>
                    <span className="inline-edit">
                      <input className="input" type="number" min={1} step={0.5} aria-label={`Price per kWh for ${c.label}`} value={edit[c.id] ?? String(c.pricePerKwhPaise / 100)} onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })} />
                      {edit[c.id] !== undefined && Number(edit[c.id]) * 100 !== c.pricePerKwhPaise && (
                        <button type="button" className="link-btn" onClick={() => update(c.id, { pricePerKwh: Number(edit[c.id]) }).then(() => setEdit({ ...edit, [c.id]: undefined as never }))}>
                          Save
                        </button>
                      )}
                    </span>
                  </td>
                  <td>
                    <button type="button" className={`pill pill-${c.status === 'AVAILABLE' ? 'good' : 'bad'} pill-btn`} onClick={() => update(c.id, { status: c.status === 'AVAILABLE' ? 'OUT_OF_SERVICE' : 'AVAILABLE' })}>
                      {c.status === 'AVAILABLE' ? 'In service' : 'Out of service'}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="icon-btn" aria-label={`Delete ${c.label}`} onClick={() => del(`/api/partner/connectors/${c.id}`).then(reload).catch(setErr)}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="form-grid connector-form">
        <Field label="Label">{(id) => <Input id={id} value={f.label} placeholder="e.g. DC-1" onChange={(e) => setF({ ...f, label: e.target.value })} data-testid="conn-label" />}</Field>
        <Field label="Connector type">
          {(id) => (
            <Select id={id} value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value, currentType: DC.includes(e.target.value) ? 'DC' : e.target.value === 'TYPE7_LECCS' ? f.currentType : 'AC' })} data-testid="conn-standard">
              {Object.entries(CONNECTOR_LABELS).map(([k2, l]) => (
                <option key={k2} value={k2}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="AC / DC">
          {(id) => (
            <Select id={id} value={f.currentType} onChange={(e) => setF({ ...f, currentType: e.target.value })}>
              <option value="AC">AC</option>
              <option value="DC">DC</option>
            </Select>
          )}
        </Field>
        <Field label="Max power (kW)">{(id) => <Input id={id} type="number" min={0.5} step={0.1} value={f.maxPowerKw} onChange={(e) => setF({ ...f, maxPowerKw: e.target.value })} data-testid="conn-kw" />}</Field>
        <Field label="Price per kWh (₹)">{(id) => <Input id={id} type="number" min={1} step={0.5} value={f.pricePerKwh} onChange={(e) => setF({ ...f, pricePerKwh: e.target.value })} data-testid="conn-price" />}</Field>
      </div>
      <ErrorNote error={err} />
      <Btn icon="plus" variant="glass" onClick={add} disabled={!f.label} data-testid="add-connector">
        Add connector
      </Btn>
      <p className="muted small">Compatible vehicles are matched automatically from the connector type and drivers' saved vehicles.</p>
    </Card>
  );
}

function Photos({ s, reload }: { s: any; reload: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = (file: File) => {
    setErr(null);
    if (file.size > 2 * 1024 * 1024) return setErr('Photos must be 2 MB or smaller.');
    const fr = new FileReader();
    fr.onload = async () => {
      setBusy(true);
      try {
        await post(`/api/partner/stations/${s.id}/photos`, { dataUrl: fr.result });
        reload();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    fr.readAsDataURL(file);
  };
  return (
    <Card>
      <h2 className="h3">Photos</h2>
      <div className="photo-grid">
        {s.photoPaths.map((p: string) => (
          <figure key={p}>
            <img src={p} alt="Station" />
            <button type="button" className="icon-btn" aria-label="Remove photo" onClick={() => del(`/api/partner/stations/${s.id}/photos`, { url: p }).then(reload)}>
              <Icon name="trash" />
            </button>
          </figure>
        ))}
        {s.photoPaths.length < 6 && (
          <label className="photo-add">
            <Icon name={busy ? 'loader-circle' : 'image-plus'} className={`icon ${busy ? 'spin' : ''}`} />
            <span>Add photo</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-testid="photo-input" />
          </label>
        )}
      </div>
      {err && <p className="field-error">{err}</p>}
      <p className="muted small">PNG, JPEG or WebP up to 2 MB, stored on this server for the demo. Production needs private object storage and moderation.</p>
    </Card>
  );
}

function Blocks({ s, reload }: { s: any; reload: () => void }) {
  const [f, setF] = useState({ startsAt: '', endsAt: '', reason: '' });
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <Card>
      <h2 className="h3">Unavailable times</h2>
      <p className="muted small">Block maintenance or private-use windows. Drivers cannot book over them.</p>
      <ul className="plain-list small">
        {s.blocks.map((b: any) => (
          <li key={b.id}>
            {dateTime(b.startsAt)} – {dateTime(b.endsAt)} {b.reason ? `· ${b.reason}` : ''}
          </li>
        ))}
      </ul>
      <div className="form-grid">
        <Field label="From">{(id) => <Input id={id} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
        <Field label="Reason" optional>
          {(id) => <Input id={id} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}
        </Field>
      </div>
      <ErrorNote error={err} />
      <Btn
        variant="glass"
        icon="ban"
        disabled={!f.startsAt || !f.endsAt}
        onClick={() =>
          post(`/api/partner/stations/${s.id}/blocks`, { startsAt: new Date(f.startsAt + ':00+05:30').toISOString(), endsAt: new Date(f.endsAt + ':00+05:30').toISOString(), reason: f.reason || undefined })
            .then(() => (setF({ startsAt: '', endsAt: '', reason: '' }), reload()))
            .catch(setErr)
        }
      >
        Block time
      </Btn>
    </Card>
  );
}
