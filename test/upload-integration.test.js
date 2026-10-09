import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { traceHighDetail } from '../src/high-detail.js';

const root = new URL('../', import.meta.url);
test('upload handler has no file-byte rejection and retains a high-resolution working copy', async () => {
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.doesNotMatch(app, /file\.size\s*>/);
  assert.doesNotMatch(app, /smaller than 20 MB/);
  assert.match(app, /4096 \/ Math\.max\(bitmap\.width, bitmap\.height\)/);
  assert.match(app, /mode: \$\('mode'\)\.value/);
  assert.match(app, /ctx\.lineWidth = group\.strokeWidth/);
});
test('high-detail worker dependency is served and the complete worker uses it', async () => {
  const worker = await readFile(new URL('src/worker.js', root), 'utf8');
  const server = await readFile(new URL('server.mjs', root), 'utf8');
  assert.match(worker, /import \{ traceHighDetail \} from '\.\/high-detail\.js'/);
  assert.match(server, /'\/src\/high-detail\.js'/);
  const rgba = new Uint8ClampedArray(16 * 16 * 4).fill(128);
  const result = traceHighDetail({ rgba, width: 16, height: 16, budget: 50000, mode: 'engraving' });
  assert.ok(result.count > 0);
  assert.ok(result.paths.every(path => path.strokeWidth > 0));
});
