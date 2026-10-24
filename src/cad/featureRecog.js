// STEP ağından analitik yüz tanıma (düzlem/silindir), torna ekseni bağlama,
// sıfır noktası, döner profil çıkarımı ve özellik (delik, çapraz delik, düzlük) tanıma.
import { fitSegments, segmentsToPoints } from '../geom/fit.js';
import { makePart } from '../part/part.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Simetrik 3x3 özdeğer (Jacobi). Dönüş: değerler artan sırada + vektörler */
export function eigSym3(A) {
  const a = A.map(r => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-15) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const ev = [0, 1, 2].map(i => ({ val: a[i][i], vec: [v[0][i], v[1][i], v[2][i]] }));
  ev.sort((x, y) => x.val - y.val);
  return ev;
}

function perpBasis(a) {
  const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm(cross(a, t));
  const e2 = cross(a, e1);
  return [e1, e2];
}

function solve3(M, b) {
  const [[a, bb, c], [d, e, f], [g, h, i]] = M;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-14) return null;
  const inv = [
    [(e * i - f * h) / det, (c * h - bb * i) / det, (bb * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (bb * g - a * h) / det, (a * e - bb * d) / det],
  ];
  return inv.map(r => r[0] * b[0] + r[1] * b[1] + r[2] * b[2]);
}

/** Her brep yüzü için analitik tip */
export function analyzeFaces(model) {
  const { positions: P, normals: N, indices: I, faces } = model;
  return faces.map((f, fid) => {
    const vs = new Set();
    let area = 0;
    for (let t = f.tri0; t <= f.tri1; t++) {
      const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
      vs.add(a); vs.add(b); vs.add(c);
      const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pc = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
      area += Math.hypot(...cross(sub(pb, pa), sub(pc, pa))) / 2;
    }
    const pts = [], nrm = [];
    for (const v of vs) { pts.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); nrm.push(norm([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]])); }
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const n of nrm) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += n[i] * n[j];
    const ev = eigSym3(M);
    const tot = ev[0].val + ev[1].val + ev[2].val || 1;
    const base = { id: fid, area, pts, nrm };
    // düzlem: tüm normaller aynı
    if (ev[1].val / tot < 1e-5) {
      let n = ev[2].vec;
      const avgN = nrm.reduce((s, x) => add(s, x), [0, 0, 0]);
      if (dot(n, avgN) < 0) n = mul(n, -1);
      const c = mul(pts.reduce((s, x) => add(s, x), [0, 0, 0]), 1 / pts.length);
      return { ...base, type: 'plane', n, c };
    }
    // silindir: normaller tek bir eksene dik
    if (ev[0].val / tot < 1e-4 && pts.length >= 6) {
      const a = norm(ev[0].vec);
      const [e1, e2] = perpBasis(a);
      // p⊥ = c + r n⊥  → en küçük kareler
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bv = [0, 0, 0];
      for (let k = 0; k < pts.length; k++) {
        const px = dot(pts[k], e1), py = dot(pts[k], e2), nx = dot(nrm[k], e1), ny = dot(nrm[k], e2);
        const rows = [[1, 0, nx, px], [0, 1, ny, py]];
        for (const [r0, r1, r2, y] of rows) {
          const row = [r0, r1, r2];
          for (let i = 0; i < 3; i++) { bv[i] += row[i] * y; for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]; }
        }
      }
      const sol = solve3(A, bv);
      if (sol) {
        const [cx, cy, r] = sol;
        let res = 0;
        for (let k = 0; k < pts.length; k++) {
          const px = dot(pts[k], e1) - cx, py = dot(pts[k], e2) - cy;
          res = Math.max(res, Math.abs(Math.hypot(px, py) - Math.abs(r)));
        }
        if (res < Math.max(0.01, Math.abs(r) * 0.01)) {
          const point = add(mul(e1, cx), mul(e2, cy));
          let t0 = Infinity, t1 = -Infinity;
          for (const p of pts) { const t = dot(p, a); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
          return { ...base, type: 'cyl', axis: a, point, r, t0, t1 };
        }
      }
    }
    return { ...base, type: 'other' };
  });
}

/** Torna ekseni + ön alın: fixture (bağlama) tanımı */
export function autoFixture(model, faces) {
  const outer = faces.filter(f => f.type === 'cyl' && f.r > 0).sort((a, b) => b.area - a.area);
  if (!outer.length) throw new Error('Silindirik dış yüzey bulunamadı — torna ekseni yüzeye tıklanarak seçilmeli');
  return fixtureFromFace(model, outer[0]);
}

export function fixtureFromFace(model, cylFace, flip = false) {
  if (cylFace.type !== 'cyl') throw new Error('Seçilen yüz silindirik değil');
  let A = cylFace.axis.slice();
  if (flip) A = mul(A, -1);
  const O = cylFace.point.slice();
  const P = model.positions;
  let dmin = Infinity, dmax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const t = dot(sub([P[i], P[i + 1], P[i + 2]], O), A);
    dmin = Math.min(dmin, t); dmax = Math.max(dmax, t);
  }
  const [ea, eb] = perpBasis(A);
  return { A, O, ea, eb, dFront: dmin, L: dmax - dmin, zeroShift: [0, 0, 0] };
}

