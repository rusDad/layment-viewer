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
const EVA_BLUE_COLOR = 0x5f7892;
const MATERIAL_METALNESS = 0.01;
const TOP_LAYER_ROUGHNESS = 0.9;
const GREEN_LAYER_ROUGHNESS = 0.82;
const PREVIEW_FIT_DISTANCE_FACTOR = 1.68;
const DEBUG_FIT_DISTANCE_FACTOR = 1.6;
const PREVIEW_CAMERA_HEIGHT_FACTOR = 0.95;
const PREVIEW_CAMERA_DEPTH_FACTOR = 0.74;
const DEFAULT_BASE_MATERIAL_COLOR = 'green';
const DEFAULT_LAYMENT_THICKNESS_MM = 35;
const TEXT_OVERLAY_COLOR = '#d9dfda';
const TEXT_OVERLAY_Z_OFFSET_MM = 0.12;
const TEXT_CANVAS_PIXELS_PER_MM = 24;
const TEXT_CANVAS_PADDING_MM = 1.2;
const MIN_TEXT_FONT_SIZE_MM = 0.5;

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

  renderUploadResponse(json, {
    ...options,
    source
  });
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
  const visualSettings = getVisualSettings(options.visualSettings);
  const geometry = applyGeometryVisualOverrides(json.geometry, visualSettings);
  buildModel(geometry, visualSettings, Array.isArray(options.texts) ? options.texts : []);
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    payloadKey: params.get('payloadKey')?.trim() || '',
    debug: params.get('debug')?.trim() || ''
  };
}

function extractPreviewPayload(payloadRaw) {
  const fallback = {
    svg: '',
    baseMaterialColor: DEFAULT_BASE_MATERIAL_COLOR,
    laymentThicknessMm: DEFAULT_LAYMENT_THICKNESS_MM,
    texts: []
  };

  if (typeof payloadRaw !== 'string' || !payloadRaw.trim()) {
    return fallback;
  }

  const trimmed = payloadRaw.trim();
  if (trimmed.startsWith('<svg')) {
    return { ...fallback, svg: trimmed };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return { ...fallback, svg: parsed.trim() };
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

      const metadata = parsed.metadata && typeof parsed.metadata === 'object'
        ? parsed.metadata
        : parsed.payload?.metadata;

      return {
        svg: svg ? svg.trim() : '',
        baseMaterialColor: normalizeBaseMaterialColor(parsed.baseMaterialColor ?? metadata?.baseMaterialColor),
        laymentThicknessMm: normalizeLaymentThicknessMm(parsed.laymentThicknessMm ?? metadata?.laymentThicknessMm),
        texts: Array.isArray(parsed.parsed?.texts) ? parsed.parsed.texts : []
      };
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function loadSvgPayloadFromStorage(payloadKey) {
  const raw = localStorage.getItem(payloadKey);
  if (!raw) {
    throw new Error('SVG для предпросмотра не передан.');
  }

  const payload = extractPreviewPayload(raw);
  if (!payload.svg) {
    throw new Error('SVG payload повреждён или некорректен.');
  }

  return payload;
}

async function initAutoloadFromPayloadKey(payloadKey) {
  if (!payloadKey) {
    setErrorState('SVG для предпросмотра не передан.');
    return;
  }

  let payload;
  try {
    payload = loadSvgPayloadFromStorage(payloadKey);
  } catch (err) {
    setErrorState(err instanceof Error ? err.message : 'Не удалось построить 3D предпросмотр.');
    localStorage.removeItem(payloadKey);
    return;
  }

  await uploadSvgText(payload.svg, {
    source: `external payload (${payloadKey})`,
    fileName: `${payloadKey}.svg`,
    visualSettings: {
      baseMaterialColor: payload.baseMaterialColor,
      laymentThicknessMm: payload.laymentThicknessMm
    },
    texts: payload.texts
  });
  localStorage.removeItem(payloadKey);
}

function buildModel(geometry, visualSettings = {}, texts = []) {
  if (modelGroup) {
    scene.remove(modelGroup);
    modelGroup.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.geometry) {
          obj.geometry.dispose();
        }

        if (Array.isArray(obj.material)) {
          obj.material.forEach(disposeMaterial);
        } else if (obj.material) {
          disposeMaterial(obj.material);
        }
      }
    });
  }

  const topRegions = getTopRegions(geometry);
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
    const greenPocketGeometries = topRegions.map((region) => {
      const topShape = contourToShape(region.outer, region.holes || []);
      const geom = new THREE.ExtrudeGeometry(topShape, {
        depth: greenPocketDepth,
        bevelEnabled: false,
        curveSegments: 16
      });
      geom.rotateX(Math.PI);
      geom.translate(0, 0, -topSkinDepth);
      return geom;
    });

    const mergedPocket = greenPocketGeometries.length > 1
      ? mergeGeometries(greenPocketGeometries)
      : greenPocketGeometries[0] || null;

    if (mergedPocket) {
      greenGeometries.push(mergedPocket);
    }
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

  const topLayerGeometries = hasTopLayer
    ? topRegions.map((region) => {
      const topShape = contourToShape(region.outer, region.holes || []);
      const geom = new THREE.ExtrudeGeometry(topShape, {
        depth: topSkinDepth,
        bevelEnabled: false,
        curveSegments: 16
      });
      geom.rotateX(Math.PI);
      geom.computeVertexNormals();
      return geom;
    })
    : [];

  const topLayer = topLayerGeometries.length > 1
    ? mergeGeometries(topLayerGeometries)
    : topLayerGeometries[0] || null;

  if (topLayer) {
    topLayer.computeVertexNormals();
  }

  const mergedGreen = greenGeometries.length > 1 ? mergeGeometries(greenGeometries) : greenGeometries[0] || null;
  if (mergedGreen) {
    mergedGreen.computeVertexNormals();
  }

  const greenMaterial = new THREE.MeshStandardMaterial({
    color: getBaseMaterialColorHex(visualSettings.baseMaterialColor),
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

  const textOverlayGroup = buildTextOverlayGroup(geometry, texts);
  if (textOverlayGroup) {
    modelGroup.add(textOverlayGroup);
  }

  scene.add(modelGroup);

  fitCamera(modelGroup);
}


function disposeMaterial(material) {
  if (!material || typeof material !== 'object') {
    return;
  }

  Object.values(material).forEach((value) => {
    if (value && value.isTexture) {
      value.dispose();
    }
  });

  material.dispose();
}

function buildTextOverlayGroup(geometry, texts = []) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return null;
  }

  const outerBounds = calcContourBounds(geometry.outer || []);
  const outerWidthMm = outerBounds.maxX - outerBounds.minX;
  const outerHeightMm = outerBounds.maxY - outerBounds.minY;
  if (!Number.isFinite(outerWidthMm) || !Number.isFinite(outerHeightMm) || outerWidthMm <= 0 || outerHeightMm <= 0) {
    return null;
  }

  const group = new THREE.Group();

  texts.forEach((item) => {
    const overlayMesh = createTextOverlayMesh(item, outerWidthMm, outerHeightMm);
    if (overlayMesh) {
      group.add(overlayMesh);
    }
  });

  return group.children.length > 0 ? group : null;
}

