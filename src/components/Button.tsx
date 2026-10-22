import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from '../lib/router';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'glass' | 'ghost';
type Common = { variant?: Variant; icon?: IconName; iconStart?: IconName; size?: 'md' | 'sm' | 'lg'; children: ReactNode; className?: string };

const cls = (v: Variant, s: string, extra?: string) => ['btn', `btn-${v}`, s !== 'md' && `btn-${s}`, extra].filter(Boolean).join(' ');

function Inner({ icon, iconStart, children }: { icon?: IconName; iconStart?: IconName; children: ReactNode }) {
  return (
    <span className="btn-inner" data-magnetic-inner>
      {iconStart && <Icon name={iconStart} />}
      <span className="btn-text">{children}</span>
      {icon && (
        <span className="btn-icon">
          <Icon name={icon} />
        </span>
      )}
    </span>
  );
}

/** Glossy, magnetic link styled as a button. */
export function ButtonLink({ to, variant = 'primary', icon, iconStart, size = 'md', children, className }: Common & { to: string }) {
  return (
    <Link to={to} className={cls(variant, size, className)} data-magnetic="0.32" data-gloss>
      <Inner icon={icon} iconStart={iconStart}>
        {children}
      </Inner>
    </Link>
  );
}

export function Button({ variant = 'primary', icon, iconStart, size = 'md', children, className, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cls(variant, size, className)} data-magnetic="0.28" data-gloss {...rest}>
      <Inner icon={icon} iconStart={iconStart}>
        {children}
      </Inner>
    </button>
  );
}
