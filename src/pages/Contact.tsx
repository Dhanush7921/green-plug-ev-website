import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { LeadForm } from '../components/LeadForm';
import { PageHero } from '../components/PageHero';
import { site } from '../config/site';
import { gsap } from '../lib/gsap';
import { leadsMode, type LeadType } from '../lib/leads';
import { prefersReducedMotion } from '../lib/prefs';
import { useNavigate, useSearchParam } from '../lib/router';
import { useMotion } from '../motion/kinetic';

const TABS: { id: LeadType; label: string; icon: IconName; blurb: string }[] = [
  { id: 'driver', label: 'Driver early access', icon: 'car', blurb: 'Tell us what you drive and where, and we will let you know when the app is ready to try.' },
  { id: 'host', label: 'Host interest', icon: 'house', blurb: 'Have a charger or a suitable socket where vehicles can park? Register interest; it is not a commitment.' },
  { id: 'partner', label: 'Partnerships', icon: 'handshake', blurb: 'Charge point operators, vehicle makers, fleets, property owners and public bodies.' },
  { id: 'general', label: 'General enquiry', icon: 'message-circle', blurb: 'Questions, feedback, media or anything else.' },
];

export default function Contact() {
  const ref = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const param = useSearchParam('form');
  const navigate = useNavigate();
  const initial = (TABS.find((t) => t.id === param)?.id ?? 'driver') as LeadType;
  const [tab, setTab] = useState<LeadType>(initial);
  useMotion(ref);

  useEffect(() => {
    const p = TABS.find((t) => t.id === param)?.id;
    if (p && p !== tab) setTab(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  useLayoutEffect(() => {
    const btn = tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    const glow = glowRef.current;
    if (!btn || !glow) return;
    const vars = { x: btn.offsetLeft, y: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight };
    if (prefersReducedMotion() || !glow.dataset.ready) gsap.set(glow, vars);
    else gsap.to(glow, { ...vars, duration: 0.6, ease: 'expo.out' });
    glow.dataset.ready = '1';
    if (panelRef.current && !prefersReducedMotion()) gsap.fromTo(panelRef.current, { autoAlpha: 0, y: 24, rotationX: -6, transformPerspective: 1000 }, { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.7, ease: 'expo.out' });
  }, [tab]);

  const select = (id: LeadType) => {
    setTab(id);
    navigate(`/contact?form=${id}`, { replace: true });
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!n) return;
    e.preventDefault();
    const next = TABS[(i + n + TABS.length) % TABS.length];
    select(next.id);
    tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="page" ref={ref}>
      <PageHero
        kicker="Contact and early access"
        icon="send"
        title={
          <>
            Plug into the <span className="ink-gradient">early list.</span>
          </>
        }
        lede="Register interest as a driver or host, propose a partnership, or just ask a question. We read everything and reply to what needs a reply."
      >
        {site.contactEmail && (
          <a className="text-link" href={`mailto:${site.contactEmail}`}>
            <Icon name="mail" /> {site.contactEmail}
          </a>
        )}
      </PageHero>
      <section className="section contact" aria-label="Forms">
        <div className="container contact-grid">
          <div className="contact-side">
            <div className="tabs" role="tablist" aria-label="Choose a form" aria-orientation="vertical" ref={tabsRef}>
              <span className="tab-glow" ref={glowRef} aria-hidden="true" />
              {TABS.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  data-tab={t.id}
                  aria-selected={tab === t.id}
                  aria-controls="form-panel"
                  tabIndex={tab === t.id ? 0 : -1}
                  className="tab"
                  onClick={() => select(t.id)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <Icon name={t.icon} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <div className="contact-note card">
              <h2 className="h3">
                <Icon name="lock" /> How your details are handled
              </h2>
              <p>
                We ask only for what we need to reply. {leadsMode === 'live' ? 'Submissions go to a private spreadsheet.' : 'On this build the form service is not configured, so nothing you enter leaves your browser.'} You
                can ask us to delete your details at any time.
              </p>
            </div>
          </div>
          <div className="form-panel glass" id="form-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} ref={panelRef} data-gloss>
            <div className="form-panel-head">
              <span className="icon-tile">
                <Icon name={active.icon} />
              </span>
              <div>
                <h2 className="h2">{active.label}</h2>
                <p className="muted">{active.blurb}</p>
              </div>
            </div>
            <LeadForm type={tab} key={tab} />
          </div>
        </div>
      </section>
    </div>
  );
}
