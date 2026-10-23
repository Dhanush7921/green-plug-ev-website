// The home page's cinematic run: one sticky WebGL stage that the hero and three story chapters
// scroll over. Scroll progress drives the camera (hero → scooter side → energy → discovery city).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ButtonLink } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { INTRO_DONE, introActive, SCENE_PROGRESS } from '../../components/Intro';
import { modelUrl, site } from '../../config/site';
import { gsap, ScrollTrigger, useGSAP } from '../../lib/gsap';
import { hasFinePointer, prefersReducedMotion, useReducedMotion } from '../../lib/prefs';
import { currentTheme, THEME_EVENT, type Theme } from '../../lib/theme';
import { kineticHeading } from '../../motion/kinetic';
import type { AnchorMap, ChargingScene, ConnectionStep, PinFilter } from '../../three/ChargingScene';
import { SceneFallback } from './SceneFallback';

type Mode = 'loading' | '3d' | 'fallback';

// Background video behind the hero sky: an unchanged, self-hosted copy of the supplied MP4, with the supplied URL as a second source.
const BG_VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260815_032550_0386fe58-a20f-497e-bb07-d1266749cc01.mp4';
const BG_VIDEO_LOCAL = `${site.base}media/background.mp4`;
const BG_POSTER = `${site.base}media/background-poster.jpg`;

const STEPS: { id: ConnectionStep; label: string }[] = [
  { id: 'opening', label: 'Inlet door opens' },
  { id: 'aligning', label: 'Connector aligns' },
  { id: 'inserting', label: 'Plug seats' },
  { id: 'locked', label: 'Latched' },
  { id: 'charging', label: 'Charging' },
];
const ORDER: ConnectionStep[] = ['ready', 'opening', 'aligning', 'inserting', 'locked', 'charging'];

const ANCHORS: { id: string; icon: IconName; text: string; chapter: 'hero' | 'bike' | 'city'; kinds?: PinFilter[] }[] = [
  { id: 'port', icon: 'plug-zap', text: 'CCS2 inlet', chapter: 'hero' },
  { id: 'charger', icon: 'zap', text: 'DC charger (example)', chapter: 'hero' },
  { id: 'scooter', icon: 'scooter', text: 'Scooter on a 15A socket', chapter: 'bike' },
  { id: 'pin0', icon: 'map-pin', text: 'Public DC · example', chapter: 'city', kinds: ['all', 'car'] },
  { id: 'pin1', icon: 'map-pin', text: 'Bike socket · example', chapter: 'city', kinds: ['all', 'bike'] },
  { id: 'pin2', icon: 'map-pin', text: 'Home host, AC · example', chapter: 'city', kinds: ['all', 'car'] },
];

