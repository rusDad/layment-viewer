import * as THREE from 'three';

export const NC_PICKING_LINE_THRESHOLD_MM = 4;
export const NC_CLICK_MOVEMENT_THRESHOLD_PX = 5;

export class NcPickingController {
  constructor({ camera, renderer, controls, onHoverSegmentChange, onSelectSegmentChange }) {
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = NC_PICKING_LINE_THRESHOLD_MM;
    this.pointer = new THREE.Vector2();
    this.pickableLineBatches = [];
    this.latestPointerEvent = null;
    this.pendingFrame = null;
    this.enabled = true;
    this.hoveredSegmentId = null;
    this.selectedSegmentId = null;
    this.isOrbitDragging = false;
    this.pointerDown = null;
    this.onHoverSegmentChange = onHoverSegmentChange;
    this.onSelectSegmentChange = onSelectSegmentChange;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.flushPointerMove = this.flushPointerMove.bind(this);
    this.handleControlsStart = this.handleControlsStart.bind(this);
    this.handleControlsEnd = this.handleControlsEnd.bind(this);
  }

  init() {
    const canvas = this.renderer?.domElement;
    if (!canvas) return;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.controls?.addEventListener('start', this.handleControlsStart);
    this.controls?.addEventListener('end', this.handleControlsEnd);
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
    this.controls?.removeEventListener('start', this.handleControlsStart);
    this.controls?.removeEventListener('end', this.handleControlsEnd);
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
    this.setSelectedSegmentId(null);
    this.isOrbitDragging = false;
    this.latestPointerEvent = null;
    this.pointerDown = null;
  }

  pickFromPointerEvent(event) {
    if (!this.enabled || this.isOrbitDragging || this.pickableLineBatches.length === 0) {
      return null;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObjects(this.pickableLineBatches.map((batch) => batch.object), false);
    if (intersections.length === 0) {
      return null;
    }

    const intersection = intersections[0];
    const batch = this.pickableLineBatches.find((candidate) => candidate.object === intersection.object);
    if (!batch) {
      return null;
    }

    const renderSegmentIndex = Math.floor((intersection.index ?? 0) / 2);
    const ref = batch.renderSegmentRefs[renderSegmentIndex];
    if (!ref) {
      return null;
    }

    return {
      object: intersection.object,
      point: intersection.point,
      distance: intersection.distance,
      renderSegmentIndex,
      logicalSegmentId: ref.logicalSegmentId,
      segmentId: ref.segmentId,
      sourceLineNumber: ref.sourceLineNumber,
      polylinePartIndex: ref.polylinePartIndex,
      partIndex: ref.partIndex
    };
  }

  handlePointerMove(event) {
    this.latestPointerEvent = event;
    if (this.pendingFrame !== null) {
      return;
    }
    this.pendingFrame = requestAnimationFrame(this.flushPointerMove);
  }

  flushPointerMove() {
    this.pendingFrame = null;
    const hit = this.latestPointerEvent ? this.pickFromPointerEvent(this.latestPointerEvent) : null;
    this.setHoveredSegmentId(hit?.logicalSegmentId ?? null);
  }

  handlePointerLeave() {
    this.latestPointerEvent = null;
    this.setHoveredSegmentId(null);
  }

  handlePointerDown(event) {
    this.pointerDown = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY
    };
  }

  handlePointerUp(event) {
    if (!this.isClickFromPointerUp(event)) {
      this.pointerDown = null;
      return;
    }

    const hit = this.pickFromPointerEvent(event);
    this.setSelectedSegmentId(hit?.logicalSegmentId ?? null);
    this.pointerDown = null;
  }

  handlePointerCancel() {
    this.pointerDown = null;
  }

  isClickFromPointerUp(event) {
    if (!this.pointerDown || this.pointerDown.pointerId !== event.pointerId || this.isOrbitDragging) {
      return false;
    }

    const dx = event.clientX - this.pointerDown.clientX;
    const dy = event.clientY - this.pointerDown.clientY;
    return Math.hypot(dx, dy) <= NC_CLICK_MOVEMENT_THRESHOLD_PX;
  }

  handleControlsStart() {
    this.isOrbitDragging = true;
    this.pointerDown = null;
    this.latestPointerEvent = null;
    this.setHoveredSegmentId(null);
  }

  handleControlsEnd() {
    this.isOrbitDragging = false;
  }

  setHoveredSegmentId(segmentId) {
    const normalized = Number.isInteger(segmentId) ? segmentId : null;
    if (this.hoveredSegmentId === normalized) return;
    this.hoveredSegmentId = normalized;
    this.onHoverSegmentChange?.(normalized);
  }

  setSelectedSegmentId(segmentId) {
    const normalized = Number.isInteger(segmentId) ? segmentId : null;
    if (this.selectedSegmentId === normalized) return;
    this.selectedSegmentId = normalized;
    this.onSelectSegmentChange?.(normalized);
  }
}
