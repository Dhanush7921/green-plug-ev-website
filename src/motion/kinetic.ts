// Page-level motion vocabulary, applied declaratively with data attributes:
//   data-kinetic          headline chars flip up out of depth (3D), then a light band sweeps across
//   data-scan             lines wipe open behind a mint scan bar
//   data-depth-panels     children fly forward out of perspective depth as the group scrolls in (scrubbed)
//   data-depth="0.2"      layered parallax: positive = background drifts slower, negative = foreground faster
//   data-draw             SVG strokes draw with scroll
//   data-rise             single block rises with a slight 3D tilt (used sparingly)
import type { RefObject } from 'react';
import { gsap, ScrollTrigger, SplitText, useGSAP } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';

export function kineticHeading(el: HTMLElement, opts: { delay?: number; scroll?: boolean } = {}) {
  return SplitText.create(el, {
    type: 'lines,words,chars',
    mask: 'lines',
    linesClass: 'split-line',
    charsClass: 'char',
    wordsClass: 'word',
    autoSplit: true,
    onSplit(self) {
      if (el.dataset.played === '1') return;
      const trigger = opts.scroll === false ? undefined : { trigger: el, start: 'top 86%', once: true };
      const tl = gsap.timeline({ delay: opts.delay ?? 0, scrollTrigger: trigger, onComplete: () => void (el.dataset.played = '1') });
      tl.fromTo(
        self.chars,
        { yPercent: 105, rotationX: -88, z: -60, transformOrigin: '50% 100% -12px', filter: 'blur(5px)' },
        { yPercent: 0, rotationX: 0, z: 0, filter: 'blur(0px)', duration: 1.1, ease: 'expo.out', stagger: { each: 0.022, from: 'start' }, clearProps: 'filter' },
      ).fromTo(el, { '--sx': '-40%' }, { '--sx': '140%', duration: 1.2, ease: 'power2.inOut' }, 0.45);
      return tl;
    },
  });
}

export function scanLines(el: HTMLElement) {
  return SplitText.create(el, {
    type: 'lines',
    linesClass: 'scan-line',
    autoSplit: true,
    onSplit(self) {
      if (el.dataset.played === '1') return;
      return gsap.fromTo(
        self.lines,
        { clipPath: 'inset(0 100% 0 0)', '--scan': '0%' },
        { clipPath: 'inset(0 0% 0 0)', '--scan': '100%', duration: 1.05, ease: 'power3.inOut', stagger: 0.12, scrollTrigger: { trigger: el, start: 'top 88%', once: true }, onComplete: () => void (el.dataset.played = '1') },
      );
    },
  });
}

export function useMotion(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      const root = scope.current;
      if (!root || prefersReducedMotion()) return;
      const mobile = window.innerWidth < 760;

      root.querySelectorAll<HTMLElement>('[data-kinetic]:not([data-manual])').forEach((el) => kineticHeading(el));
      root.querySelectorAll<HTMLElement>('[data-scan]').forEach((el) => scanLines(el));

      root.querySelectorAll<HTMLElement>('[data-depth-panels]').forEach((group) => {
        const items = Array.from(group.children) as HTMLElement[];
        gsap.set(group, { perspective: 1200 });
        items.forEach((item, i) => {
          gsap.fromTo(
            item,
            { z: mobile ? -80 : -320, rotationX: mobile ? 8 : 22, yPercent: mobile ? 12 : 26, autoAlpha: 0, transformOrigin: '50% 100%' },
            {
              z: 0,
              rotationX: 0,
              yPercent: 0,
              autoAlpha: 1,
              ease: 'power2.out',
              scrollTrigger: { trigger: item, start: `top ${100 - (mobile ? 0 : (i % 3) * 4)}%`, end: 'top 62%', scrub: 0.9 },
            },
          );
        });
      });

      root.querySelectorAll<HTMLElement>('[data-depth]').forEach((el) => {
        const d = parseFloat(el.dataset.depth || '0.15') * (mobile ? 0.5 : 1);
        gsap.fromTo(el, { yPercent: d * 100 }, { yPercent: -d * 100, ease: 'none', scrollTrigger: { trigger: el.parentElement || el, start: 'top bottom', end: 'bottom top', scrub: true } });
      });

      root.querySelectorAll<SVGGeometryElement>('[data-draw]').forEach((el) => {
        const len = el.getTotalLength();
        gsap.set(el, { strokeDasharray: len, strokeDashoffset: len });
        const trigger = (el.closest('[data-draw-trigger]') as Element) || el;
        gsap.to(el, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger, start: 'top 78%', end: 'bottom 60%', scrub: 0.6 } });
      });

      root.querySelectorAll<HTMLElement>('[data-rise]').forEach((el) => {
        gsap.from(el, { y: 60, rotationX: -10, transformPerspective: 900, transformOrigin: '50% 0%', autoAlpha: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
      });

      document.fonts?.ready.then(() => ScrollTrigger.refresh());
    },
    deps,
    scope,
  );
}
