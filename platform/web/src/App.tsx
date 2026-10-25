import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PointerSystem } from '../../../src/components/PointerSystem';
import { ThemeProvider } from '../../../src/lib/theme';
import { Intro, shouldPlayIntro } from './components/Intro';
import { Shell } from './components/Shell';
import { Btn, Loading } from './components/ui';
import { Icon } from './components/Icon';
import { match, RouterProvider, useRouter } from './lib/router';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './lib/toast';
import { SignIn, Register, Verify, Welcome } from './pages/auth/Auth';
import { Discover } from './pages/driver/Discover';
import { StationDetail } from './pages/driver/StationDetail';
import { BookingDetail, Bookings } from './pages/driver/Bookings';
import { Garage, Integrations, Payments, Profile, Safety, Saved, Support, Ticket, Trips } from './pages/driver/More';
import { PartnerApply, PartnerBookings, PartnerDashboard, PartnerRevenue } from './pages/partner/Partner';
import { PartnerStations, StationEditor } from './pages/partner/Stations';
import { AdminAudit, AdminBookings, AdminLedger, AdminOverview, AdminPartners, AdminSettings, AdminStations, AdminSupport } from './pages/admin/Admin';

type Access = 'public' | 'user' | 'partner' | 'admin';
type Route = [pattern: string, access: Access, render: (p: Record<string, string>) => ReactNode];
const ROUTES: Route[] = [
  ['/welcome', 'public', () => <Welcome />],
  ['/signin', 'public', () => <SignIn />],
  ['/register', 'public', () => <Register />],
  ['/verify', 'user', () => <Verify />],
  ['/integrations', 'public', () => <Integrations />],
  ['/', 'public', () => <Discover />],
  ['/stations/:id', 'public', (p) => <StationDetail id={p.id} />],
  ['/bookings', 'user', () => <Bookings />],
  ['/bookings/:id', 'user', (p) => <BookingDetail id={p.id} />],
  ['/trips', 'user', () => <Trips />],
  ['/saved', 'user', () => <Saved />],
  ['/garage', 'user', () => <Garage />],
  ['/payments', 'user', () => <Payments />],
  ['/profile', 'user', () => <Profile />],
  ['/support', 'user', () => <Support />],
  ['/support/:id', 'user', (p) => <Ticket id={p.id} />],
  ['/safety', 'public', () => <Safety />],
  ['/partner/apply', 'user', () => <PartnerApply />],
  ['/partner', 'partner', () => <PartnerDashboard />],
  ['/partner/stations', 'partner', () => <PartnerStations />],
  ['/partner/stations/new', 'partner', () => <StationEditor id={null} />],
  ['/partner/stations/:id', 'partner', (p) => <StationEditor id={p.id} />],
  ['/partner/bookings', 'partner', () => <PartnerBookings />],
  ['/partner/revenue', 'partner', () => <PartnerRevenue />],
  ['/partner/support', 'partner', () => <Support workspace="partner" />],
  ['/partner/support/:id', 'partner', (p) => <Ticket id={p.id} workspace="partner" />],
  ['/admin', 'admin', () => <AdminOverview />],
  ['/admin/partners', 'admin', () => <AdminPartners />],
  ['/admin/stations', 'admin', () => <AdminStations />],
  ['/admin/bookings', 'admin', () => <AdminBookings />],
  ['/admin/settings', 'admin', () => <AdminSettings />],
  ['/admin/ledger', 'admin', () => <AdminLedger />],
  ['/admin/support', 'admin', () => <AdminSupport />],
  ['/admin/audit', 'admin', () => <AdminAudit />],
];

function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace: true }), [to, navigate]);
  return null;
}

function Denied() {
  const { navigate } = useRouter();
  return (
    <div className="empty" data-testid="access-denied">
      <span className="empty-icon">
        <Icon name="lock" />
      </span>
      <strong>Admin access is restricted</strong>
      <p className="muted">This workspace is only for authorised administrators. The server rejects admin requests from other accounts.</p>
      <Btn onClick={() => navigate('/')}>Back to EV Driver</Btn>
    </div>
  );
}

function Routes() {
  const { loc } = useRouter();
  const { user, loading } = useSession();
  if (loading) return <Loading label="Starting…" />;
  for (const [pattern, access, render] of ROUTES) {
    const p = match(pattern, loc.path);
    if (!p) continue;
    if (access !== 'public' && !user) return <Redirect to={`/signin?next=${encodeURIComponent(loc.path + (loc.search.toString() ? `?${loc.search}` : ''))}`} />;
    // UI guards mirror the server's checks for a friendly experience; the API enforces them independently.
    if (access === 'partner' && !(user!.roles.includes('partner') && user!.partner?.status === 'APPROVED')) return <PartnerApply />;
    if (access === 'admin' && !user!.roles.includes('admin')) return <Denied />;
    return <>{render(p)}</>;
  }
  return (
    <div className="empty">
      <strong>Page not found</strong>
      <a href="/app/">Go to the app home</a>
    </div>
  );
}

export function App() {
  const [intro, setIntro] = useState(shouldPlayIntro);
  const done = useCallback(() => setIntro(false), []);
  useEffect(() => {
    if (!intro) document.documentElement.classList.remove('intro-pending');
  }, [intro]);
  return (
    <ThemeProvider>
      <SessionProvider>
        <RouterProvider>
          <ToastProvider>
            {intro && <Intro onDone={done} />}
            <Shell>
              <Routes />
            </Shell>
            <PointerSystem />
          </ToastProvider>
        </RouterProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
