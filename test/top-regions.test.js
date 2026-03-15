const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseSvgToContours, validateAndClassifyContours } = require('../server');

const svg = fs.readFileSync(path.join(__dirname, '../fixtures/island-pocket-frame.svg'), 'utf8');

const parseErrors = [];
const parsed = parseSvgToContours(svg, parseErrors);
assert.deepStrictEqual(parseErrors, [], `parse errors: ${parseErrors.join('; ')}`);

const validationErrors = [];
const geometry = validateAndClassifyContours(parsed.contours, validationErrors);
assert.deepStrictEqual(validationErrors, [], `validation errors: ${validationErrors.join('; ')}`);

assert.ok(Array.isArray(geometry.topRegions), 'topRegions must be an array');
assert.ok(geometry.topRegions.length >= 2, 'island case must produce multiple top solid regions');

const boardOuter = closeRing(geometry.outer);
geometry.topRegions.forEach((region, idx) => {
  assert.ok(Array.isArray(region.outer), `region ${idx}: outer must be an array`);
  assert.ok(Array.isArray(region.holes), `region ${idx}: holes must be an array`);

  const outer = closeRing(region.outer);
  assert.ok(isRingClosed(outer), `region ${idx}: outer must be closed`);
  assert.ok(!hasSequentialDuplicates(outer), `region ${idx}: outer must not contain sequential duplicates`);
  assert.ok(!isSelfIntersecting(outer), `region ${idx}: outer must not self-intersect`);
  assert.ok(Math.abs(polygonArea(outer)) > 1e-3, `region ${idx}: outer area must be non-degenerate`);
  assert.ok(outer.slice(0, -1).every((point) => pointInOrOnPolygon(point, boardOuter)), `region ${idx}: outer must be inside board`);

  region.holes.forEach((hole, holeIdx) => {
    const closedHole = closeRing(hole);
    assert.ok(isRingClosed(closedHole), `region ${idx} hole ${holeIdx}: hole must be closed`);
    assert.ok(!hasSequentialDuplicates(closedHole), `region ${idx} hole ${holeIdx}: hole must not contain sequential duplicates`);
    assert.ok(!isSelfIntersecting(closedHole), `region ${idx} hole ${holeIdx}: hole must not self-intersect`);
    assert.ok(Math.abs(polygonArea(closedHole)) > 1e-3, `region ${idx} hole ${holeIdx}: hole area must be non-degenerate`);
    assert.ok(closedHole.slice(0, -1).every((point) => pointInOrOnPolygon(point, outer)), `region ${idx} hole ${holeIdx}: hole must be inside region outer`);
  });
});

const islandPoint = { x: 50, y: 50 };
const islandRegion = geometry.topRegions.find((region) => pointInPolygon(islandPoint, closeRing(region.outer)));
assert.ok(islandRegion, 'topRegions must keep isolated island material near center');

console.log(`OK: top-regions regression passed, regions: ${geometry.topRegions.length}`);

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


function pointInOrOnPolygon(point, polygon) {
  if (pointInPolygon(point, polygon)) return true;
  for (let i = 0; i < polygon.length - 1; i++) {
    if (pointOnSegment(point, polygon[i], polygon[i + 1])) return true;
  }
  return false;
}

function pointOnSegment(point, a, b, eps = 1e-6) {
  if (Math.abs(orient(a, b, point)) > eps) return false;
  const minX = Math.min(a.x, b.x) - eps;
  const maxX = Math.max(a.x, b.x) + eps;
  const minY = Math.min(a.y, b.y) - eps;
  const maxY = Math.max(a.y, b.y) + eps;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
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

function samePoint(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}
