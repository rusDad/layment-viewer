import * as THREE from 'three';
import { NC_MAX_FILE_BYTES, parseNcToToolpath } from '../nc-parser.mjs';

const NC_DEFAULT_COLORS = { G0: '#7fb7ff', G1: '#42d36b', G2: '#ffad33', G3: '#d45cff' };

export function createNcPreview(ctx) {
  const { scene, viewerMode, isPreviewMode, ncFileInput, ncStatusEl, ncWidthInput, ncHeightInput, ncThicknessInput, ncOpacityInput, ncOpacityValueEl, ncColorInputs, clearCurrentModel, disposeMaterial, fitCamera } = ctx;
  let ncPreviewGroup = null;
  let ncBoxMaterial = null;
  const ncLineMaterials = { G0: null, G1: null, G2: null, G3: null };
function setNcStatus(message, isError = false) {
  if (!ncStatusEl) {
    return;
  }

  ncStatusEl.textContent = message || '';
  ncStatusEl.classList.toggle('status-error', Boolean(message) && isError);
  ncStatusEl.classList.toggle('status-meta', Boolean(message) && !isError);
}


async function buildNcPreviewFromUi() {
  if (isPreviewMode(viewerMode)) {
    return;
  }

  const file = ncFileInput?.files?.[0];
  if (!file) {
    setNcStatus('Выберите .nc файл.', true);
    return;
  }

  if (file.size > NC_MAX_FILE_BYTES) {
    setNcStatus(`Файл слишком большой: максимум ${Math.round(NC_MAX_FILE_BYTES / 1024 / 1024)} MB.`, true);
    return;
  }

  const dimensions = getNcDimensionsFromUi();
  if (!dimensions) {
    setNcStatus('Некорректные габариты ложемента: width/height/thickness должны быть положительными числами.', true);
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (err) {
    setNcStatus(`Не удалось прочитать .nc файл: ${err instanceof Error ? err.message : String(err)}`, true);
    return;
  }

  if (!text.trim()) {
    setNcStatus('NC файл пустой.', true);
    return;
  }

  let toolpath;
  try {
    toolpath = parseNcToToolpath(text);
  } catch (err) {
    setNcStatus(`Не удалось распарсить NC: ${err instanceof Error ? err.message : String(err)}`, true);
    return;
  }

  if (toolpath.segments.length === 0) {
    setNcStatus(formatNcStatus(toolpath, 'Движения G0/G1/G2/G3 не найдены.'), true);
    return;
  }

  buildNcPreview(toolpath, dimensions);
  setNcStatus(formatNcStatus(toolpath));
}


function getNcDimensionsFromUi() {
  const width = Number(ncWidthInput?.value);
  const height = Number(ncHeightInput?.value);
  const thickness = Number(ncThicknessInput?.value);

  if (![width, height, thickness].every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }

  return { width, height, thickness };
}


function getNcVisualSettings() {
  return {
    opacity: clampNumber(Number(ncOpacityInput?.value ?? 0.3), 0, 1),
    colors: {
      G0: ncColorInputs.G0?.value || NC_DEFAULT_COLORS.G0,
      G1: ncColorInputs.G1?.value || NC_DEFAULT_COLORS.G1,
      G2: ncColorInputs.G2?.value || NC_DEFAULT_COLORS.G2,
      G3: ncColorInputs.G3?.value || NC_DEFAULT_COLORS.G3
    }
  };
}


function updateNcVisualSettings() {
  updateNcOpacityLabel();
  const settings = getNcVisualSettings();

  if (ncBoxMaterial) {
    ncBoxMaterial.opacity = settings.opacity;
    ncBoxMaterial.needsUpdate = true;
  }

  Object.entries(ncLineMaterials).forEach(([motion, material]) => {
    if (material) {
      material.color.set(settings.colors[motion]);
      material.needsUpdate = true;
    }
  });
}


function updateNcOpacityLabel() {
  if (ncOpacityValueEl && ncOpacityInput) {
    ncOpacityValueEl.textContent = Number(ncOpacityInput.value).toFixed(2);
  }
}


function buildNcPreview(toolpath, dimensions) {
  clearCurrentModel();
  clearNcPreview();

  const settings = getNcVisualSettings();
  ncPreviewGroup = new THREE.Group();
  ncPreviewGroup.name = 'NC toolpath preview';

  const box = createNcLaymentBox(dimensions, settings.opacity);
  ncPreviewGroup.add(box);

  const motionGroups = createNcMotionLineGroups(toolpath, dimensions, settings.colors);
  Object.values(motionGroups).forEach((group) => {
    if (group) {
      ncPreviewGroup.add(group);
    }
  });

  scene.add(ncPreviewGroup);
  fitCamera(ncPreviewGroup);
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


function createNcMotionLineGroups(toolpath, dimensions, colors) {
  const positionsByMotion = { G0: [], G1: [], G2: [], G3: [] };

  toolpath.segments.forEach((segment) => {
    const positions = positionsByMotion[segment.motion];
    if (!positions) {
      return;
    }

    for (let i = 1; i < segment.points.length; i += 1) {
      const from = mapNcPointToThree(segment.points[i - 1], dimensions);
      const to = mapNcPointToThree(segment.points[i], dimensions);
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }
  });

  return Object.fromEntries(Object.entries(positionsByMotion).map(([motion, positions]) => {
    if (positions.length === 0) {
      ncLineMaterials[motion] = null;
      return [motion, null];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.LineBasicMaterial({
      color: colors[motion] || NC_DEFAULT_COLORS[motion],
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
      toneMapped: false
    });
    ncLineMaterials[motion] = material;

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = `NC ${motion} toolpath`;
    lines.renderOrder = 2;
    return [motion, lines];
  }));
}


function mapNcPointToThree(point, dimensions) {
  // NC preview uses the layment box coordinate frame: the box spans X 0..width,
  // Z 0..height, and vertical Y -thickness..0.  The NC source coordinates are
  // already parsed in machine/world units, so only the visual X axis is flipped
  // at render time to match the viewer's screen-space convention without changing G-code
  // semantics, Y-depth placement, or the box geometry.
  return new THREE.Vector3(dimensions.width - point.x, point.z, point.y);
}


function clearNcPreview() {
  if (!ncPreviewGroup) {
    return;
  }

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
  Object.keys(ncLineMaterials).forEach((motion) => {
    ncLineMaterials[motion] = null;
  });
}


function formatNcStatus(toolpath, prefix = '') {
  const bbox = toolpath.bbox
    ? `bbox: X ${formatMm(toolpath.bbox.minX)}..${formatMm(toolpath.bbox.maxX)}, Y ${formatMm(toolpath.bbox.minY)}..${formatMm(toolpath.bbox.maxY)}, Z ${formatMm(toolpath.bbox.minZ)}..${formatMm(toolpath.bbox.maxZ)}`
    : 'bbox: n/a';
  const warnings = toolpath.warnings.length > 0
    ? `warnings:\n${toolpath.warnings.slice(0, 8).map((warning) => `- ${warning}`).join('\n')}${toolpath.warnings.length > 8 ? `\n...and ${toolpath.warnings.length - 8} more` : ''}`
    : 'warnings: 0';
  const modal = toolpath.modal
    ? `modal: ${toolpath.modal.units}, ${toolpath.modal.positioning}, ${toolpath.modal.plane}, arc centers ${toolpath.modal.arcCenterMode}`
    : '';
  const lines = [
    prefix,
    `segments: G0=${toolpath.stats.g0}, G1=${toolpath.stats.g1}, G2=${toolpath.stats.g2}, G3=${toolpath.stats.g3}`,
    `skipped=${toolpath.stats.skipped}, rendered points=${toolpath.renderedPoints}`,
    bbox,
    modal,
    warnings
  ].filter(Boolean);

  return lines.join('\n');
}


function formatMm(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}


function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}


  return { buildNcPreviewFromUi, updateNcVisualSettings, updateNcOpacityLabel, clearNcPreview };
}
