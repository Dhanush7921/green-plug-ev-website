import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, del, idempotencyKey, post, put } from '../../lib/api';
import { addDays, AMENITY_LABELS, COMPAT_LABELS, CONFIDENCE_LABELS, connectorLabel, day, isoDateIST, rupees, WEEKDAYS } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { Checkout } from '../../components/Checkout';
import { Icon } from '../../components/Icon';
import { Btn, Card, DemoTag, Empty, ErrorNote, Field, Input, Loading, Pill, Select } from '../../components/ui';
import { MapView } from '../../map/MapView';
import { accessLabel } from './Discover';

export function StationDetail({ id }: { id: string }) {
  const { user } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const vehicles = useApi<{ vehicles: any[] }>(user ? '/api/me/vehicles' : null);
  const [vehicleId, setVehicleId] = useState('');
  const st = useApi<{ station: any; vehicle: any }>(`/api/stations/${id}${vehicleId ? `?vehicleId=${vehicleId}` : ''}`);
  const s = st.data?.station;

  const [date, setDate] = useState(isoDateIST());
  const [duration, setDuration] = useState(0);
  const [connectorId, setConnectorId] = useState('');
  const [slot, setSlot] = useState<string | null>(null);
  const [kwh, setKwh] = useState('');
  useEffect(() => {
    if (!s) return;
    if (!duration) setDuration(Math.max(s.slotMinutes, 60 - (60 % s.slotMinutes || 0)));
    if (!connectorId) {
      const c = (s.connectors as any[]).find((x) => x.status === 'AVAILABLE' && x.compatibility.state !== 'INCOMPATIBLE') || s.connectors[0];
      if (c) setConnectorId(c.id);
    }
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (st.data?.vehicle && !vehicleId) setVehicleId(st.data.vehicle.id);
  }, [st.data?.vehicle]); // eslint-disable-line react-hooks/exhaustive-deps

  const avail = useApi<any>(s && duration ? `/api/stations/${id}/availability?date=${date}&durationMinutes=${duration}` : null);
  const conn = s?.connectors.find((c: any) => c.id === connectorId);
  const connSlots = (avail.data?.connectors.find((c: any) => c.connectorId === connectorId)?.slots || []).filter((x: any) => x.reason !== 'Past');
  useEffect(() => setSlot(null), [date, duration, connectorId]);
  useEffect(() => {
    if (conn && !kwh) setKwh(String(Math.min(30, Math.max(5, Math.round((conn.compatibility.effectiveKwCeiling || conn.maxPowerKw) * 0.6 * (duration / 60))))));
  }, [conn, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const [est, setEst] = useState<any>(null);
  const [estErr, setEstErr] = useState<ApiError | null>(null);
  useEffect(() => {
    if (!connectorId || !Number(kwh)) return setEst(null);
    const t = setTimeout(() => {
      post(`/api/stations/${id}/estimate`, { connectorId, plannedKwh: Number(kwh), durationMinutes: duration, vehicleId: vehicleId || undefined })
        .then((r) => (setEst(r), setEstErr(null)))
        .catch((e) => (setEst(null), setEstErr(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [id, connectorId, kwh, duration, vehicleId]);

  // One idempotency key per booking attempt: double clicks or retries can never create two bookings.
  const attempt = useRef<{ key: string; sig: string } | null>(null);
  const [booking, setBooking] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const book = async () => {
    if (!user) return navigate(`/signin?next=/stations/${id}`);
    if (!user.emailVerified) return navigate('/verify');
    if (!slot) return;
    const body = { stationId: id, connectorId, startsAt: slot, durationMinutes: duration, plannedKwh: Number(kwh), vehicleId: vehicleId || undefined, paymentMethod: (user.preferences.preferredPaymentMethod as string) || undefined };
    const sig = JSON.stringify(body);
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { key: idempotencyKey(), sig };
    setBusy(true);
    setErr(null);
    try {
      const r = await post('/api/bookings', body, { 'Idempotency-Key': attempt.current.key });
      setBooking(r);
    } catch (e) {
      setErr(e as ApiError);
      if ((e as ApiError).code === 'SLOT_UNAVAILABLE') (avail.reload(), (attempt.current = null));
    } finally {
      setBusy(false);
    }
  };

  const durations = useMemo(() => (s ? Array.from({ length: Math.floor(240 / s.slotMinutes) }, (_, i) => (i + 1) * s.slotMinutes).filter((m) => m >= 15) : []), [s]);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(isoDateIST(), i));

  if (st.loading && !s) return <Loading label="Loading station…" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  if (!s) return null;
  const toggleSave = async () => {
    if (!user) return navigate(`/signin?next=/stations/${id}`);
    await (s.saved ? del(`/api/me/saved-stations/${id}`) : put(`/api/me/saved-stations/${id}`));
    st.reload();
    toast(s.saved ? 'Removed from favourites' : 'Saved to favourites', 'good');
  };

  return (
    <div className="station-detail">
      <Link to="/" className="back-link">
        <Icon name="arrow-left" /> All stations
      </Link>
      <header className="sd-head">
        <div>
          <span className="kicker">
            {accessLabel(s.accessType)} · {s.area}, {s.city}
          </span>
          <h1 className="h2" data-testid="station-title">
            {s.name}
          </h1>
          <div className="chips">
            <Pill status={s.operationalStatus}>{s.operationalStatus === 'AVAILABLE' ? (s.openNow ? 'Open now' : 'Closed now') : s.operationalStatus === 'TEMPORARILY_CLOSED' ? 'Temporarily closed' : 'Unavailable'}</Pill>
            {s.isDemo && <DemoTag>Simulated demo station</DemoTag>}
            <span className="pill pill-neutral">{CONFIDENCE_LABELS[s.availabilityConfidence]}</span>
          </div>
        </div>
        <div className="sd-head-actions">
          <Btn variant="glass" icon="heart" onClick={toggleSave} aria-pressed={s.saved} className={s.saved ? 'is-fav' : ''}>
            {s.saved ? 'Saved' : 'Save'}
          </Btn>
          {s.directionsUrl ? (
            <a className="btn btn-glass" href={s.directionsUrl} target="_blank" rel="noopener noreferrer" data-gloss>
              <span className="btn-inner">
                <Icon name="navigation" /> Directions
              </span>
            </a>
          ) : (
            <span className="muted small">Directions are shared after a confirmed booking.</span>
          )}
        </div>
      </header>

      <div className="sd-grid">
        <div className="sd-main">
          {s.photos?.length > 0 && (
            <div className="sd-photos">
              {s.photos.map((p: string) => (
                <img key={p} src={p} alt={`${s.name} photo`} loading="lazy" />
              ))}
            </div>
          )}
          <Card>
            <h2 className="h3">About this station</h2>
            {s.description && <p>{s.description}</p>}
            <dl className="facts">
              <div>
                <dt>Operator</dt>
                <dd>{s.operator}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{s.address}</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>{s.accessNotes || accessLabel(s.accessType)}</dd>
              </div>
              <div>
                <dt>Booking slots</dt>
                <dd>{s.slotMinutes}-minute grid</dd>
              </div>
            </dl>
            {!s.exactLocation && (
              <p className="notice small">
                <Icon name="lock" /> Private listing: the map shows an approximate area. The exact address, access instructions and directions are shared only with drivers who hold a confirmed booking. Host contact details are never public.
              </p>
            )}
            <div className="amenities">
              {s.amenities.map((a: string) => (
                <span key={a} className="pill pill-neutral">
                  {AMENITY_LABELS[a] || a}
                </span>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="h3">Connectors & pricing</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Connector</th>
                    <th>Type</th>
                    <th>Power</th>
                    <th>Price</th>
                    <th>{st.data?.vehicle ? `For ${st.data.vehicle.nickname}` : 'Compatibility'}</th>
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
                      <td>{rupees(c.pricePerKwhPaise)}/kWh</td>
                      <td>
                        <Pill tone={c.compatibility.state === 'COMPATIBLE_VERIFIED' ? 'good' : c.compatibility.state === 'NEEDS_CONFIRMATION' ? 'warn' : 'bad'}>{COMPAT_LABELS[c.compatibility.state]}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <h2 className="h3">Opening hours</h2>
            <ul className="hours">
              {WEEKDAYS.map((w, i) => {
                const h = s.hours.find((x: any) => x.weekday === i);
                return (
                  <li key={w}>
                    <span>{w}</span>
                    <span>{h ? (h.opensAt === '00:00' && h.closesAt === '00:00' ? 'Open 24 hours' : `${h.opensAt} – ${h.closesAt === '00:00' ? '24:00' : h.closesAt}`) : 'Closed'}</span>
                  </li>
                );
              })}
            </ul>
            <p className="muted small">Times are in IST.</p>
          </Card>
          <MapView points={[{ id: s.id, lat: s.location.latitude, lng: s.location.longitude, title: s.name, tone: s.operationalStatus === 'AVAILABLE' ? 'good' : 'bad', approximate: !s.exactLocation }]} height={280} label={`Location of ${s.name}`} />
        </div>

        <aside className="sd-book card glass" aria-label="Book a charging slot" data-testid="booking-panel">
          <h2 className="h3">Book a slot</h2>
          {user && (
            <Field label="Vehicle" hint={vehicles.data && !vehicles.data.vehicles.length ? <Link to="/garage">Add your vehicle</Link> : 'Used to check connector compatibility.'}>
              {(fid) => (
                <Select id={fid} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">No vehicle selected</option>
                  {vehicles.data?.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nickname}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Connector">
            {(fid) => (
              <Select id={fid} value={connectorId} onChange={(e) => setConnectorId(e.target.value)} data-testid="connector-select">
                {s.connectors.map((c: any) => (
                  <option key={c.id} value={c.id} disabled={c.status !== 'AVAILABLE'}>
                    {c.label} — {connectorLabel(c.standard)} {c.currentType} {c.maxPowerKw} kW · {rupees(c.pricePerKwhPaise)}/kWh{c.compatibility.state === 'INCOMPATIBLE' ? ' (not compatible)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {conn?.compatibility.reasons.length > 0 && <p className={`small ${conn.compatibility.state === 'INCOMPATIBLE' ? 'field-error' : 'muted'}`}>{conn.compatibility.reasons.join(' ')}</p>}
          <div className="field">
            <span className="label">Date</span>
            <div className="date-chips" role="group" aria-label="Date">
              {dates.map((d) => (
                <button key={d} type="button" className={`chip-btn ${d === date ? 'is-on' : ''}`} aria-pressed={d === date} onClick={() => setDate(d)} data-date={d}>
                  {day(`${d}T12:00:00+05:30`)}
                </button>
              ))}
            </div>
          </div>
          <Field label="Charging duration">
            {(fid) => (
              <Select id={fid} value={duration} onChange={(e) => setDuration(Number(e.target.value))} data-testid="duration-select">
                {durations.map((m) => (
                  <option key={m} value={m}>
                    {m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="field">
            <span className="label">Start time {avail.data?.open ? <span className="muted small">(open {avail.data.open.opensAt}–{avail.data.open.closesAt === '00:00' ? '24:00' : avail.data.open.closesAt})</span> : null}</span>
            {avail.loading && <Loading label="Checking slots…" />}
            <ErrorNote error={avail.error} />
            {avail.data && !connSlots.length && <p className="muted small">No bookable hours on this date.</p>}
            <div className="slot-grid" data-testid="slot-grid" data-date={avail.loading ? '' : avail.data?.date} data-duration={avail.data?.durationMinutes}>
              {connSlots.map((x: any) => (
                <button key={x.startsAt} type="button" className={`slot ${slot === x.startsAt ? 'is-on' : ''}`} disabled={!x.available} title={x.reason || 'Available'} aria-pressed={slot === x.startsAt} onClick={() => setSlot(x.startsAt)} data-slot={x.time} data-reason={x.reason || ''}>
                  {x.time}
                  {x.reason === 'Booked' && <small>Booked</small>}
                </button>
              ))}
            </div>
            {avail.data && <p className="muted small">{avail.data.note}</p>}
          </div>
          <Field label="Energy to add (kWh)" hint="You pay for this energy upfront; any unused energy is refunded after the session.">
            {(fid) => <Input id={fid} type="number" min={0.5} max={200} step={0.5} value={kwh} onChange={(e) => setKwh(e.target.value)} data-testid="kwh-input" />}
          </Field>
          <ErrorNote error={estErr} />
          {est && (
            <div className="estimate" data-testid="estimate">
              <div className="est-row">
                <span>
                  Charging ({est.quote.plannedKwh} kWh × {rupees(est.quote.ratePaise)})
                </span>
                <strong data-testid="est-base">{rupees(est.quote.basePaise)}</strong>
              </div>
              <div className="est-row">
                <span>Service fee ({est.quote.feeBps / 100}%)</span>
                <strong data-testid="est-fee">{rupees(est.quote.customerFeePaise)}</strong>
              </div>
              <div className="est-row est-total">
                <span>Total before taxes</span>
                <strong data-testid="est-total">{rupees(est.quote.customerTotalPaise)}</strong>
              </div>
              <p className="muted small">
                Transparency: the station receives {rupees(est.quote.partnerAmountPaise)} after a {est.quote.commissionBps / 100}% platform commission on the charging amount. Taxes and payment-processing fees are not included.
              </p>
              {est.time.minMinutes ? (
                <p className="small">
                  <Icon name="timer" /> About {est.time.minMinutes}–{est.time.maxMinutes} min to add {est.quote.plannedKwh} kWh. <span className="muted">{est.time.disclaimer}</span>
                </p>
              ) : (
                <p className="small muted">{est.time.disclaimer}</p>
              )}
              {est.warnings.map((w: string) => (
                <p key={w} className="small field-error">
                  <Icon name="triangle-alert" /> {w}
                </p>
              ))}
            </div>
          )}
          <ErrorNote error={err} />
          <Btn icon="calendar-clock" busy={busy} disabled={!slot || !est || s.operationalStatus !== 'AVAILABLE'} onClick={book} className="btn-block" data-testid="book-button">
            {!user ? 'Sign in to book' : slot ? `Reserve ${connSlots.find((x: any) => x.startsAt === slot)?.time} · ${est ? rupees(est.quote.customerTotalPaise) : ''}` : 'Choose a start time'}
          </Btn>
          <p className="muted small">The slot is held for a few minutes while you pay. Free cancellation until 30 minutes before the start.</p>
        </aside>
      </div>

      <Checkout
        open={!!booking}
        order={booking?.paymentOrder}
        amountPaise={booking?.booking.pricing.customerTotalPaise || 0}
        onClose={() => booking && navigate(`/bookings/${booking.booking.id}`)}
        onResult={(r) => {
          toast(r.bookingStatus === 'CONFIRMED' ? 'Payment verified by webhook — booking confirmed.' : r.bookingStatus === 'PAYMENT_FAILED' ? 'Payment failed. The slot was released.' : `Booking is ${r.bookingStatus}.`, r.bookingStatus === 'CONFIRMED' ? 'good' : 'bad');
          navigate(`/bookings/${r.bookingId}`);
        }}
      />
      {!s.connectors.length && <Empty title="No connectors listed" />}
    </div>
  );
}
