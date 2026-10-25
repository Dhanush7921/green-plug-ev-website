import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, get, post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Link, useRouter } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { Icon } from '../../components/Icon';
import { Btn, DemoTag, ErrorNote, Field, Input } from '../../components/ui';

const DEMO_ACCOUNTS = [
  { label: 'EV Driver', email: 'asha@greenplug.test', password: 'DriverDemo2026' },
  { label: 'Station Partner (approved)', email: 'partner@greenplug.test', password: 'PartnerDemo2026' },
  { label: 'Second partner', email: 'coastal@greenplug.test', password: 'PartnerDemo2026' },
  { label: 'Partner applicant (pending)', email: 'applicant@greenplug.test', password: 'DriverDemo2026' },
  { label: 'Administrator', email: 'admin@greenplug.test', password: 'AdminDemo2026' },
];

export function Welcome() {
  const { user } = useSession();
  return (
    <section className="welcome">
      <div className="welcome-hero" data-gloss>
        <div className="welcome-art" aria-hidden="true">
          <div className="welcome-orb" />
          <img src="/app/brand/mark-glossy.webp" alt="" width={260} height={216} className="welcome-mark" />
        </div>
        <div className="welcome-copy">
          <span className="kicker">GREEN PLUG EV · Charging app</span>
          <h1 className="h1">
            Charging, <span className="ink-gradient">found closer.</span>
          </h1>
          <p className="lede">Find compatible chargers, book a slot with a transparent price, plan trips with charging stops — and list your own station in Partner mode.</p>
          <div className="welcome-cta">
            <Link to="/" className="btn btn-primary btn-lg" data-gloss>
              <span className="btn-inner">
                <Icon name="map-pin" /> Find charging
              </span>
            </Link>
            {!user && (
              <>
                <Link to="/register" className="btn btn-glass btn-lg" data-gloss>
                  <span className="btn-inner">Create account</span>
                </Link>
                <Link to="/signin" className="btn btn-ghost btn-lg">
                  <span className="btn-inner">Sign in</span>
                </Link>
              </>
            )}
          </div>
          <ul className="welcome-points">
            <li>
              <Icon name="plug" /> CCS2, Type 2, CHAdeMO and Bharat connector filters
            </li>
            <li>
              <Icon name="indian-rupee" /> Price per kWh, service fee and total shown before you pay
            </li>
            <li>
              <Icon name="store" /> One account — switch to Station Partner after approval
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export function SignIn() {
  const { refresh, config } = useSession();
  const { navigate, loc } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const next = loc.search.get('next') || '/';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post('/api/auth/login', { email, password });
      const u = await refresh();
      navigate(u && !u.emailVerified ? '/verify' : next.startsWith('/') ? next : '/', { replace: true });
    } catch (x) {
      setErr(x as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="auth">
      <form className="auth-card card glass" onSubmit={submit} noValidate>
        <img src="/app/brand/mark-glossy.webp" alt="" className="auth-mark" width={84} height={70} />
        <h1 className="h2">Sign in</h1>
        <p className="muted">One account for EV Driver and Station Partner.</p>
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <ErrorNote error={err} />
        <Btn type="submit" busy={busy} icon="arrow-right" className="btn-block">
          Sign in
        </Btn>
        <p className="muted small">
          New here? <Link to="/register">Create an account</Link>
        </p>
        {config?.demoMode && (
          <div className="demo-accounts">
            <div className="demo-accounts-head">
              <DemoTag>Seeded demo accounts</DemoTag>
              <span className="muted small">Local test data only</span>
            </div>
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" className="demo-account" onClick={() => (setEmail(a.email), setPassword(a.password))}>
                <strong>{a.label}</strong>
                <span>{a.email}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </section>
  );
}

export function Register() {
  const { refresh } = useSession();
  const { navigate } = useRouter();
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const field = (k: keyof typeof f) => (err?.details as { field?: string } | undefined)?.field === k ? err!.message : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agree) return setErr(new ApiError(400, 'TERMS', 'Please accept the terms to continue.'));
    setBusy(true);
    setErr(null);
    try {
      await post('/api/auth/register', { ...f, phone: f.phone || undefined });
      await refresh();
      navigate('/verify', { replace: true });
    } catch (x) {
      setErr(x as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="auth">
      <form className="auth-card card glass" onSubmit={submit} noValidate>
        <img src="/app/brand/mark-glossy.webp" alt="" className="auth-mark" width={84} height={70} />
        <h1 className="h2">Create your account</h1>
        <p className="muted">Start as an EV Driver. Station Partner access is added after verification and approval.</p>
        <Field label="Full name">{(id) => <Input id={id} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />}</Field>
        <Field label="Email" error={field('email')}>
          {(id) => <Input id={id} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />}
        </Field>
        <Field label="Mobile number" optional hint="Used for booking updates once SMS is connected." error={field('phone')}>
          {(id) => <Input id={id} type="tel" autoComplete="tel" placeholder="+91 98xxxxxxxx" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
        </Field>
        <Field label="Password" hint="At least 10 characters with letters and numbers." error={field('password')}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I agree to the terms and privacy notice.</span>
        </label>
        <ErrorNote error={err && !field('email') && !field('password') && !field('phone') ? err : null} />
        <Btn type="submit" busy={busy} icon="arrow-right" className="btn-block">
          Create account
        </Btn>
        <p className="muted small">
          Already registered? <Link to="/signin">Sign in</Link>
        </p>
      </form>
    </section>
  );
}

export function DemoInbox({ compact }: { compact?: boolean }) {
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const load = () => get('/api/demo/inbox').then((r) => setMsgs(r.messages)).catch(() => setMsgs([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="demo-inbox" data-testid="demo-inbox">
      <div className="demo-inbox-head">
        <DemoTag>Demo inbox</DemoTag>
        <span className="muted small">Messages the email/SMS adapter would have sent. Nothing leaves this computer.</span>
        <button type="button" className="icon-btn" onClick={load} aria-label="Refresh demo inbox">
          <Icon name="refresh-cw" />
        </button>
      </div>
      {msgs && !msgs.length && <p className="muted small">No messages.</p>}
      <ul>
        {msgs?.slice(0, compact ? 2 : 30).map((m) => (
          <li key={m.id}>
            <span className="muted small">
              {m.channel} → {m.recipient} · {dateTime(m.createdAt)}
            </span>
            <strong>{m.subject}</strong>
            <span className="demo-inbox-body">{m.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Verify() {
  const { user, refresh } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [inboxKey, setInboxKey] = useState(0);
  if (user?.emailVerified)
    return (
      <section className="auth">
        <div className="auth-card card glass">
          <Icon name="circle-check" className="icon big-ok" />
          <h1 className="h2">Email verified</h1>
          <Btn icon="arrow-right" onClick={() => navigate('/')}>
            Find charging
          </Btn>
        </div>
      </section>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post('/api/auth/verify-email', { code });
      await refresh();
      toast('Email verified. You can now book charging.', 'good');
      navigate('/', { replace: true });
    } catch (x) {
      setErr(x as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="auth">
      <form className="auth-card card glass" onSubmit={submit}>
        <Icon name="mail" className="icon big-ok" />
        <h1 className="h2">Verify your email</h1>
        <p className="muted">We sent a 6-digit code to {user?.email}.</p>
        <Field label="Verification code">
          {(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="input code-input" />}
        </Field>
        <ErrorNote error={err} />
        <Btn type="submit" busy={busy} icon="check" className="btn-block" disabled={code.length !== 6}>
          Verify
        </Btn>
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            post('/api/auth/resend-code')
              .then(() => (toast('A new code was sent.', 'good'), setInboxKey((k) => k + 1)))
              .catch((x) => toast(x.message, 'bad'))
          }
        >
          Send a new code
        </button>
        <DemoInbox key={inboxKey} compact />
      </form>
    </section>
  );
}
