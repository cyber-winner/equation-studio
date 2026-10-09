import { equationText } from './trace.js';

const $ = id => document.getElementById(id);
const canvas = $('graph'), ctx = canvas.getContext('2d');
let source = null, raster = null, result = null, drawing = null, worker = null;
let busy = false, loading = false, loadToken = 0, frame = 0;
let scale = 1, offsetX = 0, offsetY = 0, viewWidth = 1, viewHeight = 1;
const pointers = new Map();
const controls = ['resolution', 'levels', 'tolerance', 'smoothing', 'budget', 'mode', 'spacing'];

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function buttons() {
  $('generate').disabled = !source || busy || loading;
  $('cancel').hidden = !busy;
  $('progress').hidden = !busy;
  for (const id of ['svg', 'equations', 'copy']) $(id).disabled = !result?.count || busy || loading;
}
function cancel(message = 'Tracing cancelled. Adjust the settings and try again.') {
  if (worker) worker.terminate();
  worker = null;
  busy = false;
  buttons();
  if (message) status(message);
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
}
function fit() {
  const image = raster || source;
  if (image) {
    scale = Math.min((viewWidth - 50) / image.width, (viewHeight - 50) / image.height);
    scale = Math.max(.05, Math.min(100, scale));
    offsetX = (viewWidth - image.width * scale) / 2;
    offsetY = (viewHeight - image.height * scale) / 2;
  } else { offsetX = viewWidth / 2; offsetY = viewHeight / 2; scale = 1; }
  schedule();
}
function resize() {
  const bounds = canvas.getBoundingClientRect();
  const oldWidth = viewWidth, oldHeight = viewHeight;
  viewWidth = bounds.width; viewHeight = bounds.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(viewWidth * dpr); canvas.height = Math.round(viewHeight * dpr);
  offsetX += (viewWidth - oldWidth) / 2; offsetY += (viewHeight - oldHeight) / 2;
  schedule();
}
function draw() {
  const dpr = canvas.width / Math.max(1, viewWidth);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f1f3ea'; ctx.fillRect(0, 0, viewWidth, viewHeight);
  if ($('grid').checked) {
    const raw = 65 / scale, magnitude = 10 ** Math.floor(Math.log10(raw));
    const unit = raw / magnitude;
    const step = (unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * magnitude;
    ctx.lineWidth = 1; ctx.font = '9px monospace';
    for (let axis = 0; axis < 2; axis++) {
      const offset = axis ? offsetY : offsetX, size = axis ? viewHeight : viewWidth;
      const start = Math.floor(-offset / scale / step), end = Math.ceil((size - offset) / scale / step);
      for (let i = start; i <= end; i++) {
        const position = offset + i * step * scale;
        ctx.strokeStyle = i === 0 ? '#70968960' : '#70968923';
        ctx.beginPath();
        ctx.moveTo(axis ? 0 : position, axis ? position : 0);
        ctx.lineTo(axis ? viewWidth : position, axis ? position : viewHeight); ctx.stroke();
        ctx.fillStyle = '#7b9385';
        const label = Number((i * step * (axis ? -1 : 1)).toPrecision(5));
        ctx.fillText(String(label), axis ? 5 : position + 4, axis ? position - 4 : viewHeight - 7);
      }
    }
  }
  ctx.save(); ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
  const image = raster || source;
  if (image) {
    const opacity = Number($('overlay').value) / 100;
    if (opacity > 0 || !result) { ctx.globalAlpha = result ? opacity : .5; ctx.drawImage(image, 0, 0); ctx.globalAlpha = 1; }
  }
  if (drawing) {
    ctx.strokeStyle = '#162c30';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const group of drawing) {
      ctx.lineWidth = Math.max(group.strokeWidth, 1 / scale);
      ctx.stroke(group.path);
    }
  }
  ctx.restore();
  $('zoom-value').textContent = `${Math.round(scale * 100)}%`;
}
function zoom(factor, x = viewWidth / 2, y = viewHeight / 2) {
  const next = Math.max(.05, Math.min(100, scale * factor));
  offsetX = x - (x - offsetX) * next / scale;
  offsetY = y - (y - offsetY) * next / scale;
  scale = next; schedule();
}
function resetSource(image, name) {
  source = image; raster = null; result = null; drawing = null;
  $('file-name').textContent = name; $('file-name').title = name;
  $('empty').hidden = true;
  for (const id of ['stat-curves', 'stat-paths', 'stat-size', 'stat-time']) $(id).textContent = '—';
  $('equation-preview').textContent = 'Generate a sketch to see its equations.';
  buttons(); fit(); status('Image ready. Choose your detail settings, then generate a sketch.');
}
async function loadFile(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { status('Choose a PNG, JPEG or WebP image.', true); return; }
  if (file.size > 20 * 1024 * 1024) { status('File is too large. Maximum size is 20MB.', true); return; }
  const token = ++loadToken;
  cancel(null); loading = true; buttons(); status('Reading your image locally…');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (token !== loadToken) return;
    if (bitmap.width < 2 || bitmap.height < 2) throw new Error('Choose an image at least 2 pixels per side.');
    const image = document.createElement('canvas');
    image.width = Math.max(2, bitmap.width); image.height = Math.max(2, bitmap.height);
    const context = image.getContext('2d');
    context.fillStyle = 'white'; context.fillRect(0, 0, image.width, image.height);
    context.drawImage(bitmap, 0, 0, image.width, image.height);

    resetSource(image, file.name);
    status(`Image loaded: ${bitmap.width} × ${bitmap.height}. Full resolution preserved. Choose Generate sketch to apply the selected sampling resolution.`);
  } catch (error) { if (token === loadToken) status(`Unable to decode or prepare this image: ${error.message}. Very large images may exceed browser memory; try a smaller copy.`, true); }
  finally { bitmap?.close(); if (token === loadToken) { loading = false; buttons(); } }
}
function sample() {
  ++loadToken; cancel(null); loading = false;
  const image = document.createElement('canvas'); image.width = 512; image.height = 512;
  const c = image.getContext('2d');
  c.fillStyle = '#faf8ee'; c.fillRect(0, 0, 512, 512);
  c.fillStyle = '#dedbd0'; c.beginPath(); c.ellipse(256, 423, 150, 19, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#42524a'; c.lineWidth = 5;
  for (let i = 0; i < 5; i++) {
    const x = 140 + i * 55, y = 80 + Math.abs(i - 2) * 35;
    c.beginPath(); c.moveTo(255, 302); c.quadraticCurveTo(x, 190, x, y); c.stroke();
    for (let j = 0; j < 3; j++) {
      c.fillStyle = ['#536657', '#83947d', '#a6b09a'][j];
      c.beginPath(); c.ellipse(x + (j % 2 ? 19 : -18), y + 20 + j * 35, 29, 12, j % 2 ? -.7 : .7, 0, Math.PI * 2); c.fill();
    }
  }
  const gradient = c.createLinearGradient(175, 0, 330, 0);
  gradient.addColorStop(0, '#667d78'); gradient.addColorStop(.45, '#c5cec0'); gradient.addColorStop(1, '#8a9f94');
  c.fillStyle = gradient; c.beginPath(); c.moveTo(207, 265); c.bezierCurveTo(220, 320, 148, 360, 201, 415); c.quadraticCurveTo(256, 445, 309, 415); c.bezierCurveTo(365, 360, 292, 320, 305, 265); c.closePath(); c.fill();
  c.strokeStyle = '#526e62'; c.lineWidth = 3; c.stroke();
  c.beginPath(); c.ellipse(256, 265, 49, 9, 0, 0, Math.PI * 2); c.fillStyle = '#536b60'; c.fill();
  resetSource(image, 'Botanical study · built-in sample');
}
function generate() {
  if (!source || busy || loading) return;
  const resolutionValue = Number($('resolution').value);
  const ratio = resolutionValue === 0 ? 1 : Math.min(1, resolutionValue / Math.max(source.width, source.height));
  const image = document.createElement('canvas');
  image.width = Math.max(2, Math.round(source.width * ratio)); image.height = Math.max(2, Math.round(source.height * ratio));
  const context = image.getContext('2d'); context.drawImage(source, 0, 0, image.width, image.height);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  busy = true; buttons(); $('progress').value = 0; status('Tracing tonal contours and fitting curves…');
  const start = performance.now();
  try {
    const task = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); worker = task;
    task.onmessage = async ({ data }) => {
      if (task !== worker) return;
      if (data.type === 'progress') { $('progress').value = data.value; return; }
      if (data.type === 'error') { cancel(null); status(data.message, true); return; }
      if (data.type !== 'result') return;
      const rendered = [];
      let built = 0;
      status('Preparing the detailed vector drawing…');
      try {
        for (const group of data.result.paths) {
          const sw = group.strokeWidth ?? .7;
          const batchSize = 5000;
          let path = new Path2D();
          let count = 0;
          for (const curve of group.curves) {
            path.moveTo(...curve[0]); path.bezierCurveTo(...curve[1], ...curve[2], ...curve[3]);
            count++;
            if (count >= batchSize) {
              rendered.push({ path, strokeWidth: sw });
              path = new Path2D();
              count = 0;
            }
            if (++built % 2000 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
              if (task !== worker) return;
            }
          }
          if (count > 0) rendered.push({ path, strokeWidth: sw });
        }
      } catch (error) {
        if (task === worker) { cancel(null); status(`Unable to render this detail level: ${error.message}. Try a lower equation budget.`, true); }
        return;
      }
      if (task !== worker) return;
      result = data.result; raster = image; drawing = rendered;
      $('stat-curves').textContent = result.count.toLocaleString();
      $('stat-paths').textContent = result.paths.length.toLocaleString();
      $('stat-size').textContent = `${result.width} × ${result.height}`;
      $('stat-time').textContent = `${((performance.now() - start) / 1000).toFixed(1)} s`;
      const curves = [];
      for (const group of result.paths) {
        curves.push(...group.curves.slice(0, 50 - curves.length));
        if (curves.length === 50) break;
      }
      const preview = { paths: [{ curves }] };
      $('equation-preview').textContent = equationText(preview) || 'No contours found. Try a higher-contrast image or more tonal layers.';
      cancel(null); fit();
      status(!result.count ? 'No contours found. Try more layers, lower simplification or a higher-contrast image.' : result.samplingLimited ? 'Sketch ready. The contour safety limit was reached; some detail was omitted. Try a smaller resolution.' : result.limited ? `Sketch ready: ${result.count.toLocaleString()} of ${result.candidateCount.toLocaleString()} candidate strokes retained across the image. Raise the budget, increase spacing or simplification to reduce omissions.` : 'Sketch ready. Pan, zoom or export your curves.');
    };
    task.onerror = event => {
      if (task !== worker) return;
      event.preventDefault();
      cancel(null);
      status('Tracing could not start. Serve the app with npm run dev and try again.', true);
    };
    task.onmessageerror = () => {
      if (task !== worker) return;
      cancel(null); status('Unable to read the tracing result. Try a smaller image.', true);
    };
    const budgetValue = Number($('budget').value);
    task.postMessage({
      rgba: pixels, width: image.width, height: image.height,
      levels: Number($('levels').value), tolerance: Number($('tolerance').value),
      smoothing: Number($('smoothing').value), budget: budgetValue === 0 ? Number.MAX_SAFE_INTEGER : budgetValue,
      mode: $('mode').value, spacing: Number($('spacing').value),
    }, [pixels.buffer]);
  } catch (error) {
    cancel(null); status(`Unable to generate sketch: ${error.message}`, true);
  }
}

