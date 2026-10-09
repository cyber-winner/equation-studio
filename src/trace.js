const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);


export function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = points[first], b = points[last];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    let farthest = -1, maximum = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
      const error = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
      if (error > maximum) { maximum = error; farthest = i; }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function toCurves(points, smoothing = 0.65) {
  if (points.length < 2) return [];
  const closed = distance(points[0], points[points.length - 1]) < 0.001;
  const p = closed ? points.slice(0, -1) : points;
  if (p.length < 2) return [];
  const curves = [];
  const at = i => closed ? p[(i + p.length) % p.length] : p[Math.max(0, Math.min(p.length - 1, i))];
  const amount = smoothing / 6;
  for (let i = 0; i < (closed ? p.length : p.length - 1); i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    if (distance(b, c) < 0.001) continue;
    curves.push([b, [b[0] + (c[0] - a[0]) * amount, b[1] + (c[1] - a[1]) * amount],
      [c[0] - (d[0] - b[0]) * amount, c[1] - (d[1] - b[1]) * amount], c]);
  }
  return curves;
}


export function contours(gray, width, height, threshold) {
  const nodes = new Map(), segments = [];
  let limited = false;
  const add = (a, b) => {
    const id = segments.length;
    segments.push([a.key, b.key]);
    for (const point of [a, b]) {
      if (!nodes.has(point.key)) nodes.set(point.key, { point: point.p, edges: [] });
      nodes.get(point.key).edges.push(id);
    }
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const values = [gray[y * width + x], gray[y * width + x + 1], gray[(y + 1) * width + x + 1], gray[(y + 1) * width + x]];
      const inside = values[0] < threshold;
      if (values.every(value => (value < threshold) === inside)) continue;
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const keys = [`h:${x}:${y}`, `v:${x + 1}:${y}`, `h:${x}:${y + 1}`, `v:${x}:${y}`];
      const crossings = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        if ((values[edge] < threshold) === (values[next] < threshold)) continue;
        const t = (threshold - values[edge]) / (values[next] - values[edge]);
        crossings.push({ key: keys[edge], p: [corners[edge][0] + (corners[next][0] - corners[edge][0]) * t, corners[edge][1] + (corners[next][1] - corners[edge][1]) * t] });
      }
      if (crossings.length === 2) add(crossings[0], crossings[1]);
      if (crossings.length === 4) {
        const centerInside = values.reduce((sum, v) => sum + v, 0) / 4 < threshold;
        if (centerInside === (values[0] < threshold)) {
          add(crossings[0], crossings[1]); add(crossings[2], crossings[3]);
        } else {
          add(crossings[0], crossings[3]); add(crossings[1], crossings[2]);
        }
      }
    }
  }
  const used = new Uint8Array(segments.length), paths = [];
  const walk = (key, edge) => {
    const points = [nodes.get(key).point];
    while (edge !== undefined && !used[edge]) {
      used[edge] = 1;
      const ends = segments[edge];
      key = ends[0] === key ? ends[1] : ends[0];
      const node = nodes.get(key);
      points.push(node.point);
      edge = node.edges.find(index => !used[index]);
    }
    paths.push(points);
  };
  for (const [key, node] of nodes) if (node.edges.length === 1 && !used[node.edges[0]]) walk(key, node.edges[0]);
  for (let i = 0; i < segments.length; i++) if (!used[i]) walk(segments[i][0], i);
  return { paths, limited };
}

export function traceImage({ rgba, width, height, levels = 4, tolerance = 1.2, smoothing = 0.65, budget = Number.MAX_SAFE_INTEGER, minLength = 8 }, progress = () => {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || rgba.length !== width * height * 4) throw new Error('Invalid image dimensions or pixel data.');
  if (!Number.isInteger(levels) || levels < 1 || !Number.isFinite(tolerance) || tolerance <= 0 || !Number.isFinite(smoothing) || smoothing < 0 || smoothing > 1 || !Number.isFinite(minLength) || minLength < 0) throw new Error('Invalid tracing settings.');
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    gray[i] = (rgba[i * 4] * .2126 + rgba[i * 4 + 1] * .7152 + rgba[i * 4 + 2] * .0722) * alpha + 255 * (1 - alpha);
  }
  const paths = [];
  let count = 0, limited = false, samplingLimited = false;
  for (let level = 1; level <= levels; level++) {
    const result = contours(gray, width, height, 255 * level / (levels + 1));
    samplingLimited ||= result.limited;
    const candidates = result.paths.map(points => ({ points, length: points.reduce((sum, p, i) => sum + (i ? distance(p, points[i - 1]) : 0), 0) }));
    candidates.sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      if (candidate.length < minLength) continue;
      const curves = toCurves(simplify(candidate.points, tolerance), smoothing);
      if (count + curves.length > budget) { limited = true; continue; }
      if (curves.length) { paths.push({ curves, level }); count += curves.length; }
    }
    progress(level / levels);
  }
  return { paths, count, width, height, levels, limited, samplingLimited };
}

const number = value => String(Number(value.toFixed(3)));
export function equation(curve) {
  const polynomial = axis => {
    const values = curve.map(point => axis ? -point[1] : point[0]);
    return `${number(values[0])}(1-t)^3+3(${number(values[1])})(1-t)^2t+3(${number(values[2])})(1-t)t^2+(${number(values[3])})t^3`;
  };
  return `(${polynomial(0)},${polynomial(1)})`;
}
export function equationText(result) {
  return result.paths.flatMap(path => path.curves.map(curve => `${equation(curve)}\\{0<=t<=1\\}`)).join('\n');
}
export function svgText(result) {
  const paths = result.paths.map(path => {
    const d = path.curves.map(c => `M ${c[0].map(number).join(' ')} C ${c.slice(1).flat().map(number).join(' ')}`).join(' ');
    const width = Number.isFinite(path.strokeWidth) ? path.strokeWidth : .7;
    return `<path stroke-width="${number(width)}" d="${d}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.width} ${result.height}" fill="none" stroke="#162c30" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</svg>`;
}
