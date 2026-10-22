import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { prefersReducedMotion } from './prefs';

export type Theme = 'light' | 'dark';
const KEY = 'gpev-theme';
export const THEME_EVENT = 'gpev:theme';

type Ctx = { theme: Theme; toggle: (origin?: { x: number; y: number }) => void; setTheme: (t: Theme, origin?: { x: number; y: number }) => void };
const ThemeContext = createContext<Ctx | null>(null);

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  const setTheme = useCallback((next: Theme, origin?: { x: number; y: number }) => {
    const root = document.documentElement;
    const apply = () => {
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
      flushSync(() => setThemeState(next));
      window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
    };

    if (document.startViewTransition && !prefersReducedMotion()) {
      const x = origin?.x ?? window.innerWidth - 40;
      const y = origin?.y ?? 40;
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      root.style.setProperty('--vt-x', `${x}px`);
      root.style.setProperty('--vt-y', `${y}px`);
      root.style.setProperty('--vt-r', `${r}px`);
      root.classList.add('vt-theme');
      const t = document.startViewTransition(apply);
      t.finished.finally(() => root.classList.remove('vt-theme'));
    } else {
      root.classList.add('theme-anim');
      apply();
      window.setTimeout(() => root.classList.remove('theme-anim'), 650);
    }
  }, []);

  const toggle = useCallback((origin?: { x: number; y: number }) => setTheme(currentTheme() === 'dark' ? 'light' : 'dark', origin), [setTheme]);

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
