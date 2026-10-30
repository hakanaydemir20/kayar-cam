// Tam makine çarpışma kontrolü: takım/tutucu/ünite gövdeleri ↔ parça ve çubuk, gang ↔ burç / karşı iş mili / arka ünite,
// karşı iş mili ↔ ana parça, karşı iş milindeki parça ↔ arka ünite. Aktif takımın yalnız kesici bölgesi kendi
// parçasına değebilir (o temas talaş simülasyonunun konusudur). Gövdeler bodies.js'ten (3D modelle aynı kaynak).
import { bushBodies, gangBodies, backBodies, subBodies } from './bodies.js';
import { LAYOUT } from './frames.js';

const TOL = 0.05;

export function moved(s, dx, dy, dz) {
  if (s.t === 'box') { const b = s.b; return { ...s, b: [b[0] + dx, b[1] + dx, b[2] + dy, b[3] + dy, b[4] + dz, b[5] + dz] }; }
  if (s.t === 'cyl') return { ...s, x0: s.x0 + dx, x1: s.x1 + dx, cy: s.cy + dy, cz: s.cz + dz };
  return { ...s, y0: s.y0 + dy, y1: s.y1 + dy, cx: s.cx + dx, cz: s.cz + dz };
}
function aabb(s) {
  if (s.t === 'box') return s.b;
  if (s.t === 'cyl') { const R = Math.max(s.r0, s.r1); return [s.x0, s.x1, s.cy - R, s.cy + R, s.cz - R, s.cz + R]; }
  return [s.cx - s.r, s.cx + s.r, s.y0, s.y1, s.cz - s.r, s.cz + s.r];
}
const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
/** dikdörtgen [u0,u1]×[v0,v1] ile (pu, pv) noktası arası uzaklık */
function rectDist(u0, u1, v0, v1, pu, pv) {
  const du = pu < u0 ? u0 - pu : pu > u1 ? pu - u1 : 0;
  const dv = pv < v0 ? v0 - pv : pv > v1 ? pv - v1 : 0;
  return Math.hypot(du, dv);
}
function coneR(s, xa, xb) { // [xa, xb] aralığında en büyük yarıçap
  const r = (x) => s.r0 + (s.r1 - s.r0) * (s.x1 > s.x0 ? (x - s.x0) / (s.x1 - s.x0) : 0);
  return Math.max(r(Math.max(xa, s.x0)), r(Math.min(xb, s.x1)));
}

/** İki katı çakışıyor mu */
export function intersects(a, b, tol = TOL) {
  const TOL = tol;   // gövdeler arası güvenlik mesafesi verilirse eksi tolerans (daha erken yakalar)
  const A = aabb(a), B = aabb(b);
  if (ov(A[0], A[1], B[0], B[1]) <= TOL || ov(A[2], A[3], B[2], B[3]) <= TOL || ov(A[4], A[5], B[4], B[5]) <= TOL) return false;
  if (a.t === 'box' && b.t === 'box') return true;
  if (a.t === 'cyl' && b.t === 'cyl') {
    const xa = Math.max(a.x0, b.x0), xb = Math.min(a.x1, b.x1);
    return Math.hypot(a.cy - b.cy, a.cz - b.cz) < coneR(a, xa, xb) + coneR(b, xa, xb) - TOL;
  }
  if (a.t === 'vcyl' && b.t === 'vcyl') return Math.hypot(a.cx - b.cx, a.cz - b.cz) < a.r + b.r - TOL;
  // silindir ↔ kutu (dikey silindir ↔ x silindiri: kutu yaklaşımı)
  const [c, o] = a.t === 'box' ? [b, a] : [a, b];
  const ob = o.t === 'box' ? o.b : aabb(o);
  if (c.t === 'cyl') {
    const xa = Math.max(c.x0, ob[0]), xb = Math.min(c.x1, ob[1]);
    return rectDist(ob[2], ob[3], ob[4], ob[5], c.cy, c.cz) < coneR(c, xa, xb) - TOL;
  }
  return rectDist(ob[0], ob[1], ob[4], ob[5], c.cx, c.cz) < c.r - TOL;
}

