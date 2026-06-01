const SUPPORTED_MOTIONS = new Set(['G0', 'G1', 'G2', 'G3']);
const LINEAR_MOTIONS = new Set(['G0', 'G1']);
const ARC_MOTIONS = new Set(['G2', 'G3']);

export const NC_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const NC_MAX_RENDERED_POINTS = 200000;

export function stripGcodeComments(line) {
  if (typeof line !== 'string') {
    return '';
  }

  let result = '';
  let inParen = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === ';' && !inParen) {
      break;
    }
    if (char === '(') {
      inParen = true;
      continue;
    }
    if (char === ')' && inParen) {
      inParen = false;
      continue;
    }
    if (!inParen) {
      result += char;
    }
  }

  return result.trim();
}

export function parseWords(line) {
  const words = [];
  const cleaned = stripGcodeComments(line).toUpperCase();
  const wordPattern = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  let match;

  while ((match = wordPattern.exec(cleaned)) !== null) {
    words.push({ letter: match[1], value: Number(match[2]), raw: `${match[1]}${match[2]}` });
  }

  return words;
}

export function parseNcProgram(text) {
  const lines = typeof text === 'string' ? text.split(/\r?\n/) : [];
  return lines.map((line, index) => ({ line, lineNumber: index + 1, words: parseWords(line) }));
}

export function applyModalWords(words, modalState) {
  const next = { ...modalState };
  let lineMotion = null;

  words.forEach((word) => {
    if (word.letter !== 'G' || !Number.isFinite(word.value)) {
      return;
    }

    const normalized = normalizeGCode(word.value);
    if (SUPPORTED_MOTIONS.has(normalized)) {
      lineMotion = normalized;
      next.motion = normalized;
    } else if (normalized === 'G90') {
      next.positioning = 'absolute';
    } else if (normalized === 'G91') {
      next.positioning = 'incremental';
    } else if (normalized === 'G20') {
      next.units = 'inch';
    } else if (normalized === 'G21') {
      next.units = 'mm';
    } else if (normalized === 'G17') {
      next.plane = 'XY';
    } else if (normalized === 'G90.1') {
      next.arcCenterMode = 'absolute';
    } else if (normalized === 'G91.1') {
      next.arcCenterMode = 'incremental';
    }
  });

  return { modalState: next, lineMotion };
}

export function buildLinearSegment(start, end, motion, sourceLine) {
  if (samePoint3(start, end)) {
    return null;
  }

  return { motion, points: [{ ...start }, { ...end }], sourceLine };
}

export function buildArcSegments(start, end, wordsByLetter, motion, modalState, sourceLine) {
  if (modalState.plane !== 'XY') {
    return { segment: null, warning: `line ${sourceLine}: ${motion} skipped; only G17 XY arcs are supported.` };
  }

  const hasI = wordsByLetter.has('I');
  const hasJ = wordsByLetter.has('J');
  if (!hasI && !hasJ) {
    if (wordsByLetter.has('R')) {
      return buildRadiusArcSegments(start, end, wordsByLetter, motion, modalState, sourceLine);
    }
    return { segment: null, warning: `line ${sourceLine}: ${motion} skipped; arc center I/J or radius R is missing.` };
  }

  const unitScale = getUnitScale(modalState.units);
  const iValue = (wordsByLetter.get('I') ?? 0) * unitScale;
  const jValue = (wordsByLetter.get('J') ?? 0) * unitScale;
  const center = modalState.arcCenterMode === 'absolute'
    ? { x: iValue, y: jValue }
    : { x: start.x + iValue, y: start.y + jValue };

  return buildCenterArcSegments(start, end, center, motion, sourceLine);
}

function buildRadiusArcSegments(start, end, wordsByLetter, motion, modalState, sourceLine) {
  const unitScale = getUnitScale(modalState.units);
  const radius = wordsByLetter.get('R') * unitScale;
  const center = resolveRadiusArcCenter(start, end, radius, motion);

  if (!center) {
    return { segment: null, warning: `line ${sourceLine}: ${motion} skipped; invalid R arc geometry.` };
  }

  return buildCenterArcSegments(start, end, center, motion, sourceLine);
}

