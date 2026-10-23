// Desktop pointer system: a glossy bead cursor, a soft mint light, a short fading light
// trail, magnetic controls, 3D card tilt and pointer-tracked reflections ([data-gloss]).
// Event delegation means new pages need no re-binding. Off for touch/coarse pointers,
// reduced motion, or when the visitor switches it off in the footer; the native cursor
// is only hidden once the custom one is running, so a failure leaves the normal cursor.
import { useEffect, useRef } from 'react';
import { gsap } from '../lib/gsap';
import { hasFinePointer, useRichPointer } from '../lib/prefs';

const INTERACTIVE = 'a, button, [role="button"], [role="tab"], label, summary, select, .choice';
const TEXT = 'input:not([type="checkbox"]):not([type="radio"]), textarea';
const TRAIL = 14;

export function PointerSystem() {
  const rich = useRichPointer();
  const bead = useRef<HTMLDivElement>(null);
  const light = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLCanvasElement>(null);

  // Reflections follow any fine pointer, even with the custom cursor off: they only move a highlight.
  useEffect(() => {
    if (!hasFinePointer()) return;
    let raf = 0;
    let last: PointerEvent | null = null;
    let lit: HTMLElement | null = null;
    const apply = () => {
      raf = 0;
      if (!last) return;
      const el = (last.target as Element | null)?.closest?.('[data-gloss]') as HTMLElement | null;
      if (el !== lit) {
        lit?.style.setProperty('--gloss', '0');
        lit = el;
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(last.clientX - r.left).toFixed(1)}px`);
      el.style.setProperty('--my', `${(last.clientY - r.top).toFixed(1)}px`);
      el.style.setProperty('--gloss', '1');
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
      lit?.style.setProperty('--gloss', '0');
    };
  }, []);

  useEffect(() => {
    if (!rich || !bead.current || !light.current || !trail.current) return;
    const root = document.documentElement;
    const B = bead.current;
    const L = light.current;
    const C = trail.current;
    const g = C.getContext('2d');
    if (!g) return;
    root.classList.add('has-cursor');

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      C.width = window.innerWidth * dpr;
      C.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const bx = gsap.quickTo(B, 'x', { duration: 0.12, ease: 'power3' });
    const by = gsap.quickTo(B, 'y', { duration: 0.12, ease: 'power3' });
    const lx = gsap.quickTo(L, 'x', { duration: 0.9, ease: 'power2' });
    const ly = gsap.quickTo(L, 'y', { duration: 0.9, ease: 'power2' });
    const pts: { x: number; y: number }[] = [];
    const head = { x: -100, y: -100 };
    const pos = { x: -100, y: -100 };
    let visible = false;
    let state: 'none' | 'link' | 'text' = 'none';
    let pressed = false;
    let idle = 0;

    // trail: a short ribbon chasing the pointer, drawn only while it moves
    const tick = () => {
      head.x += (pos.x - head.x) * 0.38;
      head.y += (pos.y - head.y) * 0.38;
      pts.unshift({ x: head.x, y: head.y });
      if (pts.length > TRAIL) pts.pop();
      const moving = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) > 0.6;
      idle = moving ? 0 : idle + 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, C.width, C.height);
      if (!visible || idle > 2 || state === 'text') return;
      const dark = root.getAttribute('data-theme') === 'dark';
      g.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        // a jump (e.g. pointer re-entering the window) would draw a long straight streak: skip it
        if (Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y) > 90) continue;
        const k = 1 - i / pts.length;
        g.strokeStyle = dark ? `rgba(218,241,222,${0.55 * k})` : `rgba(35,83,71,${0.42 * k})`;
        g.lineWidth = 5 * k + 0.5;
        g.beginPath();
        g.moveTo(pts[i - 1].x, pts[i - 1].y);
        g.lineTo(pts[i].x, pts[i].y);
        g.stroke();
      }
    };
    gsap.ticker.add(tick);

    const show = (x: number, y: number) => {
      gsap.set([B, L], { x, y });
      head.x = x;
      head.y = y;
      gsap.to(B, { autoAlpha: 1, duration: 0.25 });
      gsap.to(L, { autoAlpha: 1, duration: 0.6 });
      visible = true;
    };
    const hide = () => {
      gsap.to([B, L], { autoAlpha: 0, duration: 0.25 });
      visible = false;
    };
    const restyle = () => {
      const s = state === 'link' ? 2.3 : state === 'text' ? 0.35 : 1;
      gsap.to(B, { scale: pressed ? s * 0.72 : s, duration: 0.45, ease: 'expo.out' });
      B.dataset.state = state;
      gsap.to(L, { scale: state === 'link' ? 1.25 : 1, duration: 0.8, ease: 'power2.out' });
    };

    // magnetic controls
    let mag: HTMLElement | null = null;
    const magQ = new WeakMap<HTMLElement, ((v: number) => void)[]>();
    const release = (el: HTMLElement) => {
      const inner = el.querySelector('[data-magnetic-inner]');
      gsap.to(inner ? [el, inner] : el, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.4)', overwrite: true });
      magQ.delete(el);
    };
    // tilt cards
    let tilt: HTMLElement | null = null;
    const tiltQ = new WeakMap<HTMLElement, ((v: number) => void)[]>();
    const releaseTilt = (el: HTMLElement) => {
      gsap.to(el, { rotationX: 0, rotationY: 0, duration: 0.9, ease: 'power3.out', overwrite: true });
      tiltQ.delete(el);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const { clientX: x, clientY: y } = e;
      if (!visible) show(x, y);
      pos.x = x;
      pos.y = y;
      bx(x);
      by(y);
      lx(x);
      ly(y);
      const target = e.target as Element;

      const m = target.closest?.('[data-magnetic]') as HTMLElement | null;
      if (m !== mag) {
        if (mag) release(mag);
        mag = m;
      }
      if (m) {
        const r = m.getBoundingClientRect();
        const cx = r.left - (gsap.getProperty(m, 'x') as number) + r.width / 2;
        const cy = r.top - (gsap.getProperty(m, 'y') as number) + r.height / 2;
        const s = parseFloat(m.dataset.magnetic || '0.3');
        let q = magQ.get(m);
        if (!q) {
          const inner = m.querySelector<HTMLElement>('[data-magnetic-inner]');
          q = [gsap.quickTo(m, 'x', { duration: 0.5, ease: 'power3' }), gsap.quickTo(m, 'y', { duration: 0.5, ease: 'power3' })];
          if (inner) q.push(gsap.quickTo(inner, 'x', { duration: 0.5, ease: 'power3' }), gsap.quickTo(inner, 'y', { duration: 0.5, ease: 'power3' }));
          magQ.set(m, q);
        }
        q[0]((x - cx) * s);
        q[1]((y - cy) * s);
        q[2]?.((x - cx) * s * 0.4);
        q[3]?.((y - cy) * s * 0.4);
      }

      const t = target.closest?.('[data-tilt]') as HTMLElement | null;
      if (t !== tilt) {
        if (tilt) releaseTilt(tilt);
        tilt = t;
        if (t) gsap.set(t, { transformPerspective: 1100 });
      }
      if (t) {
        const r = t.getBoundingClientRect();
        const max = parseFloat(t.dataset.tilt || '6');
        let q = tiltQ.get(t);
        if (!q) {
          q = [gsap.quickTo(t, 'rotationX', { duration: 0.7, ease: 'power3' }), gsap.quickTo(t, 'rotationY', { duration: 0.7, ease: 'power3' })];
          tiltQ.set(t, q);
        }
        q[0](-((y - r.top) / r.height - 0.5) * max * 2);
        q[1](((x - r.left) / r.width - 0.5) * max * 2);
      }
    };
    const onOver = (e: PointerEvent) => {
      const t = e.target as Element;
      const next = t.closest?.(TEXT) ? 'text' : t.closest?.(INTERACTIVE) ? 'link' : 'none';
      if (next !== state) {
        state = next;
        restyle();
      }
    };
    const onDown = () => {
      pressed = true;
      restyle();
    };
    const onUp = () => {
      pressed = false;
      restyle();
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerover', onOver, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('blur', hide);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', hide);
      root.classList.remove('has-cursor');
      if (mag) release(mag);
      if (tilt) releaseTilt(tilt);
      gsap.killTweensOf([B, L]);
    };
  }, [rich]);

  if (!rich) return null;
  return (
    <>
      <div className="cursor-light" ref={light} aria-hidden="true" />
      <canvas className="cursor-trail" ref={trail} aria-hidden="true" />
      <div className="cursor-bead" ref={bead} aria-hidden="true">
        <span />
      </div>
    </>
  );
}
