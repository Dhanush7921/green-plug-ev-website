// Local development: rebuilds the web app on change (esbuild watch) and rebuilds + restarts the API server
// when server code changes. Uses DATABASE_URL (default: local gpev_dev). Run `npm run db:setup` once first.
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer, root, webOptions, writeIndex } from './build.mjs';

const outdir = path.join(root, 'dist/web');
fs.mkdirSync(outdir, { recursive: true });
const web = await esbuild.context({
  ...webOptions(outdir),
  plugins: [{ name: 'index', setup: (b) => b.onEnd((r) => (r.errors.length ? console.log('web build failed') : (writeIndex(r.metafile, outdir), console.log('web rebuilt')))) }],
});
await web.watch();

let child = null;
const start = () => {
  child = spawn('node', ['--enable-source-maps', 'dist/server.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
};
await buildServer();
start();
let timer = null;
fs.watch(path.join(root, 'server/src'), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await buildServer();
      child?.kill('SIGTERM');
      start();
      console.log('server rebuilt and restarted');
    } catch (e) {
      console.error('server build failed:', e.message);
    }
  }, 150);
});
const stop = () => (child?.kill('SIGTERM'), web.dispose().then(() => process.exit(0)));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
