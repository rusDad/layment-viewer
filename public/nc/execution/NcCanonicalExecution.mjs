import { serializeCanonicalLine } from '../document/CanonicalNcDocument.mjs';
import { getArcSweep } from '../nc-parser.mjs';

export const NC_EXECUTION_EPSILON = 1e-6;
export const DEFAULT_NC_EXECUTION_STATE = Object.freeze({ position: Object.freeze({ x: 0, y: 0, z: 0 }), feed: null });

const MOTIONS = new Set(['G0', 'G1', 'G2', 'G3']);
const ARC_MOTIONS = new Set(['G2', 'G3']);

export function createInitialNcExecutionState(state = DEFAULT_NC_EXECUTION_STATE) {
  return freezeState({ position: { ...state.position }, feed: state.feed ?? null });
}

export function executeCanonicalLine(line, inputState, canonicalIndex, executionOrder = 0) {
  const diagnostics = [];
  const command = line?.kind === 'motion' ? { kind: 'motion', motion: line.motion } : line?.kind ? { kind: line.kind } : null;
  let outputState = freezeState(inputState);
  const segments = [];

  if (!line || typeof line !== 'object') {
    diagnostics.push(diagnostic('invalid-canonical-command', line?.lineId ?? null, canonicalIndex, 'Canonical line is missing or invalid.'));
    return entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics);
  }

  if (line.kind !== 'motion') {
    if (!['comment', 'opaque', 'empty'].includes(line.kind)) {
      diagnostics.push(diagnostic('unsupported-canonical-command-kind', line.lineId, canonicalIndex, `Unsupported canonical line kind: ${line.kind}`));
    }
    return entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics);
  }

  if (!MOTIONS.has(line.motion)) {
    diagnostics.push(diagnostic('invalid-canonical-command', line.lineId, canonicalIndex, `Unsupported canonical motion: ${line.motion}`));
    return entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics);
  }

  const end = point3(line.end);
  const feed = line.feed;
  if (!finitePoint(end) || !Number.isFinite(feed)) {
    diagnostics.push(diagnostic('missing-or-non-finite-canonical-motion-value', line.lineId, canonicalIndex, 'Canonical motion requires finite X/Y/Z and F values.'));
    return entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics);
  }

  outputState = freezeState({ position: end, feed });
  const start = point3(inputState.position);
  if (samePoint3(start, end)) {
    return entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics);
  }

  let arc = null;
  if (ARC_MOTIONS.has(line.motion)) {
    const arcValidation = validateArc(line, start, end, canonicalIndex);
    if (arcValidation.diagnostic) {
      diagnostics.push(arcValidation.diagnostic);
      return entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics);
    }
    arc = arcValidation.arc;
  }

  const segmentId = `${line.lineId}:0`;
  segments.push(Object.freeze({
    segmentId,
    id: segmentId,
    sourceLineId: line.lineId,
    sourceLineIndex: canonicalIndex,
    sourceLineNumber: canonicalIndex + 1,
    sourceLine: canonicalIndex + 1,
    sourceText: serializeCanonicalLine(line),
    motion: line.motion,
    start: Object.freeze(start),
    end: Object.freeze(end),
    feed,
    effectiveZ: end.z,
    arc,
    executionOrder,
    tool: null,
    spindle: null
  }));

  return entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics);
}

export function executeCanonicalDocument(document, initialState = DEFAULT_NC_EXECUTION_STATE, options = {}) {
  let state = createInitialNcExecutionState(initialState);
  const entries = [];
  let executionOrder = 0;
  for (let index = 0; index < document.lines.length; index += 1) {
    options.onExecuteLine?.(index, document.lines[index]);
    const lineEntry = executeCanonicalLine(document.lines[index], state, index, executionOrder);
    entries.push(lineEntry);
    state = lineEntry.outputState;
    executionOrder += lineEntry.segments.length;
  }
  return buildExecutionCache(document, entries, state, (document.revision ?? 0));
}

