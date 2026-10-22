import { ButtonLink } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';

type Side = { id: string; word: string; kicker: string; title: string; text: string; points: { icon: IconName; text: string }[]; cta: { to: string; label: string }; chips: string[] };

const SIDES: Side[] = [
  {
    id: 'drivers',
    word: 'DRIVE',
    kicker: 'For drivers and riders',
    title: 'Arrive at a plug that fits.',
    text: 'Cars, bikes and scooters charge in different ways. GREEN PLUG EV is being shaped so each rider sees what works for their vehicle, with honest estimates and a plan B.',
    points: [
      { icon: 'plug', text: 'Connector and power matched to your vehicle' },
      { icon: 'indian-rupee', text: 'Estimated cost shown before you go' },
      { icon: 'route', text: 'Nearby fallbacks if plans change' },
    ],
    cta: { to: '/drivers', label: 'For drivers' },
    chips: ['Type 2', 'CCS2', '15A socket', 'Bharat AC-001'],
  },
  {
    id: 'hosts',
    word: 'HOST',
    kicker: 'For charging hosts',
    title: 'Share a charger on your terms.',
    text: 'If you have suitable charging equipment where vehicles can park, you could choose when it is available, which vehicles it suits and what to charge, after safety checks.',
    points: [
      { icon: 'calendar-clock', text: 'You set the hours and the price' },
      { icon: 'shield-check', text: 'Equipment and permission checks planned' },
      { icon: 'eye-off', text: 'Exact address shared only when needed' },
    ],
    cta: { to: '/hosts', label: 'For hosts' },
    chips: ['Your hours', 'Your price', 'Cars or bikes'],
  },
];

export function Benefits() {
  return (
    <section className="section benefits" aria-label="Driver and host benefits">
      <div className="container benefits-stack">
        {SIDES.map((s, i) => (
          <div className={`benefit benefit-${s.id}`} key={s.id} data-draw-trigger>
            <span className="benefit-word" data-depth="0.35" aria-hidden="true">
              {s.word}
            </span>
            <svg className="benefit-line" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">
              <path data-draw d={i === 0 ? 'M0 160 C 140 160, 180 40, 320 60 S 520 150, 600 30' : 'M0 40 C 160 30, 200 170, 340 140 S 520 40, 600 170'} />
            </svg>
            <div className="benefit-card glass" data-gloss data-tilt="3">
              <span className="kicker">{s.kicker}</span>
              <h2 className="h2" data-kinetic>
                {s.title}
              </h2>
              <p className="muted">{s.text}</p>
              <ul className="benefit-points" role="list">
                {s.points.map((p) => (
                  <li key={p.text}>
                    <span className="icon-tile">
                      <Icon name={p.icon} />
                    </span>
                    {p.text}
                  </li>
                ))}
              </ul>
              <ButtonLink to={s.cta.to} variant="glass" icon="arrow-right">
                {s.cta.label}
              </ButtonLink>
            </div>
            <div className="benefit-chips" data-depth="-0.25" aria-hidden="true">
              {s.chips.map((c) => (
                <span className="float-chip" key={c}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
