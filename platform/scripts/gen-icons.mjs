// Generates web/src/icons.generated.ts from a local checkout of lucide-icons/lucide (ISC licence).
// Usage: node scripts/gen-icons.mjs /path/to/lucide/icons
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Pass the lucide icons directory');
const names = `map-pin map-pinned plug plug-zap zap shield-check shield calendar calendar-clock route car scooter battery-charging search sliders-horizontal house store building bell user user-check users badge-check message-circle mail phone send check check-check circle-check x menu sun moon arrow-right arrow-left arrow-up-right chevron-down chevron-right chevron-left info triangle-alert lock eye-off eye file-text wrench gauge leaf sparkles navigation clock wallet indian-rupee smartphone layers compass timer flag map scan-line headset life-buoy ban circle-alert loader-circle clipboard-check locate-fixed hourglass rotate-ccw calculator heart log-out settings plus minus trash pencil credit-card receipt qr-code list funnel refresh-cw play square chart-column image-plus repeat-2 key-round hand-coins activity scale circle-parking landmark ticket-check crosshair zoom-in zoom-out circle-dot power coffee wifi cctv`.split(/\s+/);
const out = {};
for (const n of names) {
  const f = path.join(dir, `${n}.svg`);
  if (!fs.existsSync(f)) {
    console.warn('missing icon', n);
    continue;
  }
  const svg = fs.readFileSync(f, 'utf8');
  out[n] = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s*\n\s*/g, '').trim();
}
fs.writeFileSync(
  new URL('../web/src/icons.generated.ts', import.meta.url),
  `// Generated from Lucide (ISC License, https://lucide.dev). Do not edit by hand.\n// Regenerate with: node scripts/gen-icons.mjs <lucide>/icons\nexport const ICONS = ${JSON.stringify(out, null, 2)} as const;\nexport type IconName = keyof typeof ICONS;\n`,
);
console.log('icons:', Object.keys(out).length);
