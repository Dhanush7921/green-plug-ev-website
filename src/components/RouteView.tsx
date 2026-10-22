import { useEffect, useRef, useState, type ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { pageTitles, site } from '../config/site';
import { gsap, ScrollTrigger } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { useLocation, type AppLocation } from '../lib/router';
import { LogoMark } from './Logo';

function scrollToHash(hash: string) {
  if (!hash) return;
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
function setTitle(pathname: string) {
  const t = pageTitles[pathname];
  document.title = t ? `${t} | ${site.name}` : `Page not found | ${site.name}`;
}

/**
 * Page transition: a mint energy line shoots across the screen, splits open into a forest
 * panel (the mark charges in its centre), the page swaps, and the panel retracts upwards.
 */
export function RouteView({ routes, fallback }: { routes: Record<string, ComponentType>; fallback: ComponentType }) {
  const location = useLocation();
  const [shown, setShown] = useState<AppLocation>(location);
  const warp = useRef<HTMLDivElement>(null);

  useEffect(() => setTitle(shown.pathname), [shown.pathname]);
  useEffect(() => {
    const t = window.setTimeout(() => scrollToHash(location.hash), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (location.key === shown.key) return;
    if (location.pathname === shown.pathname) {
      setShown(location);
      if (location.hash) scrollToHash(location.hash);
      else if (location.search === shown.search) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    const swap = () => {
      flushSync(() => setShown(location));
      window.scrollTo(0, 0);
      ScrollTrigger.refresh();
      document.getElementById('main')?.focus({ preventScroll: true });
    };
    const w = warp.current;
    if (!w || prefersReducedMotion()) {
      swap();
      scrollToHash(location.hash);
      return;
    }
    const line = w.querySelector('.warp-line');
    const panel = w.querySelector('.warp-panel');
    const mark = w.querySelector('.warp-mark');
    const tl = gsap.timeline();
    tl.set(w, { visibility: 'visible' })
      .fromTo(line, { scaleX: 0, autoAlpha: 1 }, { scaleX: 1, duration: 0.38, ease: 'power3.inOut' })
      .fromTo(panel, { clipPath: 'inset(50% 0% 50% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5, ease: 'expo.inOut' }, '-=0.08')
      .to(line, { autoAlpha: 0, duration: 0.2 }, '<0.2')
      .fromTo(mark, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, '<0.1')
      .add(swap)
      .to(mark, { autoAlpha: 0, y: -24, duration: 0.25, ease: 'power2.in' }, '+=0.05')
      .to(panel, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.6, ease: 'expo.inOut' }, '-=0.1')
      .set(w, { visibility: 'hidden' })
      .set(mark, { y: 0 })
      .add(() => scrollToHash(location.hash));
    return () => {
      if (tl.isActive()) tl.progress(1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const Page = routes[shown.pathname] ?? fallback;
  return (
    <>
      <Page key={shown.pathname} />
      <div className="warp" ref={warp} aria-hidden="true">
        <div className="warp-panel">
          <div className="warp-mark">
            <LogoMark />
          </div>
        </div>
        <div className="warp-line" />
      </div>
    </>
  );
}
