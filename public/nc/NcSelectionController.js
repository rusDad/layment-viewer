export class NcSelectionController {
  constructor({ onHoverChange, onSelectionChange, onSourceLineChange, getSourceLineByNumber } = {}) {
    this.hoveredSegmentId = null;
    this.selectedSegmentId = null;
    this.selectedSourceLineNumber = null;
    this.onHoverChange = onHoverChange;
    this.onSelectionChange = onSelectionChange;
    this.onSourceLineChange = onSourceLineChange;
    this.getSourceLineByNumber = getSourceLineByNumber;
  }

  setHoveredSegmentId(segmentId) {
    const normalized = normalizeSegmentId(segmentId);
    if (this.hoveredSegmentId === normalized) return;
    this.hoveredSegmentId = normalized;
    this.onHoverChange?.(normalized);
  }

  setSelectedSegmentId(segmentId) {
    this.selectSegment(segmentId);
  }

  selectSegment(segmentId) {
    const normalized = normalizeSegmentId(segmentId);
    if (this.selectedSegmentId === normalized && this.selectedSourceLineNumber === null) return;
    this.selectedSegmentId = normalized;
    this.selectedSourceLineNumber = null;
    this.onSelectionChange?.(normalized);
  }

  selectSourceLine(lineNumber) {
    const normalizedLineNumber = normalizeLineNumber(lineNumber);
    const line = normalizedLineNumber === null ? null : this.getSourceLineByNumber?.(normalizedLineNumber) ?? null;
    const segmentIds = Array.isArray(line?.segmentIds) ? line.segmentIds.filter(Number.isInteger) : [];
    const segmentId = segmentIds[0] ?? null;

    if (this.selectedSourceLineNumber === normalizedLineNumber && this.selectedSegmentId === segmentId) return;

    this.selectedSourceLineNumber = normalizedLineNumber;
    this.selectedSegmentId = segmentId;
    this.onSelectionChange?.(segmentId, { sourceLineNumber: normalizedLineNumber, sourceLine: line });
    this.onSourceLineChange?.(normalizedLineNumber, line, segmentId);
  }

  clearHover() {
    this.setHoveredSegmentId(null);
  }

  clearSelection() {
    if (this.selectedSegmentId === null && this.selectedSourceLineNumber === null) return;
    this.selectedSegmentId = null;
    this.selectedSourceLineNumber = null;
    this.onSelectionChange?.(null);
    this.onSourceLineChange?.(null, null, null);
  }

  clearAll() {
    this.clearHover();
    this.clearSelection();
  }
}

function normalizeSegmentId(segmentId) {
  return Number.isInteger(segmentId) ? segmentId : null;
}

function normalizeLineNumber(lineNumber) {
  return Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : null;
}
