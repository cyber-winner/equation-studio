import test from 'node:test';
import assert from 'node:assert/strict';
import { simplify, toCurves, traceImage, equationText, svgText } from '../src/trace.js';

function image(width, height, pixel) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(pixel(x, y), (y * width + x) * 4);
  return { rgba, width, height };
}

test('uniform white and transparent images have no contours', () => {
  for (const color of [[255, 255, 255, 255], [0, 0, 0, 0]]) assert.equal(traceImage(image(16, 16, () => color)).count, 0);
});
test('a dark circle creates finite, connected curves', () => {
  const result = traceImage({ ...image(48, 48, (x, y) => Math.hypot(x - 24, y - 24) < 14 ? [0, 0, 0, 255] : [255, 255, 255, 255]), levels: 1 });
  assert.ok(result.count > 0);
  for (const path of result.paths) {
    assert.deepEqual(path.curves[0][0], path.curves.at(-1)[3]);
    for (let i = 0; i < path.curves.length; i++) {
      assert.ok(path.curves[i].flat().every(Number.isFinite));
      if (i) assert.deepEqual(path.curves[i - 1][3], path.curves[i][0]);
    }
  }
});
test('equation budget is strictly respected', () => {
  const result = traceImage({ ...image(32, 32, (x, y) => (x + y) % 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]), budget: 2, minLength: 0 });
  assert.ok(result.count <= 2);
  assert.equal(result.limited, true);
});
test('simplification retains endpoints and removes collinear points', () => {
  assert.deepEqual(simplify([[0, 0], [1, 1], [2, 2]], .1), [[0, 0], [2, 2]]);
  assert.deepEqual(toCurves([]), []);
});
test('exports contain one bounded parametric equation per curve', () => {
  const result = { width: 10, height: 10, paths: [{ curves: [[[0, 1], [2, 3], [4, 5], [6, 7]]] }] };
  assert.match(equationText(result), /-1\(1-t\)\^3/);
  assert.ok(equationText(result).endsWith('\\{0<=t<=1\\}'));
  assert.match(svgText(result), /viewBox="0 0 10 10"/);
  assert.match(svgText(result), /M 0 1 C 2 3 4 5 6 7/);
});
test('invalid sizes and settings are rejected', () => {
  assert.throws(() => traceImage({ rgba: [], width: 0, height: 10 }));
  assert.throws(() => traceImage({ ...image(2, 2, () => [0, 0, 0, 255]), tolerance: NaN }));
});
