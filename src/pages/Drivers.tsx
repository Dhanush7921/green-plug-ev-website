import { useMemo, useRef, useState } from 'react';
import { ButtonLink } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { PageHero } from '../components/PageHero';
import { gsap, useGSAP } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { useMotion } from '../motion/kinetic';

type Kind = 'car' | 'bike';
type Conn = { id: string; name: string; tag: string; about: string; fits: string[]; power: string; note: string };

const CONNECTORS: Record<Kind, Conn[]> = {
  car: [
    { id: 'ccs2', name: 'CCS2', tag: 'DC fast + AC', about: 'Combined Charging System 2. The usual fast-charging inlet on new electric cars in India; its upper half also takes a Type 2 AC plug.', fits: ['Public DC fast chargers with a CCS2 cable', 'Type 2 AC wallboxes and public AC points', 'Portable charger on a suitable socket (if supplied with the car)'], power: 'DC: often 25 to 60 kW at public stations, limited by what your car accepts', note: 'Fast charging slows down noticeably above about 80% to protect the battery.' },
    { id: 'type2', name: 'Type 2', tag: 'AC', about: 'IEC 62196 Type 2. Used by home wallboxes and many public AC charge points.', fits: ['Home or workplace wallboxes', 'Public AC charge points (bring your cable if the point is untethered)', 'Hosts with a Type 2 charger'], power: 'Typically 3.3 to 22 kW, capped by your car’s onboard charger', note: 'An 11 kW AC point will still charge at 7.2 kW if that is your car’s limit.' },
    { id: 'bac', name: 'Bharat AC-001', tag: 'AC, older', about: 'An earlier Indian public AC standard with three 15 A outlets, used through the car’s own charging cable.', fits: ['Bharat AC-001 points', 'Suitable 15 A sockets on a dedicated circuit'], power: 'About 3.3 kW per outlet', note: 'Slow; best for long stops or overnight.' },
    { id: 'bdc', name: 'Bharat DC-001', tag: 'DC, older', about: 'An early low-voltage DC standard (GB/T style connector) used by some first-generation fleet cars.', fits: ['Bharat DC-001 chargers, which are becoming less common'], power: 'Up to about 15 kW', note: 'Check that a station still has a working DC-001 gun before you travel.' },
  ],
  bike: [
    { id: 'socket', name: '15 A socket', tag: 'Portable charger', about: 'Most electric scooters and bikes charge through their own charger plugged into an ordinary-looking power socket.', fits: ['Shops, homes and offices with a safe, earthed socket', 'Hosts offering a socket for bikes', 'Bharat AC-001 style outlets'], power: 'Usually well under 1 kW to about 1.5 kW', note: 'The socket should be on a properly protected circuit; extension cords are a common safety problem.' },
    { id: 'type7', name: 'Type 7 (LECCS)', tag: 'AC + DC', about: 'The light-EV combined connector standardised by BIS as IS 17017 (Part 2/Sec 7) in 2023: one inlet for AC and DC charging.', fits: ['LECCS-equipped fast chargers', 'Compatible AC points for light EVs'], power: 'AC up to about 7.7 kW, DC up to about 12 kW, depending on the vehicle', note: 'Your vehicle decides the actual power; many charge well below the maximum.' },
    { id: 'type6', name: 'Type 6 (LEVDC)', tag: 'DC', about: 'The DC-only connector for light electric vehicles in the same IS 17017 family.', fits: ['LEVDC fast chargers'], power: 'Low-voltage DC fast charging for light EVs', note: 'Less common for private two-wheelers; check your vehicle manual.' },
    { id: 'brand', name: 'Brand-specific', tag: 'Varies', about: 'Some makers use their own connectors, networks or swappable batteries.', fits: ['The maker’s own network', 'A household socket with the maker’s portable charger, where supported'], power: 'Varies by maker', note: 'We will only show options a maker’s connector is known to fit.' },
  ],
};

