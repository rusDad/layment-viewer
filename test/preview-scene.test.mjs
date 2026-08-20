import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildPreviewSceneLayers, parsePreviewSceneV1 } from '../public/svg3d/PreviewSceneModel.mjs';
import { resolvePreviewTextTransform } from '../public/svg3d/PreviewTextTransform.js';
const require = createRequire(import.meta.url);
const clipping = require('polygon-clipping');
const load = (name) => parsePreviewSceneV1(JSON.parse(fs.readFileSync(new URL(`../fixtures/preview-scene/${name}.json`, import.meta.url))));
const EPSILON = 1e-9;

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);
}

function assertTextBaselinePreserved(input) {
  const transform = resolvePreviewTextTransform(input);
  const halfWidthMm = input.widthMm / 2;
  const halfHeightMm = input.heightMm / 2;
  const localBaselineX = input.baselineXFromLeftMm - halfWidthMm;
  const localBaselineY = halfHeightMm - input.baselineYFromTopMm;
  const cos = Math.cos(transform.rotationZRad);
  const sin = Math.sin(transform.rotationZRad);
  const worldBaselineX = transform.x + localBaselineX * cos - localBaselineY * sin;
  const worldBaselineY = transform.y + localBaselineX * sin + localBaselineY * cos;

  assertClose(worldBaselineX, input.xMm, 'preview text X baseline anchor');
  assertClose(worldBaselineY, input.yMm, 'preview text Y baseline anchor');
}

assert.throws(() => parsePreviewSceneV1({ version: 2 }), /version|unknown|required/);
const malformed = JSON.parse(fs.readFileSync(new URL('../fixtures/preview-scene/one-contour.json', import.meta.url)));
malformed.pockets.contours[0].depthMm = 36;
assert.throws(() => parsePreviewSceneV1(malformed), /exceeds/);

const expected = {
  'disjoint-depths': [10, 24],
  'overlap-shallow-deep': [10, 25],
  'nested-step': [12, 27],
  'rotated-asymmetric': [18],
  'rect-circle-depths': [11, 23],
  'identical-depth-overlap': [18]
};
for (const [name, depths] of Object.entries(expected)) {
  const scene = load(name);
  const model = buildPreviewSceneLayers(scene, clipping);
  assert.deepEqual(model.depths, depths, `${name}: depth levels`);
  assert.equal(model.layers.length, depths.length + 1, `${name}: depth intervals`);
  model.layers.forEach((layer) => {
    assert.ok(layer.regions.length > 0, `${name}: non-empty solid region`);
    assert.ok(layer.topology.polygons > 0, `${name}: polygon topology`);
    for (const polygon of layer.regions) for (const ring of polygon) for (const [x, y] of ring) {
      assert.ok(x >= -1e-8 && x <= scene.layment.width + 1e-8, `${name}: x mesh bound`);
      assert.ok(y >= -1e-8 && y <= scene.layment.height + 1e-8, `${name}: y mesh bound`);
    }
    assert.ok(layer.topDepthMm >= 0 && layer.bottomDepthMm <= scene.layment.thicknessMm, `${name}: z mesh bound`);
  });
}
const overlap = buildPreviewSceneLayers(load('overlap-shallow-deep'), clipping);
assert.equal(overlap.layers[0].topology.holes, 1);
assert.equal(overlap.layers[1].topology.holes, 1);
assert.equal(overlap.layers[2].topology.holes, 0);
const sameDepth = buildPreviewSceneLayers(load('identical-depth-overlap'), clipping);
assert.equal(sameDepth.layers[0].topology.holes, 1, 'identical-depth cuts are unioned');
const rotated = load('rotated-asymmetric');
assert.deepEqual(rotated.pockets.contours[0].ring, [[25,10],[91,29],[77,67],[56,47],[18,54]], 'ring orientation is preserved');
const text = load('bottom-left-text').texts[0];
assert.deepEqual([text.x, text.y, text.angle], [20, 30, 330]);

const textTransformInput = {
  xMm: text.x,
  yMm: text.y,
  widthMm: 20,
  heightMm: 10,
  baselineXFromLeftMm: 1.2,
  baselineYFromTopMm: 8
};
[0, 45, 90, 180, 330].forEach((angleDeg) => {
  assertTextBaselinePreserved({ ...textTransformInput, angleDeg });
});

console.log('OK: PreviewSceneV1 parser, topology and text baseline regression passed.');
