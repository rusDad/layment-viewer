export class NcSelectionController {
  constructor({ onHoverChange, onSelectionChange } = {}) {
    this.hoveredSegmentId = null;
    this.selectedSegmentId = null;
    this.onHoverChange = onHoverChange;
    this.onSelectionChange = onSelectionChange;
  }

  setHoveredSegmentId(segmentId) {
    const normalized = normalizeSegmentId(segmentId);
    if (this.hoveredSegmentId === normalized) return;
    this.hoveredSegmentId = normalized;
    this.onHoverChange?.(normalized);
  }

  setSelectedSegmentId(segmentId) {
    const normalized = normalizeSegmentId(segmentId);
    if (this.selectedSegmentId === normalized) return;
    this.selectedSegmentId = normalized;
    this.onSelectionChange?.(normalized);
  }

  clearHover() {
    this.setHoveredSegmentId(null);
  }

  clearSelection() {
    this.setSelectedSegmentId(null);
  }

  clearAll() {
    this.clearHover();
    this.clearSelection();
  }
}

function normalizeSegmentId(segmentId) {
  return Number.isInteger(segmentId) ? segmentId : null;
}
