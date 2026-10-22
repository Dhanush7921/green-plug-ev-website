import { useMemo, useRef, useState, type FormEvent } from 'react';
import { site } from '../config/site';
import { gsap } from '../lib/gsap';
import { leadsMode, newSubmissionId, submitLead, type LeadData, type LeadType, type SubmitResult } from '../lib/leads';
import { prefersReducedMotion } from '../lib/prefs';
import { Link } from '../lib/router';
import { Button } from './Button';
import { Icon } from './Icon';

type Field =
  | { name: string; label: string; kind: 'text' | 'email' | 'tel'; required?: boolean; autoComplete?: string; placeholder?: string; half?: boolean; max?: number }
  | { name: string; label: string; kind: 'select'; options: string[]; required?: boolean; half?: boolean }
  | { name: string; label: string; kind: 'choice'; options: string[]; required?: boolean }
  | { name: string; label: string; kind: 'textarea'; required?: boolean; placeholder?: string; max?: number };

export const AP_CITIES = [
  'Visakhapatnam',
  'Vijayawada',
  'Guntur',
  'Nellore',
  'Tirupati',
  'Kakinada',
  'Rajamahendravaram',
  'Kurnool',
  'Anantapuramu',
  'Kadapa',
  'Eluru',
  'Ongole',
  'Vizianagaram',
  'Srikakulam',
  'Amaravati',
  'Elsewhere in Andhra Pradesh',
  'Outside Andhra Pradesh',
];

const name: Field = { name: 'name', label: 'Your name', kind: 'text', required: true, autoComplete: 'name', half: true, max: 80 };
const email: Field = { name: 'email', label: 'Email', kind: 'email', required: true, autoComplete: 'email', half: true, max: 120 };
const phone: Field = { name: 'phone', label: 'Mobile number', kind: 'tel', autoComplete: 'tel', placeholder: '+91 98765 43210', half: true };
const city: Field = { name: 'city', label: 'City or town', kind: 'select', options: AP_CITIES, required: true, half: true };

