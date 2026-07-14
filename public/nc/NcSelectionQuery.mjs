import { NC_EXECUTION_EPSILON } from './execution/NcCanonicalExecution.mjs';

export const NC_SELECTION_QUERY_SCOPES = Object.freeze(['document', 'current-selection']);
export const NC_SELECTION_QUERY_COMBINATIONS = Object.freeze(['all', 'any']);
export const NC_SELECTION_QUERY_PREDICATES = Object.freeze(['line-kind', 'motion', 'z', 'feed', 'diagnostic', 'canonical-range', 'source-range']);
const OPS = new Set(['<', '<=', '=', '>=', '>']);
const MOTIONS = new Set(['G0', 'G1', 'G2', 'G3']);
const LINE_KINDS = new Set(['motion', 'comment', 'machine', 'opaque', 'empty']);
const SEVERITIES = new Set(['error', 'blocking-warning', 'warning', 'info']);

export function evaluateNcSelectionQuery({ document, cache, analysis = null, currentSelection = null, query } = {}) {
  const validation = validateNcSelectionQuery(query, document);
  if (!validation.ok) return invalidResult(validation.errors);

  const lines = document?.lines ?? [];
  const selected = new Set(currentSelection?.orderedLineIds ?? []);
  const scopeLineIds = query.scope === 'current-selection'
    ? lines.filter((line) => selected.has(line.lineId)).map((line) => line.lineId)
    : lines.map((line) => line.lineId);

  const diagnosticsByLineId = buildDiagnosticsByLineId(cache, analysis);
  const matched = [];
  for (const lineId of scopeLineIds) {
    const entry = cache?.byLineId?.get(lineId) ?? null;
    const line = linesById(document).get(lineId);
    const ctx = { line, entry, diagnostics: diagnosticsByLineId.get(lineId) ?? [] };
    const flags = query.predicates.map((predicate) => predicateMatches(predicate, ctx));
    const ok = query.combination === 'all' ? flags.every(Boolean) : flags.some(Boolean);
    if (ok) matched.push(lineId);
  }

  return Object.freeze({
    ok: true,
    lineIds: Object.freeze([...new Set(matched)]),
    matchedCount: matched.length,
    scannedCount: scopeLineIds.length,
    summary: Object.freeze({ scope: query.scope, combination: query.combination, predicateCount: query.predicates.length }),
    diagnostics: Object.freeze([]),
    documentRevision: document?.revision ?? null
  });
}

export function validateNcSelectionQuery(query, document = null) {
  const errors = [];
  if (!query || typeof query !== 'object') errors.push(error('missing-required-field', 'Query is required.'));
  if (!NC_SELECTION_QUERY_SCOPES.includes(query?.scope)) errors.push(error('invalid-selection-scope', 'Selection query scope must be document or current-selection.'));
  if (!NC_SELECTION_QUERY_COMBINATIONS.includes(query?.combination)) errors.push(error('missing-required-field', 'Selection query combination must be all or any.'));
  if (!Array.isArray(query?.predicates) || query.predicates.length === 0) errors.push(error('empty-predicate-list', 'Add at least one predicate.'));
  for (const [index, predicate] of (query?.predicates ?? []).entries()) validatePredicate(predicate, index, errors, document);
  return errors.length ? { ok: false, errors: Object.freeze(errors) } : { ok: true, errors: Object.freeze([]) };
}

function validatePredicate(predicate, index, errors) {
  if (!predicate || typeof predicate !== 'object' || !NC_SELECTION_QUERY_PREDICATES.includes(predicate.kind)) { errors.push(error('unsupported-predicate', `Predicate ${index + 1} is not supported.`, index)); return; }
  if (predicate.kind === 'line-kind') validateValues(predicate.values, LINE_KINDS, 'missing-required-field', `Predicate ${index + 1} requires at least one line kind.`, index, errors);
  else if (predicate.kind === 'motion') validateValues(predicate.values, MOTIONS, 'missing-required-field', `Predicate ${index + 1} requires at least one motion.`, index, errors);
  else if (predicate.kind === 'z' || predicate.kind === 'feed') { validateOperatorValue(predicate, index, errors); }
  else if (predicate.kind === 'diagnostic') {
    if (predicate.severity != null && !SEVERITIES.has(predicate.severity)) errors.push(error('missing-required-field', `Predicate ${index + 1} has invalid diagnostic severity.`, index));
    if (predicate.code != null && String(predicate.code).trim() === '') errors.push(error('missing-required-field', `Predicate ${index + 1} has empty diagnostic code.`, index));
  } else if (predicate.kind === 'canonical-range' || predicate.kind === 'source-range') validateRange(predicate, index, errors);
}
function validateValues(values, allowed, code, message, index, errors) { if (!Array.isArray(values) || values.length === 0) errors.push(error(code, message, index)); else for (const value of values) if (!allowed.has(value)) errors.push(error('missing-required-field', `Predicate ${index + 1} has invalid value ${value}.`, index)); }
function validateOperatorValue(predicate, index, errors) { if (!OPS.has(predicate.operator)) errors.push(error('missing-required-field', `Predicate ${index + 1} requires a comparison operator.`, index)); validateNumber(predicate.value, index, errors); }
function validateNumber(value, index, errors) { if (typeof value !== 'number') errors.push(error('invalid-number', `Predicate ${index + 1} requires a numeric value.`, index)); else if (!Number.isFinite(value)) errors.push(error('non-finite-number', `Predicate ${index + 1} value must be finite.`, index)); }
function validateRange(predicate, index, errors) { if (!Number.isInteger(predicate.from) || !Number.isInteger(predicate.to)) errors.push(error('invalid-range', `Predicate ${index + 1} range endpoints must be integer line numbers.`, index)); else if (predicate.from < 1 || predicate.to < 1) errors.push(error('invalid-range', `Predicate ${index + 1} range must start at line 1 or greater.`, index)); else if (predicate.from > predicate.to) errors.push(error('range-from-greater-than-to', `Predicate ${index + 1} range start is greater than end.`, index)); }

