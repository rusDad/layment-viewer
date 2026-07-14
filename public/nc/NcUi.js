import { NC_DEFAULT_COLORS } from './NcScene.js';

const NC_SOURCE_ROW_HEIGHT_PX = 24;
const NC_SOURCE_OVERSCAN_ROWS = 8;

export function createNcUi(ctx) {
  const {
    ncStatusEl,
    ncHoverInspectorEl,
    ncSourcePanelEl,
    ncSourceListEl,
    ncSourceDetailEl,
    ncSourceFocusButton,
    ncEditInspectorEl,
    ncDownloadNormalizedButton,
    ncWidthInput,
    ncHeightInput,
    ncThicknessInput,
    ncOpacityInput,
    ncOpacityValueEl,
    ncColorStrategySelect,
    ncColorLegendEl,
    ncColorInputs,
    onSourceLineSelect,
    onFocusSelectedSegment,
    onCanonicalFieldCommit,
    onDownloadNormalized
  } = ctx;

  let sourceLines = [];
  let selectedSegmentId = null;
  let selectedLineIndex = null;
  let sourceScrollHandler = null;
  let activeLineId = null;
  let editReadModel = null;
  let lastEditError = null;
  let lastEditUpdate = null;

  function setNcStatus(message, isError = false) {
    if (!ncStatusEl) {
      return;
    }

    ncStatusEl.textContent = message || '';
    ncStatusEl.classList.toggle('status-error', Boolean(message) && isError);
    ncStatusEl.classList.toggle('status-meta', Boolean(message) && !isError);
  }

  function getNcDimensionsFromUi() {
    const width = Number(ncWidthInput?.value);
    const height = Number(ncHeightInput?.value);
    const thickness = Number(ncThicknessInput?.value);

    if (![width, height, thickness].every((value) => Number.isFinite(value) && value > 0)) {
      return null;
    }

    return { width, height, thickness };
  }

  function getNcVisualSettings() {
    return {
      opacity: clampNumber(Number(ncOpacityInput?.value ?? 0.3), 0, 1),
      colorStrategy: ncColorStrategySelect?.value || 'motion',
      colors: {
        G0: ncColorInputs.G0?.value || NC_DEFAULT_COLORS.G0,
        G1: ncColorInputs.G1?.value || NC_DEFAULT_COLORS.G1,
        G2: ncColorInputs.G2?.value || NC_DEFAULT_COLORS.G2,
        G3: ncColorInputs.G3?.value || NC_DEFAULT_COLORS.G3
      }
    };
  }

  function updateNcOpacityLabel() {
    if (ncOpacityValueEl && ncOpacityInput) {
      ncOpacityValueEl.textContent = Number(ncOpacityInput.value).toFixed(2);
    }
  }

  function showHoverInspector(segment) {
    renderInspector(ncHoverInspectorEl, segment);
  }

  function renderColorLegend(legend) {
    if (!ncColorLegendEl) return;
    ncColorLegendEl.innerHTML = '';
    if (!legend) return;
    const title = document.createElement('div');
    title.className = 'nc-color-legend-title';
    title.textContent = legend.summary ? `${legend.title}: ${legend.summary}` : legend.title;
    const items = document.createElement('div');
    items.className = 'nc-color-legend-items';
    legend.items.forEach((item) => {
      const row = document.createElement('span');
      row.className = 'nc-color-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'nc-color-legend-swatch';
      swatch.style.backgroundColor = item.color;
      const label = document.createElement('span');
      label.textContent = item.label;
      row.append(swatch, label);
      items.append(row);
    });
    ncColorLegendEl.append(title, items);
  }

  function setSourceDocument(lines) {
    sourceLines = Array.isArray(lines) ? lines : [];
    selectedSegmentId = null;
    selectedLineIndex = null;
    if (ncSourceListEl && !sourceScrollHandler) {
      sourceScrollHandler = () => renderSourceWindow();
      ncSourceListEl.addEventListener('scroll', sourceScrollHandler);
      ncSourceListEl.addEventListener('click', handleSourceListClick);
      ncSourceListEl.addEventListener('keydown', handleSourceListKeyDown);
    }
    ncSourceFocusButton?.removeEventListener('click', handleFocusClick);
    ncDownloadNormalizedButton?.removeEventListener('click', handleDownloadClick);
    ncSourceFocusButton?.addEventListener('click', handleFocusClick);
    ncDownloadNormalizedButton?.removeEventListener('click', handleDownloadClick);
    ncDownloadNormalizedButton?.addEventListener('click', handleDownloadClick);
    clearSourceSelection();
    if (ncSourcePanelEl) {
      ncSourcePanelEl.hidden = sourceLines.length === 0;
    }
    renderSourceWindow();
  }

  function showSourceSelection(segment) {
    selectedSegmentId = getSegmentId(segment);
    selectedLineIndex = Number.isInteger(segment?.sourceLineIndex) ? segment.sourceLineIndex : null;

    if (!segment || selectedLineIndex === null) {
      clearSourceSelection();
      return;
    }

    if (ncSourcePanelEl) {
      ncSourcePanelEl.hidden = false;
    }
    renderSourceDetail(segment);
    updateFocusButton(Boolean(segment));
    scrollSourceLineIntoView(selectedLineIndex);
    renderSourceWindow();
  }

  function showSourceLineSelection(line, segment) {
    selectedSegmentId = getSegmentId(segment);
    selectedLineIndex = Number.isInteger(line?.index) ? line.index : null;

    if (!line || selectedLineIndex === null) {
      clearSourceSelection();
      return;
    }

    if (ncSourcePanelEl) {
      ncSourcePanelEl.hidden = false;
    }
    renderSourceDetail(segment, line);
    updateFocusButton(Boolean(segment));
    scrollSourceLineIntoView(selectedLineIndex);
    renderSourceWindow();
  }

  function clearSourceSelection() {
    selectedSegmentId = null;
    selectedLineIndex = null;
    updateFocusButton(false);
    if (ncSourcePanelEl) {
      ncSourcePanelEl.hidden = true;
    }
    if (ncSourceDetailEl) {
      ncSourceDetailEl.textContent = '';
    }
    if (ncSourceListEl) {
      ncSourceListEl.innerHTML = '';
      ncSourceListEl.style.removeProperty('--nc-source-total-height');
    }
  }


  function setActiveEditLine(readModel, options = {}) {
    editReadModel = readModel || null;
    activeLineId = readModel?.lineId ?? null;
    lastEditError = options.error ?? null;
    lastEditUpdate = options.executionUpdate ?? lastEditUpdate;
    if (Number.isInteger(readModel?.canonicalIndex)) {
      selectedLineIndex = readModel.canonicalIndex;
      scrollSourceLineIntoView(readModel.canonicalIndex);
    }
    if (ncSourcePanelEl && sourceLines.length > 0) ncSourcePanelEl.hidden = false;
    renderEditInspector();
    renderSourceWindow();
  }

  function setDirtyState(dirty) {
    if (ncDownloadNormalizedButton) {
      ncDownloadNormalizedButton.disabled = sourceLines.length === 0;
      ncDownloadNormalizedButton.textContent = dirty ? 'Download edited NC' : 'Download normalized NC';
    }
  }

  function clearEditInspector() {
    activeLineId = null;
    editReadModel = null;
    lastEditError = null;
    lastEditUpdate = null;
    if (ncEditInspectorEl) ncEditInspectorEl.innerHTML = '';
    if (ncDownloadNormalizedButton) ncDownloadNormalizedButton.disabled = sourceLines.length === 0;
  }

  function renderEditInspector() {
    if (!ncEditInspectorEl) return;
    ncEditInspectorEl.innerHTML = '';
    if (!editReadModel?.line) {
      ncEditInspectorEl.textContent = 'Select a canonical line to edit numeric motion fields.';
      return;
    }
    const title = document.createElement('div');
    title.className = 'nc-source-detail-title';
    title.textContent = `Active line ${editReadModel.canonicalIndex + 1} · ${editReadModel.line.motion || editReadModel.line.kind}`;
    const source = document.createElement('pre');
    source.className = 'nc-inspector-source';
    source.textContent = editReadModel.serializedLine;
    ncEditInspectorEl.append(title, source);

    const meta = document.createElement('dl');
    meta.className = 'nc-inspector-meta';
    appendInspectorRow(meta, 'lineId', editReadModel.lineId);
    appendInspectorRow(meta, 'source line', (editReadModel.sourceOrigin?.rawLineNumbers || []).join(', ') || 'n/a');
    if (editReadModel.execution) {
      appendInspectorRow(meta, 'execution from', formatNcPoint(editReadModel.execution.start));
      appendInspectorRow(meta, 'execution to', formatNcPoint(editReadModel.execution.end));
      appendInspectorRow(meta, 'segments', editReadModel.execution.segmentIds.join(', ') || 'none');
    }
    if (lastEditUpdate) {
      appendInspectorRow(meta, 'last edit range', `${lastEditUpdate.firstRecalculatedIndex + 1}..${lastEditUpdate.lastRecalculatedIndex + 1}, convergence ${lastEditUpdate.convergedAtIndex == null ? 'none' : lastEditUpdate.convergedAtIndex + 1}`);
    }
    ncEditInspectorEl.append(meta);

    if (!editReadModel.editability.editable) {
      const readonly = document.createElement('p');
      readonly.className = 'section-hint';
      readonly.textContent = `Read-only: ${editReadModel.editability.reason}. ${editReadModel.editability.message}`;
      ncEditInspectorEl.append(readonly);
      return;
    }

    const form = document.createElement('div');
    form.className = 'nc-edit-field-grid';
    editReadModel.fields.forEach(({ field, value }) => {
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = field;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = Number.isFinite(value) ? String(value) : '';
      input.dataset.field = field;
      input.dataset.committedValue = input.value;
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { input.value = input.dataset.committedValue || ''; lastEditError = null; renderEditInspector(); }
        if (event.key === 'Enter') { event.preventDefault(); commitInput(input); }
      });
      input.addEventListener('change', () => commitInput(input));
      label.append(span, input);
      form.append(label);
    });
    ncEditInspectorEl.append(form);
    if (lastEditError) {
      const err = document.createElement('p');
      err.className = 'status status-error';
      err.textContent = `${lastEditError.code}: ${lastEditError.message}`;
      ncEditInspectorEl.append(err);
    }
  }

  function commitInput(input) {
    const text = input.value.trim();
    if (text === '') { lastEditError = { code: 'invalid-number', message: 'Empty input is not a numeric value.' }; renderEditInspector(); return; }
    const value = Number(text);
    if (!Number.isFinite(value)) { lastEditError = { code: 'non-finite-number', message: 'Value must be finite.' }; renderEditInspector(); return; }
    onCanonicalFieldCommit?.({ lineId: editReadModel.lineId, field: input.dataset.field, value, expectedRevision: editReadModel.revision });
  }

  function dispose() {
    if (ncSourceListEl && sourceScrollHandler) {
      ncSourceListEl.removeEventListener('scroll', sourceScrollHandler);
      ncSourceListEl.removeEventListener('click', handleSourceListClick);
      ncSourceListEl.removeEventListener('keydown', handleSourceListKeyDown);
    }
    sourceScrollHandler = null;
    ncSourceFocusButton?.removeEventListener('click', handleFocusClick);
    ncDownloadNormalizedButton?.removeEventListener('click', handleDownloadClick);
    clearSourceSelection();
    clearEditInspector();
    showHoverInspector(null);
  }

  function handleSourceListClick(event) {
    const row = event.target?.closest?.('.nc-source-row');
    if (!row) return;
    const lineNumber = Number(row.dataset.lineNumber);
    if (Number.isInteger(lineNumber)) {
      onSourceLineSelect?.(lineNumber);
    }
  }

  function handleSourceListKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target?.closest?.('.nc-source-row');
    if (!row) return;
    event.preventDefault();
    const lineNumber = Number(row.dataset.lineNumber);
    if (Number.isInteger(lineNumber)) {
      onSourceLineSelect?.(lineNumber);
    }
  }

  function handleFocusClick() {
    onFocusSelectedSegment?.();
  }

  function handleDownloadClick() {
    onDownloadNormalized?.();
  }

  function updateFocusButton(enabled) {
    if (ncSourceFocusButton) {
      ncSourceFocusButton.disabled = !enabled;
    }
  }

  function renderSourceDetail(segment, sourceLine = null) {
    if (!ncSourceDetailEl) return;
    ncSourceDetailEl.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'nc-source-detail-title';
    const lineNumber = segment?.sourceLineNumber ?? sourceLine?.number ?? 'n/a';
    title.textContent = segment
      ? `Line ${lineNumber} · ${segment.motion ?? 'n/a'}`
      : `Line ${lineNumber} · No rendered motion`;
    if (!segment) {
      const source = document.createElement('pre');
      source.className = 'nc-inspector-source';
      source.textContent = sourceLine?.text || '';
      ncSourceDetailEl.append(title, source);
      return;
    }
    const meta = document.createElement('dl');
    meta.className = 'nc-inspector-meta';
    appendInspectorRow(meta, 'From', formatNcPoint(segment.start));
    appendInspectorRow(meta, 'To', formatNcPoint(segment.end));
    appendInspectorRow(meta, 'Feed', formatNullable(segment.feed, ' mm/min'));
    appendInspectorRow(meta, 'Tool', segment.tool == null ? 'n/a' : `T${formatNumber(segment.tool)}`);
    appendInspectorRow(meta, 'Spindle', formatNullable(segment.spindle));
    appendDepthTransition(meta, segment);
    ncSourceDetailEl.append(title, meta);
  }

  function scrollSourceLineIntoView(lineIndex) {
    if (!ncSourceListEl) return;
    const viewportRows = Math.max(1, Math.floor(ncSourceListEl.clientHeight / NC_SOURCE_ROW_HEIGHT_PX));
    const firstVisible = Math.floor(ncSourceListEl.scrollTop / NC_SOURCE_ROW_HEIGHT_PX);
    const lastVisible = firstVisible + viewportRows - 1;
    if (lineIndex < firstVisible) {
      ncSourceListEl.scrollTop = lineIndex * NC_SOURCE_ROW_HEIGHT_PX;
    } else if (lineIndex > lastVisible) {
      ncSourceListEl.scrollTop = Math.max(0, (lineIndex - viewportRows + 1) * NC_SOURCE_ROW_HEIGHT_PX);
    }
  }

  function renderSourceWindow() {
    if (!ncSourceListEl || sourceLines.length === 0) return;
    const viewportRows = Math.max(1, Math.ceil(ncSourceListEl.clientHeight / NC_SOURCE_ROW_HEIGHT_PX));
    const visibleStart = Math.floor(ncSourceListEl.scrollTop / NC_SOURCE_ROW_HEIGHT_PX);
    const first = Math.max(0, visibleStart - NC_SOURCE_OVERSCAN_ROWS);
    const last = Math.min(sourceLines.length - 1, visibleStart + viewportRows + NC_SOURCE_OVERSCAN_ROWS);
    ncSourceListEl.innerHTML = '';
    ncSourceListEl.style.setProperty('--nc-source-total-height', `${sourceLines.length * NC_SOURCE_ROW_HEIGHT_PX}px`);

    const spacer = document.createElement('div');
    spacer.className = 'nc-source-spacer';
    spacer.style.height = `${sourceLines.length * NC_SOURCE_ROW_HEIGHT_PX}px`;
    const windowEl = document.createElement('div');
    windowEl.className = 'nc-source-window';
    windowEl.style.transform = `translateY(${first * NC_SOURCE_ROW_HEIGHT_PX}px)`;

    for (let index = first; index <= last; index += 1) {
      const line = sourceLines[index];
      const row = document.createElement('div');
      row.className = 'nc-source-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === selectedLineIndex));
      row.classList.toggle('is-selected', index === selectedLineIndex);
      row.classList.toggle('is-active-edit', line.lineId === activeLineId);
      const segmentIds = Array.isArray(line.segmentIds) ? line.segmentIds : [];
      row.classList.toggle('has-segment', segmentIds.length > 0);
      row.classList.toggle('no-segment', segmentIds.length === 0);
      row.tabIndex = -1;
      row.dataset.lineIndex = String(line.index);
      row.dataset.lineNumber = String(line.number);
      row.dataset.segmentIds = segmentIds.join(',');
      row.dataset.lineId = line.lineId || '';

      const number = document.createElement('span');
      number.className = 'nc-source-row-number';
      number.textContent = String(line.number);
      const text = document.createElement('code');
      text.className = 'nc-source-row-text';
      text.textContent = line.text || ' ';
      row.append(number, text);
      windowEl.append(row);
    }

    spacer.append(windowEl);
    ncSourceListEl.append(spacer);
  }

  return {
    setNcStatus,
    getNcDimensionsFromUi,
    getNcVisualSettings,
    updateNcOpacityLabel,
    showHoverInspector,
    renderColorLegend,
    setSourceDocument,
    showSourceSelection,
    showSourceLineSelection,
    clearSourceSelection,
    setActiveEditLine,
    setDirtyState,
    clearEditInspector,
    dispose
  };
}

