import { useRef } from 'react';
import { Icon } from '../../components/Icon';
import { LogoMark } from '../../components/Logo';
import { gsap, useGSAP } from '../../lib/gsap';
import { prefersReducedMotion } from '../../lib/prefs';

/** Illustrative app concept. Every value on these screens is example data, labelled as a preview. */
export function AppPreview() {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const mm = gsap.matchMedia();
      mm.add('(min-width: 900px)', () => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: '.preview-track', start: 'top top', end: 'bottom bottom', scrub: 0.8 } });
        tl.fromTo('.phone', { rotationY: -28, rotationX: 14, rotationZ: -4, y: 80, scale: 0.88 }, { rotationY: 0, rotationX: 0, rotationZ: 0, y: 0, scale: 1, duration: 1, ease: 'power2.out' })
          .fromTo('.phone', { '--rim': 0.2 }, { '--rim': 1, duration: 0.6 }, 0.3)
          .fromTo('.pv-card', { x: 0, y: 0, z: -200, scale: 0.6, autoAlpha: 0 }, { x: (i: number) => [-330, 330, -300, 310][i], y: (i: number) => [-150, -70, 130, 170][i], z: 0, scale: 1, autoAlpha: 1, stagger: 0.12, duration: 0.8, ease: 'back.out(1.3)' }, 0.55)
          .fromTo('.screen-list li', { x: 40, autoAlpha: 0 }, { x: 0, autoAlpha: 1, stagger: 0.08, duration: 0.4 }, 0.5)
          .fromTo('.screen-route', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.8 }, 0.7);
      });
      mm.add('(max-width: 899px)', () => {
        gsap.from('.phone', { y: 60, rotationX: 12, transformPerspective: 900, autoAlpha: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.phone', start: 'top 85%', once: true } });
        gsap.from('.pv-card', { y: 40, autoAlpha: 0, stagger: 0.1, duration: 0.9, ease: 'expo.out', scrollTrigger: { trigger: '.pv-cards', start: 'top 85%', once: true } });
      });
      return () => mm.revert();
    },
    [],
    ref,
  );

  return (
    <section className="preview" ref={ref} aria-labelledby="preview-title">
      <div className="preview-track">
        <div className="preview-sticky container">
          <div className="section-head center">
            <span className="kicker">App preview</span>
            <h2 className="h1" id="preview-title" data-kinetic>
              Designed for a quick glance at the kerb.
            </h2>
            <span className="badge">
              Preview · concept design with example data, not a live app
            </span>
          </div>
          <div className="preview-stage">
            <div className="phone" data-gloss>
              <div className="phone-screen">
                <div className="screen-top">
                  <span>9:41</span>
                  <span className="screen-island" />
                  <span>
                    <Icon name="battery-medium" />
                  </span>
                </div>
                <div className="screen-brand">
                  <LogoMark />
                  <span>GREEN PLUG EV</span>
                </div>
                <div className="screen-search">
                  <Icon name="search" />
                  <span>Example area · Car · CCS2</span>
                </div>
                <div className="screen-map" aria-hidden="true">
                  <svg viewBox="0 0 220 130">
                    <path d="M0 40 H220 M0 92 H220 M60 0 V130 M150 0 V130" className="screen-streets" />
                    <path className="screen-route" pathLength={1} strokeDasharray="1 1" d="M40 110 L60 92 H150 V40 L178 26" />
                    <circle cx="40" cy="110" r="6" className="screen-you" />
                    <circle cx="178" cy="26" r="7" className="screen-pin" />
                    <circle cx="110" cy="70" r="5" className="screen-pin dim" />
                  </svg>
                </div>
                <ul className="screen-list" role="list">
                  <li>
                    <span className="sl-ico">
                      <Icon name="zap" />
                    </span>
                    <span>
                      <strong>Example DC station</strong>
                      <small>CCS2 · 60 kW · compatible</small>
                    </span>
                    <em>est.</em>
                  </li>
                  <li>
                    <span className="sl-ico">
                      <Icon name="house" />
                    </span>
                    <span>
                      <strong>Example home host</strong>
                      <small>Type 2 · 7.4 kW · evenings</small>
                    </span>
                    <em>est.</em>
                  </li>
                  <li>
                    <span className="sl-ico">
                      <Icon name="store" />
                    </span>
                    <span>
                      <strong>Example shop socket</strong>
                      <small>15A · bikes only</small>
                    </span>
                    <em>n/a</em>
                  </li>
                </ul>
              </div>
            </div>
            <div className="pv-cards">
              <div className="pv-card glass" data-gloss>
                <Icon name="plug-zap" />
                <div>
                  <strong>Fits your car</strong>
                  <small>Connector check (planned)</small>
                </div>
              </div>
              <div className="pv-card glass" data-gloss>
                <Icon name="timer" />
                <div>
                  <strong>About 45 min to 80%</strong>
                  <small>Example estimate</small>
                </div>
              </div>
              <div className="pv-card glass" data-gloss>
                <Icon name="clock" />
                <div>
                  <strong>Open until 10 pm</strong>
                  <small>Host-set hours (example)</small>
                </div>
              </div>
              <div className="pv-card glass" data-gloss>
                <Icon name="route" />
                <div>
                  <strong>2 fallbacks nearby</strong>
                  <small>If this one is busy (example)</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
