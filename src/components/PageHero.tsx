import { useRef, type ReactNode } from 'react';
import { gsap, useGSAP } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { kineticHeading } from '../motion/kinetic';
import { Icon, type IconName } from './Icon';

/**
 * Secondary-page hero: kinetic title on the left, an "energy orbit" emblem on the right whose
 * rings counter-rotate and whose charge arc fills as the page loads. Content stays readable first.
 */
export function PageHero({ kicker, title, lede, icon, children }: { kicker: string; title: ReactNode; lede: ReactNode; icon: IconName; children?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const t = ref.current?.querySelector<HTMLElement>('.page-title');
      if (t) kineticHeading(t, { delay: 0.75, scroll: false });
      gsap.from('.page-hero .kicker, .page-hero .lede, .page-hero-extra > *', { y: 26, autoAlpha: 0, duration: 1, stagger: 0.08, ease: 'expo.out', delay: 1.05 });
      const tl = gsap.timeline({ delay: 0.8 });
      tl.from('.orbit', { scale: 0.6, autoAlpha: 0, rotation: -40, duration: 1.4, ease: 'expo.out' })
        .fromTo('.orbit-charge', { strokeDashoffset: 1 }, { strokeDashoffset: 0.28, duration: 1.6, ease: 'power3.inOut' }, 0.2)
        .from('.orbit-core', { scale: 0, duration: 0.8, ease: 'back.out(2.4)' }, 0.5);
      gsap.to('.orbit-ring-a', { rotation: 360, duration: 40, repeat: -1, ease: 'none', svgOrigin: '160 160' });
      gsap.to('.orbit-ring-b', { rotation: -360, duration: 60, repeat: -1, ease: 'none', svgOrigin: '160 160' });
      gsap.to('.orbit', { yPercent: -18, ease: 'none', scrollTrigger: { trigger: ref.current, start: 'top top', end: 'bottom top', scrub: true } });
    },
    [],
    ref,
  );
  return (
    <header className="page-hero" ref={ref}>
      <div className="page-hero-bg" aria-hidden="true" />
      <div className="container page-hero-grid">
        <div className="page-hero-copy">
          <span className="kicker">{kicker}</span>
          <h1 className="h1 page-title" data-manual>
            {title}
          </h1>
          <p className="lede">{lede}</p>
          {children && <div className="page-hero-extra">{children}</div>}
        </div>
        <div className="orbit" aria-hidden="true">
          <svg viewBox="0 0 320 320">
            <g className="orbit-ring-a">
              <circle className="orbit-ring" cx="160" cy="160" r="150" strokeDasharray="2 10" />
              <circle className="orbit-sat" cx="160" cy="10" r="5" />
            </g>
            <circle className="orbit-ring orbit-ring-b" cx="160" cy="160" r="122" strokeDasharray="40 14 4 14" />
            <circle className="orbit-track" cx="160" cy="160" r="96" />
            <circle className="orbit-charge" cx="160" cy="160" r="96" pathLength={1} strokeDasharray="1 1" transform="rotate(-90 160 160)" />
          </svg>
          <span className="orbit-core">
            <Icon name={icon} strokeWidth={1.5} />
          </span>
        </div>
      </div>
    </header>
  );
}
