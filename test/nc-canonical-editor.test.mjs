import assert from 'node:assert/strict';
import { importNcToCanonicalDocument } from '../public/nc/import/canonical-normalizer.mjs';
import { serializeCanonicalNcDocument, serializeCanonicalLine } from '../public/nc/document/CanonicalNcDocument.mjs';
import { executeCanonicalDocument, entriesSemanticallyEqual } from '../public/nc/execution/NcCanonicalExecution.mjs';
import { analyzeNcExecutionCache } from '../public/nc/execution/NcProgramAnalysis.mjs';
import { applyUpdateCanonicalNumericFieldCommand, createEditedNcFilename, getCanonicalLineEditReadModel } from '../public/nc/document/CanonicalNcEditor.mjs';

function mustImport(text) {
  const r = importNcToCanonicalDocument(text, { filename: 'part.nc' });
  assert.equal(r.ok, true, r.diagnostics?.map((d) => d.message).join('\n'));
  return r;
}
function edit(workspace, lineIndex, field, value, expectedRevision = workspace.document.revision) {
  const result = applyUpdateCanonicalNumericFieldCommand({ document: workspace.document, previousCache: workspace.cache, initialCanonicalText: workspace.initialText, lineId: workspace.document.lines[lineIndex].lineId, field, value, expectedRevision });
  if (result.ok) {
    workspace.document = result.document;
    workspace.cache = result.executionUpdate.cache;
    workspace.analysis = result.analysis;
  }
  return result;
}
function assertCacheEqualsFull(document, cache) {
  const full = executeCanonicalDocument(document);
  assert.equal(cache.entries.length, full.entries.length);
  cache.entries.forEach((entry, i) => assert.ok(entriesSemanticallyEqual(entry, full.entries[i]), `entry ${i} differs from full execution`));
  assert.deepEqual(analyzeNcExecutionCache(cache, document).bbox, analyzeNcExecutionCache(full, document).bbox);
}

const imported = mustImport(`; setup
G0 X0 Y0 Z0
G1 X10 Y20 Z-5 F600
G1 X30 Y20 Z-5 F600
G1 X50 Y20 Z-5 F600
G2 X60 Y20 I5 J0 F600
`);
const ws = { document: imported.canonicalDocument, cache: imported.executionCache, initialText: imported.canonicalText, analysis: imported.toolpath };
assert.equal(ws.document.dirty, false);

let ro = applyUpdateCanonicalNumericFieldCommand({ document: ws.document, previousCache: ws.cache, initialCanonicalText: ws.initialText, lineId: ws.document.lines[0].lineId, field: 'x', value: 1, expectedRevision: 0 });
assert.equal(ro.ok, false);
assert.equal(ro.error.code, 'line-not-editable');

let result = edit(ws, 1, 'x', 1);
assert.equal(result.ok, true);
assert.equal(ws.document.lines[1].lineId, imported.canonicalDocument.lines[1].lineId);
assert.equal(ws.document.lines[1].motion, 'G0');
assert.deepEqual(ws.document.lines[1].sourceOrigin, imported.canonicalDocument.lines[1].sourceOrigin);
assert.equal(serializeCanonicalLine(ws.document.lines[1]), 'G0 X1 Y0 Z0 F0');
assert.equal(ws.document.revision, 1);
assert.equal(ws.document.dirty, true);
assertCacheEqualsFull(ws.document, ws.cache);
assert.ok(result.executionUpdate.changedLineIds.includes(ws.document.lines[1].lineId));
assert.equal(ws.cache.segmentIdToLineId.get(`${ws.document.lines[2].lineId}:0`), ws.document.lines[2].lineId);

result = edit(ws, 2, 'y', 21);
assert.equal(result.ok, true);
result = edit(ws, 2, 'z', -6);
assert.equal(result.ok, true);
result = edit(ws, 2, 'feed', 700);
assert.equal(result.ok, true);
assert.equal(serializeCanonicalLine(ws.document.lines[2]), 'G1 X10 Y21 Z-6 F700');
assertCacheEqualsFull(ws.document, ws.cache);
assert.equal(analyzeNcExecutionCache(ws.cache, ws.document).bbox.minZ, -6);

