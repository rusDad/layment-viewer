import { NC_MAX_FILE_BYTES } from './nc-parser.mjs';
import { importNcToCanonicalDocument } from './import/canonical-normalizer.mjs';
import { applyBatchNumericOperationCommand, applyUpdateCanonicalNumericFieldCommand, buildBatchNumericEditPlan, createBatchNumericOperation, createEditedNcFilename, deleteCanonicalLinesCommand, getCanonicalLineEditReadModel } from './document/CanonicalNcEditor.mjs';
import { serializeCanonicalNcDocument } from './document/CanonicalNcDocument.mjs';
import { recalculateCanonicalExecution } from './execution/NcCanonicalExecution.mjs';
import { analyzeNcExecutionCache } from './execution/NcProgramAnalysis.mjs';
import { NcEditHistory } from './document/NcEditHistory.mjs';
import { buildNcEditImpact } from './document/NcEditImpact.mjs';
import { applySemanticTranslationCommand, buildSemanticTranslationPlan, buildTranslatedCandidateDocument, verifySemanticTranslationPlan } from './document/NcSemanticTranslation.mjs';
import { createNcScene } from './NcScene.js';
import { NcPickingController } from './NcPickingController.js';
import { NcSelectionController, orderedSelection } from './NcSelectionController.js';
import { createNcUi, formatNcStatus } from './NcUi.js';
import { evaluateNcSelectionQuery } from './NcSelectionQuery.mjs';