/** Karşı iş mili gövdesi s ile arka ünite gövdesi b çakışıyor mu. Aktif takımın eksenel (pensle eş eksenli) gövdeleri
 *  pens deliğinden ince ise sayılmaz: o bölgede takım parçanın deliğinin içindedir (oradaki temas parça kontrolünün konusu). */
export function subHitsBack(s, b, act, tol) {
  if (act && b.tool === act && b.t === 'cyl' && s.t === 'cyl' && s.bore != null &&
      Math.hypot(b.cy - s.cy, b.cz - s.cz) < 0.05 && Math.max(b.r0, b.r1) <= s.bore) return false;
  return intersects(s, b, tol);
}

/** Çarpışma ve bindirme tanımları (projeyle kaydedilir: project.machine.collision) */
export const COLLISION_DEFAULTS = {
  enabled: true,        // makine gövdesi çarpışma kontrolü
  clearPart: 0,         // tutucu / gövde ile parça arası en az mesafe (mm)
  clearBody: 0,         // makine gövdeleri arası en az mesafe (mm): tutucu ↔ burç, karşı mil, arka ünite
  rapidTol: 0.02,       // G0 ile malzemeye girme (bindirme) toleransı (mm)
  checkBush: true, checkSub: true, checkBack: true, checkRapid: true,
  crashCut: true,       // çarpan gövde parçaya girdiği kadar malzemeyi keser (kırmızı gösterilir)
};
export function collisionCfg(project) { return { ...COLLISION_DEFAULTS, ...(project?.machine?.collision || {}) }; }

export class Collider {
  constructor(project, stockSim) {
    this.ss = stockSim;
    const tools = project.tools;
    this.gang = gangBodies(tools);
    this.back = backBodies(tools);
    this.bush = bushBodies();
    this.sub = subBodies(project.stock.barDia / 2, project.machine);
    this.barR = project.stock.barDia / 2;
    this.cache = new Map();   // ızgara → {ver, bins}
    this.found = new Map();
    const c = this.cfg = collisionCfg(project);
    this.mp = Math.max(0, +c.clearPart || 0);
    this.tb = TOL - Math.max(0, +c.clearBody || 0);
  }

  /** satır aralığında en büyük dış yarıçap (1 mm kutucuk önbelleği, ızgara başına) */
  rowsMax(S, i0, i1) {
    let c = this.cache.get(S);
    if (!c) { c = { ver: -1, bins: new Float32Array(Math.ceil(S.nz / 20)) }; this.cache.set(S, c); }
    if (c.ver !== S.version) {
      const nb = c.bins.length;
      for (let k = 0; k < nb; k++) { let m = 0; for (let i = k * 20, e = Math.min(S.nz, k * 20 + 20); i < e; i++) if (S.rowMax[i] > m) m = S.rowMax[i]; c.bins[k] = m; }
      c.ver = S.version;
    }
    const bins = c.bins;
    i0 = Math.max(0, i0); i1 = Math.min(S.nz - 1, i1);
    if (i1 < i0) return 0;
    let m = 0;
    const b0 = Math.floor(i0 / 20), b1 = Math.floor(i1 / 20);
    if (b1 - b0 < 2) { for (let i = i0; i <= i1; i++) if (S.rowMax[i] > m) m = S.rowMax[i]; return m; }
    for (let i = i0; i < (b0 + 1) * 20; i++) if (S.rowMax[i] > m) m = S.rowMax[i];
    for (let k = b0 + 1; k < b1; k++) if (bins[k] > m) m = bins[k];
    for (let i = b1 * 20; i <= i1; i++) if (S.rowMax[i] > m) m = S.rowMax[i];
    return m;
  }

