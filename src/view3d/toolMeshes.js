// Parametrik takım 3D modelleri (ISO ölçülerine yakın). Her takım: uç noktası orijinde,
// gövde +Y yönünde uzanır (takım -Y yönüne bakar). Makine modeli yönlendirir.
import * as THREE from 'three';
import { mat } from './materials.js';

const DEG = Math.PI / 180;

/** Helisli (oluklu) gövde: matkap/freze. nf oluk, R yarıçap, len boy, lead helis adımı */
export function flutedGeometry(R, len, nf, lead, opts = {}) {
  const segA = 48, segZ = Math.max(24, Math.ceil(len / 0.6));
  const pos = [], idx = [];
  const depth = opts.depth ?? 0.38;
  const prof = (phi) => {
    // her oluk için bir vadi: r = R * (1 - depth * vadi)
    const k = (phi * nf / (2 * Math.PI)) % 1;
    const v = Math.pow(Math.max(0, Math.sin(k * Math.PI)), 1.6);
    return R * (1 - depth * v);
  };
  for (let iz = 0; iz <= segZ; iz++) {
    const y = (len * iz) / segZ;
    const tw = (y / lead) * 2 * Math.PI;
    for (let ia = 0; ia <= segA; ia++) {
      const phi = (ia / segA) * 2 * Math.PI;
      const r = prof(((phi - tw) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
      pos.push(r * Math.cos(phi), y, r * Math.sin(phi));
    }
  }
  const row = segA + 1;
  for (let iz = 0; iz < segZ; iz++) for (let ia = 0; ia < segA; ia++) {
    const a = iz * row + ia, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function cyl(r, h, mtl, y0 = 0, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(mtl));
  m.position.y = y0 + h / 2;
  return m;
}
function cone(r, h, mtl, y0 = 0, flip = false) {
  const g = new THREE.ConeGeometry(r, h, 32);
  if (!flip) g.rotateX(Math.PI); // uç aşağı
  const m = new THREE.Mesh(g, mat(mtl));
  m.position.y = y0 + h / 2;
  return m;
}
function box(w, h, d, mtl, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(mtl));
  m.position.set(x, y, z);
  return m;
}

/** ER pens somunu + pens */
function erNut(y0, size = 'ER16') {
  const g = new THREE.Group();
  const D = size === 'ER11' ? 19 : 28;
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2 - 1, 11, 6), mat('chrome'));
  nut.position.y = y0 + 5.5;
  g.add(nut);
  const collet = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 - 5, D / 2 - 3, 4, 24), mat('steel'));
  collet.position.y = y0 - 1;
  g.add(collet);
  return g;
}

