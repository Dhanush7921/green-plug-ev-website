// API test runner: builds the server, resets a dedicated test database, starts the API and runs node:test suites.
//   TEST_DATABASE_URL defaults to postgres://postgres:devpassword@127.0.0.1:5433/gpev_test
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:devpassword@127.0.0.1:5433/gpev_test';
const PORT = process.env.TEST_PORT || '8091';
const env = { ...process.env, DATABASE_URL, PORT, LOG_REQUESTS: '0', RATE_LIMIT_FACTOR: '50', DEMO_MODE: 'true', PAYMENT_PROVIDER: 'test', APP_ORIGIN: `http://127.0.0.1:${PORT}`, STORAGE_DIR: path.join(root, '.test-storage') };

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('node', ['scripts/build.mjs', 'server']);
run('node', ['dist/cli.mjs', 'reset']);

const server = spawn('node', ['dist/server.mjs'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['tests/api/*.test.mjs'];
const t = spawn('node', ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files], { cwd: root, env: { ...env, API_BASE: base }, stdio: 'inherit' });
const code = await new Promise((r) => t.on('exit', r));
server.kill('SIGTERM');
process.exit(code ?? 1);
