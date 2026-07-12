import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';


export class StlViewer {
  constructor(ctx) {
    this.ctx = ctx;
    this.viewer = createStlViewer(ctx);
    this.uploadStl = this.viewer.uploadStl;
    this.initAutoloadFromStlId = this.viewer.initAutoloadFromStlId;
  }

  init() {
    this.ctx.stlUploadButton?.addEventListener('click', this.uploadStl);

    if (this.ctx.isPreviewMode(this.ctx.viewerMode) && this.ctx.stlId) {
      this.initAutoloadFromStlId(this.ctx.stlId);
    }
  }

  dispose() {
    this.ctx.stlUploadButton?.removeEventListener('click', this.uploadStl);
    this.ctx.clearCurrentModel();
    this.ctx.clearNcPreview();
  }
}

const STL_TOP_FACE_DOT_THRESHOLD = 0.6;
const STL_TOP_FACE_HEIGHT_EPS_MM = 0.2;
const STL_LOCAL_TOP_NORMAL = new THREE.Vector3(0, 0, 1);

export function createStlViewer(ctx) {
  const { state, scene, stlFileInput, viewerMode, isPreviewMode, setErrorState, setSuccessState, setLoadingState, setStlUploadState, setStlUploadLink, buildPreviewUrl, clearCurrentModel, clearNcPreview, disposeMaterial, fitCamera } = ctx;
async function uploadStl() {
  if (!stlFileInput?.files?.length) {
    setStlUploadState('Выберите STL файл.', true);
    return;
  }

  setStlUploadState('Загрузка STL...');
  setStlUploadLink('');

  const fd = new FormData();
  fd.append('file', stlFileInput.files[0]);

  let json;
  try {
    const res = await fetch('/svg3d-api/upload-stl', { method: 'POST', body: fd });
    json = await res.json();
  } catch (err) {
    setStlUploadState(`Ошибка загрузки STL: ${err instanceof Error ? err.message : String(err)}`, true);
    return;
  }

  if (!json?.ok || !json?.id) {
    const errors = Array.isArray(json?.errors) ? json.errors : ['Не удалось сохранить STL.'];
    setStlUploadState(errors.join('\n'), true);
    return;
  }

  const previewUrl = buildPreviewUrl(json.url || `?stl=${json.id}`);
  setStlUploadState(`STL сохранён. ID: ${json.id}`);
  setStlUploadLink(previewUrl);
}


async function initAutoloadFromStlId(stlId) {
  if (!stlId) {
    setErrorState('STL для предпросмотра не передан.');
    return;
  }

  setLoadingState('Загружаем STL модель...');

  try {
    const geometry = await loadStlGeometry(stlId);
    buildStlModel(geometry);
    setSuccessState('');
  } catch (err) {
    setErrorState(err instanceof Error ? err.message : 'Не удалось загрузить STL модель.');
  }
}


async function loadStlGeometry(stlId) {
  const normalizedId = typeof stlId === 'string' ? stlId.trim() : '';
  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedId)) {
    throw new Error('Некорректный STL id.');
  }

  const res = await fetch(`/svg3d-api/stl/${encodeURIComponent(normalizedId)}`);
  if (!res.ok) {
    let message = 'Не удалось загрузить STL модель.';

    try {
      const payload = await res.json();
      const errors = Array.isArray(payload?.errors) ? payload.errors : [];
      if (errors.length > 0) {
        message = errors.join('\n');
      }
    } catch {
      // ignore non-JSON response and keep fallback message
    }

    throw new Error(message);
  }

  const buffer = await res.arrayBuffer();
  const geometry = new STLLoader().parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}


