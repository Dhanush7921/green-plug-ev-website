import { useRef, useState, type CSSProperties } from 'react';
import { ButtonLink } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { PageHero } from '../components/PageHero';
import { useMotion } from '../motion/kinetic';

const JOURNEY: { icon: IconName; title: string; text: string }[] = [
  { icon: 'send', title: 'Register interest', text: 'Tell us where you are and what you have. This is not a commitment.' },
  { icon: 'clipboard-check', title: 'Describe your equipment', text: 'Charger or socket type, power rating, connector, parking access and photos of the installation.' },
  { icon: 'key-round', title: 'Confirm permission', text: 'Owner, landlord or housing-society consent where the parking or power supply is shared.' },
  { icon: 'shield-check', title: 'Planned checks', text: 'We intend to review details before any listing, and may ask for an electrician’s confirmation.' },
  { icon: 'sliders-horizontal', title: 'Set hours and price', text: 'Choose when you are available, which vehicles you accept and what you charge.' },
];

const CHECKS = [
  { id: 'equip', label: 'I have an EV charger, or a socket on a dedicated, protected circuit (RCD/MCB)' },
  { id: 'park', label: 'A vehicle can park within reach of it without blocking anyone' },
  { id: 'perm', label: 'I own the property or can get permission from whoever does' },
  { id: 'meter', label: 'I know whose electricity meter and bill the charger uses' },
  { id: 'hours', label: 'I can offer some regular hours' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['Morning', 'Afternoon', 'Evening', 'Night'];

export default function Hosts() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [grid, setGrid] = useState<Record<string, boolean>>({ 'Sat-Morning': true, 'Sat-Afternoon': true, 'Sun-Morning': true, 'Mon-Evening': true, 'Wed-Evening': true, 'Fri-Evening': true });
  const count = CHECKS.filter((c) => checked[c.id]).length;

  return (
    <div className="page" ref={ref}>
      <PageHero
        kicker="For charging hosts"
        icon="house"
        title={
          <>
            Your charger, <span className="ink-gradient">your terms.</span>
          </>
        }
        lede="Homes, shops, cafés, hotels and offices with suitable charging equipment could offer it to nearby drivers through GREEN PLUG EV. Hosting is planned, not open yet. Registering interest helps us design it around you."
      >
        <ButtonLink to="/contact?form=host" icon="arrow-right">
          Register host interest
        </ButtonLink>
      </PageHero>

      <section className="section" aria-labelledby="journey-title">
        <div className="container">
          <div className="section-head">
            <span className="kicker">How hosting could work</span>
            <h2 className="h2" id="journey-title" data-kinetic>
              Five steps, and you stay in control at each one.
            </h2>
          </div>
          <ol className="journey" role="list" data-depth-panels>
            {JOURNEY.map((j, i) => (
              <li className="card journey-step" key={j.title} data-gloss data-tilt="4">
                <span className="journey-level" style={{ '--lvl': (i + 1) / JOURNEY.length } as CSSProperties} aria-hidden="true" />
                <span className="icon-tile">
                  <Icon name={j.icon} />
                </span>
                <h3 className="h3">
                  {i + 1}. {j.title}
                </h3>
                <p>{j.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section band" aria-labelledby="ready-title">
        <div className="container grid-2">
          <div className="section-head">
            <span className="kicker">Self-check</span>
            <h2 className="h2" id="ready-title" data-kinetic>
              Could your place be a good fit?
            </h2>
            <p className="muted">
              A quick self-check for your own planning. It is not an approval or a safety inspection, and nothing you tick here is sent anywhere.
            </p>
          </div>
          <div className="readiness glass" data-gloss>
            <ul role="list">
              {CHECKS.map((c) => (
                <li key={c.id}>
                  <label className="check">
                    <input type="checkbox" checked={!!checked[c.id]} onChange={(e) => setChecked({ ...checked, [c.id]: e.target.checked })} />
                    <span>{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="readiness-meter" style={{ '--lvl': count / CHECKS.length } as CSSProperties}>
              <span className="readiness-bar" aria-hidden="true" />
              <p aria-live="polite">
                {count === CHECKS.length
                  ? 'Looks promising. Register your interest and we will follow up with the details we would need to check.'
                  : count >= 3
                    ? 'Getting there. Register interest anyway; we can talk through what is missing.'
                    : 'Tick what applies to you. If you are unsure about wiring, an electrician should look first.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="avail-title">
        <div className="container grid-2">
          <div className="section-head">
            <span className="kicker">Availability and price</span>
            <h2 className="h2" id="avail-title" data-kinetic>
              Open when it suits you.
            </h2>
            <p className="muted">
              The planned host tools let you mark the hours you can offer, choose cars, bikes or both, and set your own rate per kWh, per hour or per session. Try the availability grid; it is a
              preview and does not save anything.
            </p>
            <ul className="tick-list" role="list">
              <li>
                <Icon name="check" /> Pause hosting at any time
              </li>
              <li>
                <Icon name="check" /> Accept only vehicle types your equipment suits
              </li>
              <li>
                <Icon name="check" /> Exact address shown only to a confirmed driver (planned)
              </li>
            </ul>
          </div>
          <div className="avail glass" data-gloss>
            <div className="avail-head">
              <span className="badge">Preview</span>
              <span className="muted">Tap to toggle</span>
            </div>
            <div className="avail-grid" role="group" aria-label="Example weekly availability">
              <span aria-hidden="true" />
              {DAYS.map((d) => (
                <span key={d} className="avail-day" aria-hidden="true">
                  {d}
                </span>
              ))}
              {SLOTS.map((s) => (
                <div className="avail-row" key={s}>
                  <span className="avail-slot">
                    {s}
                  </span>
                  {DAYS.map((d) => {
                    const k = `${d}-${s}`;
                    return (
                      <button key={k} type="button" className="avail-cell" aria-pressed={!!grid[k]} aria-label={`${d} ${s}`} onClick={() => setGrid({ ...grid, [k]: !grid[k] })} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section cta-band">
        <div className="container cta-inner">
          <h2 className="h2" data-kinetic>
            Have a charger that sits idle?
          </h2>
          <div className="cta-actions">
            <ButtonLink to="/contact?form=host" icon="arrow-right">
              Register host interest
            </ButtonLink>
            <ButtonLink to="/safety" variant="glass">
              Safety and trust
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
