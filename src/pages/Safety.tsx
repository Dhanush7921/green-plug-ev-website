import { useRef } from 'react';
import { ButtonLink } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { PageHero } from '../components/PageHero';
import { useMotion } from '../motion/kinetic';

const PRINCIPLES: { id: string; icon: IconName; title: string; text: string; points: string[] }[] = [
  {
    id: 'equipment',
    icon: 'circuit-board',
    title: 'Suitable equipment',
    text: 'Charging moves a lot of power for hours at a time. Hosts will be asked to describe equipment in detail, and unsuitable setups will not be listed.',
    points: ['EV chargers installed to the maker’s instructions', 'Sockets only on dedicated, protected circuits', 'No extension cords or adaptors stacked together'],
  },
  {
    id: 'permission',
    icon: 'key-round',
    title: 'Property permission',
    text: 'Charging often involves shared parking, a society’s supply or a landlord’s wiring. Hosts will need to confirm they have the right to offer it.',
    points: ['Owner or society consent where needed', 'Clear access instructions for drivers', 'Hosts can pause or stop at any time'],
  },
  {
    id: 'compatibility',
    icon: 'plug-zap',
    title: 'Connector compatibility',
    text: 'The wrong plug wastes a trip and the wrong adaptor can be dangerous. Options will be matched to the connector and power your vehicle supports.',
    points: ['Connector and power shown for every option', 'No suggestions that need improvised adaptors', 'Vehicle manuals and charger instructions come first'],
  },
  {
    id: 'accuracy',
    icon: 'badge-check',
    title: 'Accurate information',
    text: 'We would rather show less than show something wrong. Every detail is planned to carry its source and how recently it was confirmed.',
    points: ['Estimates always labelled as estimates', 'Report a problem in one tap', 'Outdated listings flagged or removed'],
  },
  {
    id: 'privacy',
    icon: 'eye-off',
    title: 'Your privacy',
    text: 'Collect only what is needed, keep it only as long as it is needed, and never sell it. Hosts’ exact addresses are planned to be shared only with a confirmed driver.',
    points: ['Website forms ask only for what we need to reply', 'Ask us to delete your details at any time', 'No advertising trackers on this website'],
  },
  {
    id: 'policies',
    icon: 'file-text',
    title: 'Transparent policies',
    text: 'Before the app launches we will publish plain-language terms for drivers and hosts: pricing, cancellations, disputes and responsibilities.',
    points: ['Prices shown before you travel', 'Clear rules for what happens if something goes wrong', 'A real person to contact'],
  },
];

export default function Safety() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref);
  return (
    <div className="page" ref={ref}>
      <PageHero
        kicker="Safety and trust"
        icon="shield-check"
        title={
          <>
            Trust is the <span className="ink-gradient">first connection.</span>
          </>
        }
        lede="The principles GREEN PLUG EV is being built on. They describe how we intend to run the service; no hosts have been verified and no charging locations are connected yet."
      >
        <nav className="toc" aria-label="On this page">
          {PRINCIPLES.map((p) => (
            <a key={p.id} href={`#${p.id}`} className="chip-btn">
              {p.title}
            </a>
          ))}
        </nav>
      </PageHero>

      <section className="section" aria-label="Principles">
        <div className="container principles">
          {PRINCIPLES.map((p, i) => (
            <article className="principle" id={p.id} key={p.id}>
              <div className="principle-index" aria-hidden="true" data-depth="0.25">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="principle-card card" data-gloss data-rise>
                <div className="step-head">
                  <span className="icon-tile">
                    <Icon name={p.icon} />
                  </span>
                  <h2 className="h2">{p.title}</h2>
                </div>
                <p className="lede">{p.text}</p>
                <ul className="tick-list" role="list">
                  {p.points.map((pt) => (
                    <li key={pt}>
                      <Icon name="check" /> {pt}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section band" aria-labelledby="never-title">
        <div className="container grid-2">
          <div className="section-head">
            <span className="kicker">Our promise on this website</span>
            <h2 className="h2" id="never-title" data-kinetic>
              What we will not claim.
            </h2>
          </div>
          <ul className="never-list" role="list" data-depth-panels>
            {['That stations or hosts are listed when they are not', 'That any host has been verified before checks exist', 'Download counts, ratings or user numbers we do not have', 'That a form was saved when it was not'].map((t) => (
              <li className="card" key={t}>
                <Icon name="ban" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section cta-band">
        <div className="container cta-inner">
          <h2 className="h2" data-kinetic>
            Questions about safety or data?
          </h2>
          <div className="cta-actions">
            <ButtonLink to="/contact?form=general" icon="arrow-right">
              Ask us
            </ButtonLink>
            <ButtonLink to="/faq" variant="glass">
              Read the FAQ
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
