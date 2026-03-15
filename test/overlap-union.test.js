const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseSvgToContours, validateAndClassifyContours } = require('../server');

const overlapSvg = fs.readFileSync(path.join(__dirname, '../fixtures/overlap-pockets.svg'), 'utf8');

const parseErrors = [];
const parsed = parseSvgToContours(overlapSvg, parseErrors);
assert.deepStrictEqual(parseErrors, [], `parse errors: ${parseErrors.join('; ')}`);

const validationErrors = [];
const geometry = validateAndClassifyContours(parsed.contours, validationErrors);
assert.deepStrictEqual(validationErrors, [], `validation errors: ${validationErrors.join('; ')}`);

assert.ok(Array.isArray(geometry.holes), 'holes must be an array');
assert.strictEqual(geometry.holes.length, 1, 'overlapping pockets must be merged into a single hole loop');

const hole = geometry.holes[0];
const closedHole = closeRing(hole);

assert.ok(Array.isArray(hole), 'merged hole loop must be an array');
assert.ok(hole.length >= 8, 'merged hole loop must keep a reasonable amount of vertices after cleanup');
assert.ok(isRingClosed(closedHole), 'merged hole loop must be closed');
assert.ok(!hasSequentialDuplicates(closedHole), 'merged hole loop must not contain sequential duplicate points');
assert.ok(!isSelfIntersecting(closedHole), 'merged hole loop must not self-intersect');
assert.ok(Math.abs(polygonArea(closedHole)) > 1e-4, 'merged hole loop area must stay non-degenerate');

console.log('OK: overlapping pockets are merged into one resulting hole loop.');

function isRingClosed(points, eps = 1e-6) {
  if (!points.length) return false;
  return samePoint(points[0], points[points.length - 1], eps);
}

function hasSequentialDuplicates(points, eps = 1e-6) {
  for (let i = 1; i < points.length; i++) {
    if (samePoint(points[i], points[i - 1], eps)) return true;
  }
  return false;
}

function closeRing(points) {
  if (!points.length) return [];
  return samePoint(points[0], points[points.length - 1]) ? points : [...points, { ...points[0] }];
}

function isSelfIntersecting(points) {
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 1; j < points.length - 1; j++) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === points.length - 2) continue;
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
  }
  return area / 2;
}

function samePoint(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}
