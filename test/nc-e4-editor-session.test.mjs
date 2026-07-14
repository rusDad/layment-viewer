import assert from 'node:assert/strict';
import { createRawNcDocument } from '../public/nc/document/RawNcDocument.mjs';
import { createCanonicalNcDocument, serializeCanonicalNcDocument } from '../public/nc/document/CanonicalNcDocument.mjs';
import { deleteCanonicalLinesCommand, replaceCanonicalLine, updateCanonicalLineNumericField } from '../public/nc/document/CanonicalNcEditor.mjs';
import { executeCanonicalDocument, recalculateCanonicalExecution, entriesSemanticallyEqual } from '../public/nc/execution/NcCanonicalExecution.mjs';
import { buildNcEditImpact } from '../public/nc/document/NcEditImpact.mjs';
import { NcEditHistory, NC_EDIT_HISTORY_LIMIT } from '../public/nc/document/NcEditHistory.mjs';
import { orderedSelection, rangeSelection, toggleSelection, reconcile } from '../public/nc/NcSelectionController.js';

const raw = createRawNcDocument('G1 X1\n', { filename: 'e4.nc' });
const mk = (id, x, y = 0, z = 0, f = 100) => Object.freeze({ lineId: id, kind: 'motion', motion: 'G1', end: Object.freeze({ x, y, z }), feed: f, text: null, sourceOrigin: Object.freeze({ rawLineNumbers: [Number(id.slice(1)) || 1], normalizationKind: 'test' }), parseStatus: 'ok' });
const comment = (id) => Object.freeze({ lineId: id, kind: 'comment', text: '; keep', sourceOrigin: Object.freeze({ rawLineNumbers: [9], normalizationKind: 'test' }), parseStatus: 'ok' });
const doc = (lines, revision = 0) => Object.freeze({ ...createCanonicalNcDocument({ rawDocument: raw, lines }), revision });
const assertCacheEqual = (a, b) => { assert.equal(a.entries.length, b.entries.length); a.entries.forEach((entry, i) => assert.ok(entriesSemanticallyEqual(entry, b.entries[i]), `entry ${i}`)); assert.deepEqual(a.segments.map((s)=>s.segmentId), b.segments.map((s)=>s.segmentId)); };

const order = ['L1','L2','L3','L4','L5'];
assert.deepEqual(orderedSelection(['L3'], order, 'L3', 'L3', 'source').orderedLineIds, ['L3']);
assert.deepEqual(toggleSelection({ current: orderedSelection(['L2'], order, 'L2', 'L2'), clickedLineId: 'L4', order, origin: 'source' }).orderedLineIds, ['L2','L4']);
assert.deepEqual(toggleSelection({ current: orderedSelection(['L2','L4'], order, 'L2', 'L4'), clickedLineId: 'L2', order, origin: 'source' }).anchorLineId, 'L4');
assert.deepEqual(rangeSelection({ current: orderedSelection(['L2'], order, 'L2', 'L2'), clickedLineId: 'L5', order, union: false }).orderedLineIds, ['L2','L3','L4','L5']);
assert.deepEqual(rangeSelection({ current: orderedSelection(['L1','L3'], order, 'L3', 'L1'), clickedLineId: 'L5', order, union: true }).orderedLineIds, ['L1','L3','L4','L5']);
assert.deepEqual(reconcile({ orderedLineIds: ['L9','L2','L2'], anchorLineId: 'L9', focusLineId: 'L2' }, order).orderedLineIds, ['L2']);

