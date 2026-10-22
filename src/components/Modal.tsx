import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { Icon } from './Icon';

/** Glossy modal: backdrop blur, card rises with a slight 3D tilt; focus is trapped and restored. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !root.current || !card.current) return;
    lastFocus.current = document.activeElement as HTMLElement;
    if (!prefersReducedMotion()) {
      gsap.fromTo(root.current.querySelector('.modal-backdrop'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 });
      gsap.fromTo(card.current, { y: 60, scale: 0.94, rotateX: 14, autoAlpha: 0, transformPerspective: 1000 }, { y: 0, scale: 1, rotateX: 0, autoAlpha: 1, duration: 0.8, ease: 'expo.out' });
    }
    const first = card.current.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      lastFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab' && card.current) {
        const f = Array.from(card.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not(.hp input), select, textarea')).filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const firstEl = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const close = () => {
    if (prefersReducedMotion() || !card.current) return onClose();
    gsap.to(card.current, { y: 40, scale: 0.96, autoAlpha: 0, duration: 0.35, ease: 'power2.in' });
    gsap.to(root.current!.querySelector('.modal-backdrop'), { autoAlpha: 0, duration: 0.35, onComplete: onClose });
  };

  if (!open) return null;
  return createPortal(
    <div className="modal-root" ref={root}>
      <div className="modal-backdrop" onClick={close} />
      <div className="modal gloss" ref={card} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button type="button" className="icon-btn modal-close" onClick={close} aria-label="Close">
          <Icon name="x" />
        </button>
        <h2 id="modal-title" className="h3" style={{ marginBottom: 8, paddingRight: 48 }}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