function createTextOverlayMesh(textItem, outerWidthMm, outerHeightMm) {
  try {
    if (!textItem || typeof textItem !== 'object') {
      return null;
    }

    const text = typeof textItem.text === 'string' ? textItem.text.trim() : '';
    if (!text) {
      return null;
    }

    const xMm = Number(textItem.x);
    const yMm = Number(textItem.y);
    const fontSizeMm = Number(textItem.fontSizeMm);
    const angleDeg = Number(textItem.angle ?? 0);

    if (!Number.isFinite(xMm) || !Number.isFinite(yMm) || !Number.isFinite(fontSizeMm) || fontSizeMm < MIN_TEXT_FONT_SIZE_MM) {
      return null;
    }

    if (xMm < 0 || yMm < 0 || xMm > outerWidthMm || yMm > outerHeightMm) {
      return null;
    }

    const texturePayload = createTextCanvasTexture(text, fontSizeMm, textItem.kind);
    if (!texturePayload) {
      return null;
    }

    const plane = new THREE.PlaneGeometry(texturePayload.widthMm, texturePayload.heightMm);
    const material = new THREE.MeshBasicMaterial({
      map: texturePayload.texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(plane, material);

    mesh.position.set(
      xMm + texturePayload.widthMm / 2,
      yMm - outerHeightMm + texturePayload.heightMm / 2,
      TEXT_OVERLAY_Z_OFFSET_MM
    );
    mesh.rotation.z = Number.isFinite(angleDeg) ? THREE.MathUtils.degToRad(angleDeg) : 0;
    mesh.renderOrder = 1;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    return mesh;
  } catch {
    return null;
  }
}

function createTextCanvasTexture(text, fontSizeMm, kind = '') {
  const pixelsPerMm = TEXT_CANVAS_PIXELS_PER_MM;
  const fontPx = Math.max(Math.round(fontSizeMm * pixelsPerMm), 12);
  const paddingPx = Math.max(Math.round(TEXT_CANVAS_PADDING_MM * pixelsPerMm), 8);
  const fontWeight = kind === 'label' ? 600 : 500;
  const fontFamily = 'Inter, Arial, sans-serif';
  const font = `${fontWeight} ${fontPx}px ${fontFamily}`;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.font = font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const metrics = context.measureText(text);
  const textWidthPx = metrics.width;
  const ascentPx = metrics.actualBoundingBoxAscent || fontPx * 0.8;
  const descentPx = metrics.actualBoundingBoxDescent || fontPx * 0.22;
  const textHeightPx = ascentPx + descentPx;

  const canvasWidthPx = Math.ceil(textWidthPx + paddingPx * 2);
  const canvasHeightPx = Math.ceil(textHeightPx + paddingPx * 2);
  if (!Number.isFinite(canvasWidthPx) || !Number.isFinite(canvasHeightPx) || canvasWidthPx <= 0 || canvasHeightPx <= 0) {
    return null;
  }

  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;

  context.font = font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = TEXT_OVERLAY_COLOR;
  context.fillText(text, paddingPx, paddingPx + ascentPx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const widthMm = canvasWidthPx / pixelsPerMm;
  const heightMm = canvasHeightPx / pixelsPerMm;
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    texture.dispose();
    return null;
  }

  return { texture, widthMm, heightMm };
}

function getVisualSettings(rawSettings = {}) {
  return {
    baseMaterialColor: normalizeBaseMaterialColor(rawSettings.baseMaterialColor),
    laymentThicknessMm: normalizeLaymentThicknessMm(rawSettings.laymentThicknessMm)
  };
}

function applyGeometryVisualOverrides(geometry, visualSettings) {
  if (!geometry || typeof geometry !== 'object') {
    return geometry;
  }

  const extrusion = geometry.extrusion && typeof geometry.extrusion === 'object'
    ? geometry.extrusion
    : {};

  return {
    ...geometry,
    extrusion: {
      ...extrusion,
      baseDepth: visualSettings.laymentThicknessMm
    }
  };
}

function normalizeBaseMaterialColor(rawColor) {
  return rawColor === 'blue' ? 'blue' : DEFAULT_BASE_MATERIAL_COLOR;
}

function normalizeLaymentThicknessMm(rawThickness) {
  const thickness = Number(rawThickness);
  return thickness === 65 ? 65 : DEFAULT_LAYMENT_THICKNESS_MM;
}

function getBaseMaterialColorHex(colorName) {
  return colorName === 'blue' ? EVA_BLUE_COLOR : EVA_GREEN_COLOR;
}


function getTopRegions(geometry) {
  if (Array.isArray(geometry.topRegions) && geometry.topRegions.length > 0) {
    return geometry.topRegions;
  }

  return [{ outer: geometry.outer, holes: geometry.holes || [] }];
}

function contourToShape(outer, holes) {
  const bounds = calcContourBounds(outer);
  const toLocal = (p) => new THREE.Vector2(
    p.x - bounds.minX,
    p.y - bounds.maxY
  );

  const shape = buildClosedShape(outer, toLocal);
  holes.forEach((ring) => {
    const path = buildClosedPath(ring, toLocal);
    if (path) {
      shape.holes.push(path);
    }
  });

  return shape;
}

function buildClosedShape(points, toLocal) {
  const normalizedPoints = getValidRingPoints(points);
  if (!normalizedPoints) {
    throw new Error('Некорректный внешний контур: минимум 3 уникальные точки.');
  }

  const shape = new THREE.Shape();
  appendClosedRing(shape, normalizedPoints, toLocal);
  shape.autoClose = true;
  return shape;
}

function buildClosedPath(points, toLocal) {
  const normalizedPoints = getValidRingPoints(points);
  if (!normalizedPoints) {
    return null;
  }

  const path = new THREE.Path();
  appendClosedRing(path, normalizedPoints, toLocal);
  path.autoClose = true;
  return path;
}

function appendClosedRing(target, points, toLocal) {
  const first = toLocal(points[0]);
  target.moveTo(first.x, first.y);

  for (let i = 1; i < points.length; i += 1) {
    const local = toLocal(points[i]);
    target.lineTo(local.x, local.y);
  }

  target.closePath();
}

function getValidRingPoints(points) {
  const normalizedPoints = stripClosingDuplicate(points);
  if (countUniquePoints(normalizedPoints) < 3) {
    return null;
  }

  return normalizedPoints;
}

function stripClosingDuplicate(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return Array.isArray(points) ? points.slice() : [];
  }

  const normalizedPoints = points.slice();
  const first = normalizedPoints[0];
  const last = normalizedPoints[normalizedPoints.length - 1];
  if (isSamePoint(first, last)) {
    normalizedPoints.pop();
  }

  return normalizedPoints;
}

function countUniquePoints(points) {
  const unique = new Set(points.map((point) => `${point.x}:${point.y}`));
  return unique.size;
}

function isSamePoint(a, b) {
  return a.x === b.x && a.y === b.y;
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
