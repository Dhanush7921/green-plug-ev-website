import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Footer } from './components/Footer';
import { IntroFilm, REPLAY_INTRO, shouldPlayIntro } from './components/Intro';
import { Nav } from './components/Nav';
import { PointerSystem } from './components/PointerSystem';
import { RouteView } from './components/RouteView';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { RouterProvider } from './lib/router';
import { ThemeProvider } from './lib/theme';

const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return function Lazy() {
    return (
      <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
        <C />
      </Suspense>
    );
  };
};

const routes = {
  '/': Home,
  '/how-it-works': page(() => import('./pages/HowItWorks')),
  '/drivers': page(() => import('./pages/Drivers')),
  '/hosts': page(() => import('./pages/Hosts')),
  '/safety': page(() => import('./pages/Safety')),
  '/faq': page(() => import('./pages/Faq')),
  '/contact': page(() => import('./pages/Contact')),
  '/legal': page(() => import('./pages/Legal')),
};

export function App() {
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [replays, setReplays] = useState(0);
  useEffect(() => {
    const on = () => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      setReplays((n) => n + 1);
      setIntro(true);
    };
    window.addEventListener(REPLAY_INTRO, on);
    return () => window.removeEventListener(REPLAY_INTRO, on);
  }, []);
  return (
    <ThemeProvider>
      <RouterProvider>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Nav />
        <main id="main" tabIndex={-1}>
          <RouteView routes={routes} fallback={NotFound} />
        </main>
        <Footer />
        <PointerSystem />
        {intro && <IntroFilm key={replays} replay={replays > 0} onDone={() => setIntro(false)} />}
      </RouterProvider>
    </ThemeProvider>
  );
}
