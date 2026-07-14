import { NC_MAX_FILE_BYTES } from './nc-parser.mjs';
import { importNcToCanonicalDocument } from './import/canonical-normalizer.mjs';
import { applyUpdateCanonicalNumericFieldCommand, createEditedNcFilename, getCanonicalLineEditReadModel } from './document/CanonicalNcEditor.mjs';
import { serializeCanonicalNcDocument } from './document/CanonicalNcDocument.mjs';
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
  let activeDocument = null;
  let activeCache = null;
  let initialCanonicalText = null;
  let activeLineId = null;
  let activeDimensions = null;
  let activeFilename = null;
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
        activateCanonicalLine(sourceContext.sourceLine.lineId);
      } else {
        ncUi.showSourceSelection(segment);
        activateCanonicalLine(segment?.sourceLineId ?? null);
      }
    },
    getSourceLineByNumber
  });
  ncUi = createNcUi({
    ...ctx,
    onSourceLineSelect: (lineNumber) => selection.selectSourceLine(lineNumber),
    onFocusSelectedSegment: () => focusSelectedSegment(),
    onCanonicalFieldCommit: (command) => commitCanonicalField(command),
    onDownloadNormalized: () => downloadNormalizedCandidate()
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
      activeDocument = imported.canonicalDocument;
      activeCache = imported.executionCache;
      initialCanonicalText = imported.canonicalText;
      activeFilename = file.name;
    } catch (err) {
      ncUi.setNcStatus(`Не удалось распарсить NC: ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }

    if (toolpath.segments.length === 0) {
      activeToolpath = null;
      activeDocument = null;
      activeCache = null;
      initialCanonicalText = null;
      activeLineId = null;
      activeDimensions = null;
      activeFilename = null;
      ncUi.clearEditInspector();
      ncUi.setNcStatus(formatNcStatus(toolpath, 'Движения G0/G1/G2/G3 не найдены.'), true);
      return;
    }

    ncPicking.clearPickableLineBatches();
    selection.clearAll();
    activeToolpath = toolpath;
    activeDimensions = dimensions;
    activeLineId = null;
    ncUi.clearEditInspector();
    ncUi.setSourceDocument(toolpath.lines);
    ncUi.setDirtyState(false);
    const previewResult = ncScene.buildNcPreview(toolpath, dimensions, ncUi.getNcVisualSettings());
    ncPicking.setPickableLineBatches(previewResult.motionLineBatches);
    ncUi.renderColorLegend(previewResult.colorLegend);
    ncUi.setNcStatus(formatNcStatus(toolpath, 'Normalized canonical NC document opened.'));
  }


  function activateCanonicalLine(lineId) {
    activeLineId = lineId ?? null;
    if (!activeLineId || !activeDocument || !activeCache) {
      ncUi.clearEditInspector();
      return;
    }
    ncUi.setActiveEditLine(getCanonicalLineEditReadModel({ document: activeDocument, cache: activeCache, lineId: activeLineId }));
    ncUi.setDirtyState(Boolean(activeDocument.dirty));
  }

  function commitCanonicalField(command) {
    const result = applyUpdateCanonicalNumericFieldCommand({
      document: activeDocument,
      previousCache: activeCache,
      initialCanonicalText,
      ...command
    });
    if (!result.ok) {
      ncUi.setActiveEditLine(getCanonicalLineEditReadModel({ document: activeDocument, cache: activeCache, lineId: command.lineId }), { error: result.error });
      return;
    }
    activeDocument = result.document;
    activeCache = result.executionUpdate.cache;
    activeToolpath = result.analysis;
    activeLineId = result.changedLineId;
    ncUi.setSourceDocument(activeToolpath.lines);
    ncUi.setActiveEditLine(getCanonicalLineEditReadModel({ document: activeDocument, cache: activeCache, lineId: activeLineId }), { executionUpdate: result.executionUpdate });
    ncUi.setDirtyState(result.dirty);
    const previewResult = ncScene.buildNcPreview(activeToolpath, activeDimensions, ncUi.getNcVisualSettings());
    ncPicking.setPickableLineBatches(previewResult.motionLineBatches);
    ncUi.renderColorLegend(previewResult.colorLegend);
    ncUi.setNcStatus(formatNcStatus(activeToolpath, `Canonical edit applied. Recalculated ${result.executionUpdate.firstRecalculatedIndex + 1}..${result.executionUpdate.lastRecalculatedIndex + 1}.`));
  }

  function downloadNormalizedCandidate() {
    if (!activeDocument) return;
    const text = serializeCanonicalNcDocument(activeDocument);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = createEditedNcFilename(activeFilename, Boolean(activeDocument.dirty));
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
    if (!isValidSegmentId(segmentId) || !activeToolpath) {
      return null;
    }
    return activeToolpath.segments.find((segment) => (segment.segmentId ?? segment.id) === segmentId) ?? null;
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
      activeDocument = null;
      activeCache = null;
      initialCanonicalText = null;
      activeLineId = null;
      activeDimensions = null;
      activeFilename = null;
      ncUi.clearEditInspector();
      ncScene.clearNcPreview();
    },
    dispose: () => {
      ncPicking.dispose();
      selection.clearAll();
      ncUi.dispose();
      activeToolpath = null;
      activeDocument = null;
      activeCache = null;
      initialCanonicalText = null;
      activeLineId = null;
      activeDimensions = null;
      activeFilename = null;
      ncUi.clearEditInspector();
      ncScene.clearNcPreview();
    }
  };
}

function isValidSegmentId(segmentId) { return Number.isInteger(segmentId) || (typeof segmentId === 'string' && segmentId.length > 0); }
