// App frame: demo banner, top bar (logo, SWITCH MODE, notifications, theme, account), workspace navigation
// (side rail on desktop, bottom bar on mobile) and an always-visible active-booking chip.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Logo } from '../../../../src/components/Logo';
import { ThemeToggle } from '../../../../src/components/ThemeToggle';
import { get, post } from '../lib/api';
import { dateTime, time } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Icon, type IconName } from './Icon';

export type Workspace = 'driver' | 'partner' | 'admin';
export const workspaceOf = (path: string): Workspace => (path.startsWith('/partner') ? 'partner' : path.startsWith('/admin') ? 'admin' : 'driver');

const NAV: Record<Workspace, { to: string; label: string; icon: IconName; exact?: boolean; mobile?: boolean }[]> = {
  driver: [
    { to: '/', label: 'Find charging', icon: 'map-pin', exact: true, mobile: true },
    { to: '/bookings', label: 'Bookings', icon: 'calendar-clock', mobile: true },
    { to: '/trips', label: 'Trip planner', icon: 'route', mobile: true },
    { to: '/saved', label: 'Favourites', icon: 'heart' },
    { to: '/garage', label: 'My vehicles', icon: 'car' },
    { to: '/payments', label: 'Payments', icon: 'wallet' },
    { to: '/support', label: 'Support', icon: 'headset' },
    { to: '/safety', label: 'Safety', icon: 'shield-check' },
    { to: '/profile', label: 'Profile', icon: 'user', mobile: true },
  ],
  partner: [
    { to: '/partner', label: 'Dashboard', icon: 'gauge', exact: true, mobile: true },
    { to: '/partner/stations', label: 'Stations', icon: 'plug-zap', mobile: true },
    { to: '/partner/bookings', label: 'Bookings', icon: 'calendar', mobile: true },
    { to: '/partner/revenue', label: 'Revenue & payouts', icon: 'indian-rupee', mobile: true },
    { to: '/partner/support', label: 'Partner support', icon: 'headset' },
    { to: '/profile', label: 'Profile', icon: 'user' },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: 'gauge', exact: true, mobile: true },
    { to: '/admin/partners', label: 'Partners', icon: 'badge-check', mobile: true },
    { to: '/admin/stations', label: 'Stations', icon: 'plug-zap', mobile: true },
    { to: '/admin/bookings', label: 'Bookings & refunds', icon: 'calendar-clock' },
    { to: '/admin/settings', label: 'Commission', icon: 'scale', mobile: true },
    { to: '/admin/ledger', label: 'Ledger & webhooks', icon: 'receipt' },
    { to: '/admin/support', label: 'Support cases', icon: 'life-buoy' },
    { to: '/admin/audit', label: 'Audit log', icon: 'clipboard-check' },
  ],
};
const WS_LABEL: Record<Workspace, string> = { driver: 'EV Driver', partner: 'Station Partner', admin: 'Admin' };

function hasDrafts() {
  try {
    return Object.keys(sessionStorage).some((k) => k.startsWith('gpev-draft:'));
  } catch {
    return false;
  }
}

export function SwitchMode({ compact }: { compact?: boolean }) {
  const { user, refresh } = useSession();
  const { loc, navigate } = useRouter();
  const toast = useToast();
  const ws = workspaceOf(loc.path);
  const [busy, setBusy] = useState<Workspace | null>(null);
  const go = async (mode: Workspace) => {
    if (mode === ws && !loc.path.startsWith('/partner/apply')) return;
    if (!user) return navigate(`/signin?next=${encodeURIComponent(mode === 'driver' ? '/' : '/' + mode)}`);
    setBusy(mode);
    try {
      // The server decides what this account may open; the client only follows the answer.
      const fresh = await refresh();
      if (!fresh) return navigate('/signin');
      const r = await post<{ granted: string; partnerStatus: string }>('/api/me/workspace', { mode });
      const kept = hasDrafts();
      if (r.granted === 'driver') navigate('/');
      else if (r.granted === 'partner-dashboard') navigate('/partner');
      else if (r.granted === 'partner-onboarding') {
        navigate('/partner/apply');
        toast(r.partnerStatus === 'PENDING' ? 'Your partner application is under review. Station tools unlock after approval.' : 'Station tools need an approved partner account. Start your registration here.', 'info');
      } else if (r.granted === 'admin') navigate('/admin');
      else toast('Admin access is restricted to authorised administrators.', 'bad');
      if (kept && r.granted !== 'denied') toast('Unsaved form drafts are kept — they will be there when you switch back.', 'info');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  const modes: Workspace[] = user?.roles.includes('admin') ? ['driver', 'partner', 'admin'] : ['driver', 'partner'];
  return (
    <div className={`switch-mode ${compact ? 'is-compact' : ''}`} role="group" aria-label="Switch mode">
      <span className="switch-mode-label">
        <Icon name="repeat-2" /> Switch mode
      </span>
      <div className="switch-mode-track" data-active={ws}>
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            className={`switch-mode-btn ${ws === m ? 'is-active' : ''}`}
            aria-pressed={ws === m}
            onClick={() => go(m)}
            disabled={!!busy}
            data-mode={m}
          >
            <Icon name={busy === m ? 'loader-circle' : m === 'driver' ? 'car' : m === 'partner' ? 'plug-zap' : 'shield'} className={`icon ${busy === m ? 'spin' : ''}`} />
            <span>{compact && m === 'partner' ? 'Partner' : WS_LABEL[m]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Notifications() {
  const { user } = useSession();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ notifications: any[]; unread: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = () => user && get('/api/me/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  if (!user) return null;
  return (
    <div className="notif" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open} onClick={() => (setOpen(!open), load())}>
        <Icon name="bell" />
        {!!data?.unread && <span className="notif-dot">{data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel glass" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {!!data?.unread && (
              <button type="button" className="link-btn" onClick={() => post('/api/me/notifications/read-all').then(load)}>
                Mark all read
              </button>
            )}
          </div>
          {!data?.notifications.length && <p className="muted notif-empty">No notifications yet.</p>}
          <ul>
            {data?.notifications.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'is-unread'}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <strong>{n.title}</strong>
                  {n.body && <span>{n.body}</span>}
                  <time>{dateTime(n.createdAt)}</time>
                </button>
              </li>
            ))}
          </ul>
          <p className="notif-foot muted">
            <Icon name="info" /> Demo: in-app notifications only — no push, SMS or email is sent.
          </p>
        </div>
      )}
    </div>
  );
}