const FORMS: Record<LeadType, { title: string; submit: string; fields: Field[] }> = {
  driver: {
    title: 'Driver early access',
    submit: 'Join early access',
    fields: [
      name,
      email,
      phone,
      city,
      { name: 'vehicle', label: 'What do you drive?', kind: 'choice', options: ['Electric car', 'Electric bike or scooter', 'Both', 'Planning to buy an EV'], required: true },
      { name: 'model', label: 'Vehicle model', kind: 'text', placeholder: 'For example, your car or scooter model', half: true, max: 80 },
      { name: 'connector', label: 'Charging connector', kind: 'select', options: ['Not sure', 'Type 2 (AC)', 'CCS2 (DC fast)', 'Portable charger on a 15A socket', 'Bharat AC-001', 'Bharat DC-001', 'Type 7 (LECCS)', 'Type 6 (LEVDC)', 'Brand-specific connector', 'Other'], half: true },
      { name: 'needs', label: 'What would help you most?', kind: 'textarea', placeholder: 'Routes you drive often, problems you face finding a charger…', max: 1000 },
    ],
  },
  host: {
    title: 'Charging host interest',
    submit: 'Register host interest',
    fields: [
      name,
      email,
      { ...phone, required: true } as Field,
      city,
      { name: 'property', label: 'Type of place', kind: 'select', options: ['Independent house', 'Apartment or gated community', 'Shop or showroom', 'Café or restaurant', 'Hotel or homestay', 'Office or campus', 'Other'], required: true, half: true },
      { name: 'setup', label: 'Current charging setup', kind: 'select', options: ['I already have an EV charger', 'I have a dedicated power socket I could use', 'Nothing yet — I would need guidance', 'Not sure'], required: true, half: true },
      { name: 'vehicles', label: 'Who could you host?', kind: 'choice', options: ['Cars', 'Bikes and scooters', 'Both', 'Not sure yet'], required: true },
      { name: 'notes', label: 'Anything we should know?', kind: 'textarea', placeholder: 'Parking space, hours you could offer, questions about safety or approvals…', max: 1000 },
    ],
  },
  partner: {
    title: 'Partnership enquiry',
    submit: 'Send partnership enquiry',
    fields: [
      name,
      { name: 'organisation', label: 'Organisation', kind: 'text', required: true, autoComplete: 'organization', half: true, max: 120 },
      email,
      phone,
      { name: 'partnerType', label: 'Partnership area', kind: 'select', options: ['Charge point operator', 'Vehicle maker or dealer', 'Fleet or logistics', 'Real estate or property', 'Government or public body', 'Investor', 'Other'], required: true },
      { name: 'message', label: 'How could we work together?', kind: 'textarea', required: true, max: 2000 },
    ],
  },
  general: {
    title: 'General enquiry',
    submit: 'Send message',
    fields: [
      name,
      email,
      { name: 'topic', label: 'Topic', kind: 'select', options: ['A question about the app', 'Feedback or ideas', 'Media', 'Something else'], required: true },
      { name: 'message', label: 'Message', kind: 'textarea', required: true, max: 2000 },
    ],
  },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;

function validate(f: Field, v: string | undefined): string | null {
  const val = (v ?? '').trim();
  if (f.required && !val) return f.kind === 'choice' || f.kind === 'select' ? 'Choose an option.' : 'This field is required.';
  if (!val) return null;
  if (f.kind === 'email' && !EMAIL.test(val)) return 'Enter an email address like name@example.com.';
  if (f.kind === 'tel' && !PHONE.test(val.replace(/\s+/g, ' '))) return 'Enter a 10-digit Indian mobile number, optionally with +91.';
  if ('max' in f && f.max && val.length > f.max) return `Keep this under ${f.max} characters.`;
  return null;
}

export function LeadForm({ type, compact = false, onDone }: { type: LeadType; compact?: boolean; onDone?: () => void }) {
  const cfg = FORMS[type];
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const submissionId = useRef(newSubmissionId());
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const hp = useRef<HTMLInputElement>(null);
  const idp = useMemo(() => `f-${type}`, [type]);

  const set = (n: string, v: string) => {
    setValues((s) => ({ ...s, [n]: v }));
    if (errors[n]) setErrors((e) => ({ ...e, [n]: '' }));
  };
  const blur = (f: Field) => {
    const err = validate(f, values[f.name]);
    setErrors((e) => ({ ...e, [f.name]: err || '' }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return; // duplicate-click protection
    const errs: Record<string, string> = {};
    for (const f of cfg.fields) {
      const err = validate(f, values[f.name]);
      if (err) errs[f.name] = err;
    }
    if (!consent) errs.consent = 'Please confirm you are happy for us to store these details.';
    setErrors(errs);
    const firstBad = Object.keys(errs).find((k) => errs[k]);
    if (firstBad) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstBad}"]`)?.focus();
      if (!prefersReducedMotion()) gsap.fromTo(formRef.current, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    const data: LeadData = { ...values, consent: true, website: hp.current?.value || '' };
    const res = await submitLead(type, data, submissionId.current);
    inFlight.current = false;
    setBusy(false);
    setResult(res);
    if (res.status === 'saved') submissionId.current = newSubmissionId();
    requestAnimationFrame(() => {
      if (resultRef.current) {
        resultRef.current.focus();
        if (!prefersReducedMotion()) gsap.fromTo(resultRef.current, { y: 24, autoAlpha: 0, scale: 0.98 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: 'expo.out' });
      }
    });
  };

  const reset = () => {
    setResult(null);
    setValues({});
    setConsent(false);
    submissionId.current = newSubmissionId();
  };

  if (result && (result.status === 'saved' || result.status === 'demo' || result.status === 'duplicate')) {
    return (
      <div className="result" ref={resultRef} tabIndex={-1} role="status" data-kind={result.status}>
        {result.status === 'saved' && (
          <>
            <Icon name="circle-check" />
            <h3 className="h3">Received — thank you</h3>
            <p className="muted" style={{ margin: 0 }}>
              Your details were recorded. We will only use them to contact you about {cfg.title.toLowerCase()}.
            </p>
          </>
        )}
        {result.status === 'duplicate' && (
          <>
            <Icon name="info" />
            <h3 className="h3">Already sent</h3>
            <p className="muted" style={{ margin: 0 }}>
              This browser already sent the same details in the last 24 hours, so we did not send them again.
            </p>
          </>
        )}
        {result.status === 'demo' && (
          <>
            <Icon name="triangle-alert" />
            <h3 className="h3">Demo mode: nothing was sent or saved</h3>
            <p className="muted" style={{ margin: 0 }}>
              The form passed validation, but this website does not have a submission endpoint configured yet, so your details stayed in this browser tab. Below is exactly what would be sent once it is.
            </p>
            <details>
              <summary>Show the data that would be sent</summary>
              <pre>{JSON.stringify(result.payload, null, 2)}</pre>
            </details>
          </>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <Button type="button" variant="glass" size="sm" onClick={reset} icon="arrow-right">
            Start a new form
          </Button>
          {onDone && (
            <Button type="button" size="sm" onClick={onDone}>
              Close
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="form" ref={formRef} onSubmit={onSubmit} noValidate aria-describedby={`${idp}-mode`}>
      <div className="notice" id={`${idp}-mode`}>
        <Icon name={leadsMode === 'live' ? 'lock' : 'triangle-alert'} />
        {leadsMode === 'live' ? (
          <span>
            <strong>Sent securely to our early-access list.</strong>
            We use these details only to contact you about {site_label(type)}. You can ask us to delete them at any time.
          </span>
        ) : (
          <span>
            <strong>Demo mode — submissions are not sent or stored.</strong>
            The form endpoint has not been configured on this build, so you can try the form safely.
          </span>
        )}
      </div>
      {result?.status === 'error' && (
        <div className="result" data-kind="error" ref={resultRef} tabIndex={-1} role="alert">
          <strong>
            <Icon name="circle-alert" /> Not sent
          </strong>
          <span>{result.message}</span>
        </div>
      )}
      <FieldGrid fields={cfg.fields} values={values} errors={errors} set={set} blur={blur} idp={idp} compact={compact} />
      {/* honeypot: hidden from people, tempting to bots */}
      <div className="hp" aria-hidden="true">
        <label htmlFor={`${idp}-website`}>Website</label>
        <input ref={hp} id={`${idp}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="field" data-invalid={!!errors.consent}>
        <label className="check">
          <input type="checkbox" name="consent" checked={consent} onChange={(e) => { setConsent(e.target.checked); if (e.target.checked) setErrors((x) => ({ ...x, consent: '' })); }} aria-describedby={errors.consent ? `${idp}-consent-err` : undefined} />
          <span>
            I agree that {site_name()} may store these details to contact me about this request. I can ask for them to be deleted at any time. <Link to="/safety#privacy" className="text-link">How we handle data</Link>
          </span>
        </label>
        {errors.consent && (
          <span className="field-error" id={`${idp}-consent-err`}>
            <Icon name="circle-alert" /> {errors.consent}
          </span>
        )}
      </div>
      <div>
        <Button type="submit" disabled={busy} aria-disabled={busy} icon={busy ? 'loader-circle' : 'send'} className={busy ? 'is-busy' : undefined}>
          {busy ? 'Sending…' : cfg.submit}
        </Button>
      </div>
    </form>
  );
}

const site_name = () => site.name;
const site_label = (t: LeadType) => ({ driver: 'early access', host: 'hosting', partner: 'this partnership enquiry', general: 'your message' })[t];

function FieldGrid({ fields, values, errors, set, blur, idp, compact }: { fields: Field[]; values: Record<string, string>; errors: Record<string, string>; set: (n: string, v: string) => void; blur: (f: Field) => void; idp: string; compact: boolean }) {
  const rows: Field[][] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const n = fields[i + 1];
    if (!compact && 'half' in f && f.half && n && 'half' in n && n.half) {
      rows.push([f, n]);
      i++;
    } else rows.push([f]);
  }
  return (
    <>
      {rows.map((row) => (
        <div className={row.length === 2 ? 'form-row' : undefined} key={row.map((r) => r.name).join('+')}>
          {row.map((f) => (
            <FieldView key={f.name} f={f} value={values[f.name] || ''} error={errors[f.name]} set={set} blur={blur} idp={idp} />
          ))}
        </div>
      ))}
    </>
  );
}

function FieldView({ f, value, error, set, blur, idp }: { f: Field; value: string; error?: string; set: (n: string, v: string) => void; blur: (f: Field) => void; idp: string }) {
  const id = `${idp}-${f.name}`;
  const errId = `${id}-err`;
  const common = { id, name: f.name, 'aria-invalid': !!error, 'aria-describedby': error ? errId : undefined, 'aria-required': !!f.required };
  const label = (
    <>
      {f.label} {!f.required && <span className="opt">(optional)</span>}
    </>
  );
  const err = error ? (
    <span className="field-error" id={errId}>
      <Icon name="circle-alert" /> {error}
    </span>
  ) : null;

  if (f.kind === 'choice') {
    return (
      <fieldset className="field" data-invalid={!!error} style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={error ? errId : undefined}>
        <legend style={{ marginBottom: 8 }}>{label}</legend>
        <div className="choice-group">
          {f.options.map((o) => (
            <label className="choice" key={o}>
              <input type="radio" name={f.name} value={o} checked={value === o} onChange={() => set(f.name, o)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {err}
      </fieldset>
    );
  }
  return (
    <div className="field" data-invalid={!!error}>
      <label htmlFor={id}>{label}</label>
      {f.kind === 'select' ? (
        <select className="select" {...common} value={value} onChange={(e) => set(f.name, e.target.value)} onBlur={() => blur(f)}>
          <option value="">Choose…</option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : f.kind === 'textarea' ? (
        <textarea className="textarea" {...common} value={value} placeholder={f.placeholder} maxLength={f.max} onChange={(e) => set(f.name, e.target.value)} onBlur={() => blur(f)} />
      ) : (
        <input
          className="input"
          {...common}
          type={f.kind}
          value={value}
          autoComplete={f.autoComplete}
          placeholder={f.placeholder}
          inputMode={f.kind === 'tel' ? 'tel' : f.kind === 'email' ? 'email' : undefined}
          maxLength={f.kind === 'tel' ? 20 : f.max}
          onChange={(e) => set(f.name, e.target.value)}
          onBlur={() => blur(f)}
        />
      )}
      {err}
    </div>
  );
}