function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadPNG() {
  if (!result?.count || !drawing) return;
  const w = result.width, h = result.height;
  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const oc = offscreen.getContext('2d');
  oc.fillStyle = '#f1f3ea';
  oc.fillRect(0, 0, w, h);
  oc.strokeStyle = '#162c30';
  oc.lineCap = 'round'; oc.lineJoin = 'round';
  for (const group of drawing) {
    oc.lineWidth = group.strokeWidth;
    oc.stroke(group.path);
  }
  offscreen.toBlob(blob => {
    if (!blob) { status('PNG export failed.', true); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'equation-sketch.png';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
function settingsChanged() {
  $('levels-value').textContent = $('levels').value;
  $('tolerance-value').textContent = `${$('tolerance').value} px`;
  $('smoothing-value').textContent = `${Math.round(Number($('smoothing').value) * 100)}%`;
  if (busy) cancel(null);
  if (source) status('Settings updated. Select Generate sketch to apply them.');
}

$('file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  void loadFile(file);
});
$('drop-zone').addEventListener('dragover', event => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  $('drop-zone').classList.add('dragging');
});
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
$('drop-zone').addEventListener('drop', event => {
  event.preventDefault();
  $('drop-zone').classList.remove('dragging');
  void loadFile(event.dataTransfer?.files?.[0]);
});

window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('generate').addEventListener('click', generate);
$('cancel').addEventListener('click', () => cancel());
$('demo').addEventListener('click', sample);
for (const id of controls) $(id).addEventListener('input', settingsChanged);
$('preset').addEventListener('change', () => {
  const presets = {
    outline: { resolution: 512, levels: 2, tolerance: 1.2, smoothing: .25, budget: 12000, mode: 'contours', spacing: 4 },
    balanced: { resolution: 2048, levels: 4, tolerance: .35, smoothing: .25, budget: 50000, mode: 'engraving', spacing: 3 },
    detailed: { resolution: 4096, levels: 8, tolerance: .1, smoothing: .15, budget: 250000, mode: 'engraving', spacing: 2 },
    ultra: { resolution: 8192, levels: 16, tolerance: .05, smoothing: .1, budget: 1000000, mode: 'engraving', spacing: 1 },
    unlimited: { resolution: 0, levels: 32, tolerance: .01, smoothing: .05, budget: 0, mode: 'engraving', spacing: 1 },
  };
  for (const [id, value] of Object.entries(presets[$('preset').value])) $(id).value = value;
  settingsChanged();
});
$('svg').addEventListener('click', () => downloadPNG());
$('equations').addEventListener('click', () => {
  if (result?.count) download(equationText(result), 'text/plain', 'equation-sketch.txt');
});
$('copy').addEventListener('click', async () => {
  if (!result?.count) return;
  const first = result.paths.find(path => path.curves.length)?.curves[0];
  if (!first) return;
  try {
    await navigator.clipboard.writeText(equationText({ paths: [{ curves: [first] }] }));
    status('First equation copied. Paste it into Desmos with t from 0 to 1.');
  } catch {
    status('Clipboard access is unavailable. Download the equations text instead.', true);
  }
});
$('grid').addEventListener('change', schedule);
$('overlay').addEventListener('input', schedule);
$('fit').addEventListener('click', fit);
$('zoom-in').addEventListener('click', () => zoom(1.25));
$('zoom-out').addEventListener('click', () => zoom(.8));
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewHeight : 1);
  zoom(Math.exp(-Math.max(-300, Math.min(300, delta)) * .002), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
canvas.addEventListener('keydown', event => {
  const actions = {
    ArrowLeft: () => { offsetX += 30; }, ArrowRight: () => { offsetX -= 30; },
    ArrowUp: () => { offsetY += 30; }, ArrowDown: () => { offsetY -= 30; },
    '+': () => zoom(1.25), '=': () => zoom(1.25), '-': () => zoom(.8), '0': fit,
  };
  if (actions[event.key]) { event.preventDefault(); actions[event.key](); schedule(); }
});
function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function gesture() {
  const list = [...pointers.values()];
  if (list.length < 2) return { ...list[0], distance: 0 };
  return { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2,
    distance: Math.hypot(list[1].x - list[0].x, list[1].y - list[0].y) };
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, pointerPosition(event));
});
canvas.addEventListener('pointermove', event => {
  const point = pointerPosition(event);
  $('coordinates').textContent = `x ${((point.x - offsetX) / scale).toFixed(1)} · y ${(-(point.y - offsetY) / scale).toFixed(1)}`;
  if (!pointers.has(event.pointerId)) return;
  const previous = gesture();
  pointers.set(event.pointerId, point);
  const next = gesture();
  if (previous.distance > 0 && next.distance > 0) zoom(next.distance / previous.distance, previous.x, previous.y);
  offsetX += next.x - previous.x; offsetY += next.y - previous.y;
  schedule();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, event => pointers.delete(event.pointerId));
}
window.addEventListener('blur', () => pointers.clear());
window.addEventListener('pagehide', () => { worker?.terminate(); worker = null; });
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe($('canvas-wrap'));
else window.addEventListener('resize', resize);
resize(); fit(); buttons();
