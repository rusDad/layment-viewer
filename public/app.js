import { ViewerBase, disposeMaterial } from './core/ViewerBase.js';
import { createViewerScene } from './core/SceneFactory.js';
import { SvgViewer } from './svg3d/SvgViewer.js';
import { StlViewer } from './stl/StlViewer.js';
import { NcPreview } from './nc/NcPreview.js';

const ViewerMode = {
  PREVIEW: 'preview',
  DEBUG: 'debug'
};

const root = document.getElementById('canvas-root');
const errorsEl = document.getElementById('errors');
const metaEl = document.getElementById('meta');
const previewStateEl = document.getElementById('preview-state');
const fileInput = document.getElementById('file');
const uploadButton = document.getElementById('upload');
const stlFileInput = document.getElementById('stl-file');
const stlUploadButton = document.getElementById('stl-upload');
const stlStatusEl = document.getElementById('stl-status');
const stlLinkEl = document.getElementById('stl-link');
const ncFileInput = document.getElementById('nc-file');
const ncPreviewButton = document.getElementById('nc-preview');
const ncStatusEl = document.getElementById('nc-status');
const ncHoverInspectorEl = document.getElementById('nc-hover-inspector');
const ncSourcePanelEl = document.getElementById('nc-source-panel');
const ncSourceListEl = document.getElementById('nc-source-list');
const ncSourceDetailEl = document.getElementById('nc-source-detail');
const ncSourceFocusButton = document.getElementById('nc-source-focus');
const ncWidthInput = document.getElementById('nc-width');
const ncHeightInput = document.getElementById('nc-height');
const ncThicknessInput = document.getElementById('nc-thickness');
const ncOpacityInput = document.getElementById('nc-opacity');
const ncOpacityValueEl = document.getElementById('nc-opacity-value');
const ncColorInputs = {
  G0: document.getElementById('nc-color-g0'),
  G1: document.getElementById('nc-color-g1'),
  G2: document.getElementById('nc-color-g2'),
  G3: document.getElementById('nc-color-g3')
};

const query = parseQuery();
const viewerMode = getViewerMode(query);
applyModeUI(viewerMode);

const threeContext = createViewerScene(root, viewerMode, isPreviewMode);
const viewerBase = new ViewerBase({
  root,
  viewerMode,
  isPreviewMode,
  ...threeContext
});
const { scene, camera, renderer, controls, shadowReceiver } = threeContext;

const state = { modelGroup: null };
let ncPreviewController;

const sharedContext = {
  state,
  scene,
  camera,
  renderer,
  controls,
  shadowReceiver,
  viewerMode,
  isPreviewMode,
  fileInput,
  stlFileInput,
  ncFileInput,
  ncStatusEl,
  ncHoverInspectorEl,
  ncSourcePanelEl,
  ncSourceListEl,
  ncSourceDetailEl,
  ncSourceFocusButton,
  ncWidthInput,
  ncHeightInput,
  ncThicknessInput,
  ncOpacityInput,
  ncOpacityValueEl,
  ncColorInputs,
  setLoadingState,
  setErrorState,
  setSuccessState,
  setStlUploadState,
  setStlUploadLink,
  buildPreviewUrl,
  uploadButton,
  stlUploadButton,
  ncPreviewButton,
  payloadKey: query.payloadKey,
  stlId: query.stl,
  disposeMaterial,
  fitCamera: viewerBase.fitCamera,
  clearNcPreview: () => ncPreviewController?.clearNcPreview()
};

const svgViewer = new SvgViewer(sharedContext);
ncPreviewController = new NcPreview({
  ...sharedContext,
  clearCurrentModel: svgViewer.clearCurrentModel,
  disposeMaterial,
  fitCamera: viewerBase.fitCamera
});
const stlViewer = new StlViewer({
  ...sharedContext,
  clearCurrentModel: svgViewer.clearCurrentModel,
  clearNcPreview: ncPreviewController.clearNcPreview,
  disposeMaterial,
  fitCamera: viewerBase.fitCamera
});

const activeViewers = getActiveViewers({ svgViewer, stlViewer, ncPreviewController }, query, viewerMode);
viewerBase.init();
activeViewers.forEach((viewer) => viewer.init());

window.addEventListener('pagehide', () => {
  activeViewers.forEach((viewer) => viewer.dispose());
  viewerBase.dispose();
}, { once: true });

function getActiveViewers(viewers, parsedQuery, mode) {
  if (!isPreviewMode(mode)) {
    return [viewers.svgViewer, viewers.stlViewer, viewers.ncPreviewController];
  }

  return parsedQuery.stl ? [viewers.stlViewer] : [viewers.svgViewer];
}

function getViewerMode(parsedQuery) {
  const isForcedDebug = parsedQuery.debug === '1';
  if (isForcedDebug) {
    return ViewerMode.DEBUG;
  }

  return parsedQuery.payloadKey || parsedQuery.stl ? ViewerMode.PREVIEW : ViewerMode.DEBUG;
}

function isPreviewMode(mode) {
  return mode === ViewerMode.PREVIEW;
}

function applyModeUI(mode) {
  document.body.classList.remove('viewer-mode-preview', 'viewer-mode-debug');
  document.body.classList.add(`viewer-mode-${mode}`);

  if (isPreviewMode(mode)) {
    setPreviewState('Готовим 3D предпросмотр...');
  } else {
    clearDebugState();
  }
}

function clearSvgDebugState() {
  errorsEl.textContent = '';
  metaEl.textContent = '';
}

function clearDebugState() {
  clearSvgDebugState();
  setStlUploadState('');
  setStlUploadLink('');
  if (ncStatusEl) {
    ncStatusEl.textContent = '';
    ncStatusEl.classList.remove('status-error', 'status-meta');
  }
}

function setPreviewState(message) {
  if (!previewStateEl) {
    return;
  }

  if (!message) {
    previewStateEl.textContent = '';
    previewStateEl.classList.remove('is-visible');
    return;
  }

  previewStateEl.textContent = message;
  previewStateEl.classList.add('is-visible');
}

function setLoadingState(message = 'Готовим 3D предпросмотр...') {
  if (isPreviewMode(viewerMode)) {
    setPreviewState(message);
    return;
  }

  clearSvgDebugState();
  errorsEl.textContent = 'Загрузка...';
}

function setErrorState(message) {
  if (isPreviewMode(viewerMode)) {
    setPreviewState(message);
    return;
  }

  errorsEl.textContent = message;
}

function setSuccessState(metaText) {
  if (isPreviewMode(viewerMode)) {
    setPreviewState('');
    return;
  }

  errorsEl.textContent = '';
  metaEl.textContent = metaText;
}

function setStlUploadState(message, isError = false) {
  if (!stlStatusEl) {
    return;
  }

  stlStatusEl.textContent = message || '';
  stlStatusEl.classList.toggle('status-error', Boolean(message) && isError);
  stlStatusEl.classList.toggle('status-meta', Boolean(message) && !isError);
}

function setStlUploadLink(url) {
  if (!stlLinkEl) {
    return;
  }

  stlLinkEl.innerHTML = '';
  if (!url) {
    return;
  }

  const text = document.createElement('code');
  text.textContent = url;

  const link = document.createElement('a');
  link.href = url;
  link.textContent = 'Открыть preview';

  stlLinkEl.append(text, link);
}

function buildPreviewUrl(relativeUrl) {
  return new URL(relativeUrl, window.location.href).toString();
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    payloadKey: params.get('payloadKey')?.trim() || '',
    stl: params.get('stl')?.trim() || '',
    debug: params.get('debug')?.trim() || ''
  };
}
