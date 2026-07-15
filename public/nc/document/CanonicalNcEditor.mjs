import { createCanonicalNcDocument, serializeCanonicalLine, serializeCanonicalNcDocument } from './CanonicalNcDocument.mjs';
import { recalculateCanonicalExecution } from '../execution/NcCanonicalExecution.mjs';
import { analyzeNcExecutionCache } from '../execution/NcProgramAnalysis.mjs';

const LINEAR_FIELDS = new Set(['x', 'y', 'z', 'feed']);
const ARC_FIELDS = new Set(['x', 'y', 'z', 'feed', 'arcCenterX', 'arcCenterY']);
const MOTIONS = new Set(['G0', 'G1', 'G2', 'G3']);
const ARC_MOTIONS = new Set(['G2', 'G3']);
const BATCH_NUMERIC_TARGET_FIELDS = new Set(['feed', 'z']);
const BATCH_NUMERIC_OPERATION_TYPES = new Set(['set', 'add', 'multiply', 'clamp']);

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


export function createBatchNumericOperation({ targetField, type, value, min, max } = {}) {
  const operation = Object.freeze({
    kind: 'batch-numeric-operation',
    targetField,
    type,
    value: value == null || value === '' ? null : Number(value),
    min: min == null || min === '' ? null : Number(min),
    max: max == null || max === '' ? null : Number(max)
  });
  const validation = validateBatchNumericOperation(operation);
  if (!validation.ok) return Object.freeze({ ok: false, error: validation.error, operation });
  return Object.freeze({ ok: true, operation });
}

export function buildBatchNumericEditPlan({ document, lineIds, operation } = {}) {
  if (!document) return batchFail('document-not-initialized', 'Canonical document is not initialized.');
  const validation = validateBatchNumericOperation(operation);
  if (!validation.ok) return Object.freeze({ ok: false, error: validation.error });
  const selected = Array.isArray(lineIds) ? [...new Set(lineIds.filter((id) => typeof id === 'string' && id.length > 0))] : [];
  const indexById = new Map(document.lines.map((line, index) => [line.lineId, index]));
  const missing = selected.find((id) => !indexById.has(id));
  if (missing) return batchFail('line-not-found', `Canonical line was not found: ${missing}.`, missing);
  const changes = [];
  const skipped = [];
  for (const lineId of selected.sort((a, b) => indexById.get(a) - indexById.get(b))) {
    const index = indexById.get(lineId);
    const line = document.lines[index];
    const field = operation.targetField;
    const editability = getLineEditability(line);
    if (!editability.editable) { skipped.push(skip(line, index, field, editability.reason, editability.message)); continue; }
    if (!getEditableNumericFields(line).includes(field)) { skipped.push(skip(line, index, field, 'field-not-supported', `Field ${field} is not supported for ${line.motion}.`)); continue; }
    const oldValue = getCanonicalNumericField(line, field);
    if (!Number.isFinite(oldValue)) { skipped.push(skip(line, index, field, 'missing-numeric-value', `Line has no finite ${field} value.`)); continue; }
    const newValue = applyBatchNumericValue(oldValue, operation);
    if (!Number.isFinite(newValue)) { skipped.push(skip(line, index, field, 'non-finite-result', `Operation produces non-finite ${field} value.`)); continue; }
    if (Object.is(oldValue, newValue)) { skipped.push(skip(line, index, field, 'unchanged', `${field} is already ${formatBatchNumber(newValue)}.`)); continue; }
    changes.push(Object.freeze({ lineId, canonicalIndex: index, field, oldValue, newValue, serializedBefore: serializeCanonicalLine(line), serializedAfter: serializeCanonicalLine(updateCanonicalLineNumericField(line, field, newValue)), sourceOrigin: line.sourceOrigin ?? null }));
  }
  return Object.freeze({
    ok: true,
    operation: freezeBatchOperation(operation),
    affectedLineIds: Object.freeze(changes.map((c) => c.lineId)),
    changes: Object.freeze(changes),
    skipped: Object.freeze(skipped),
    earliestAffectedLineIndex: changes.length ? Math.min(...changes.map((c) => c.canonicalIndex)) : null,
    affectedLineCount: changes.length,
    summary: summarizeBatchOperation(operation, changes.length, skipped.length)
  });
}