export function recalculateCanonicalExecution({ document, previousCache, firstAffectedIndex, initialState = DEFAULT_NC_EXECUTION_STATE, onExecuteLine } = {}) {
  if (!document || !previousCache) throw new Error('document and previousCache are required');
  if (!Number.isInteger(firstAffectedIndex) || firstAffectedIndex < 0 || firstAffectedIndex > document.lines.length) throw new Error('firstAffectedIndex is out of range');
  const prefix = previousCache.entries.slice(0, firstAffectedIndex).filter((oldEntry, index) => document.lines[index]?.lineId === oldEntry.lineId);
  const startIndex = prefix.length;
  let state = startIndex === 0 ? createInitialNcExecutionState(initialState) : prefix[startIndex - 1].outputState;
  const entries = prefix.slice();
  let executionOrder = entries.reduce((sum, item) => sum + item.segments.length, 0);
  let convergedAtIndex = null;
  let lastRecalculatedIndex = startIndex - 1;
  const previousByLineId = previousCache.byLineId;

  for (let index = startIndex; index < document.lines.length; index += 1) {
    onExecuteLine?.(index, document.lines[index]);
    const newEntry = executeCanonicalLine(document.lines[index], state, index, executionOrder);
    lastRecalculatedIndex = index;
    const oldEntry = previousByLineId.get(newEntry.lineId);
    if (index >= firstAffectedIndex && oldEntry && entriesSemanticallyEqual(newEntry, oldEntry)) {
      convergedAtIndex = index;
      const suffix = document.lines.slice(index).map((line, offset) => reindexEntry(previousByLineId.get(line.lineId), index + offset)).filter(Boolean);
      entries.push(...suffix);
      state = entries.at(-1)?.outputState ?? newEntry.outputState;
      break;
    }
    entries.push(newEntry);
    state = newEntry.outputState;
    executionOrder += newEntry.segments.length;
  }
  const cache = buildExecutionCache(document, entries, entries.at(-1)?.outputState ?? createInitialNcExecutionState(initialState), (previousCache.revision ?? 0) + 1);
  const oldSegmentIds = new Set(previousCache.segments.map((s) => s.segmentId));
  const newSegmentIds = new Set(cache.segments.map((s) => s.segmentId));
  const changedLineIds = cache.entries.filter((entry, index) => !entriesSemanticallyEqual(entry, previousCache.byLineId.get(entry.lineId)) || previousCache.entries[index]?.lineId !== entry.lineId).map((entry) => entry.lineId);
  return { cache, firstRecalculatedIndex: startIndex, lastRecalculatedIndex, convergedAtIndex, changedLineIds, removedSegmentIds: [...oldSegmentIds].filter((id) => !newSegmentIds.has(id)), addedSegmentIds: [...newSegmentIds].filter((id) => !oldSegmentIds.has(id)) };
}

export function buildExecutionCache(document, entries, finalState, revision = 0) {
  const byLineId = new Map();
  const lineIdToSegmentIds = new Map();
  const segmentIdToLineId = new Map();
  const segmentById = new Map();
  const canonicalIndexToLineId = new Map();
  const segments = [];
  const diagnostics = [];
  entries.forEach((entry, index) => {
    byLineId.set(entry.lineId, entry);
    canonicalIndexToLineId.set(index, entry.lineId);
    const ids = entry.segments.map((segment) => segment.segmentId);
    lineIdToSegmentIds.set(entry.lineId, ids);
    entry.segments.forEach((segment) => { segments.push(segment); segmentIdToLineId.set(segment.segmentId, entry.lineId); segmentById.set(segment.segmentId, segment); });
    diagnostics.push(...entry.diagnostics);
  });
  return Object.freeze({ revision, documentId: document.documentId, entries: Object.freeze(entries.slice()), byLineId, lineIdToSegmentIds, segmentIdToLineId, segmentById, canonicalIndexToLineId, segments: Object.freeze(segments), diagnostics: Object.freeze(diagnostics), finalState });
}

function validateArc(line, start, end, canonicalIndex) {
  const center = point2(line.arc?.center);
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const endRadius = Math.hypot(end.x - center.x, end.y - center.y);
  if (!finitePoint2(center) || !Number.isFinite(radius) || radius <= NC_EXECUTION_EPSILON) return { diagnostic: diagnostic('invalid-arc', line.lineId, canonicalIndex, 'Canonical arc has invalid center or radius.') };
  if (Math.abs(radius - endRadius) > Math.max(0.5, radius * 0.02, NC_EXECUTION_EPSILON)) return { diagnostic: diagnostic('invalid-arc', line.lineId, canonicalIndex, 'Canonical arc start/end radii differ too much.') };
  return { arc: Object.freeze({ center: Object.freeze(center), clockwise: line.motion === 'G2', radius, direction: line.motion === 'G2' ? 'cw' : 'ccw', sweep: getArcSweep(Math.atan2(start.y - center.y, start.x - center.x), Math.atan2(end.y - center.y, end.x - center.x), line.motion, samePoint2(start, end)) }) };
}

