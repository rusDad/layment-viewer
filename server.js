const express = require('express');
const multer = require('multer');
const { XMLParser } = require('fast-xml-parser');
const arcToCubic = require('svg-arc-to-cubic-bezier');
const polygonClipping = require('polygon-clipping');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const BASE_DEPTH = 35;
const POCKET_DEPTH = 20;
const CURVE_STEP_MM = 0.5;
const UNION_RING_EPSILON = 1e-5;
// Snap holes to 0.0001 mm grid before polygon-clipping to suppress floating-noise vertices
// without affecting visible geometry in the viewer.
const UNION_INPUT_SNAP_STEP = 1e-4;
const UNION_DEBUG = process.env.UNION_DEBUG === '1';

app.use(express.static('public'));

app.post('/svg3d-api/upload-svg', upload.single('file'), (req, res) => {
  const errors = [];

  if (!req.file) {
    return res.status(400).json({ ok: false, errors: ['Файл не передан (поле file).'] });
  }

  const text = req.file.buffer.toString('utf8');
  if (!text.includes('<svg')) {
    return res.status(400).json({ ok: false, errors: ['Файл не похож на SVG.'] });
  }

  try {
    const data = parseSvgToContours(text, errors);
    if (errors.length > 0) {
      return res.status(400).json({ ok: false, errors });
    }

    const { outer, holes, topRegions, bbox, outerArea } = validateAndClassifyContours(data.contours, errors);
    if (errors.length > 0) {
      return res.status(400).json({ ok: false, errors });
    }

    return res.json({
      ok: true,
      errors: [],
      meta: {
        bbox,
        outerArea,
        holesCount: holes.length
      },
      geometry: {
        outer,
        holes,
        topRegions,
        extrusion: {
          baseDepth: BASE_DEPTH,
          pocketDepth: POCKET_DEPTH
        }
      }
    });
  } catch (e) {
    return res.status(400).json({ ok: false, errors: [`Ошибка обработки SVG: ${e.message}`] });
  }
});

if (require.main === module) {
  app.listen(3000, () => {
    console.log('Server on http://localhost:3000');
  });
}

function parseSvgToContours(svgText, errors) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const xml = parser.parse(svgText);
  const svg = xml.svg;

  if (!svg) {
    errors.push('Корневой тег <svg> не найден.');
    return { contours: [] };
  }

  const viewBox = parseViewBox(svg['@_viewBox']);
  const nodes = [];
  collectNodes(svg, nodes, identityMatrix());

  const contours = [];
  for (const node of nodes) {
    if (!node || !node.tag) continue;

    if (node.tag === 'path' && node.attrs['@_d']) {
      const localContours = flattenPath(node.attrs['@_d']);
      localContours.forEach((c) => contours.push(normalizeContour(applyMatrixToContour(c, node.matrix), viewBox)));
    } else if (node.tag === 'polygon' && node.attrs['@_points']) {
      const pts = parsePolygonPoints(node.attrs['@_points']);
      if (pts.length >= 3) {
        if (!samePoint(pts[0], pts[pts.length - 1])) pts.push({ ...pts[0] });
        contours.push(normalizeContour(applyMatrixToContour(pts, node.matrix), viewBox));
      }
    } else if (node.tag === 'rect') {
      const x = num(node.attrs['@_x'], 0);
      const y = num(node.attrs['@_y'], 0);
      const w = num(node.attrs['@_width'], 0);
      const h = num(node.attrs['@_height'], 0);
      if (w > 0 && h > 0) {
        contours.push(normalizeContour(applyMatrixToContour([
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
          { x, y }
        ], node.matrix), viewBox));
      }
    } else if (node.tag === 'circle') {
      const cx = num(node.attrs['@_cx'], 0);
      const cy = num(node.attrs['@_cy'], 0);
      const r = num(node.attrs['@_r'], 0);
      if (r > 0) contours.push(normalizeContour(applyMatrixToContour(sampleCircle(cx, cy, r), node.matrix), viewBox));
    } else if (node.tag === 'ellipse') {
      const cx = num(node.attrs['@_cx'], 0);
      const cy = num(node.attrs['@_cy'], 0);
      const rx = num(node.attrs['@_rx'], 0);
      const ry = num(node.attrs['@_ry'], 0);
      if (rx > 0 && ry > 0) contours.push(normalizeContour(applyMatrixToContour(sampleEllipse(cx, cy, rx, ry), node.matrix), viewBox));
    }
  }

  if (contours.length === 0) {
    errors.push('Не найдено замкнутых контуров (path/polygon/rect/circle/ellipse).');
  }

  return { contours };
}

