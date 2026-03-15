import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js';

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
const axesHelper = new THREE.AxesHelper(40);

scene.add(ambientLight);
scene.add(mainDirectionalLight);
scene.add(fillLight);

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
  renderer.toneMappingExposure = 1;
  ambientLight.intensity = 0.95;
  mainDirectionalLight.intensity = 0.7;
  mainDirectionalLight.position.set(140, 160, 120);
  fillLight.intensity = 0.35;
  fillLight.position.set(-120, 90, -80);
  scene.remove(axesHelper);
}

function configureSceneForDebugMode() {
  scene.background = new THREE.Color(0x151515);
  renderer.toneMapping = THREE.NoToneMapping;
  ambientLight.intensity = 0.5;
  mainDirectionalLight.intensity = 0.8;
  mainDirectionalLight.position.set(80, 120, 100);
  fillLight.intensity = 0.2;
  fillLight.position.set(-100, 80, -60);
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

  const upper = new THREE.ExtrudeGeometry(shapeTop, {
    depth: geometry.extrusion.pocketDepth,
    bevelEnabled: false,
    curveSegments: 16
  });
  upper.rotateX(Math.PI);

  const lower = new THREE.ExtrudeGeometry(shapeBottom, {
    depth: geometry.extrusion.baseDepth - geometry.extrusion.pocketDepth,
    bevelEnabled: false,
    curveSegments: 16
  });
  lower.rotateX(Math.PI);
  lower.translate(0, 0, -geometry.extrusion.pocketDepth);

  const merged = mergeGeometries([upper, lower]);
  merged.computeVertexNormals();

  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x5f8f67,
    metalness: 0.02,
    roughness: 0.78
  });
  const baseMesh = new THREE.Mesh(merged, sideMaterial);

  const capGeometry = new THREE.ShapeGeometry(shapeTop, 16);
  capGeometry.rotateX(Math.PI);
  merged.computeBoundingBox();
  capGeometry.computeBoundingBox();

  const topSurfaceZ = merged.boundingBox.max.z;
  const capPlaneZ = capGeometry.boundingBox.max.z;
  const capOffset = Math.max(geometry.extrusion.baseDepth * 0.0002, 0.001);
  capGeometry.translate(0, 0, topSurfaceZ - capPlaneZ + capOffset);
  capGeometry.computeVertexNormals();
  const capMaterial = new THREE.MeshStandardMaterial({
    color: 0x171a18,
    metalness: 0,
    roughness: 0.92,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const capMesh = new THREE.Mesh(capGeometry, capMaterial);

  modelGroup = new THREE.Group();
  modelGroup.rotation.x = -Math.PI / 2;
  modelGroup.add(baseMesh);
  modelGroup.add(capMesh);
  scene.add(modelGroup);

  fitCamera(modelGroup);
}

function contourToShape(outer, holes) {
  const bounds = calcContourBounds(outer);
  const toLocal = (p) => new THREE.Vector2(
    p.x - bounds.minX,
    bounds.maxY - p.y
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
  const dist = maxDim * (isPreviewMode(viewerMode) ? 2.1 : 1.6);

  camera.position.set(center.x + dist, center.y + dist * 0.9, center.z + dist * 0.6);
  camera.near = Math.max(0.1, maxDim / 1000);
  camera.far = Math.max(5000, maxDim * 20);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}
