import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js';

const ViewerMode = {
  PREVIEW: 'preview',
  DEBUG: 'debug'
};

const TOP_SKIN_THICKNESS_MM = 4;
const TOP_LAYER_COLOR = 0x232826;
const EVA_GREEN_COLOR = 0x6ea978;
const MATERIAL_METALNESS = 0.01;
const TOP_LAYER_ROUGHNESS = 0.9;
const GREEN_LAYER_ROUGHNESS = 0.82;
const PREVIEW_FIT_DISTANCE_FACTOR = 1.68;
const DEBUG_FIT_DISTANCE_FACTOR = 1.6;
const PREVIEW_CAMERA_HEIGHT_FACTOR = 0.95;
const PREVIEW_CAMERA_DEPTH_FACTOR = 0.74;

const root = document.getElementById('canvas-root');
const errorsEl = document.getElementById('errors');
const metaEl = document.getElementById('meta');
const previewStateEl = document.getElementById('preview-state');
const fileInput = document.getElementById('file');
const uploadButton = document.getElementById('upload');

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

let modelGroup = null;

function resize() {
  const w = root.clientWidth;
  const h = root.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

uploadButton.addEventListener('click', uploadSvg);

if (isPreviewMode(viewerMode)) {
  initAutoloadFromPayloadKey(query.payloadKey);
}

async function uploadSvg() {
  if (!fileInput.files?.length) {
    setErrorState('Выберите SVG файл.');
    return;
  }

  await uploadSvgFile(fileInput.files[0], { source: 'manual upload' });
}

function getViewerMode(parsedQuery) {
  const isForcedDebug = parsedQuery.debug === '1';
  if (isForcedDebug) {
    return ViewerMode.DEBUG;
  }

  return parsedQuery.payloadKey ? ViewerMode.PREVIEW : ViewerMode.DEBUG;
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
  mainDirectionalLight.position.set(150, 190, 130);
  mainDirectionalLight.castShadow = true;
  mainDirectionalLight.shadow.mapSize.set(2048, 2048);
  mainDirectionalLight.shadow.radius = 4;
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

function clearDebugState() {
  errorsEl.textContent = '';
  metaEl.textContent = '';
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

  clearDebugState();
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

async function uploadSvgFile(file, options = {}) {
  const source = options.source ?? 'file';
  setLoadingState(isPreviewMode(viewerMode) ? 'Готовим 3D предпросмотр...' : 'Загрузка...');

  const fd = new FormData();
  fd.append('file', file);

  let json;
  try {
    const res = await fetch('/svg3d-api/upload-svg', { method: 'POST', body: fd });
    json = await res.json();
  } catch (err) {
    setErrorState(`Ошибка загрузки SVG: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  renderUploadResponse(json, { source });
}

async function uploadSvgText(svgText, options = {}) {
  const trimmed = typeof svgText === 'string' ? svgText.trim() : '';
  if (!trimmed) {
    setErrorState(isPreviewMode(viewerMode) ? 'SVG для предпросмотра не передан.' : 'SVG payload пустой или некорректный.');
    return;
  }

  const file = new File([trimmed], options.fileName ?? 'payload.svg', { type: 'image/svg+xml' });
  await uploadSvgFile(file, options);
}

function renderUploadResponse(json, options = {}) {
  const source = options.source ?? 'file';

  if (!json?.ok) {
    if (isPreviewMode(viewerMode)) {
      setErrorState('Не удалось построить 3D предпросмотр.');
    } else {
      const errors = Array.isArray(json?.errors) ? json.errors : ['Не удалось обработать SVG.'];
      setErrorState(errors.join('\n'));
    }
    return;
  }

  const sourceLabel = source ? `source: ${source}\n` : '';
  const metaText = `${sourceLabel}bbox: ${JSON.stringify(json.meta.bbox)}\nouterArea: ${json.meta.outerArea.toFixed(2)}\nholes: ${json.meta.holesCount}`;
  setSuccessState(metaText);
  buildModel(json.geometry);
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    payloadKey: params.get('payloadKey')?.trim() || '',
    debug: params.get('debug')?.trim() || ''
  };
}

function extractSvgFromPayload(payloadRaw) {
  if (typeof payloadRaw !== 'string' || !payloadRaw.trim()) {
    return '';
  }

  const trimmed = payloadRaw.trim();
  if (trimmed.startsWith('<svg')) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      const candidates = [
        parsed.svg,
        parsed.svgText,
        parsed.content,
        parsed.payload?.svg,
        parsed.payload?.svgText
      ];
      const svg = candidates.find((value) => typeof value === 'string' && value.trim());
      return svg ? svg.trim() : '';
    }
  } catch {
    return '';
  }

  return '';
}

function loadSvgPayloadFromStorage(payloadKey) {
  const raw = localStorage.getItem(payloadKey);
  if (!raw) {
    throw new Error('SVG для предпросмотра не передан.');
  }

  const svgText = extractSvgFromPayload(raw);
  if (!svgText) {
    throw new Error('SVG payload повреждён или некорректен.');
  }

  return svgText;
}

async function initAutoloadFromPayloadKey(payloadKey) {
  if (!payloadKey) {
    setErrorState('SVG для предпросмотра не передан.');
    return;
  }

  let svgText = '';
  try {
    svgText = loadSvgPayloadFromStorage(payloadKey);
  } catch (err) {
    setErrorState(err instanceof Error ? err.message : 'Не удалось построить 3D предпросмотр.');
    localStorage.removeItem(payloadKey);
    return;
  }

  await uploadSvgText(svgText, { source: `external payload (${payloadKey})`, fileName: `${payloadKey}.svg` });
  localStorage.removeItem(payloadKey);
}

function buildModel(geometry) {
  if (modelGroup) {
    scene.remove(modelGroup);
    modelGroup.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }

  const shapeTop = contourToShape(geometry.outer, geometry.holes);
  const shapeBottom = contourToShape(geometry.outer, []);

  const pocketDepth = Math.max(0, Math.min(geometry.extrusion.pocketDepth, geometry.extrusion.baseDepth));
  const topSkinDepth = Math.min(TOP_SKIN_THICKNESS_MM, pocketDepth);
  const greenPocketDepth = Math.max(pocketDepth - topSkinDepth, 0);
  const baseDepth = Math.max(geometry.extrusion.baseDepth - pocketDepth, 0);
  const hasTopLayer = topSkinDepth > 0.0001;
  const hasGreenPocketLayer = greenPocketDepth > 0.0001;
  const hasGreenBaseLayer = baseDepth > 0.0001;

  const greenGeometries = [];

  if (hasGreenPocketLayer) {
    const midLayer = new THREE.ExtrudeGeometry(shapeTop, {
      depth: greenPocketDepth,
      bevelEnabled: false,
      curveSegments: 16
    });
    midLayer.rotateX(Math.PI);
    midLayer.translate(0, 0, -topSkinDepth);
    greenGeometries.push(midLayer);
  }

  if (hasGreenBaseLayer) {
    const lower = new THREE.ExtrudeGeometry(shapeBottom, {
      depth: baseDepth,
      bevelEnabled: false,
      curveSegments: 16
    });
    lower.rotateX(Math.PI);
    lower.translate(0, 0, -pocketDepth);
    greenGeometries.push(lower);
  }

  const topLayer = hasTopLayer
    ? new THREE.ExtrudeGeometry(shapeTop, {
      depth: topSkinDepth,
      bevelEnabled: false,
      curveSegments: 16
    })
    : null;

  if (topLayer) {
    topLayer.rotateX(Math.PI);
    topLayer.computeVertexNormals();
  }

  const mergedGreen = greenGeometries.length > 1 ? mergeGeometries(greenGeometries) : greenGeometries[0] || null;
  if (mergedGreen) {
    mergedGreen.computeVertexNormals();
  }

  const greenMaterial = new THREE.MeshStandardMaterial({
    color: EVA_GREEN_COLOR,
    metalness: MATERIAL_METALNESS,
    roughness: GREEN_LAYER_ROUGHNESS
  });
  const topMaterial = new THREE.MeshStandardMaterial({
    color: TOP_LAYER_COLOR,
    metalness: MATERIAL_METALNESS,
    roughness: TOP_LAYER_ROUGHNESS
  });

  modelGroup = new THREE.Group();
  modelGroup.rotation.x = -Math.PI / 2;

  if (mergedGreen) {
    const greenMesh = new THREE.Mesh(mergedGreen, greenMaterial);
    greenMesh.castShadow = isPreviewMode(viewerMode);
    greenMesh.receiveShadow = isPreviewMode(viewerMode);
    modelGroup.add(greenMesh);
  }

  if (topLayer) {
    const topMesh = new THREE.Mesh(topLayer, topMaterial);
    topMesh.castShadow = isPreviewMode(viewerMode);
    topMesh.receiveShadow = isPreviewMode(viewerMode);
    modelGroup.add(topMesh);
  }

  scene.add(modelGroup);

  fitCamera(modelGroup);
}

function contourToShape(outer, holes) {
  const bounds = calcContourBounds(outer);
  const toLocal = (p) => new THREE.Vector2(
    p.x - bounds.minX,
     p.y - bounds.maxY
  );

  const shape = new THREE.Shape(outer.map(toLocal));
  holes.forEach((h) => {
    const path = new THREE.Path(h.map(toLocal));
    shape.holes.push(path);
  });
  return shape;
}

function calcContourBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach((p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });

  return { minX, minY, maxX, maxY };
}

function fitCamera(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const preview = isPreviewMode(viewerMode);
  const dist = maxDim * (preview ? PREVIEW_FIT_DISTANCE_FACTOR : DEBUG_FIT_DISTANCE_FACTOR);

  if (preview) {
    const shadowSize = Math.max(size.x, size.z) * 1.8;
    shadowReceiver.scale.set(shadowSize, shadowSize, 1);
    shadowReceiver.position.set(center.x, box.min.y - 0.5, center.z);

    const shadowCamExtent = Math.max(size.x, size.y, size.z) * 0.9;
    mainDirectionalLight.shadow.camera.left = -shadowCamExtent;
    mainDirectionalLight.shadow.camera.right = shadowCamExtent;
    mainDirectionalLight.shadow.camera.top = shadowCamExtent;
    mainDirectionalLight.shadow.camera.bottom = -shadowCamExtent;
    mainDirectionalLight.shadow.camera.near = 1;
    mainDirectionalLight.shadow.camera.far = Math.max(1500, maxDim * 10);
    mainDirectionalLight.shadow.camera.updateProjectionMatrix();
    mainDirectionalLight.target.position.copy(center);
  }

  camera.position.set(
    center.x + dist,
    center.y + dist * (preview ? PREVIEW_CAMERA_HEIGHT_FACTOR : 0.9),
    center.z + dist * (preview ? PREVIEW_CAMERA_DEPTH_FACTOR : 0.6)
  );
  camera.near = Math.max(0.1, maxDim / 1000);
  camera.far = Math.max(5000, maxDim * 20);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}