/** Tornalama kateri: eşkenar dörtgen uç (VCMT 35° / DCMT 55°), □12 sap */
function turningTool(t) {
  const g = new THREE.Group();
  const rn = Math.max(t.noseR || 0.2, 0.05);
  const ang = (t.insertAngle || 35) * DEG;
  const edge = 11;
  const e1 = [Math.cos(87 * DEG), Math.sin(87 * DEG)];          // ana kesme kenarı (−x tarafı, 93° yaklaşma)
  const e2 = [Math.cos(87 * DEG - ang), Math.sin(87 * DEG - ang)]; // arka kenar
  const sh = new THREE.Shape();
  // burun radyüslü dörtgen
  const c = [rn * (e1[0] + e2[0]) / Math.sin(ang) * Math.sin(ang / 2) / Math.cos(ang / 2) * 0, 0];
  const bis = Math.atan2(e1[1] + e2[1], e1[0] + e2[0]);
  const dc = rn / Math.sin(ang / 2);
  const cx = Math.cos(bis) * dc, cy = Math.sin(bis) * dc;
  const a1 = Math.atan2(e1[1], e1[0]) + Math.PI / 2, a2 = Math.atan2(e2[1], e2[0]) - Math.PI / 2;
  sh.moveTo(cx + rn * Math.cos(a2), cy + rn * Math.sin(a2));
  sh.absarc(cx, cy, rn, a2, a1, true);
  const v1 = [e1[0] * edge, e1[1] * edge], v3 = [e2[0] * edge, e2[1] * edge];
  sh.lineTo(v1[0], v1[1]);
  sh.lineTo(v1[0] + v3[0], v1[1] + v3[1]);
  sh.lineTo(v3[0], v3[1]);
  sh.closePath();
  void c;
  const ig = new THREE.ExtrudeGeometry(sh, { depth: 3.18, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 1 });
  ig.translate(0, -cy + rn, -1.59);
  // burun teğet noktası orijinde olsun: uç noktası (rn ile) en alt nokta
  const insert = new THREE.Mesh(ig, mat('tin'));
  // uç yeri y=0 (alt), x=0 (−x yan) — hayali uç
  ig.computeBoundingBox();
  const bb = ig.boundingBox;
  insert.position.set(-bb.min.x, -bb.min.y, 0);
  g.add(insert);
  // vida
  const screw = cyl(1.6, 1.0, 'blackOx', 0, 16);
  screw.rotation.x = Math.PI / 2;
  screw.position.set(insert.position.x + v3[0] * 0.55 + v1[0] * 0.2, insert.position.y + 4.5, 1.7);
  g.add(screw);
  // tutucu başı + sap
  const head = box(14, 10, 12, 'blackOx', 7.5, 10.5, 0);   // baş, uç düzleminin gerisine (burç tarafına) taşmaz
  g.add(head);
  const shank = box(12, 80, 12, 'blackOx', 7, 55, 0);
  g.add(shank);
  return g;
}

/** Kanal / kesme bıçağı: genişlik w (dünya x boyunca, uç [−w, 0]) */
function bladeTool(t) {
  const g = new THREE.Group();
  const w = t.width || 2;
  const tip = box(w, 3.5, 4, 'tin', -w / 2, 1.75, 0);
  g.add(tip);
  // Swiss gang bıçak tutucusu: bıçak sapa ortalı, ~12 mm yükseklik (komşu takımlara taşmaz)
  const blade = box(w * 0.85, 22, 12, 'darkSteel', -w / 2, 13, 0);
  g.add(blade);
  const clamp = box(w * 0.85 + 8, 12, 14, 'blackOx', -w / 2 + 2, 28, 0);
  g.add(clamp);
  const shank = box(12, 70, 12, 'blackOx', 4, 64, 0);
  g.add(shank);
  return g;
}

/** Diş kateri: 60° profil uç */
function threadTool(t) {
  const g = new THREE.Group();
  const sh = new THREE.Shape();
  // 60° profil uç; tutucu burç tarafına (−x) taşmaz (uç burçtan 3.2 mm önde çalışır)
  sh.moveTo(0, 0); sh.lineTo(3, 5.2); sh.lineTo(-3, 5.2); sh.closePath();
  const ig = new THREE.ExtrudeGeometry(sh, { depth: 3.5, bevelEnabled: false });
  ig.translate(0, 0, -1.75);
  const ins = new THREE.Mesh(ig, mat('tin'));
  g.add(ins);
  g.add(box(14, 10, 12, 'blackOx', 5, 10.5, 0));
  g.add(box(12, 80, 12, 'blackOx', 6, 55, 0));
  return g;
}