function buildCenterArcSegments(start, end, center, motion, sourceLine) {
  const startRadius = Math.hypot(start.x - center.x, start.y - center.y);
  const endRadius = Math.hypot(end.x - center.x, end.y - center.y);

  if (!Number.isFinite(startRadius) || startRadius <= 1e-9) {
    return { segment: null, warning: `line ${sourceLine}: ${motion} skipped; invalid arc radius.` };
  }

  if (Math.abs(startRadius - endRadius) > Math.max(0.5, startRadius * 0.02)) {
    return { segment: null, warning: `line ${sourceLine}: ${motion} skipped; start/end radii differ too much.` };
  }

  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const sweep = getArcSweep(startAngle, endAngle, motion, samePoint2(start, end));
  const arcLengthMm = Math.max(startRadius * Math.abs(sweep), 0);
  const segmentsCount = clamp(Math.ceil(arcLengthMm / 3), 12, 96);
  const points = [];

  for (let i = 0; i <= segmentsCount; i += 1) {
    const t = i / segmentsCount;
    const angle = startAngle + sweep * t;
    points.push({
      x: center.x + Math.cos(angle) * startRadius,
      y: center.y + Math.sin(angle) * startRadius,
      z: start.z + (end.z - start.z) * t
    });
  }

  points[0] = { ...start };
  points[points.length - 1] = { ...end };
  return { segment: { motion, points, sourceLine }, warning: null };
}

export function parseNcToToolpath(text, options = {}) {
  const maxRenderedPoints = Number.isFinite(options.maxRenderedPoints) ? options.maxRenderedPoints : NC_MAX_RENDERED_POINTS;
  const program = parseNcProgram(text);
  const segments = [];
  const warnings = [];
  const stats = { g0: 0, g1: 0, g2: 0, g3: 0, skipped: 0, warningsCount: 0 };
  const bbox = createEmptyBBox();
  let renderedPoints = 0;
  let truncated = false;
  let currentPosition = { x: 0, y: 0, z: 0 };
  let modalState = {
    motion: null,
    positioning: 'absolute',
    units: 'mm',
    plane: 'XY',
    arcCenterMode: 'incremental'
  };

  updateBBox(bbox, currentPosition);

  for (const item of program) {
    if (truncated) {
      break;
    }

    const words = item.words;
    if (words.length === 0) {
      continue;
    }

    const modalResult = applyModalWords(words, modalState);
    modalState = modalResult.modalState;

    const wordsByLetter = mapLastWordsByLetter(words);
    const hasMotionData = ['X', 'Y', 'Z', 'I', 'J', 'R'].some((letter) => wordsByLetter.has(letter));
    const motion = modalResult.lineMotion || (hasMotionData ? modalState.motion : null);

    if (!SUPPORTED_MOTIONS.has(motion)) {
      continue;
    }

    if (!hasMotionData) {
      continue;
    }

    const nextPosition = resolveTargetPosition(currentPosition, wordsByLetter, modalState);
    let segment = null;
    let warning = null;

    if (LINEAR_MOTIONS.has(motion)) {
      segment = buildLinearSegment(currentPosition, nextPosition, motion, item.lineNumber);
      if (!segment) {
        stats.skipped += 1;
      }
    } else if (ARC_MOTIONS.has(motion)) {
      const arcResult = buildArcSegments(currentPosition, nextPosition, wordsByLetter, motion, modalState, item.lineNumber);
      segment = arcResult.segment;
      warning = arcResult.warning;
      if (warning) {
        warnings.push(warning);
        stats.skipped += 1;
      }
    }

    currentPosition = nextPosition;

    if (!segment) {
      continue;
    }

    renderedPoints += segment.points.length;
    if (renderedPoints > maxRenderedPoints) {
      warnings.push(`render point limit (${maxRenderedPoints}) exceeded at line ${item.lineNumber}; preview was truncated.`);
      stats.skipped += 1;
      truncated = true;
      break;
    }

    segment.points.forEach((point) => updateBBox(bbox, point));
    segments.push(segment);
    stats[motion.toLowerCase()] += 1;
  }

  stats.warningsCount = warnings.length;

  return {
    segments,
    bbox: normalizeBBox(bbox),
    stats,
    warnings,
    modal: modalState,
    renderedPoints,
    truncated
  };
}