  /** Parça (dönel, x ekseni boyunca, ekseni (0, az)) ile katı. part: {xOf(d), d range, axisZ, rows: [i0,i1], extraBar} */
  partHit(s, part) {
    const A = aabb(s);
    // hızlı eleme: eksenden uzaklık
    const rho = s.t === 'cyl' ? Math.hypot(s.cy, s.cz - part.axisZ) : rectDist(A[2], A[3], A[4], A[5], 0, part.axisZ);
    const mp = this.mp;
    if (s.t !== 'cyl' && rho > this.barR + TOL + mp) return 0;
    const S = part.S;
    // x aralığı → d aralığı (d = front − x  ya da  d = base − x)
    const dA = part.base - A[1], dB = part.base - A[0];
    let i0 = Math.max(part.i0, S.idx(Math.max(dA, S.dMin))), i1 = Math.min(part.i1, S.idx(dB));
    let mr = i1 >= i0 ? this.rowsMax(S, i0, i1) : 0;
    if (part.barBeyond && dB > S.dMax && A[0] < part.base - S.dMax) {
      // ızgara dışında kalan çubuk (burç içine kadar)
      if (Math.min(A[1], part.base - S.dMax) > LAYOUT.bushFace) mr = Math.max(mr, this.barR);
    }
    if (mr <= 0) return 0;
    if (s.t === 'cyl') {
      if (s.bore != null) { // iş mili/pens: parça deliğe girebilir (eksen kaçıklığı d kadar daralır)
        const d = Math.hypot(s.cy, s.cz - part.axisZ);
        return mr + d > s.bore + TOL ? mr + d - s.bore : 0;
      }
      const R = Math.max(s.r0, s.r1);
      return mr + R + mp > rho + TOL ? mr + R - rho + mp : 0;
    }
    return mr + mp > rho + TOL ? mr - rho + mp : 0;
  }

  /** Çarpan gövdenin parça içinde kalan hacmini kes: gövdenin eksene en yakın noktasına kadar, gövdenin açısal genişliğinde */
  crashCut(s, part, spin, Cdeg = 0) {
    if (!this.cfg.crashCut) return;
    const S = part.S, A = aabb(s);
    const i0 = Math.max(part.i0, S.idx(part.base - A[1])), i1 = Math.min(part.i1, S.idx(part.base - A[0]));
    if (i1 < i0) return;
    let rCap, thw, half;
    if (s.t === 'cyl') {
      const y = s.cy, z = s.cz - part.axisZ, rho = Math.hypot(y, z), R = Math.max(s.r0, s.r1);
      rCap = rho - R; thw = Math.atan2(z, y); half = rho > R ? Math.asin(Math.min(1, R / rho)) : Math.PI;
    } else {
      const y0 = A[2], y1 = A[3], z0 = A[4] - part.axisZ, z1 = A[5] - part.axisZ;
      rCap = rectDist(y0, y1, z0 + part.axisZ, z1 + part.axisZ, 0, part.axisZ);
      if (y0 <= 0 && y1 >= 0 && z0 <= 0 && z1 >= 0) { rCap = 0; thw = 0; half = Math.PI; }
      else {
        const angs = [[y0, z0], [y0, z1], [y1, z0], [y1, z1]].map(([y, z]) => Math.atan2(z, y));
        thw = Math.atan2((z0 + z1) / 2, (y0 + y1) / 2);
        half = Math.max(...angs.map(a => Math.abs(Math.atan2(Math.sin(a - thw), Math.cos(a - thw)))));
      }
    }
    // dünya açısı → parça çerçevesi (iş mili C kadar dönmüş)
    S.crashCut(i0, i1, rCap, spin || half >= Math.PI - 1e-6, thw - (Cdeg || 0) * Math.PI / 180, half);
  }

