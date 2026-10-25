// Cinematic app intro: the glossy GREEN PLUG mark charges up, the wordmark resolves, then an iris opens
// onto the app. ~3.4 s, once per browser session, skippable (button or Esc), never shown with reduced motion.
import { useEffect, useRef } from 'react';
import { Logo } from '../../../../src/components/Logo';
import { gsap } from '../../../../src/lib/gsap';
import { prefersReducedMotion } from '../../../../src/lib/prefs';

const KEY = 'gpev-app-intro';
export function shouldPlayIntro() {
  return document.documentElement.classList.contains('intro-pending') && !prefersReducedMotion();
}

export function Intro({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('intro-pending');
    html.classList.add('intro-active');
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* private mode */
    }
    skip.current?.focus({ preventScroll: true });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      html.classList.remove('intro-active');
      onDone();
    };
    const el = root.current!;
    const tl = gsap.timeline({ onComplete: finish });
    tl.fromTo(el.querySelector('.ai-ring'), { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.9, ease: 'expo.out' }, 0)
      .fromTo(el.querySelector('.ai-mark'), { y: 30, scale: 0.7, autoAlpha: 0, rotateX: 40 }, { y: 0, scale: 1, autoAlpha: 1, rotateX: 0, duration: 1.0, ease: 'back.out(1.6)' }, 0.15)
      .fromTo(el.querySelector('.ai-charge'), { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'power2.inOut' }, 0.5)
      .fromTo(el.querySelector('.ai-sweep'), { xPercent: -140 }, { xPercent: 140, duration: 0.9, ease: 'power2.inOut' }, 1.0)
      .fromTo(el.querySelector('.ai-word'), { y: 18, autoAlpha: 0, filter: 'blur(8px)' }, { y: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out' }, 1.25)
      .fromTo(el.querySelector('.ai-tag'), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 1.7)
      .to(el.querySelector('.ai-stage'), { scale: 0.92, autoAlpha: 0, duration: 0.5, ease: 'power2.in' }, 2.75)
      .fromTo(el, { clipPath: 'circle(150% at 50% 50%)' }, { clipPath: 'circle(0% at 50% 50%)', duration: 0.7, ease: 'power3.inOut' }, 2.9);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (tl.kill(), finish());
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      tl.kill();
      html.classList.remove('intro-active');
    };
  }, [onDone]);

  return (
    <div className="app-intro" ref={root} role="dialog" aria-label="GREEN PLUG EV introduction">
      <div className="ai-atmos" aria-hidden="true" />
      <div className="ai-stage">
        <div className="ai-ring" aria-hidden="true" />
        <div className="ai-mark-wrap">
          <img className="ai-mark" src="/app/brand/mark-glossy.webp" alt="" width={220} height={183} />
          <span className="ai-sweep" aria-hidden="true" />
        </div>
        <div className="ai-word">
          <Logo className="logo ai-logo" />
        </div>
        <div className="ai-charge" aria-hidden="true" />
        <p className="ai-tag">Find a charger. Book the slot. Plug in.</p>
      </div>
      <button ref={skip} type="button" className="ai-skip btn btn-glass btn-sm" onClick={finish}>
        <span className="btn-inner">Skip intro</span>
      </button>
    </div>
  );
  function finish() {
    document.documentElement.classList.remove('intro-active');
    onDone();
  }
}