function collectNodes(node, out, parentMatrix) {
  const keys = Object.keys(node || {}).filter((key) => !key.startsWith('@_'));
  for (const key of keys) {
    const value = node[key];
    if (!value) continue;

    const collectChild = (tag, childNode) => {
      if (!childNode || typeof childNode !== 'object') return;
      const nodeTransform = parseTransform(childNode['@_transform']);
      const current = multiplyMatrix(parentMatrix, nodeTransform);
      if (['path', 'polygon', 'rect', 'circle', 'ellipse'].includes(tag)) {
        out.push({ tag, attrs: childNode, matrix: current });
      }
      collectNodes(childNode, out, current);
    };

    if (Array.isArray(value)) {
      value.forEach((v) => collectChild(key, v));
    } else {
      collectChild(key, value);
    }
  }
}

function identityMatrix() {
  return [1, 0, 0, 1, 0, 0];
}

function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function applyToPoint(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
  };
}

function applyMatrixToContour(points, matrix) {
  return points.map((point) => applyToPoint(matrix, point));
}

function parseTransform(rawTransform) {
  if (!rawTransform || typeof rawTransform !== 'string') return identityMatrix();

  const transformRegex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  let matrix = identityMatrix();

  while ((match = transformRegex.exec(rawTransform)) !== null) {
    const op = match[1].toLowerCase();
    const values = (match[2].match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    let opMatrix = null;

    if (op === 'matrix') {
      if (values.length === 6 && values.every(Number.isFinite)) {
        opMatrix = values;
      } else {
        console.warn(`SVG transform matrix() пропущен из-за невалидных параметров: "${match[0]}"`);
      }
    } else if (op === 'translate') {
      if (values.length >= 1 && values.every(Number.isFinite)) {
        opMatrix = [1, 0, 0, 1, values[0], values[1] || 0];
      } else {
        console.warn(`SVG transform translate() пропущен из-за невалидных параметров: "${match[0]}"`);
      }
    } else {
      console.warn(`SVG transform "${op}" пока не поддерживается и будет проигнорирован.`);
    }

    if (opMatrix) {
      matrix = multiplyMatrix(opMatrix, matrix);
    }
  }

  return matrix;
}

function parseViewBox(vb) {
  if (!vb) return null;
  const parts = vb.split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
}

function normalizeContour(points, viewBox) {
  const normalized = points.map((p) => ({
    x: viewBox ? p.x - viewBox.minX : p.x,
    y: viewBox ? p.y - viewBox.minY : p.y
  }));
  return dedupeSequential(normalized);
}

function flattenPath(d) {
  const tokens = tokenizePath(d);
  const contours = [];

  let current = { x: 0, y: 0 };
  let start = null;
  let contour = [];

  const pushPoint = (pt) => {
    contour.push({ x: pt.x, y: pt.y });
    current = { x: pt.x, y: pt.y };
  };

  for (const t of tokens) {
    const cmd = t.cmd;
    const rel = t.rel;
    const vals = t.values;

    if (cmd === 'M') {
      if (contour.length > 0) closeContour(contour, contours);
      const x = rel ? current.x + vals[0] : vals[0];
      const y = rel ? current.y + vals[1] : vals[1];
      contour = [{ x, y }];
      current = { x, y };
      start = { x, y };
      for (let i = 2; i < vals.length; i += 2) {
        const nx = rel ? current.x + vals[i] : vals[i];
        const ny = rel ? current.y + vals[i + 1] : vals[i + 1];
        pushPoint({ x: nx, y: ny });
      }
    } else if (cmd === 'L') {
      for (let i = 0; i < vals.length; i += 2) {
        const nx = rel ? current.x + vals[i] : vals[i];
        const ny = rel ? current.y + vals[i + 1] : vals[i + 1];
        pushPoint({ x: nx, y: ny });
      }
    } else if (cmd === 'H') {
      for (const v of vals) {
        pushPoint({ x: rel ? current.x + v : v, y: current.y });
      }
    } else if (cmd === 'V') {
      for (const v of vals) {
        pushPoint({ x: current.x, y: rel ? current.y + v : v });
      }
    } else if (cmd === 'C') {
      for (let i = 0; i < vals.length; i += 6) {
        const p1 = { x: rel ? current.x + vals[i] : vals[i], y: rel ? current.y + vals[i + 1] : vals[i + 1] };
        const p2 = { x: rel ? current.x + vals[i + 2] : vals[i + 2], y: rel ? current.y + vals[i + 3] : vals[i + 3] };
        const p3 = { x: rel ? current.x + vals[i + 4] : vals[i + 4], y: rel ? current.y + vals[i + 5] : vals[i + 5] };
        sampleCubic(current, p1, p2, p3).forEach((p) => pushPoint(p));
      }
    } else if (cmd === 'Q') {
      for (let i = 0; i < vals.length; i += 4) {
        const p1 = { x: rel ? current.x + vals[i] : vals[i], y: rel ? current.y + vals[i + 1] : vals[i + 1] };
        const p2 = { x: rel ? current.x + vals[i + 2] : vals[i + 2], y: rel ? current.y + vals[i + 3] : vals[i + 3] };
        sampleQuadratic(current, p1, p2).forEach((p) => pushPoint(p));
      }
    } else if (cmd === 'A') {
      for (let i = 0; i < vals.length; i += 7) {
        const arc = {
          px: current.x,
          py: current.y,
          rx: vals[i],
          ry: vals[i + 1],
          xAxisRotation: vals[i + 2],
          largeArcFlag: vals[i + 3],
          sweepFlag: vals[i + 4],
          cx: rel ? current.x + vals[i + 5] : vals[i + 5],
          cy: rel ? current.y + vals[i + 6] : vals[i + 6]
        };
        const cubics = arcToCubic(arc);
        for (const c of cubics) {
          sampleCubic(current, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }).forEach((p) => pushPoint(p));
        }
      }
    } else if (cmd === 'Z') {
      if (start) pushPoint(start);
      closeContour(contour, contours);
      contour = [];
      start = null;
    }
  }

  if (contour.length > 0) closeContour(contour, contours);
  return contours;
}