  /** t anındaki makine durumunu kontrol et; yeni çarpışmaları döndür */
  check(t, pose1, pose2, st1, st2, path, line) {
    const ss = this.ss, st = ss.state, S = ss.stock;
    const out = [];
    const C = this.cfg;
    if (!C.enabled) return out;
    const hit = (a, b, depth, margin = 0) => {
      const key = `${path}|${line}|${a}|${b}`;
      if (this.found.has(key)) return;
      this.found.set(key, 1);
      const pen = depth ? depth - margin : 0;
      out.push({ path, line, t, msg: depth && pen <= 0.0005 && margin > 0
        ? `Güvenlik mesafesi: ${a} ↔ ${b} arası ${(-pen).toFixed(2)} mm (en az ${margin} mm tanımlı)`
        : `Çarpışma: ${a} ↔ ${b}${depth ? ` (${pen.toFixed(2)} mm)` : ''}` });
    };
    const X = (a, b) => intersects(a, b, this.tb);
    const g = this.gang.map(s => moved(s, 0, pose1.m.X / 2, pose1.m.Y || 0));
    const subFace = pose2.m.Z, subLat = pose2.m.X;
    const sb = this.sub.map(s => moved(s, subFace, 0, subLat));
    const act1 = st1?.tool || null, act2 = st2?.tool || null;
    const iSplit = S.idx(ss.L + (ss.bs || 0) + 0.5 * ss.cutW);
    const front = ss.mainFrontWorld(pose1.m.Z);
    const mainPart = { S, base: front, axisZ: 0, i0: st.attached === 'main' ? 0 : iSplit, i1: S.nz - 1, barBeyond: true };
    const grip = ss.sim.frames ? ss.L - ss.sim.frames.projection : 5;
    const SS = ss.subStock();
    const subPart = SS ? { S: SS, base: subFace + grip, axisZ: subLat, i0: 0, i1: iSplit - 1, barBeyond: false } : null;
    const nm = (s) => s.name || 'gövde';
    // istenmeyen temas: gövde parçaya girdiyse girdiği kadar malzemeyi kes (kırmızı “çarpışma kesiği”)
    const spin1 = st1 && st1.main?.dir !== 'stop' && !st1.cAxis, spin2 = st2 && st2.sub?.dir !== 'stop' && !st2.subCAxis;
    const crash = (s, part, d, margin, spin, C) => { if (d - margin > 0.005 && s.bore == null) this.crashCut(s, part, spin, C); };
    // gang ↔ parçalar, burç, karşı iş mili, arka ünite
    for (const s of g) {
      const own = s.tool && s.tool === act1 && s.cut;
      if (!own) { const d = this.partHit(s, mainPart); if (d) { hit(nm(s), 'ana iş milindeki parça/çubuk', d, s.bore != null ? 0 : this.mp); crash(s, mainPart, d, this.mp, spin1, pose1.p.C); } }
      if (subPart) { const d = this.partHit(s, subPart); if (d) { hit(nm(s), 'karşı iş milindeki parça', d, s.bore != null ? 0 : this.mp); crash(s, subPart, d, this.mp, spin2, pose2.p.C); } }
      if (C.checkBush) for (const b of this.bush) if (X(s, b)) hit(nm(s), b.name);
      if (C.checkSub) for (const b of sb) if (X(s, b)) hit(nm(s), b.name);
      if (C.checkBack) for (const b of this.back) if (X(s, b)) hit(nm(s), b.name);
    }
    // karşı iş mili ↔ ana parça (pens deliği hariç), burç, arka ünite
    for (const s of sb) {
      const d = this.partHit(s, mainPart); if (d) hit(s.name, 'ana iş milindeki parça/çubuk', d);
      if (C.checkBush) for (const b of this.bush) if (X(s, b)) hit(s.name, b.name);
      if (C.checkBack) for (const b of this.back) if (subHitsBack(s, b, act2, this.tb)) hit(s.name, nm(b));
    }
    // karşı iş milindeki parça ↔ arka ünite / burç
    if (subPart) {
      for (const b of this.back) {
        if (b.tool && b.tool === act2 && b.cut) continue;
        const d = this.partHit(b, subPart); if (d) { hit(nm(b), 'karşı iş milindeki parça', d, b.bore != null ? 0 : this.mp); crash(b, subPart, d, this.mp, spin2, pose2.p.C); }
      }
    }
    return out;
  }
}
