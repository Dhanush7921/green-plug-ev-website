import { useEffect, useMemo, useState } from 'react';
import { del, get, put } from '../../lib/api';
import { CONFIDENCE_LABELS, COMPAT_LABELS, connectorLabel, rupees } from '../../lib/format';
import { useApi, useDraft } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { Icon } from '../../components/Icon';
import { DemoTag, Empty, ErrorNote, Input, Loading, PageHead, Pill, Select } from '../../components/ui';
import { MapView, type MapPoint } from '../../map/MapView';

const CONNECTOR_FILTERS = ['CCS2', 'TYPE2', 'CHADEMO', 'BHARAT_DC001', 'BHARAT_AC001', 'TYPE7_LECCS', 'TYPE6_LEVDC', 'SOCKET_15A'];
type Filters = { q: string; connectors: string[]; current: '' | 'AC' | 'DC'; minKw: string; maxPrice: string; access: string[]; openNow: boolean; availableOnly: boolean; compatibleOnly: boolean; vehicleId: string; lat: string; lng: string; place: string };
const INITIAL: Filters = { q: '', connectors: [], current: '', minKw: '', maxPrice: '', access: [], openNow: false, availableOnly: false, compatibleOnly: false, vehicleId: '', lat: '', lng: '', place: '' };

export const accessLabel = (a: string) => (a === 'PUBLIC' ? 'Public' : a === 'PRIVATE' ? 'Private' : 'Home charger');
export const stationTone = (s: { operationalStatus: string; freeNow: boolean; openNow: boolean }) => (s.operationalStatus !== 'AVAILABLE' ? 'bad' : s.freeNow ? 'good' : 'warn');

export function StationCard({ s, onToggleSave, selected, onHover }: { s: any; onToggleSave?: (s: any) => void; selected?: boolean; onHover?: () => void }) {
  const tone = stationTone(s);
  return (
    <article className={`station-card card ${selected ? 'is-selected' : ''}`} data-gloss onMouseEnter={onHover} data-testid="station-card" data-station={s.id}>
      <Link to={`/stations/${s.id}`} className="station-card-link" aria-label={`${s.name}, ${s.area}`}>
        <div className="station-card-top">
          <div>
            <h3 className="h3 station-name">{s.name}</h3>
            <p className="muted small">
              {s.area}, {s.city}
              {s.distanceKm !== null && s.distanceKm !== undefined && <> · {s.distanceKm} km</>}
            </p>
          </div>
          <div className="station-price">
            <span className="muted small">from</span>
            <strong>
              {rupees(s.minPricePaise)}
              <small>/kWh</small>
            </strong>
          </div>
        </div>
        <div className="chips">
          <span className={`pill pill-${tone}`}>{s.operationalStatus !== 'AVAILABLE' ? (s.operationalStatus === 'TEMPORARILY_CLOSED' ? 'Temporarily closed' : 'Unavailable') : s.freeNow ? 'Bookable now' : s.openNow ? 'Busy now' : 'Closed now'}</span>
          <span className="pill pill-neutral">
            <Icon name={s.accessType === 'HOME' ? 'house' : s.accessType === 'PRIVATE' ? 'lock' : 'store'} /> {accessLabel(s.accessType)}
          </span>
          {s.maxPowerKw && (
            <span className="pill pill-neutral">
              <Icon name="zap" /> up to {s.maxPowerKw} kW
            </span>
          )}
          {s.compatibility && <Pill tone={s.compatibility === 'COMPATIBLE_VERIFIED' ? 'good' : s.compatibility === 'NEEDS_CONFIRMATION' ? 'warn' : 'bad'}>{COMPAT_LABELS[s.compatibility]}</Pill>}
        </div>
        <div className="connector-chips">
          {[...new Map((s.connectors as any[]).map((c) => [c.standard + c.currentType, c])).values()].map((c: any) => (
            <span key={c.id} className="conn-chip">
              {connectorLabel(c.standard)} <em>{c.currentType}</em>
            </span>
          ))}
        </div>
        <p className="confidence small">
          {s.isDemo && <DemoTag>Simulated</DemoTag>} {CONFIDENCE_LABELS[s.availabilityConfidence]}
          {!s.exactLocation && <> · approximate location</>}
        </p>
      </Link>
      {onToggleSave && (
        <button type="button" className={`fav-btn ${s.saved ? 'is-on' : ''}`} aria-pressed={s.saved} aria-label={s.saved ? `Remove ${s.name} from favourites` : `Save ${s.name} to favourites`} onClick={() => onToggleSave(s)}>
          <Icon name="heart" />
        </button>
      )}
    </article>
  );
}