result = edit(ws, 5, 'z', -1);
assert.equal(result.ok, true);
assert.equal(ws.document.lines[5].end.z, -1);
result = edit(ws, 5, 'arcCenterY', 20.1);
assert.equal(result.ok, true);
assert.equal(ws.document.lines[5].arc.center.y, 20.1);
assert.match(serializeCanonicalLine(ws.document.lines[5]), /I/);
assertCacheEqualsFull(ws.document, ws.cache);

const noOpRev = ws.document.revision;
result = edit(ws, 3, 'x', ws.document.lines[3].end.x);
assert.equal(result.ok, true);
assert.equal(ws.document.revision, noOpRev, 'same-value edit is a no-op document revision');

for (const value of [NaN, Infinity, -Infinity]) {
  const failed = applyUpdateCanonicalNumericFieldCommand({ document: ws.document, previousCache: ws.cache, initialCanonicalText: ws.initialText, lineId: ws.document.lines[2].lineId, field: 'x', value, expectedRevision: ws.document.revision });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'non-finite-number');
}
assert.equal(applyUpdateCanonicalNumericFieldCommand({ document: ws.document, previousCache: ws.cache, initialCanonicalText: ws.initialText, lineId: 'missing', field: 'x', value: 1 }).error.code, 'line-not-found');
assert.equal(applyUpdateCanonicalNumericFieldCommand({ document: ws.document, previousCache: ws.cache, initialCanonicalText: ws.initialText, lineId: ws.document.lines[2].lineId, field: 'arcCenterX', value: 1 }).error.code, 'field-not-supported');
assert.equal(applyUpdateCanonicalNumericFieldCommand({ document: ws.document, previousCache: ws.cache, initialCanonicalText: ws.initialText, lineId: ws.document.lines[2].lineId, field: 'x', value: 1, expectedRevision: -1 }).error.code, 'stale-revision');

const arcBad = applyUpdateCanonicalNumericFieldCommand({ document: ws.document, previousCache: ws.cache, initialCanonicalText: ws.initialText, lineId: ws.document.lines[5].lineId, field: 'arcCenterX', value: 100, expectedRevision: ws.document.revision });
assert.equal(arcBad.ok, false);
assert.equal(arcBad.error.code, 'invalid-arc');
assert.notEqual(ws.document.lines[5].arc.center.x, 100, 'failed edit remains atomic');

const readModel = getCanonicalLineEditReadModel({ document: ws.document, cache: ws.cache, lineId: ws.document.lines[2].lineId });
assert.equal(readModel.editability.editable, true);
assert.ok(readModel.fields.some((f) => f.field === 'feed' && f.value === 700));
assert.equal(readModel.execution.segmentIds[0], `${ws.document.lines[2].lineId}:0`);
assert.equal(createEditedNcFilename('part.nc', true), 'part.edited.nc');
assert.equal(createEditedNcFilename('part.nc', false), 'part.normalized.nc');
assert.equal(serializeCanonicalNcDocument(ws.document).endsWith('\n'), true);
assert.equal(imported.rawDocument.originalText.includes('G1 X10 Y20'), true, 'raw source remains unchanged');

const prop = mustImport(`G1 X10 Y20 Z-5 F600
G1 X30 Y20 Z-5 F600
G1 X50 Y20 Z-5 F600
G1 X70 Y20 Z-5 F600
`);
const pws = { document: prop.canonicalDocument, cache: prop.executionCache, initialText: prop.canonicalText };
const prefixEntry = pws.cache.entries[0];
const suffixEntry = pws.cache.entries[3];
const endpoint = edit(pws, 1, 'x', 35);
assert.equal(endpoint.ok, true);
assert.equal(endpoint.executionUpdate.firstRecalculatedIndex, 1);
assert.equal(endpoint.executionUpdate.convergedAtIndex, 3);
assert.equal(endpoint.executionUpdate.cache.entries[0], prefixEntry, 'unchanged prefix cache entry is reused');
assert.equal(endpoint.executionUpdate.cache.entries[3], suffixEntry, 'suffix entry after convergence is reused');
assertCacheEqualsFull(pws.document, pws.cache);
assert.equal(pws.cache.lineIdToSegmentIds.get(pws.document.lines[2].lineId)[0], `${pws.document.lines[2].lineId}:0`);

const feed = edit(pws, 1, 'feed', 601);
assert.equal(feed.ok, true);
assert.ok(feed.executionUpdate.convergedAtIndex <= 3);
assertCacheEqualsFull(pws.document, pws.cache);

console.log('OK: NC canonical editor regression passed.');
