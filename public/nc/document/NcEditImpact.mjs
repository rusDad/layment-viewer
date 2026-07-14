import { NC_EXECUTION_EPSILON } from '../execution/NcCanonicalExecution.mjs';

export function buildNcEditImpact({ beforeDocument, afterDocument, beforeCache, afterCache, executionUpdate = null, operation = {}, dirty = false, historyState = null } = {}) {
  const beforeSegments = new Map((beforeCache?.segments ?? []).map((s) => [s.segmentId, s]));
  const afterSegments = new Map((afterCache?.segments ?? []).map((s) => [s.segmentId, s]));
  const addedSegments = [];
  const removedSegments = [];
  const changedSegments = [];
  const unchangedSegments = [];
  afterSegments.forEach((segment, id) => {
    const before = beforeSegments.get(id);
    if (!before) addedSegments.push(segment);
    else if (segmentsSemanticallyEqual(before, segment)) unchangedSegments.push(segment);
    else changedSegments.push({ before, after: segment });
  });
  beforeSegments.forEach((segment, id) => { if (!afterSegments.has(id)) removedSegments.push(segment); });
  const changedLineIds = new Set([...(executionUpdate?.changedLineIds ?? []), ...removedSegments.map((s) => s.sourceLineId), ...addedSegments.map((s) => s.sourceLineId), ...changedSegments.map((p) => p.after.sourceLineId)]);
  return Object.freeze({
    operationKind: operation.kind ?? 'edit',
    label: operation.label ?? operation.kind ?? 'Edit',
    selectedLineCount: operation.selectedLineCount ?? 0,
    deletedLineCount: operation.deletedLineCount ?? 0,
    firstAffectedIndex: operation.firstAffectedIndex ?? executionUpdate?.firstRecalculatedIndex ?? 0,
    lastRecalculatedIndex: executionUpdate?.lastRecalculatedIndex ?? null,
    convergenceIndex: executionUpdate?.convergedAtIndex ?? null,
    changedLineIdsCount: changedLineIds.size,
    addedSegmentCount: addedSegments.length,
    removedSegmentCount: removedSegments.length,
    changedSegmentCount: changedSegments.length,
    motionCountBefore: beforeCache?.segments?.length ?? 0,
    motionCountAfter: afterCache?.segments?.length ?? 0,
    bboxBefore: bbox(beforeCache?.segments ?? []),
    bboxAfter: bbox(afterCache?.segments ?? []),
    minZBefore: zRange(beforeCache?.segments ?? []).min,
    maxZBefore: zRange(beforeCache?.segments ?? []).max,
    minZAfter: zRange(afterCache?.segments ?? []).min,
    maxZAfter: zRange(afterCache?.segments ?? []).max,
    feedRangeBefore: feedRange(beforeCache?.segments ?? []),
    feedRangeAfter: feedRange(afterCache?.segments ?? []),
    diagnosticsAdded: diagnosticDelta(beforeCache?.diagnostics ?? [], afterCache?.diagnostics ?? []).added,
    diagnosticsRemoved: diagnosticDelta(beforeCache?.diagnostics ?? [], afterCache?.diagnostics ?? []).removed,
    dirty,
    history: historyState,
    previousOverlaySegments: Object.freeze([...removedSegments, ...changedSegments.map((pair) => pair.before)]),
    changedLineIds: Object.freeze([...changedLineIds]),
    beforeRevision: beforeDocument?.revision ?? null,
    afterRevision: afterDocument?.revision ?? null
  });
}

export function segmentsSemanticallyEqual(a, b) {
  return Boolean(a && b) && a.segmentId === b.segmentId && a.sourceLineId === b.sourceLineId && a.motion === b.motion && point3Equal(a.start,b.start) && point3Equal(a.end,b.end) && num(a.feed,b.feed) && ((!a.arc&&!b.arc) || (a.arc&&b.arc&&point2Equal(a.arc.center,b.arc.center)&&num(a.arc.radius,b.arc.radius)&&a.arc.clockwise===b.arc.clockwise&&a.arc.direction===b.arc.direction));
}
function num(a,b){ return (a==null||b==null) ? a===b : Math.abs(a-b)<=NC_EXECUTION_EPSILON; }
function point3Equal(a,b){ return num(a?.x,b?.x)&&num(a?.y,b?.y)&&num(a?.z,b?.z); }
function point2Equal(a,b){ return num(a?.x,b?.x)&&num(a?.y,b?.y); }
function bbox(segments){ const b={minX:Infinity,minY:Infinity,minZ:Infinity,maxX:-Infinity,maxY:-Infinity,maxZ:-Infinity}; for(const s of segments){ for(const p of [s.start,s.end]){ b.minX=Math.min(b.minX,p.x); b.minY=Math.min(b.minY,p.y); b.minZ=Math.min(b.minZ,p.z); b.maxX=Math.max(b.maxX,p.x); b.maxY=Math.max(b.maxY,p.y); b.maxZ=Math.max(b.maxZ,p.z); }} return Number.isFinite(b.minX)?b:null; }
function zRange(segments){ const zs=segments.flatMap(s=>[s.start?.z,s.end?.z]).filter(Number.isFinite); return { min: zs.length?Math.min(...zs):NaN, max: zs.length?Math.max(...zs):NaN }; }
function feedRange(segments){ const feeds=segments.map(s=>s.feed).filter(Number.isFinite); return { min: feeds.length?Math.min(...feeds):NaN, max: feeds.length?Math.max(...feeds):NaN }; }
function diagnosticKey(d){ return `${d.severity}:${d.code}:${d.lineId}:${d.canonicalIndex}:${d.message}`; }
function diagnosticDelta(a,b){ const as=new Set(a.map(diagnosticKey)); const bs=new Set(b.map(diagnosticKey)); return { added:[...bs].filter(k=>!as.has(k)).length, removed:[...as].filter(k=>!bs.has(k)).length }; }