function closeContour(contour, contours) {
  if (contour.length < 3) return;
  if (!samePoint(contour[0], contour[contour.length - 1])) contour.push({ ...contour[0] });
  contours.push(dedupeSequential(contour));
}

function tokenizePath(d) {
  const segs = d.match(/[a-zA-Z][^a-zA-Z]*/g) || [];
  return segs.map((seg) => {
    const cmdRaw = seg[0];
    const cmd = cmdRaw.toUpperCase();
    const rel = cmdRaw !== cmd;
    const values = (seg.slice(1).match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    return { cmd, rel, values };
  });
}

function sampleCubic(p0, p1, p2, p3) {
  const len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const steps = Math.max(4, Math.ceil(len / CURVE_STEP_MM));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: Math.pow(1 - t, 3) * p0.x + 3 * Math.pow(1 - t, 2) * t * p1.x + 3 * (1 - t) * t * t * p2.x + t * t * t * p3.x,
      y: Math.pow(1 - t, 3) * p0.y + 3 * Math.pow(1 - t, 2) * t * p1.y + 3 * (1 - t) * t * t * p2.y + t * t * t * p3.y
    });
  }
  return points;
}

function sampleQuadratic(p0, p1, p2) {
  const len = dist(p0, p1) + dist(p1, p2);
  const steps = Math.max(4, Math.ceil(len / CURVE_STEP_MM));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
      y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y
    });
  }
  return points;
}

