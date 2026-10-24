// Star SB-20R Type G prosedürel 3D modeli (Star ürün fotoğrafı ve kinematik şemasına göre):
//  - kılavuz burç sütunu + mavi üst kapak, kayar başlık (Z1) + ana iş mili (C1)
//  - gang tool post (X1/Y1): 1…6 tornalama takımı siyah bağlama bloklarında, sağda çapraz tahrikli blok
//    (+X1/±Y1 etiketli, 11–14), tornalama takımlarının altında turuncu hortumlu kovan takımları (24…21)
//  - beyaz basamaklı karşı iş mili gövdesi (X2/Z2, C2), mavi arka ünite
//  - dış kabin (cabin.js) ve kırmızı eksen okları + canlı koordinat etiketleri
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat } from './materials.js';
import { createToolMesh, isRotary } from './toolMeshes.js';
import { LAYOUT } from '../sim/frames.js';
import { StockMesh } from './stockMesh.js';
import { buildCabin } from './cabin.js';
import { numberStrip, crossBlockTex, decalPlane, labelSprite } from './decals.js';
import { poseOf } from '../sim/pose.js';
import { bushBodies, gangBodies, subBodies, backBodies, SUB_NUT, PAN_Y } from '../sim/bodies.js';

const HEAD_K = 310;       // başlık pens alnı = parça ön alnı − HEAD_K
const DEG = Math.PI / 180;
const GANG = (t) => t.unit === 'gang' || t.unit === 'cross' || t.unit === 'front';

function rbox(w, h, d, m, x, y, z, parent, rad = 3) {
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(rad, w / 2.2, h / 2.2, d / 2.2));
  const b = new THREE.Mesh(g, typeof m === 'string' ? mat(m) : m);
  b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true;
  parent && parent.add(b);
  return b;
}
/** köşe koordinatlarıyla yuvarlatılmış kutu */
function rb(x0, x1, y0, y1, z0, z1, m, parent, rad = 3) {
  return rbox(x1 - x0, y1 - y0, z1 - z0, m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, parent, rad);
}
function box(w, h, d, m, x, y, z, parent) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === 'string' ? mat(m) : m);
  b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true;
  parent && parent.add(b);
  return b;
}
function cylX(r, len, m, x0, y = 0, z = 0, parent, seg = 48, r2 = null) {
  const g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg);
  g.rotateZ(Math.PI / 2); // eksen x
  const c = new THREE.Mesh(g, typeof m === 'string' ? mat(m) : m);
  c.position.set(x0 + len / 2, y, z); c.castShadow = true; c.receiveShadow = true;
  parent && parent.add(c);
  return c;
}
function ringX(rOut, rIn, len, m, x0, parent) {
  const sh = new THREE.Shape(); sh.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, rIn, 0, Math.PI * 2, true); sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 48 });
  g.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(g, typeof m === 'string' ? mat(m) : m);
  mesh.position.x = x0; mesh.castShadow = true; mesh.receiveShadow = true;
  parent && parent.add(mesh);
  return mesh;
}
/** bodies.js gövdesinden mesh (kutu: yuvarlatılmış; x silindiri/koni: delikli olabilir; y silindiri) */
function bodyMesh(bd, parent) {
  const m = bd.mat || 'darkSteel';
  if (bd.t === 'box') { const [x0, x1, y0, y1, z0, z1] = bd.b; return rb(x0, x1, y0, y1, z0, z1, m, parent, bd.r ?? 2); }
  if (bd.t === 'cyl') {
    if (bd.bore != null && bd.r0 === bd.r1) { const r = ringX(bd.r0, bd.bore, bd.x1 - bd.x0, m, bd.x0, parent); r.position.y = bd.cy; r.position.z = bd.cz; return r; }
    return cylX(bd.r1, bd.x1 - bd.x0, m, bd.x0, bd.cy, bd.cz, parent, 64, bd.r0);
  }
  const g = new THREE.CylinderGeometry(bd.r, bd.r, bd.y1 - bd.y0, 32);
  const c = new THREE.Mesh(g, mat(m)); c.position.set(bd.cx, (bd.y0 + bd.y1) / 2, bd.cz); c.castShadow = true; parent.add(c);
  return c;
}

