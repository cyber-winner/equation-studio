import { traceImage } from './trace.js';

self.onmessage = ({ data }) => {
  try {
    const { rgba, width, height, levels, tolerance, smoothing, budget, mode, spacing } = data;


    const outlineBudget = mode === 'engraving' ? Math.floor(budget * 0.35) : budget;
    const traceResult = traceImage(
      { rgba, width, height, levels, tolerance, smoothing, budget: outlineBudget },
      progress => self.postMessage({ type: 'progress', value: progress * 0.6 })
    );
    self.postMessage({ type: 'progress', value: 0.6 });


    const outlineStroke = mode === 'engraving' ? 0.45 : 0.7;
    const groups = new Map();
    let outlineCount = 0;
    for (const path of traceResult.paths) {
      const key = outlineStroke.toFixed(4);
      if (!groups.has(key)) groups.set(key, { strokeWidth: outlineStroke, curves: [] });
      for (const curve of path.curves) {
        groups.get(key).curves.push(curve);
        outlineCount++;
      }
    }


    let toneCount = 0;
    if (mode === 'engraving') {

      const gray = new Uint8Array(width * height);
      for (let i = 0; i < gray.length; i++) {
        const a = rgba[i * 4 + 3] / 255;
        gray[i] = Math.round((rgba[i * 4] * 0.2126 + rgba[i * 4 + 1] * 0.7152 + rgba[i * 4 + 2] * 0.0722) * a + 255 * (1 - a));
      }

      const toneBudget = budget - outlineBudget;
      const engravingSpacing = Math.max(2, spacing);


      for (let y = 0; y < height; y += engravingSpacing) {
        let start = 0, previous = -1;
        for (let x = 0; x <= width; x++) {
          const bucket = x === width ? -1 : Math.round((1 - gray[y * width + x] / 255) * 12);
          if (bucket !== previous) {
            if (previous > 0 && x > start && toneCount < toneBudget) {
              const a = start, b = x, yy = Math.min(height - 1, y + engravingSpacing / 2);
              const sw = engravingSpacing * 0.96 * previous / 12;
              const key = sw.toFixed(4);
              if (!groups.has(key)) groups.set(key, { strokeWidth: sw, curves: [] });
              groups.get(key).curves.push([[a, yy], [a + (b - a) / 3, yy], [a + 2 * (b - a) / 3, yy], [b, yy]]);
              toneCount++;
            }
            start = x; previous = bucket;
          }
        }
        if (y % (engravingSpacing * 10) === 0) {
          self.postMessage({ type: 'progress', value: 0.6 + 0.35 * (y / height) });
        }
      }
    }

    self.postMessage({ type: 'progress', value: 1 });
    const count = outlineCount + toneCount;
    self.postMessage({
      type: 'result',
      result: {
        paths: [...groups.values()], count, width, height, levels, mode,
        limited: traceResult.limited || toneCount >= (budget - outlineBudget),
        samplingLimited: traceResult.samplingLimited,
        candidateCount: traceResult.count + toneCount,
        contourCount: outlineCount, shadingCount: toneCount,
      },
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
