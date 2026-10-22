import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Accordion, type AccItem } from '../components/Accordion';
import { ButtonLink } from '../components/Button';
import { Icon } from '../components/Icon';
import { PageHero } from '../components/PageHero';
import { Link } from '../lib/router';
import { useMotion } from '../motion/kinetic';

type Group = { id: string; title: string; items: (AccItem & { text: string })[] };
const qa = (q: string, text: string, extra?: ReactNode): AccItem & { text: string } => ({ q, text, a: extra ?? <p>{text}</p> });

const GROUPS: Group[] = [
  {
    id: 'platform',
    title: 'The platform',
    items: [
      qa('What is GREEN PLUG EV?', 'GREEN PLUG EV is a planned app to help electric car and bike riders find charging that fits their vehicle, combining public charging locations with participating private hosts. It is being developed for Andhra Pradesh first.'),
      qa('Can I use the app today?', 'No. The app is in development and not published on Google Play or the App Store. This website explains the plan and lets you register interest.'),
      qa('Is this a booking or payment service?', 'Not in this phase. There is no login, booking or payment on this website. Booking and in-app payment may be considered later and will be announced clearly if they are built.'),
      qa('Which areas will it cover?', 'The first focus is Andhra Pradesh, India. Which cities come first will depend partly on where early-access drivers and hosts sign up.'),
    ],
  },
  {
    id: 'charging',
    title: 'Charging and compatibility',
    items: [
      qa('How will the app know which chargers suit my vehicle?', 'You will tell it your vehicle and connector, for example CCS2, Type 2, Type 7 (LECCS) or a portable charger. Options are planned to be filtered by connector and power so incompatible ones stay hidden.', (
        <p>
          You will tell it your vehicle and connector, for example CCS2, Type 2, Type 7 (LECCS) or a portable charger. Options are planned to be filtered by connector and power. The{' '}
          <Link to="/drivers" className="text-link">
            compatibility explorer
          </Link>{' '}
          shows the idea.
        </p>
      )),
      qa('Will it show whether a charger is free right now?', 'Where an operator or host shares live status, the plan is to show it with its age. Otherwise we will show opening hours and recent reports from drivers, never a guess presented as live data.'),
      qa('How accurate will time and cost estimates be?', 'They are estimates. Charging speed changes with battery temperature and charge level, and some chargers bill by time or session. Estimates will be labelled clearly and should be treated as a guide.'),
      qa('Does it work for electric bikes and scooters?', 'Yes, two-wheelers are part of the plan from the start, including options such as suitable sockets for portable chargers and light-EV connectors.'),
    ],
  },
  {
    id: 'hosts',
    title: 'Hosting',
    items: [
      qa('Who can become a charging host?', 'People and businesses with suitable charging equipment, safe parking access and permission to offer it, such as homes, shops, cafés, hotels and offices. Hosting is not open yet; you can register interest.'),
      qa('Do hosts set their own prices and hours?', 'That is the plan. Hosts would choose when they are available, which vehicle types they accept and what they charge.'),
      qa('Will hosts be verified?', 'Checks on equipment and permission are planned before any host is listed. No host has been verified yet because hosting has not started.'),
    ],
  },
  {
    id: 'public-private',
    title: 'Public and private charging',
    items: [
      qa('What is the difference between public and private charging?', 'Public charging is run by an operator at a location anyone can use, such as a fuel station or mall. Private charging here means a person or business offering their own charger or socket to drivers through the app, on their own terms.'),
      qa('Is private charging safe?', 'It can be when the equipment is suitable and properly installed. That is why equipment details, permission and planned checks are central to hosting, and why an extension cord is never an acceptable setup.'),
    ],
  },
  {
    id: 'data',
    title: 'Data and contact',
    items: [
      qa('What happens to details I send through the forms?', 'If the form service is configured, your details are stored in a private spreadsheet used only to contact you about what you asked for. You can ask us to delete them at any time. If it is not configured, the form says so and nothing is sent.'),
      qa('How do I get in touch?', 'Use the forms on the Contact page for early access, host interest, partnerships or general questions.'),
    ],
  },
];

export default function Faq() {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  useMotion(ref);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return GROUPS;
    return GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => `${i.q} ${i.text}`.toLowerCase().includes(s)) })).filter((g) => g.items.length);
  }, [q]);
  const total = filtered.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="page" ref={ref}>
      <PageHero kicker="FAQ" icon="lightbulb" title={<>Straight answers.</>} lede="About the planned platform, charging compatibility, availability, the app launch, hosting, and how public and private charging differ.">
        <label className="faq-search glass">
          <Icon name="search" />
          <span className="sr-only">Search questions</span>
          <input type="search" placeholder="Search questions" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </PageHero>
      <section className="section" aria-label="Questions">
        <div className="container faq-layout">
          <nav className="faq-nav" aria-label="FAQ topics">
            {filtered.map((g) => (
              <a key={g.id} href={`#${g.id}`}>
                {g.title}
              </a>
            ))}
          </nav>
          <div className="faq-groups">
            <p className="sr-only" aria-live="polite">
              {total} questions shown
            </p>
            {filtered.map((g) => (
              <div className="faq-group" id={g.id} key={g.id + q}>
                <h2 className="h3 faq-group-title">{g.title}</h2>
                <Accordion items={g.items} />
              </div>
            ))}
            {!filtered.length && <p className="muted">No questions match “{q}”. Try another word, or ask us directly.</p>}
          </div>
        </div>
      </section>
      <section className="section cta-band">
        <div className="container cta-inner">
          <h2 className="h2" data-kinetic>
            Still wondering about something?
          </h2>
          <div className="cta-actions">
            <ButtonLink to="/contact?form=general" icon="arrow-right">
              Ask a question
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
