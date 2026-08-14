const CIRCLE_SEGMENTS = 64;

export function parsePreviewSceneV1(value) {
  fail(!isRecord(value), 'payload must be an object');
  exactKeys(value, ['version', 'units', 'coordinateSystem', 'layment', 'pockets', 'texts'], 'scene');
  fail(value.version !== 1, 'version must be 1');
  fail(value.units !== 'mm', 'units must be mm');
  fail(value.coordinateSystem !== 'origin-bottom-left', 'coordinateSystem must be origin-bottom-left');

  const layment = value.layment;
  fail(!isRecord(layment), 'layment must be an object');
  exactKeys(layment, ['width', 'height', 'thicknessMm', 'baseMaterialColor'], 'layment');
  const width = positive(layment.width, 'layment.width');
  const height = positive(layment.height, 'layment.height');
  const thicknessMm = positive(layment.thicknessMm, 'layment.thicknessMm');
  fail(!['green', 'blue'].includes(layment.baseMaterialColor), 'invalid baseMaterialColor');

  const pockets = value.pockets;
  fail(!isRecord(pockets), 'pockets must be an object');
  exactKeys(pockets, ['contours', 'rects', 'circles'], 'pockets');
  const contours = array(pockets.contours, 'pockets.contours').map((item, index) => {
    exactKeys(item, ['ring', 'depthMm'], `contours[${index}]`);
    return { ring: ring(item.ring, `contours[${index}].ring`), depthMm: depth(item.depthMm, thicknessMm) };
  });
  const rects = array(pockets.rects, 'pockets.rects').map((item, index) => {
    exactKeys(item, ['corners', 'depthMm'], `rects[${index}]`);
    const corners = ring(item.corners, `rects[${index}].corners`);
    fail(corners.length !== 4, `rects[${index}].corners must contain four points`);
    return { corners, depthMm: depth(item.depthMm, thicknessMm) };
  });
  const circles = array(pockets.circles, 'pockets.circles').map((item, index) => {
    exactKeys(item, ['center', 'radius', 'depthMm'], `circles[${index}]`);
    return { center: point(item.center, `circles[${index}].center`), radius: positive(item.radius, `circles[${index}].radius`), depthMm: depth(item.depthMm, thicknessMm) };
  });
  const texts = array(value.texts, 'texts').map((item, index) => {
    exactKeys(item, ['text', 'x', 'y', 'angle', 'fontSizeMm'], `texts[${index}]`);
    fail(typeof item.text !== 'string' || !item.text.trim(), `texts[${index}].text must be non-empty`);
    return { text: item.text, x: finite(item.x, 'text.x'), y: finite(item.y, 'text.y'), angle: finite(item.angle, 'text.angle'), fontSizeMm: positive(item.fontSizeMm, 'text.fontSizeMm') };
  });
  return Object.freeze({ version: 1, units: 'mm', coordinateSystem: 'origin-bottom-left', layment: { width, height, thicknessMm, baseMaterialColor: layment.baseMaterialColor }, pockets: { contours, rects, circles }, texts });
}

export function buildPreviewSceneLayers(scene, clipping) {
  const footprint = [[[[0, 0], [scene.layment.width, 0], [scene.layment.width, scene.layment.height], [0, scene.layment.height], [0, 0]]]];
  const cuts = [
    ...scene.pockets.contours.map((p) => ({ depthMm: p.depthMm, polygon: [[close(p.ring)]] })),
    ...scene.pockets.rects.map((p) => ({ depthMm: p.depthMm, polygon: [[close(p.corners)]] })),
    ...scene.pockets.circles.map((p) => ({ depthMm: p.depthMm, polygon: [[circleRing(p.center, p.radius)]] }))
  ];
  const depths = [...new Set(cuts.map((cut) => cut.depthMm))].sort((a, b) => a - b);
  const boundaries = [0, ...depths, scene.layment.thicknessMm].filter((v, i, all) => i === 0 || v > all[i - 1]);
  const layers = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const topDepthMm = boundaries[index - 1];
    const bottomDepthMm = boundaries[index];
    const active = cuts.filter((cut) => cut.depthMm >= bottomDepthMm).map((cut) => cut.polygon);
    const union = active.length ? clipping.union(...active) : [];
    const regions = union.length ? clipping.difference(footprint, union) : footprint;
    layers.push({ topDepthMm, bottomDepthMm, regions, topology: summarizeTopology(regions) });
  }
  return { depths, layers };
}

export function circleRing(center, radius, segments = CIRCLE_SEGMENTS) {
  const points = Array.from({ length: segments }, (_, i) => {
    const angle = i * Math.PI * 2 / segments;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
  return close(points);
}

function summarizeTopology(regions) { return { polygons: regions.length, holes: regions.reduce((sum, polygon) => sum + Math.max(0, polygon.length - 1), 0) }; }
function close(points) { const result = points.map((p) => [p[0], p[1]]); const a = result[0], b = result[result.length - 1]; if (a[0] !== b[0] || a[1] !== b[1]) result.push([...a]); return result; }
function ring(value, label) { const points = array(value, label).map((p, i) => point(p, `${label}[${i}]`)); fail(points.length < 3, `${label} needs at least three points`); fail(Math.abs(area(points)) < 1e-8, `${label} is degenerate`); return points; }
function point(value, label) { fail(!Array.isArray(value) || value.length !== 2, `${label} must be [x,y]`); return [finite(value[0], label), finite(value[1], label)]; }
function area(points) { return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2; }
function depth(value, thickness) { const result = positive(value, 'depthMm'); fail(result > thickness, 'pocket depth exceeds layment thickness'); return result; }
function finite(value, label) { fail(typeof value !== 'number' || !Number.isFinite(value), `${label} must be finite`); return value; }
function positive(value, label) { const result = finite(value, label); fail(result <= 0, `${label} must be positive`); return result; }
function array(value, label) { fail(!Array.isArray(value), `${label} must be an array`); return value; }
function exactKeys(value, keys, label) { fail(!isRecord(value), `${label} must be an object`); const unknown = Object.keys(value).filter((key) => !keys.includes(key)); fail(unknown.length > 0, `${label} has unknown field ${unknown[0]}`); keys.forEach((key) => fail(!(key in value), `${label}.${key} is required`)); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(condition, message) { if (condition) throw new TypeError(`Invalid PreviewSceneV1: ${message}`); }
