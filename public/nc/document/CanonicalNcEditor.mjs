import { createCanonicalNcDocument, serializeCanonicalLine, serializeCanonicalNcDocument } from './CanonicalNcDocument.mjs';
import { recalculateCanonicalExecution } from '../execution/NcCanonicalExecution.mjs';
import { analyzeNcExecutionCache } from '../execution/NcProgramAnalysis.mjs';

const LINEAR_FIELDS = new Set(['x', 'y', 'z', 'feed']);
const ARC_FIELDS = new Set(['x', 'y', 'z', 'feed', 'arcCenterX', 'arcCenterY']);
const MOTIONS = new Set(['G0', 'G1', 'G2', 'G3']);
const ARC_MOTIONS = new Set(['G2', 'G3']);

export function getEditableNumericFields(line) {
  if (!line || line.kind !== 'motion' || !MOTIONS.has(line.motion)) return [];
  return [...(ARC_MOTIONS.has(line.motion) ? ARC_FIELDS : LINEAR_FIELDS)];
}

export function getLineEditability(line) {
  if (!line) return { editable: false, reason: 'line-not-found', message: 'Canonical line was not found.' };
  if (line.kind === 'comment' || line.kind === 'empty') return { editable: false, reason: 'comment', message: 'Comments and empty lines are read-only.' };
  if (line.kind === 'opaque') return { editable: false, reason: 'opaque preserved command', message: 'Opaque preserved commands are read-only.' };
  if (line.kind !== 'motion') return { editable: false, reason: 'non-motion command', message: 'Non-motion commands are read-only.' };
  if (!MOTIONS.has(line.motion)) return { editable: false, reason: 'unsupported for structured editing', message: `Motion ${line.motion ?? 'n/a'} is not supported for structured editing.` };
  return { editable: true, reason: null, message: 'Structured numeric editing is available.' };
}

export function getCanonicalLineEditReadModel({ document, cache, lineId }) {
  const index = document?.lines?.findIndex((line) => line.lineId === lineId) ?? -1;
  const line = index >= 0 ? document.lines[index] : null;
  const entry = line ? cache?.byLineId?.get(line.lineId) : null;
  const editability = getLineEditability(line);
  return Object.freeze({
    lineId: lineId ?? null,
    revision: document?.revision ?? 0,
    canonicalIndex: index,
    line,
    serializedLine: line ? serializeCanonicalLine(line) : '',
    editability,
    fields: editability.editable ? getEditableNumericFields(line).map((field) => Object.freeze({ field, value: getCanonicalNumericField(line, field) })) : [],
    execution: entry ? Object.freeze({ start: entry.inputState.position, end: entry.outputState.position, diagnostics: entry.diagnostics, segmentIds: entry.segments.map((s) => s.segmentId) }) : null,
    sourceOrigin: line?.sourceOrigin ?? null
  });
}