export function Discover() {
  const { user } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const draft = useDraft<Filters>('discover-filters', INITIAL);
  const f = draft.value;
  const set = draft.update;
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [places, setPlaces] = useState<any[]>([]);
  const [locating, setLocating] = useState(false);
  const vehicles = useApi<{ vehicles: any[] }>(user ? '/api/me/vehicles' : null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (f.q.trim()) p.set('q', f.q.trim());
    if (f.connectors.length) p.set('connector', f.connectors.join(','));
    if (f.current) p.set('current', f.current);
    if (f.minKw) p.set('minKw', f.minKw);
    if (f.maxPrice) p.set('maxPricePaise', String(Math.round(Number(f.maxPrice) * 100)));
    if (f.access.length) p.set('access', f.access.join(','));
    if (f.openNow) p.set('openNow', '1');
    if (f.availableOnly) p.set('availableOnly', '1');
    if (f.compatibleOnly) p.set('compatibleOnly', '1');
    if (f.vehicleId) p.set('vehicleId', f.vehicleId);
    if (f.lat && f.lng) (p.set('lat', f.lat), p.set('lng', f.lng));
    return p.toString();
  }, [f]);
  const [debounced, setDebounced] = useState(qs);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(qs), 250);
    return () => clearTimeout(t);
  }, [qs]);
  const res = useApi<{ stations: any[]; count: number; vehicle: any }>(`/api/stations?${debounced}`, [user?.id]);
  const stations = res.data?.stations || [];

  const points: MapPoint[] = stations.map((s) => ({ id: s.id, lat: s.location.latitude, lng: s.location.longitude, label: rupees(s.minPricePaise), title: `${s.name}, ${rupees(s.minPricePaise)} per kWh, ${s.freeNow ? 'bookable now' : 'not bookable now'}`, tone: stationTone(s), approximate: !s.exactLocation }));
  const toggle = (k: 'connectors' | 'access', v: string) => set({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] } as Partial<Filters>);
  const activeCount = [f.connectors.length, f.current, f.minKw, f.maxPrice, f.access.length, f.openNow, f.availableOnly, f.compatibleOnly].filter(Boolean).length;

  const onToggleSave = async (s: any) => {
    if (!user) return navigate('/signin?next=/');
    try {
      if (s.saved) await del(`/api/me/saved-stations/${s.id}`);
      else await put(`/api/me/saved-stations/${s.id}`);
      res.setData((d) => d && { ...d, stations: d.stations.map((x) => (x.id === s.id ? { ...x, saved: !s.saved } : x)) });
      toast(s.saved ? 'Removed from favourites' : 'Saved to favourites', 'good');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const searchPlace = async (q: string) => {
    set({ place: q });
    if (q.trim().length < 2) return setPlaces([]);
    const r = await get(`/api/geo/search?q=${encodeURIComponent(q)}`).catch(() => ({ places: [] }));
    setPlaces(r.places);
  };
  const nearMe = () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.', 'bad');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        set({ lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5), place: 'My location' });
      },
      () => {
        setLocating(false);
        toast('Location permission was not granted. Search for a place instead.', 'info');
      },
      { timeout: 8000 },
    );
  };

  return (
    <div className="discover">
      <PageHead kicker="EV Driver" title={user ? `Hi ${user.fullName.split(' ')[0]}, where are you charging?` : 'Find EV charging'}>
        Search published stations by place, name or facility. Prices are per kWh; availability is never shown as live unless a verified source is connected.
      </PageHead>

      <div className="search-bar card glass">
        <label className="search-field">
          <Icon name="search" />
          <span className="sr-only">Search stations</span>
          <input className="input" placeholder="Station, area, city or facility (e.g. café)" value={f.q} onChange={(e) => set({ q: e.target.value })} data-testid="search-input" />
        </label>
        <div className="search-field place-field">
          <Icon name="navigation" />
          <input className="input" placeholder="Near a place…" value={f.place} onChange={(e) => searchPlace(e.target.value)} aria-label="Sort by distance from a place" />
          {places.length > 0 && (
            <ul className="suggest glass">
              {places.map((p) => (
                <li key={p.label}>
                  <button type="button" onClick={() => (set({ lat: String(p.latitude), lng: String(p.longitude), place: p.label }), setPlaces([]))}>
                    {p.label} <span className="muted small">{p.source === 'demo-gazetteer' ? 'demo geocoder' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="btn btn-glass btn-sm" onClick={nearMe} data-gloss>
          <span className="btn-inner">
            <Icon name={locating ? 'loader-circle' : 'locate-fixed'} className={`icon ${locating ? 'spin' : ''}`} /> Near me
          </span>
        </button>
        <button type="button" className={`btn btn-sm ${showFilters ? 'btn-primary' : 'btn-glass'}`} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)} data-testid="filters-toggle" data-gloss>
          <span className="btn-inner">
            <Icon name="sliders-horizontal" /> Filters{activeCount ? ` (${activeCount})` : ''}
          </span>
        </button>
      </div>

      {showFilters && (
        <div className="filters card" data-testid="filters">
          <fieldset>
            <legend>Connector</legend>
            <div className="chip-row">
              {CONNECTOR_FILTERS.map((c) => (
                <button key={c} type="button" className={`chip-btn ${f.connectors.includes(c) ? 'is-on' : ''}`} aria-pressed={f.connectors.includes(c)} onClick={() => toggle('connectors', c)}>
                  {connectorLabel(c)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Current</legend>
            <div className="seg">
              {(['', 'AC', 'DC'] as const).map((c) => (
                <button key={c || 'any'} type="button" className={`seg-btn ${f.current === c ? 'is-active' : ''}`} aria-pressed={f.current === c} onClick={() => set({ current: c })}>
                  {c || 'Any'}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Access</legend>
            <div className="chip-row">
              {['PUBLIC', 'PRIVATE', 'HOME'].map((a) => (
                <button key={a} type="button" className={`chip-btn ${f.access.includes(a) ? 'is-on' : ''}`} aria-pressed={f.access.includes(a)} onClick={() => toggle('access', a)}>
                  {accessLabel(a)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="filters-row">
            <label>
              <span>Min power</span>
              <Select value={f.minKw} onChange={(e) => set({ minKw: e.target.value })} aria-label="Minimum charging power">
                <option value="">Any</option>
                {[7, 15, 30, 50, 60, 120].map((k) => (
                  <option key={k} value={k}>
                    {k}+ kW
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span>Max ₹/kWh</span>
              <Input type="number" min={1} step={0.5} value={f.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} placeholder="Any" aria-label="Maximum price per kWh in rupees" />
            </label>
            {user && (
              <label>
                <span>My vehicle</span>
                <Select value={f.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })} aria-label="Vehicle for compatibility">
                  <option value="">Default vehicle</option>
                  {vehicles.data?.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nickname}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
          <div className="filters-row toggles">
            <label className="check">
              <input type="checkbox" checked={f.openNow} onChange={(e) => set({ openNow: e.target.checked })} /> <span>Open now</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={f.availableOnly} onChange={(e) => set({ availableOnly: e.target.checked })} /> <span>Bookable now</span>
            </label>
            {user && (
              <label className="check">
                <input type="checkbox" checked={f.compatibleOnly} onChange={(e) => set({ compatibleOnly: e.target.checked })} /> <span>Compatible with my vehicle</span>
              </label>
            )}
            <button type="button" className="link-btn" onClick={() => (draft.clear(), draft.setValue(INITIAL))}>
              Reset filters
            </button>
          </div>
        </div>
      )}

      <div className="discover-grid">
        <div className="discover-map">
          <MapView points={points} selectedId={selected} onSelect={(id) => setSelected(id)} height="100%" />
          {selected && (() => {
            const s = stations.find((x) => x.id === selected);
            return s ? (
              <div className="map-pop glass">
                <strong>{s.name}</strong>
                <span className="muted small">
                  {rupees(s.minPricePaise)}/kWh · {s.maxPowerKw} kW · {accessLabel(s.accessType)}
                </span>
                <Link to={`/stations/${s.id}`} className="btn btn-primary btn-sm" data-gloss>
                  <span className="btn-inner">View & book</span>
                </Link>
              </div>
            ) : null;
          })()}
        </div>
        <div className="discover-list" aria-live="polite">
          <div className="list-head">
            <strong data-testid="result-count">
              {res.loading && !res.data ? 'Searching…' : `${stations.length} station${stations.length === 1 ? '' : 's'}`}
            </strong>
            {f.place && f.lat && <span className="muted small">sorted by distance from {f.place}</span>}
            {res.data?.vehicle && <span className="muted small">compatibility for {res.data.vehicle.nickname}</span>}
          </div>
          <ErrorNote error={res.error} onRetry={res.reload} />
          {res.loading && !res.data && <Loading label="Finding stations…" />}
          {res.data && !stations.length && (
            <Empty icon="search" title="No stations match these filters">
              Try removing a filter or searching a different area.
            </Empty>
          )}
          {stations.map((s) => (
            <StationCard key={s.id} s={s} selected={selected === s.id} onHover={() => setSelected(s.id)} onToggleSave={onToggleSave} />
          ))}
        </div>
      </div>
    </div>
  );
}
