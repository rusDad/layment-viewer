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
scene.add(grid);

let mesh = null;

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
  errorsEl.textContent = '';
  metaEl.textContent = '';

  const input = document.getElementById('file');
  if (!input.files?.length) {
    errorsEl.textContent = 'Выберите SVG файл.';
    return;
  }

  const fd = new FormData();
  fd.append('file', input.files[0]);

  const res = await fetch('/api/upload-svg', { method: 'POST', body: fd });
  const json = await res.json();

  if (!json.ok) {
    errorsEl.textContent = json.errors.join('\n');
    return;
  }

  metaEl.textContent = `bbox: ${JSON.stringify(json.meta.bbox)}\nouterArea: ${json.meta.outerArea.toFixed(2)}\nholes: ${json.meta.holesCount}`;
  buildModel(json.geometry);
}

function buildModel(geometry) {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
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

  const material = new THREE.MeshStandardMaterial({ color: 0xbebebe, metalness: 0.05, roughness: 0.65 });
  mesh = new THREE.Mesh(merged, material);
  scene.add(mesh);

  fitCamera(mesh);
}

function contourToShape(outer, holes) {
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.y)));
  holes.forEach((h) => {
    const path = new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y)));
    shape.holes.push(path);
  });
  return shape;
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
