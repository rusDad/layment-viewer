import { NC_MAX_FILE_BYTES, parseNcToToolpath } from './nc-parser.mjs';
import { createNcScene } from './NcScene.js';
import { NcPickingController } from './NcPickingController.js';
import { NcSelectionController } from './NcSelectionController.js';
import { createNcUi, formatNcStatus } from './NcUi.js';


export class NcPreview {
  constructor(ctx) {
    this.ctx = ctx;
    this.preview = createNcPreview(ctx);
    this.buildNcPreviewFromUi = this.preview.buildNcPreviewFromUi;
    this.updateNcVisualSettings = this.preview.updateNcVisualSettings;
    this.updateNcOpacityLabel = this.preview.updateNcOpacityLabel;
    this.clearNcPreview = this.preview.clearNcPreview;
  }

  init() {
    this.ctx.ncPreviewButton?.addEventListener('click', this.buildNcPreviewFromUi);
    this.ctx.ncOpacityInput?.addEventListener('input', this.updateNcVisualSettings);
    Object.values(this.ctx.ncColorInputs).forEach((input) => input?.addEventListener('input', this.updateNcVisualSettings));
    this.preview.init();
    this.updateNcOpacityLabel();
  }

  dispose() {
    this.ctx.ncPreviewButton?.removeEventListener('click', this.buildNcPreviewFromUi);
    this.ctx.ncOpacityInput?.removeEventListener('input', this.updateNcVisualSettings);
    Object.values(this.ctx.ncColorInputs).forEach((input) => input?.removeEventListener('input', this.updateNcVisualSettings));
    this.preview.dispose();
  }
}

export function createNcPreview(ctx) {
  const { viewerMode, isPreviewMode, ncFileInput } = ctx;
  const ncScene = createNcScene(ctx);
  const ncUi = createNcUi(ctx);
  let activeToolpath = null;
  const selection = new NcSelectionController({
    onHoverChange: (segmentId) => {
      ncScene.setHoverHighlight(segmentId);
      ncUi.showHoverInspector(getActiveSegment(segmentId));
    },
    onSelectionChange: (segmentId) => {
      ncScene.setSelectionHighlight(segmentId);
      ncUi.showSourceSelection(getActiveSegment(segmentId));
    }
  });
  const ncPicking = new NcPickingController({
    ...ctx,
    onHoverSegmentChange: (segmentId) => selection.setHoveredSegmentId(segmentId),
    onSelectSegmentChange: (segmentId) => selection.setSelectedSegmentId(segmentId)
  });

  async function buildNcPreviewFromUi() {
    if (isPreviewMode(viewerMode)) {
      return;
    }

    const file = ncFileInput?.files?.[0];
    if (!file) {
      ncUi.setNcStatus('Выберите .nc файл.', true);
      return;
    }

    if (file.size > NC_MAX_FILE_BYTES) {
      ncUi.setNcStatus(`Файл слишком большой: максимум ${Math.round(NC_MAX_FILE_BYTES / 1024 / 1024)} MB.`, true);
      return;
    }

    const dimensions = ncUi.getNcDimensionsFromUi();
    if (!dimensions) {
      ncUi.setNcStatus('Некорректные габариты ложемента: width/height/thickness должны быть положительными числами.', true);
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch (err) {
      ncUi.setNcStatus(`Не удалось прочитать .nc файл: ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }

    if (!text.trim()) {
      ncUi.setNcStatus('NC файл пустой.', true);
      return;
    }

    let toolpath;
    try {
      toolpath = parseNcToToolpath(text);
    } catch (err) {
      ncUi.setNcStatus(`Не удалось распарсить NC: ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }

    if (toolpath.segments.length === 0) {
      ncUi.setNcStatus(formatNcStatus(toolpath, 'Движения G0/G1/G2/G3 не найдены.'), true);
      return;
    }

    ncPicking.clearPickableLineBatches();
    selection.clearAll();
    activeToolpath = toolpath;
    ncUi.setSourceDocument(toolpath.lines);
    const previewResult = ncScene.buildNcPreview(toolpath, dimensions, ncUi.getNcVisualSettings());
    ncPicking.setPickableLineBatches(previewResult.motionLineBatches);
    ncUi.setNcStatus(formatNcStatus(toolpath));
  }

  function getActiveSegment(segmentId) {
    if (!Number.isInteger(segmentId) || !activeToolpath) {
      return null;
    }
    return activeToolpath.segments.find((segment) => segment.id === segmentId) ?? null;
  }

  function updateNcVisualSettings() {
    ncUi.updateNcOpacityLabel();
    ncScene.updateVisualSettings(ncUi.getNcVisualSettings());
  }

  return {
    init: () => ncPicking.init(),
    buildNcPreviewFromUi,
    updateNcVisualSettings,
    updateNcOpacityLabel: ncUi.updateNcOpacityLabel,
    clearNcPreview: () => {
      ncPicking.clearPickableLineBatches();
      selection.clearAll();
      ncUi.clearSourceSelection();
      activeToolpath = null;
      ncScene.clearNcPreview();
    },
    dispose: () => {
      ncPicking.dispose();
      selection.clearAll();
      ncUi.dispose();
      activeToolpath = null;
      ncScene.clearNcPreview();
    }
  };
}