function buildStlModel(geometry) {
  clearCurrentModel();
  clearNcPreview();

  geometry.computeVertexNormals();

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: getBaseMaterialColorHex(DEFAULT_BASE_MATERIAL_COLOR),
    metalness: MATERIAL_METALNESS,
    roughness: GREEN_LAYER_ROUGHNESS
  });
  const topMaterial = new THREE.MeshStandardMaterial({
    color: TOP_LAYER_COLOR,
    metalness: MATERIAL_METALNESS,
    roughness: TOP_LAYER_ROUGHNESS
  });

  const { baseGeometry, topGeometry } = splitStlGeometryByTopFaces(geometry);
  geometry.dispose();

  state.modelGroup = new THREE.Group();
  state.modelGroup.rotation.x = -Math.PI / 2;

  if (baseGeometry) {
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    baseMesh.castShadow = isPreviewMode(viewerMode);
    baseMesh.receiveShadow = isPreviewMode(viewerMode);
    state.modelGroup.add(baseMesh);
  } else {
    baseMaterial.dispose();
  }

  if (topGeometry) {
    const topMesh = new THREE.Mesh(topGeometry, topMaterial);
    topMesh.castShadow = isPreviewMode(viewerMode);
    topMesh.receiveShadow = isPreviewMode(viewerMode);
    state.modelGroup.add(topMesh);
  } else {
    topMaterial.dispose();
  }

  scene.add(state.modelGroup);
  fitCamera(state.modelGroup);
}


function splitStlGeometryByTopFaces(geometry) {
  const sourceGeometry = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const positionAttr = sourceGeometry.getAttribute('position');

  if (!positionAttr || positionAttr.count < 3) {
    sourceGeometry.dispose();
    return { baseGeometry: geometry.clone(), topGeometry: null };
  }

  if (!sourceGeometry.getAttribute('normal')) {
    sourceGeometry.computeVertexNormals();
  }

  const normalAttr = sourceGeometry.getAttribute('normal');
  const basePositions = [];
  const baseNormals = [];
  const topPositions = [];
  const topNormals = [];
  sourceGeometry.computeBoundingBox();

  const bbox = sourceGeometry.boundingBox;
  const topHeight = bbox ? bbox.max.dot(STL_LOCAL_TOP_NORMAL) : null;
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const fallbackNormal = new THREE.Vector3();

  for (let i = 0; i < positionAttr.count; i += 3) {
    vertexA.fromBufferAttribute(positionAttr, i);
    vertexB.fromBufferAttribute(positionAttr, i + 1);
    vertexC.fromBufferAttribute(positionAttr, i + 2);

    edgeAB.subVectors(vertexB, vertexA);
    edgeAC.subVectors(vertexC, vertexA);
    faceNormal.crossVectors(edgeAB, edgeAC);

    const upDot = faceNormal.lengthSq() > 0
      ? faceNormal.normalize().dot(STL_LOCAL_TOP_NORMAL)
      : normalAttr
        ? STL_LOCAL_TOP_NORMAL.dot(fallbackNormal.set(
          normalAttr.getX(i),
          normalAttr.getY(i),
          normalAttr.getZ(i)
        ).normalize())
        : -1;
    const minVertexHeight = Math.min(vertexA.dot(STL_LOCAL_TOP_NORMAL), vertexB.dot(STL_LOCAL_TOP_NORMAL), vertexC.dot(STL_LOCAL_TOP_NORMAL));
    const isWithinTopBand = Number.isFinite(topHeight)
      && topHeight - minVertexHeight <= TOP_SKIN_THICKNESS_MM + STL_TOP_FACE_HEIGHT_EPS_MM;
    const isTopFace = upDot > STL_TOP_FACE_DOT_THRESHOLD && isWithinTopBand;
    const targetPositions = isTopFace ? topPositions : basePositions;
    const targetNormals = isTopFace ? topNormals : baseNormals;

    for (let vertex = 0; vertex < 3; vertex += 1) {
      targetPositions.push(
        positionAttr.getX(i + vertex),
        positionAttr.getY(i + vertex),
        positionAttr.getZ(i + vertex)
      );
      targetNormals.push(
        normalAttr.getX(i + vertex),
        normalAttr.getY(i + vertex),
        normalAttr.getZ(i + vertex)
      );
    }
  }

  sourceGeometry.dispose();

  return {
    baseGeometry: buildSplitGeometry(basePositions, baseNormals),
    topGeometry: buildSplitGeometry(topPositions, topNormals)
  };
}


function buildSplitGeometry(positions, normals) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  if (Array.isArray(normals) && normals.length === positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}


  return { uploadStl, initAutoloadFromStlId };
}
