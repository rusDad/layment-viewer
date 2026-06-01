import assert from 'node:assert/strict';
import { parseNcToToolpath, parseWords, stripGcodeComments } from '../public/nc-parser.mjs';

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

console.log('OK: NC parser regression passed.');
