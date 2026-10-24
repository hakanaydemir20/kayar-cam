import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FLOOR_Y } from './cabin.js';

export class Viewer {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.78;
    container.appendChild(r.domElement);
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x15191e);
    const pm = new THREE.PMREMGenerator(r);
    s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.camera.position.set(140, 160, 420);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x30343a, 0.6);
    s.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(250, 500, 400);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -420, right: 420, top: 360, bottom: -360, near: 10, far: 2000 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;   // gölge lekesi (acne) olmasın
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9ec5ff, 0.5);
    rim.position.set(-300, 200, -300);
    s.add(rim);
    // atölye zemini + ızgara (kabin kaidesinin altında)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y - 0.5;
    s.add(floor);
    const grid = this.grid = new THREE.GridHelper(6000, 60, 0x3a414b, 0x30363e);
    grid.position.y = FLOOR_Y;
    s.add(grid);
    this.onFrame = null;
    this.last = performance.now();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      if (this.onFrame) this.onFrame(dt);
      this.controls.update();
      r.render(s, this.camera);
    };
    loop();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  view(name) {
    const c = this.camera, t = this.controls.target;
    const views = {
      iso: [[190, 150, 330], [30, 0, 0]],
      front: [[40, 0, 330], [40, 0, 0]],
      top: [[40, 420, 0.1], [40, 0, 0]],
      zone: [[52, 34, 96], [-2, 4, 0]],
      sub: [[40, 130, 250], [95, -15, -45]],
      machine: [[700, 200, 3350], [-230, -180, 0]],
    }[name];
    if (!views) return;
    c.position.set(...views[0]); t.set(...views[1]);
  }
}
