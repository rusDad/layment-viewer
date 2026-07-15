import assert from 'node:assert/strict';
import { createRawNcDocument } from '../public/nc/document/RawNcDocument.mjs';
import { createCanonicalNcDocument, serializeCanonicalNcDocument } from '../public/nc/document/CanonicalNcDocument.mjs';
import { applySemanticTranslationCommand, buildSemanticTranslationPlan, buildTranslatedCandidateDocument, verifySemanticTranslationPlan } from '../public/nc/document/NcSemanticTranslation.mjs';
import { executeCanonicalDocument, executeCanonicalDocument as fullExecute, entriesSemanticallyEqual, recalculateCanonicalExecution } from '../public/nc/execution/NcCanonicalExecution.mjs';
import { NcEditHistory } from '../public/nc/document/NcEditHistory.mjs';

const raw = createRawNcDocument('G1 X1\n', { filename: 'translate.nc' });
const origin = (n) => Object.freeze({ rawLineNumbers: [n], normalizationKind: 'test' });
const motion = (id, g, x, y, z = 0, feed = 100, extra = {}) => Object.freeze({ lineId: id, kind: 'motion', motion: g, end: Object.freeze({ x, y, z }), feed, text: null, sourceOrigin: origin(Number(id.slice(1)) || 1), parseStatus: 'ok', ...extra });
const comment = (id) => Object.freeze({ lineId: id, kind: 'comment', text: '; keep', sourceOrigin: origin(Number(id.slice(1)) || 1), parseStatus: 'ok' });
const opaque = (id) => Object.freeze({ lineId: id, kind: 'opaque', text: 'M99', sourceOrigin: origin(Number(id.slice(1)) || 1), parseStatus: 'ok' });
const doc = (lines, revision = 0) => Object.freeze({ ...createCanonicalNcDocument({ rawDocument: raw, lines }), revision });
const assertCacheEqual = (a, b) => { assert.equal(a.entries.length, b.entries.length); a.entries.forEach((entry, i) => assert.ok(entriesSemanticallyEqual(entry, b.entries[i]), `entry ${i}`)); };

let base = doc([motion('L1','G1',10,10,-1,200)]);
let cache = executeCanonicalDocument(base);
let plan = buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L1'], dxMm: 5, dyMm: 2 });
assert.equal(plan.applicable, true);
let result = applySemanticTranslationCommand({ document: base, previousCache: cache, initialCanonicalText: serializeCanonicalNcDocument(base), expectedRevision: 0, plan });
assert.equal(result.ok, true);
assert.equal(result.document.lines[0].end.x, 15);
assert.equal(result.document.lines[0].end.y, 12);
assert.equal(result.document.lines[0].motion, 'G1');
assert.equal(result.document.lines[0].end.z, -1);
assert.equal(result.document.lines[0].feed, 200);
assert.equal(result.document.lines[0].lineId, 'L1');
assert.deepEqual(result.document.lines[0].sourceOrigin, base.lines[0].sourceOrigin);
assert.match(serializeCanonicalNcDocument(result.document), /^G1 X15 Y12 Z-1 F200\n$/);
assertCacheEqual(result.executionUpdate.cache, fullExecute(result.document));

base = doc([motion('L1','G0',1,2,0,10)]); cache = executeCanonicalDocument(base);
plan = buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L1'], dxMm: -0.5, dyMm: 1.25 });
result = applySemanticTranslationCommand({ document: base, previousCache: cache, initialCanonicalText: '', plan });
assert.equal(result.document.lines[0].motion, 'G0');
assert.deepEqual(result.document.lines[0].end, { x: 0.5, y: 3.25, z: 0 });

base = doc([motion('L1','G0',0,0), motion('L2','G1',10,0), comment('L3'), motion('L4','G1',20,0), motion('L5','G1',30,0)]);
cache = executeCanonicalDocument(base);
plan = buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L2','L3','L4'], dxMm: 0, dyMm: 10 });
assert.equal(plan.rangeCount, 1);
assert.equal(plan.ignoredLineCount, 1);
assert.equal(plan.connectorChangeCount, 1);
assert.equal(plan.expectedConnectorChanges[0].lineId, 'L5');
result = applySemanticTranslationCommand({ document: base, previousCache: cache, initialCanonicalText: '', plan });
const s2 = result.executionUpdate.cache.byLineId.get('L2').segments[0];
const s4 = result.executionUpdate.cache.byLineId.get('L4').segments[0];
const s5 = result.executionUpdate.cache.byLineId.get('L5').segments[0];
assert.deepEqual(s2.start, { x: 0, y: 0, z: 0 }, 'first selected segment starts at unchanged incoming position');
assert.deepEqual(s2.end, { x: 10, y: 10, z: 0 });
assert.deepEqual(s4.start, { x: 10, y: 10, z: 0 }, 'interior segment start is translated');
assert.deepEqual(s4.end, { x: 20, y: 10, z: 0 });
assert.deepEqual(s5.start, { x: 20, y: 10, z: 0 }, 'outgoing connector starts from translated endpoint');
assert.deepEqual(s5.end, { x: 30, y: 0, z: 0 }, 'outgoing connector keeps original absolute end');

