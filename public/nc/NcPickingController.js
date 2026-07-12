import * as THREE from 'three';

export const NC_PICKING_LINE_THRESHOLD_MM = 4;

export class NcPickingController {
  constructor({ camera, renderer }) {
    this.camera = camera;
    this.renderer = renderer;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = NC_PICKING_LINE_THRESHOLD_MM;
    this.pointer = new THREE.Vector2();
    this.pickableLineBatches = [];
    this.latestPointerEvent = null;
    this.pendingFrame = null;
    this.enabled = true;
    this.hoveredSegmentId = null;
    this.selectedSegmentId = null;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.flushPointerMove = this.flushPointerMove.bind(this);
  }

  init() {
    const canvas = this.renderer?.domElement;
    if (!canvas) return;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  dispose() {
    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointermove', this.handlePointerMove);
      canvas.removeEventListener('pointerleave', this.handlePointerLeave);
      canvas.removeEventListener('pointerdown', this.handlePointerDown);
    }
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
    this.hoveredSegmentId = null;
    this.selectedSegmentId = null;
    this.latestPointerEvent = null;
  }

  pickFromPointerEvent(event) {
    if (!this.enabled || this.pickableLineBatches.length === 0) {
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
    this.hoveredSegmentId = hit?.logicalSegmentId ?? null;
  }

  handlePointerLeave() {
    this.latestPointerEvent = null;
    this.hoveredSegmentId = null;
  }

  handlePointerDown(event) {
    const hit = this.pickFromPointerEvent(event);
    this.selectedSegmentId = hit?.logicalSegmentId ?? null;
  }
}
