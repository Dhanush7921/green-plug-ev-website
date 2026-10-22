// A small History-API router (7 static pages don't need a routing library).
// Works under a GitHub Pages sub-path via BASE_URL; dist/404.html handles deep links.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export type AppLocation = { pathname: string; search: string; hash: string; key: number };
type Ctx = { location: AppLocation; navigate: (to: string, opts?: { replace?: boolean }) => void; href: (to: string) => string };

const RouterContext = createContext<Ctx | null>(null);
const baseNoSlash = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
// Hash mode (VITE_ROUTER=hash) is for hosts without a fixed path, e.g. a preview link: #/drivers#section
const HASH = import.meta.env.VITE_ROUTER === 'hash';
let keyCounter = 0;

function normalizePath(p: string) {
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function readLocation(): AppLocation {
  if (HASH) {
    const raw = window.location.hash.replace(/^#/, '') || '/';
    const [pathAndQuery, frag] = raw.split('#');
    const [p, q] = pathAndQuery.split('?');
    return { pathname: normalizePath(p || '/'), search: q ? `?${q}` : '', hash: frag ? `#${frag}` : '', key: keyCounter++ };
  }
  let p = window.location.pathname;
  if (baseNoSlash && p.startsWith(baseNoSlash)) p = p.slice(baseNoSlash.length);
  return { pathname: normalizePath(p || '/'), search: window.location.search, hash: window.location.hash, key: keyCounter++ };
}

export function toHref(to: string) {
  if (/^(https?:|mailto:|tel:)/.test(to)) return to;
  if (HASH) return `#${to.startsWith('/') ? to : `/${to}`}`;
  return `${baseNoSlash}${to.startsWith('/') ? to : `/${to}`}`;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<AppLocation>(readLocation);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const onPop = () => setLocation(readLocation());
    window.addEventListener('popstate', onPop);
    if (HASH) window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = HASH ? window.location.pathname + window.location.search + toHref(to) : toHref(to);
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (url === current) {
      // Same URL: just re-scroll to the hash/top.
      setLocation((l) => ({ ...l, key: keyCounter++ }));
      return;
    }
    if (opts?.replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    setLocation(readLocation());
  }, []);

  const value = useMemo(() => ({ location, navigate, href: toHref }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter outside RouterProvider');
  return ctx;
}

export const useLocation = () => useRouter().location;
export const useNavigate = () => useRouter().navigate;

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, target, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const external = /^(https?:|mailto:|tel:)/.test(to);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || external || target === '_blank') return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={toHref(to)} onClick={handle} target={target} rel={external && target === '_blank' ? 'noopener noreferrer' : rest.rel} {...rest} />;
}

export function useSearchParam(name: string) {
  const { search } = useLocation();
  return new URLSearchParams(search).get(name);
}
