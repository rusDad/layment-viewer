import assert from 'node:assert/strict';
import { createNcPreview } from '../public/nc/NcPreview.js';

function createHarness() {
  let latestSelection = null;
  let sourceLines = [];
  const noop = () => {};
  const ncScene = new Proxy({
    buildNcPreview: () => ({ motionLineBatches: [], colorLegend: null })
  }, { get: (target, property) => target[property] ?? noop });
  const ncUi = new Proxy({
    getNcVisualSettings: () => ({ opacity: 0.3, colorStrategy: 'motion', colors: {} }),
    showSelection: (selection) => { latestSelection = selection; },
    setSourceDocument: (lines) => { sourceLines = lines; }
  }, { get: (target, property) => target[property] ?? noop });
  const ncPicking = new Proxy({}, { get: () => noop });
  const preview = createNcPreview({
    viewerMode: 'debug',
    isPreviewMode: () => false,
    ncColorInputs: {}
  }, {
    createScene: () => ncScene,
    createUi: () => ncUi,
    createPicking: () => ncPicking
  });
  return { preview, getSelection: () => latestSelection, getSourceLines: () => sourceLines };
}

const cold = createHarness();
assert.doesNotThrow(() => cold.preview.clearNcPreview(), 'clearing before the first document must be safe');

const lifecycle = createHarness();
const dimensions = { width: 100, height: 80, thickness: 20 };
await assert.doesNotReject(
  lifecycle.preview.openNcDocument({ text: 'G90\nG0 X0 Y0\nG1 X10 Y10 F100', filename: 'valid.nc', dimensions }),
  'opening a valid NC document from cold state must be safe'
);

lifecycle.preview.selectSourceLine(lifecycle.getSourceLines().at(-1).lineId);
assert.equal(lifecycle.getSelection().orderedLineIds.length, 1, 'fixture must establish a selection in the first document');
assert.equal(
  await lifecycle.preview.openNcDocument({ text: 'G90\nM30', filename: 'no-motion.nc', dimensions }),
  false
);
assert.deepEqual(lifecycle.getSelection().orderedLineIds, [], 'a document without motion must clear the previous selection');

console.log('OK: NC preview lifecycle regression cases passed.');
