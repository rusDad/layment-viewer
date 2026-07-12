import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSvg3dController } from './svg3d/SvgViewer.js';
import { createStlViewer } from './stl/StlViewer.js';
import { createNcPreview } from './nc/NcPreview.js';

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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
camera.position.set(120, 120, 120);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
root.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
const mainDirectionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
mainDirectionalLight.position.set(80, 120, 100);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.2);
fillLight.position.set(-100, 80, -60);
const rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
rimLight.position.set(-140, 140, 160);
const shadowReceiver = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShadowMaterial({ opacity: 0.18 })
);
shadowReceiver.rotation.x = -Math.PI / 2;
shadowReceiver.receiveShadow = true;
shadowReceiver.visible = false;
const axesHelper = new THREE.AxesHelper(40);

scene.add(ambientLight);
scene.add(mainDirectionalLight);
scene.add(mainDirectionalLight.target);
scene.add(fillLight);
scene.add(rimLight);
scene.add(shadowReceiver);

configureSceneForMode(viewerMode);

const state = { modelGroup: null };
let ncPreviewController;

const sharedContext = {
  state,
  scene,
  camera,
  controls,
  shadowReceiver,
  viewerMode,
  isPreviewMode,
  fileInput,
  stlFileInput,
  ncFileInput,
  ncStatusEl,
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
  clearNcPreview: () => ncPreviewController?.clearNcPreview()
};

const svg3dController = createSvg3dController(sharedContext);
ncPreviewController = createNcPreview({
  ...sharedContext,
  clearCurrentModel: svg3dController.clearCurrentModel,
  disposeMaterial: svg3dController.disposeMaterial,
  fitCamera: svg3dController.fitCamera
});
const stlViewer = createStlViewer({
  ...sharedContext,
  clearCurrentModel: svg3dController.clearCurrentModel,
  clearNcPreview: ncPreviewController.clearNcPreview,
  disposeMaterial: svg3dController.disposeMaterial,
  fitCamera: svg3dController.fitCamera
});

window.addEventListener('resize', resize);
resize();
animate();

uploadButton.addEventListener('click', svg3dController.uploadSvg);
stlUploadButton?.addEventListener('click', stlViewer.uploadStl);
ncPreviewButton?.addEventListener('click', ncPreviewController.buildNcPreviewFromUi);
ncOpacityInput?.addEventListener('input', ncPreviewController.updateNcVisualSettings);
Object.values(ncColorInputs).forEach((input) => input?.addEventListener('input', ncPreviewController.updateNcVisualSettings));
ncPreviewController.updateNcOpacityLabel();

if (isPreviewMode(viewerMode)) {
  if (query.stl) {
    stlViewer.initAutoloadFromStlId(query.stl);
  } else {
    svg3dController.initAutoloadFromPayloadKey(query.payloadKey);
  }
}

function resize() {
  const w = root.clientWidth;
  const h = root.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
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

function configureSceneForMode(mode) {
  if (isPreviewMode(mode)) {
    configureSceneForPreviewMode();
    return;
  }

  configureSceneForDebugMode();
}

function configureSceneForPreviewMode() {
  scene.background = new THREE.Color(0xf1f3f5);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  ambientLight.intensity = 0.52;
  mainDirectionalLight.intensity = 0.95;
  mainDirectionalLight.position.set(-60, 320, 0);
  mainDirectionalLight.castShadow = true;
  mainDirectionalLight.shadow.mapSize.set(2048, 2048);
  mainDirectionalLight.shadow.radius = 6;
  mainDirectionalLight.shadow.bias = -0.0002;

  fillLight.intensity = 0.3;
  fillLight.position.set(-160, 100, -100);
  fillLight.castShadow = false;

  rimLight.intensity = 0.45;
  rimLight.position.set(-120, 170, 210);
  rimLight.castShadow = false;

  shadowReceiver.visible = true;
  scene.remove(axesHelper);
}

function configureSceneForDebugMode() {
  scene.background = new THREE.Color(0x151515);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  ambientLight.intensity = 0.5;
  mainDirectionalLight.intensity = 0.8;
  mainDirectionalLight.position.set(80, 120, 100);
  mainDirectionalLight.castShadow = false;
  fillLight.intensity = 0.2;
  fillLight.position.set(-100, 80, -60);
  rimLight.intensity = 0.25;
  rimLight.position.set(-140, 140, 160);
  shadowReceiver.visible = false;
  scene.add(axesHelper);
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