function validateAndClassifyContours(rawContours, errors) {
  const contours = rawContours
    .map((c) => dedupeSequential(c))
    .filter((c) => c.length >= 4 && samePoint(c[0], c[c.length - 1]));

  if (contours.length === 0) {
    errors.push('Нет замкнутых контуров.');
    return {};
  }

  const withArea = contours.map((c, idx) => ({ idx, points: c, area: polygonArea(c), absArea: Math.abs(polygonArea(c)) }));
  withArea.sort((a, b) => b.absArea - a.absArea);

  const outer = withArea[0];
  if (!outer || outer.absArea <= 0) {
    errors.push('Не удалось определить внешний контур.');
    return {};
  }

  const holes = [];
  for (let i = 0; i < withArea.length; i++) {
    const c = withArea[i];
    if (isSelfIntersecting(c.points)) {
      errors.push(`Контур ${c.idx + 1} самопересекается.`);
    }
    if (i === 0) continue;

    const inside = c.points.slice(0, -1).every((p) => pointInPolygon(p, outer.points));
    if (!inside) {
      errors.push(`Контур ${c.idx + 1} находится вне внешнего контура.`);
    } else {
      holes.push(c.points);
    }
  }

  const { mergedHoles, pocketUnion } = computePocketUnion(holes, outer.points, errors);
  const bbox = calcBBox(outer.points);
  const outerPoints = ensureOrientation(outer.points.slice(0, -1), true);
  const holePoints = mergedHoles.map((h) => ensureOrientation(h.slice(0, -1), false));
  const topRegions = buildTopSolidRegions(outerPoints, pocketUnion, errors);

  return {
    outer: outerPoints,
    holes: holePoints,
    topRegions,
    bbox,
    outerArea: outer.absArea
  };
}

function mergeHoleContours(holes, outerPoints, errors) {
  return computePocketUnion(holes, outerPoints, errors).mergedHoles;
}

function computePocketUnion(holes, outerPoints, errors) {
  const debugState = {
    inputHoleRings: holes.length,
    preNormalizedHoleRings: 0,
    unionPolygons: 0,
    postCleanupRings: 0
  };

  const polygons = buildPocketPolygons(holes, errors, debugState);
  debugUnion('pre-union', debugState);

  if (!polygons.length) {
    if (holes.length > 0) {
      errors.push('Не осталось валидных внутренних карманов после предобработки перед union.');
    }
    return { mergedHoles: [], pocketUnion: [] };
  }

  let unionResult;

  if (polygons.length === 1) {
    unionResult = polygons;
  } else {
    try {
      unionResult = unionPocketPolygons(polygons);
    } catch (e) {
      errors.push(`Ошибка объединения внутренних карманов: ${e.message}`);
      return { mergedHoles: [], pocketUnion: [] };
    }
  }

  const merged = normalizeUnionResultToRings(unionResult, outerPoints, errors, debugState);
  debugUnion('post-union', debugState);
  return {
    mergedHoles: merged.map((ring) => ensureRingClosed(ring)),
    pocketUnion: unionResult
  };
}

function buildPocketPolygons(holes, errors = [], debugState = null) {
  const polygons = [];
  holes.forEach((ring, index) => {
    const normalized = preUnionNormalizeRing(ring, UNION_RING_EPSILON, UNION_INPUT_SNAP_STEP);
    if (!normalized) {
      errors.push(`Внутренний карман ${index + 1} отброшен: невалидный контур после предобработки перед union.`);
      return;
    }
    polygons.push([toClipperRing(normalized)]);
  });

  if (debugState) {
    debugState.preNormalizedHoleRings = polygons.length;
  }

  return polygons;
}

