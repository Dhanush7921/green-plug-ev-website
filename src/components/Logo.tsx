import { forwardRef } from 'react';
import { ARC_WIDTH, EV, LAYOUT, MARK, WORD } from '../brand/brandPaths';

/**
 * GREEN PLUG EV logo, drawn inline from the editable sources in src/brand/brandPaths.ts
 * (regenerate with scripts/assets/build_logo.py). Colours come from theme tokens, so one
 * component serves light and dark backgrounds. Static files live in public/brand/.
 */
export const Logo = forwardRef<SVGSVGElement, { className?: string; decorative?: boolean }>(function Logo({ className = 'logo', decorative = false }, ref) {
  return (
    <svg ref={ref} className={className} viewBox={`0 0 ${LAYOUT.total} 64`} role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : 'GREEN PLUG EV'}>
      <MarkGroup />
      <g className="logo-word" transform={`translate(${LAYOUT.wordX} ${LAYOUT.baseline})`}>
        {WORD.map((g, i) => (
          <path key={i} className="glyph" d={g.d} data-x={g.x} data-w={g.w} />
        ))}
      </g>
      <g className="logo-ev">
        <rect className="logo-pill" x={LAYOUT.pill.x} y={LAYOUT.pill.y} width={LAYOUT.pill.w} height={LAYOUT.pill.h} rx={LAYOUT.pill.h / 2} />
        <g className="logo-ev-text" transform={`translate(${LAYOUT.evX} ${LAYOUT.evBaseline})`}>
          {EV.map((g, i) => (
            <path key={i} d={g.d} />
          ))}
        </g>
      </g>
    </svg>
  );
});

function MarkGroup() {
  return (
    <g className="logo-mark">
      <path className="mark-arc" d={MARK.arc} fill="none" strokeWidth={ARC_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      <path className="mark-plug" d={MARK.plug} />
      <path className="mark-prongs" d={MARK.prongs} />
      <path className="mark-spark" d={MARK.spark} />
    </g>
  );
}

export function LogoMark({ className = 'logo-mark-svg', label }: { className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <MarkGroup />
    </svg>
  );
}
