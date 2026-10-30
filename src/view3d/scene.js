import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FLOOR_Y } from './cabin.js';

export class Viewer {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.NoToneMapping;    // CAM grafiği: düz, parlamasız (arka plan CSS geçişi)
    r.setClearColor(0x000000, 0);
    container.appendChild(r.domElement);
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.camera.position.set(140, 160, 420);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    // düz aydınlatma: gölge ve koyu yüz yok, kenar çizgileri biçimi belirtir
    s.add(new THREE.AmbientLight(0xffffff, 0.95));
    s.add(new THREE.HemisphereLight(0xffffff, 0xb8c2cc, 0.35));
    // kamera ışığı (CAM programlarındaki gibi bakış yönünden aydınlatma)
    const key = this.key = new THREE.DirectionalLight(0xffffff, 0.5);
    this.camera.add(key); key.position.set(0.3, 0.5, 1); s.add(this.camera);
    // atölye zemini + ızgara (kabin kaidesinin altında)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y - 0.5;
    s.add(floor);
    this.floor = floor;
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
      this.stepAnim();
      if (this.onAfter) this.onAfter();
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
  /** Zemin + ızgara (makine gövdesiyle birlikte gösterilir) */
  setFloor(on) { this.floor.visible = on; this.grid.visible = on; }
  /** Görünüm açısı; opts.L parça boyu (ön/üst görünüm parçaya yakın), opts.instant: animasyonsuz */
  view(name, opts = {}) {
    const c = this.camera, t = this.controls.target;
    const L = Math.max(10, opts.L || 35), cx = opts.cx ?? -Math.min(L, 60) / 2 + 4, dist = Math.max(60, Math.min(L, 80) * 2.1);
    const views = {
      iso: [[190, 150, 330], [30, 0, 0]],
      front: [[cx, 0, dist], [cx, 0, 0]],
      top: [[cx, dist, 0.01], [cx, 0, 0]],
      zone: [[52, 34, 96], [-2, 4, 0]],
      sub: [[40, 130, 250], [95, -15, -45]],
      machine: [[700, 200, 3350], [-230, -180, 0]],
      all: [[180, 170, 470], [60, -10, -30]],
    }[name];
    if (!views) return;
    const p1 = new THREE.Vector3(...views[0]), t1 = new THREE.Vector3(...views[1]);
    if (opts.instant) { c.position.copy(p1); t.copy(t1); this.anim = null; return; }
    // yumuşak geçiş: hedef ve uzaklık doğrusal, yön küresel ara değer (ease in-out, 550 ms)
    const d0 = c.position.clone().sub(t), d1 = p1.clone().sub(t1);
    this.anim = { t0: performance.now(), dur: 550, tA: t.clone(), tB: t1, rA: d0.length(), rB: d1.length(), qA: d0.normalize(), qB: d1.normalize() };
  }
  stepAnim() {
    const a = this.anim; if (!a) return;
    let k = Math.min(1, (performance.now() - a.t0) / a.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const t = this.controls.target.copy(a.tA).lerp(a.tB, e);
    const ang = a.qA.angleTo(a.qB);
    let dir;
    if (ang < 1e-4) dir = a.qB.clone();
    else { const s = Math.sin(ang); dir = a.qA.clone().multiplyScalar(Math.sin((1 - e) * ang) / s).add(a.qB.clone().multiplyScalar(Math.sin(e * ang) / s)); }
    this.camera.position.copy(t).add(dir.multiplyScalar(a.rA + (a.rB - a.rA) * e));
    if (k >= 1) this.anim = null;
  }
}
