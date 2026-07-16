import assert from 'node:assert/strict';
import { importNcToCanonicalDocument } from '../public/nc/import/canonical-normalizer.mjs';
import { serializeCanonicalNcDocument } from '../public/nc/document/CanonicalNcDocument.mjs';
import { parseNcToToolpath } from '../public/nc/nc-parser.mjs';

function mustImport(text) {
  const result = importNcToCanonicalDocument(text, { filename: 'fixture.nc' });
  assert.equal(result.ok, true, result.diagnostics?.map((d) => d.message).join('\n'));
  return result;
}

const materialized = mustImport(`G21 G90
; setup
G1 X10 Y20 Z-5 F600
X30
X50
`);
assert.equal(materialized.rawDocument.filename, 'fixture.nc');
assert.equal(materialized.rawDocument.rawLines[0].text, 'G21 G90');
assert.equal(serializeCanonicalNcDocument(materialized.canonicalDocument), `; setup
G1 X10 Y20 Z-5 F600
G1 X30 Y20 Z-5 F600
G1 X50 Y20 Z-5 F600
`);
assert.equal(materialized.canonicalDocument.lines[1].sourceOrigin.rawLineNumbers[0], 3);
assert.deepEqual(materialized.canonicalDocument.rawLineToCanonicalLineIds.get(4), [materialized.canonicalDocument.lines[2].lineId]);
assert.ok(materialized.canonicalDocument.lines.every((line) => line.lineId && !Number.isInteger(line.lineId)));
assert.equal(materialized.toolpath.segments[1].sourceLineId, materialized.canonicalDocument.lines[2].lineId);

const rapidAndFeed = mustImport(`G0 X-0 Y0 Z0
G1 X1 F10
Y2
`);
assert.equal(rapidAndFeed.canonicalText, `G0 X0 Y0 Z0 F0
G1 X1 Y0 Z0 F10
G1 X1 Y2 Z0 F10
`);
assert.equal(rapidAndFeed.toolpath.stats.g0, 0, 'zero-length canonical G0 remains skipped by existing renderer');
assert.equal(rapidAndFeed.toolpath.stats.g1, 2);

const incrementalInches = mustImport(`G20 G91
G1 X1 Y1 Z0 F60
X1
`);
assert.equal(incrementalInches.canonicalText, `G1 X25.4 Y25.4 Z0 F60
G1 X50.8 Y25.4 Z0 F60
`);

const arcs = mustImport(`G21 G90 G17 G91.1
G0 X0 Y0 Z0
G2 X10 Y0 I5 J0 F100
G3 X0 Y0 I-5 J0
G2 X20 Y0 R-15
`);
assert.equal(arcs.canonicalDocument.lines[1].arc.center.x, 5);
assert.equal(arcs.canonicalDocument.lines[2].arc.direction, 'ccw');
assert.equal(arcs.canonicalText, `G0 X0 Y0 Z0 F0
G2 X10 Y0 Z0 I5 J0 F100
G3 X0 Y0 Z0 I-5 J0 F100
G2 X20 Y0 Z0 I10 J11.18034 F100
`);

const deterministicA = mustImport(`G1 X1.230000 Y-0 Z0 F5.5000
`).canonicalText;
const deterministicB = mustImport(`G1 X1.23 Y0 Z0 F5.5
`).canonicalText;
assert.equal(deterministicA, deterministicB);
assert.equal(deterministicA, 'G1 X1.23 Y0 Z0 F5.5\n');

for (const [text, code] of [
  ['G18\nG2 X1 Y1 I0 J1 F10\n', 'unsupported-plane'],
  ['G70\nG1 X1 F10\n', 'unsupported-unit-or-positioning'],
  ['G4 X99\n', 'unsupported-motion-affecting-command'],
  ['G2 X1 Y1 F10\n', 'invalid-arc']
]) {
  const failed = importNcToCanonicalDocument(text);
  assert.equal(failed.ok, false);
  assert.equal(failed.diagnostics[0].code, code);
}

const badNumeric = importNcToCanonicalDocument('G1 XInfinity F10\n');
assert.equal(badNumeric.ok, false);
assert.equal(badNumeric.diagnostics[0].code, 'non-finite-coordinate');

