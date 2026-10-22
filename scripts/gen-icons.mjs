// Generates src/components/icons.generated.ts from a local checkout of lucide-icons/lucide.
// Usage: node scripts/gen-icons.mjs /path/to/lucide/icons
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Pass the lucide icons directory');
const names = `map-pin plug plug-zap zap shield-check calendar-clock route car bike motorbike scooter battery-charging search sliders-horizontal house store building coffee hotel users user-check badge-check message-circle mail phone send check circle-check x menu sun moon arrow-right arrow-up-right chevron-down chevron-right info triangle-alert lock eye-off file-check wrench gauge leaf sparkles navigation clock wallet indian-rupee smartphone play apple bell handshake cable layers compass lightbulb timer flag map scan-line headset life-buoy ban circle-alert loader-circle shield clipboard-check map-pinned locate-fixed hourglass circuit-board power heart-handshake factory school list-checks mouse-pointer-2 rotate-ccw skip-forward calculator arrow-down battery-medium file-text key-round eye hand-coins activity scale circle-parking smartphone-charging`.split(/\s+/);

const out = {};
for (const n of names) {
  const svg = fs.readFileSync(path.join(dir, `${n}.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s*\n\s*/g, '').trim();
  out[n] = inner;
}
const body = `// Generated from Lucide (ISC License, https://lucide.dev). Do not edit by hand.\n// Regenerate with: node scripts/gen-icons.mjs <lucide>/icons\nexport const ICONS = ${JSON.stringify(out, null, 2)} as const;\nexport type IconName = keyof typeof ICONS;\n`;
fs.writeFileSync(new URL('../src/components/icons.generated.ts', import.meta.url), body);
console.log('icons:', names.length);
