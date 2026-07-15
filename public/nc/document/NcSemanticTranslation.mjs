import { createCanonicalNcDocument, serializeCanonicalLine, serializeCanonicalNcDocument } from './CanonicalNcDocument.mjs';
import { recalculateCanonicalExecution, NC_EXECUTION_EPSILON } from '../execution/NcCanonicalExecution.mjs';
import { analyzeNcExecutionCache } from '../execution/NcProgramAnalysis.mjs';

const LINEAR = new Set(['G0', 'G1']);
const ARC = new Set(['G2', 'G3']);
const MOTION = new Set(['G0', 'G1', 'G2', 'G3']);

export function buildSemanticTranslationPlan({ document, previousCache, lineIds, dxMm, dyMm } = {}) {
  if (!document) return fail('document-not-initialized', 'Canonical document is not initialized.');
  const dx = Number(dxMm); const dy = Number(dyMm);
  const base = { kind: 'semantic-translation-plan', sourceRevision: document.revision ?? 0, dxMm: dx, dyMm: dy };
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return plan({ ...base, blockers: [block(null, -1, 'non-finite-input', 'ΔX and ΔY must be finite millimetre values.')] });
  const selected = [...new Set((Array.isArray(lineIds) ? lineIds : []).filter((id) => typeof id === 'string' && id.length > 0))];
  const indexById = new Map(document.lines.map((line, index) => [line.lineId, index]));
  const missing = selected.filter((id) => !indexById.has(id));
  const blockers = missing.map((id) => block(id, -1, 'line-not-found', `Canonical line was not found: ${id}.`));
  const ignored = [];
  const translated = [];
  const noOp = dx === 0 && dy === 0;
  const selectedSet = new Set(selected);
  for (const lineId of selected.sort((a, b) => (indexById.get(a) ?? 1e9) - (indexById.get(b) ?? 1e9))) {
    if (!indexById.has(lineId)) continue;
    const index = indexById.get(lineId); const line = document.lines[index];
    if (line.kind === 'motion' && LINEAR.has(line.motion)) {
      if (!finiteXY(line.end)) blockers.push(block(lineId, index, 'non-finite-xy', 'Selected linear motion has non-finite X/Y.'));
      else if (!noOp) translated.push(entry(line, index, dx, dy, previousCache));
      continue;
    }
    if (line.kind === 'motion' && ARC.has(line.motion)) {
      const previousMotion = findPreviousExecutableMotion(document, index);
      if (!previousMotion || !selectedSet.has(previousMotion.lineId)) blockers.push(block(lineId, index, 'selected-arc-start-boundary', 'Selected G2/G3 arc starts from an unselected endpoint; include the preceding executable motion in the translated range.'));
      else if (!finiteXY(line.end) || !finiteXY(line.arc?.center)) blockers.push(block(lineId, index, 'non-finite-arc-xy', 'Selected arc motion has non-finite endpoint or center X/Y.'));
      else if (!noOp) translated.push(entry(line, index, dx, dy, previousCache));
      continue;
    }
    else if (line.kind === 'comment' || line.kind === 'empty' || line.kind === 'machine') ignored.push(ignore(line, index, 'non-motion', 'Selected line does not change canonical position.'));
    else blockers.push(block(lineId, index, 'unsupported-or-opaque', 'Selected line may affect motion semantics and cannot be translated deterministically.'));
  }
  const ranges = blockers.length || noOp ? [] : buildRanges({ document, previousCache, translated });
  for (const r of ranges) if (r.outgoingMotion === 'G2' || r.outgoingMotion === 'G3') blockers.push(block(r.outgoingLineId, r.outgoingIndex, 'outgoing-arc-boundary', 'Translated range is followed by an unselected G2/G3 arc; NC-E8 cannot change the arc start geometry.'));
  const earliest = translated.length ? Math.min(...translated.map((e) => e.canonicalIndex)) : null;
  return plan({ ...base, targetLineIds: selected, translated, translatedLinearLineCount: translated.filter((e) => LINEAR.has(e.motion)).length, translatedArcLineCount: translated.filter((e) => ARC.has(e.motion)).length, ignored, blockers, blockedArcBoundaries: blockers.filter((b) => b.reason === 'outgoing-arc-boundary' || b.reason === 'selected-arc-start-boundary'), ranges, earliestAffectedLineIndex: earliest, noOp, expectedChangedLineIds: translated.map((e) => e.lineId), expectedConnectorChanges: ranges.filter((r) => r.outgoingConnectorChanged).map((r) => ({ lineId: r.outgoingLineId, canonicalIndex: r.outgoingIndex, beforeStart: r.outgoingBeforeStart, afterStart: r.outgoingAfterStart, end: r.outgoingEnd })), verification: { ok: blockers.length === 0 && !noOp && translated.length > 0, diagnostics: [] } });
}

