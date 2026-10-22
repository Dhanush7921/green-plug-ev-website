// Serves dist/ the way GitHub Pages does: files under BASE_PATH, unknown paths get 404.html.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root, loadEnv, normalizeBase } from './build.mjs';

const base = normalizeBase(process.env.BASE_PATH ?? loadEnv('production').BASE_PATH ?? '/');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.txt': 'text/plain' };

export function startPreview(p = port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!url.startsWith(base)) {
      res.writeHead(302, { Location: base });
      return res.end();
    }
    let file = path.join(dist, url.slice(base.length));
    if (!file.startsWith(dist)) { res.writeHead(400); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!url.endsWith('/')) {
        // GitHub Pages redirects /dir to /dir/
        const q = (req.url || '').includes('?') ? (req.url || '').slice((req.url || '').indexOf('?')) : '';
        res.writeHead(301, { Location: `${url}/${q}` });
        return res.end();
      }
      file = path.join(file, 'index.html');
    }
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': types['.html'] });
    fs.createReadStream(path.join(dist, '404.html')).pipe(res);
  });
  return new Promise((resolve) => server.listen(p, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'scripts', 'preview.mjs')) {
  await startPreview();
  console.log(`Preview: http://localhost:${port}${base}`);
}