function ActiveBooking() {
  const { user } = useSession();
  const { loc } = useRouter();
  const [b, setB] = useState<any>(null);
  useEffect(() => {
    if (!user) return setB(null);
    get('/api/bookings?scope=upcoming')
      .then((r) => {
        const soon = (r.bookings as any[]).filter((x) => new Date(x.startsAt).getTime() - Date.now() < 36 * 36e5).sort((a, c) => +new Date(a.startsAt) - +new Date(c.startsAt));
        setB(soon[0] || null);
      })
      .catch(() => setB(null));
  }, [user?.id, loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return null;
  const now = new Date(b.startsAt).getTime() <= Date.now();
  return (
    <Link to={`/bookings/${b.id}`} className="active-booking" data-testid="active-booking">
      <span className="pulse" aria-hidden="true" />
      <span>
        <strong>{b.status === 'RESERVED' ? 'Booking held' : now ? 'Active booking' : 'Next booking'}</strong> {b.code} · {b.stationName} · {time(b.startsAt)}
      </span>
      <Icon name="chevron-right" />
    </Link>
  );
}

function Account() {
  const { user, logout } = useSession();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  if (!user)
    return (
      <Link to="/signin" className="btn btn-primary btn-sm" data-gloss>
        <span className="btn-inner">Sign in</span>
      </Link>
    );
  return (
    <div className="account" ref={ref}>
      <button type="button" className="avatar" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {user.fullName.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="account-panel glass">
          <strong>{user.fullName}</strong>
          <span className="muted">{user.email}</span>
          <span className="account-roles">
            {user.roles.map((r) => (
              <span key={r} className="pill pill-neutral">
                {r}
              </span>
            ))}
            {user.partner && <span className={`pill pill-${user.partner.status === 'APPROVED' ? 'good' : 'warn'}`}>partner: {user.partner.status.toLowerCase()}</span>}
          </span>
          <Link to="/profile" onClick={() => setOpen(false)}>
            <Icon name="user" /> Profile & settings
          </Link>
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/welcome');
            }}
          >
            <Icon name="log-out" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function DemoBanner() {
  const { config } = useSession();
  if (!config?.demoMode) return null;
  return (
    <div className="demo-banner" role="note">
      <Icon name="flag" />
      <span>
        <strong>Demo mode</strong> · test payments (no real money)<span className="demo-banner-more"> · demo map & geocoding · simulated station availability · demo inbox instead of email/SMS</span>
      </span>
      <Link to="/integrations">Details</Link>
    </div>
  );
}

const PARTNER_PENDING_NAV = [
  { to: '/partner/apply', label: 'Partner registration', icon: 'badge-check' as IconName, mobile: true },
  { to: '/profile', label: 'Profile', icon: 'user' as IconName, mobile: true },
];

export function Shell({ children }: { children: ReactNode }) {
  const { loc } = useRouter();
  const { user } = useSession();
  const ws = workspaceOf(loc.path);
  const approvedPartner = !!user?.roles.includes('partner') && user.partner?.status === 'APPROVED';
  const nav = ws === 'partner' && !approvedPartner ? PARTNER_PENDING_NAV : NAV[ws];
  const active = (n: { to: string; exact?: boolean }) => (n.exact ? loc.path === n.to : loc.path === n.to || loc.path.startsWith(n.to + '/'));
  return (
    <div className={`shell ws-${ws}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <DemoBanner />
      <header className="topbar glass">
        <Link to={ws === 'driver' ? '/' : ws === 'partner' ? '/partner' : '/admin'} className="topbar-logo" aria-label="GREEN PLUG EV home">
          <Logo className="logo" decorative />
          <span className="ws-chip">{WS_LABEL[ws]}</span>
        </Link>
        <div className="topbar-switch">
          <SwitchMode />
        </div>
        <div className="topbar-actions">
          <Notifications />
          <ThemeToggle />
          <Account />
        </div>
      </header>
      <div className="mobile-switch">
        <SwitchMode compact />
      </div>
      <div className="shell-body">
        <nav className="siderail" aria-label={`${WS_LABEL[ws]} navigation`}>
          {nav.map((n) => (
            <Link key={n.to} to={n.to} className={`rail-link ${active(n) ? 'is-active' : ''}`} aria-current={active(n) ? 'page' : undefined}>
              <Icon name={n.icon} /> <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <main id="main" className="main" tabIndex={-1}>
          <ActiveBooking />
          <div className="view" key={loc.path}>
            {children}
          </div>
        </main>
      </div>
      <nav className="bottombar glass" aria-label={`${WS_LABEL[ws]} quick navigation`}>
        {nav
          .filter((n) => n.mobile)
          .map((n) => (
            <Link key={n.to} to={n.to} className={`bottom-link ${active(n) ? 'is-active' : ''}`} aria-current={active(n) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label.split(' ')[0]}</span>
            </Link>
          ))}
      </nav>
    </div>
  );
}
