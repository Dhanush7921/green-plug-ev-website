// Minimal History-API router for the app under /app/.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

const BASE = '/app';
type Loc = { path: string; search: URLSearchParams; key: number };
type Ctx = { loc: Loc; navigate: (to: string, opts?: { replace?: boolean }) => void };
const RouterCtx = createContext<Ctx | null>(null);
let k = 0;
function read(): Loc {
  let p = window.location.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return { path: p || '/', search: new URLSearchParams(window.location.search), key: k++ };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Loc>(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = BASE + (to.startsWith('/') ? to : '/' + to);
    if (opts?.replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    setLoc(read());
    window.scrollTo({ top: 0 });
  }, []);
  const v = useMemo(() => ({ loc, navigate }), [loc, navigate]);
  return <RouterCtx.Provider value={v}>{children}</RouterCtx.Provider>;
}
export function useRouter() {
  const c = useContext(RouterCtx);
  if (!c) throw new Error('no router');
  return c;
}
/** Matches '/stations/:id' style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/');
  const xp = path.split('/');
  if (pp.length !== xp.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) out[pp[i].slice(1)] = decodeURIComponent(xp[i]);
    else if (pp[i] !== xp[i]) return null;
  }
  return out;
}
export function Link({ to, onClick, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string }) {
  const { navigate } = useRouter();
  const external = /^https?:/.test(to);
  return (
    <a
      href={external ? to : BASE + to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (external || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    />
  );
}