export class NcPreview {
  constructor(ctx) {
    this.ctx = ctx;
    this.preview = createNcPreview(ctx);
    this.buildNcPreviewFromUi = this.preview.buildNcPreviewFromUi;
    this.openNcDocument = this.preview.openNcDocument;
    this.setNcStatus = this.preview.setNcStatus;
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
  let initialCanonicalDocument = null;
  let activeLineId = null;
  let lastImpact = null;
  let previousOverlayVisible = true;
  const history = new NcEditHistory();
  let activeDimensions = null;
  let activeFilename = null;
  let translationPreview = null;
  let ncUi;
  const selection = new NcSelectionController({
    onHoverChange: (segmentId) => {
      ncScene.setHoverHighlight(segmentId);
      ncUi.showHoverInspector(getActiveSegment(segmentId));
    },
    onSelectionChange: (selectionState) => updateSelectionState(selectionState),
    getDocumentLineIds: () => activeDocument?.lines?.map((line) => line.lineId) ?? [],
    getLineIdBySegmentId: (segmentId) => activeCache?.segmentIdToLineId?.get(segmentId) ?? null
  });
  ncUi = createNcUi({
    ...ctx,
    onSourceLineSelect: (lineId, modifiers) => selection.selectLineId(lineId, modifiers, 'source'),
    onFocusSelectedSegment: () => focusSelectedSegment(),
    onDeleteSelected: () => deleteSelectedLines(),
    onUndo: () => undo(),
    onRedo: () => redo(),
    onResetToInitial: () => resetToInitial(),
    onClearSelection: () => selection.clearSelection(),
    onSelectAll: () => selection.selectAll('command'),
    onTogglePreviousOverlay: (visible) => { previousOverlayVisible = visible; ncScene.setPreviousGeometryOverlayVisible(visible, lastImpact?.previousOverlaySegments); },
    onCanonicalFieldCommit: (command) => commitCanonicalField(command),
    onBatchNumericPreview: (draft) => previewBatchNumeric(draft),
    onBatchNumericApply: (draft) => applyBatchNumeric(draft),
    onTranslationPreview: (draft) => previewTranslation(draft),
    onTranslationApply: (draft) => applyTranslation(draft),
    onTranslationClear: () => clearTranslationPreview(),
    onDownloadNormalized: () => downloadNormalizedCandidate(),
    onApplySelectionQuery: (query, mode, filterSource) => applySelectionQuery(query, mode, filterSource),
    getActiveDocumentRevision: () => activeDocument?.revision ?? null
  });
  const ncPicking = new NcPickingController({
    ...ctx,
    onHoverSegmentChange: (segmentId) => selection.setHoveredSegmentId(segmentId),
    onSelectSegmentChange: (segmentId, modifiers) => selection.selectSegment(segmentId, modifiers)
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

    await openNcDocument({ text, filename: file.name, dimensions });
  }

  async function openNcDocument({ text, filename, dimensions }) {
    if (typeof text !== 'string' || !text.trim()) {
      ncUi.setNcStatus('NC файл пустой.', true);
      return false;
    }
    let toolpath;
    let imported;
    try {
      imported = importNcToCanonicalDocument(text, { filename });
      if (!imported.ok) {
        const details = imported.diagnostics.map((diagnostic) => `line ${diagnostic.source?.lineNumber ?? 'n/a'}: ${diagnostic.message}`).join('\n');
        ncUi.setNcStatus(`NC normalization failed:\n${details}`, true);
        return false;
      }
      toolpath = imported.toolpath;
    } catch (err) {
      ncUi.setNcStatus(`Не удалось распарсить NC: ${err instanceof Error ? err.message : String(err)}`, true);
      return false;
    }

    if (toolpath.segments.length === 0) {
      activeToolpath = null;
      activeDocument = null;
      activeCache = null;
      initialCanonicalText = null;
      initialCanonicalDocument = null;
      activeLineId = null;
      activeDimensions = null;
      activeFilename = null;
      ncUi.clearEditInspector();
      ncUi.resetSelectionQuery(activeDocument?.revision ?? null);
      ncUi.setNcStatus(formatNcStatus(toolpath, 'Движения G0/G1/G2/G3 не найдены.'), true);
      return false;
    }

    ncPicking.clearPickableLineBatches();
    history.clear();
    lastImpact = null;
    ncScene.clearPreviousGeometryOverlay();
    ncScene.clearCandidateGeometryOverlay();
    translationPreview = null;
    selection.clearAll();
    activeToolpath = toolpath;
    activeDocument = imported.canonicalDocument;
    activeCache = imported.executionCache;
    initialCanonicalText = imported.canonicalText;
    initialCanonicalDocument = imported.canonicalDocument;
    activeFilename = filename;
    activeDimensions = dimensions;
    activeLineId = null;
    ncUi.clearEditInspector();
    ncUi.resetSelectionQuery(activeDocument?.revision ?? null);
    ncUi.setSourceDocument(toolpath.lines);
    ncUi.setDirtyState(false);
    ncUi.setHistoryState(history.getState(), false);
    ncUi.showImpactSummary(null);
    const previewResult = ncScene.buildNcPreview(toolpath, dimensions, ncUi.getNcVisualSettings());
    ncPicking.setPickableLineBatches(previewResult.motionLineBatches);
    ncUi.renderColorLegend(previewResult.colorLegend);
    ncUi.setNcStatus(formatNcStatus(toolpath, 'Normalized canonical NC document opened.'));
    if (ctx.ncDocumentNameEl) ctx.ncDocumentNameEl.textContent = filename;
    return true;
  }


  function updateSelectionState(selectionState) {
    const selectedLineIds = selectionState.orderedLineIds;
    const segmentIds = selectedLineIds.flatMap((lineId) => activeCache?.lineIdToSegmentIds?.get(lineId) ?? []);
    ncScene.setSelectionHighlight(segmentIds);
    ncUi.showSelection(selectionState, activeToolpath, activeCache);
    activeLineId = selectedLineIds.length === 1 ? (selectionState.focusLineId ?? selectedLineIds[0]) : null;
    activateCanonicalLine(activeLineId, { selectionState });
  }

  function activateCanonicalLine(lineId) {
    activeLineId = lineId ?? null;
    if (!activeLineId || !activeDocument || !activeCache) {
      ncUi.setSelectionEditState(selection.getSelection(), activeDocument, activeCache, activeToolpath);
      return;
    }
    ncUi.setActiveEditLine(getCanonicalLineEditReadModel({ document: activeDocument, cache: activeCache, lineId: activeLineId }));
    ncUi.setDirtyState(Boolean(activeDocument.dirty));
  }



  function previewBatchNumeric(draft) {
    const operationResult = createBatchNumericOperation(draft);
    if (!operationResult.ok) { ncUi.showBatchNumericPlan(operationResult); return operationResult; }
    const plan = buildBatchNumericEditPlan({ document: activeDocument, lineIds: selection.getSelection().orderedLineIds, operation: operationResult.operation });
    ncUi.showBatchNumericPlan(plan);
    return plan;
  }

  function applyBatchNumeric(draft) {
    const beforeSelection = selection.getSelection();
    const operationResult = createBatchNumericOperation(draft);
    if (!operationResult.ok) { ncUi.showBatchNumericPlan(operationResult); return; }
    const plan = buildBatchNumericEditPlan({ document: activeDocument, lineIds: beforeSelection.orderedLineIds, operation: operationResult.operation });
    if (!plan.ok) { ncUi.showBatchNumericPlan(plan); return; }
    const result = applyBatchNumericOperationCommand({ document: activeDocument, previousCache: activeCache, initialCanonicalText, expectedRevision: activeDocument?.revision, operation: operationResult.operation, plan });
    if (!result.ok) { ncUi.showBatchNumericPlan(result); return; }
    ncUi.showBatchNumericPlan(result.plan);
    if (result.noOp) { ncUi.setNcStatus(result.plan.summary || 'Batch operation has no changes.'); return; }
    commitWorkspaceTransition({
      kind: 'batch-numeric-operation',
      label: `Batch ${operationResult.operation.type} ${operationResult.operation.targetField} on ${result.changedLineIds.length} line${result.changedLineIds.length === 1 ? '' : 's'}`,
      candidateDocument: result.document,
      executionUpdate: result.executionUpdate,
      firstAffectedIndex: result.firstAffectedIndex,
      selectionBefore: beforeSelection,
      selectionAfter: reconcileSelectionToDocument(beforeSelection, result.document),
      changedLineIds: result.changedLineIds
    });
  }

  function previewTranslation(draft) {
    const beforeSelection = selection.getSelection();
    const plan = buildSemanticTranslationPlan({ document: activeDocument, previousCache: activeCache, lineIds: beforeSelection.orderedLineIds, dxMm: Number(draft?.dxMm), dyMm: Number(draft?.dyMm) });
    if (!plan.ok || !plan.applicable) {
      translationPreview = null;
      ncScene.clearCandidateGeometryOverlay();
      ncUi.showTranslationPlan(plan);
      return plan;
    }
    const candidate = buildTranslatedCandidateDocument({ document: activeDocument, plan, initialCanonicalText });
    if (!candidate.ok) { ncUi.showTranslationPlan(candidate); return candidate; }
    let executionUpdate;
    try { executionUpdate = recalculateCanonicalExecution({ document: candidate.document, previousCache: activeCache, firstAffectedIndex: plan.earliestAffectedLineIndex }); }
    catch (err) {
      const failed = { ok: false, error: { code: 'execution-failed', message: err instanceof Error ? err.message : String(err) } };
      ncUi.showTranslationPlan(failed);
      return failed;
    }
    const verification = verifySemanticTranslationPlan({ beforeDocument: activeDocument, beforeCache: activeCache, candidateDocument: candidate.document, candidateCache: executionUpdate.cache, plan });
    const displayPlan = Object.freeze({ ...plan, verification, applicable: plan.applicable && verification.ok });
    const changedIds = new Set([...displayPlan.expectedChangedLineIds, ...displayPlan.expectedConnectorChanges.map((c) => c.lineId)]);
    ncScene.setPreviousGeometryOverlay(activeCache.segments.filter((s) => changedIds.has(s.sourceLineId)), { visible: previousOverlayVisible });
    ncScene.setCandidateGeometryOverlay(executionUpdate.cache.segments.filter((s) => changedIds.has(s.sourceLineId)));
    translationPreview = verification.ok ? { plan: displayPlan, selectionBefore: beforeSelection } : null;
    ncUi.showTranslationPlan(displayPlan);
    return displayPlan;
  }

  function applyTranslation(draft) {
    const plan = translationPreview?.plan ?? buildSemanticTranslationPlan({ document: activeDocument, previousCache: activeCache, lineIds: selection.getSelection().orderedLineIds, dxMm: Number(draft?.dxMm), dyMm: Number(draft?.dyMm) });
    const result = applySemanticTranslationCommand({ document: activeDocument, previousCache: activeCache, initialCanonicalText, expectedRevision: activeDocument?.revision, plan });
    if (!result.ok) { ncUi.showTranslationPlan(result); return; }
    ncUi.showTranslationPlan(result.plan);
    if (result.noOp) { ncUi.setNcStatus('Semantic translation has no changes.'); return; }
    const beforeSelection = translationPreview?.selectionBefore ?? selection.getSelection();
    clearTranslationPreview();
    commitWorkspaceTransition({
      kind: 'semantic-translation',
      label: `Translate ${result.changedLineIds.length} canonical line${result.changedLineIds.length === 1 ? '' : 's'} by ΔX ${plan.dxMm}, ΔY ${plan.dyMm}`,
      candidateDocument: result.document,
      executionUpdate: result.executionUpdate,
      firstAffectedIndex: result.firstAffectedIndex,
      selectionBefore: beforeSelection,
      selectionAfter: reconcileSelectionToDocument(beforeSelection, result.document),
      changedLineIds: result.changedLineIds
    });
  }

  function clearTranslationPreview() {
    translationPreview = null;
    ncScene.clearCandidateGeometryOverlay();
    if (lastImpact) ncScene.setPreviousGeometryOverlay(lastImpact.previousOverlaySegments, { visible: previousOverlayVisible });
    else ncScene.clearPreviousGeometryOverlay();
    ncUi.showTranslationPlan(null);
  }

  function commitCanonicalField(command) {
    const beforeSelection = selection.getSelection();
    const result = applyUpdateCanonicalNumericFieldCommand({ document: activeDocument, previousCache: activeCache, initialCanonicalText, ...command });
    if (!result.ok) {
      ncUi.setActiveEditLine(getCanonicalLineEditReadModel({ document: activeDocument, cache: activeCache, lineId: command.lineId }), { error: result.error });
      return;
    }
    if (result.document === activeDocument || result.document.revision === activeDocument?.revision) return;
    commitWorkspaceTransition({
      kind: 'update-numeric-field',
      label: `Change ${command.field} on line ${(activeDocument.lines.findIndex((line) => line.lineId === command.lineId) + 1) || '?'}`,
      candidateDocument: result.document,
      executionUpdate: result.executionUpdate,
      firstAffectedIndex: activeDocument.lines.findIndex((line) => line.lineId === command.lineId),
      selectionBefore: beforeSelection,
      selectionAfter: beforeSelection,
      changedLineIds: [command.lineId]
    });
  }

  function applySelectionQuery(query, mode = 'replace', filterSource = false) {
    const result = evaluateNcSelectionQuery({ document: activeDocument, cache: activeCache, analysis: activeToolpath, currentSelection: selection.getSelection(), query });
    if (!result.ok) { ncUi.showSelectionQueryResult(result); return; }
    if (!filterSource) {
      const order = activeDocument?.lines?.map((line) => line.lineId) ?? [];
      const ids = mode === 'add' ? [...selection.getSelection().orderedLineIds, ...result.lineIds] : result.lineIds;
      selection.setSelection(orderedSelection(ids, order, result.lineIds[0] ?? ids[0] ?? null, result.lineIds.at(-1) ?? ids.at(-1) ?? null, 'query'));
    }
    ncUi.showSelectionQueryResult(result, { filterSource });
  }

  function deleteSelectedLines() {
    const beforeSelection = selection.getSelection();
    const lineIds = beforeSelection.orderedLineIds;
    const result = deleteCanonicalLinesCommand({ document: activeDocument, expectedRevision: activeDocument?.revision, lineIds, initialCanonicalText });
    if (!result.ok) { ncUi.setNcStatus(`${result.error.code}: ${result.error.message}`, true); return; }
    let executionUpdate;
    try { executionUpdate = recalculateCanonicalExecution({ document: result.document, previousCache: activeCache, firstAffectedIndex: Math.min(result.firstAffectedIndex, result.document.lines.length) }); }
    catch (err) { ncUi.setNcStatus(`candidate-execution-failed: ${err instanceof Error ? err.message : String(err)}`, true); return; }
    const fallback = result.document.lines[result.firstAffectedIndex]?.lineId ?? result.document.lines[result.firstAffectedIndex - 1]?.lineId ?? null;
    const afterSelection = reconcileSelectionAfterDelete(beforeSelection, result.deletedLineIds, result.document, fallback);
    commitWorkspaceTransition({ kind: 'delete-lines', label: `Delete ${result.deletedLineIds.length} canonical line${result.deletedLineIds.length === 1 ? '' : 's'}`, candidateDocument: result.document, executionUpdate, firstAffectedIndex: result.firstAffectedIndex, selectionBefore: beforeSelection, selectionAfter: afterSelection, changedLineIds: result.deletedLineIds, deletedLineCount: result.deletedLineIds.length });
  }

  function resetToInitial() {
    if (!initialCanonicalDocument || !activeDocument || serializeCanonicalNcDocument(activeDocument) === initialCanonicalText) return;
    const beforeSelection = selection.getSelection();
    const candidateDocument = Object.freeze({ ...initialCanonicalDocument, revision: (activeDocument.revision ?? 0) + 1, dirty: false });
    const executionUpdate = recalculateCanonicalExecution({ document: candidateDocument, previousCache: activeCache, firstAffectedIndex: 0 });
    const afterSelection = reconcileSelectionToDocument(beforeSelection, candidateDocument);
    commitWorkspaceTransition({ kind: 'reset-to-initial', label: 'Reset to initial canonical document', candidateDocument, executionUpdate, firstAffectedIndex: 0, selectionBefore: beforeSelection, selectionAfter: afterSelection, changedLineIds: activeDocument.lines.map((line) => line.lineId) });
  }

  function commitWorkspaceTransition({ kind, label, candidateDocument, executionUpdate, firstAffectedIndex, selectionBefore, selectionAfter, changedLineIds = [], deletedLineCount = 0, pushHistory = true }) {
    const beforeDocument = activeDocument;
    const beforeCache = activeCache;
    const analysis = analyzeNcExecutionCache(executionUpdate.cache, candidateDocument);
    analysis.canonicalDocument = candidateDocument;
    analysis.rawDocument = candidateDocument.rawDocument;
    analysis.canonicalText = serializeCanonicalNcDocument(candidateDocument);
    analysis.executionCache = executionUpdate.cache;
    activeDocument = candidateDocument;
    activeCache = executionUpdate.cache;
    activeToolpath = analysis;
    activeLineId = selectionAfter?.orderedLineIds?.length === 1 ? selectionAfter.focusLineId : null;
    if (pushHistory) history.push({ kind, label, beforeDocument, afterDocument: candidateDocument, firstAffectedIndex, selectionBefore, selectionAfter, changedLineIds });
    lastImpact = buildNcEditImpact({ beforeDocument, afterDocument: candidateDocument, beforeCache, afterCache: activeCache, executionUpdate, operation: { kind, label, selectedLineCount: selectionBefore?.orderedLineIds?.length ?? 0, deletedLineCount, firstAffectedIndex }, dirty: candidateDocument.dirty, historyState: history.getState() });
    ncUi.setSourceDocument(activeToolpath.lines);
    ncUi.markSelectionQueryStale(activeDocument?.revision ?? null);
    selection.setSelection(selectionAfter);
    ncUi.setDirtyState(Boolean(activeDocument.dirty));
    ncUi.setHistoryState(history.getState(), Boolean(activeDocument.dirty));
    ncUi.showImpactSummary(lastImpact);
    const previewResult = ncScene.buildNcPreview(activeToolpath, activeDimensions, ncUi.getNcVisualSettings());
    ncPicking.setPickableLineBatches(previewResult.motionLineBatches);
    ncScene.setPreviousGeometryOverlay(lastImpact.previousOverlaySegments, { visible: previousOverlayVisible });
    ncUi.renderColorLegend(previewResult.colorLegend);
    updateSelectionState(selection.getSelection());
    ncUi.setNcStatus(formatNcStatus(activeToolpath, `${label}. Recalculated ${executionUpdate.firstRecalculatedIndex + 1}..${executionUpdate.lastRecalculatedIndex + 1}.`));
  }

  function undo() { applyHistoryTransition('undo'); }
  function redo() { applyHistoryTransition('redo'); }
  function applyHistoryTransition(direction) {
    const tx = direction === 'undo' ? history.peekUndo() : history.peekRedo();
    if (!tx) { ncUi.setNcStatus(direction === 'undo' ? 'history-empty: There is no edit to undo.' : 'redo-empty: There is no edit to redo.', true); return; }
    const target = direction === 'undo' ? tx.beforeDocument : tx.afterDocument;
    const targetSelection = direction === 'undo' ? tx.selectionBefore : tx.selectionAfter;
    let executionUpdate;
    try { executionUpdate = recalculateCanonicalExecution({ document: target, previousCache: activeCache, firstAffectedIndex: Math.min(tx.firstAffectedIndex ?? 0, target.lines.length) }); }
    catch (err) { ncUi.setNcStatus(`history-transition-failed: ${err instanceof Error ? err.message : String(err)}`, true); return; }
    const moved = direction === 'undo' ? history.moveUndo() : history.moveRedo();
    if (!moved.ok) { ncUi.setNcStatus(`${moved.error.code}: ${moved.error.message}`, true); return; }
    commitWorkspaceTransition({ kind: direction, label: `${direction === 'undo' ? 'Undo' : 'Redo'} ${tx.label}`, candidateDocument: target, executionUpdate, firstAffectedIndex: tx.firstAffectedIndex ?? 0, selectionBefore: selection.getSelection(), selectionAfter: reconcileSelectionToDocument(targetSelection, target), changedLineIds: tx.changedLineIds, pushHistory: false });
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
    if (!ncScene.focusSelectedSegment()) ncUi.setNcStatus('Selected canonical lines do not produce rendered geometry.', true);
  }

  function getActiveSegment(segmentId) {
    if (!isValidSegmentId(segmentId) || !activeToolpath) {
      return null;
    }
    return activeToolpath.segments.find((segment) => (segment.segmentId ?? segment.id) === segmentId) ?? null;
  }

  function getSourceLineByNumber(lineNumber) {
    if (!Number.isInteger(lineNumber) || !activeToolpath) return null;
    return activeToolpath.lines.find((line) => line.number === lineNumber) ?? null;
  }

  function reconcileSelectionAfterDelete(beforeSelection, deletedLineIds, document, fallbackLineId) {
    const deleted = new Set(deletedLineIds);
    const order = document.lines.map((line) => line.lineId);
    let ids = beforeSelection.orderedLineIds.filter((id) => !deleted.has(id) && order.includes(id));
    if (ids.length === 0 && fallbackLineId) ids = [fallbackLineId];
    const focus = ids.includes(beforeSelection.focusLineId) ? beforeSelection.focusLineId : ids[0] ?? null;
    return { orderedLineIds: ids, anchorLineId: ids.includes(beforeSelection.anchorLineId) ? beforeSelection.anchorLineId : focus, focusLineId: focus, origin: 'command' };
  }

  function reconcileSelectionToDocument(sourceSelection, document) {
    const order = document.lines.map((line) => line.lineId);
    const ids = (sourceSelection?.orderedLineIds ?? []).filter((id) => order.includes(id));
    const selected = ids.length ? ids : (order[0] ? [order[0]] : []);
    const focus = selected.includes(sourceSelection?.focusLineId) ? sourceSelection.focusLineId : selected[0] ?? null;
    return { orderedLineIds: selected, anchorLineId: selected.includes(sourceSelection?.anchorLineId) ? sourceSelection.anchorLineId : focus, focusLineId: focus, origin: 'history' };
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
    openNcDocument,
    setNcStatus: ncUi.setNcStatus,
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
      initialCanonicalDocument = null;
      activeLineId = null;
      activeDimensions = null;
      activeFilename = null;
      history.clear();
      lastImpact = null;
      translationPreview = null;
      ncUi.showImpactSummary(null);
      ncUi.setHistoryState(history.getState(), false);
      ncUi.clearEditInspector();
      ncUi.resetSelectionQuery(null);
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
      initialCanonicalDocument = null;
      activeLineId = null;
      activeDimensions = null;
      activeFilename = null;
      history.clear();
      lastImpact = null;
      translationPreview = null;
      ncUi.showImpactSummary(null);
      ncUi.setHistoryState(history.getState(), false);
      ncUi.clearEditInspector();
      ncUi.resetSelectionQuery(null);
      ncScene.clearNcPreview();
    }
  };
}

function isValidSegmentId(segmentId) { return Number.isInteger(segmentId) || (typeof segmentId === 'string' && segmentId.length > 0); }
