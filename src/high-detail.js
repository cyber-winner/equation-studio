import { contours, simplify, toCurves } from './trace.js';


function boxSizesForGauss(sigma, nPasses) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / nPasses) + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - nPasses * wl * wl - 4 * nPasses * wl - 3 * nPasses) / (-4 * wl - 4));
  return Array.from({ length: nPasses }, (_, i) => i < m ? wl : wu);
}

function blurH(src, dst, w, h, r) {
  const iarr = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let ti = row, li = row, ri = row + r;
    const fv = src[row], lv = src[row + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[row + Math.min(j, w - 1)];
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri, row + w - 1)] - fv; dst[ti++] = val * iarr; ri++; }
    for (let j = r + 1; j < w - r; j++) { val += src[ri] - src[li]; dst[ti++] = val * iarr; li++; ri++; }
    for (let j = w - r; j < w; j++) { val += lv - src[li]; dst[ti++] = val * iarr; li++; }
  }
}

function blurV(src, dst, w, h, r) {
  const iarr = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let ti = x, li = x, ri = x + r * w;
    const fv = src[x], lv = src[x + w * (h - 1)];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[x + Math.min(j, h - 1) * w];
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri, x + w * (h - 1))] - fv; dst[ti] = val * iarr; ti += w; ri += w; }
    for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; dst[ti] = val * iarr; li += w; ti += w; ri += w; }
    for (let j = h - r; j < h; j++) { val += lv - src[li]; dst[ti] = val * iarr; li += w; ti += w; }
  }
}

export function fastBlur(src, w, h, radius) {
  if (radius < 1) return new Float32Array(src);
  const sigma = Math.max(1, radius / 2.5);
  const boxes = boxSizesForGauss(sigma, 3);
  const a = new Float32Array(src), b = new Float32Array(w * h);
  for (const box of boxes) {
    const r = Math.max(1, Math.floor((box - 1) / 2));
    blurH(a, b, w, h, r);
    blurV(b, a, w, h, r);
  }
  return a;
}


export function detectPhotoness(gray, width, height) {
  const len = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < len; i++) hist[Math.round(Math.max(0, Math.min(255, gray[i])))]++;
  let nonEmpty = 0;
  for (let i = 0; i < 256; i++) if (hist[i] > 0) nonEmpty++;
  let totalVar = 0, samples = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 40));
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const c = gray[y * width + x];
      const avg = (gray[(y - 1) * width + x] + gray[(y + 1) * width + x] + gray[y * width + x - 1] + gray[y * width + x + 1]) / 4;
      totalVar += Math.abs(c - avg);
      samples++;
    }
  }
  const avgVar = samples > 0 ? totalVar / samples : 0;
  return (nonEmpty / 256) * 0.6 + Math.min(1, avgVar / 8) * 0.4;
}


export function contrastStretch(gray, width, height) {
  const len = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < len; i++) hist[Math.round(Math.max(0, Math.min(255, gray[i])))]++;
  const cutoff = Math.floor(len * 0.01);
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cutoff) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cutoff) { hi = i; break; } }
  if (hi <= lo) return gray;
  const range = hi - lo, dst = new Float32Array(len);
  for (let i = 0; i < len; i++) dst[i] = Math.max(0, Math.min(255, ((gray[i] - lo) / range) * 255));
  return dst;
}

export function unsharpMask(original, blurred, width, height, amount) {
  const len = width * height, dst = new Float32Array(len);
  for (let i = 0; i < len; i++) dst[i] = Math.max(0, Math.min(255, original[i] + (original[i] - blurred[i]) * amount));
  return dst;
}


export function adaptiveThresholds(gray, width, height, levels) {
  const len = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < len; i++) hist[gray[i]]++;
  const cdf = new Float64Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
  const thresholds = [];
  for (let level = 1; level <= levels; level++) {
    const target = (level / (levels + 1)) * len;
    let lo = 0, hi = 255;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < target) lo = mid + 1; else hi = mid; }
    if (thresholds.length === 0 || lo !== thresholds[thresholds.length - 1]) thresholds.push(lo);
  }
  return thresholds;
}


