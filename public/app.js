import { ViewerBase, disposeMaterial } from './core/ViewerBase.js';
import { createViewerScene } from './core/SceneFactory.js';
import { SvgViewer } from './svg3d/SvgViewer.js';
import { PreviewSceneViewer } from './svg3d/PreviewSceneViewer.js';
import { StlViewer } from './stl/StlViewer.js';
import { ViewerRoute, buildStlPreviewUrlFromUploadId, getViewerMode, getViewerRoute, isPreviewMode, parseViewerQuery } from './routing.js';

const root = document.getElementById('canvas-root');
const errorsEl = document.getElementById('errors');
const metaEl = document.getElementById('meta');
const previewStateEl = document.getElementById('preview-state');
const fileInput = document.getElementById('file');
const uploadButton = document.getElementById('upload');

const query = parseViewerQuery(window.location.search);
const viewerMode = getViewerMode(query);
const viewerRoute = getViewerRoute(query);
applyModeUI(viewerMode);

const threeContext = createViewerScene(root, viewerMode, isPreviewMode);
const viewerBase = new ViewerBase({ root, viewerMode, isPreviewMode, ...threeContext });
const { scene } = threeContext;
const state = { modelGroup: null };

const sharedContext = {
  state,
  ...threeContext,
  viewerMode,
  isPreviewMode,
  fileInput,
  setLoadingState,
  setErrorState,
  setSuccessState,
  buildPreviewUrl,
  uploadButton,
  payloadKey: query.payloadKey,
  allowLegacyPayload: query.debug && Boolean(query.payloadKey),
  stlId: query.stl,
  disposeMaterial,
  fitCamera: viewerBase.fitCamera,
  clearNcPreview: () => {}
};

const isScenePreview = viewerRoute === ViewerRoute.SVG_PREVIEW && !query.debug;
const svgViewer = viewerRoute === ViewerRoute.STL_PREVIEW || isScenePreview ? null : new SvgViewer({
  ...sharedContext,
  clearCurrentModel
});
const stlViewer = viewerRoute === ViewerRoute.STL_PREVIEW ? new StlViewer({
  ...sharedContext,
  clearCurrentModel
}) : null;
const previewSceneViewer = isScenePreview ? new PreviewSceneViewer({ ...sharedContext, clearCurrentModel }) : null;
const activeViewer = stlViewer || previewSceneViewer || svgViewer;

viewerBase.init();
activeViewer?.init();

window.addEventListener('pagehide', () => {
  activeViewer?.dispose();
  viewerBase.dispose();
}, { once: true });

function applyModeUI(mode) {
  document.body.classList.remove('viewer-mode-preview', 'viewer-mode-debug');
  document.body.classList.add(`viewer-mode-${mode}`);
  if (isPreviewMode(mode)) setPreviewState('Готовим 3D предпросмотр...');
  else clearSvgDebugState();
}

function clearSvgDebugState() {
  if (errorsEl) errorsEl.textContent = '';
  if (metaEl) metaEl.textContent = '';
}

function setPreviewState(message) {
  if (!previewStateEl) return;
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
  if (errorsEl) errorsEl.textContent = 'Загрузка...';
}

function setErrorState(message) {
  if (isPreviewMode(viewerMode)) {
    setPreviewState(message);
    return;
  }
  if (errorsEl) errorsEl.textContent = message;
}

function setSuccessState(metaText) {
  if (isPreviewMode(viewerMode)) {
    setPreviewState('');
    return;
  }
  if (errorsEl) errorsEl.textContent = '';
  if (metaEl) metaEl.textContent = metaText;
}

function buildPreviewUrl(_relativeUrl) {
  return buildStlPreviewUrlFromUploadId(query.stl, window.location.href);
}

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