export function applyUpdateCanonicalNumericFieldCommand({ document, previousCache, initialCanonicalText, expectedRevision, lineId, field, value } = {}) {
  const index = document?.lines?.findIndex((line) => line.lineId === lineId) ?? -1;
  if (!document || !previousCache) return fail('execution-failed', 'Canonical workspace is not initialized.', lineId, field, value, index);
  if (expectedRevision != null && expectedRevision !== document.revision) return fail('stale-revision', 'The canonical document changed. Reload the line before applying this edit.', lineId, field, value, index);
  if (index < 0) return fail('line-not-found', 'Canonical line was not found.', lineId, field, value, index);
  const line = document.lines[index];
  const editability = getLineEditability(line);
  if (!editability.editable) return fail('line-not-editable', editability.message, lineId, field, value, index, line.sourceOrigin);
  if (!getEditableNumericFields(line).includes(field)) return fail('field-not-supported', `Field ${field} is not supported for ${line.motion}.`, lineId, field, value, index, line.sourceOrigin);
  if (typeof value !== 'number') return fail('invalid-number', 'Numeric edit value must be a number.', lineId, field, value, index, line.sourceOrigin);
  if (!Number.isFinite(value)) return fail('non-finite-number', 'Numeric edit value must be finite.', lineId, field, value, index, line.sourceOrigin);

  let candidateLine;
  try {
    candidateLine = updateCanonicalLineNumericField(line, field, value);
    serializeCanonicalLine(candidateLine);
  } catch (err) {
    return fail('canonical-serialization-failed', err instanceof Error ? err.message : String(err), lineId, field, value, index, line.sourceOrigin);
  }

  const candidateDocument = replaceCanonicalLine(document, index, candidateLine, initialCanonicalText);
  let executionUpdate;
  try {
    executionUpdate = recalculateCanonicalExecution({ document: candidateDocument, previousCache, firstAffectedIndex: index });
  } catch (err) {
    return fail('execution-failed', err instanceof Error ? err.message : String(err), lineId, field, value, index, line.sourceOrigin);
  }
  const lineDiagnostics = executionUpdate.cache.diagnostics.filter((d) => d.lineId === lineId);
  const invalidArc = lineDiagnostics.find((d) => d.code === 'invalid-arc');
  if (invalidArc) return fail('invalid-arc', invalidArc.message, lineId, field, value, index, line.sourceOrigin);
  if (lineDiagnostics.some((d) => d.severity === 'error')) return fail('execution-failed', lineDiagnostics[0].message, lineId, field, value, index, line.sourceOrigin);

  const analysis = analyzeNcExecutionCache(executionUpdate.cache, candidateDocument);
  analysis.canonicalDocument = candidateDocument;
  analysis.rawDocument = candidateDocument.rawDocument;
  analysis.canonicalText = serializeCanonicalNcDocument(candidateDocument);
  analysis.executionCache = executionUpdate.cache;
  return Object.freeze({ ok: true, document: candidateDocument, executionUpdate, analysis, changedLineId: lineId, dirty: candidateDocument.dirty });
}

export function updateCanonicalLineNumericField(line, field, value) {
  const end = { ...line.end };
  const arc = line.arc ? { ...line.arc, center: { ...line.arc.center } } : line.arc;
  let feed = line.feed;
  if (field === 'x') end.x = value;
  else if (field === 'y') end.y = value;
  else if (field === 'z') end.z = value;
  else if (field === 'feed') feed = value;
  else if (field === 'arcCenterX' && arc) arc.center.x = value;
  else if (field === 'arcCenterY' && arc) arc.center.y = value;
  else throw new Error(`Unsupported canonical numeric field: ${field}`);
  return Object.freeze({ ...line, end: Object.freeze(end), arc: arc ? Object.freeze({ ...arc, center: Object.freeze(arc.center) }) : arc, feed, text: null });
}

function replaceCanonicalLine(document, index, line, initialCanonicalText) {
  const lines = document.lines.map((candidate, i) => i === index ? line : candidate);
  const rebuilt = createCanonicalNcDocument({ rawDocument: document.rawDocument, lines, diagnostics: document.diagnostics });
  const revision = (document.revision ?? 0) + (serializeCanonicalLine(document.lines[index]) === serializeCanonicalLine(line) ? 0 : 1);
  const candidate = Object.freeze({ ...rebuilt, documentId: document.documentId, revision });
  const text = serializeCanonicalNcDocument(candidate);
  return Object.freeze({ ...candidate, dirty: initialCanonicalText == null ? Boolean(document.dirty) : text !== initialCanonicalText });
}

function getCanonicalNumericField(line, field) {
  if (field === 'x') return line.end?.x;
  if (field === 'y') return line.end?.y;
  if (field === 'z') return line.end?.z;
  if (field === 'feed') return line.feed;
  if (field === 'arcCenterX') return line.arc?.center?.x;
  if (field === 'arcCenterY') return line.arc?.center?.y;
  return undefined;
}

function fail(code, message, lineId, field, rejectedValue, canonicalIndex = -1, sourceOrigin = null) {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, lineId: lineId ?? null, field: field ?? null, rejectedValue, canonicalIndex, sourceOrigin }) });
}

export function createEditedNcFilename(filename, dirty = true) {
  const base = typeof filename === 'string' && filename.trim() ? filename.trim().replace(/[\\/]/g, '_') : 'normalized.nc';
  const withoutKnownExt = base.replace(/\.(nc|gcode|tap|txt)$/i, '');
  return `${withoutKnownExt}${dirty ? '.edited.nc' : '.normalized.nc'}`;
}
