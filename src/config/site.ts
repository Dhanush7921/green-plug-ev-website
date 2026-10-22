import routes from './routes.json';

// Central, replaceable brand + integration settings.
// Public values come from VITE_* variables at build time (see .env.example). No secrets belong here.
const env = import.meta.env;

export const site = {
  name: 'GREEN PLUG EV',
  region: 'Andhra Pradesh',
  contactEmail: (env.VITE_CONTACT_EMAIL || '').trim(),
  leadsEndpoint: (env.VITE_LEADS_ENDPOINT || '').trim(),
  base: env.BASE_URL || '/',
};

/**
 * App store links. Both apps are unpublished: while a URL is empty the store card shows a
 * "Coming soon" state. Add the real listing URLs here (or via the VITE_* variables) once they exist.
 */
export const stores = {
  play: { label: 'Google Play', url: (env.VITE_PLAY_STORE_URL || '').trim() },
  apple: { label: 'App Store', url: (env.VITE_APP_STORE_URL || '').trim() },
};

export type NavItem = { to: string; label: string; short?: string };
export const navItems: NavItem[] = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/drivers', label: 'For drivers', short: 'Drivers' },
  { to: '/hosts', label: 'For hosts', short: 'Hosts' },
  { to: '/safety', label: 'Safety and trust', short: 'Safety' },
  { to: '/faq', label: 'FAQ' },
  { to: '/contact', label: 'Contact', short: 'Contact' },
];

export const pageTitles: Record<string, string> = Object.fromEntries(routes.map((r) => [r.path, r.title]));
export const modelUrl = `${site.base}models/ev-concept.glb`;