function unionPocketPolygons(polygons) {
  if (!polygons.length) return [];
  let result = polygons[0];
  for (let i = 1; i < polygons.length; i++) {
    result = polygonClipping.union(result, polygons[i]);
  }
  return result;
}

function normalizeUnionResultToRings(unionResult, outerPoints, errors, debugState = null) {
  if (debugState) {
    debugState.unionPolygons = Array.isArray(unionResult) ? unionResult.length : 0;
  }
  const regions = normalizeClipperResultToRegions(unionResult, {
    outerBoundary: outerPoints,
    errors,
    invalidResultMessage: 'Ошибка объединения внутренних карманов: некорректный формат результата union.',
    invalidOuterMessage: 'Объединённый внутренний карман после union вырожден или самопересекается.',
    outsideMessage: 'Объединённый внутренний карман вышел за пределы внешнего контура.'
  });

  const mergedRings = regions.map((region) => ensureRingClosed(region.outer));

  if (debugState) {
    debugState.postCleanupRings = mergedRings.length;
  }

  return mergedRings;
}

function buildTopSolidRegions(outerPoints, pocketUnion, errors) {
  const outerPolygon = [[toClipperRing(outerPoints)]];
  let differenceResult = outerPolygon;

  if (Array.isArray(pocketUnion) && pocketUnion.length > 0) {
    try {
      differenceResult = polygonClipping.difference(outerPolygon, pocketUnion);
    } catch (e) {
      errors.push(`Ошибка расчёта верхнего слоя (outer - pockets): ${e.message}`);
      return [];
    }
  }

  return normalizeClipperResultToRegions(differenceResult, {
    outerBoundary: outerPoints,
    errors,
    invalidResultMessage: 'Ошибка расчёта верхнего слоя: некорректный формат результата difference.',
    invalidOuterMessage: 'Регион верхнего слоя вырожден или самопересекается.',
    invalidHoleMessage: 'Внутренний контур региона верхнего слоя вырожден или самопересекается.',
    outsideMessage: 'Регион верхнего слоя вышел за пределы внешнего контура.'
  });
}

function normalizeClipperResultToRegions(result, options = {}) {
  const {
    outerBoundary,
    errors = [],
    invalidResultMessage = 'Некорректный формат результата polygon-clipping.',
    invalidOuterMessage = 'Внешний контур региона вырожден или самопересекается.',
    invalidHoleMessage = 'Внутренний контур региона вырожден или самопересекается.',
    outsideMessage = 'Контур региона вышел за пределы внешнего контура.'
  } = options;

  if (!Array.isArray(result)) {
    errors.push(invalidResultMessage);
    return [];
  }

  const regions = [];
  for (const polygon of result) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;

    const outer = cleanupUnionRing(fromClipperRing(polygon[0]), UNION_RING_EPSILON);
    if (!outer) {
      errors.push(invalidOuterMessage);
      continue;
    }

    if (outerBoundary && !ringInsideBoundary(outer, outerBoundary)) {
      errors.push(outsideMessage);
      continue;
    }

    const region = {
      outer: ensureOrientation(stripClosingDuplicate(outer), true),
      holes: []
    };

    for (let i = 1; i < polygon.length; i++) {
      const hole = cleanupUnionRing(fromClipperRing(polygon[i]), UNION_RING_EPSILON);
      if (!hole) {
        errors.push(invalidHoleMessage);
        continue;
      }

      if (!ringInsideBoundary(hole, ensureRingClosed(region.outer))) {
        errors.push('Внутренний контур региона верхнего слоя вышел за пределы внешнего контура региона.');
        continue;
      }

      region.holes.push(ensureOrientation(stripClosingDuplicate(hole), false));
    }

    regions.push(region);
  }

  return regions;
}

function ringInsideBoundary(ring, boundary) {
  return ring.slice(0, -1).every((point) => pointInOrOnPolygon(point, boundary));
}

