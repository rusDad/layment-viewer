import { ViewerBase, disposeMaterial } from '../core/ViewerBase.js';
import { createViewerScene } from '../core/SceneFactory.js';
import { NcPreview } from './NcPreview.js';
import { ViewerMode, isPreviewMode } from '../routing.js';
import { NC_MAX_FILE_BYTES } from './nc-parser.mjs';
import { parseNcQuery } from './NcQuery.mjs';

const viewerMode = ViewerMode.DEBUG;
const root = document.getElementById('canvas-root');
const threeContext = createViewerScene(root, viewerMode, isPreviewMode);
const viewerBase = new ViewerBase({ root, viewerMode, isPreviewMode, ...threeContext });
const { scene, camera, renderer, controls, shadowReceiver } = threeContext;
const state = { modelGroup: null };

const ncPreviewController = new NcPreview({
  state,
  scene,
  camera,
  renderer,
  controls,
  shadowReceiver,
  viewerMode,
  isPreviewMode,
  ncFileInput: document.getElementById('nc-file'),
  ncStatusEl: document.getElementById('nc-status'),
  ncDocumentNameEl: document.getElementById('nc-document-name'),
  ncHoverInspectorEl: document.getElementById('nc-hover-inspector'),
  ncSourcePanelEl: document.getElementById('nc-source-panel'),
  ncSourceListEl: document.getElementById('nc-source-list'),
  ncSourceFocusButton: document.getElementById('nc-source-focus'),
  ncEditInspectorEl: document.getElementById('nc-edit-inspector'),
  ncQueryPanelEl: document.getElementById('nc-query-panel'),
  ncDownloadNormalizedButton: document.getElementById('nc-download-normalized'),
  ncDeleteSelectedButton: document.getElementById('nc-delete-selected'),
  ncUndoButton: document.getElementById('nc-undo'),
  ncRedoButton: document.getElementById('nc-redo'),
  ncResetInitialButton: document.getElementById('nc-reset-initial'),
  ncPreviousOverlayToggle: document.getElementById('nc-previous-overlay'),
  ncWidthInput: document.getElementById('nc-width'),
  ncHeightInput: document.getElementById('nc-height'),
  ncThicknessInput: document.getElementById('nc-thickness'),
  ncOpacityInput: document.getElementById('nc-opacity'),
  ncOpacityValueEl: document.getElementById('nc-opacity-value'),
  ncColorStrategySelect: document.getElementById('nc-color-strategy'),
  ncColorLegendEl: document.getElementById('nc-color-legend'),
  ncColorInputs: {
    G0: document.getElementById('nc-color-g0'),
    G1: document.getElementById('nc-color-g1'),
    G2: document.getElementById('nc-color-g2'),
    G3: document.getElementById('nc-color-g3')
  },
  ncPreviewButton: document.getElementById('nc-preview'),
  clearCurrentModel,
  disposeMaterial,
  fitCamera: viewerBase.fitCamera
});

viewerBase.init();
ncPreviewController.init();
initResponsivePanes();
updateDocumentName();
openNcDocumentFromQuery();

document.getElementById('nc-file')?.addEventListener('change', updateDocumentName);

window.addEventListener('pagehide', () => {
  ncPreviewController.dispose();
  viewerBase.dispose();
}, { once: true });

function clearCurrentModel() {
  if (!state.modelGroup) return;
  scene.remove(state.modelGroup);
  state.modelGroup.traverse((obj) => {
    if (obj.isMesh || obj.isLine || obj.isLineSegments) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
      else if (obj.material) disposeMaterial(obj.material);
    }
  });
  state.modelGroup = null;
}

function updateDocumentName() {
  const file = document.getElementById('nc-file')?.files?.[0];
  const nameEl = document.getElementById('nc-document-name');
  if (nameEl) nameEl.textContent = file ? file.name : 'Новый документ';
}

async function openNcDocumentFromQuery() {
  const params = new URLSearchParams(window.location.search);
  for (const [name, id] of [['width', 'nc-width'], ['height', 'nc-height'], ['thickness', 'nc-thickness']]) {
    if (params.has(name)) document.getElementById(id).value = params.get(name);
  }
  const query = parseNcQuery(params, window.location.href);
  if (query.mode === 'manual') return;
  if (!query.ok) { ncPreviewController.setNcStatus(query.error, true); return; }

  ncPreviewController.setNcStatus(`Загрузка ${query.filename}…`);
  try {
    const response = await fetch(query.url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Не удалось загрузить NC: HTTP ${response.status}.`);
    const contentLength = response.headers.get('Content-Length');
    if (contentLength !== null && Number(contentLength) > NC_MAX_FILE_BYTES) throw fileTooLargeError();
    const blob = await response.blob();
    if (blob.size > NC_MAX_FILE_BYTES) throw fileTooLargeError();
    const text = await blob.text();
    if (new TextEncoder().encode(text).byteLength > NC_MAX_FILE_BYTES) throw fileTooLargeError();
    await ncPreviewController.openNcDocument({ text, filename: query.filename, dimensions: query.dimensions });
  } catch (err) {
    ncPreviewController.clearNcPreview();
    ncPreviewController.setNcStatus(err instanceof Error ? err.message : String(err), true);
  }
}

function fileTooLargeError() {
  return new Error(`Файл слишком большой: максимум ${Math.round(NC_MAX_FILE_BYTES / 1024 / 1024)} MB.`);
}

function initResponsivePanes() {
  const tabs = [...document.querySelectorAll('[data-nc-pane]')];
  const panes = [...document.querySelectorAll('[data-nc-pane-content]')];

  const activate = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.ncPane === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    panes.forEach((pane) => pane.classList.toggle('is-active-pane', pane.dataset.ncPaneContent === name));
    if (name === 'preview') requestAnimationFrame(() => viewerBase.resize());
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => activate(tab.dataset.ncPane)));
  activate('preview');
}
