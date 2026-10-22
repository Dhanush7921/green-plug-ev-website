// Production build for the GREEN PLUG EV website.
// Uses esbuild directly (the same compiler Vite uses internally) and follows Vite's
// conventions: VITE_* variables from .env files, import.meta.env.BASE_URL, index.html template.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(mode) {
  const env = {};
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[key] = value;
    }
  }
  // Real environment variables win (used by GitHub Actions).
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('VITE_') || k === 'BASE_PATH') env[k] = v;
  return env;
}

export function normalizeBase(b) {
  if (b === './') return './'; // relative build (hash routing), for hosts without a known path
  if (!b || b === '/') return '/';
  const trimmed = b.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

export function esbuildOptions({ mode, base, outdir, env }) {
  const publicEnv = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('VITE_')));
  return {
    absWorkingDir: root,
    entryPoints: { main: 'src/main.tsx' },
    bundle: true,
    splitting: true,
    format: 'esm',
    outdir: path.join(outdir, 'assets'),
    entryNames: mode === 'production' ? '[name]-[hash]' : '[name]',
    chunkNames: 'chunk-[hash]',
    assetNames: '[name]-[hash]',
    ...(base === './' ? {} : { publicPath: `${base}assets/` }),
    metafile: true,
    minify: mode === 'production',
    sourcemap: mode === 'production' ? false : 'linked',
    target: ['es2020', 'chrome100', 'safari15', 'firefox100', 'edge100'],
    jsx: 'automatic',
    legalComments: 'none',
    loader: { '.woff': 'file', '.woff2': 'file', '.png': 'file', '.webp': 'file', '.jpg': 'file', '.svg': 'file' },
    define: {
      'import.meta.env': JSON.stringify({ ...publicEnv, BASE_URL: base, MODE: mode, DEV: mode !== 'production', PROD: mode === 'production' }),
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    },
    logLevel: 'warning',
  };
}

const routes = JSON.parse(fs.readFileSync(path.join(root, 'src/config/routes.json'), 'utf8'));
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function writeHtml({ outdir, base, metafile, dev = false, brand = 'GREEN PLUG EV' }) {
  const outputs = Object.entries(metafile.outputs);
  const entry = outputs.find(([, o]) => o.entryPoint === 'src/main.tsx');
  if (!entry) throw new Error('Entry output not found');
  const rel = (p) => base + path.relative(outdir, path.join(root, p)).split(path.sep).join('/');
  const js = rel(entry[0]);
  const css = entry[1].cssBundle ? rel(entry[1].cssBundle) : null;
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replaceAll('%BASE_URL%', base);
  const tags = [
    css ? `<link rel="stylesheet" href="${css}">` : '',
    `<script type="module" src="${js}"></script>`,
    dev ? `<script>new EventSource('/esbuild').addEventListener('change', () => location.reload())</script>` : '',
  ].filter(Boolean).join('\n    ');
  html = html.replace('<!--app-assets-->', tags);
  const page = (r) => html.replaceAll('%TITLE%', esc(`${r.title} | ${brand}`)).replaceAll('%DESCRIPTION%', esc(r.description));
  fs.writeFileSync(path.join(outdir, 'index.html'), page(routes[0]));
  if (!dev) {
    // One real HTML file per route so GitHub Pages answers 200 (with the right title) for deep links.
    for (const r of base === './' ? [] : routes.slice(1)) {
      const dir = path.join(outdir, r.path.replace(/^\//, ''));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), page(r));
    }
    // Unknown paths get the app too, which renders its not-found page.
    fs.writeFileSync(path.join(outdir, '404.html'), page({ title: 'Page not found', description: routes[0].description }));
    fs.writeFileSync(path.join(outdir, '.nojekyll'), '');
  }
}

export function copyPublic(outdir) {
  const pub = path.join(root, 'public');
  if (fs.existsSync(pub)) fs.cpSync(pub, outdir, { recursive: true });
}

async function main() {
  const mode = 'production';
  const env = loadEnv(mode);
  const base = normalizeBase(env.BASE_PATH ?? '/');
  const outdir = path.join(root, 'dist');
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const t0 = Date.now();
  const result = await esbuild.build(esbuildOptions({ mode, base, outdir, env }));
  copyPublic(outdir);
  writeHtml({ outdir, base, metafile: result.metafile, brand: 'GREEN PLUG EV' });
  const sizes = Object.entries(result.metafile.outputs)
    .map(([file, o]) => `  ${path.relative(root, file).padEnd(48)} ${(o.bytes / 1024).toFixed(1).padStart(8)} kB`)
    .join('\n');
  console.log(`Built in ${Date.now() - t0} ms  (base: ${base}, leads endpoint: ${env.VITE_LEADS_ENDPOINT ? 'configured' : 'not configured - demo mode'})\n${sizes}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