export function applySemanticTranslationCommand({ document, previousCache, initialCanonicalText, expectedRevision, plan: p } = {}) {
  if (!document || !previousCache) return fail('execution-failed', 'Canonical workspace is not initialized.');
  if (!p?.ok) return fail('invalid-plan', 'A valid semantic translation plan is required.');
  if (expectedRevision != null && expectedRevision !== document.revision) return fail('stale-revision', 'The canonical document changed. Rebuild the translation preview before applying.');
  if (p.sourceRevision !== (document.revision ?? 0)) return fail('stale-plan', 'The translation plan was built for a previous document revision.');
  if (p.noOp || p.translatedLineCount === 0) return Object.freeze({ ok: true, noOp: true, document, executionUpdate: null, plan: p, changedLineIds: Object.freeze([]), firstAffectedIndex: null });
  const candidate = buildTranslatedCandidateDocument({ document, plan: p, initialCanonicalText });
  if (!candidate.ok) return candidate;
  let executionUpdate;
  try { executionUpdate = recalculateCanonicalExecution({ document: candidate.document, previousCache, firstAffectedIndex: p.earliestAffectedLineIndex }); }
  catch (err) { return fail('execution-failed', err instanceof Error ? err.message : String(err)); }
  const verification = verifySemanticTranslationPlan({ beforeDocument: document, beforeCache: previousCache, candidateDocument: candidate.document, candidateCache: executionUpdate.cache, plan: p });
  if (!verification.ok) return fail('semantic-verification-failed', verification.diagnostics[0]?.message ?? 'Semantic translation verification failed.', null, verification);
  const analysis = analyzeNcExecutionCache(executionUpdate.cache, candidate.document);
  analysis.canonicalDocument = candidate.document; analysis.rawDocument = candidate.document.rawDocument; analysis.canonicalText = serializeCanonicalNcDocument(candidate.document); analysis.executionCache = executionUpdate.cache;
  return Object.freeze({ ok: true, noOp: false, document: candidate.document, executionUpdate, analysis, plan: Object.freeze({ ...p, verification }), changedLineIds: p.expectedChangedLineIds, firstAffectedIndex: p.earliestAffectedLineIndex, dirty: candidate.document.dirty });
}

export function buildTranslatedCandidateDocument({ document, plan: p, initialCanonicalText } = {}) {
  const changes = new Map((p?.translated ?? []).map((e) => [e.lineId, e]));
  try {
    const lines = document.lines.map((line) => {
      const c = changes.get(line.lineId); if (!c) return line;
      const updated = Object.freeze({
        ...line,
        start: c.afterStart ? Object.freeze({ ...line.start, ...c.afterStart }) : line.start,
        end: Object.freeze({ ...line.end, x: c.after.x, y: c.after.y }),
        arc: c.afterCenter ? Object.freeze({ ...line.arc, center: Object.freeze(c.afterCenter), start: c.afterStart ? Object.freeze({ ...line.arc?.start, ...c.afterStart }) : line.arc?.start, end: Object.freeze({ ...line.arc?.end, x: c.after.x, y: c.after.y }) }) : line.arc,
        text: null
      });
      serializeCanonicalLine(updated); return updated;
    });
    const rebuilt = createCanonicalNcDocument({ rawDocument: document.rawDocument, lines, diagnostics: document.diagnostics });
    const candidate = Object.freeze({ ...rebuilt, documentId: document.documentId, revision: (document.revision ?? 0) + 1 });
    const text = serializeCanonicalNcDocument(candidate);
    return Object.freeze({ ok: true, document: Object.freeze({ ...candidate, dirty: initialCanonicalText == null ? true : text !== initialCanonicalText }) });
  } catch (err) { return fail('canonical-serialization-failed', err instanceof Error ? err.message : String(err)); }
}

