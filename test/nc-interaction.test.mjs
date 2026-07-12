import assert from 'node:assert/strict';
import {
  chooseClosestScreenSegment,
  createPointerInteractionState,
  distancePointToSegment2D,
  ndcToCssPixels
} from '../public/nc/NcPickingMath.js';
import { NcSelectionController } from '../public/nc/NcSelectionController.js';

assert.equal(distancePointToSegment2D({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 4);
assert.equal(distancePointToSegment2D({ x: 3, y: 6 }, { x: 3, y: 1 }, { x: 3, y: 11 }), 0);
assert.equal(Math.round(distancePointToSegment2D({ x: 5, y: 6 }, { x: 0, y: 0 }, { x: 10, y: 10 }) * 1000) / 1000, 0.707);

assert.deepEqual(ndcToCssPixels({ x: 0, y: 0 }, { width: 200, height: 100 }), { x: 100, y: 50 });

const nearest = chooseClosestScreenSegment({ x: 50, y: 50 }, [
  { logicalSegmentId: 1, start: { x: 0, y: 10 }, end: { x: 100, y: 10 } },
  { logicalSegmentId: 2, start: { x: 45, y: 48 }, end: { x: 55, y: 48 } }
], 6);
assert.equal(nearest.logicalSegmentId, 2, 'screen-space picking should choose the closest segment, not the first array element');
assert.equal(chooseClosestScreenSegment({ x: 50, y: 50 }, [
  { logicalSegmentId: 3, start: { x: 0, y: 20 }, end: { x: 100, y: 20 } }
], 6), null, 'segments outside the CSS-pixel threshold should not be picked');

const clickState = createPointerInteractionState(5);
clickState.begin({ pointerId: 1, clientX: 10, clientY: 10 });
assert.equal(clickState.move({ pointerId: 1, clientX: 13, clientY: 14 }), false, 'movement at the click threshold is still a click');
assert.equal(clickState.isClick({ pointerId: 1, clientX: 13, clientY: 14 }), true);

const dragState = createPointerInteractionState(5);
dragState.begin({ pointerId: 2, clientX: 10, clientY: 10 });
assert.equal(dragState.move({ pointerId: 2, clientX: 16, clientY: 10 }), true, 'movement above the threshold confirms a drag');
assert.equal(dragState.isClick({ pointerId: 2, clientX: 16, clientY: 10 }), false);

const orbitStartState = createPointerInteractionState(5);
orbitStartState.begin({ pointerId: 3, clientX: 20, clientY: 20 });
// OrbitControls may emit `start` here, but click classification deliberately ignores it.
assert.equal(orbitStartState.isClick({ pointerId: 3, clientX: 20, clientY: 20 }), true);

const selectionChanges = [];
const selectionController = new NcSelectionController({ onSelectionChange: (segmentId) => selectionChanges.push(segmentId) });
selectionController.selectSegment(10);
const cameraDragState = createPointerInteractionState(5);
cameraDragState.begin({ pointerId: 4, clientX: 0, clientY: 0 });
cameraDragState.move({ pointerId: 4, clientX: 8, clientY: 0 });
assert.equal(cameraDragState.isClick({ pointerId: 4, clientX: 8, clientY: 0 }), false);
assert.equal(selectionController.selectedSegmentId, 10, 'camera drag state must not clear canonical selection');

const sourceSelectionChanges = [];
const sourceSelectionController = new NcSelectionController({
  onSelectionChange: (segmentId) => sourceSelectionChanges.push(segmentId),
  getSourceLineByNumber: () => ({ number: 7, segmentIds: [42] })
});
sourceSelectionController.selectSourceLine(7);
sourceSelectionController.selectSegment(42);
sourceSelectionController.selectSegment(43);
assert.deepEqual(sourceSelectionChanges, [42, 42, 43], 'source-panel selection should not block a later picker callback for the same or another segment');

console.log('OK: NC interaction helpers passed.');
