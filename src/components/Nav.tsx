import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { navItems } from '../config/site';
import { gsap, ScrollTrigger } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { Link, useLocation } from '../lib/router';
import { ButtonLink } from './Button';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const notes: Record<string, string> = {
  '/': 'The story',
  '/how-it-works': 'Four steps',
  '/drivers': 'Cars and bikes',
  '/hosts': 'Share a charger',
  '/safety': 'Principles',
  '/faq': 'Answers',
  '/contact': 'Early access',
};

export function Nav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const beamRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const wasOpen = useRef(false);

  // energy beam under the hovered / current link
  const moveBeam = useCallback((el: HTMLElement | null, instant = false) => {
    const beam = beamRef.current;
    if (!beam) return;
    if (!el) return void gsap.to(beam, { autoAlpha: 0, duration: 0.3 });
    const vars = { x: el.offsetLeft + 12, width: el.offsetWidth - 24, autoAlpha: 1 };
    if (instant || prefersReducedMotion()) gsap.set(beam, vars);
    else gsap.to(beam, { ...vars, duration: 0.6, ease: 'expo.out' });
  }, []);
  const current = useCallback(() => listRef.current?.querySelector<HTMLElement>('a[aria-current="page"]') ?? null, []);

  useLayoutEffect(() => {
    moveBeam(current(), true);
    const onResize = () => moveBeam(current(), true);
    window.addEventListener('resize', onResize);
    document.fonts?.ready.then(onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pathname, moveBeam, current]);

  // compact capsule after the first scroll, hide while scrolling down, return on scroll up
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    gsap.set(nav, { yPercent: 0 });
    const st = ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        const y = self.scroll();
        nav.classList.toggle('is-compact', y > 40);
        const hide = self.direction === 1 && y > 320;
        gsap.to(nav, { yPercent: hide ? -150 : 0, duration: 0.55, ease: 'power3.out', overwrite: true });
      },
    });
    return () => st.kill();
  }, [pathname]);

  // mobile menu: shutter slats close in, numbered links rise through masks
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const tl = gsap.timeline({ paused: true });
    tl.set(menu, { visibility: 'visible' })
      .fromTo(menu.querySelectorAll('.slat'), { scaleY: 0 }, { scaleY: 1, duration: 0.55, stagger: 0.05, ease: 'power4.inOut' })
      .fromTo(menu.querySelectorAll('.menu-link-inner'), { yPercent: 120 }, { yPercent: 0, duration: 0.75, stagger: 0.045, ease: 'expo.out' }, '-=0.2')
      .fromTo(menu.querySelector('.menu-foot'), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.5 }, '-=0.5');
    tlRef.current = tl;
    return () => {
      tl.kill();
    };
  }, []);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    const html = document.documentElement;
    if (open) {
      wasOpen.current = true;
      if (prefersReducedMotion()) tl.progress(1);
      else tl.timeScale(1).play();
      html.classList.add('menu-open');
      requestAnimationFrame(() => menuRef.current?.querySelector('a')?.focus());
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setOpen(false);
          btnRef.current?.focus();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (prefersReducedMotion()) tl.progress(0);
    else tl.timeScale(1.7).reverse();
    html.classList.remove('menu-open');
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <header className="nav" ref={navRef} data-open={open || undefined}>
        <nav className="nav-inner" aria-label="Main">
          <Link to="/" className="nav-logo" aria-label="GREEN PLUG EV home">
            <Logo decorative />
          </Link>
          <ul className="nav-links" ref={listRef} onMouseLeave={() => moveBeam(current())}>
            {navItems.map((item) => (
              <li key={item.to}>
                <Link to={item.to} aria-current={pathname === item.to ? 'page' : undefined} onMouseEnter={(e) => moveBeam(e.currentTarget)} onFocus={(e) => moveBeam(e.currentTarget)}>
                  {item.short ?? item.label}
                </Link>
              </li>
            ))}
            <span className="nav-beam" ref={beamRef} aria-hidden="true" />
          </ul>
          <div className="nav-actions">
            <ThemeToggle />
            <ButtonLink to="/contact?form=driver" size="sm" className="nav-cta">
              Early access
            </ButtonLink>
            <button ref={btnRef} type="button" className="menu-btn" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
              <span />
              <span />
            </button>
          </div>
        </nav>
      </header>
      <div className="mobile-menu" id="mobile-menu" ref={menuRef} aria-hidden={!open} inert={!open ? true : undefined}>
        <div className="slats" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span className="slat" key={i} />
          ))}
        </div>
        <ul className="menu-list">
          {[{ to: '/', label: 'Home' }, ...navItems].map((item, i) => (
            <li key={item.to}>
              <Link to={item.to} onClick={() => setOpen(false)} aria-current={pathname === item.to ? 'page' : undefined}>
                <span className="menu-link-inner">
                  <em>{String(i + 1).padStart(2, '0')}</em>
                  {item.label}
                  <small>{notes[item.to]}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="menu-foot">
          <ButtonLink to="/contact?form=driver" icon="arrow-right">
            Join early access
          </ButtonLink>
          <p>GREEN PLUG EV is a planned app. Nothing on this website is a live charging service yet.</p>
        </div>
      </div>
    </>
  );
}
