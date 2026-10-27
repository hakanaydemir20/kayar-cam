// Parça kurulum önizlemesi: yalnız parça, torna ekseni, ön/arka uç işaretleri ve referans (Z0 X0) üçlüsü.
// Çerçeve makineyle aynı: x = −d (ön alın x = 0, arka uç x = −L), y = yukarı (radyal), z = operatöre doğru.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toPart } from '../cad/featureRecog.js';

const C = { part: 0x9fb3c8, edge: 0x3b4a5a, front: 0x3ecf8e, back: 0xf5a524, axis: 0x93a1af, zero: 0x3b82f6, hover: 0x60a5fa };

function textSprite(text, color = '#e6edf3', bg = 'rgba(14,20,25,.86)', px = 0.022) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const f = '600 30px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
  g.font = f;
  const w = Math.ceil(g.measureText(text).width) + 28, hgt = 46;
  c.width = w; c.height = hgt;
  g.font = f;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(0, 0, w, hgt, 10); g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 14, hgt / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(px * w / hgt, px, 1);
  s.renderOrder = 30;
  return s;
}

function arrow(dir, len, color, origin) {
  const a = new THREE.ArrowHelper(new THREE.Vector3(...dir).normalize(), new THREE.Vector3(...origin), len, color, len * 0.22, len * 0.12);
  a.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } o.renderOrder = 25; });
  return a;
}

