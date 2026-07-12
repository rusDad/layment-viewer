import * as THREE from 'three';
import { buildNcColoredRenderBatch } from './NcRenderIndex.js';
import { buildNcColorContext, getNcColorLegend, getSegmentColor } from './NcColorStrategies.js';

export const NC_DEFAULT_COLORS = { G0: '#7fb7ff', G1: '#42d36b', G2: '#ffad33', G3: '#d45cff' };

export function createNcScene(ctx) {
  const { scene, clearCurrentModel, disposeMaterial, fitCamera } = ctx;
  let ncPreviewGroup = null;
  let ncBoxMaterial = null;
  let activeToolpath = null;
  let activeDimensions = null;
  let hoverHighlight = null;
  let selectionHighlight = null;
  const ncLineMaterials = [];
  let activeLineBatches = [];

  function buildNcPreview(toolpath, dimensions, settings) {
    clearCurrentModel();
    clearNcPreview();

    ncPreviewGroup = new THREE.Group();
    ncPreviewGroup.name = 'NC toolpath preview';

    const box = createNcLaymentBox(dimensions, settings.opacity);
    ncPreviewGroup.add(box);

    activeToolpath = toolpath;
    activeDimensions = dimensions;

    const lineResult = replaceNcToolpathLines(settings);

    scene.add(ncPreviewGroup);
    fitCamera(ncPreviewGroup);
    return { group: ncPreviewGroup, motionLineBatches: lineResult.lineBatches, colorLegend: lineResult.colorLegend };
  }

  function updateVisualSettings(settings) {
    if (ncBoxMaterial) {
      ncBoxMaterial.opacity = settings.opacity;
      ncBoxMaterial.needsUpdate = true;
    }

    if (activeToolpath && activeDimensions && ncPreviewGroup) {
      return replaceNcToolpathLines(settings);
    }

    return { lineBatches: activeLineBatches, colorLegend: null };
  }

  function createNcLaymentBox(dimensions, opacity) {
    const geometry = new THREE.BoxGeometry(dimensions.width, dimensions.thickness, dimensions.height);
    geometry.translate(dimensions.width / 2, -dimensions.thickness / 2, dimensions.height / 2);

    ncBoxMaterial = new THREE.MeshStandardMaterial({
      color: 0x6ea978,
      transparent: true,
      opacity,
      depthWrite: false,
      roughness: 0.8,
      metalness: 0.02
    });

    const mesh = new THREE.Mesh(geometry, ncBoxMaterial);
    mesh.name = 'NC layment volume';
    mesh.renderOrder = 0;
    return mesh;
  }

  function replaceNcToolpathLines(settings) {
    activeLineBatches.forEach((batch) => {
      ncPreviewGroup?.remove(batch.object);
      batch.object.geometry?.dispose();
      if (Array.isArray(batch.object.material)) {
        batch.object.material.forEach(disposeMaterial);
      } else if (batch.object.material) {
        disposeMaterial(batch.object.material);
      }
    });
    activeLineBatches = [];
    ncLineMaterials.splice(0, ncLineMaterials.length);

    if (!activeToolpath || !activeDimensions || !ncPreviewGroup) {
      return { lineBatches: [], colorLegend: null };
    }

    const colorContext = buildNcColorContext(activeToolpath, settings, NC_DEFAULT_COLORS);
    const batch = buildNcColoredRenderBatch(activeToolpath, activeDimensions, mapNcPointToThree, colorContext, getSegmentColor);
    if (batch.positions.length === 0) {
      return { lineBatches: [], colorLegend: getNcColorLegend(colorContext) };
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
      toneMapped: false
    });
    ncLineMaterials.push(material);

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = `NC ${colorContext.colorStrategy} toolpath`;
    lines.renderOrder = 2;
    lines.userData.ncColorStrategy = colorContext.colorStrategy;
    lines.userData.ncRenderSegmentRefs = batch.renderSegmentRefs;
    ncPreviewGroup.add(lines);

    activeLineBatches = [{ motion: 'colored', object: lines, renderSegmentRefs: batch.renderSegmentRefs }];
    return { lineBatches: activeLineBatches, colorLegend: getNcColorLegend(colorContext) };
  }

  function setHoverHighlight(segmentId) {
    hoverHighlight = replaceSegmentHighlight(hoverHighlight, segmentId, 0xfff176, 'NC hover highlight', 4);
  }

  function setSelectionHighlight(segmentId) {
    selectionHighlight = replaceSegmentHighlight(selectionHighlight, segmentId, 0x5ce1ff, 'NC selection highlight', 5);
  }

  function focusSelectedSegment() {
    if (selectionHighlight) {
      fitCamera(selectionHighlight);
    }
  }

  function replaceSegmentHighlight(current, segmentId, color, name, renderOrder) {
    disposeHighlight(current);
    if (!Number.isInteger(segmentId) || !activeToolpath || !activeDimensions || !ncPreviewGroup) {
      return null;
    }

    const segment = activeToolpath.segments.find((candidate) => candidate.id === segmentId);
    if (!segment || segment.points.length < 2) {
      return null;
    }

    const positions = [];
    for (let i = 1; i < segment.points.length; i += 1) {
      const from = mapNcPointToThree(segment.points[i - 1], activeDimensions);
      const to = mapNcPointToThree(segment.points[i], activeDimensions);
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
      toneMapped: false
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = name;
    lines.renderOrder = renderOrder;
    ncPreviewGroup.add(lines);
    return lines;
  }

  function disposeHighlight(highlight) {
    if (!highlight) return;
    ncPreviewGroup?.remove(highlight);
    highlight.geometry?.dispose();
    if (Array.isArray(highlight.material)) {
      highlight.material.forEach(disposeMaterial);
    } else if (highlight.material) {
      disposeMaterial(highlight.material);
    }
  }

  function clearNcPreview() {
    if (!ncPreviewGroup) {
      return;
    }

    disposeHighlight(hoverHighlight);
    disposeHighlight(selectionHighlight);
    hoverHighlight = null;
    selectionHighlight = null;
    scene.remove(ncPreviewGroup);
    ncPreviewGroup.traverse((obj) => {
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

    ncPreviewGroup = null;
    ncBoxMaterial = null;
    activeToolpath = null;
    activeDimensions = null;
    ncLineMaterials.splice(0, ncLineMaterials.length);
    activeLineBatches = [];
  }

  return { buildNcPreview, updateVisualSettings, setHoverHighlight, setSelectionHighlight, focusSelectedSegment, clearNcPreview };
}

export function mapNcPointToThree(point, dimensions) {
  // NC preview uses the layment box coordinate frame: the box spans X 0..width,
  // Z 0..height, and vertical Y -thickness..0. The NC source coordinates are
  // already parsed in machine/world units, so only the visual X axis is flipped
  // at render time to match the viewer's screen-space convention without changing G-code
  // semantics, Y-depth placement, or the box geometry.
  return new THREE.Vector3(dimensions.width - point.x, point.z, point.y);
}
