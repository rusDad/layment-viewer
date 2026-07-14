export class NcSelectionController {
  constructor({ onHoverChange, onSelectionChange, getDocumentLineIds, getLineIdBySegmentId } = {}) {
    this.hoveredSegmentId = null;
    this.selection = emptySelection();
    this.onHoverChange = onHoverChange;
    this.onSelectionChange = onSelectionChange;
    this.onSourceLineChange = arguments[0]?.onSourceLineChange;
    this.getSourceLineByNumber = arguments[0]?.getSourceLineByNumber;
    this.selectedSegmentId = null;
    this.selectedSourceLineNumber = null;
    this.getDocumentLineIds = getDocumentLineIds ?? (() => []);
    this.getLineIdBySegmentId = getLineIdBySegmentId ?? (() => null);
  }

  getSelection() { return cloneSelection(this.selection); }
  setHoveredSegmentId(segmentId) { const n = normalizeSegmentId(segmentId); if (this.hoveredSegmentId === n) return; this.hoveredSegmentId = n; this.onHoverChange?.(n); }
  clearHover() { this.setHoveredSegmentId(null); }

  selectSegment(segmentId, modifiers = {}) {
    const lineId = this.getLineIdBySegmentId?.(segmentId) ?? null;
    if (!lineId && this.getDocumentLineIds().length === 0) {
      this.selectedSegmentId = normalizeSegmentId(segmentId);
      this.selectedSourceLineNumber = null;
      this.onSelectionChange?.(this.selectedSegmentId);
      return;
    }
    if (!lineId) return this.clearSelection();
    return this.selectLineId(lineId, modifiers, 'rendered-segment');
  }
  setSelectedSegmentId(segmentId, modifiers = {}) { return this.selectSegment(segmentId, modifiers); }
  selectSourceLine(lineIdOrNumber, modifiers = {}) {
    if (this.getDocumentLineIds().length === 0 && Number.isInteger(lineIdOrNumber)) {
      const line = this.getSourceLineByNumber?.(lineIdOrNumber) ?? null;
      const segmentId = line?.segmentIds?.[0] ?? null;
      this.selectedSourceLineNumber = lineIdOrNumber;
      this.selectedSegmentId = segmentId ?? null;
      this.onSelectionChange?.(this.selectedSegmentId, { sourceLineNumber: lineIdOrNumber, sourceLine: line });
      this.onSourceLineChange?.(lineIdOrNumber, line, this.selectedSegmentId);
      return;
    }
    return this.selectLineId(String(lineIdOrNumber || ''), modifiers, 'source');
  }

  selectLineId(lineId, modifiers = {}, origin = 'source') {
    const order = this.getDocumentLineIds();
    if (!order.includes(lineId)) return this.clearSelection();
    const ctrl = Boolean(modifiers.ctrlKey || modifiers.metaKey);
    const shift = Boolean(modifiers.shiftKey);
    let next;
    if (shift) next = rangeSelection({ current: this.selection, clickedLineId: lineId, order, union: ctrl, origin });
    else if (ctrl) next = toggleSelection({ current: this.selection, clickedLineId: lineId, order, origin });
    else next = orderedSelection([lineId], order, lineId, lineId, origin);
    this.setSelection(next);
  }

  selectAll(origin = 'command') { const order = this.getDocumentLineIds(); this.setSelection(orderedSelection(order, order, order[0] ?? null, order.at(-1) ?? null, origin)); }
  reconcileSelection(origin = 'command', fallbackLineId = null) {
    const order = this.getDocumentLineIds();
    let ids = this.selection.orderedLineIds.filter((id) => order.includes(id));
    if (ids.length === 0 && fallbackLineId && order.includes(fallbackLineId)) ids = [fallbackLineId];
    const focus = ids.includes(this.selection.focusLineId) ? this.selection.focusLineId : ids.at(-1) ?? null;
    const anchor = ids.includes(this.selection.anchorLineId) ? this.selection.anchorLineId : ids[0] ?? null;
    this.setSelection(orderedSelection(ids, order, anchor, focus, origin));
  }
  setSelection(selection) {
    const order = this.getDocumentLineIds();
    const next = reconcile(selection, order);
    if (selectionEqual(this.selection, next)) return;
    this.selection = next;
    this.selectedSegmentId = null;
    this.selectedSourceLineNumber = null;
    this.onSelectionChange?.(cloneSelection(next));
  }
  clearSelection() {
    if (this.getDocumentLineIds().length === 0) {
      this.selectedSegmentId = null; this.selectedSourceLineNumber = null; this.onSelectionChange?.(null); this.onSourceLineChange?.(null, null, null); return;
    }
    this.setSelection(emptySelection());
  }
  clearAll() { this.clearHover(); this.clearSelection(); }
}

export function emptySelection() { return Object.freeze({ orderedLineIds: Object.freeze([]), anchorLineId: null, focusLineId: null, origin: null }); }
export function cloneSelection(s) { return Object.freeze({ orderedLineIds: Object.freeze([...(s?.orderedLineIds ?? [])]), anchorLineId: s?.anchorLineId ?? null, focusLineId: s?.focusLineId ?? null, origin: s?.origin ?? null }); }
export function orderedSelection(ids, order, anchorLineId = null, focusLineId = null, origin = null) { const set = new Set(ids); const ordered = order.filter((id) => set.has(id)); return Object.freeze({ orderedLineIds: Object.freeze(ordered), anchorLineId: ordered.includes(anchorLineId) ? anchorLineId : ordered[0] ?? null, focusLineId: ordered.includes(focusLineId) ? focusLineId : ordered.at(-1) ?? null, origin }); }
export function reconcile(selection, order) { return orderedSelection(selection?.orderedLineIds ?? [], order, selection?.anchorLineId ?? null, selection?.focusLineId ?? null, selection?.origin ?? null); }
export function toggleSelection({ current, clickedLineId, order, origin }) { const selected = new Set(current?.orderedLineIds ?? []); if (selected.has(clickedLineId)) selected.delete(clickedLineId); else selected.add(clickedLineId); const ids = order.filter((id) => selected.has(id)); const focus = clickedLineId; let anchor = current?.anchorLineId ?? null; if (!ids.includes(anchor)) anchor = ids.includes(focus) ? focus : ids[0] ?? null; return orderedSelection(ids, order, anchor, ids.includes(focus) ? focus : ids.at(-1) ?? null, origin); }
export function rangeSelection({ current, clickedLineId, order, union = false, origin }) { const anchor = current?.anchorLineId && order.includes(current.anchorLineId) ? current.anchorLineId : clickedLineId; const a = order.indexOf(anchor), b = order.indexOf(clickedLineId); const range = a <= b ? order.slice(a, b + 1) : order.slice(b, a + 1); const ids = union ? [...(current?.orderedLineIds ?? []), ...range] : range; return orderedSelection(ids, order, anchor, clickedLineId, origin); }
function selectionEqual(a,b){ return a.anchorLineId===b.anchorLineId&&a.focusLineId===b.focusLineId&&a.origin===b.origin&&a.orderedLineIds.length===b.orderedLineIds.length&&a.orderedLineIds.every((id,i)=>id===b.orderedLineIds[i]); }
function normalizeSegmentId(segmentId) { return Number.isInteger(segmentId) || (typeof segmentId === 'string' && segmentId.length > 0) ? segmentId : null; }
