import { useEffect, useRef } from 'react';
import { gsap } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { useTheme } from '../lib/theme';

/** Sun that eclipses into a crescent: the shadow disc slides across while the rays retract. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const svg = useRef<SVGSVGElement>(null);
  const first = useRef(true);
  const dark = theme === 'dark';

  useEffect(() => {
    const s = svg.current;
    if (!s) return;
    const rays = s.querySelectorAll('.tt-ray');
    const rayGroup = s.querySelector('.tt-rays');
    const shade = s.querySelector('.tt-shade');
    const core = s.querySelector('.tt-core');
    const vars = dark
      ? { rays: { scale: 0, opacity: 0 }, shade: { x: 0, y: 0 }, core: { scale: 1.25 }, spin: -90 }
      : { rays: { scale: 1, opacity: 1 }, shade: { x: 9, y: -9 }, core: { scale: 1 }, spin: 0 };
    const d = first.current || prefersReducedMotion() ? 0 : 0.7;
    first.current = false;
    gsap.to(rays, { ...vars.rays, duration: d, stagger: d ? 0.03 : 0, ease: 'back.inOut(1.6)', svgOrigin: '12 3.3' });
    gsap.to(rayGroup, { rotation: vars.spin, duration: d, ease: 'power3.inOut', svgOrigin: '12 12' });
    gsap.to(shade, { ...vars.shade, duration: d, ease: 'power3.inOut' });
    gsap.to(core, { ...vars.core, duration: d, ease: 'power3.inOut', svgOrigin: '12 12' });
  }, [dark]);

  return (
    <button
      type="button"
      className="theme-toggle"
      data-magnetic="0.4"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={dark}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      <svg ref={svg} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <mask id="tt-mask">
            <rect width="24" height="24" fill="#fff" />
            <circle className="tt-shade" cx="16" cy="8" r="5.6" fill="#000" />
          </mask>
        </defs>
        <circle className="tt-core" cx="12" cy="12" r="5" mask="url(#tt-mask)" fill="currentColor" />
        <g className="tt-rays">
          {Array.from({ length: 8 }, (_, i) => (
            <g key={i} transform={`rotate(${i * 45} 12 12)`}>
              <line className="tt-ray" x1="12" y1="2.2" x2="12" y2="4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </g>
          ))}
        </g>
      </svg>
    </button>
  );
}