export function formatNcStatus(toolpath, prefix = '') {
  const bbox = toolpath.bbox
    ? `bbox: X ${formatMm(toolpath.bbox.minX)}..${formatMm(toolpath.bbox.maxX)}, Y ${formatMm(toolpath.bbox.minY)}..${formatMm(toolpath.bbox.maxY)}, Z ${formatMm(toolpath.bbox.minZ)}..${formatMm(toolpath.bbox.maxZ)}`
    : 'bbox: n/a';
  const warnings = toolpath.warnings.length > 0
    ? `warnings:\n${toolpath.warnings.slice(0, 8).map((warning) => `- ${warning}`).join('\n')}${toolpath.warnings.length > 8 ? `\n...and ${toolpath.warnings.length - 8} more` : ''}`
    : 'warnings: 0';
  const modal = toolpath.modal
    ? `modal: ${toolpath.modal.units}, ${toolpath.modal.positioning}, ${toolpath.modal.plane}, arc centers ${toolpath.modal.arcCenterMode}`
    : '';
  const lines = [
    prefix,
    `segments: G0=${toolpath.stats.g0}, G1=${toolpath.stats.g1}, G2=${toolpath.stats.g2}, G3=${toolpath.stats.g3}`,
    `skipped=${toolpath.stats.skipped}, rendered points=${toolpath.renderedPoints}`,
    bbox,
    modal,
    warnings
  ].filter(Boolean);

  return lines.join('\n');
}

