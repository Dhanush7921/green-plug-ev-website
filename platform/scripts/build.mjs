// Builds the API server, the database CLI and the web app with esbuild (the compiler Vite uses).
//   node scripts/build.mjs            -> everything
//   node scripts/build.mjs server     -> server + cli only
//   node scripts/build.mjs web        -> web app only
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const what = process.argv[2] || 'all';
const prod = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');

export async function buildServer() {
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: { server: 'server/src/index.ts', cli: 'server/src/cli.ts' },
    outdir: 'dist',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'linked',
    logLevel: 'warning',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
}

export function webOptions(outdir = path.join(root, 'dist/web')) {
  return {
    absWorkingDir: root,
    entryPoints: { app: 'web/src/main.tsx' },
    outdir: path.join(outdir, 'assets'),
    entryNames: prod ? '[name]-[hash]' : '[name]',
    chunkNames: 'chunk-[hash]',
    assetNames: '[name]-[hash]',
    publicPath: '/app/assets/',
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: prod,
    sourcemap: prod ? false : 'linked',
    target: ['es2020', 'chrome100', 'safari15', 'firefox100'],
    jsx: 'automatic',
    metafile: true,
    legalComments: 'none',
    loader: { '.woff': 'file', '.woff2': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file', '.jpg': 'file' },
    define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
    logLevel: 'warning',
  };
}

export function writeIndex(metafile, outdir = path.join(root, 'dist/web')) {
  const entry = Object.entries(metafile.outputs).find(([, o]) => o.entryPoint === 'web/src/main.tsx');
  const rel = (p) => '/app/' + path.relative(outdir, path.join(root, p)).split(path.sep).join('/');
  const js = rel(entry[0]);
  const css = entry[1].cssBundle ? rel(entry[1].cssBundle) : null;
  let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  html = html.replace('<!--assets-->', [css && `<link rel="stylesheet" href="${css}">`, `<script type="module" src="${js}"></script>`].filter(Boolean).join('\n    '));
  fs.writeFileSync(path.join(outdir, 'index.html'), html);
  fs.cpSync(path.join(root, 'web/public'), outdir, { recursive: true });
}

export async function buildWeb() {
  const outdir = path.join(root, 'dist/web');
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const r = await esbuild.build(webOptions(outdir));
  writeIndex(r.metafile, outdir);
  return r;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const t = Date.now();
  if (what === 'all' || what === 'server') await buildServer();
  if (what === 'all' || what === 'web') {
    const r = await buildWeb();
    const size = Object.values(r.metafile.outputs).reduce((a, o) => a + o.bytes, 0);
    console.log(`web: ${(size / 1024).toFixed(0)} kB total`);
  }
  console.log(`built ${what} in ${Date.now() - t} ms${prod ? ' (production)' : ''}`);
}
