import * as THREE from 'three';

const PREVIEW_FIT_DISTANCE_FACTOR = 1.68;
const DEBUG_FIT_DISTANCE_FACTOR = 1.6;
const PREVIEW_CAMERA_HEIGHT_FACTOR = 0.95;
const PREVIEW_CAMERA_DEPTH_FACTOR = 0.74;

export class ViewerBase {
  constructor({ root, scene, camera, renderer, controls, shadowReceiver, mainDirectionalLight, viewerMode, isPreviewMode }) {
    this.root = root;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.shadowReceiver = shadowReceiver;
    this.mainDirectionalLight = mainDirectionalLight;
    this.viewerMode = viewerMode;
    this.isPreviewMode = isPreviewMode;
    this.animationFrameId = null;

    this.resize = this.resize.bind(this);
    this.animate = this.animate.bind(this);
    this.fitCamera = this.fitCamera.bind(this);
  }

  start() {
    window.addEventListener('resize', this.resize);
    this.resize();
    this.animate();
  }

  resize() {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  fitCamera(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const preview = this.isPreviewMode(this.viewerMode);
    const dist = maxDim * (preview ? PREVIEW_FIT_DISTANCE_FACTOR : DEBUG_FIT_DISTANCE_FACTOR);

    if (preview) {
      const shadowSize = Math.max(size.x, size.z) * 1.8;
      this.shadowReceiver.scale.set(shadowSize, shadowSize, 1);
      this.shadowReceiver.position.set(center.x, box.min.y - 0.5, center.z);

      const shadowCamExtent = Math.max(size.x, size.y, size.z) * 0.9;
      this.mainDirectionalLight.shadow.camera.left = -shadowCamExtent;
      this.mainDirectionalLight.shadow.camera.right = shadowCamExtent;
      this.mainDirectionalLight.shadow.camera.top = shadowCamExtent;
      this.mainDirectionalLight.shadow.camera.bottom = -shadowCamExtent;
      this.mainDirectionalLight.shadow.camera.near = 1;
      this.mainDirectionalLight.shadow.camera.far = Math.max(1500, maxDim * 10);
      this.mainDirectionalLight.shadow.camera.updateProjectionMatrix();
      this.mainDirectionalLight.target.position.copy(center);
    }

    this.camera.position.set(
      center.x + dist,
      center.y + dist * (preview ? PREVIEW_CAMERA_HEIGHT_FACTOR : 0.9),
      center.z + dist * (preview ? PREVIEW_CAMERA_DEPTH_FACTOR : 0.6)
    );
    this.camera.near = Math.max(0.1, maxDim / 1000);
    this.camera.far = Math.max(5000, maxDim * 20);
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    this.controls.update();
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

export function disposeMaterial(material) {
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
