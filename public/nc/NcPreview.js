import { NC_MAX_FILE_BYTES } from './nc-parser.mjs';
import { importNcToCanonicalDocument } from './import/canonical-normalizer.mjs';
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
    this.ctx.ncColorStrategySelect?.addEventListener('change', this.updateNcVisualSettings);
    Object.values(this.ctx.ncColorInputs).forEach((input) => input?.addEventListener('input', this.updateNcVisualSettings));
    this.preview.init();
    this.updateNcOpacityLabel();
  }

  dispose() {
    this.ctx.ncPreviewButton?.removeEventListener('click', this.buildNcPreviewFromUi);
    this.ctx.ncOpacityInput?.removeEventListener('input', this.updateNcVisualSettings);
    this.ctx.ncColorStrategySelect?.removeEventListener('change', this.updateNcVisualSettings);
    Object.values(this.ctx.ncColorInputs).forEach((input) => input?.removeEventListener('input', this.updateNcVisualSettings));
    this.preview.dispose();
  }
}

export function createNcPreview(ctx) {
  const { viewerMode, isPreviewMode, ncFileInput } = ctx;
  const ncScene = createNcScene(ctx);
  let activeToolpath = null;
  let ncUi;
  const selection = new NcSelectionController({
    onHoverChange: (segmentId) => {
      ncScene.setHoverHighlight(segmentId);
      ncUi.showHoverInspector(getActiveSegment(segmentId));
    },
    onSelectionChange: (segmentId, sourceContext = null) => {
      ncScene.setSelectionHighlight(segmentId);
      const segment = getActiveSegment(segmentId);
      if (sourceContext?.sourceLine) {
        ncUi.showSourceLineSelection(sourceContext.sourceLine, segment);
      } else {
        ncUi.showSourceSelection(segment);
      }
    },
    getSourceLineByNumber
  });
  ncUi = createNcUi({
    ...ctx,
    onSourceLineSelect: (lineNumber) => selection.selectSourceLine(lineNumber),
    onFocusSelectedSegment: () => focusSelectedSegment()
  });
  const ncPicking = new NcPickingController({
    ...ctx,
    onHoverSegmentChange: (segmentId) => selection.setHoveredSegmentId(segmentId),
    onSelectSegmentChange: (segmentId) => selection.selectSegment(segmentId)
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
      const imported = importNcToCanonicalDocument(text, { filename: file.name });
      if (!imported.ok) {
        const details = imported.diagnostics.map((diagnostic) => `line ${diagnostic.source?.lineNumber ?? 'n/a'}: ${diagnostic.message}`).join('\n');
        ncUi.setNcStatus(`NC normalization failed:\n${details}`, true);
        return;
      }
      toolpath = imported.toolpath;
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
    ncUi.renderColorLegend(previewResult.colorLegend);
    ncUi.setNcStatus(formatNcStatus(toolpath, 'Normalized canonical NC document opened.'));
  }

  function selectSegment(segmentId) {
    selection.selectSegment(segmentId);
  }

  function selectSourceLine(lineNumber) {
    selection.selectSourceLine(lineNumber);
  }

  function clearSelection() {
    selection.clearSelection();
  }

  function focusSelectedSegment() {
    ncScene.focusSelectedSegment();
  }

  function getActiveSegment(segmentId) {
    if (!Number.isInteger(segmentId) || !activeToolpath) {
      return null;
    }
    return activeToolpath.segments.find((segment) => segment.id === segmentId) ?? null;
  }

  function getSourceLineByNumber(lineNumber) {
    if (!Number.isInteger(lineNumber) || !activeToolpath) {
      return null;
    }
    return activeToolpath.lines.find((line) => line.number === lineNumber) ?? null;
  }

  function updateNcVisualSettings() {
    ncUi.updateNcOpacityLabel();
    const result = ncScene.updateVisualSettings(ncUi.getNcVisualSettings());
    if (result?.lineBatches) {
      ncPicking.setPickableLineBatches(result.lineBatches);
    }
    ncUi.renderColorLegend(result?.colorLegend ?? null);
  }

  return {
    init: () => ncPicking.init(),
    buildNcPreviewFromUi,
    selectSegment,
    selectSourceLine,
    clearSelection,
    focusSelectedSegment,
    updateNcVisualSettings,
    updateNcOpacityLabel: ncUi.updateNcOpacityLabel,
    clearNcPreview: () => {
      ncPicking.clearPickableLineBatches();
      selection.clearAll();
      ncUi.clearSourceSelection();
      ncUi.renderColorLegend(null);
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
