import { processTileBatch, processHorizontalEngraving, processDiagonalEngraving } from './high-detail.js';

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'tiles') {
      const gray = new Uint8Array(data.grayBuffer);
      const curves = processTileBatch(gray, data.width, data.height, data.tiles, data.tileSize, data.thresholds, data.tolerance, data.smoothing);
      self.postMessage({ type: 'tiles-done', curves, workerId: data.workerId });
    } else if (data.type === 'engraving-h') {
      const gray = new Uint8Array(data.grayBuffer);
      const results = processHorizontalEngraving(gray, data.width, data.height, data.spacing, data.yStart, data.yEnd);
      self.postMessage({ type: 'engraving-done', results, workerId: data.workerId });
    } else if (data.type === 'engraving-d') {
      const gray = new Uint8Array(data.grayBuffer);
      const results = processDiagonalEngraving(gray, data.width, data.height, data.spacing, data.angle, data.sStart, data.sEnd, data.totalSteps);
      self.postMessage({ type: 'engraving-done', results, workerId: data.workerId });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
