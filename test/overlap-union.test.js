const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseSvgToContours, validateAndClassifyContours } = require('../server');

const fixtures = [
  'overlap-circle-rect-side.svg',
  'overlap-circle-rect-vertical.svg',
  'overlap-rect-rect-side.svg',
  'overlap-rect-rect-t.svg',
  'overlap-real-contour-primitive.svg'
];

fixtures.forEach((fixtureName) => {
  const svg = fs.readFileSync(path.join(__dirname, `../fixtures/${fixtureName}`), 'utf8');

  const parseErrors = [];
  const parsed = parseSvgToContours(svg, parseErrors);
  assert.deepStrictEqual(parseErrors, [], `${fixtureName}: parse errors: ${parseErrors.join('; ')}`);

  const validationErrors = [];
  const geometry = validateAndClassifyContours(parsed.contours, validationErrors);
  assert.deepStrictEqual(validationErrors, [], `${fixtureName}: validation errors: ${validationErrors.join('; ')}`);

  assert.ok(Array.isArray(geometry.holes), `${fixtureName}: holes must be an array`);
  assert.strictEqual(geometry.holes.length, 1, `${fixtureName}: overlap pockets must be merged into one hole`);

  const outer = closeRing(geometry.outer);
  const hole = geometry.holes[0];
  const closedHole = closeRing(hole);

  assert.ok(Array.isArray(hole), `${fixtureName}: merged hole must be an array`);
  assert.ok(closedHole.length >= 8 && closedHole.length <= 2000, `${fixtureName}: merged hole must keep a reasonable amount of vertices`);
  assert.ok(isRingClosed(closedHole), `${fixtureName}: merged hole must be closed`);
  assert.ok(!hasSequentialDuplicates(closedHole), `${fixtureName}: merged hole must not contain sequential duplicates`);
  assert.ok(!isSelfIntersecting(closedHole), `${fixtureName}: merged hole must not self-intersect`);

  const holeArea = Math.abs(polygonArea(closedHole));
  const outerArea = Math.abs(polygonArea(outer));
  assert.ok(holeArea > 1e-3, `${fixtureName}: merged hole area must stay non-degenerate`);
  assert.ok(holeArea < outerArea * 0.95, `${fixtureName}: merged hole area must remain plausibly smaller than outer`);

  assert.ok(
    closedHole.slice(0, -1).every((point) => pointInPolygon(point, outer)),
    `${fixtureName}: merged hole must stay inside outer contour`
  );

  const holeBBox = calcBBox(closedHole);
  assert.ok(
    holeBBox.maxX - holeBBox.minX > 1e-3 && holeBBox.maxY - holeBBox.minY > 1e-3,
    `${fixtureName}: merged hole bbox must stay non-collapsed`
  );
});

console.log(`OK: overlap union regression passed for ${fixtures.length} fixtures.`);

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

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function calcBBox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

function samePoint(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}
