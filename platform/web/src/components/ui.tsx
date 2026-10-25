// Shared UI building blocks (buttons reuse the website's .btn system for one brand).
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { statusTone } from '../lib/format';
import { Icon, type IconName } from './Icon';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'glass' | 'ghost' | 'danger'; icon?: IconName; size?: 'sm' | 'md' | 'lg'; busy?: boolean };
export function Btn({ variant = 'primary', icon, size = 'md', busy, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant === 'danger' ? 'glass btn-danger' : variant} ${size !== 'md' ? `btn-${size}` : ''} ${busy ? 'is-busy' : ''} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} data-magnetic="0.2" data-gloss {...rest}>
      <span className="btn-inner" data-magnetic-inner>
        {busy ? <Icon name="loader-circle" className="icon spin" /> : icon ? <Icon name={icon} /> : null}
        <span className="btn-text">{children}</span>
      </span>
    </button>
  );
}

export function Field({ label, hint, error, children, optional }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; optional?: boolean }) {
  const id = useId();
  return (
    <div className="field" data-invalid={!!error || undefined}>
      <label htmlFor={id}>
        {label} {optional && <span className="opt">(optional)</span>}
      </label>
      {children(id)}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          <Icon name="circle-alert" /> {error}
        </span>
      )}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...p} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select className="select" {...p} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="textarea" {...p} />;

export function Pill({ status, children, tone }: { status?: string; children?: ReactNode; tone?: string }) {
  return <span className={`pill pill-${tone || statusTone(status || '')}`}>{children ?? status}</span>;
}
export function DemoTag({ children = 'Demo' }: { children?: ReactNode }) {
  return (
    <span className="demo-tag" title="Demo / test data — not a live service">
      <Icon name="flag" /> {children}
    </span>
  );
}
export function Empty({ icon = 'info', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}
export function ErrorNote({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-note" role="alert">
      <Icon name="circle-alert" /> <span>{error.message}</span>
      {onRetry && (
        <button type="button" className="link-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Card({ children, className = '', tilt, ...rest }: { children: ReactNode; className?: string; tilt?: boolean; [data: `data-${string}`]: string | undefined }) {
  return (
    <div className={`card app-card ${className}`} data-gloss {...(tilt ? { 'data-tilt': '3' } : {})} {...rest}>
      {children}
    </div>
  );
}
export function PageHead({ kicker, title, children, actions }: { kicker?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {kicker && <span className="kicker">{kicker}</span>}
        <h1 className="h2">{title}</h1>
        {children && <div className="muted page-head-sub">{children}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}
export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: IconName }) {
  return (
    <div className="stat" data-gloss>
      {icon && (
        <span className="stat-icon">
          <Icon name={icon} />
        </span>
      )}
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card glass ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="modal-head">
          <h2 className="h3">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
