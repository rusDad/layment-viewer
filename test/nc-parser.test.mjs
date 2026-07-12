import assert from 'node:assert/strict';
import { parseNcToToolpath, parseWords, stripGcodeComments } from '../public/nc/nc-parser.mjs';

assert.equal(stripGcodeComments('G1 X1 (ignore X99) Y2 ; ignore Z9'), 'G1 X1  Y2');
assert.deepEqual(parseWords('g01 x10.5 y-2 z.25').map((word) => [word.letter, word.value]), [
  ['G', 1],
  ['X', 10.5],
  ['Y', -2],
  ['Z', 0.25]
]);

const linear = parseNcToToolpath(`
G21 G90
G0 X0 Y0 Z5
G1 X10 Y0
Y10
G91
G1 X5
G20
G1 X1
`);

assert.equal(linear.stats.g0, 1);
assert.equal(linear.stats.g1, 4);
assert.equal(linear.stats.g2, 0);
assert.equal(linear.stats.g3, 0);
assert.equal(linear.segments[2].points[1].y, 10, 'modal G1 line without G code should move Y');
assert.equal(linear.segments[3].points[1].x, 15, 'G91 incremental X should add in mm');
assert.equal(linear.segments[4].points[1].x, 40.4, 'G20 should convert incremental inches to mm');
assert.equal(linear.lines[0].number, 1, 'source line numbers should be one-based');
assert.equal(linear.lines[0].index, 0, 'source line indexes should be zero-based');
assert.deepEqual(linear.lines[0].segmentIds, [], 'blank lines should remain in source document without segments');
assert.equal(linear.segments[0].id, 0);
assert.equal(linear.segments[0].sourceLineIndex, 2);
assert.equal(linear.segments[0].sourceLineNumber, 3);
assert.equal(linear.segments[0].sourceText, 'G0 X0 Y0 Z5');
assert.deepEqual(linear.lines[2].segmentIds, [0], 'G0 source line should link to its segment id');
assert.equal(linear.segments[1].motion, 'G1');
assert.deepEqual(linear.lines[3].segmentIds, [1], 'G1 source line should link to its segment id');
assert.equal(linear.segments[2].motion, 'G1');
assert.equal(linear.segments[2].sourceText, 'Y10');
assert.deepEqual(linear.lines[4].segmentIds, [2], 'modal motion line without an explicit G code should link to its segment id');
assert.deepEqual(linear.segments[2].start, { x: 10, y: 0, z: 5 });
assert.deepEqual(linear.segments[2].end, { x: 10, y: 10, z: 5 });

const arcs = parseNcToToolpath(`
G21 G90 G17 G91.1
G0 X0 Y0 Z0
G2 X10 Y0 I5 J0
G3 X0 Y0 I-5 J0
G2 X20 Y0 R15
`);

assert.equal(arcs.stats.g2, 2);
assert.equal(arcs.stats.g3, 1);
assert.equal(arcs.stats.skipped, 1, 'only zero-length G0 is skipped');
assert.equal(arcs.warnings.length, 0);
const radiusArc = arcs.segments.at(-1);
assert.equal(radiusArc.motion, 'G2');
assert.ok(radiusArc.points.some((point) => point.y > 1), 'positive R G2 arc should render clockwise minor arc');
assert.ok(arcs.segments.find((segment) => segment.motion === 'G2').points.length >= 13);
const centerArc = arcs.segments.find((segment) => segment.motion === 'G2');
assert.equal(centerArc.sourceLineNumber, 4);
assert.deepEqual(arcs.lines[3].segmentIds, [centerArc.id], 'one G2 command should map to one logical segment');
assert.ok(centerArc.points.length > 2, 'arc should be approximated by multiple render polyline points');
assert.equal(arcs.lines[3].segmentIds.length, 1, 'one approximated arc should still link one source line to one logical segment');

const majorRadiusArc = parseNcToToolpath(`
G21 G90 G17
G0 X0 Y0
G3 X10 Y0 R-10
`);
assert.equal(majorRadiusArc.stats.g3, 1);
assert.ok(majorRadiusArc.segments[0].points.some((point) => point.y < -15), 'negative R G3 arc should render the major arc');

const absoluteCenters = parseNcToToolpath(`
G21 G90 G90.1
G0 X10 Y0
G3 X0 Y10 I0 J0
`);
assert.equal(absoluteCenters.stats.g3, 1);
assert.equal(absoluteCenters.modal.arcCenterMode, 'absolute');

const modalTechnology = parseNcToToolpath(`
G21 G90
T3
M3 S12000
G1 X10 F900
Y20
F450
G1 X0 S8000
`);

