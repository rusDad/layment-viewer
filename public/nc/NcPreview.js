import { NC_MAX_FILE_BYTES, parseNcToToolpath } from './nc-parser.mjs';
import { createNcScene } from './NcScene.js';
import { createNcUi, formatNcStatus } from './NcUi.js';

export function createNcPreview(ctx) {
  const { viewerMode, isPreviewMode, ncFileInput } = ctx;
  const ncScene = createNcScene(ctx);
  const ncUi = createNcUi(ctx);

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

    ncScene.buildNcPreview(toolpath, dimensions, ncUi.getNcVisualSettings());
    ncUi.setNcStatus(formatNcStatus(toolpath));
  }

  function updateNcVisualSettings() {
    ncUi.updateNcOpacityLabel();
    ncScene.updateVisualSettings(ncUi.getNcVisualSettings());
  }

  return {
    buildNcPreviewFromUi,
    updateNcVisualSettings,
    updateNcOpacityLabel: ncUi.updateNcOpacityLabel,
    clearNcPreview: ncScene.clearNcPreview
  };
}
