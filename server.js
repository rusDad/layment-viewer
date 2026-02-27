const express = require('express');
const multer = require('multer');
const { XMLParser } = require('fast-xml-parser');
const arcToCubic = require('svg-arc-to-cubic-bezier');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const BASE_DEPTH = 35;
const POCKET_DEPTH = 20;
const CURVE_STEP_MM = 0.5;

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

    const { outer, holes, bbox, outerArea } = validateAndClassifyContours(data.contours, errors);
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

app.listen(3000, () => {
  console.log('Server on http://localhost:3000');
});

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
  collectNodes(svg, nodes);

  const contours = [];
  for (const node of nodes) {
    if (!node || !node.tag) continue;

    if (node.tag === 'path' && node.attrs['@_d']) {
      const localContours = flattenPath(node.attrs['@_d']);
      localContours.forEach((c) => contours.push(normalizeContour(c, viewBox)));
    } else if (node.tag === 'polygon' && node.attrs['@_points']) {
      const pts = parsePolygonPoints(node.attrs['@_points']);
      if (pts.length >= 3) {
        if (!samePoint(pts[0], pts[pts.length - 1])) pts.push({ ...pts[0] });
        contours.push(normalizeContour(pts, viewBox));
      }
    } else if (node.tag === 'rect') {
      const x = num(node.attrs['@_x'], 0);
      const y = num(node.attrs['@_y'], 0);
      const w = num(node.attrs['@_width'], 0);
      const h = num(node.attrs['@_height'], 0);
      if (w > 0 && h > 0) {
        contours.push(normalizeContour([
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
          { x, y }
        ], viewBox));
      }
    } else if (node.tag === 'circle') {
      const cx = num(node.attrs['@_cx'], 0);
      const cy = num(node.attrs['@_cy'], 0);
      const r = num(node.attrs['@_r'], 0);
      if (r > 0) contours.push(normalizeContour(sampleCircle(cx, cy, r), viewBox));
    } else if (node.tag === 'ellipse') {
      const cx = num(node.attrs['@_cx'], 0);
      const cy = num(node.attrs['@_cy'], 0);
      const rx = num(node.attrs['@_rx'], 0);
      const ry = num(node.attrs['@_ry'], 0);
      if (rx > 0 && ry > 0) contours.push(normalizeContour(sampleEllipse(cx, cy, rx, ry), viewBox));
    }
  }

  if (contours.length === 0) {
    errors.push('Не найдено замкнутых контуров (path/polygon/rect/circle/ellipse).');
  }

  return { contours };
}

function collectNodes(node, out) {
  const keys = Object.keys(node || {});
  for (const key of keys) {
    const value = node[key];
    if (!value) continue;

    if (['path', 'polygon', 'rect', 'circle', 'ellipse'].includes(key)) {
      if (Array.isArray(value)) {
        value.forEach((v) => out.push({ tag: key, attrs: v }));
      } else {
        out.push({ tag: key, attrs: value });
      }
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) value.forEach((v) => collectNodes(v, out));
      else collectNodes(value, out);
    }
  }
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

  const bbox = calcBBox(outer.points);
  const outerPoints = ensureOrientation(outer.points.slice(0, -1), true);
  const holePoints = holes.map((h) => ensureOrientation(h.slice(0, -1), false));

  return {
    outer: outerPoints,
    holes: holePoints,
    bbox,
    outerArea: outer.absArea
  };
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
