export function analyzeNcExecutionCache(cache, document = null, options = {}) {
  const bbox = createEmptyBBox();
  const stats = { g0: 0, g1: 0, g2: 0, g3: 0, skipped: 0, warningsCount: cache.diagnostics.length };
  let renderedPoints = 0;
  const warnings = cache.diagnostics.map((d) => `line ${(d.canonicalIndex ?? 0) + 1}: ${d.message}`);
  cache.entries.forEach((entry) => { if (entry.command?.kind === 'motion' && entry.segments.length === 0) stats.skipped += 1; });
  cache.segments.forEach((segment) => {
    stats[segment.motion.toLowerCase()] += 1;
    sampleSegmentPoints(segment).forEach((point) => { updateBBox(bbox, point); renderedPoints += 1; });
  });
  const lines = (document?.lines ?? cache.entries).map((line, index) => {
    const lineId = line.lineId;
    const segmentIds = cache.lineIdToSegmentIds.get(lineId) ?? [];
    return { index, number: index + 1, text: line.text ?? cache.byLineId.get(lineId)?.lineSignature ?? '', segmentIds, lineId, sourceOrigin: line.sourceOrigin, kind: line.kind };
  });
  return { cache, lines, segments: cache.segments, bbox: normalizeBBox(bbox), stats, warnings, diagnostics: cache.diagnostics, modal: { units: 'mm', positioning: 'absolute', plane: 'XY', arcCenterMode: 'absolute' }, renderedPoints, truncated: false, finalState: cache.finalState, feedRange: feedRange(cache.segments) };
}

export function sampleSegmentPoints(segment) {
  if (!segment.arc) return [segment.start, segment.end];
  const count = clamp(Math.ceil(Math.max(segment.arc.radius * Math.abs(segment.arc.sweep ?? 0), 0) / 3), 12, 96);
  const startAngle = Math.atan2(segment.start.y - segment.arc.center.y, segment.start.x - segment.arc.center.x);
  const sweep = segment.arc.sweep ?? 0;
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const angle = startAngle + sweep * t;
    points.push({ x: segment.arc.center.x + Math.cos(angle) * segment.arc.radius, y: segment.arc.center.y + Math.sin(angle) * segment.arc.radius, z: segment.start.z + (segment.end.z - segment.start.z) * t });
  }
  points[0] = segment.start; points[points.length - 1] = segment.end;
  return points;
}
function createEmptyBBox(){ return { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }; }
function updateBBox(b,p){ b.minX=Math.min(b.minX,p.x); b.minY=Math.min(b.minY,p.y); b.minZ=Math.min(b.minZ,p.z); b.maxX=Math.max(b.maxX,p.x); b.maxY=Math.max(b.maxY,p.y); b.maxZ=Math.max(b.maxZ,p.z); }
function normalizeBBox(b){ return Number.isFinite(b.minX) ? b : null; }
function clamp(v,min,max){ return Math.min(Math.max(v,min),max); }
function feedRange(segments){ const feeds=segments.map(s=>s.feed).filter(Number.isFinite); return { min: feeds.length?Math.min(...feeds):NaN, max: feeds.length?Math.max(...feeds):NaN }; }