let cachedDoc = null, cachedLinesById = null;
function linesById(document) { if (document === cachedDoc && cachedLinesById) return cachedLinesById; cachedDoc = document; cachedLinesById = new Map((document?.lines ?? []).map((line) => [line.lineId, line])); return cachedLinesById; }
function buildDiagnosticsByLineId(cache, analysis) { const map = new Map(); for (const diagnostic of [...(cache?.diagnostics ?? []), ...(analysis?.diagnostics ?? [])]) { const id = diagnostic.lineId ?? (Number.isInteger(diagnostic.canonicalIndex) ? cache?.canonicalIndexToLineId?.get(diagnostic.canonicalIndex) : null); if (!id) continue; const arr = map.get(id) ?? []; arr.push(diagnostic); map.set(id, arr); } return map; }
function predicateMatches(predicate, { line, entry, diagnostics }) {
  if (!line) return false;
  if (predicate.kind === 'line-kind') return predicate.values.includes(line.kind === 'opaque' && /^M/i.test(line.text ?? '') ? 'machine' : line.kind);
  if (predicate.kind === 'motion') return line.kind === 'motion' && predicate.values.includes(entry?.command?.motion ?? line.motion);
  if (predicate.kind === 'z') return line.kind === 'motion' && compareNumber(entry?.outputState?.position?.z ?? line.end?.z, predicate.operator, predicate.value);
  if (predicate.kind === 'feed') return line.kind === 'motion' && compareNumber(entry?.outputState?.feed ?? line.feed, predicate.operator, predicate.value);
  if (predicate.kind === 'diagnostic') return diagnostics.some((d) => (predicate.severity == null || d.severity === predicate.severity) && (predicate.code == null || d.code === predicate.code));
  if (predicate.kind === 'canonical-range') { const n = (line.currentIndex ?? entry?.canonicalIndex ?? -1) + 1; return n >= predicate.from && n <= predicate.to; }
  if (predicate.kind === 'source-range') return sourceRanges(line.sourceOrigin).some(([from, to]) => from <= predicate.to && to >= predicate.from);
  return false;
}
function sourceRanges(origin) {
  const ranges = [];
  for (const n of origin?.rawLineNumbers ?? []) if (Number.isInteger(n)) ranges.push([n, n]);
  const range = origin?.rawLineRange ?? origin?.rawRange;
  if (Number.isInteger(range?.from) && Number.isInteger(range?.to)) ranges.push([range.from, range.to]);
  if (Number.isInteger(origin?.rawLineStart) && Number.isInteger(origin?.rawLineEnd)) ranges.push([origin.rawLineStart, origin.rawLineEnd]);
  return ranges;
}
function compareNumber(actual, op, expected) { if (!Number.isFinite(actual)) return false; if (op === '=') return Math.abs(actual - expected) <= NC_EXECUTION_EPSILON; if (op === '<') return actual < expected; if (op === '<=') return actual < expected || Math.abs(actual - expected) <= NC_EXECUTION_EPSILON; if (op === '>=') return actual > expected || Math.abs(actual - expected) <= NC_EXECUTION_EPSILON; return actual > expected; }
function invalidResult(errors) { return Object.freeze({ ok: false, lineIds: Object.freeze([]), matchedCount: 0, scannedCount: 0, summary: null, diagnostics: Object.freeze(errors) }); }
function error(code, message, predicateIndex = null) { return Object.freeze({ severity: 'error', code, message, predicateIndex }); }
