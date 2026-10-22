// Development server with rebuild-on-save and live reload.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { root, loadEnv, esbuildOptions, writeHtml, copyPublic } from './build.mjs';

const mode = 'development';
const env = loadEnv(mode);
const base = '/';
const outdir = path.join(root, '.dev');
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });
copyPublic(outdir);

const htmlPlugin = {
  name: 'html',
  setup(build) {
    build.onEnd((result) => {
      if (result.metafile) writeHtml({ outdir, base, metafile: result.metafile, dev: true, brand: 'GREEN PLUG EV' });
    });
  },
};

const ctx = await esbuild.context({ ...esbuildOptions({ mode, base, outdir, env }), plugins: [htmlPlugin] });
await ctx.watch();
const port = Number(process.env.PORT || 5173);
const { hosts } = await ctx.serve({ servedir: outdir, port, fallback: path.join(outdir, 'index.html') });
console.log(`GREEN PLUG EV dev server: http://${hosts[0] === '0.0.0.0' ? 'localhost' : hosts[0]}:${port}/`);