function normalizeGCode(value) {
  if (Math.abs(value - 90.1) < 1e-6) return 'G90.1';
  if (Math.abs(value - 91.1) < 1e-6) return 'G91.1';
  if (Number.isInteger(value)) return `G${value}`;
  return `G${value}`;
}

function mapLastWordsByLetter(words) {
  const map = new Map();
  words.forEach((word) => {
    if (word.letter !== 'G' && Number.isFinite(word.value)) {
      map.set(word.letter, word.value);
    }
  });
  return map;
}

function resolveTargetPosition(current, wordsByLetter, modalState) {
  const unitScale = getUnitScale(modalState.units);
  const next = { ...current };

  ['X', 'Y', 'Z'].forEach((letter) => {
    if (!wordsByLetter.has(letter)) {
      return;
    }

    const axis = letter.toLowerCase();
    const valueMm = wordsByLetter.get(letter) * unitScale;
    next[axis] = modalState.positioning === 'incremental' ? current[axis] + valueMm : valueMm;
  });

  return next;
}

function resolveRadiusArcCenter(start, end, radius, motion) {
  if (!Number.isFinite(radius) || Math.abs(radius) <= 1e-9 || samePoint2(start, end)) {
    return null;
  }

  const radiusAbs = Math.abs(radius);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);

  if (!Number.isFinite(chordLength) || chordLength <= 1e-9) {
    return null;
  }

  const halfChord = chordLength / 2;
  if (halfChord > radiusAbs + 1e-6) {
    return null;
  }

  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const heightSquared = Math.max((radiusAbs * radiusAbs) - (halfChord * halfChord), 0);
  const height = Math.sqrt(heightSquared);
  const normal = { x: -dy / chordLength, y: dx / chordLength };
  const candidates = [
    { x: midpoint.x + normal.x * height, y: midpoint.y + normal.y * height },
    { x: midpoint.x - normal.x * height, y: midpoint.y - normal.y * height }
  ];
  const wantsMajorArc = radius < 0;

  return candidates.reduce((best, center) => {
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    const sweep = getArcSweep(startAngle, endAngle, motion, false);
    const sweepMagnitude = Math.abs(sweep);
    const isMajorArc = sweepMagnitude > Math.PI + 1e-9;
    const signPenalty = isMajorArc === wantsMajorArc ? 0 : Math.PI * 2;
    const targetSweep = wantsMajorArc ? Math.PI * 1.5 : Math.PI / 2;
    const score = signPenalty + Math.abs(sweepMagnitude - targetSweep);

    if (!best || score < best.score) {
      return { center, score };
    }
    return best;
  }, null)?.center ?? null;
}

function getArcSweep(startAngle, endAngle, motion, isFullCircle) {
  if (isFullCircle) {
    return motion === 'G2' ? -Math.PI * 2 : Math.PI * 2;
  }

  let sweep = endAngle - startAngle;
  if (motion === 'G3') {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  return sweep;
}

function getUnitScale(units) {
  return units === 'inch' ? 25.4 : 1;
}

function createEmptyBBox() {
  return { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
}

function updateBBox(bbox, point) {
  bbox.minX = Math.min(bbox.minX, point.x);
  bbox.minY = Math.min(bbox.minY, point.y);
  bbox.minZ = Math.min(bbox.minZ, point.z);
  bbox.maxX = Math.max(bbox.maxX, point.x);
  bbox.maxY = Math.max(bbox.maxY, point.y);
  bbox.maxZ = Math.max(bbox.maxZ, point.z);
}

function normalizeBBox(bbox) {
  if (!Number.isFinite(bbox.minX)) {
    return null;
  }
  return bbox;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function samePoint2(a, b, eps = 1e-9) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

function samePoint3(a, b, eps = 1e-9) {
  return samePoint2(a, b, eps) && Math.abs(a.z - b.z) <= eps;
}