export function verifySemanticTranslationPlan({ beforeDocument, beforeCache, candidateDocument, candidateCache, plan: p } = {}) {
  const diagnostics = [];
  for (const e of p.translated ?? []) {
    const line = candidateDocument.lines[e.canonicalIndex]; const before = beforeDocument.lines[e.canonicalIndex];
    if (line.lineId !== e.lineId || !MOTION.has(line.motion)) diagnostics.push(vdiag(e.lineId, 'line-mismatch', 'Translated line identity or motion type changed unexpectedly.'));
    if (!near(line.end.x, e.after.x) || !near(line.end.y, e.after.y) || !near(line.end.z, before.end.z) || !near(line.feed, before.feed)) diagnostics.push(vdiag(e.lineId, 'endpoint-mismatch', 'Translated endpoint, Z, or feed does not match the plan.'));
    if (ARC.has(before.motion)) verifyArcEntry({ diagnostics, entry: e, before, line, beforeCache, candidateCache });
  }
  for (const r of p.ranges ?? []) {
    for (const e of r.entries) {
      const oldSeg = beforeCache.byLineId.get(e.lineId)?.segments?.[0]; const newSeg = candidateCache.byLineId.get(e.lineId)?.segments?.[0];
      if (!newSeg && !oldSeg) continue;
      if (!newSeg || !oldSeg) { diagnostics.push(vdiag(e.lineId, 'segment-count-change', 'Unexpected segment-count change.')); continue; }
      const first = e.lineId === r.firstLineId;
      const expectedStart = first ? oldSeg.start : { x: oldSeg.start.x + p.dxMm, y: oldSeg.start.y + p.dyMm, z: oldSeg.start.z };
      const expectedEnd = { x: oldSeg.end.x + p.dxMm, y: oldSeg.end.y + p.dyMm, z: oldSeg.end.z };
      if (!samePoint(newSeg.start, expectedStart) || !samePoint(newSeg.end, expectedEnd)) diagnostics.push(vdiag(e.lineId, 'range-geometry-mismatch', 'Translated range geometry does not match intended boundary/interior behavior.'));
    }
    if (r.outgoingLineId && r.outgoingMotion && LINEAR.has(r.outgoingMotion)) {
      const newSeg = candidateCache.byLineId.get(r.outgoingLineId)?.segments?.[0];
      if (newSeg && (!samePoint(newSeg.start, r.outgoingAfterStart) || !samePoint(newSeg.end, r.outgoingEnd))) diagnostics.push(vdiag(r.outgoingLineId, 'connector-mismatch', 'Outgoing linear connector does not match expected translated start/original end.'));
    }
    if (r.outgoingMotion && ARC.has(r.outgoingMotion)) diagnostics.push(vdiag(r.outgoingLineId, 'arc-boundary-change', 'Arc boundary change detected.'));
  }
  for (const d of candidateCache.diagnostics ?? []) if (d.severity === 'error') diagnostics.push(vdiag(d.lineId, d.code, d.message));
  return Object.freeze({ ok: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

function buildRanges({ document, previousCache, translated }) {
  const byIndex = new Map(translated.map((e) => [e.canonicalIndex, e]));
  const ranges = []; let current = null;
  for (let index = 0; index < document.lines.length; index += 1) {
    const line = document.lines[index]; const isExecMotion = line.kind === 'motion' && MOTION.has(line.motion);
    const e = byIndex.get(index);
    if (e) { if (!current) current = { entries: [] }; current.entries.push(e); }
    else if (isExecMotion && current) { ranges.push(finishRange(current, index, document, previousCache)); current = null; }
  }
  if (current) ranges.push(finishRange(current, null, document, previousCache));
  return ranges.map((r, i) => Object.freeze({ ...r, rangeIndex: i }));
}
function finishRange(range, followingIndex, document, cache) {
  const first = range.entries[0], last = range.entries.at(-1); const outgoing = followingIndex == null ? null : document.lines[followingIndex];
  const beforeLast = cache.byLineId.get(last.lineId)?.segments?.[0]; const outSeg = outgoing ? cache.byLineId.get(outgoing.lineId)?.segments?.[0] : null;
  const afterStart = beforeLast ? { x: beforeLast.end.x + (last.after.x - last.before.x), y: beforeLast.end.y + (last.after.y - last.before.y), z: beforeLast.end.z } : null;
  return { firstLineId: first.lineId, firstIndex: first.canonicalIndex, lastLineId: last.lineId, lastIndex: last.canonicalIndex, entries: Object.freeze(range.entries), incomingBeforeStart: cache.byLineId.get(first.lineId)?.segments?.[0]?.start ?? null, outgoingLineId: outgoing?.lineId ?? null, outgoingIndex: followingIndex, outgoingMotion: outgoing?.motion ?? null, outgoingBeforeStart: outSeg?.start ?? null, outgoingAfterStart: afterStart, outgoingEnd: outSeg?.end ?? (outgoing?.end ?? null), outgoingConnectorChanged: Boolean(outSeg && afterStart && (!samePoint(outSeg.start, afterStart) || !samePoint(outSeg.end, outSeg.end))) };
}
function entry(line, index, dx, dy, cache) {
  const seg = cache?.byLineId?.get(line.lineId)?.segments?.[0];
  const beforeStart = seg?.start ?? line.start ?? null;
  const previous = findPreviousCacheSegment(cache, index);
  const translateStart = previous && Math.abs(beforeStart?.x - previous.end.x) <= NC_EXECUTION_EPSILON && Math.abs(beforeStart?.y - previous.end.y) <= NC_EXECUTION_EPSILON;
  const afterStart = beforeStart ? Object.freeze({ x: beforeStart.x + (translateStart ? dx : 0), y: beforeStart.y + (translateStart ? dy : 0), z: beforeStart.z }) : null;
  const beforeCenter = line.arc?.center ? Object.freeze({ x: line.arc.center.x, y: line.arc.center.y }) : null;
  return Object.freeze({ lineId: line.lineId, canonicalIndex: index, motion: line.motion, beforeStart, afterStart, before: Object.freeze({ x: line.end.x, y: line.end.y }), after: Object.freeze({ x: line.end.x + dx, y: line.end.y + dy }), beforeCenter, afterCenter: beforeCenter ? Object.freeze({ x: beforeCenter.x + dx, y: beforeCenter.y + dy }) : null, z: line.end.z, feed: line.feed, serializedBefore: serializeCanonicalLine(line), sourceOrigin: line.sourceOrigin ?? null });
}
function plan(p) { const blockers = Object.freeze(p.blockers ?? []); const applicable = blockers.length === 0 && !p.noOp && (p.translated?.length ?? 0) > 0 && (p.verification?.ok ?? false); return Object.freeze({ ok: true, ...p, targetLineIds: Object.freeze(p.targetLineIds ?? []), translated: Object.freeze(p.translated ?? []), translatedLineCount: p.translated?.length ?? 0, translatedLinearLineCount: p.translatedLinearLineCount ?? p.translated?.filter((e)=>LINEAR.has(e.motion)).length ?? 0, translatedArcLineCount: p.translatedArcLineCount ?? p.translated?.filter((e)=>ARC.has(e.motion)).length ?? 0, ignored: Object.freeze(p.ignored ?? []), ignoredLineCount: p.ignored?.length ?? 0, blockers, blockedArcBoundaries: Object.freeze(p.blockedArcBoundaries ?? []), blockerCount: blockers.length, ranges: Object.freeze(p.ranges ?? []), rangeCount: p.ranges?.length ?? 0, expectedChangedLineIds: Object.freeze(p.expectedChangedLineIds ?? []), expectedConnectorChanges: Object.freeze(p.expectedConnectorChanges ?? []), connectorChangeCount: p.expectedConnectorChanges?.length ?? 0, applicable }); }
function ignore(line,index,reason,message){ return Object.freeze({ lineId: line.lineId, canonicalIndex: index, reason, message }); }
function block(lineId, canonicalIndex, reason, message){ return Object.freeze({ lineId, canonicalIndex, reason, message }); }
function fail(code, message, lineId = null, extra = null) { return Object.freeze({ ok: false, error: Object.freeze({ code, message, operationKind: 'semantic-translation', lineId, extra }) }); }
function finiteXY(p){ return Number.isFinite(p?.x) && Number.isFinite(p?.y); }
function near(a,b){ return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= NC_EXECUTION_EPSILON; }
function samePoint(a,b){ return Boolean(a&&b) && near(a.x,b.x) && near(a.y,b.y) && near(a.z,b.z); }
function vdiag(lineId, code, message){ return Object.freeze({ lineId, code, message }); }
function findPreviousExecutableMotion(document, index) { for (let i = index - 1; i >= 0; i -= 1) { const line = document.lines[i]; if (line.kind === 'motion' && MOTION.has(line.motion)) return line; } return null; }
function findPreviousCacheSegment(cache, index) { for (let i = index - 1; i >= 0; i -= 1) { const e = cache?.entries?.[i]; if (e?.segments?.[0]) return e.segments[0]; } return null; }
function verifyArcEntry({ diagnostics, entry: e, before, line, beforeCache, candidateCache }) {
  const oldSeg = beforeCache.byLineId.get(e.lineId)?.segments?.[0]; const newSeg = candidateCache.byLineId.get(e.lineId)?.segments?.[0];
  if (!oldSeg || !newSeg || !oldSeg.arc || !newSeg.arc) { diagnostics.push(vdiag(e.lineId, 'arc-segment-missing', 'Translated arc segment is missing.')); return; }
  const expectedStart = { x: oldSeg.start.x + e.afterCenter.x - e.beforeCenter.x, y: oldSeg.start.y + e.afterCenter.y - e.beforeCenter.y, z: oldSeg.start.z };
  if (!samePoint(newSeg.start, expectedStart)) diagnostics.push(vdiag(e.lineId, 'arc-start-mismatch', 'Translated arc start does not match the plan.'));
  if (!near(line.arc.center.x, e.afterCenter.x) || !near(line.arc.center.y, e.afterCenter.y)) diagnostics.push(vdiag(e.lineId, 'arc-center-mismatch', 'Translated arc center does not match the plan.'));
  if (!near(newSeg.arc.radius, oldSeg.arc.radius) || !near(Math.hypot(newSeg.end.x - newSeg.arc.center.x, newSeg.end.y - newSeg.arc.center.y), Math.hypot(oldSeg.end.x - oldSeg.arc.center.x, oldSeg.end.y - oldSeg.arc.center.y))) diagnostics.push(vdiag(e.lineId, 'arc-radius-changed', 'Translated arc radius changed.'));
  if (newSeg.motion !== oldSeg.motion || newSeg.arc.direction !== oldSeg.arc.direction || newSeg.arc.clockwise !== oldSeg.arc.clockwise) diagnostics.push(vdiag(e.lineId, 'arc-direction-changed', 'Translated arc direction changed.'));
  if (!near(newSeg.arc.sweep, oldSeg.arc.sweep)) diagnostics.push(vdiag(e.lineId, 'arc-sweep-changed', 'Translated arc sweep changed.'));
}