/** Altıgen lokmalı (imbus) civata başı, +x yüzüne bakar */
function boltX(parent, x, y, z, r = 3.2) {
  const h = cylX(r, 2.6, 'blackOx', x, y, z, parent, 20);
  const s = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.8, 6), mat('rubber'));
  s.rotation.z = Math.PI / 2; s.position.set(x + 2.7, y, z); parent.add(s);
  return h;
}
/** Kılavuz burç / pens alnı: 3 yarıklı pens (C1/C2 dönüşü görünsün) */
function colletFace(parent, x, rOut, rIn, dir = 1) {
  const g = new THREE.Group(); parent.add(g);
  ringX(rOut, rIn, 4, 'steel', x - (dir > 0 ? 4 : 0), g);
  for (let k = 0; k < 3; k++) {
    const a = k * 2 * Math.PI / 3;
    const sl = box(4.4, 1.3, (rOut - rIn) * 0.9, 'blackOx', x - dir * 1.9, 0, 0, g);
    const rm = (rOut + rIn) / 2;
    sl.position.y = rm * Math.cos(a); sl.position.z = rm * Math.sin(a); sl.rotation.x = -a;
  }
  return g;
}

// Boğumlu (Loc-Line) soğutma hortumu segmenti: eksen +y, boy 4.6
let LOC_GEO = null;
function locGeo() {
  if (LOC_GEO) return LOC_GEO;
  const p = [[0, 0], [1.75, 0], [2.35, 0.9], [2.5, 2.3], [2.05, 4.0], [1.6, 4.6], [0, 4.6]].map(([r, y]) => new THREE.Vector2(r, y));
  LOC_GEO = new THREE.LatheGeometry(p, 14);
  return LOC_GEO;
}
function locLine(parent, pts, m = 'locline', scale = 1) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const L = curve.getLength(), step = 4.2 * scale, n = Math.max(2, Math.floor(L / step));
  const im = new THREE.InstancedMesh(locGeo(), mat(m), n + 1);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), S = new THREE.Vector3(scale, scale, scale);
  for (let k = 0; k <= n; k++) {
    const u = Math.min(1, k / n);
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    q.setFromUnitVectors(up, t);
    M.compose(p, q, S); im.setMatrixAt(k, M);
  }
  // uç memesi
  const tipP = curve.getPointAt(1), tipT = curve.getTangentAt(1);
  const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * scale, 1.7 * scale, 5 * scale, 12), mat(m));
  nz.position.copy(tipP).addScaledVector(tipT, 2.5 * scale);
  nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tipT.clone());
  parent.add(im); parent.add(nz);
  im.castShadow = true;
  return im;
}

// ---- eksen okları (Star kataloğundaki kırmızı çift yönlü oklar) ----
function arrow2(len, r = 1.8) {
  const g = new THREE.Group();
  const m = mat('arrow');
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len - 24, 12), m); g.add(shaft);
  for (const s of [1, -1]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r * 3.4, 12, 16), m);
    c.position.y = s * (len / 2 - 6); if (s < 0) c.rotation.z = Math.PI; g.add(c);
  }
  return g; // eksen +y
}
function arrowRot(radius, r = 1.4) {
  const g = new THREE.Group();
  const m = mat('arrow');
  const arc = 1.5 * Math.PI;
  const tor = new THREE.Mesh(new THREE.TorusGeometry(radius, r, 8, 48, arc), m); g.add(tor);
  const c = new THREE.Mesh(new THREE.ConeGeometry(r * 3.4, 9, 14), m);
  c.position.set(radius * Math.cos(arc), radius * Math.sin(arc), 0);
  c.rotation.z = arc; // teğet yönünde
  g.add(c);
  return g; // xy düzleminde, eksen z
}

export class MachineModel {
  constructor(project) {
    this.project = project;
    this.root = new THREE.Group();
    this.tools = new Map();
    this.labels = {};
    this.build();
  }

