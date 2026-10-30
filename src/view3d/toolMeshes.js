// Parametrik takım 3D modelleri (ISO ölçülerine yakın). Her takım: uç noktası orijinde,
// gövde +Y yönünde uzanır (takım -Y yönüne bakar). Makine modeli yönlendirir.
import * as THREE from 'three';
import { sleeveSpan } from '../tools/toolGeom.js';
import { insertOutline, insertShapeOf } from '../tools/toolLibrary.js';
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

/** Tornalama kateri (görseldeki gibi): talaş kırıcılı, vida delikli ISO uç; ucun altında oturma yatağı,
 *  arkasında pahlı tutucu başı, Torx sıkma vidası ve □12 sap. Hayali uç orijinde, gövde +y. */
function turningTool(t) {
  const g = new THREE.Group();
  const pts = insertOutline(t);
  const W = Math.max(...pts.map(p => p[0])), H = Math.max(...pts.map(p => p[1]));
  const c = pts.reduce((s2, p) => [s2[0] + p[0] / pts.length, s2[1] + p[1] / pts.length], [0, 0]);
  // iç teğet daire ≈ merkeze en yakın kenar uzaklığı (vida deliği ve talaş kırıcı bunun içinde)
  let rin = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    rin = Math.min(rin, Math.abs((x2 - x1) * (y1 - c[1]) - (x1 - c[0]) * (y2 - y1)) / L);
  }
  const hole = Math.max(0.6, Math.min(1.7, rin * 0.38));
  const shape = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y))); shape.closePath();
  const hp = new THREE.Path(); hp.absarc(c[0], c[1], hole, 0, Math.PI * 2, true); shape.holes.push(hp);
  const T = 3.18;
  const ig = new THREE.ExtrudeGeometry(shape, { depth: T - 0.3, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 1, curveSegments: 24 });
  ig.translate(0, 0, -T / 2 + 0.15);
  ig.computeBoundingBox();
  const off = [-ig.boundingBox.min.x, -ig.boundingBox.min.y];   // hayali uç orijinde (pah payı dahil)
  const ins = new THREE.Group(); ins.position.set(off[0], off[1], 0); g.add(ins);
  ins.add(new THREE.Mesh(ig, mat('tin')));
  // üst yüz çizgileri: talaş kırıcı oluğu (kenara paralel iç hat) ve vida havşası
  const lineM = new THREE.LineBasicMaterial({ color: 0x3a2a08 });
  const zTop = T / 2 + 0.16;
  const loop = (k) => { const q = pts.map(([x, y]) => new THREE.Vector3(c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k, zTop)); q.push(q[0].clone()); return new THREE.Line(new THREE.BufferGeometry().setFromPoints(q), lineM); };
  ins.add(loop(0.84), loop(0.72));
  const ring = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2; ring.push(new THREE.Vector3(c[0] + (hole + 0.55) * Math.cos(a), c[1] + (hole + 0.55) * Math.sin(a), zTop)); }
  ins.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), lineM));
  const neg = /^[CDVTWSRK]N/i.test(String(t.insertCode || '').replace(/\s/g, ''));
  if (neg) {
    // negatif uç (görseldeki 1. ve 4. tutucu): kol pimi delikte, üstten pabuçlu baskı ucun arka köşesine basar
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(hole * 0.8, hole * 0.8, T + 0.6, 16), mat('steel'));
    pin.rotation.x = Math.PI / 2; pin.position.set(c[0], c[1], -0.1); ins.add(pin);
    const far = pts.reduce((m, p) => (Math.hypot(p[0], p[1]) > Math.hypot(m[0], m[1]) ? p : m), pts[0]);
    const cl = new THREE.Mesh(new THREE.BoxGeometry(Math.max(3, rin * 1.1), 2.6, 1.6), mat('blackOx'));
    cl.position.set((c[0] + far[0]) / 2, (c[1] + far[1]) / 2, T / 2 + 0.8); cl.rotation.z = Math.atan2(far[1] - c[1], far[0] - c[0]); ins.add(cl);
    const cs = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 12), mat('steel'));
    cs.rotation.x = Math.PI / 2; cs.position.set(cl.position.x, cl.position.y, T / 2 + 1.7); ins.add(cs);
  } else {
    // pozitif uç (görseldeki 2. ve 3. tutucu): Torx sıkma vidası deliğin içinde, başı yüzeyin hafif altında
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(hole * 0.92, hole * 0.92, T + 0.4, 20), mat('blackOx'));
    sc.rotation.x = Math.PI / 2; sc.position.set(c[0], c[1], -0.2); ins.add(sc);
    const tx = new THREE.Mesh(new THREE.CylinderGeometry(hole * 0.42, hole * 0.42, 0.3, 6), mat('carbide'));
    tx.rotation.x = Math.PI / 2; tx.position.set(c[0], c[1], T / 2 - 0.05); ins.add(tx);
  }
  // oturma yatağı: ucun altında (arka yüzde) biraz taşan plaka
  const seat = new THREE.Shape(); pts.forEach(([x, y], i) => { const X = c[0] + (x - c[0]) * 1.08, Y = c[1] + (y - c[1]) * 1.08 + 0.4; i ? seat.lineTo(X, Y) : seat.moveTo(X, Y); }); seat.closePath();
  const sg = new THREE.ExtrudeGeometry(seat, { depth: 4.2, bevelEnabled: false });
  sg.translate(off[0], off[1], -6);
  g.add(new THREE.Mesh(sg, mat('blackOx')));
  // tutucu başı: ucun arkasında (y > uç), alt kenarı pahlı; uç yüzünü kapatmaz
  const round = insertShapeOf(t) === 'R';
  const yb = off[1] + H * 0.62, xr = round ? Math.min(13, off[0] + W + 0.6) : Math.max(13, off[0] + W + 0.6);
  const head = new THREE.Shape();
  if (round) {
    // yuvarlak uç (görseldeki 3. tutucu): dar boyun, sap genişliğine eğimli geçiş
    head.moveTo(1, 26); head.lineTo(13, 26); head.lineTo(13, yb + 10); head.lineTo(off[0] + W * 0.85, yb + 2); head.lineTo(off[0] + W * 0.85, yb); head.lineTo(off[0] + W * 0.15, yb); head.lineTo(1, off[1] + H + 1.2); head.closePath();
  } else {
    head.moveTo(1, 26); head.lineTo(13, 26); head.lineTo(13, yb + 6); head.lineTo(xr, yb + 2.5); head.lineTo(xr, yb); head.lineTo(off[0] + W * 0.55, yb);
    head.lineTo(off[0] + W * 0.25, off[1] + H * 0.9); head.lineTo(1, off[1] + H + 1.2); head.closePath();
  }
  const hg = new THREE.ExtrudeGeometry(head, { depth: 12, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 1 });
  hg.translate(0, 0, -6);
  g.add(new THREE.Mesh(hg, mat('blackOx')));
  // sap □12 (baştan yukarı) + sap üstünde baş–sap geçiş çizgisi (görseldeki gibi)
  g.add(box(12, 69, 12, 'blackOx', 7, 26 + 34.5, 0));   // üst uç y=95: çarpışma gövdesiyle aynı (toolGeom)
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
  g.add(box(12, 4.5, 7, 'blackOx', 4, 7.75, 0));      // dar uç yuvası (toolGeom ile aynı)
  g.add(box(14, 5.5, 12, 'blackOx', 5, 12.75, 0));
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
    const sl = sleeveSpan(t);                        // kovan blokta sabit (çarpışma geometrisiyle aynı)
    g.add(cyl(sl.r, sl.y1 - sl.y0, 'blackOx', sl.y0));
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
