import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

test('all browser modules and the server have complete JavaScript syntax', () => {
  for (const path of ['src/app.js', 'src/worker.js', 'src/trace.js', 'src/high-detail.js', 'server.mjs']) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(path, root))], { encoding: 'utf8', timeout: 10000 });
    assert.equal(check.status, 0, `${path}: ${check.error?.message || check.stderr}`);
  }
});

test('HTML entry point and linked frontend assets exist', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /type="module" src="\/src\/app.js"/);
  const assets = [...html.matchAll(/(?:src|href)="(\/src\/[^"\s]+)"/g)];
  for (const [, path] of assets) assert.ok((await readFile(new URL(path.slice(1), root))).length > 0);
});

test('all literal DOM lookups refer to existing unique element IDs', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate element IDs');
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `Missing element: ${id}`);
});

test('upload and generation handlers are registered, and tracing receives pixel data', async () => {
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.match(app, /\$\('file'\)\.addEventListener\('change'/);
  assert.match(app, /\$\('drop-zone'\)\.addEventListener\('drop'/);
  assert.match(app, /\$\('generate'\)\.addEventListener\('click', generate\)/);
  assert.match(app, /task\.postMessage\(/);
  assert.match(app, /rgba: pixels/);
});
