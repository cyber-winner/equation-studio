import test from 'node:test';
import assert from 'node:assert/strict';
import { traceHighDetail } from '../src/high-detail.js';
import { svgText } from '../src/trace.js';

function image(width, height, pixel) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(pixel(x, y), (y * width + x) * 4);
  return { rgba, width, height };
}
test('multi-megapixel sampling supports more than the old 768-pixel limit', () => {
  const input = image(2048, 1024, () => [255, 255, 255, 255]);
  let last = 0;
  const result = traceHighDetail({ ...input, levels: 1 }, value => {
    assert.ok(value >= last && value <= 1); last = value;
  });
  assert.equal(result.count, 0); assert.equal(last, 1);
  assert.equal(result.width * result.height, 2097152);
});
test('engraving adds tonal detail to a flat dark image with no contour edges', () => {
  const input = image(40, 40, () => [64, 64, 64, 255]);
  const result = traceHighDetail({ ...input, levels: 1 });
  assert.equal(result.contourCount, 0); assert.ok(result.shadingCount > 0);
  assert.ok(result.paths.every(path => path.strokeWidth > 0));
  assert.match(svgText(result), /<path stroke-width=/);
});
test('tiled contours span both sides of a tile boundary', () => {
  const result = traceHighDetail({ ...image(260, 16, (_, y) => y < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]), mode: 'contours', levels: 1 });
  const points = result.paths.flatMap(path => path.curves.flat());
  assert.ok(points.some(point => point[0] < 1));
  assert.ok(points.some(point => point[0] > 258));
  assert.equal(result.samplingLimited, false);
});
test('budget sampling is deterministic, bounded, and not cropped to the first tile', () => {
  const input = { ...image(260, 60, (x, y) => [(x * 17 + y * 11) % 255, 40, 80, 255]), budget: 20, levels: 1 };
  const a = traceHighDetail(input), b = traceHighDetail(input);
  assert.deepEqual(a, b); assert.ok(a.count <= 20); assert.equal(a.limited, true);
  assert.ok(a.paths.flatMap(path => path.curves).some(curve => curve[0][0] > 128));
});
test('transparent images stay blank and invalid budgets are rejected', () => {
  const input = image(8, 8, () => [0, 0, 0, 0]);
  assert.equal(traceHighDetail(input).count, 0);
  assert.throws(() => traceHighDetail({ ...input, budget: 250001 }));
  assert.throws(() => traceHighDetail({ ...input, spacing: 0 }));
});