  build() {
    const R = this.root, P = this.project;
    const barR = P.stock.barDia / 2;
    // ---- dış kabin ----
    this.cabin = buildCabin();
    R.add(this.cabin.group);
    // ---- iç taban: kılavuz burç sütunu ve kızak yatakları ----
    this.inner = new THREE.Group(); R.add(this.inner);
    const I = this.inner;
    // burç ünitesi: çarpışma kontrolüyle aynı gövdeler (ince konik uç; çapraz takım pens somunları üstünden geçer)
    for (const bd of bushBodies()) bodyMesh(bd, I);
    rb(-98, 80, 250, 330, -300, 250, 'starBlue', I, 10);                         // mavi üst kapak
    cylX(56, 1.5, 'paintMid', -32, 0, 0, I, 64);                                 // burç yuvası (sütun yüzünde ince halka)
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + 0.5; boltX(I, -26, 28.5 * Math.cos(a), 28.5 * Math.sin(a), 1.8); }
    colletFace(I, LAYOUT.bushFace, 11, barR + 0.02, 1);                          // kılavuz burç (somunun önünde)
    // karşı iş mili ve arka ünite tablası
    rb(40, 560, PAN_Y, PAN_Y + 26, -230, 130, 'castDark', I, 5);
    for (const z of [-60, 60]) rb(60, 540, PAN_Y + 26, PAN_Y + 36, z - 9, z + 9, 'chrome', I, 2);
    // ---- kayar başlık (Z1) — kabinin içinde, burç sütununun arkasında ----
    this.head = new THREE.Group(); R.add(this.head);
    rbox(190, 70, 170, 'paint', -95, -68, 0, this.head, 8);                      // sürgü
    cylX(60, 165, 'paint', -175, 0, 0, this.head, 64);                           // iş mili gövdesi
    cylX(61, 8, 'starBlue', -60, 0, 0, this.head, 64);
    cylX(46, 12, 'steel', -10, 0, 0, this.head, 64);                             // ön flanş
    ringX(30, barR + 1, 24, 'darkSteel', 2, this.head);
    this.mainNose = new THREE.Group(); this.head.add(this.mainNose);
    ringX(22, barR + 0.2, 10, 'chrome', 26, this.mainNose);                     // pens somunu
    for (let k = 0; k < 4; k++) { const s2 = box(10, 4, 3, 'blackOx', 31, 0, 0, this.mainNose); const a = k * Math.PI / 2; s2.position.y = 21 * Math.cos(a); s2.position.z = 21 * Math.sin(a); }
    rbox(70, 56, 80, 'starBlue', -150, 82, 0, this.head, 8);                     // iş mili motoru
    rb(-560, -90, PAN_Y, -103, -95, 95, 'castDark', R, 5);                       // başlık yatağı (sabit)
    for (const z of [-55, 55]) rb(-550, -100, -103, -95, z - 8, z + 8, 'chrome', R, 2);
    // çubuk (stok ızgarası dışında kalan kısım)
    this.bar = cylX(barR, 900, 'stock', -900, 0, 0, R, 48);

    this.buildGang();
    this.buildSub(barR);
    this.buildBack();

