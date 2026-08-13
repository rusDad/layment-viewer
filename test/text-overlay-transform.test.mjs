import assert from 'node:assert/strict';
import { resolveTextOverlayTransform } from '../public/svg3d/TextOverlayTransform.js';

const EPSILON = 1e-9;

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);
}

function assertLeftBaselineAnchorPreserved(input) {
  const transform = resolveTextOverlayTransform(input);
  const halfWidth = input.widthMm / 2;
  const halfHeight = input.heightMm / 2;
  const localBaselineX = input.baselineXFromLeftMm - halfWidth;
  const localBaselineY = halfHeight - input.baselineYFromTopMm;
  const cos = Math.cos(transform.rotationZRad);
  const sin = Math.sin(transform.rotationZRad);
  const baselineOffsetX = localBaselineX * cos - localBaselineY * sin;
  const baselineOffsetY = localBaselineX * sin + localBaselineY * cos;

  assertClose(transform.x + baselineOffsetX, input.xMm, 'viewer X baseline anchor');
  assertClose(transform.y + baselineOffsetY, input.outerHeightMm - input.yMm, 'viewer Y baseline anchor');
}

const baseInput = {
  xMm: 30,
  yMm: 40,
  widthMm: 20,
  heightMm: 10,
  baselineXFromLeftMm: 1.2,
  baselineYFromTopMm: 8,
  outerHeightMm: 200
};

const unrotated = resolveTextOverlayTransform({
  ...baseInput,
  angleDeg: 0
});
assert.deepEqual(unrotated, { x: 38.8, y: 163, rotationZRad: -0 });

const quarterTurn = resolveTextOverlayTransform({
  ...baseInput,
  angleDeg: 90
});
assertClose(quarterTurn.x, 33, '90 degree center X');
assertClose(quarterTurn.y, 151.2, '90 degree center Y');
assertClose(quarterTurn.rotationZRad, -Math.PI / 2, '90 degree viewer rotation');

[0, 45, 90, 180, -30].forEach((angleDeg) => {
  assertLeftBaselineAnchorPreserved({ ...baseInput, angleDeg });
});

console.log('OK: text overlay left-baseline anchor regression passed');
