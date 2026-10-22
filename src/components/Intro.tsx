// Cinematic brand intro (~5.3 s), once per browser session, home page only.
// Sequence: baseline draws → a light streak traces the mark → wordmark outlines rise out of the
// baseline and charge to solid mint → the EV pill tumbles in → a specular sweep crosses the logo
// over a floor reflection → tagline settles → the logo collapses into a glowing point that opens
// as an iris onto the 3D hero. Skippable (button / Esc), silent, and never shown with reduced motion.
import { useEffect, useRef, useState } from 'react';
import { ARC_WIDTH, EV, LAYOUT, MARK, WORD } from '../brand/brandPaths';
import { gsap } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';

const KEY = 'gpev-intro';
export const INTRO_DONE = 'gpev:intro-done';
export const SCENE_PROGRESS = 'gpev:scene-progress';

function isHome() {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  if (import.meta.env.VITE_ROUTER === 'hash') return (window.location.hash.replace(/^#/, '') || '/').split(/[?#]/)[0].replace(/\/$/, '') === '';
  let p = window.location.pathname;
  if (base && p.startsWith(base)) p = p.slice(base.length);
  return p.replace(/\/+$/, '') === '';
}

export function introActive() {
  return document.documentElement.classList.contains('intro-active') || document.documentElement.classList.contains('intro-pending');
}

export function shouldPlayIntro() {
  let play = false;
  try {
    play = isHome() && !prefersReducedMotion() && !sessionStorage.getItem(KEY) && !new URLSearchParams(window.location.search).has('nointro');
  } catch {
    play = false;
  }
  if (!play) document.documentElement.classList.remove('intro-pending');
  return play;
}

const TAGLINE = 'Charging, found closer.';

export function Intro({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('intro-pending');
    html.classList.add('intro-active');
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* private mode: the intro may replay, which is harmless */
    }
    skipRef.current?.focus({ preventScroll: true });
    const onProgress = (e: Event) => setProgress(Math.round((e as CustomEvent<number>).detail * 100));
    window.addEventListener(SCENE_PROGRESS, onProgress);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      html.classList.remove('intro-active');
      window.dispatchEvent(new Event(INTRO_DONE));
      onDone();
    };

    const el = root.current!;
    const q = (s: string) => el.querySelectorAll(s);
    const glyphs = q('.ii-glyph');
    const tl = gsap.timeline({ onComplete: finish, defaults: { ease: 'power3.out' } });
    gsap.set(glyphs, { yPercent: 0, y: 34 });
    gsap.set(q('.ii-glyph'), { fillOpacity: 0, strokeDashoffset: 1 });
    tl.fromTo('.ii-base', { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'expo.inOut' }, 0.1)
      // the comet traces the arc of the mark
      .fromTo('.ii-arc', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, 0.35)
      .fromTo('.ii-comet', { strokeDashoffset: 1.12 }, { strokeDashoffset: -0.02, duration: 1.1, ease: 'power2.inOut' }, 0.35)
      .to('.ii-comet', { autoAlpha: 0, duration: 0.3 }, 1.35)
      .fromTo('.ii-plug', { scale: 0.2, autoAlpha: 0, svgOrigin: '40 32' }, { scale: 1, autoAlpha: 1, duration: 0.6, ease: 'back.out(2.2)' }, 1.05)
      .fromTo('.ii-spark', { scale: 0, rotate: -90, svgOrigin: '53.6 11' }, { scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(3)' }, 1.3)
      // letters rise out of the baseline as outlines
      .to(glyphs, { y: 0, duration: 0.9, stagger: { each: 0.07, from: 'start' }, ease: 'expo.out' }, 0.95)
      .to(glyphs, { strokeDashoffset: 0, duration: 0.9, stagger: 0.07, ease: 'power2.inOut' }, 0.95)
      // ...then charge to solid
      .to(glyphs, { fillOpacity: 1, strokeOpacity: 0, duration: 0.5, stagger: 0.05, ease: 'power1.inOut' }, 2.0)
      .fromTo('.ii-glow', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 2.0)
      .to('.ii-base', { autoAlpha: 0.25, duration: 0.6 }, 2.2)
      // EV pill tumbles in and lands
      .fromTo('.ii-ev', { y: -70, rotation: -160, autoAlpha: 0, svgOrigin: `${LAYOUT.pill.x + LAYOUT.pill.w / 2} ${LAYOUT.pill.y + LAYOUT.pill.h / 2}` }, { y: 0, rotation: 0, autoAlpha: 1, duration: 0.75, ease: 'back.out(1.4)' }, 2.45)
      .fromTo('.ii-reflect', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 2.2)
      // specular sweep
      .fromTo('.ii-sweep', { attr: { x: -160 } }, { attr: { x: LAYOUT.total + 40 }, duration: 1.0, ease: 'power2.inOut' }, 3.0)
      .fromTo('.ii-flare', { xPercent: -60, autoAlpha: 0 }, { xPercent: 60, autoAlpha: 1, duration: 1.0, ease: 'power2.inOut' }, 3.0)
      .to('.ii-flare', { autoAlpha: 0, duration: 0.3 }, 3.75)
      // tagline: letters condense from wide tracking
      .fromTo('.ii-tag .c', { autoAlpha: 0, x: (i: number) => (i - TAGLINE.length / 2) * 6, filter: 'blur(6px)' }, { autoAlpha: 1, x: 0, filter: 'blur(0px)', duration: 0.9, stagger: 0.015, ease: 'expo.out' }, 3.15)
      // exit: collapse to a point, iris opens onto the hero
      .to('.ii-stage', { scale: 0.04, autoAlpha: 0, duration: 0.55, ease: 'power3.in' }, 4.25)
      .to('.ii-tag, .ii-loading', { autoAlpha: 0, y: 10, duration: 0.3 }, 4.2)
      .fromTo('.ii-dot', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'power2.out' }, 4.6)
      .call(() => el.classList.add('is-iris'), undefined, 4.74)
      .fromTo(el, { '--iris': '0px' }, { '--iris': '150vmax', duration: 0.85, ease: 'power3.in' }, 4.75)
      .to('.ii-dot', { scale: 6, autoAlpha: 0, duration: 0.6, ease: 'power2.in' }, 4.75)
      .to('.ii-skip', { autoAlpha: 0, duration: 0.3 }, 4.75);
    tlRef.current = tl;

    const skip = () => {
      if (finished) return;
      tl.pause();
      gsap.to(el, { autoAlpha: 0, duration: 0.35, ease: 'power2.out', onComplete: finish });
    };
    (el as HTMLDivElement & { __skip?: () => void }).__skip = skip;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && skip();
    window.addEventListener('keydown', onKey);
    // never hold the site hostage: on a slow device the intro is cut short after 8 s
    const safety = window.setTimeout(skip, 8000);
    return () => {
      window.clearTimeout(safety);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SCENE_PROGRESS, onProgress);
      tl.kill();
      if (!finished) html.classList.remove('intro-active');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = () => (root.current as (HTMLDivElement & { __skip?: () => void }) | null)?.__skip?.();
  const W = LAYOUT.total;

  return (
    <div className="intro" ref={root} role="dialog" aria-modal="true" aria-label="GREEN PLUG EV introduction">
      <div className="ii-atmos" aria-hidden="true" />
      <div className="ii-stage">
        <svg className="ii-logo" viewBox={`-10 -6 ${W + 20} 118`} aria-hidden="true">
          <defs>
            <linearGradient id="ii-comet-g" x1="0" x2="1">
              <stop offset="0" stopColor="#DAF1DE" stopOpacity="0" />
              <stop offset="1" stopColor="#ffffff" />
            </linearGradient>
            <linearGradient id="ii-sweep-g" x1="0" x2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ii-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
              <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="ii-reflect-mask" maskUnits="userSpaceOnUse" x="-10" y="46" width={W + 20} height="60">
              <rect x="-10" y="46" width={W + 20} height="60" fill="url(#ii-fade)" />
            </mask>
            <clipPath id="ii-above">
              <rect x="-10" y="-20" width={W + 20} height={LAYOUT.baseline + 20.6} />
            </clipPath>
            <clipPath id="ii-shapes">
              {WORD.map((g, i) => (
                <path key={i} d={g.d} transform={`translate(${LAYOUT.wordX} ${LAYOUT.baseline})`} />
              ))}
              <path d={MARK.plug} />
              <rect x={LAYOUT.pill.x} y={LAYOUT.pill.y} width={LAYOUT.pill.w} height={LAYOUT.pill.h} rx={LAYOUT.pill.h / 2} />
            </clipPath>
            <filter id="ii-blur" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
          <g id="ii-main">
            <g className="ii-glow" filter="url(#ii-blur)" opacity="0.55">
              {WORD.map((g, i) => (
                <path key={i} d={g.d} transform={`translate(${LAYOUT.wordX} ${LAYOUT.baseline})`} fill="#8EB69B" />
              ))}
            </g>
            <g className="ii-mark">
              <path className="ii-arc" d={MARK.arc} pathLength={1} strokeDasharray="1 1" fill="none" stroke="#DAF1DE" strokeWidth={ARC_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
              <path className="ii-comet" d={MARK.arc} pathLength={1} strokeDasharray="0.12 1.2" fill="none" stroke="url(#ii-comet-g)" strokeWidth={ARC_WIDTH + 3} strokeLinecap="round" />
              <g className="ii-plug">
                <path d={MARK.plug} fill="#8EB69B" />
                <path d={MARK.prongs} fill="#8EB69B" />
              </g>
              <path className="ii-spark" d={MARK.spark} fill="#DAF1DE" />
            </g>
            <g clipPath="url(#ii-above)">
              <g transform={`translate(${LAYOUT.wordX} ${LAYOUT.baseline})`}>
                {WORD.map((g, i) => (
                  <path key={i} className="ii-glyph" d={g.d} pathLength={1} strokeDasharray="1 1" fill="#DAF1DE" stroke="#DAF1DE" strokeWidth="0.9" />
                ))}
              </g>
            </g>
            <g className="ii-ev">
              <rect x={LAYOUT.pill.x} y={LAYOUT.pill.y} width={LAYOUT.pill.w} height={LAYOUT.pill.h} rx={LAYOUT.pill.h / 2} fill="#8EB69B" />
              <g transform={`translate(${LAYOUT.evX} ${LAYOUT.evBaseline})`} fill="#051F20">
                {EV.map((g, i) => (
                  <path key={i} d={g.d} />
                ))}
              </g>
            </g>
            <g clipPath="url(#ii-shapes)">
              <rect className="ii-sweep" x="-160" y="-10" width="110" height="80" fill="url(#ii-sweep-g)" transform="skewX(-20)" />
            </g>
          </g>
          <rect className="ii-base" x={LAYOUT.wordX - 6} y={LAYOUT.baseline + 0.6} width={LAYOUT.wordW + 12} height="1.2" fill="#8EB69B" />
          <g className="ii-reflect" mask="url(#ii-reflect-mask)">
            <use href="#ii-main" transform={`matrix(1 0 0 -1 0 ${2 * LAYOUT.baseline + 3})`} />
          </g>
        </svg>
        <span className="ii-flare" aria-hidden="true" />
      </div>
      <p className="ii-tag" aria-hidden="true">
        {TAGLINE.split('').map((c, i) => (
          <span className="c" key={i}>
            {c === ' ' ? ' ' : c}
          </span>
        ))}
      </p>
      <span className="ii-dot" aria-hidden="true" />
      <p className="ii-loading" aria-live="off">
        {progress > 0 && progress < 100 ? `Preparing the 3D scene · ${progress}%` : ' '}
      </p>
      <button ref={skipRef} type="button" className="ii-skip" onClick={skip}>
        Skip intro <kbd>Esc</kbd>
      </button>
    </div>
  );
}