export function applyBatchNumericOperationCommand({ document, previousCache, initialCanonicalText, expectedRevision, lineIds, operation, plan } = {}) {
  if (!document || !previousCache) return batchFail('execution-failed', 'Canonical workspace is not initialized.');
  if (expectedRevision != null && expectedRevision !== document.revision) return batchFail('stale-revision', 'The canonical document changed. Rebuild the plan before applying this edit.');
  const editPlan = plan?.ok ? plan : buildBatchNumericEditPlan({ document, lineIds, operation });
  if (!editPlan.ok) return editPlan;
  if (editPlan.changes.length === 0) return Object.freeze({ ok: true, document, executionUpdate: null, plan: editPlan, noOp: true, changedLineIds: Object.freeze([]), firstAffectedIndex: null, previousValues: Object.freeze([]), newValues: Object.freeze([]) });
  const changeById = new Map(editPlan.changes.map((change) => [change.lineId, change]));
  let lines;
  try {
    lines = document.lines.map((line) => {
      const change = changeById.get(line.lineId);
      if (!change) return line;
      const updated = updateCanonicalLineNumericField(line, change.field, change.newValue);
      serializeCanonicalLine(updated);
      return updated;
    });
  } catch (err) {
    return batchFail('canonical-serialization-failed', err instanceof Error ? err.message : String(err));
  }
  const rebuilt = createCanonicalNcDocument({ rawDocument: document.rawDocument, lines, diagnostics: document.diagnostics });
  const candidate = Object.freeze({ ...rebuilt, documentId: document.documentId, revision: (document.revision ?? 0) + 1 });
  const text = serializeCanonicalNcDocument(candidate);
  const candidateDocument = Object.freeze({ ...candidate, dirty: initialCanonicalText == null ? true : text !== initialCanonicalText });
  let executionUpdate;
  try { executionUpdate = recalculateCanonicalExecution({ document: candidateDocument, previousCache, firstAffectedIndex: editPlan.earliestAffectedLineIndex }); }
  catch (err) { return batchFail('execution-failed', err instanceof Error ? err.message : String(err)); }
  const blocking = executionUpdate.cache.diagnostics.find((d) => editPlan.affectedLineIds.includes(d.lineId) && d.severity === 'error');
  if (blocking) return batchFail(blocking.code, blocking.message, blocking.lineId);
  const analysis = analyzeNcExecutionCache(executionUpdate.cache, candidateDocument);
  analysis.canonicalDocument = candidateDocument; analysis.rawDocument = candidateDocument.rawDocument; analysis.canonicalText = serializeCanonicalNcDocument(candidateDocument); analysis.executionCache = executionUpdate.cache;
  return Object.freeze({ ok: true, document: candidateDocument, executionUpdate, analysis, plan: editPlan, noOp: false, changedLineIds: editPlan.affectedLineIds, firstAffectedIndex: editPlan.earliestAffectedLineIndex, previousValues: Object.freeze(editPlan.changes.map(({ lineId, field, oldValue }) => Object.freeze({ lineId, field, value: oldValue }))), newValues: Object.freeze(editPlan.changes.map(({ lineId, field, newValue }) => Object.freeze({ lineId, field, value: newValue }))), dirty: candidateDocument.dirty });
}

