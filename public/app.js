import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js';

const root = document.getElementById('canvas-root');
const errorsEl = document.getElementById('errors');
const metaEl = document.getElementById('meta');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x151515);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
camera.position.set(120, 120, 120);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
root.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AxesHelper(40));
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(80, 120, 100);
scene.add(dir);

const grid = new THREE.GridHelper(300, 30, 0x444444, 0x2b2b2b);
//scene.add(grid);

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

document.getElementById('upload').addEventListener('click', uploadSvg);

async function uploadSvg() {
  const input = document.getElementById('file');
  if (!input.files?.length) {
    errorsEl.textContent = 'Выберите SVG файл.';
    return;
  }

  await uploadSvgFile(input.files[0], { source: 'manual upload' });
}

function clearStatus() {
  errorsEl.textContent = '';
  metaEl.textContent = '';
}

async function uploadSvgFile(file, options = {}) {
  const source = options.source ?? 'file';
  clearStatus();

  const fd = new FormData();
  fd.append('file', file);

  let json;
  try {
    const res = await fetch('/svg3d-api/upload-svg', { method: 'POST', body: fd });
    json = await res.json();
  } catch (err) {
    errorsEl.textContent = `Ошибка загрузки SVG: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  renderUploadResponse(json, { source });
}

async function uploadSvgText(svgText, options = {}) {
  const trimmed = typeof svgText === 'string' ? svgText.trim() : '';
  if (!trimmed) {
    errorsEl.textContent = 'SVG payload пустой или некорректный.';
    return;
  }

  const file = new File([trimmed], options.fileName ?? 'payload.svg', { type: 'image/svg+xml' });
  await uploadSvgFile(file, options);
}

function renderUploadResponse(json, options = {}) {
  const source = options.source ?? 'file';

  if (!json?.ok) {
    const errors = Array.isArray(json?.errors) ? json.errors : ['Не удалось обработать SVG.'];
    errorsEl.textContent = errors.join('\n');
    return;
  }

  const sourceLabel = source ? `source: ${source}\n` : '';
  metaEl.textContent = `${sourceLabel}bbox: ${JSON.stringify(json.meta.bbox)}\nouterArea: ${json.meta.outerArea.toFixed(2)}\nholes: ${json.meta.holesCount}`;
  buildModel(json.geometry);
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return { payloadKey: params.get('payloadKey')?.trim() || '' };
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
    throw new Error(`Payload with key "${payloadKey}" не найден в localStorage.`);
  }

  const svgText = extractSvgFromPayload(raw);
  if (!svgText) {
    throw new Error(`Payload "${payloadKey}" не содержит валидный SVG.`);
  }

  return svgText;
}

async function initAutoloadFromPayloadKey() {
  const { payloadKey } = parseQuery();
  if (!payloadKey) {
    return;
  }

  let svgText = '';
  try {
    svgText = loadSvgPayloadFromStorage(payloadKey);
  } catch (err) {
    clearStatus();
    errorsEl.textContent = err instanceof Error ? err.message : String(err);
    localStorage.removeItem(payloadKey);
    return;
  }

  await uploadSvgText(svgText, { source: `external payload (${payloadKey})`, fileName: `${payloadKey}.svg` });
  localStorage.removeItem(payloadKey);
}
initAutoloadFromPayloadKey();

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

  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x5f8f67, metalness: 0.05, roughness: 0.65 });
  const baseMesh = new THREE.Mesh(merged, baseMaterial);

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
    color: 0x9a9a9a,
    metalness: 0.05,
    roughness: 0.75,
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
  const dist = maxDim * 1.6;

  camera.position.set(center.x + dist, center.y + dist, center.z + dist);
  camera.near = Math.max(0.1, maxDim / 1000);
  camera.far = Math.max(5000, maxDim * 20);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}