function renderInspector(container, segment) {
  if (!container) return;
  if (!segment) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  container.hidden = false;
  container.innerHTML = '';

  const line = document.createElement('div');
  line.className = 'nc-inspector-line';
  line.textContent = `Line ${segment.sourceLineNumber ?? 'n/a'}`;

  const source = document.createElement('pre');
  source.className = 'nc-inspector-source';
  source.textContent = segment.sourceText || '';

  const meta = document.createElement('dl');
  meta.className = 'nc-inspector-meta';
  appendInspectorRow(meta, 'Motion', segment.motion);
  appendInspectorRow(meta, 'From', formatNcPoint(segment.start));
  appendInspectorRow(meta, 'To', formatNcPoint(segment.end));
  appendInspectorRow(meta, 'Feed', formatNullable(segment.feed, ' mm/min'));
  appendInspectorRow(meta, 'Tool', segment.tool == null ? 'n/a' : `T${formatNumber(segment.tool)}`);
  appendInspectorRow(meta, 'Spindle', formatNullable(segment.spindle));
  appendDepthTransition(meta, segment);

  container.append(line, source, meta);
}

function formatMm(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function appendInspectorRow(list, label, value) {
  const term = document.createElement('dt');
  term.textContent = `${label}:`;
  const description = document.createElement('dd');
  description.textContent = value ?? 'n/a';
  list.append(term, description);
}

function formatNcPoint(point) {
  if (!point) return 'n/a';
  return `X${formatNumber(point.x)} Y${formatNumber(point.y)} Z${formatNumber(point.z)}`;
}

function formatNullable(value, suffix = '') {
  return value == null ? 'n/a' : `${formatNumber(value)}${suffix}`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : 'n/a';
}

function appendDepthTransition(meta, segment) {
  if (!segment?.start || !segment?.end || segment.start.z === segment.end.z) return;
  appendInspectorRow(meta, 'Z start → end', `${formatNumber(segment.start.z)} → ${formatNumber(segment.end.z)}`);
}

function getSegmentId(segment) { return segment ? (segment.segmentId ?? segment.id ?? null) : null; }
