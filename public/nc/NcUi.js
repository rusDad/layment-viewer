import { NC_DEFAULT_COLORS } from './NcScene.js';

export function createNcUi(ctx) {
  const { ncStatusEl, ncHoverInspectorEl, ncWidthInput, ncHeightInput, ncThicknessInput, ncOpacityInput, ncOpacityValueEl, ncColorInputs } = ctx;

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
    if (!ncHoverInspectorEl) return;
    if (!segment) {
      ncHoverInspectorEl.hidden = true;
      ncHoverInspectorEl.innerHTML = '';
      return;
    }

    ncHoverInspectorEl.hidden = false;
    ncHoverInspectorEl.innerHTML = '';

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

    ncHoverInspectorEl.append(line, source, meta);
  }

  return { setNcStatus, getNcDimensionsFromUi, getNcVisualSettings, updateNcOpacityLabel, showHoverInspector };
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
