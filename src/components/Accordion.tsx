import { useId, useRef, useState, type ReactNode } from 'react';
import { gsap } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';

export type AccItem = { q: string; a: ReactNode; id?: string };

function Item({ item, open, onToggle }: { item: AccItem; open: boolean; onToggle: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const uid = useId();
  // Height is owned by GSAP after the first render, so React never fights the tween.
  const initStyle = useRef({ height: open ? 'auto' : 0 });
  const toggle = () => {
    const el = panel.current;
    if (el) {
      const d = prefersReducedMotion() ? 0 : 0.6;
      if (open) gsap.to(el, { height: 0, duration: d, ease: 'expo.out' });
      else gsap.fromTo(el, { height: 0 }, { height: 'auto', duration: d, ease: 'expo.out' });
      const inner = el.firstElementChild;
      if (!open && inner && d) gsap.fromTo(inner, { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, delay: 0.08, ease: 'expo.out' });
    }
    onToggle();
  };
  return (
    <div className="acc-item" data-open={open} id={item.id}>
      <h3>
        <button type="button" className="acc-trigger" aria-expanded={open} aria-controls={`${uid}-p`} id={`${uid}-b`} onClick={toggle}>
          <span>{item.q}</span>
          <span className="acc-icon" aria-hidden="true" />
        </button>
      </h3>
      <div className="acc-panel" id={`${uid}-p`} role="region" aria-labelledby={`${uid}-b`} ref={panel} inert={!open ? true : undefined} style={initStyle.current}>
        <div className="acc-panel-inner">{item.a}</div>
      </div>
    </div>
  );
}

export function Accordion({ items, initial = -1 }: { items: AccItem[]; initial?: number }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(initial >= 0 ? [initial] : []));
  return (
    <div className="acc">
      {items.map((item, i) => (
        <Item
          key={item.q}
          item={item}
          open={open.has(i)}
          onToggle={() =>
            setOpen((prev) => {
              const next = new Set(prev);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}