/** Matkap (HSS/karbür), punta, kılavuz, parmak freze */
function rotaryTool(t, holderType) {
  const g = new THREE.Group();
  const R = Math.max(0.3, (t.dia || 3) / 2);
  const fluteLen = Math.max(8, Math.min(45, (t.dia || 3) * 4 + 6));
  let y = 0;
  if (t.type === 'drill' || t.type === 'ldrill' || t.type === 'center') {
    const tipA = ((t.tipAngle || 118) / 2) * DEG;
    const tipH = R / Math.tan(tipA);
    g.add(cone(R, tipH, t.type === 'ldrill' ? 'tialn' : 'hss', 0));
    y = tipH;
    if (t.type === 'center') {
      g.add(cyl(R, 6, 'hss', y)); y += 6;
      g.add(cyl(Math.max(R, 3), 20, 'hss', y)); y += 20;
    } else {
      const fl = new THREE.Mesh(flutedGeometry(R, fluteLen, 2, R * 2 * Math.PI * 1.1, { depth: 0.42 }), mat(t.type === 'ldrill' ? 'tialn' : 'hss'));
      fl.position.y = y; g.add(fl); y += fluteLen;
      g.add(cyl(R * 0.98, 18, t.type === 'ldrill' ? 'carbide' : 'hss', y)); y += 18;
    }
  } else if (t.type === 'tap' || t.type === 'ltap') {
    // dişli bölge
    const p = t.pitch || 1;
    const segs = Math.ceil(12 / p);
    for (let k = 0; k < segs; k++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.82, p * 0.55, 24), mat('chrome'));
      ring.position.y = 1 + k * p + p * 0.3;
      g.add(ring);
    }
    g.add(cone(R * 0.8, 1.2, 'chrome', 0));
    g.add(cyl(R * 0.8, 12, 'steel', 0.5));
    y = 13;
    g.add(cyl(R * 0.75, 22, 'steel', y)); y += 22;
    g.add(box(R * 1.2, 6, R * 1.2, 'steel', 0, y + 3, 0)); y += 6;
  } else if (t.type === 'endmill') {
    const fl = new THREE.Mesh(flutedGeometry(R, fluteLen * 0.8, t.flutes || 3, R * 2 * Math.PI * 1.7, { depth: 0.3 }), mat('tialn'));
    g.add(fl); y = fluteLen * 0.8;
    g.add(cyl(R, 20, 'carbide', y)); y += 20;
  }
  // tutucu
  if (holderType === 'er') {
    g.add(erNut(y - 14, t.unit === 'cross' && (t.dia || 0) <= 5 ? 'ER11' : 'ER16'));
  } else if (holderType === 'sleeve') {
    g.add(cyl(Math.max(R + 3, 6), 30, 'blackOx', y - 12));
  }
  return g;
}

/** Kullanıcı STEP takım modelleri: tool.id → { positions, indices } (model koordinatında) */
export const customToolModels = new Map();

/** STEP modelini takım çerçevesine yerleştir: en uzun eksen → +Y, uç (min ya da max) orijinde */
export function customToolMesh(t) {
  const m = customToolModels.get(t.id);
  if (!m) return null;
  const P = m.positions;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  const ext = [0, 1, 2].map(k => mx[k] - mn[k]);
  let ax = t.model?.axis ?? ext.indexOf(Math.max(...ext));
  const flip = !!t.model?.flip;
  const c = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2);
  const pos = new Float32Array(P.length);
  const o = [(ax + 1) % 3, (ax + 2) % 3];
  for (let i = 0; i < P.length; i += 3) {
    const along = flip ? mx[ax] - P[i + ax] : P[i + ax] - mn[ax];
    pos[i] = P[i + o[0]] - c[o[0]];
    pos[i + 1] = along;
    pos[i + 2] = P[i + o[1]] - c[o[1]];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  const grp = new THREE.Group();
  const mesh = new THREE.Mesh(g, mat('steel').clone());
  if (t.model?.rotY) mesh.rotation.y = t.model.rotY * Math.PI / 180;
  grp.add(mesh);
  return grp;
}

export function createToolMesh(t) {
  let g = customToolMesh(t);
  if (g) { g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.userData.tool = t; return g; }
  if (t.type === 'turn') g = turningTool(t);
  else if (t.type === 'groove' || t.type === 'cutoff') g = bladeTool(t);
  else if (t.type === 'thread') g = threadTool(t);
  else g = rotaryTool(t, t.unit === 'cross' || (t.unit === 'back' && t.live) ? 'er' : 'sleeve');
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.tool = t;
  return g;
}

/** Dönen takımlar için dönecek alt grup (takım ekseni Y) */
export function isRotary(t) {
  return !['turn', 'groove', 'cutoff', 'thread'].includes(t.type);
}