/** Model noktası → parça çerçevesi (d, a, b) */
export function toPart(fx, p) {
  const q = sub(p, fx.O);
  return [dot(q, fx.A) - fx.dFront, dot(q, fx.ea), dot(q, fx.eb)];
}

function rad(fx, p) { const q = toPart(fx, p); return Math.hypot(q[1], q[2]); }

/** Döner profil (dış zarf): üçgen kenarlarını d boyunca örnekleyip her d'de en büyük yarıçap */
export function extractProfile(model, fx, faces, bin = 0.002) {
  const P = model.positions, I = model.indices;
  const nb = Math.ceil(fx.L / bin) + 1;
  const rmax = new Float64Array(nb).fill(-1);
  const pd = new Float64Array(P.length / 3), pr = new Float64Array(P.length / 3);
  for (let v = 0; v < P.length / 3; v++) {
    const q = toPart(fx, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    pd[v] = q[0]; pr[v] = Math.hypot(q[1], q[2]);
  }
  const put = (d, r) => {
    const i = Math.round(d / bin);
    if (i >= 0 && i < nb && r > rmax[i]) rmax[i] = r;
  };
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3];
      const n = Math.max(1, Math.ceil(Math.abs(pd[b] - pd[a]) / bin));
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        // kiriş üzerinde yarıçap doğrusal değil; uç noktalar arası ara nokta 3B'den hesaplanır
        const x = P[a * 3] + (P[b * 3] - P[a * 3]) * s, y = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * s, z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * s;
        put(pd[a] + (pd[b] - pd[a]) * s, rad(fx, [x, y, z]));
      }
    }
  }
  // boş kutuları komşudan doldur
  for (let i = 0; i < nb; i++) if (rmax[i] < 0) rmax[i] = i > 0 ? rmax[i - 1] : 0;
  // analitik yüzlere oturt: eş eksenli dış silindir yarıçapları
  const coax = faces.filter(f => f.type === 'cyl' && f.r > 0 && isCoaxial(f, fx));
  const planes = faces.filter(f => f.type === 'plane' && Math.abs(Math.abs(dot(f.n, fx.A)) - 1) < 1e-4).map(f => dot(sub(f.c, fx.O), fx.A) - fx.dFront);
  for (let i = 0; i < nb; i++) {
    const d = i * bin;
    for (const c of coax) {
      const d0 = c.t0 - dot(fx.O, fx.A) - fx.dFront, d1 = c.t1 - dot(fx.O, fx.A) - fx.dFront;
      const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
      if (d >= lo - bin && d <= hi + bin && Math.abs(rmax[i] - c.r) < 0.004) rmax[i] = c.r;
    }
  }
  let pts = [{ z: 0, r: 0 }];
  for (let i = 0; i < nb; i++) pts.push({ z: i * bin, r: rmax[i] });
  pts.push({ z: (nb - 1) * bin, r: 0 });
  // dikey yüzleri düzleme oturt
  for (const p of pts) for (const dp of planes) if (Math.abs(p.z - dp) <= 1.5 * bin) p.z = dp;
  const segs = fitSegments(pts, 0.002);
  const out = segmentsToPoints(segs, 0.01).map(p => ({ z: round(p.z), r: round(p.r) }));
  out[0] = { z: 0, r: 0 };
  return out;
}

const round = (v) => Math.round(v * 1000) / 1000;

function isCoaxial(f, fx) {
  if (Math.hypot(...cross(f.axis, fx.A)) > 2e-3) return false;
  const q = sub(f.point, fx.O);
  const off = sub(q, mul(fx.A, dot(q, fx.A)));
  return Math.hypot(...off) < 0.01;
}