const rawEquivalent = `G21 G90 G17 G91.1
G0 X0 Y0 Z0
G1 X10 Y0 F100
Y10
G2 X20 Y10 I5 J0
`;
const rawToolpath = parseNcToToolpath(rawEquivalent);
const canonical = mustImport(rawEquivalent);
assert.equal(canonical.toolpath.stats.g1, rawToolpath.stats.g1);
assert.equal(canonical.toolpath.stats.g2, rawToolpath.stats.g2);
assert.deepEqual(canonical.toolpath.bbox, rawToolpath.bbox);
for (let i = 0; i < rawToolpath.segments.length; i += 1) {
  assert.equal(canonical.toolpath.segments[i].motion, rawToolpath.segments[i].motion);
  assert.deepEqual(canonical.toolpath.segments[i].start, rawToolpath.segments[i].start);
  assert.deepEqual(canonical.toolpath.segments[i].end, rawToolpath.segments[i].end);
  assert.equal(canonical.toolpath.segments[i].feed, rawToolpath.segments[i].feed ?? 0);
}


const preserved = mustImport(`%
; standalone
(parenthesized)
N10 T2 M6 S12000 G1 X1 Y2 Z-3 F400 ; inline motion
M3 S9000
T4
G40
G49
G54
G80

G20 G91 (inch incremental setup)
G1 X1 Y0 Z0 F10
`);
const preservedText = serializeCanonicalNcDocument(preserved.canonicalDocument);
assert.match(preservedText, /^%\n; standalone\n\(parenthesized\)/, 'program delimiters, blank/comment blocks survive');
assert.match(preservedText, /N10 T2 M6 S12000 G1 X1 Y2 Z-3 F400 ; inline motion/, 'mixed motion block preserves N/T/M/S and inline comments');
assert.match(preservedText, /M3 S9000\nT4\nG40\nG49\nG54\nG80/, 'standalone machine and safety commands survive');
assert.match(preservedText, /\(inch incremental setup\)\nG1 X26\.4 Y2 Z-3 F10/, 'consumed modal-only comments survive without contradictory G20/G91 output');
assert.equal(/G20|G91/.test(preservedText), false, 'consumed unit/distance mode commands are not serialized into normalized output');

const apostropheComments = mustImport(`G1 X1 Y2 Z-3 F400
' CONTOUR id=634135-ph3-150 angle=180.0
' PRIMITIVES END
' PRIMITIVE #13 type=rect x=406.0 y=11.0 width=15.0 height=31.0
X2
`);
assert.equal(apostropheComments.canonicalText, `G1 X1 Y2 Z-3 F400
' CONTOUR id=634135-ph3-150 angle=180.0
' PRIMITIVES END
' PRIMITIVE #13 type=rect x=406.0 y=11.0 width=15.0 height=31.0
G1 X2 Y2 Z-3 F400
`);
assert.equal(apostropheComments.toolpath.segments.length, 2, 'apostrophe comments must not materialize fake X/Y motion');

const editedPreserved = mustImport('N20 T7 M3 S5000 G1 X1 Y2 Z3 F4 (keep me) ; and me\n');
const line = editedPreserved.canonicalDocument.lines[0];
const editedDoc = Object.freeze({ ...editedPreserved.canonicalDocument, lines: Object.freeze([{ ...line, end: { ...line.end, x: 9 }, feed: 44 }]) });
assert.equal(serializeCanonicalNcDocument(editedDoc), 'N20 T7 M3 S5000 G1 X9 Y2 Z3 F44 (keep me) ; and me\n');

const unsupportedGeometry = importNcToCanonicalDocument('G5 X1 Y1\n');
assert.equal(unsupportedGeometry.ok, false);
assert.equal(unsupportedGeometry.diagnostics[0].code, 'unsupported-motion-affecting-command');

const roundTrip = mustImport(preservedText);
assert.deepEqual(roundTrip.toolpath.segments.map((s) => ({ motion: s.motion, start: s.start, end: s.end, feed: s.feed })), preserved.toolpath.segments.map((s) => ({ motion: s.motion, start: s.start, end: s.end, feed: s.feed })));

console.log('OK: NC canonical normalizer regression passed.');
