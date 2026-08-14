import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPreviewSceneLayers, parsePreviewSceneV1 } from './PreviewSceneModel.mjs';

const TOP_COLOR = 0x4a4a4a;
const BASE_COLORS = { green: 0x6ea978, blue: 0x5f7892 };
const TOP_SKIN_THICKNESS_MM = 4;

export class PreviewSceneViewer {
  constructor(ctx) { this.ctx = ctx; }
  init() {
    this.ctx.setLoadingState();
    const key = this.ctx.payloadKey;
    try {
      if (!key) throw new Error('PreviewSceneV1 не передан.');
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error('PreviewSceneV1 не передан.');
      const scene = parsePreviewSceneV1(JSON.parse(raw));
      this.render(scene);
      this.ctx.setSuccessState('PreviewSceneV1');
    } catch (error) {
      this.ctx.setErrorState(error instanceof Error ? error.message : 'Не удалось построить 3D предпросмотр.');
    } finally {
      if (key) localStorage.removeItem(key);
    }
  }
  render(sceneDto) {
    this.ctx.clearCurrentModel();
    const model = buildPreviewSceneLayers(sceneDto, globalThis.polygonClipping);
    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2;
    const baseMaterial = material(BASE_COLORS[sceneDto.layment.baseMaterialColor]);
    const topMaterial = material(TOP_COLOR);
    model.layers.forEach((layer) => {
      splitForTopSkin(layer).forEach((visualLayer) => {
        const geometries = visualLayer.regions.flatMap((polygon) => polygonToGeometries(polygon, visualLayer));
        if (!geometries.length) return;
        const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, visualLayer.topDepthMm < TOP_SKIN_THICKNESS_MM ? topMaterial : baseMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      });
    });
    const textGroup = buildTexts(sceneDto.texts);
    if (textGroup) group.add(textGroup);
    this.ctx.state.modelGroup = group;
    this.ctx.scene.add(group);
    this.ctx.fitCamera(group);
  }
  dispose() { this.ctx.clearCurrentModel(); }
}

function splitForTopSkin(layer) {
  if (layer.topDepthMm < TOP_SKIN_THICKNESS_MM && layer.bottomDepthMm > TOP_SKIN_THICKNESS_MM) {
    return [
      { ...layer, bottomDepthMm: TOP_SKIN_THICKNESS_MM },
      { ...layer, topDepthMm: TOP_SKIN_THICKNESS_MM }
    ];
  }
  return [layer];
}

function polygonToGeometries(polygon, layer) {
  if (!polygon?.[0]?.length) return [];
  const shape = path(polygon[0], true);
  polygon.slice(1).forEach((ring) => shape.holes.push(path(ring, false)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: layer.bottomDepthMm - layer.topDepthMm, bevelEnabled: false, curveSegments: 16 });
  geometry.rotateX(Math.PI);
  geometry.translate(0, 0, -layer.topDepthMm);
  return [geometry];
}
function path(ring, shape) { const target = shape ? new THREE.Shape() : new THREE.Path(); ring.slice(0, -1).forEach((p, i) => i ? target.lineTo(p[0], p[1]) : target.moveTo(p[0], p[1])); target.closePath(); return target; }
function material(color) { return new THREE.MeshStandardMaterial({ color, metalness: 0.012, roughness: 0.82 }); }
function buildTexts(texts) { const group = new THREE.Group(); texts.forEach((text) => { const canvas = document.createElement('canvas'); const px = Math.max(12, Math.ceil(text.fontSizeMm * 24)); const ctx = canvas.getContext('2d'); ctx.font = `500 ${px}px Arial`; const width = Math.ceil(ctx.measureText(text.text).width + 16); canvas.width = width; canvas.height = Math.ceil(px * 1.4); ctx.font = `500 ${px}px Arial`; ctx.fillStyle = '#101010'; ctx.textBaseline = 'middle'; ctx.fillText(text.text, 8, canvas.height / 2); const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; const w = width / 24, h = canvas.height / 24; const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })); mesh.position.set(text.x + w / 2, text.y + h / 2, 0.5); mesh.rotation.z = THREE.MathUtils.degToRad(text.angle); group.add(mesh); }); return group.children.length ? group : null; }