/** Özellik tanıma */
export function recognizeFeatures(model, fx, faces, profile) {
  const feats = [];
  const L = fx.L;
  const Rat = (d) => {
    let r = 0;
    for (let k = 0; k < profile.length - 1; k++) {
      const a = profile[k], b = profile[k + 1];
      if (d >= Math.min(a.z, b.z) - 1e-9 && d <= Math.max(a.z, b.z) + 1e-9) r = Math.max(r, Math.abs(b.z - a.z) < 1e-12 ? Math.max(a.r, b.r) : a.r + (b.r - a.r) * (d - a.z) / (b.z - a.z));
    }
    return r;
  };
  let n = 0;
  const id = () => 'g' + (++n);
  for (const f of faces) {
    if (f.type === 'cyl' && f.r < 0 && isCoaxial(f, fx)) {
      const ds = f.pts.map(p => toPart(fx, p)[0]);
      const d0 = Math.min(...ds), d1 = Math.max(...ds);
      const dia = round(-2 * f.r);
      if (d0 <= 0.02) feats.push({ id: id(), type: 'axialHole', side: 'front', dia, depth: round(d1), through: d1 >= L - 0.02 });
      else if (d1 >= L - 0.02) feats.push({ id: id(), type: 'axialHole', side: 'back', dia, depth: round(L - d0), through: false });
      else feats.push({ id: id(), type: 'axialHole', side: 'front', dia, depth: round(d1), inner: true, from: round(d0) });
    } else if (f.type === 'cyl' && f.r < 0 && Math.abs(dot(f.axis, fx.A)) < 1e-3) {
      // radyal (çapraz) delik
      let u = f.axis.slice();
      const ps = f.pts.map(p => toPart(fx, p));
      const uPart = [0, dot(u, fx.ea), dot(u, fx.eb)];
      const s = ps.map(q => q[1] * uPart[1] + q[2] * uPart[2]);
      const mean = s.reduce((x, y) => x + y, 0) / s.length;
      let sgn = mean >= 0 ? 1 : -1;
      const sMin = Math.min(...s.map(v => v * sgn)), sMax = Math.max(...s.map(v => v * sgn));
      // analitik eksen: delik ekseninin torna eksenine en yakın noktası
      const w0 = sub(f.point, fx.O);
      const bq = dot(u, fx.A), dq = dot(fx.A, w0), eq = dot(u, w0);
      const den = 1 - bq * bq;
      const tA = den > 1e-9 ? (dq - bq * eq) / den : dq;
      const dz = tA - fx.dFront;
      const Rl = Rat(dz);
      const through = sMin < -0.5 * Rl && sMax > 0.5 * Rl;
      const ang = Math.atan2(uPart[2] * sgn, uPart[1] * sgn) * 180 / Math.PI;
      // yanal kaçıklık (Y)
      const hp = toPart(fx, f.point);
      const lat = (hp[1] * -uPart[2] + hp[2] * uPart[1]) * sgn;
      feats.push({ id: id(), type: 'crossHole', dia: round(-2 * f.r), z: round(dz), c: round(normAng(-ang)), through, depthDia: through ? null : round(2 * sMin), y: Math.abs(lat) > 0.01 ? round(lat) : 0 });
    } else if (f.type === 'plane' && Math.abs(dot(f.n, fx.A)) < 1e-3) {
      const np = [0, dot(f.n, fx.ea), dot(f.n, fx.eb)];
      const cq = toPart(fx, f.c);
      const h = cq[1] * np[1] + cq[2] * np[2];
      const ds = f.pts.map(p => toPart(fx, p)[0]);
      const z0 = Math.min(...ds), z1 = Math.max(...ds);
      let Rl = 0;
      for (let z = z0; z <= z1; z += 0.05) Rl = Math.max(Rl, Rat(z));
      if (h < Rl - 0.02 && h > 0) {
        const ang = Math.atan2(np[2], np[1]) * 180 / Math.PI;
        feats.push({ id: id(), type: 'flat', c: round(normAng(-ang)), depth: round(Rl - h), z0: round(z0), z1: round(z1) });
      }
    }
  }
  return mergeCrossHoles(feats);
}

function normAng(a) { let v = a % 360; if (v < 0) v += 360; return Math.abs(v - 360) < 1e-6 ? 0 : v; }

function mergeCrossHoles(feats) {
  // aynı deliğin iki yarım yüzü (STEP silindiri ikiye bölebilir)
  const out = [];
  for (const f of feats) {
    if (f.type === 'crossHole') {
      const g = out.find(o => o.type === 'crossHole' && Math.abs(o.dia - f.dia) < 1e-3 && Math.abs(o.z - f.z) < 0.05 && (Math.abs(o.c - f.c) < 0.5 || Math.abs(Math.abs(o.c - f.c) - 180) < 0.5));
      if (g) { if (Math.abs(Math.abs(g.c - f.c) - 180) < 0.5) g.through = true; continue; }
    }
    if (f.type === 'axialHole') {
      const g = out.find(o => o.type === 'axialHole' && o.side === f.side && Math.abs(o.dia - f.dia) < 1e-3);
      if (g) { g.depth = Math.max(g.depth, f.depth); continue; }
    }
    if (f.type === 'flat') {
      const g = out.find(o => o.type === 'flat' && Math.abs(o.c - f.c) < 0.5 && Math.abs(o.depth - f.depth) < 0.01);
      if (g) { g.z0 = Math.min(g.z0, f.z0); g.z1 = Math.max(g.z1, f.z1); continue; }
    }
    out.push(f);
  }
  return out;
}

/** Tam akış: model → parça */
export function partFromModel(model, opts = {}) {
  const faces = analyzeFaces(model);
  let fx;
  if (opts.axisFaceId != null) fx = fixtureFromFace(model, faces[opts.axisFaceId], !!opts.flip);
  else { fx = autoFixture(model, faces); if (opts.flip) fx = fixtureFromFace(model, faces.filter(f => f.type === 'cyl' && f.r > 0).sort((a, b) => b.area - a.area)[0], true); }
  const profile = extractProfile(model, fx, faces);
  const features = recognizeFeatures(model, fx, faces, profile);
  const part = makePart({ name: opts.name || model.name || 'STEP Parça', profile, features, source: 'step' });
  part.fixture = fx;
  return { part, faces, fixture: fx };
}