export function preprocessImage(rgba, width, height, levels) {
  const grayF = new Float32Array(width * height);
  for (let i = 0; i < grayF.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    grayF[i] = (rgba[i * 4] * .2126 + rgba[i * 4 + 1] * .7152 + rgba[i * 4 + 2] * .0722) * a + 255 * (1 - a);
  }
  const photoness = detectPhotoness(grayF, width, height);
  let processed = grayF;
  if (photoness > 0.35) {
    const blurRadius = Math.max(1, Math.round(Math.min(width, height) / 500 * photoness));
    const blurred = fastBlur(grayF, width, height, blurRadius);
    processed = unsharpMask(grayF, blurred, width, height, 0.4 + photoness * 0.6);
    processed = contrastStretch(processed, width, height);
  }
  const grayU8 = new Uint8Array(width * height);
  for (let i = 0; i < processed.length; i++) grayU8[i] = Math.round(Math.max(0, Math.min(255, processed[i])));
  let thresholds;
  if (photoness > 0.35 && levels >= 3) {
    thresholds = adaptiveThresholds(grayU8, width, height, levels);
  } else {
    thresholds = [];
    for (let level = 1; level <= levels; level++) thresholds.push(255 * level / (levels + 1));
  }
  return { grayU8, photoness, thresholds };
}


export function processTileBatch(grayU8, imgWidth, imgHeight, tiles, tileSize, thresholds, tolerance, smoothing) {
  const curves = [];
  for (const { top, left } of tiles) {
    const tw = Math.min(tileSize + 1, imgWidth - left), th = Math.min(tileSize + 1, imgHeight - top);
    const tile = new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) tile.set(grayU8.subarray((top + y) * imgWidth + left, (top + y) * imgWidth + left + tw), y * tw);
    for (const threshold of thresholds) {
      const found = contours(tile, tw, th, threshold);
      for (const points of found.paths) {
        for (const curve of toCurves(simplify(points, tolerance), smoothing)) {
          curves.push(curve.map(p => [p[0] + left, p[1] + top]));
        }
      }
    }
  }
  return curves;
}


export function processHorizontalEngraving(grayU8, width, height, spacing, yStart, yEnd) {
  const results = [];
  for (let y = yStart; y < yEnd && y < height; y += spacing) {
    let start = 0, previous = -1;
    for (let x = 0; x <= width; x++) {
      const bucket = x === width ? -1 : Math.round((1 - grayU8[y * width + x] / 255) * 12);
      if (bucket !== previous) {
        if (previous > 0 && x > start) {
          const a = start, b = x, yy = Math.min(height - 1, y + spacing / 2);
          results.push({ curve: [[a, yy], [a + (b - a) / 3, yy], [a + 2 * (b - a) / 3, yy], [b, yy]], strokeWidth: spacing * .96 * previous / 12 });
        }
        start = x; previous = bucket;
      }
    }
  }
  return results;
}

export function processDiagonalEngraving(grayU8, width, height, spacing, angle, sStart, sEnd, totalSteps) {
  const results = [];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const diag = Math.abs(width * sin) + Math.abs(height * cos);
  const lineLen = Math.sqrt(width * width + height * height);
  const sampleCount = Math.ceil(lineLen);
  for (let s = sStart; s < sEnd && s < totalSteps; s++) {
    const offset = (s / totalSteps - 0.5) * diag;
    const cx = width / 2 + offset * sin, cy = height / 2 - offset * cos;
    let start = -1, startX = 0, startY = 0, previous = -1;
    for (let t = 0; t <= sampleCount; t++) {
      const frac = (t / sampleCount - 0.5) * lineLen;
      const px = Math.round(cx + frac * cos), py = Math.round(cy + frac * sin);
      let bucket = -1;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        bucket = Math.round((1 - grayU8[py * width + px] / 255) * 12);
      }
      if (bucket !== previous) {
        if (previous > 0 && start >= 0 && Math.hypot(px - startX, py - startY) > 1) {
          results.push({ curve: [[startX, startY], [startX + (px - startX) / 3, startY + (py - startY) / 3],
            [startX + 2 * (px - startX) / 3, startY + 2 * (py - startY) / 3], [px, py]], strokeWidth: spacing * .96 * previous / 12 });
        }
        start = t; startX = px; startY = py; previous = bucket;
      }
    }
  }
  return results;
}
