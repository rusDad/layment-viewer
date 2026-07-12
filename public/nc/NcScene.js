import * as THREE from 'three';

export const NC_DEFAULT_COLORS = { G0: '#7fb7ff', G1: '#42d36b', G2: '#ffad33', G3: '#d45cff' };

export function createNcScene(ctx) {
  const { scene, clearCurrentModel, disposeMaterial, fitCamera } = ctx;
  let ncPreviewGroup = null;
  let ncBoxMaterial = null;
  const ncLineMaterials = { G0: null, G1: null, G2: null, G3: null };

  function buildNcPreview(toolpath, dimensions, settings) {
    clearCurrentModel();
    clearNcPreview();

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

  function updateVisualSettings(settings) {
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

  return { buildNcPreview, updateVisualSettings, clearNcPreview };
}

export function mapNcPointToThree(point, dimensions) {
  // NC preview uses the layment box coordinate frame: the box spans X 0..width,
  // Z 0..height, and vertical Y -thickness..0. The NC source coordinates are
  // already parsed in machine/world units, so only the visual X axis is flipped
  // at render time to match the viewer's screen-space convention without changing G-code
  // semantics, Y-depth placement, or the box geometry.
  return new THREE.Vector3(dimensions.width - point.x, point.z, point.y);
}
