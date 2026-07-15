import { ViewerBase, disposeMaterial } from '../core/ViewerBase.js';
import { createViewerScene } from '../core/SceneFactory.js';
import { NcPreview } from './NcPreview.js';
import { ViewerMode, isPreviewMode } from '../routing.js';

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
