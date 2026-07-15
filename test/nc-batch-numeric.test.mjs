import assert from 'node:assert/strict';
import { createRawNcDocument } from '../public/nc/document/RawNcDocument.mjs';
import { createCanonicalNcDocument, serializeCanonicalNcDocument } from '../public/nc/document/CanonicalNcDocument.mjs';
import { applyBatchNumericOperationCommand, buildBatchNumericEditPlan, createBatchNumericOperation } from '../public/nc/document/CanonicalNcEditor.mjs';
import { executeCanonicalDocument, executeCanonicalDocument as fullExecute, entriesSemanticallyEqual } from '../public/nc/execution/NcCanonicalExecution.mjs';
import { NcEditHistory } from '../public/nc/document/NcEditHistory.mjs';

const raw = createRawNcDocument('G1 X1\n', { filename: 'batch.nc' });
const motion = (id, x, z, feed, kind = 'motion') => kind === 'motion'
  ? Object.freeze({ lineId: id, kind: 'motion', motion: 'G1', end: Object.freeze({ x, y: 0, z }), feed, text: null, sourceOrigin: Object.freeze({ rawLineNumbers: [Number(id.slice(1)) || 1], normalizationKind: 'test' }), parseStatus: 'ok' })
  : Object.freeze({ lineId: id, kind, text: kind === 'comment' ? '; F999 Z9' : 'M3 S1000', sourceOrigin: Object.freeze({ rawLineNumbers: [Number(id.slice(1)) || 1], normalizationKind: 'test' }), parseStatus: 'ok' });
const doc = (lines, revision = 0) => Object.freeze({ ...createCanonicalNcDocument({ rawDocument: raw, lines }), revision });
const assertCacheEqual = (a, b) => { assert.equal(a.entries.length, b.entries.length); a.entries.forEach((entry, i) => assert.ok(entriesSemanticallyEqual(entry, b.entries[i]), `entry ${i}`)); };
const op = (draft) => { const r = createBatchNumericOperation(draft); assert.equal(r.ok, true); return r.operation; };

const base = doc([motion('L1', 1, 0, 100), motion('L2', 2, -2, 200), motion('L3', 3, -4, 300), motion('L4', 4, 0, 0, 'comment'), motion('L5', 5, 1, 500, 'opaque')]);
const initialText = serializeCanonicalNcDocument(base);
const cache = executeCanonicalDocument(base);

let plan = buildBatchNumericEditPlan({ document: base, lineIds: ['L1','L2','L4'], operation: op({ targetField: 'feed', type: 'set', value: 800 }) });
assert.equal(plan.ok, true);
assert.deepEqual(plan.affectedLineIds, ['L1','L2']);
assert.deepEqual(plan.changes.map((c) => [c.oldValue, c.newValue]), [[100,800],[200,800]]);
assert.equal(plan.skipped[0].reason, 'comment');
assert.equal(base.lines[0].feed, 100, 'planning does not mutate');

let result = applyBatchNumericOperationCommand({ document: base, previousCache: cache, initialCanonicalText: initialText, operation: plan.operation, plan });
assert.equal(result.ok, true);
assert.deepEqual(result.changedLineIds, ['L1','L2']);
assert.equal(result.document.lines[0].feed, 800);
assert.equal(result.document.lines[1].feed, 800);
assert.equal(result.document.lines[2].feed, 300);
assert.equal(result.firstAffectedIndex, 0);
assertCacheEqual(result.executionUpdate.cache, fullExecute(result.document));

plan = buildBatchNumericEditPlan({ document: base, lineIds: ['L2','L3'], operation: op({ targetField: 'feed', type: 'add', value: 25 }) });
assert.deepEqual(plan.changes.map((c) => c.newValue), [225,325]);
plan = buildBatchNumericEditPlan({ document: base, lineIds: ['L2','L3'], operation: op({ targetField: 'feed', type: 'multiply', value: 0.5 }) });
assert.deepEqual(plan.changes.map((c) => c.newValue), [100,150]);
plan = buildBatchNumericEditPlan({ document: base, lineIds: ['L1','L2','L3'], operation: op({ targetField: 'feed', type: 'clamp', min: 150, max: 250 }) });
assert.deepEqual(plan.changes.map((c) => [c.lineId, c.newValue]), [['L1',150],['L3',250]]);
assert.equal(plan.skipped.find((s) => s.lineId === 'L2').reason, 'unchanged');

plan = buildBatchNumericEditPlan({ document: base, lineIds: ['L1','L3','L4'], operation: op({ targetField: 'z', type: 'add', value: -1 }) });
assert.deepEqual(plan.changes.map((c) => [c.lineId, c.oldValue, c.newValue]), [['L1',0,-1],['L3',-4,-5]]);
assert.equal(plan.skipped[0].lineId, 'L4');

plan = buildBatchNumericEditPlan({ document: base, lineIds: [], operation: op({ targetField: 'feed', type: 'set', value: 1 }) });
assert.equal(plan.ok, true);
assert.equal(plan.affectedLineCount, 0);
assert.equal(plan.earliestAffectedLineIndex, null);

plan = buildBatchNumericEditPlan({ document: base, lineIds: ['L3','L1'], operation: op({ targetField: 'z', type: 'set', value: -9 }) });
assert.equal(plan.earliestAffectedLineIndex, 0);
result = applyBatchNumericOperationCommand({ document: base, previousCache: cache, initialCanonicalText: initialText, operation: plan.operation, plan });
const history = new NcEditHistory();
history.push({ kind: 'batch-numeric-operation', label: 'Batch Z', beforeDocument: base, afterDocument: result.document, firstAffectedIndex: result.firstAffectedIndex, selectionBefore: { orderedLineIds: ['L3','L1'] }, selectionAfter: { orderedLineIds: ['L1','L3'] }, changedLineIds: result.changedLineIds });
assert.equal(history.getState().pastCount, 1);
assert.equal(history.moveUndo().transaction.beforeDocument.lines[0].end.z, 0);
assert.equal(history.moveRedo().transaction.afterDocument.lines[2].end.z, -9);
assertCacheEqual(result.executionUpdate.cache, fullExecute(result.document));
assert.deepEqual(result.executionUpdate.cache.lineIdToSegmentIds.get('L1'), ['L1:0']);
assert.deepEqual(result.executionUpdate.cache.segmentIdToLineId.get('L3:0'), 'L3');

console.log('OK: NC-E6 batch numeric tests passed.');
