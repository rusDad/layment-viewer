import * as THREE from 'three';
import {
  NC_SCREEN_PICK_RADIUS_PX,
  chooseClosestScreenSegment,
  createPointerInteractionState,
  isSegmentCompletelyOutsideClip,
  isValidProjectedPoint,
  ndcToCssPixels
} from './NcPickingMath.js';

export class NcPickingController {
  constructor({ camera, renderer, controls, onHoverSegmentChange, onSelectSegmentChange }) {
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.tempStart = new THREE.Vector3();
    this.tempEnd = new THREE.Vector3();
    this.pickableLineBatches = [];
    this.latestPointerEvent = null;
    this.pendingFrame = null;
    this.enabled = true;
    this.hoveredSegmentId = null;
    this.pointerState = createPointerInteractionState();
    this.onHoverSegmentChange = onHoverSegmentChange;
    this.onSelectSegmentChange = onSelectSegmentChange;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.flushPointerMove = this.flushPointerMove.bind(this);
    this.handleControlsChange = this.handleControlsChange.bind(this);
  }

  init() {
    const canvas = this.renderer?.domElement;
    if (!canvas) return;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.controls?.addEventListener('change', this.handleControlsChange);
  }

  dispose() {
    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointermove', this.handlePointerMove);
      canvas.removeEventListener('pointerleave', this.handlePointerLeave);
      canvas.removeEventListener('pointerdown', this.handlePointerDown);
      canvas.removeEventListener('pointerup', this.handlePointerUp);
      canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    }
    this.controls?.removeEventListener('change', this.handleControlsChange);
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    this.clearPickableLineBatches();
  }

  setPickableLineBatches(batches) {
    this.pickableLineBatches = batches.filter((batch) => batch?.object?.isLineSegments && Array.isArray(batch.renderSegmentRefs));
  }

  clearPickableLineBatches() {
    this.pickableLineBatches = [];
    this.setHoveredSegmentId(null);
    this.latestPointerEvent = null;
    this.pointerState.clear();
  }

  pickFromPointerEvent(event) {
    if (!this.enabled || this.pickableLineBatches.length === 0) {
      return null;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const candidates = [];

    this.pickableLineBatches.forEach((batch) => {
      const position = batch.object.geometry?.getAttribute?.('position');
      if (!position) return;
      batch.object.updateWorldMatrix?.(true, false);

      for (let renderSegmentIndex = 0; renderSegmentIndex < batch.renderSegmentRefs.length; renderSegmentIndex += 1) {
        const ref = batch.renderSegmentRefs[renderSegmentIndex];
        if (!ref) continue;

        this.tempStart.fromBufferAttribute(position, renderSegmentIndex * 2).applyMatrix4(batch.object.matrixWorld).project(this.camera);
        this.tempEnd.fromBufferAttribute(position, renderSegmentIndex * 2 + 1).applyMatrix4(batch.object.matrixWorld).project(this.camera);

        if (!isValidProjectedPoint(this.tempStart)
          || !isValidProjectedPoint(this.tempEnd)
          || isSegmentCompletelyOutsideClip(this.tempStart, this.tempEnd)) {
          continue;
        }

        candidates.push({
          object: batch.object,
          renderSegmentIndex,
          logicalSegmentId: ref.logicalSegmentId,
          segmentId: ref.segmentId,
          sourceLineNumber: ref.sourceLineNumber,
          polylinePartIndex: ref.polylinePartIndex,
          partIndex: ref.partIndex,
          start: ndcToCssPixels(this.tempStart, rect),
          end: ndcToCssPixels(this.tempEnd, rect)
        });
      }
    });

    return chooseClosestScreenSegment(pointer, candidates, NC_SCREEN_PICK_RADIUS_PX);
  }

  handlePointerMove(event) {
    this.latestPointerEvent = event;
    if (this.pointerState.move(event)) {
      this.setHoveredSegmentId(null);
    }
    if (this.pendingFrame !== null) {
      return;
    }
    this.pendingFrame = requestAnimationFrame(this.flushPointerMove);
  }

  flushPointerMove() {
    this.pendingFrame = null;
    if (this.pointerState.didDrag) {
      this.setHoveredSegmentId(null);
      return;
    }
    const hit = this.latestPointerEvent ? this.pickFromPointerEvent(this.latestPointerEvent) : null;
    this.setHoveredSegmentId(hit?.logicalSegmentId ?? null);
  }

  handlePointerLeave() {
    this.latestPointerEvent = null;
    this.setHoveredSegmentId(null);
  }

  handlePointerDown(event) {
    this.pointerState.begin(event);
  }

  handlePointerUp(event) {
    if (!this.pointerState.isClick(event)) {
      this.pointerState.clear();
      return;
    }

    const hit = this.pickFromPointerEvent(event);
    this.onSelectSegmentChange?.(isValidSegmentId(hit?.logicalSegmentId) ? hit.logicalSegmentId : null, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey });
    this.pointerState.clear();
  }

  handlePointerCancel() {
    this.pointerState.clear();
  }

  handleControlsChange() {
    if (!this.latestPointerEvent || this.pendingFrame !== null) {
      return;
    }
    this.pendingFrame = requestAnimationFrame(this.flushPointerMove);
  }


  setHoveredSegmentId(segmentId) {
    const normalized = isValidSegmentId(segmentId) ? segmentId : null;
    if (this.hoveredSegmentId === normalized) return;
    this.hoveredSegmentId = normalized;
    this.onHoverSegmentChange?.(normalized);
  }
}

function isValidSegmentId(segmentId) { return Number.isInteger(segmentId) || (typeof segmentId === 'string' && segmentId.length > 0); }