    // soğutma sıvısı püskürtme efekti
    this.spray = new THREE.Group(); R.add(this.spray);
    const sg = new THREE.ConeGeometry(2.0, 14, 16, 1, true); sg.translate(0, -7, 0);
    this.sprayMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.1, metalness: 0 }));
    this.spray.add(this.sprayMesh);
    this.spray.visible = false;
    this.buildAxes();
  }

  // ---------------------------------------------------------------- gang tool post (X1/Y1)
  buildGang() {
    const P = this.project;
    const G = this.gang = new THREE.Group(); this.root.add(G);
    const all = P.tools.filter(GANG);
    for (const t of all) this.addTool(t, G);
    const zs = all.map(t => t.yPos);
    this.gangZ = [Math.min(...zs, 0) - 22, Math.max(...zs, 0) + 30];
    // ünite gövdeleri: çarpışma kontrolüyle aynı liste (takım gövdeleri hariç — takımlar ayrıntılı modelle çizilir)
    for (const bd of gangBodies(P.tools)) {
      if (bd.tool || bd.spindleOf) continue;
      if (bd.motor) {
        const [x0, x1, y0, y1, z0, z1] = bd.b;
        const mg = new THREE.CylinderGeometry((x1 - x0) / 2, (x1 - x0) / 2, z1 - z0, 32); mg.rotateX(Math.PI / 2);
        const mot = new THREE.Mesh(mg, mat(bd.mat)); mot.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); mot.castShadow = true; G.add(mot);
        continue;
      }
      const m = bodyMesh(bd, G);
      if (bd.strip === 'front' || /Kovan bloğu kolu/.test(bd.name || '')) {
        // kovan bloğu: kovan takımı kullanılmıyorken "aktif + saydam" modunda saydam (görüşü kapatmasın)
        m.material = m.material.clone(); (this.frontUnit ||= []).push(m.material);
      }
      if (bd.clamp) { // bağlama bloğu: sıkma yarığı + 2 civata
        const z = bd.clamp.yPos;
        rb(15, 19.4, 60, 88, z - 1.1, z + 1.1, 'rubber', G, 0.4);
        boltX(G, 19, 50, z - 3.4); boltX(G, 19, 74, z - 3.4);
      }
      if (bd.strip === 'turn') {
        const turn = all.filter(t => t.unit === 'gang').sort((p, q) => q.yPos - p.yPos);
        const [, x1, , , z0, z1] = bd.b;
        const strip = decalPlane(z1 - z0 - 6, 22, numberStrip(turn.map(t => t.num), 64 * turn.length, 64, { circleFirst: true }));
        strip.rotation.y = Math.PI / 2; strip.position.set(x1 + 0.2, 103, (z0 + z1) / 2); G.add(strip);
      } else if (bd.strip === 'cross') {
        const nums = all.filter(t => t.unit === 'cross').sort((p, q) => p.num - q.num).map(t => t.num);
        const [, x1, , , z0, z1] = bd.b;
        const lab = decalPlane(Math.min(64, z1 - z0 - 4), 64, crossBlockTex(nums));
        lab.rotation.y = Math.PI / 2; lab.position.set(x1 + 0.2, 88, (z0 + z1) / 2); G.add(lab);
      } else if (bd.strip === 'front') {
        const front = all.filter(t => t.unit === 'front');
        const [, x1, y0, y1] = bd.b;
        for (const t of front) {
          boltX(G, x1, (y0 + y1) / 2 + 7, t.yPos + 5, 2.6);
          const v = this.tools.get(t.id);
          v.hose = new THREE.Group(); v.holder.add(v.hose);   // hortum takım çerçevesinde (uç orijinde)
          locLine(v.hose, [[44, 13, -6], [34, 15, -6], [22, 12, -5], [11, 7, -3.5]], t.num % 2 ? 'locline' : 'locBlue', 0.85);
        }
        const fs = [...front].sort((p, q) => q.yPos - p.yPos);
        const a = Math.min(...front.map(t => t.yPos)) - 11, b2 = Math.max(...front.map(t => t.yPos)) + 11;
        const strip = decalPlane(b2 - a, 10, numberStrip(fs.map(t => t.num), 64 * fs.length, 48, { bg: '#24262a', fg: '#e9ecef' }));
        strip.rotation.y = Math.PI / 2; strip.position.set(x1 + 0.3, (y0 + y1) / 2 - 7, (a + b2) / 2); G.add(strip);
      }
    }
  }

  // ---------------------------------------------------------------- karşı iş mili (X2/Z2)
  buildSub(barR) {
    const S = this.sub = new THREE.Group(); this.root.add(S);
    this.subNose = new THREE.Group(); S.add(this.subNose);
    for (const bd of subBodies(barR)) bodyMesh(bd, bd.collet ? this.subNose : S);
    colletFace(this.subNose, -SUB_NUT - 0.4, 9.5, barR + 0.3, -1);
    for (let k = 0; k < 4; k++) { const s2 = box(8, 3.5, 3, 'blackOx', -SUB_NUT / 2, 0, 0, this.subNose); const a = k * Math.PI / 2 + Math.PI / 4; s2.position.y = 17.6 * Math.cos(a); s2.position.z = 17.6 * Math.sin(a); }
  }

  // ---------------------------------------------------------------- arka ünite (sabit, mavi)
  buildBack() {
    const P = this.project;
    this.back = new THREE.Group(); this.root.add(this.back);
    const bt = P.tools.filter(t => t.unit === 'back' || t.unit === 'rear');
    if (!bt.length) return;
    for (const bd of backBodies(P.tools)) if (!bd.tool) bodyMesh(bd, this.back);
    const X = LAYOUT.backToolX;
    for (const t of bt) { boltX(this.back, X - 30, 15, LAYOUT.backLat + t.yPos, 2.2); boltX(this.back, X - 30, -15, LAYOUT.backLat + t.yPos, 2.2); }
    for (const t of bt) this.addTool(t, this.back);
  }

  // ---------------------------------------------------------------- eksen okları + etiketler
  buildAxes() {
    const A = this.axes = new THREE.Group(); this.root.add(A);
    const mk = (parent, name, pos, rotObj = null, len = 70, labelAt = null) => {
      const a = arrow2(len);
      if (rotObj) a.rotation.set(...rotObj);
      a.position.set(...pos);
      parent.add(a);
      const s = labelSprite({ name, value: '' });
      s.position.set(...(labelAt || [pos[0], pos[1] + len / 2 + 6, pos[2]]));
      parent.add(s);
      this.labels[name] = s;
      this.axisObjs.push(a, s);
    };
    this.axisObjs = [];
    const zMax = this.gangZ[1];
    // Z1: başlık (pens eksenine paralel)
    mk(this.head, 'Z1', [-120, 125, 0], [0, 0, Math.PI / 2], 110, [-120, 142, 0]);
    // X1 (dikey) ve Y1 (yanal): gang kızağının dış ucunda
    mk(this.gang, 'X1', [30, 150, zMax + 34], null, 80, [30, 196, zMax + 34]);
    mk(this.gang, 'Y1', [30, 150, zMax + 34], [Math.PI / 2, 0, 0], 80, [30, 150, zMax + 80]);
    // C1: burç önünde dönüş oku
    const c1 = arrowRot(36, 0.7); c1.rotation.y = Math.PI / 2; c1.position.set(-10, 0, 0); this.inner.add(c1);
    const c1s = labelSprite({ name: 'C1' }); c1s.position.set(-8, -44, 26); this.inner.add(c1s); this.labels.C1 = c1s;
    this.axisObjs.push(c1, c1s);
    // X2 (yanal) ve Z2 (eksenel): karşı iş mili gövdesinin üstünde
    mk(this.sub, 'Z2', [180, 74, 0], [0, 0, Math.PI / 2], 110, [244, 100, 0]);
    mk(this.sub, 'X2', [180, 74, 0], [Math.PI / 2, 0, 0], 110, [180, 66, 64]);
    const c2 = arrowRot(28, 0.9); c2.rotation.y = -Math.PI / 2; c2.position.set(12, 0, 0); this.sub.add(c2);
    const c2s = labelSprite({ name: 'C2' }); c2s.position.set(14, -36, 26); this.sub.add(c2s); this.labels.C2 = c2s;
    this.axisObjs.push(c2, c2s);
  }

  setAxesVisible(on) { if (this.axes) for (const o of this.axisObjs) o.visible = on; }
  /** kabin: 'full' | 'cut' (ön kapaklar gizli) | 'none' */
  setCabin(mode) {
    this.cabin.group.visible = mode !== 'none';
    this.cabin.front.visible = mode === 'full';
  }
  /** Eksen etiketlerine makine konumlarını yaz */
  updateLabels() {
    const p1 = this.pose1?.m, p2 = this.pose2?.m;
    const L = this.labels, f = (v, d = 3) => (v ?? 0).toFixed(d);
    if (!p1 || !L.X1) return;
    L.X1.userData.update('X1', f(p1.X));
    L.Y1.userData.update('Y1', f(p1.Y));
    L.Z1.userData.update('Z1', f(p1.Z));
    L.C1.userData.update('C1', this.m1?.state?.cAxis ? f(this.pose1.p.C, 2) + '°' : 'SPN');
    if (p2) {
      L.X2.userData.update('X2', f(p2.X));
      L.Z2.userData.update('Z2', f(p2.Z));
      L.C2.userData.update('C2', this.m2?.state?.sub?.dir !== 'stop' ? 'SPN' : f(this.pose2.p.C || 0, 2) + '°');
    }
  }

  addTool(t, parent) {
    const g = createToolMesh(t);
    const holder = new THREE.Group();
    holder.add(g);
    if (t.unit === 'gang' || t.unit === 'cross') {
      holder.position.set(0, t.xPos || 0, t.yPos);  // uç aşağı bakar
    } else if (t.unit === 'front') {
      g.rotation.z = -Math.PI / 2;                    // gövde +x, uç −x'e bakar
      holder.position.set(0, t.xPos || 0, t.yPos);
    } else {
      if (isRotary(t)) g.rotation.z = Math.PI / 2;     // gövde −x, uç +x'e bakar
      else {
        // eksenel bağlanan tornalama takımı: sap −x, kesici uç radyal dışarı (+z) — bodies.js ile aynı
        g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)));
      }
      holder.position.set(LAYOUT.backToolX, 0, LAYOUT.backLat + t.yPos);
    }
    if (t.unit === 'cross') {
      // tahrikli iş mili gövdesi: pens somunu üstünden ünite gövdesine
      const bb = new THREE.Box3().setFromObject(g);
      const top = bb.max.y, h = Math.max(2, 52 - top);
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, h, 32), mat('darkSteel'));
      sp.position.y = top + h / 2; sp.castShadow = true;
      holder.add(sp);
    } else if (t.unit === 'front' || t.unit === 'back' || t.unit === 'rear') {
      // kovan: takım gövdesinden bloğa kadar silindir kovan
      const bb = new THREE.Box3().setFromObject(g);
      const R = Math.max(7, (t.dia || 4) / 2 + 4);
      const sgn = t.unit === 'front' ? 1 : -1;
      const tail = sgn > 0 ? bb.max.x : -bb.min.x;
      const x0 = Math.max(14, tail - 14), x1 = t.unit === 'front' ? 58 : 62;
      if (x1 > x0) {
        const s = cylX(R, x1 - x0, 'darkSteel', sgn > 0 ? x0 : -x1, 0, 0, holder, 28);
        s.castShadow = true;
      }
    }
    parent.add(holder);
    // takım başına malzeme kopyası (aktif olmayanları saydam gösterebilmek için)
    const mats = [];
    holder.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
    this.tools.set(t.id, { tool: t, holder, mesh: g, rotary: isRotary(t), mats, alpha: 1 });
  }

  /** Stok ağlarını bağla */
  attachStock(stockSim) {
    if (this.partMesh) { this.partMesh.mesh.removeFromParent(); this.partMesh.dispose(); }
    if (this.barMesh) { this.barMesh.mesh.removeFromParent(); this.barMesh.dispose(); }
    const S = stockSim.stock;
    const iL = S.idx(stockSim.L + (stockSim.bs || 0) + stockSim.cutW * 0.5);
    this.stockSim = stockSim;
    this.partMesh = new StockMesh(S, 0, iL);
    this.barMesh = new StockMesh(S, iL, S.nz - 1);
    this.mainSpin = new THREE.Group(); this.mainHolder = new THREE.Group();
    this.mainHolder.add(this.mainSpin);
    this.mainSpin.add(this.partMesh.mesh); this.mainSpin.add(this.barMesh.mesh);
    this.root.add(this.mainHolder);
    this.subSpin = new THREE.Group(); this.subHolder = new THREE.Group();
    this.subHolder.add(this.subSpin); this.root.add(this.subHolder);
  }

  /** Simülasyon durumuna göre poz */
  update(stockSim, t, dt) {
    const st = stockSim.state;
    const m1 = stockSim.currentMove(1), m2 = stockSim.currentMove(2);
    const pose1 = poseOf(m1, t, 1, this.project.machine), pose2 = poseOf(m2, t, 2, this.project.machine);
    this.pose1 = pose1; this.pose2 = pose2; this.m1 = m1; this.m2 = m2;
    // ana parça ön alnı (dünya x)
    const front = stockSim.mainFrontWorld(pose1.m.Z);
    this.head.position.x = pose1.m.Z - HEAD_K;   // başlık makine Z1'inde (pens açıkken çubuktan bağımsız geri gider)
    this.mainHolder.position.x = front;
    this.bar.position.x = front - stockSim.stock.dMax - 450;
    // dönüş
    const s1 = m1 ? m1.state : null;
    if (s1 && s1.cAxis) this.mainSpin.rotation.x = (pose1.p.C || 0) * DEG;
    else if (s1 && s1.main.dir !== 'stop') this.mainSpin.rotation.x += spinStep(m1, dt, s1.main.dir);
    this.mainNose.rotation.x = this.mainSpin.rotation.x;
    // gang tablası: makine X1 (çap) / Y1; takımlar tabla üzerinde (xPos, yPos) konumunda
    const tool1 = s1 ? s1.tool : null;
    this.gang.position.set(0, pose1.m.X / 2, pose1.m.Y);
    // soğutma: aktif takım ucunda püskürtme
    const cool1 = s1 && s1.coolant && tool1 && m1 && m1.kind !== 'rapid';
    this.spray.visible = !!cool1;
    if (cool1) {
      const axial = tool1.unit === 'front';
      this.spray.position.set(axial ? 6 : 4, pose1.p.X / 2 + (axial ? 4 : 7), pose1.p.Y || 0);
      this.spray.rotation.set(0, 0, axial ? -0.9 : 0.35);
      this.sprayMesh.scale.y = 0.85 + 0.3 * Math.random();
    }
    // karşı iş mili
    const s2 = m2 ? m2.state : null;
    const subFace = pose2.m.Z, subLat = pose2.m.X;
    this.sub.position.set(subFace, 0, subLat);
    if (s2 && s2.subCAxis) this.subNose.rotation.x = (pose2.p.C || 0) * DEG;            // C2 konumlama
    else if (s2 && s2.sub.dir !== 'stop') this.subNose.rotation.x += spinStep(m2, dt, s2.sub.dir, 'sub');
    // parça karşı iş milinde mi?
    const grip = stockSim.sim.frames ? stockSim.L - stockSim.sim.frames.projection : 5;
    if (st.attached === 'sub' || st.attached === 'ejected') {
      if (this.partMesh.mesh.parent !== this.subSpin) this.subSpin.add(this.partMesh.mesh);
      this.subHolder.position.set(subFace + grip, 0, subLat);
      this.subSpin.rotation.x = this.subNose.rotation.x;
      this.partMesh.mesh.visible = st.attached === 'sub';
    } else if (st.attached === 'dropped') {
      this.partMesh.mesh.visible = false;
    } else {
      if (this.partMesh.mesh.parent !== this.mainSpin) this.mainSpin.add(this.partMesh.mesh);
      this.partMesh.mesh.visible = true;
    }
    // tahrikli takım dönüşü
    for (const [, v] of this.tools) {
      if (!v.rotary) continue;
      const t = v.tool;
      const live = t.unit === 'cross' ? s1 && s1.live.dir !== 'stop' && s1.tool === t : (t.unit === 'back' && t.live) ? s2 && s2.backLive.dir !== 'stop' && s2.tool === t : false;
      if (live) v.mesh.children.forEach(c => { c.rotation.y += 0.6; });
    }
    this.activeTool1 = tool1; this.activeTool2 = s2 ? s2.tool : null;
    // takım görünürlüğü: all | ghost | active
    const mode = this.toolMode || 'ghost';
    if (this.frontUnit) {
      const a = mode === 'all' || (tool1 && tool1.unit === 'front') ? 1 : 0.22;
      if (a !== this._frontAlpha) { for (const m of this.frontUnit) { m.transparent = a < 1; m.opacity = a; m.depthWrite = a === 1; m.needsUpdate = true; } this._frontAlpha = a; }
    }
    for (const [, v] of this.tools) {
      const act = v.tool === this.activeTool1 || v.tool === this.activeTool2;
      const a = act || mode === 'all' ? 1 : mode === 'ghost' ? 0.12 : 0;
      v.holder.visible = a > 0;
      if (v.hose) v.hose.visible = a === 1;
      if (a !== v.alpha && a > 0) {
        for (const m of v.mats) { m.transparent = a < 1; m.opacity = a; m.depthWrite = a === 1; m.needsUpdate = true; }
      }
      v.alpha = a;
    }
    this.partMesh.update(dt === 0); this.barMesh.update(dt === 0);
  }
}

function spinStep(m, dt, dir, which = 'main') {
  const rpm = m.rpm || (m.state && (which === 'sub' ? m.state.sub.rpm : m.state.main.rpm)) || 1500;
  const vis = Math.min(rpm, 600) / 60 * 2 * Math.PI * dt; // görsel olarak sınırlı hız (stroboskop etkisini önler)
  return dir === 'ccw' ? -vis : vis;
}

export { poseOf };
