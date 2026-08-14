import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { resolveTextOverlayTransform } from './TextOverlayTransform.js';


export class SvgViewer {
  constructor(ctx) {
    this.ctx = ctx;
    this.controller = createSvg3dController(ctx);
    this.uploadSvg = this.controller.uploadSvg;
    this.uploadSvgText = this.controller.uploadSvgText;
    this.initAutoloadFromPayloadKey = this.controller.initAutoloadFromPayloadKey;
    this.clearCurrentModel = this.controller.clearCurrentModel;
  }

  init() {
    this.ctx.uploadButton?.addEventListener('click', this.uploadSvg);

    if ((this.ctx.isPreviewMode(this.ctx.viewerMode) || this.ctx.allowLegacyPayload) && this.ctx.payloadKey) {
      this.initAutoloadFromPayloadKey(this.ctx.payloadKey);
    }
  }

  dispose() {
    this.ctx.uploadButton?.removeEventListener('click', this.uploadSvg);
    this.clearCurrentModel();
  }
}

const TOP_SKIN_THICKNESS_MM = 4;
const TOP_LAYER_COLOR = 0x4a4a4a;
const EVA_GREEN_COLOR = 0x6ea978;
const EVA_BLUE_COLOR = 0x5f7892;
const MATERIAL_METALNESS = 0.012;
const TOP_LAYER_ROUGHNESS = 0.75;
const GREEN_LAYER_ROUGHNESS = 0.85;
const DEFAULT_BASE_MATERIAL_COLOR = 'green';
const DEFAULT_LAYMENT_THICKNESS_MM = 35;
const TEXT_OVERLAY_COLOR = '#101010';
const TEXT_OVERLAY_Z_OFFSET_MM = 0.5;
const TEXT_CANVAS_PIXELS_PER_MM = 24;
const TEXT_CANVAS_PADDING_MM = 1.2;
const MIN_TEXT_FONT_SIZE_MM = 0.5;

export function createSvg3dController(ctx) {
  const { state, scene, fileInput, viewerMode, setLoadingState, setErrorState, setSuccessState, isPreviewMode, clearNcPreview, disposeMaterial, fitCamera } = ctx;
async function uploadSvg() {
  if (!fileInput.files?.length) {
    setErrorState('Выберите SVG файл.');
    return;
  }

  await uploadSvgFile(fileInput.files[0], { source: 'manual upload' });
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
        texts: Array.isArray(parsed.texts) ? parsed.texts : []
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
  console.log('viewer payload texts', payload.texts);
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


function clearCurrentModel() {
  if (!state.modelGroup) {
    return;
  }

  scene.remove(state.modelGroup);
  state.modelGroup.traverse((obj) => {
    if (obj.isMesh || obj.isLine || obj.isLineSegments) {
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
  state.modelGroup = null;
}


function buildModel(geometry, visualSettings = {}, texts = []) {
  clearCurrentModel();
  clearNcPreview();

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

  state.modelGroup = new THREE.Group();
  state.modelGroup.rotation.x = -Math.PI / 2;

  if (mergedGreen) {
    const greenMesh = new THREE.Mesh(mergedGreen, greenMaterial);
    greenMesh.castShadow = isPreviewMode(viewerMode);
    greenMesh.receiveShadow = isPreviewMode(viewerMode);
    state.modelGroup.add(greenMesh);
  }

  if (topLayer) {
    const topMesh = new THREE.Mesh(topLayer, topMaterial);
    topMesh.castShadow = isPreviewMode(viewerMode);
    topMesh.receiveShadow = isPreviewMode(viewerMode);
    state.modelGroup.add(topMesh);
  }

  const textOverlayGroup = buildTextOverlayGroup(geometry, texts);
  if (textOverlayGroup) {
    state.modelGroup.add(textOverlayGroup);
  }

  scene.add(state.modelGroup);

  fitCamera(state.modelGroup);
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
      //polygonOffset: true,
      //polygonOffsetFactor: -2,
      //polygonOffsetUnits: -2,
      //alphaTest: 0.05
    });
    const mesh = new THREE.Mesh(plane, material);
    const transform = resolveTextOverlayTransform({
      xMm,
      yMm,
      widthMm: texturePayload.widthMm,
      heightMm: texturePayload.heightMm,
      baselineXFromLeftMm: texturePayload.baselineXFromLeftMm,
      baselineYFromTopMm: texturePayload.baselineYFromTopMm,
      angleDeg,
      outerHeightMm
    });

    mesh.position.set(
      transform.x,
      transform.y,
      TEXT_OVERLAY_Z_OFFSET_MM
    );
    mesh.rotation.z = transform.rotationZRad;
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
  const baselineXFromLeftMm = paddingPx / pixelsPerMm;
  const baselineYFromTopMm = (paddingPx + ascentPx) / pixelsPerMm;
  if (
    !Number.isFinite(widthMm)
    || !Number.isFinite(heightMm)
    || !Number.isFinite(baselineXFromLeftMm)
    || !Number.isFinite(baselineYFromTopMm)
    || widthMm <= 0
    || heightMm <= 0
  ) {
    texture.dispose();
    return null;
  }

  return { texture, widthMm, heightMm, baselineXFromLeftMm, baselineYFromTopMm };
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



  return {
    uploadSvg,
    uploadSvgText,
    initAutoloadFromPayloadKey,
    clearCurrentModel
  };
}
