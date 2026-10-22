import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Footer } from './components/Footer';
import { Intro, shouldPlayIntro } from './components/Intro';
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
};

export function App() {
  const [intro, setIntro] = useState(shouldPlayIntro);
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
        {intro && <Intro onDone={() => setIntro(false)} />}
      </RouterProvider>
    </ThemeProvider>
  );
}