const base = doc([mk('L1', 10), mk('L2', 20), comment('L3'), mk('L4', 40), mk('L5', 50)]);
const cache = executeCanonicalDocument(base);
let result = deleteCanonicalLinesCommand({ document: base, expectedRevision: 0, lineIds: ['L4','L2','L2'], initialCanonicalText: serializeCanonicalNcDocument(base) });
assert.equal(result.ok, true);
assert.deepEqual(result.deletedLineIds, ['L2','L4']);
assert.deepEqual(result.document.lines.map((line)=>line.lineId), ['L1','L3','L5']);
assert.equal(result.document.lines[0], base.lines[0], 'surviving line object identity is preserved');
assert.deepEqual(result.document.lines[1].sourceOrigin, base.lines[2].sourceOrigin, 'provenance is preserved');
assert.equal(result.document.revision, 1);
assert.equal(result.firstAffectedIndex, 1);
assert.match(serializeCanonicalNcDocument(result.document), /L?G1 X50|G1 X50/);
assert.equal(deleteCanonicalLinesCommand({ document: base, expectedRevision: 99, lineIds: ['L1'] }).ok, false);
assert.equal(deleteCanonicalLinesCommand({ document: base, expectedRevision: 0, lineIds: ['missing'] }).ok, false);

let executed = 0;
const update = recalculateCanonicalExecution({ document: result.document, previousCache: cache, firstAffectedIndex: result.firstAffectedIndex, onExecuteLine: () => { executed += 1; } });
assertCacheEqual(update.cache, executeCanonicalDocument(result.document));
assert.deepEqual(update.cache.entries.map((e)=>e.canonicalIndex), [0,1,2]);
assert.deepEqual(update.cache.segments.map((s)=>s.sourceLineId), ['L1','L5']);
assert.ok(!update.cache.byLineId.has('L2'));
assert.ok(!update.cache.segmentById.has('L2:0'));
assert.ok(executed < base.lines.length, 'lineId convergence avoids full suffix recalculation');

const editedLine = updateCanonicalLineNumericField(base.lines[1], 'x', 25);
const edited = replaceCanonicalLine(base, 1, editedLine, serializeCanonicalNcDocument(base));
const editUpdate = recalculateCanonicalExecution({ document: edited, previousCache: cache, firstAffectedIndex: 1 });
const impact = buildNcEditImpact({ beforeDocument: base, afterDocument: edited, beforeCache: cache, afterCache: editUpdate.cache, executionUpdate: editUpdate, operation: { kind: 'update-numeric-field', label: 'Change X' }, dirty: edited.dirty });
assert.ok(impact.changedSegmentCount >= 1);
assert.ok(impact.previousOverlaySegments.some((s)=>s.segmentId === 'L2:0'));
const deletedImpact = buildNcEditImpact({ beforeDocument: base, afterDocument: result.document, beforeCache: cache, afterCache: update.cache, executionUpdate: update, operation: { kind: 'delete-lines', label: 'Delete' }, dirty: result.document.dirty });
assert.ok(deletedImpact.removedSegmentCount >= 1);
assert.ok(deletedImpact.previousOverlaySegments.some((s)=>s.sourceLineId === 'L2'));

const history = new NcEditHistory({ limit: 3 });
history.push({ kind: 'delete-lines', label: 'Delete', beforeDocument: base, afterDocument: result.document, firstAffectedIndex: 1, selectionBefore: orderedSelection(['L2'], order, 'L2', 'L2'), selectionAfter: orderedSelection(['L3'], ['L1','L3','L5'], 'L3', 'L3'), changedLineIds: ['L2'] });
assert.equal(history.canUndo(), true);
assert.equal(history.moveUndo().transaction.beforeDocument, base);
assert.equal(history.canRedo(), true);
assert.equal(history.moveRedo().transaction.afterDocument, result.document);
for (let i = 0; i < NC_EDIT_HISTORY_LIMIT + 5; i += 1) history.push({ kind: 'update-numeric-field', label: `e${i}`, beforeDocument: base, afterDocument: edited, firstAffectedIndex: 1, selectionBefore: orderedSelection([], order), selectionAfter: orderedSelection([], order), changedLineIds: ['L2'] });
assert.equal(history.past.length, 3, 'custom history limit is enforced');
assert.ok(!history.past.some((tx) => tx.object?.isLineSegments), 'history stores no Three.js objects');

console.log('OK: NC-E4 editor session focused tests passed.');
