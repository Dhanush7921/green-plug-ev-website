import { ICONS, type IconName } from './icons.generated';

export type { IconName };

export function Icon({ name, className = 'icon', label, strokeWidth = 1.8 }: { name: IconName; className?: string; label?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