const PRESETS = [
  { id: 'dc', label: 'Car on DC', cap: 30, from: 20, to: 80, charger: 50, vehicle: 50, price: 20 },
  { id: 'ac', label: 'Car on home AC', cap: 30, from: 20, to: 100, charger: 7.4, vehicle: 7.2, price: 9 },
  { id: 'bike', label: 'Scooter on a socket', cap: 3, from: 15, to: 100, charger: 0.75, vehicle: 0.75, price: 9 },
];

function estimate(v: { cap: number; from: number; to: number; charger: number; vehicle: number; price: number }) {
  const p = Math.max(0.1, Math.min(v.charger, v.vehicle));
  const lo = Math.min(v.from, v.to);
  const hi = Math.max(v.from, v.to);
  // simple model: full power to 80%, then roughly 40% of it (battery taper); ~90% efficiency from the wall
  const below = (Math.max(0, Math.min(hi, 80) - lo) / 100) * v.cap;
  const above = (Math.max(0, hi - Math.max(lo, 80)) / 100) * v.cap;
  const taper = p > 7.5 ? 0.4 : 0.8; // AC charging tapers far less
  const hours = below / (p * 0.9) + above / (p * 0.9 * taper);
  const kwh = (below + above) / 0.9;
  return { hours, kwh, cost: kwh * v.price };
}
const fmtTime = (h: number) => {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

export default function Drivers() {
  const ref = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<Kind>('car');
  const [conn, setConn] = useState('ccs2');
  const [v, setV] = useState(PRESETS[0]);
  useMotion(ref);
  const current = CONNECTORS[kind].find((c) => c.id === conn) ?? CONNECTORS[kind][0];
  const est = useMemo(() => estimate(v), [v]);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !resultRef.current) return;
      gsap.fromTo(resultRef.current.children, { clipPath: 'inset(0 0 100% 0)', y: 16 }, { clipPath: 'inset(0 0 0% 0)', y: 0, duration: 0.6, stagger: 0.06, ease: 'expo.out', clearProps: 'clipPath' });
    },
    [current.id],
  );

  const field = (key: 'cap' | 'from' | 'to' | 'charger' | 'vehicle' | 'price', label: string, min: number, max: number, step: number, unit: string) => (
    <label className="est-field">
      <span>
        {label}
        <output>
          {v[key]}
          {unit}
        </output>
      </span>
      <input type="range" min={min} max={max} step={step} value={v[key]} onChange={(e) => setV({ ...v, id: 'custom', [key]: Number(e.target.value) })} />
    </label>
  );

  return (
    <div className="page" ref={ref}>
      <PageHero
        kicker="For drivers and riders"
        icon="car"
        title={
          <>
            Charging that <span className="ink-gradient">fits what you drive.</span>
          </>
        }
        lede="The planned app starts with your vehicle: its connector, how much power it can take, and how far you need to go. Here is what that means in practice, and a calculator you can use today."
      />

      <section className="section" aria-labelledby="compat-title">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Compatibility explorer</span>
            <h2 className="h2" id="compat-title" data-kinetic>
              Which chargers can my vehicle use?
            </h2>
            <p className="muted">General guidance, not advice for a specific vehicle. Always follow your vehicle manual and the charger’s instructions.</p>
          </div>
          <div className="compat glass">
            <div className="compat-side">
              <div className="seg" role="tablist" aria-label="Vehicle type">
                {(['car', 'bike'] as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={kind === k}
                    className="seg-btn"
                    onClick={() => {
                      setKind(k);
                      setConn(CONNECTORS[k][0].id);
                    }}
                  >
                    <Icon name={k === 'car' ? 'car' : 'scooter'} />
                    {k === 'car' ? 'Electric car' : 'Bike or scooter'}
                  </button>
                ))}
              </div>
              <div className="conn-list" role="radiogroup" aria-label="Connector">
                {CONNECTORS[kind].map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={c.id === current.id} className="conn" onClick={() => setConn(c.id)} data-gloss>
                    <strong>{c.name}</strong>
                    <small>{c.tag}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="compat-result" ref={resultRef} aria-live="polite">
              <h3 className="h3">{current.name}</h3>
              <p>{current.about}</p>
              <div>
                <h4>Can typically use</h4>
                <ul role="list">
                  {current.fits.map((f) => (
                    <li key={f}>
                      <Icon name="check" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="compat-power">
                <Icon name="gauge" /> {current.power}
              </p>
              <p className="compat-note">
                <Icon name="info" /> {current.note}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section band" aria-labelledby="est-title">
        <div className="container estimator">
          <div className="section-head">
            <span className="kicker">Estimate</span>
            <h2 className="h2" id="est-title" data-kinetic>
              Roughly how long, roughly how much?
            </h2>
            <p className="muted">
              A simple model of the kind of estimate the app is planned to show. Real charging depends on battery temperature, state of charge, charger sharing and the actual tariff.
            </p>
            <div className="preset-row">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className="chip-btn" aria-pressed={v.id === p.id} onClick={() => setV(p)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="est-panel glass" data-gloss>
            <div className="est-fields">
              {field('cap', 'Usable battery', 1, 100, 0.5, ' kWh')}
              {field('from', 'Start at', 0, 95, 5, '%')}
              {field('to', 'Charge to', 5, 100, 5, '%')}
              {field('charger', 'Charger power', 0.5, 150, 0.5, ' kW')}
              {field('vehicle', 'Your vehicle accepts up to', 0.5, 150, 0.5, ' kW')}
              {field('price', 'Price per kWh (example)', 1, 40, 0.5, ' ₹')}
            </div>
            <div className="est-out" aria-live="polite">
              <div>
                <small>Estimated time</small>
                <strong>{fmtTime(est.hours)}</strong>
              </div>
              <div>
                <small>Estimated cost</small>
                <strong>₹{Math.round(est.cost).toLocaleString('en-IN')}</strong>
              </div>
              <div>
                <small>Energy from the charger</small>
                <strong>{est.kwh.toFixed(1)} kWh</strong>
              </div>
              <p className="est-disclaimer">
                <Icon name="triangle-alert" /> Estimate only. The price field is an example: use the rate posted at the charger. Some chargers bill by time or session instead of energy.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="fallback-title">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Fallback options</span>
            <h2 className="h2" id="fallback-title" data-kinetic>
              When the first choice does not work out.
            </h2>
          </div>
          <div className="grid-3" data-depth-panels>
            {(
              [
                { icon: 'route', t: 'Nearby alternatives', d: 'Other compatible options within reach of your remaining range, listed with the same checks.' },
                { icon: 'timer', t: 'Slower, but closer', d: 'Sometimes an AC point or a host’s socket five minutes away beats a fast charger forty minutes away.' },
                { icon: 'calendar-clock', t: 'Hours that fit', d: 'Host availability shown up front, so you do not arrive at a closed gate.' },
                { icon: 'message-circle', t: 'Fresh reports', d: 'Recent “worked” or “out of order” reports from other drivers, with their age shown.' },
              ] as { icon: IconName; t: string; d: string }[]
            ).map((c) => (
              <article className="card" key={c.t} data-gloss data-tilt="4">
                <span className="icon-tile">
                  <Icon name={c.icon} />
                </span>
                <h3 className="h3">{c.t}</h3>
                <p>{c.d}</p>
                <span className="badge">Planned</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section cta-band">
        <div className="container cta-inner">
          <h2 className="h2" data-kinetic>
            Tell us what you drive.
          </h2>
          <p className="muted">Early-access sign-ups help us decide which vehicles and areas to support first.</p>
          <div className="cta-actions">
            <ButtonLink to="/contact?form=driver" icon="arrow-right">
              Join driver early access
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
