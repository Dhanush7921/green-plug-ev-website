import { useRef } from 'react';
import { ButtonLink } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { PageHero } from '../components/PageHero';
import { gsap, useGSAP } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { useMotion } from '../motion/kinetic';

const STEPS: { icon: IconName; title: string; text: string; detail: string[] }[] = [
  {
    icon: 'car',
    title: 'Tell it what you drive',
    text: 'Add your car, bike or scooter once. The app is planned to note its connector type and how much power it can accept.',
    detail: ['Vehicle type and model', 'Connector, for example Type 2, CCS2, Type 7 (LECCS) or a portable charger', 'Optional: usual routes and home area'],
  },
  {
    icon: 'map-pinned',
    title: 'See options that fit',
    text: 'Public stations and participating private hosts near you or along your route, filtered so incompatible chargers stay out of the way.',
    detail: ['Public charge points and invited private hosts', 'Opening hours and access notes', 'How recently the information was confirmed'],
  },
  {
    icon: 'calculator',
    title: 'Compare time and estimated cost',
    text: 'For each option, a rough charging time and a price estimate based on the charger power, your vehicle and the posted rate.',
    detail: ['Estimates are labelled as estimates', 'Real time depends on battery temperature and charge level', 'Fallback options listed alongside'],
  },
  {
    icon: 'plug-zap',
    title: 'Go, plug in, tell the next driver',
    text: 'Navigate there with your usual maps app, charge, then leave a one-tap report so information stays fresh for everyone.',
    detail: ['Works with the maps app you already use', 'Report: worked, busy or out of order', 'Booking and in-app payment are possible later features, not part of this phase'],
  },
];

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref);

  // the plug travels down the cable and seats into each step's socket as you scroll
  useGSAP(
    () => {
      if (prefersReducedMotion()) {
        ref.current?.querySelectorAll('.step').forEach((s) => s.classList.add('is-on'));
        return;
      }
      const steps = gsap.utils.toArray<HTMLElement>('.step');
      const rail = ref.current?.querySelector<HTMLElement>('.stepper');
      if (!rail) return;
      const plug = rail.querySelector<HTMLElement>('.stepper-plug');
      gsap.fromTo('.stepper-cable-fill', { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: rail, start: 'top 55%', end: 'bottom 60%', scrub: 0.5 } });
      gsap.fromTo(plug, { y: 0 }, { y: () => rail.offsetHeight - 70, ease: 'none', scrollTrigger: { trigger: rail, start: 'top 55%', end: 'bottom 60%', scrub: 0.5, invalidateOnRefresh: true } });
      steps.forEach((step) => {
        gsap.timeline({
          scrollTrigger: {
            trigger: step,
            start: 'top 58%',
            toggleActions: 'play none none reverse',
            onEnter: () => step.classList.add('is-on'),
            onLeaveBack: () => step.classList.remove('is-on'),
          },
        })
          .fromTo(step.querySelector('.step-socket'), { scale: 0.7 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' })
          .fromTo(step.querySelectorAll('.step-detail li'), { x: -16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, stagger: 0.06, duration: 0.5 }, 0.1);
      });
    },
    [],
    ref,
  );

  return (
    <div className="page" ref={ref}>
      <PageHero
        kicker="How it works"
        icon="route"
        title={
          <>
            From low battery to <span className="ink-gradient">plugged in</span>, in four steps.
          </>
        }
        lede="This is how the planned GREEN PLUG EV app is meant to work once it launches. Nothing here is live yet; we are sharing the design so drivers and hosts can shape it."
      >
        <span className="badge">Planned product · not yet available</span>
      </PageHero>

      <section className="section" aria-label="Steps">
        <div className="container">
          <ol className="stepper" role="list">
            <span className="stepper-cable" aria-hidden="true">
              <span className="stepper-cable-fill" />
            </span>
            <span className="stepper-plug" aria-hidden="true">
              <Icon name="plug" />
            </span>
            {STEPS.map((s, i) => (
              <li className="step" key={s.title}>
                <span className="step-socket" aria-hidden="true">
                  <span>{i + 1}</span>
                </span>
                <div className="step-body card" data-gloss>
                  <div className="step-head">
                    <span className="icon-tile">
                      <Icon name={s.icon} />
                    </span>
                    <h2 className="h2">
                      <span className="sr-only">Step {i + 1}: </span>
                      {s.title}
                    </h2>
                  </div>
                  <p className="lede">{s.text}</p>
                  <ul className="step-detail" role="list">
                    {s.detail.map((d) => (
                      <li key={d}>
                        <Icon name="check" /> {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section band" aria-labelledby="phase-title">
        <div className="container grid-2">
          <div className="section-head">
            <span className="kicker">Honest scope</span>
            <h2 className="h2" id="phase-title" data-kinetic>
              What this first phase is, and is not.
            </h2>
            <p className="muted" data-scan>
              This website explains the plan and gathers early interest. The app itself is still being built.
            </p>
          </div>
          <div className="scope" data-depth-panels>
            <div className="card scope-card" data-gloss>
              <h3 className="h3">
                <Icon name="check" /> Now
              </h3>
              <ul role="list">
                <li>This informational website</li>
                <li>Early-access and host-interest forms</li>
                <li>Conversations with drivers, hosts and partners</li>
              </ul>
            </div>
            <div className="card scope-card is-later" data-gloss>
              <h3 className="h3">
                <Icon name="hourglass" /> Later, not live
              </h3>
              <ul role="list">
                <li>Mobile apps for Android and iPhone</li>
                <li>Live charger information and host listings</li>
                <li>Any booking or payment features</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section cta-band">
        <div className="container cta-inner">
          <h2 className="h2" data-kinetic>
            Want a say in how it works?
          </h2>
          <div className="cta-actions">
            <ButtonLink to="/contact?form=driver" icon="arrow-right">
              Join early access
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