export class PartPreview {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    container.appendChild(r.domElement);
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x10161c);
    s.add(new THREE.HemisphereLight(0xe8f0ff, 0x1a2027, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(60, 120, 160); s.add(key);
    const rim = new THREE.DirectionalLight(0x9ec5ff, 0.6); rim.position.set(-120, 40, -100); s.add(rim);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 5000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.root = new THREE.Group(); s.add(this.root);
    this.overlay = new THREE.Group(); s.add(this.overlay);
    this.ray = new THREE.Raycaster();
    this.running = true;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container);
    this.resize();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.controls.update();
      r.render(s, this.camera);
    };
    loop();
  }
  dispose() {
    this.running = false;
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** part: parça (STEP için mesh + fixture), zShift: referans Z (ön alından), opts.highlight: 'front'|'zero'|null */
  setPart(part, zShift = 0, opts = {}) {
    const first = !this.part || this.part !== part;
    this.part = part;
    this.root.clear();
    const mat = new THREE.MeshStandardMaterial({ color: C.part, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide });
    let geo;
    if (part.mesh && part.fixture) {
      const m = part.mesh, P = m.positions, pos = new Float32Array(P.length);
      for (let i = 0; i < P.length; i += 3) {
        const q = toPart(part.fixture, [P[i], P[i + 1], P[i + 2]]);
        pos[i] = -q[0]; pos[i + 1] = q[1]; pos[i + 2] = q[2];
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
      geo.computeVertexNormals();
      this.meshKind = 'step';
    } else {
      const pts = part.profile.map(p => new THREE.Vector2(Math.max(0, p.r), -p.z));
      geo = new THREE.LatheGeometry(pts, 120);
      geo.rotateZ(-Math.PI / 2);
      this.meshKind = 'profile';
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.root.add(this.mesh);
    this.root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), new THREE.LineBasicMaterial({ color: C.edge })));
    if (first) this.fit();
    this.setMarks(zShift, opts);
  }

  fit() {
    const L = this.part.length, R = this.part.maxDia / 2;
    const span = Math.max(L, R * 2.4) * 1.25;
    this.controls.target.set(-L / 2, 0, 0);
    this.camera.position.set(-L / 2 + span * 0.95, span * 0.42, span * 1.3);
    this.camera.near = span / 200; this.camera.far = span * 40; this.camera.updateProjectionMatrix();
  }

  /** Ön/arka uç halkaları, eksen çizgisi, kılavuz burç / karşı mil yön oku, referans üçlüsü */
  setMarks(zShift = 0, opts = {}) {
    const O = this.overlay; O.clear();
    const L = this.part.length, R = this.part.maxDia / 2;
    const S = Math.max(4, R * 0.9);
    // torna ekseni
    const ax = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(R * 1.2 + 6, 0, 0), new THREE.Vector3(-L - R * 1.2 - 6, 0, 0)]);
    const axl = new THREE.Line(ax, new THREE.LineDashedMaterial({ color: C.axis, dashSize: 1.6, gapSize: 1.1, depthTest: false, transparent: true, opacity: 0.8 }));
    axl.computeLineDistances(); axl.renderOrder = 20; O.add(axl);
    // uç halkaları
    const endR = (d0, d1) => { let m = 0; for (const p of this.part.profile) if (p.z >= d0 - 1e-9 && p.z <= d1 + 1e-9) m = Math.max(m, p.r); return m || R; };
    const ring = (x, color, bold) => {
      const re = x === 0 ? endR(0, Math.min(L, 0.6)) : endR(Math.max(0, L - 0.6), L);
      const g = new THREE.RingGeometry(re + 0.4, re + Math.max(1.2, re * (bold ? 0.35 : 0.2)), 96);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: bold ? 0.95 : 0.6, depthTest: false }));
      m.rotation.y = Math.PI / 2; m.position.x = x; m.renderOrder = 21; O.add(m);
      // alın yüzü dolgusu (yüze bakınca görünür)
      const d = new THREE.Mesh(new THREE.CircleGeometry(re + 0.4, 96), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: bold ? 0.45 : 0.22, depthWrite: false }));
      d.rotation.y = Math.PI / 2; d.position.x = x + (x === 0 ? 0.05 : -0.05); d.renderOrder = 22; O.add(d);
    };
    ring(0, C.front, opts.highlight === 'front');
    ring(-L, C.back, false);
    const fl = textSprite('ÖN YÜZ', '#3ecf8e'); fl.position.set(0, Math.max(R, S * 1.9) + S * 0.5, 0); fl.center.set(0.5, 0); O.add(fl);
    const bl = textSprite('ARKA · kesme', '#f5a524'); bl.position.set(-L, Math.max(R, S * 1.9) + S * 0.5, 0); bl.center.set(0.5, 0); O.add(bl);
    // makine yönü: çubuk kılavuz burçtan (−x) gelir, karşı iş mili +x'te (etiketler parçanın altında, içe doğru)
    const yb = -R - S * 0.9;
    O.add(arrow([1, 0, 0], S * 1.1, C.front, [-S * 1.2, yb, 0]));
    const dl = textSprite('karşı iş mili yönü', '#93a1af', 'rgba(14,20,25,.6)', 0.018); dl.position.set(-S * 1.3, yb, 0); dl.center.set(1, 0.5); O.add(dl);
    const bu = textSprite('kılavuz burç / çubuk tarafı', '#93a1af', 'rgba(14,20,25,.6)', 0.018); bu.position.set(-L, yb, 0); bu.center.set(0, 0.5); O.add(bu);
    // referans (Z0 X0): Z+ parçanın içine (−x), X+ yukarı
    const x0 = -zShift;
    const z = new THREE.Group(); z.position.set(x0, 0, 0); O.add(z);
    z.add(arrow([-1, 0, 0], S * 1.6, C.zero, [0, 0, 0]));
    z.add(arrow([0, 1, 0], S * 1.6, 0xf26d6d, [0, 0, 0]));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.5, R * 0.08), 20, 14), new THREE.MeshBasicMaterial({ color: C.zero, depthTest: false }));
    dot.renderOrder = 26; z.add(dot);
    const zl = textSprite('Z+', '#60a5fa', 'rgba(14,20,25,.6)', 0.019); zl.position.set(-S * 1.75, 0, 0); z.add(zl);
    const xl = textSprite('X+', '#f26d6d', 'rgba(14,20,25,.6)', 0.019); xl.position.set(0, S * 1.75, 0); z.add(xl);
    const rl = textSprite(`Z0 X0 · referans${zShift ? ' (ön alından ' + (+zShift.toFixed(3)) + ' mm)' : ''}`, '#ffffff', opts.highlight === 'zero' ? 'rgba(59,130,246,.92)' : 'rgba(30,58,138,.88)');
    rl.position.set(0, -S * 0.55, 0); rl.center.set(0.5, 1); z.add(rl);
  }

  /** Fare olayından model üstündeki nokta: { d (ön alından), faceIndex } */
  pick(ev) {
    if (!this.mesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    return { d: -hit.point.x, faceIndex: hit.faceIndex, point: hit.point };
  }
}