function validateBatchNumericOperation(operation) {
  if (!operation || operation.kind !== 'batch-numeric-operation') return batchFail('invalid-operation', 'Batch numeric operation is missing or invalid.');
  if (!BATCH_NUMERIC_TARGET_FIELDS.has(operation.targetField)) return batchFail('invalid-target-field', 'Batch target field must be feed or z.');
  if (!BATCH_NUMERIC_OPERATION_TYPES.has(operation.type)) return batchFail('invalid-operation-type', 'Batch operation type must be set, add, multiply, or clamp.');
  if (operation.type === 'clamp') {
    const hasMin = operation.min != null; const hasMax = operation.max != null;
    if (!hasMin && !hasMax) return batchFail('invalid-clamp-range', 'Clamp requires min, max, or both.');
    if ((hasMin && !Number.isFinite(operation.min)) || (hasMax && !Number.isFinite(operation.max))) return batchFail('non-finite-number', 'Clamp bounds must be finite.');
    if (hasMin && hasMax && operation.min > operation.max) return batchFail('invalid-clamp-range', 'Clamp min must be less than or equal to max.');
    return { ok: true };
  }
  if (!Number.isFinite(operation.value)) return batchFail('non-finite-number', 'Operation value must be finite.');
  return { ok: true };
}
function applyBatchNumericValue(oldValue, operation) { if (operation.type === 'set') return operation.value; if (operation.type === 'add') return oldValue + operation.value; if (operation.type === 'multiply') return oldValue * operation.value; return Math.min(operation.max ?? Infinity, Math.max(operation.min ?? -Infinity, oldValue)); }
function skip(line, canonicalIndex, field, reason, message) { return Object.freeze({ lineId: line?.lineId ?? null, canonicalIndex, field, reason, message, sourceOrigin: line?.sourceOrigin ?? null }); }
function freezeBatchOperation(operation) { return Object.freeze({ kind: 'batch-numeric-operation', targetField: operation.targetField, type: operation.type, value: operation.value ?? null, min: operation.min ?? null, max: operation.max ?? null }); }
function summarizeBatchOperation(operation, changed, skippedCount) { return `${operation.type} ${operation.targetField}${operation.type === 'clamp' ? ` to [${operation.min ?? '-∞'}, ${operation.max ?? '∞'}]` : ` by ${formatBatchNumber(operation.value)}`} · ${changed} affected · ${skippedCount} skipped`; }
function formatBatchNumber(value) { return Number.isFinite(value) ? Number(value.toFixed(6)).toString() : String(value); }
function batchFail(code, message, lineId = null) { return Object.freeze({ ok: false, error: Object.freeze({ code, message, operationKind: 'batch-numeric', lineId }) }); }

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

export function deleteCanonicalLinesCommand({ document, expectedRevision, lineIds, initialCanonicalText } = {}) {
  if (!document) return fail('delete-not-allowed', 'Canonical document is not initialized.', null, null, undefined, -1);
  if (expectedRevision != null && expectedRevision !== document.revision) return fail('stale-revision', 'The canonical document changed. Reload the selection before deleting.', null, null, undefined, -1);
  const inputIds = Array.isArray(lineIds) ? lineIds.filter((id) => typeof id === 'string' && id.length > 0) : [];
  if (inputIds.length === 0) return fail('empty-selection', 'Select at least one canonical line before deleting.', null, null, undefined, -1);
  const normalized = [...new Set(inputIds)];
  const indexById = new Map(document.lines.map((line, index) => [line.lineId, index]));
  const missing = normalized.filter((id) => !indexById.has(id));
  if (missing.length > 0) return fail('line-not-found', `Canonical line was not found: ${missing[0]}.`, missing[0], null, undefined, -1);
  const deletedLineIds = normalized.slice().sort((a, b) => indexById.get(a) - indexById.get(b));
  const deletedIndexes = deletedLineIds.map((id) => indexById.get(id));
  const firstAffectedIndex = Math.min(...deletedIndexes);
  const deletedSet = new Set(deletedLineIds);
  const deletedLines = deletedLineIds.map((id) => document.lines[indexById.get(id)]);
  const lines = document.lines.filter((line) => !deletedSet.has(line.lineId));
  const rebuilt = createCanonicalNcDocument({ rawDocument: document.rawDocument, lines, diagnostics: document.diagnostics });
  const candidate = Object.freeze({ ...rebuilt, documentId: document.documentId, revision: (document.revision ?? 0) + 1 });
  const text = serializeCanonicalNcDocument(candidate);
  return Object.freeze({ ok: true, document: Object.freeze({ ...candidate, dirty: initialCanonicalText == null ? true : text !== initialCanonicalText }), deletedLineIds: Object.freeze(deletedLineIds), deletedLines: Object.freeze(deletedLines), firstAffectedIndex, noOp: false });
}

export function replaceCanonicalLine(document, index, line, initialCanonicalText) {
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