function preUnionNormalizeRing(points, eps, snapStep) {
  let ring = stripClosingDuplicate(points);
  ring = dedupeSequential(ring);
  ring = snapRing(ring, snapStep);
  ring = dedupeSequential(ring);
  ring = removeShortEdges(ring, Math.max(eps, snapStep));
  ring = dedupeSequential(ring);
  ring = removeCollinearPoints(ring, eps);
  ring = dedupeSequential(ring);
  ring = ensureRingClosed(ring);

  if (ring.length < 4) return null;
  if (Math.abs(polygonArea(ring)) <= eps * eps) return null;
  if (isSelfIntersecting(ring)) return null;

  return ring;
}

function stripClosingDuplicate(points) {
  if (!points.length) return [];
  const out = [...points];
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) {
    out.pop();
  }
  return out;
}

function removeShortEdges(points, eps) {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (dist(points[i], out[out.length - 1]) > eps) {
      out.push(points[i]);
    }
  }
  return out;
}

function removeCollinearPoints(points, eps) {
  if (points.length < 3) return points;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];

    const cross = Math.abs(orient(prev, current, next));
    const scale = Math.max(dist(prev, current) * dist(current, next), 1);
    if (cross > eps * scale) {
      out.push(current);
    }
  }
  return out;
}

function cleanupUnionRing(points, eps) {
  let ring = stripClosingDuplicate(points);
  ring = dedupeSequential(ring);
  ring = removeShortEdges(ring, eps);
  ring = dedupeSequential(ring);
  ring = removeCollinearPoints(ring, eps);
  ring = dedupeSequential(ring);
  ring = ensureRingClosed(ring);

  if (ring.length < 4) return null;
  if (Math.abs(polygonArea(ring)) <= eps * eps) return null;
  if (isSelfIntersecting(ring)) return null;

  return ring;
}

function ensureRingClosed(points) {
  if (!points.length) return points;
  const deduped = dedupeSequential(points);
  if (!samePoint(deduped[0], deduped[deduped.length - 1])) {
    deduped.push({ ...deduped[0] });
  }
  return deduped;
}

function toClipperRing(points) {
  return ensureRingClosed(points).map((point) => [point.x, point.y]);
}

function fromClipperRing(ring) {
  const points = (ring || []).map((p) => ({ x: p[0], y: p[1] }));
  return ensureRingClosed(points);
}

function ensureOrientation(points, ccw) {
  const area = polygonArea([...points, points[0]]);
  const isCcw = area > 0;
  if ((ccw && isCcw) || (!ccw && !isCcw)) return points;
  return [...points].reverse();
}

function parsePolygonPoints(raw) {
  const nums = raw.trim().split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
  const pts = [];
  for (let i = 0; i < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return pts;
}

function sampleCircle(cx, cy, r) {
  const steps = Math.max(24, Math.ceil((2 * Math.PI * r) / CURVE_STEP_MM));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function sampleEllipse(cx, cy, rx, ry) {
  const steps = Math.max(24, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / CURVE_STEP_MM));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
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
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
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

function dedupeSequential(points) {
  if (!points.length) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (!samePoint(points[i], points[i - 1])) out.push(points[i]);
  }
  return out;
}

function snapCoord(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function snapPoint(point, step) {
  return {
    x: snapCoord(point.x, step),
    y: snapCoord(point.y, step)
  };
}

function snapRing(points, step) {
  return points.map((point) => snapPoint(point, step));
}

function debugUnion(stage, payload) {
  if (!UNION_DEBUG) return;
  console.log(`[union-debug:${stage}]`, payload);
}

function samePoint(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  app,
  parseSvgToContours,
  validateAndClassifyContours,
  mergeHoleContours,
  computePocketUnion,
  buildPocketPolygons,
  unionPocketPolygons,
  normalizeUnionResultToRings,
  buildTopSolidRegions,
  normalizeClipperResultToRegions
};