base = doc([motion('L1','G1',1,0), motion('L2','G1',2,0), motion('L3','G1',3,0), motion('L4','G1',4,0)]);
cache = executeCanonicalDocument(base);
plan = buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L1','L3'], dxMm: 1, dyMm: 0 });
assert.equal(plan.rangeCount, 2);
assert.equal(plan.earliestAffectedLineIndex, 0);
assert.equal(plan.connectorChangeCount, 2);

base = doc([motion('L1','G1',1,0), motion('L2','G2',2,0,0,100,{ start: Object.freeze({ x: 1, y: 0, z: 0 }), arc: Object.freeze({ center: Object.freeze({ x: 1, y: 1 }) }) })]);
cache = executeCanonicalDocument(base);
assert.equal(buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L2'], dxMm: 1, dyMm: 1 }).blockers[0].reason, 'selected-arc');
assert.equal(buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L1'], dxMm: 1, dyMm: 1 }).blockers[0].reason, 'outgoing-arc-boundary');

base = doc([motion('L1','G1',1,0), opaque('L2')]); cache = executeCanonicalDocument(base);
assert.equal(buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L1'], dxMm: Infinity, dyMm: 0 }).applicable, false);
assert.equal(buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L1'], dxMm: 0, dyMm: 0 }).noOp, true);
assert.equal(buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L2'], dxMm: 1, dyMm: 1 }).blockerCount, 1);

base = doc([motion('L1','G1',1,0), motion('L2','G1',2,0)]); cache = executeCanonicalDocument(base);
const beforeText = serializeCanonicalNcDocument(base);
plan = buildSemanticTranslationPlan({ document: base, previousCache: cache, lineIds: ['L2'], dxMm: 1, dyMm: 1 });
assert.equal(serializeCanonicalNcDocument(base), beforeText, 'planning does not mutate document');
assertCacheEqual(cache, executeCanonicalDocument(base));
assert.equal(applySemanticTranslationCommand({ document: Object.freeze({ ...base, revision: 1 }), previousCache: cache, plan }).ok, false, 'stale revision-bound plan is rejected');
result = applySemanticTranslationCommand({ document: base, previousCache: cache, initialCanonicalText: beforeText, plan });
const history = new NcEditHistory();
history.push({ kind: 'semantic-translation', label: 'Translate', beforeDocument: base, afterDocument: result.document, firstAffectedIndex: result.firstAffectedIndex, selectionBefore: { orderedLineIds: ['L2'] }, selectionAfter: { orderedLineIds: ['L2'] }, changedLineIds: result.changedLineIds });
assert.equal(history.getState().pastCount, 1);
assert.equal(history.moveUndo().transaction.beforeDocument.lines[1].end.x, 2);
assert.equal(history.moveRedo().transaction.afterDocument.lines[1].end.y, 1);
let executed = [];
const inc = recalculateCanonicalExecution({ document: result.document, previousCache: cache, firstAffectedIndex: result.firstAffectedIndex, onExecuteLine: (i)=>executed.push(i) });
assert.deepEqual(executed[0], 1);
assertCacheEqual(inc.cache, fullExecute(result.document));

const candidate = buildTranslatedCandidateDocument({ document: base, plan, initialCanonicalText: beforeText }).document;
const corrupt = Object.freeze({ ...candidate, lines: Object.freeze(candidate.lines.map((line, i)=> i === 1 ? Object.freeze({ ...line, end: Object.freeze({ ...line.end, y: 99 }) }) : line)) });
const corruptCache = executeCanonicalDocument(corrupt);
assert.equal(verifySemanticTranslationPlan({ beforeDocument: base, beforeCache: cache, candidateDocument: corrupt, candidateCache: corruptCache, plan }).ok, false);

console.log('OK: NC-E7 semantic translation tests passed.');
