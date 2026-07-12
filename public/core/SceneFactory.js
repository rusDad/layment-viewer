import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewerScene(root, mode, isPreviewMode) {
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

  configureSceneForMode({ mode, isPreviewMode, scene, renderer, ambientLight, mainDirectionalLight, fillLight, rimLight, shadowReceiver, axesHelper });

  return { scene, camera, renderer, controls, ambientLight, mainDirectionalLight, fillLight, rimLight, shadowReceiver, axesHelper };
}

function configureSceneForMode(ctx) {
  if (ctx.isPreviewMode(ctx.mode)) {
    configureSceneForPreviewMode(ctx);
    return;
  }

  configureSceneForDebugMode(ctx);
}

function configureSceneForPreviewMode({ scene, renderer, ambientLight, mainDirectionalLight, fillLight, rimLight, shadowReceiver, axesHelper }) {
  scene.background = new THREE.Color(0xf1f3f5);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  ambientLight.intensity = 0.52;
  mainDirectionalLight.intensity = 0.95;
  mainDirectionalLight.position.set(-60, 320, 0);
  mainDirectionalLight.castShadow = true;
  mainDirectionalLight.shadow.mapSize.set(2048, 2048);
  mainDirectionalLight.shadow.radius = 6;
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

function configureSceneForDebugMode({ scene, renderer, ambientLight, mainDirectionalLight, fillLight, rimLight, shadowReceiver, axesHelper }) {
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