function entry(line, canonicalIndex, inputState, outputState, command, segments, diagnostics) {
  const frozen = Object.freeze({ lineId: line?.lineId ?? `invalid-${canonicalIndex}`, canonicalIndex, inputState: freezeState(inputState), outputState: freezeState(outputState), command, lineSignature: line ? serializeCanonicalLine(line) : '', segments: Object.freeze(segments), diagnostics: Object.freeze(diagnostics), executionHash: '' });
  return Object.freeze({ ...frozen, executionHash: executionHash(frozen) });
}
function diagnostic(code, lineId, canonicalIndex, message, segmentId = null) { return Object.freeze({ severity: 'error', code, message, lineId, canonicalIndex, segmentId }); }
function freezeState(state) { return Object.freeze({ position: Object.freeze(point3(state.position)), feed: state.feed == null ? null : state.feed }); }
function point3(p) { return { x: Number(p?.x), y: Number(p?.y), z: Number(p?.z) }; }
function point2(p) { return { x: Number(p?.x), y: Number(p?.y) }; }
function finitePoint(p) { return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z); }
function finitePoint2(p) { return Number.isFinite(p.x) && Number.isFinite(p.y); }
function sameNumber(a,b,eps=NC_EXECUTION_EPSILON){ return (a==null||b==null) ? a===b : Math.abs(a-b)<=eps; }
function samePoint3(a,b){ return sameNumber(a.x,b.x)&&sameNumber(a.y,b.y)&&sameNumber(a.z,b.z); }
function samePoint2(a,b){ return sameNumber(a.x,b.x)&&sameNumber(a.y,b.y); }
export function executionStatesEqual(a,b){ return Boolean(a&&b) && samePoint3(a.position,b.position) && sameNumber(a.feed,b.feed); }
function diagnosticsEqual(a,b){ return a.length===b.length && a.every((d,i)=> d.code===b[i].code && d.severity===b[i].severity && d.lineId===b[i].lineId && d.canonicalIndex===b[i].canonicalIndex && d.segmentId===b[i].segmentId); }
function segmentsEqual(a,b){ return a.length===b.length && a.every((s,i)=> s.segmentId===b[i].segmentId && s.sourceLineId===b[i].sourceLineId && s.motion===b[i].motion && samePoint3(s.start,b[i].start) && samePoint3(s.end,b[i].end) && sameNumber(s.feed,b[i].feed) && sameNumber(s.effectiveZ,b[i].effectiveZ) && ((!s.arc&&!b[i].arc) || (s.arc&&b[i].arc&&samePoint2(s.arc.center,b[i].arc.center)&&s.arc.clockwise===b[i].arc.clockwise&&sameNumber(s.arc.radius,b[i].arc.radius)))); }
export function entriesSemanticallyEqual(a,b){ return Boolean(a&&b) && a.lineId===b.lineId && a.lineSignature===b.lineSignature && executionStatesEqual(a.inputState,b.inputState) && executionStatesEqual(a.outputState,b.outputState) && segmentsEqual(a.segments,b.segments) && diagnosticsEqual(a.diagnostics,b.diagnostics); }
function reindexEntry(oldEntry, canonicalIndex) {
  if (!oldEntry) return null;
  if (oldEntry.canonicalIndex === canonicalIndex && oldEntry.segments.every((segment) => segment.sourceLineIndex === canonicalIndex && segment.sourceLineNumber === canonicalIndex + 1)) return oldEntry;
  const segments = oldEntry.segments.map((segment) => Object.freeze({ ...segment, sourceLineIndex: canonicalIndex, sourceLineNumber: canonicalIndex + 1, sourceLine: canonicalIndex + 1 }));
  const cloned = Object.freeze({ ...oldEntry, canonicalIndex, segments: Object.freeze(segments), executionHash: '' });
  return Object.freeze({ ...cloned, executionHash: executionHash(cloned) });
}

function executionHash(e){ return JSON.stringify({ lineId:e.lineId, idx:e.canonicalIndex, sig:e.lineSignature, in:e.inputState, out:e.outputState, seg:e.segments, diag:e.diagnostics }); }