assert.equal(modalTechnology.stats.g1, 3);
assert.deepEqual(modalTechnology.lines[2].segmentIds, [], 'tool-only service line should not create a segment');
assert.deepEqual(modalTechnology.lines[3].segmentIds, [], 'spindle-only service line should not create a segment');
assert.equal(modalTechnology.segments[0].feed, 900);
assert.equal(modalTechnology.segments[0].tool, 3);
assert.equal(modalTechnology.segments[0].spindle, 12000);
assert.equal(modalTechnology.segments[1].feed, 900, 'modal feed should carry over to modal motion');
assert.equal(modalTechnology.segments[1].tool, 3, 'modal tool should carry over to modal motion');
assert.equal(modalTechnology.segments[1].spindle, 12000, 'modal spindle should carry over to modal motion');
assert.deepEqual(modalTechnology.lines[6].segmentIds, [], 'feed-only modal update should not create a segment');
assert.equal(modalTechnology.segments[2].feed, 450, 'feed snapshot should reflect latest modal F value');
assert.equal(modalTechnology.segments[2].spindle, 8000, 'spindle snapshot should include same-line modal S value');

const nonMotionLines = parseNcToToolpath(`

(setup comment)
; semicolon comment
G21 G90
M5
G4 P1
G1 X1
G4 X99
`);

assert.equal(nonMotionLines.stats.g1, 1);
assert.deepEqual(nonMotionLines.lines[0].segmentIds, [], 'empty first line should remain without segment ids');
assert.deepEqual(nonMotionLines.lines[1].segmentIds, [], 'empty line should remain without segment ids');
assert.deepEqual(nonMotionLines.lines[2].segmentIds, [], 'parenthesized comment should remain without segment ids');
assert.deepEqual(nonMotionLines.lines[3].segmentIds, [], 'semicolon comment should remain without segment ids');
assert.deepEqual(nonMotionLines.lines[5].segmentIds, [], 'M-code service line should remain without segment ids');
assert.deepEqual(nonMotionLines.lines[6].segmentIds, [], 'unsupported G-code line should remain without segment ids');
assert.deepEqual(nonMotionLines.lines[7].segmentIds, [0], 'supported motion line should link to segment id');
assert.deepEqual(nonMotionLines.lines[8].segmentIds, [], 'unsupported G-code with coordinates should not use prior modal motion');

console.log('OK: NC parser regression passed.');

const { buildNcMotionRenderBatches } = await import('../public/nc/NcRenderIndex.js');
const renderIndexedToolpath = parseNcToToolpath(`
G21 G90 G17 G91.1
G0 X0 Y0 Z0
G1 X10 Y0
G2 X20 Y0 I5 J0
`);
const renderBatches = buildNcMotionRenderBatches(renderIndexedToolpath, { width: 100, height: 100, thickness: 10 }, (point, dimensions) => ({
  x: dimensions.width - point.x,
  y: point.z,
  z: point.y
}));
assert.equal(renderBatches.G1.renderSegmentRefs.length, 1, 'one G1 polyline segment should have one render ref');
assert.equal(renderBatches.G1.renderSegmentRefs[0].logicalSegmentId, renderIndexedToolpath.segments.find((segment) => segment.motion === 'G1').id);
assert.equal(renderBatches.G1.renderSegmentRefs[0].sourceLineNumber, 4);
assert.equal(renderBatches.G1.renderSegmentRefs[0].polylinePartIndex, 0);
const indexedArc = renderIndexedToolpath.segments.find((segment) => segment.motion === 'G2');
assert.equal(renderBatches.G2.renderSegmentRefs.length, indexedArc.points.length - 1, 'one logical arc should map each rendered chord to the same segment id');
assert.ok(renderBatches.G2.renderSegmentRefs.every((ref, index) => ref.logicalSegmentId === indexedArc.id && ref.polylinePartIndex === index));
assert.equal(renderBatches.G2.positions.length, renderBatches.G2.renderSegmentRefs.length * 6, 'each render ref should correspond to one vertex pair');

const { NcSelectionController } = await import('../public/nc/NcSelectionController.js');
const hoverChanges = [];
const selectionChanges = [];
const selectionController = new NcSelectionController({
  onHoverChange: (segmentId) => hoverChanges.push(segmentId),
  onSelectionChange: (segmentId) => selectionChanges.push(segmentId)
});
selectionController.setSelectedSegmentId(7);
selectionController.setHoveredSegmentId(12);
assert.equal(selectionController.selectedSegmentId, 7, 'hover should not clear an existing selected segment');
selectionController.clearHover();
assert.equal(selectionController.selectedSegmentId, 7, 'clearing hover should not clear selection');
assert.deepEqual(hoverChanges, [12, null]);
assert.deepEqual(selectionChanges, [7]);
