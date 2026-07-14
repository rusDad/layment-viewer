import assert from 'node:assert/strict';
import { createRawNcDocument } from '../public/nc/document/RawNcDocument.mjs';
import { createCanonicalLineId, createCanonicalNcDocument } from '../public/nc/document/CanonicalNcDocument.mjs';
import { analyzeNcExecutionCache } from '../public/nc/execution/NcProgramAnalysis.mjs';
import { entriesSemanticallyEqual, executeCanonicalDocument, executeCanonicalLine, recalculateCanonicalExecution } from '../public/nc/execution/NcCanonicalExecution.mjs';
import { importNcToCanonicalDocument } from '../public/nc/import/canonical-normalizer.mjs';

const raw = createRawNcDocument('', { filename: 'synthetic.nc' });
function motion(n, code, x, y, z, f, arc = null) { return Object.freeze({ lineId: `L${n}`, kind: 'motion', motion: code, start: { x: 0, y: 0, z: 0 }, end: { x, y, z }, feed: f, arc, text: null, sourceOrigin: { rawLineNumbers: [n], normalizationKind: 'test' }, parseStatus: 'ok' }); }
function comment(n, text = '; comment') { return Object.freeze({ lineId: `L${n}`, kind: 'comment', text, sourceOrigin: { rawLineNumbers: [n], normalizationKind: 'test' }, parseStatus: 'ok' }); }
function doc(lines, revision = 0) { const d = createCanonicalNcDocument({ rawDocument: raw, lines }); return Object.freeze({ ...d, revision }); }
function assertCachesEqual(a, b) {
  assert.equal(a.entries.length, b.entries.length);
  a.entries.forEach((entry, i) => assert.ok(entriesSemanticallyEqual(entry, b.entries[i]), `entry ${i} differs`));
  assert.deepEqual(analyzeNcExecutionCache(a).bbox, analyzeNcExecutionCache(b).bbox);
  assert.deepEqual(analyzeNcExecutionCache(a).stats, analyzeNcExecutionCache(b).stats);
  assert.deepEqual(a.finalState, b.finalState);
}

let e = executeCanonicalLine(motion(1, 'G0', 10, 0, 5, 0), { position: { x: 0, y: 0, z: 0 }, feed: null }, 0, 0);
assert.equal(e.segments[0].motion, 'G0');
assert.deepEqual(e.outputState, { position: { x: 10, y: 0, z: 5 }, feed: 0 });
e = executeCanonicalLine(motion(2, 'G1', 20, 0, -1, 600), e.outputState, 1, 1);
assert.equal(e.segments[0].feed, 600);
e = executeCanonicalLine(motion(3, 'G2', 30, 0, -1, 600, { center: { x: 25, y: 0 } }), { position: { x: 20, y: 0, z: -1 }, feed: 600 }, 2, 2);
assert.equal(e.segments[0].arc.clockwise, true);
e = executeCanonicalLine(motion(4, 'G3', 20, 0, -1, 600, { center: { x: 25, y: 0 } }), { position: { x: 30, y: 0, z: -1 }, feed: 600 }, 3, 3);
assert.equal(e.segments[0].arc.clockwise, false);
e = executeCanonicalLine(comment(5), e.outputState, 4, 4);
assert.equal(e.segments.length, 0);
assert.deepEqual(e.inputState, e.outputState);
e = executeCanonicalLine(motion(6, 'G1', Infinity, 0, 0, 1), { position: { x: 0, y: 0, z: 0 }, feed: null }, 5, 5);
assert.equal(e.diagnostics[0].code, 'missing-or-non-finite-canonical-motion-value');
e = executeCanonicalLine(motion(7, 'G2', 1, 0, 0, 1, { center: { x: 0, y: 0 } }), { position: { x: 0, y: 0, z: 0 }, feed: null }, 6, 6);
assert.equal(e.diagnostics[0].code, 'invalid-arc');

const base = doc([motion(100, 'G1', 10, 20, -5, 600), motion(101, 'G1', 30, 20, -5, 600), motion(102, 'G1', 50, 20, -5, 600), motion(103, 'G1', 70, 20, -5, 600)]);
const cache = executeCanonicalDocument(base);
assert.deepEqual(cache.entries.map((x) => x.lineId), ['L100', 'L101', 'L102', 'L103']);
assert.equal(cache.byLineId.get('L101').segments[0].segmentId, 'L101:0');
assert.deepEqual(cache.lineIdToSegmentIds.get('L102'), ['L102:0']);
assert.equal(cache.segmentIdToLineId.get('L102:0'), 'L102');
assertCachesEqual(cache, executeCanonicalDocument(base));