export function Cinema() {
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ChargingScene | null>(null);
  const anchorEls = useRef<Record<string, HTMLElement | null>>({});
  const hud = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('loading');
  const [loadPct, setLoadPct] = useState(0);
  const [filter, setFilter] = useState<PinFilter>('all');
  const [chapter, setChapter] = useState<'hero' | 'bike' | 'energy' | 'city'>('hero');
  const reduced = useReducedMotion();
  const [introDone, setIntroDone] = useState(() => !introActive());

  useEffect(() => {
    if (introDone) return;
    const on = () => setIntroDone(true);
    window.addEventListener(INTRO_DONE, on);
    return () => window.removeEventListener(INTRO_DONE, on);
  }, [introDone]);

  // ---- 3D scene lifecycle ----
  useEffect(() => {
    let disposed = false;
    let scene: ChargingScene | null = null;
    const cleanups: (() => void)[] = [];
    const canvas = canvasRef.current;
    if (!canvas) return;
    import('../../three/ChargingScene')
      .then(async (mod) => {
        if (disposed) return;
        if (!mod.webglAvailable() || new URLSearchParams(location.search).has('nowebgl')) return setMode('fallback');
        const nav = navigator as Navigator & { deviceMemory?: number };
        const low = matchMedia('(pointer: coarse)').matches || window.innerWidth < 820 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
        try {
          scene = new mod.ChargingScene({ canvas, quality: low ? 'low' : 'high', theme: currentTheme(), reducedMotion: prefersReducedMotion(), modelUrl, useModel: true });
        } catch (err) {
          console.warn('[GREEN PLUG EV] 3D unavailable, showing the illustration instead.', err);
          return setMode('fallback');
        }
        const s = scene;
        sceneRef.current = s;
        (window as unknown as { __scene?: ChargingScene }).__scene = s;
        s.resize(canvas.clientWidth, canvas.clientHeight);
        await s.init((p) => {
          setLoadPct(Math.round(p * 100));
          window.dispatchEvent(new CustomEvent(SCENE_PROGRESS, { detail: p }));
        });
        if (disposed) return;
        window.dispatchEvent(new CustomEvent(SCENE_PROGRESS, { detail: 1 }));
        canvas.dataset.car = s.realisticCar ? 'model' : 'procedural';

        const chipBox = new WeakMap<HTMLElement, number>();
        s.onAnchors = (a: AnchorMap) => {
          const vw = canvas.clientWidth;
          for (const [id, p] of Object.entries(a)) {
            const el = anchorEls.current[id];
            if (!el) continue;
            el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
            el.dataset.offscreen = p.visible && p.x > -40 && p.x < vw + 40 ? '' : '1';
            const chip = el.querySelector<HTMLElement>('.anchor-chip');
            if (!chip) continue;
            let w = chipBox.get(chip);
            if (!w) chipBox.set(chip, (w = chip.offsetWidth));
            const left = p.x - w / 2;
            const shift = left < 12 ? 12 - left : left + w > vw - 12 ? vw - 12 - (left + w) : 0;
            chip.style.translate = `${shift.toFixed(1)}px 0`;
          }
        };
        let lastStep = '';
        s.onStatus = (step, pct) => {
          const h = hud.current;
          if (!h) return;
          if (step !== lastStep) {
            lastStep = step;
            h.dataset.step = step;
            const idx = ORDER.indexOf(step);
            h.querySelectorAll<HTMLElement>('[data-s]').forEach((li) => {
              const i = ORDER.indexOf(li.dataset.s as ConnectionStep);
              li.dataset.state = i < idx ? 'done' : i === idx ? 'now' : '';
            });
            const live = h.querySelector('.hud-live');
            if (live) live.textContent = step === 'ready' ? 'Ready' : STEPS.find((x) => x.id === step)?.label ?? '';
          }
          const pctEl = h.querySelector('.hud-pct');
          if (pctEl) pctEl.textContent = step === 'charging' ? `${Math.round(pct)}%` : '—';
          h.style.setProperty('--level', String(step === 'charging' ? pct / 100 : 0));
        };
        s.onContextLost = () => setMode('fallback');

        const ro = new ResizeObserver(() => s.resize(canvas.clientWidth, canvas.clientHeight));
        ro.observe(canvas);
        cleanups.push(() => ro.disconnect());

        // render only while the stage is on screen and the tab is visible
        let inView = true;
        const sync = () => (inView && !document.hidden && !prefersReducedMotion() ? s.start() : s.stop());
        const io = new IntersectionObserver(([e]) => {
          inView = e.isIntersecting;
          sync();
        });
        io.observe(root.current!);
        document.addEventListener('visibilitychange', sync);
        cleanups.push(() => {
          io.disconnect();
          document.removeEventListener('visibilitychange', sync);
        });

        const onTheme = (e: Event) => s.setTheme((e as CustomEvent<Theme>).detail);
        window.addEventListener(THEME_EVENT, onTheme);
        cleanups.push(() => window.removeEventListener(THEME_EVENT, onTheme));

        if (hasFinePointer() && !prefersReducedMotion()) {
          const onMove = (e: PointerEvent) => s.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
          window.addEventListener('pointermove', onMove, { passive: true });
          cleanups.push(() => window.removeEventListener('pointermove', onMove));
        }
        setMode('3d');
        if (prefersReducedMotion()) s.render();
        else s.start();
      })
      .catch((err) => {
        console.warn('[GREEN PLUG EV] Could not load the 3D scene.', err);
        if (!disposed) setMode('fallback');
      });
    return () => {
      disposed = true;
      cleanups.forEach((c) => c());
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => sceneRef.current?.setPinFilter(filter), [filter]);

  // ---- background video: muted, plays only while the stage is visible; still poster for reduced motion,
  // blocked autoplay or slow loading; hidden entirely (sky gradient shows) if it fails to load ----
  const bgVideo = useRef<HTMLVideoElement>(null);
  const [bgFailed, setBgFailed] = useState(false);
  useEffect(() => {
    const v = bgVideo.current;
    if (!v || reduced || bgFailed) {
      v?.pause();
      return;
    }
    v.muted = true;
    let visible = true;
    const sync = () => {
      if (visible && !document.hidden) v.play().catch(() => v.pause());
      else v.pause();
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      sync();
    });
    io.observe(v);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      v.pause();
    };
  }, [reduced, bgFailed]);

  // ---- the connection plays once the scene is ready and the intro has handed over ----
  useEffect(() => {
    const s = sceneRef.current;
    if (mode !== '3d' || !introDone || !s || prefersReducedMotion()) return;
    s.playEstablishing();
    const call = gsap.delayedCall(1.1, () => {
      if (window.scrollY < window.innerHeight * 0.4) s.playConnection(true);
      else s.playConnection(false);
    });
    return () => void call.kill();
  }, [mode, introDone]);

  // ---- hero copy entrance ----
  useGSAP(
    () => {
      if (!introDone || prefersReducedMotion()) return;
      const title = root.current?.querySelector<HTMLElement>('.hero-title');
      if (title) kineticHeading(title, { delay: 0.15, scroll: false });
      gsap.from('.hero-copy .kicker, .hero-lede, .hero-actions > *, .hero-status', { y: 30, autoAlpha: 0, rotationX: -25, transformPerspective: 700, transformOrigin: '50% 0%', duration: 1.1, stagger: 0.08, ease: 'expo.out', delay: 0.6 });
      gsap.from('.hud', { x: 40, autoAlpha: 0, duration: 1.1, ease: 'expo.out', delay: 1.0 });
    },
    [introDone],
    root,
  );

  // anchors pop in with the scene
  useGSAP(
    () => {
      if (mode !== '3d' || !introDone || prefersReducedMotion()) return;
      gsap.from('.anchor[data-chapter="hero"] .anchor-chip', { scale: 0.4, autoAlpha: 0, duration: 0.8, stagger: 0.15, ease: 'back.out(2)', delay: 2.2 });
    },
    [mode, introDone],
    root,
  );

  // ---- scroll story ----
  useGSAP(
    () => {
      if (mode !== '3d' || reduced) return;
      const s = sceneRef.current;
      if (!s) return;
      const st = ScrollTrigger.create({
        trigger: '.cine-track',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.6,
        onUpdate: (self) => {
          const p = self.progress;
          s.setScroll(p);
          root.current?.style.setProperty('--story', p.toFixed(3));
          const ch = p < 0.18 ? 'hero' : p < 0.5 ? 'bike' : p < 0.8 ? 'energy' : 'city';
          setChapter((c) => (c === ch ? c : ch));
        },
      });
      // chapter cards: slide out of depth, energy trail draws alongside
      gsap.utils.toArray<HTMLElement>('.chapter-card').forEach((card) => {
        gsap.fromTo(card, { z: -240, rotationY: -14, autoAlpha: 0, transformPerspective: 1000 }, { z: 0, rotationY: 0, autoAlpha: 1, ease: 'power2.out', scrollTrigger: { trigger: card, start: 'top 92%', end: 'top 50%', scrub: 0.8 } });
        // the last card (with the filter) stays put while the city builds
        if (card.closest('[data-ch="city"]')) return;
        gsap.to(card, { autoAlpha: 0, y: -60, ease: 'power1.in', scrollTrigger: { trigger: card, start: 'bottom 40%', end: 'bottom 5%', scrub: 0.8 } });
      });
      gsap.fromTo('.energy-trail path', { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.cine-track', start: 'top top', end: 'bottom bottom', scrub: 0.4 } });
      gsap.to('.hero-copy, .hud', { autoAlpha: 0, y: -80, ease: 'power1.in', scrollTrigger: { trigger: '.cine-hero', start: 'top top', end: '70% top', scrub: 0.5 } });
      return () => st.kill();
    },
    [mode, reduced],
    root,
  );

  const replay = () => {
    const s = sceneRef.current;
    if (!s) return;
    if (window.scrollY > 40) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (prefersReducedMotion()) return;
    s.replayConnection();
  };

  return (
    <section className="cine" ref={root} data-mode={mode} data-chapter={chapter} aria-label="GREEN PLUG EV charging story">
      <div className="cine-stage">
        <div className="cine-sky" aria-hidden="true">
          {!bgFailed && (
            <video ref={bgVideo} className="cine-bg-video" muted loop playsInline preload={reduced ? 'none' : 'auto'} poster={BG_POSTER} tabIndex={-1} disablePictureInPicture>
              <source src={BG_VIDEO_LOCAL} type="video/mp4" />
              <source src={BG_VIDEO_URL} type="video/mp4" onError={() => setBgFailed(true)} />
            </video>
          )}
        </div>
        <canvas ref={canvasRef} className="cine-canvas" aria-hidden="true" />
        <div className="cine-veil" aria-hidden="true" />
        {mode === 'fallback' && <SceneFallback />}
        {mode === 'loading' && (
          <div className="cine-loading" role="status">
            <span className="cine-loading-ring" style={{ '--p': loadPct / 100 } as CSSProperties} />
            <span>Loading 3D scene{loadPct ? ` · ${loadPct}%` : ''}</span>
          </div>
        )}
        <div className="anchors" aria-hidden="true">
          {ANCHORS.map((a) => (
            <div
              key={a.id}
              className="anchor"
              data-chapter={a.chapter}
              data-active={(a.chapter === 'hero' ? chapter === 'hero' : a.chapter === 'bike' ? chapter === 'bike' : chapter === 'city' && (!a.kinds || a.kinds.includes(filter))) || undefined}
              ref={(el) => {
                anchorEls.current[a.id] = el;
              }}
            >
              <span className="anchor-chip">
                <Icon name={a.icon} />
                {a.text}
              </span>
              <span className="anchor-stem" />
              <span className="anchor-dot" />
            </div>
          ))}
        </div>
        <svg className="energy-trail" viewBox="0 0 40 400" preserveAspectRatio="none" aria-hidden="true">
          <path d="M20 0 C 36 60, 4 120, 20 180 S 36 300, 20 400" pathLength={1} strokeDasharray="1 1" />
        </svg>
      </div>

      <div className="cine-track">
        <div className="cine-hero container">
          <div className="hero-copy">
            <span className="kicker">Planned for Andhra Pradesh</span>
            <h1 className="display hero-title" data-manual>
              Charging, <span className="ink-gradient">found closer.</span>
            </h1>
            <p className="lede hero-lede">
              GREEN PLUG EV is an app in development to help electric car and bike riders find charging that fits their vehicle, from public stations to participating private
              hosts, with clear estimates before they go.
            </p>
            <div className="hero-actions">
              <ButtonLink to="/contact?form=driver" icon="arrow-right" size="lg">
                Join early access
              </ButtonLink>
              <ButtonLink to="/how-it-works" variant="glass" size="lg">
                See how it works
              </ButtonLink>
            </div>
            <p className="hero-status">
              <span className="badge">In development</span> The app is not available yet. No stations or hosts are listed today.
            </p>
          </div>

          <div className="hud glass" ref={hud} data-step="ready" data-gloss>
            <div className="hud-head">
              <span className="badge no-dot">
                <Icon name="activity" /> Simulation
              </span>
              <button type="button" className="hud-replay" onClick={replay} disabled={mode !== '3d'} aria-label="Replay the plug-in animation">
                <Icon name="rotate-ccw" />
                Replay
              </button>
            </div>
            <div className="hud-main">
              <div className="hud-gauge" aria-hidden="true">
                <svg viewBox="0 0 44 44">
                  <circle cx="22" cy="22" r="18" className="hud-track" />
                  <circle cx="22" cy="22" r="18" className="hud-fill" pathLength={1} />
                </svg>
                <span className="hud-pct">—</span>
              </div>
              <div>
                <p className="hud-title">CCS2 · DC connection</p>
                <p className="hud-live" aria-live="polite">
                  Ready
                </p>
              </div>
            </div>
            <ol className="hud-steps" role="list">
              {STEPS.map((s) => (
                <li key={s.id} data-s={s.id}>
                  {s.label}
                </li>
              ))}
            </ol>
          </div>
          <a href="#story" className="scroll-cue">
            <span>Scroll the story</span>
            <Icon name="arrow-down" />
          </a>
        </div>

        <div className="chapter container" id="story" data-ch="bike">
          <article className="chapter-card glass" data-gloss>
            <span className="chapter-no">01</span>
            <h2 className="h2">Cars and bikes, side by side.</h2>
            <p>
              A scooter on a 15A socket and a car on a DC fast charger need very different things. The app is being designed around your vehicle first, so the options you see are ones
              that can actually charge it.
            </p>
            <ul className="chapter-points" role="list">
              <li>
                <Icon name="car" /> Electric cars: Type 2 AC, CCS2 DC and Bharat standards
              </li>
              <li>
                <Icon name="scooter" /> Electric bikes and scooters: portable chargers, sockets and light-EV connectors
              </li>
            </ul>
          </article>
        </div>

        <div className="chapter container" data-ch="energy">
          <article className="chapter-card glass" data-gloss>
            <span className="chapter-no">02</span>
            <h2 className="h2">Know the time and the cost before you plug in.</h2>
            <p>
              Planned estimates show roughly how long a charge could take and what it might cost, based on the charger's power, your vehicle and the host's posted price. Estimates are
              labelled as estimates, always.
            </p>
            <p className="chapter-note">
              <Icon name="info" /> The charging percentage in this scene is a simulation, not a reading from a real charger.
            </p>
          </article>
        </div>

        <div className="chapter container" data-ch="city">
          <article className="chapter-card glass" data-gloss>
            <span className="chapter-no">03</span>
            <h2 className="h2">Then, a map of what fits.</h2>
            <p>Public stations and participating private hosts, filtered for your vehicle. Here is how that filter is meant to feel; the pins below are illustrative, not real locations.</p>
            <div className="seg" role="radiogroup" aria-label="Show example options for">
              {(['all', 'car', 'bike'] as PinFilter[]).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} className="seg-btn" onClick={() => setFilter(f)}>
                  <Icon name={f === 'all' ? 'layers' : f === 'car' ? 'car' : 'scooter'} />
                  {f === 'all' ? 'All' : f === 'car' ? 'Car' : 'Bike'}
                </button>
              ))}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
