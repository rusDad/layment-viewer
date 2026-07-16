import assert from 'node:assert/strict';
import { resolveTextOverlayTransform } from '../public/svg3d/TextOverlayTransform.js';

const EPSILON = 1e-9;

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);
}

function assertTopLeftAnchorPreserved(input) {
  const transform = resolveTextOverlayTransform(input);
  const halfWidth = input.widthMm / 2;
  const halfHeight = input.heightMm / 2;
  const cos = Math.cos(transform.rotationZRad);
  const sin = Math.sin(transform.rotationZRad);
  const topLeftOffsetX = -halfWidth * cos - halfHeight * sin;
  const topLeftOffsetY = -halfWidth * sin + halfHeight * cos;

  assertClose(transform.x + topLeftOffsetX, input.xMm, 'viewer X anchor');
  assertClose(transform.y + topLeftOffsetY, input.outerHeightMm - input.yMm, 'viewer Y anchor');
}

const unrotated = resolveTextOverlayTransform({
  xMm: 30,
  yMm: 40,
  widthMm: 20,
  heightMm: 10,
  angleDeg: 0,
  outerHeightMm: 200
});
assert.deepEqual(unrotated, { x: 40, y: 155, rotationZRad: -0 });

const quarterTurn = resolveTextOverlayTransform({
  xMm: 30,
  yMm: 40,
  widthMm: 20,
  heightMm: 10,
  angleDeg: 90,
  outerHeightMm: 200
});
assertClose(quarterTurn.x, 25, '90 degree center X');
assertClose(quarterTurn.y, 150, '90 degree center Y');
assertClose(quarterTurn.rotationZRad, -Math.PI / 2, '90 degree viewer rotation');

[
  { xMm: 30, yMm: 40, widthMm: 20, heightMm: 10, angleDeg: 0, outerHeightMm: 200 },
  { xMm: 30, yMm: 40, widthMm: 20, heightMm: 10, angleDeg: 45, outerHeightMm: 200 },
  { xMm: 30, yMm: 40, widthMm: 20, heightMm: 10, angleDeg: 90, outerHeightMm: 200 },
  { xMm: 30, yMm: 40, widthMm: 20, heightMm: 10, angleDeg: 180, outerHeightMm: 200 },
  { xMm: 30, yMm: 40, widthMm: 20, heightMm: 10, angleDeg: -30, outerHeightMm: 200 }
].forEach(assertTopLeftAnchorPreserved);

console.log('OK: text overlay top-left anchor regression passed');
