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
  for (const lineId of selected.sort((a, b) => (indexById.get(a) ?? 1e9) - (indexById.get(b) ?? 1e9))) {
    if (!indexById.has(lineId)) continue;
    const index = indexById.get(lineId); const line = document.lines[index];
    if (line.kind === 'motion' && LINEAR.has(line.motion)) {
      if (!finiteXY(line.end)) blockers.push(block(lineId, index, 'non-finite-xy', 'Selected linear motion has non-finite X/Y.'));
      else if (!noOp) translated.push(entry(line, index, dx, dy));
      continue;
    }
    if (line.kind === 'motion' && ARC.has(line.motion)) blockers.push(block(lineId, index, 'selected-arc', 'Selected G2/G3 arcs cannot be translated by NC-E7.'));
    else if (line.kind === 'comment' || line.kind === 'empty' || line.kind === 'machine') ignored.push(ignore(line, index, 'non-motion', 'Selected line does not change canonical position.'));
    else blockers.push(block(lineId, index, 'unsupported-or-opaque', 'Selected line may affect motion semantics and cannot be translated deterministically.'));
  }
  const ranges = blockers.length || noOp ? [] : buildRanges({ document, previousCache, translated });
  for (const r of ranges) if (r.outgoingMotion === 'G2' || r.outgoingMotion === 'G3') blockers.push(block(r.outgoingLineId, r.outgoingIndex, 'outgoing-arc-boundary', 'Translated range is followed by an unselected G2/G3 arc; NC-E7 cannot change the arc start geometry.'));
  const earliest = translated.length ? Math.min(...translated.map((e) => e.canonicalIndex)) : null;
  return plan({ ...base, targetLineIds: selected, translated, ignored, blockers, ranges, earliestAffectedLineIndex: earliest, noOp, expectedChangedLineIds: translated.map((e) => e.lineId), expectedConnectorChanges: ranges.filter((r) => r.outgoingConnectorChanged).map((r) => ({ lineId: r.outgoingLineId, canonicalIndex: r.outgoingIndex, beforeStart: r.outgoingBeforeStart, afterStart: r.outgoingAfterStart, end: r.outgoingEnd })), verification: { ok: blockers.length === 0 && !noOp && translated.length > 0, diagnostics: [] } });
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
      const updated = Object.freeze({ ...line, end: Object.freeze({ ...line.end, x: c.after.x, y: c.after.y }), text: null });
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
    if (line.lineId !== e.lineId || !LINEAR.has(line.motion)) diagnostics.push(vdiag(e.lineId, 'line-mismatch', 'Translated line identity or motion type changed unexpectedly.'));
    if (!near(line.end.x, e.after.x) || !near(line.end.y, e.after.y) || !near(line.end.z, before.end.z) || !near(line.feed, before.feed)) diagnostics.push(vdiag(e.lineId, 'endpoint-mismatch', 'Translated endpoint, Z, or feed does not match the plan.'));
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
function entry(line, index, dx, dy) { return Object.freeze({ lineId: line.lineId, canonicalIndex: index, motion: line.motion, before: Object.freeze({ x: line.end.x, y: line.end.y }), after: Object.freeze({ x: line.end.x + dx, y: line.end.y + dy }), z: line.end.z, feed: line.feed, serializedBefore: serializeCanonicalLine(line), sourceOrigin: line.sourceOrigin ?? null }); }
function plan(p) { const blockers = Object.freeze(p.blockers ?? []); const applicable = blockers.length === 0 && !p.noOp && (p.translated?.length ?? 0) > 0 && (p.verification?.ok ?? false); return Object.freeze({ ok: true, ...p, targetLineIds: Object.freeze(p.targetLineIds ?? []), translated: Object.freeze(p.translated ?? []), translatedLineCount: p.translated?.length ?? 0, ignored: Object.freeze(p.ignored ?? []), ignoredLineCount: p.ignored?.length ?? 0, blockers, blockerCount: blockers.length, ranges: Object.freeze(p.ranges ?? []), rangeCount: p.ranges?.length ?? 0, expectedChangedLineIds: Object.freeze(p.expectedChangedLineIds ?? []), expectedConnectorChanges: Object.freeze(p.expectedConnectorChanges ?? []), connectorChangeCount: p.expectedConnectorChanges?.length ?? 0, applicable }); }
function ignore(line,index,reason,message){ return Object.freeze({ lineId: line.lineId, canonicalIndex: index, reason, message }); }
function block(lineId, canonicalIndex, reason, message){ return Object.freeze({ lineId, canonicalIndex, reason, message }); }
function fail(code, message, lineId = null, extra = null) { return Object.freeze({ ok: false, error: Object.freeze({ code, message, operationKind: 'semantic-translation', lineId, extra }) }); }
function finiteXY(p){ return Number.isFinite(p?.x) && Number.isFinite(p?.y); }
function near(a,b){ return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= NC_EXECUTION_EPSILON; }
function samePoint(a,b){ return Boolean(a&&b) && near(a.x,b.x) && near(a.y,b.y) && near(a.z,b.z); }
function vdiag(lineId, code, message){ return Object.freeze({ lineId, code, message }); }