const changedEndpoint = doc([base.lines[0], motion(101, 'G1', 35, 20, -5, 600), base.lines[2], base.lines[3]], 1);
let count = 0;
let update = recalculateCanonicalExecution({ document: changedEndpoint, previousCache: cache, firstAffectedIndex: 1, onExecuteLine: () => { count += 1; } });
assert.equal(update.convergedAtIndex, 3);
assert.equal(count, 3);
assert.ok(update.changedLineIds.includes('L101'));
assertCachesEqual(update.cache, executeCanonicalDocument(changedEndpoint));

const deleted = doc([base.lines[0], base.lines[2], base.lines[3]], 2);
count = 0;
update = recalculateCanonicalExecution({ document: deleted, previousCache: cache, firstAffectedIndex: 1, onExecuteLine: () => { count += 1; } });
assert.equal(update.convergedAtIndex, 2);
assert.equal(count, 2);
assertCachesEqual(update.cache, executeCanonicalDocument(deleted));
assert.deepEqual(deleted.lines.map((line) => line.lineId), ['L100', 'L102', 'L103']);

const inserted = doc([base.lines[0], motion(150, 'G1', 20, 20, -5, 600), base.lines[1], base.lines[2], base.lines[3]], 3);
update = recalculateCanonicalExecution({ document: inserted, previousCache: cache, firstAffectedIndex: 1 });
assertCachesEqual(update.cache, executeCanonicalDocument(inserted));

const feedChanged = doc([base.lines[0], motion(101, 'G1', 30, 20, -5, 700), base.lines[2], base.lines[3]], 4);
count = 0;
update = recalculateCanonicalExecution({ document: feedChanged, previousCache: cache, firstAffectedIndex: 1, onExecuteLine: () => { count += 1; } });
assert.equal(update.convergedAtIndex, 3);
assert.equal(count, 3);
assertCachesEqual(update.cache, executeCanonicalDocument(feedChanged));

const arcDoc = doc([motion(1, 'G0', 0, 0, 0, 0), motion(2, 'G2', 10, 0, 0, 100, { center: { x: 5, y: 0 } }), motion(3, 'G1', 20, 0, 0, 100)]);
const arcCache = executeCanonicalDocument(arcDoc);
const changedArc = doc([arcDoc.lines[0], motion(2, 'G2', 10, 0, 0, 100, { center: { x: 5, y: 1 } }), arcDoc.lines[2]], 1);
update = recalculateCanonicalExecution({ document: changedArc, previousCache: arcCache, firstAffectedIndex: 1 });
assertCachesEqual(update.cache, executeCanonicalDocument(changedArc));

const imported = importNcToCanonicalDocument(`G21 G90 G17 G91.1\nG0 X0 Y0 Z0\nG1 X10 Y0 F100\nG2 X20 Y0 I5 J0\n`);
assert.equal(imported.ok, true);
assert.equal(imported.toolpath.stats.g1, 1);
assert.equal(imported.toolpath.stats.g2, 1);
assert.equal(imported.executionCache.segmentById.get(imported.toolpath.segments[0].segmentId).sourceLineId, imported.canonicalDocument.lines[1].lineId);
assert.equal(imported.toolpath.lines[1].segmentIds[0], imported.toolpath.segments[0].segmentId);
assert.ok(imported.canonicalDocument.rawLineToCanonicalLineIds.get(3).includes(imported.canonicalDocument.lines[1].lineId));

const many = doc(Array.from({ length: 200 }, (_, i) => motion(i, 'G1', i + 1, 0, 0, 1)));
const manyCache = executeCanonicalDocument(many);
const manyChanged = doc(many.lines.map((line, i) => i === 100 ? motion(i, 'G1', i + 2, 0, 0, 1) : line), 1);
count = 0;
update = recalculateCanonicalExecution({ document: manyChanged, previousCache: manyCache, firstAffectedIndex: 100, onExecuteLine: () => { count += 1; } });
assert.equal(update.convergedAtIndex, 102);
assert.equal(count, 3);
assert.ok(count < 100, 'incremental convergence should avoid recalculating the full suffix');
assertCachesEqual(update.cache, executeCanonicalDocument(manyChanged));

console.log('OK: NC execution cache regression passed.');
