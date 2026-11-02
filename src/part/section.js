// Serbest 2D çizim (SolidWorks benzeri) → döner parça kesiti.
// Çizim düzlemi: x = Z (ön alından, sağa), y = yarıçap (eksen y=0, yukarı). Varlıklar: çizgi ve yay.
// Kesit = bütün kapalı konturların çift-tek (even-odd) dolgusu: içteki kapalı kontur boşluktur (delik, kanal).
// Her Z'de malzeme tek aralık [r_iç, r_dış] olmalı (döndürülebilir kesit); r_iç > 0 iç boşluk demektir.
import { makePart } from './part.js';

const EPS = 1e-7;
export const keyOf = (p) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`;
const same = (p, q, tol = 1e-6) => Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol;

/** 3 noktadan yay (a başlangıç, m ara nokta, b bitiş) → {c, r, a0, sweep} ; doğrusal ise null */
export function arcFrom3(a, m, b) {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return null;
  const A = a.x * a.x + a.y * a.y, M = m.x * m.x + m.y * m.y, B = b.x * b.x + b.y * b.y;
  const cx = (A * (m.y - b.y) + M * (b.y - a.y) + B * (a.y - m.y)) / d;
  const cy = (A * (b.x - m.x) + M * (a.x - b.x) + B * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const ang = (p) => Math.atan2(p.y - cy, p.x - cx);
  const t0 = ang(a), tm = ang(m), t1 = ang(b);
  const norm = (v) => { while (v <= -Math.PI) v += 2 * Math.PI; while (v > Math.PI) v -= 2 * Math.PI; return v; };
  // a → m → b yönünde süpürme
  let s1 = norm(tm - t0), s2 = norm(t1 - tm);
  if (Math.sign(s1) !== Math.sign(s2)) { if (s1 > 0) s2 += 2 * Math.PI; else s2 -= 2 * Math.PI; }
  return { c: { x: cx, y: cy }, r, a0: t0, sweep: s1 + s2 };
}

/** Yay noktası t∈[0,1] */
export function arcPoint(e, t) {
  const A = arcFrom3(e.a, e.m, e.b);
  if (!A) return { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t };
  const th = A.a0 + A.sweep * t;
  return { x: A.c.x + A.r * Math.cos(th), y: A.c.y + A.r * Math.sin(th) };
}

/** Varlıklar → doğru parçaları (yaylar 3°'lik parçalara bölünür) */
export function discretize(ents) {
  const segs = [];
  for (const e of ents) {
    if (e.construction) continue;
    if (e.type === 'line') { if (!same(e.a, e.b)) segs.push({ a: e.a, b: e.b, e }); continue; }
    const A = arcFrom3(e.a, e.m, e.b);
    if (!A) { segs.push({ a: e.a, b: e.b, e }); continue; }
    const n = Math.max(4, Math.ceil(Math.abs(A.sweep) / (3 * Math.PI / 180)));
    let p = e.a;
    for (let k = 1; k <= n; k++) { const q = k === n ? e.b : arcPoint(e, k / n); segs.push({ a: p, b: q, e }); p = q; }
  }
  return segs;
}

/** Konturlar: uç noktaları paylaşan varlıkları zincirle; açık uçları bul (tek bağlı düğüm) */
export function topology(ents) {
  const deg = new Map();
  for (const e of ents) { if (e.construction) continue; for (const p of [e.a, e.b]) { const k = keyOf(p); deg.set(k, (deg.get(k) || 0) + 1); } }
  const open = [];
  for (const [k, n] of deg) if (n % 2 === 1) { const [x, y] = k.split(',').map(v => +v / 1e5); open.push({ x, y }); }
  return { open, nodes: deg.size };
}

/** Z = x konumunda aktif doğru parçalarının yarıçapı (sıralı) */
function crossAt(segs, zMid, zEval) {
  const out = [];
  for (const s of segs) {
    const x0 = Math.min(s.a.x, s.b.x), x1 = Math.max(s.a.x, s.b.x);
    if (x1 - x0 < EPS || zMid <= x0 || zMid >= x1) continue;
    const t = (zEval - s.a.x) / (s.b.x - s.a.x);
    out.push({ s, r: s.a.y + (s.b.y - s.a.y) * t, rm: s.a.y + (s.b.y - s.a.y) * ((zMid - s.a.x) / (s.b.x - s.a.x)) });
  }
  out.sort((p, q) => p.rm - q.rm);
  // çakışan kenarlar (aynı yarıçapta iki kesişim) çift-tek kuralında birbirini götürür
  const res = [];
  for (const c of out) { const l = res[res.length - 1]; if (l && Math.abs(l.rm - c.rm) < 1e-7) res.pop(); else res.push(c); }
  return res;
}

/**
 * Kesiti çöz: Z kırılma noktaları arasındaki her aralıkta çift-tek kuralıyla malzeme aralıkları.
 * @returns {{spans, errors, zMin, zMax}} span: {z0, z1, out0, out1, in0, in1} (yarıçaplar; iç yoksa 0)
 */
export function solveSection(ents) {
  const segs = discretize(ents);
  const errors = [];
  if (!segs.length) return { spans: [], errors: ['Çizim boş.'], segs };
  if (segs.some(s => s.a.y < -1e-6 || s.b.y < -1e-6)) errors.push('Çizim eksenin altına iniyor: kesit yalnız eksenin üstünde çizilir (yarı kesit).');
  const top = topology(ents);
  if (top.open.length) errors.push(`${top.open.length} açık uç var: konturlar kapalı olmalı (kırmızı noktalar). Çizgiyi başladığı noktaya bağlayın.`);
  const zs = [...new Set(segs.flatMap(s => [s.a.x, s.b.x]).map(v => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  const spans = [], bad = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1];
    if (z1 - z0 < 1e-6) continue;
    const m = (z0 + z1) / 2;
    const c0 = crossAt(segs, m, z0), c1 = crossAt(segs, m, z1);
    // çift-tek: [0,1], [2,3]… malzeme
    const iv = [];
    for (let k = 0; k + 1 < c0.length; k += 2) iv.push([k, k + 1]);
    if (c0.length % 2) bad.push({ z0, z1, msg: 'açık kontur' });
    // eksen kenarı: alt kenar y=0'da ise iç yarıçap 0 (dolu)
    if (iv.length === 0) { spans.push({ z0, z1, empty: true }); continue; }
    if (iv.length > 1) { bad.push({ z0, z1, msg: 'bu Z’de birden fazla malzeme bölgesi: kapalı iç boşluk ya da ayrık parça (döndürülemez)' }); }
    const [lo, hi] = iv[0].length ? [iv[0][0], iv[iv.length - 1][1]] : [0, 1];
    spans.push({ z0, z1, in0: Math.max(0, c0[lo].r), in1: Math.max(0, c1[lo].r), out0: c0[hi].r, out1: c1[hi].r, multi: iv.length > 1 });
  }
  // boş aralık parçanın ortasındaysa: kopuk
  const solid = spans.filter(s => !s.empty);
  if (solid.length) {
    const a = solid[0].z0, b = solid[solid.length - 1].z1;
    for (const s of spans) if (s.empty && s.z0 >= a - 1e-9 && s.z1 <= b + 1e-9) bad.push({ z0: s.z0, z1: s.z1, msg: 'malzeme yok: parça ikiye ayrılıyor' });
  }
  for (const b of bad) errors.push(`Z ${fmt(b.z0)}–${fmt(b.z1)}: ${b.msg}.`);
  return { spans: solid, errors, segs, bad, zMin: solid[0]?.z0, zMax: solid[solid.length - 1]?.z1 };
}

/**
 * Kesit → parça: dış profil (makePart biçimi), iç profil (part.inner) ve CAM için iç özellikler:
 *  - alından başlayan, içe doğru daralan sabit çaplı kademeler → eksenel delik (matkap); düz dip → flat: true
 *  - içe doğru genişleyen / konik iç bölgeler → iç kanal / iç tornalama (otomatik işlem yok, uyarı)
 */
export function sectionToPart(ents, name = 'Çizim parça', extraFeatures = []) {
  const S = solveSection(ents);
  if (S.errors.length || !S.spans.length) return { part: null, errors: S.errors.length ? S.errors : ['Kesit bulunamadı.'], warnings: [], S };
  const z0 = S.spans[0].z0, L = S.spans[S.spans.length - 1].z1 - z0;
  const R = (v) => Math.round(v * 1e4) / 1e4;
  const outer = [{ z: 0, r: 0 }], inner = [];
  for (const s of S.spans) {
    outer.push({ z: R(s.z0 - z0), r: R(s.out0) }, { z: R(s.z1 - z0), r: R(s.out1) });
    inner.push({ z: R(s.z0 - z0), r: R(s.in0) }, { z: R(s.z1 - z0), r: R(s.in1) });
  }
  outer.push({ z: R(L), r: 0 });
  const profile = dedupe(outer);
  const innerP = dedupe(inner);
  const hasInner = innerP.some(p => p.r > 1e-4);
  const warnings = [], features = [...extraFeatures.filter(f => f.type !== 'axialHole')];
  if (hasInner) {
    const res = innerFeatures(S.spans.map(s => ({ ...s, z0: s.z0 - z0, z1: s.z1 - z0 })), L);
    features.push(...res.features); warnings.push(...res.warnings);
  }
  const part = makePart({ name, profile, features, source: 'sketch' });
  part.inner = hasInner ? innerP : null;
  part.sketch2 = JSON.parse(JSON.stringify(ents.map(e => ({ ...e }))));
  return { part, errors: [], warnings, S };
}

/** İç profilden işlenebilir delikler ve uyarılar */
function innerFeatures(spans, L) {
  const features = [], warnings = [];
  const W = (v) => Math.round(v * 1000) / 1000;
  const constR = (s) => Math.abs(s.in0 - s.in1) < 1e-4 && s.in0 > 1e-4;
  const walk = (side) => {
    const seq = side === 'front' ? spans : [...spans].reverse();
    const face = side === 'front' ? 0 : L;
    const depthOf = (s) => side === 'front' ? s.z1 : L - s.z0;
    let k = 0, lastR = Infinity, made = 0;
    if (!(seq[0].in0 > 1e-4 || seq[0].in1 > 1e-4)) return 0;
    while (k < seq.length) {
      const s = seq[k];
      const rin = side === 'front' ? s.in0 : s.in1;
      if (!(rin > 1e-4)) break;
      if (!constR(s)) { warnings.push(`${side === 'front' ? 'Ön' : 'Arka'} delikte konik/eğimli iç yüzey (Z ${W(s.z0)}–${W(s.z1)}): iç tornalama takımı gerekir, otomatik işlem eklenmez.`); features.push({ id: 'ib' + side + k, type: 'innerTurn', side, z0: W(s.z0), z1: W(s.z1), dia: W(2 * Math.max(s.in0, s.in1)) }); break; }
      if (rin > lastR + 1e-4) break;          // içe doğru genişleme: matkap erişemez (iç kanal olarak aşağıda)
      // aynı çaplı kesintisiz kademe
      let j = k; while (j + 1 < seq.length && constR(seq[j + 1]) && Math.abs(seq[j + 1].in0 - rin) < 1e-4) j++;
      const depth = depthOf(seq[j]);
      const next = seq[j + 1];
      const nr = next ? (side === 'front' ? next.in0 : next.in1) : 0;
      const through = !next;
      // dip: bir sonraki kademe dikey basamakla başlıyorsa düz dip (matkap konik bırakır)
      const flat = !through && (!(nr > 1e-4) || nr < rin - 1e-4);
      features.push({ id: 'ih' + side + k, type: 'axialHole', side, dia: W(2 * rin), depth: W(through ? L : depth), through, flat: flat && !through });
      if (flat && !through) warnings.push(`${side === 'front' ? 'Ön' : 'Arka'} Ø${W(2 * rin)} delik düz dipli (derinlik ${W(depth)}): matkap konik dip bırakır; düz dip için parmak freze / dalma ya da iç tornalama gerekir.`);
      made++; lastR = rin; k = j + 1;
      if (through) break;
    }
    return k;
  };
  const used = new Set();
  const nf = walk('front');
  for (let i = 0; i < nf; i++) used.add(i);
  if (nf < spans.length) { const nb = walk('back'); for (let i = 0; i < nb; i++) used.add(spans.length - 1 - i); }
  // kalan iç bölgeler: iç kanal (segman kanalı) / iç tornalama
  let i = 0;
  while (i < spans.length) {
    const s = spans[i];
    if (used.has(i) || !(s.in0 > 1e-4 || s.in1 > 1e-4)) { i++; continue; }
    let j = i; while (j + 1 < spans.length && !used.has(j + 1) && (spans[j + 1].in0 > 1e-4)) j++;
    // komşu deliğin çapından büyükse iç kanal
    const dia = W(2 * Math.max(...spans.slice(i, j + 1).flatMap(q => [q.in0, q.in1])));
    features.push({ id: 'ig' + i, type: 'innerGroove', z0: W(s.z0), z1: W(spans[j].z1), dia });
    warnings.push(`İç kanal / iç tornalama Z ${W(s.z0)}–${W(spans[j].z1)} (Ø${dia}): iç kanal takımı gerekir, otomatik işlem eklenmez.`);
    i = j + 1;
  }
  return { features, warnings };
}

function dedupe(pts) {
  const o = [];
  for (const p of pts) { const l = o[o.length - 1]; if (l && Math.abs(l.z - p.z) < 1e-7 && Math.abs(l.r - p.r) < 1e-7) continue; o.push(p); }
  // doğrusal ara noktaları at
  const q = [];
  for (const p of o) {
    if (q.length >= 2) { const a = q[q.length - 2], b = q[q.length - 1]; if (Math.abs((b.z - a.z) * (p.r - a.r) - (p.z - a.z) * (b.r - a.r)) < 1e-9) q.pop(); }
    q.push(p);
  }
  return q;
}

/** Eski nokta çizimini (dış hat köşeleri, uçlar eksene kapalı) varlıklara çevir */
export function entsFromPoints(pts) {
  if (!pts?.length) return [];
  const P = [{ x: pts[0].z, y: 0 }, ...pts.map(p => ({ x: p.z, y: p.r })), { x: pts[pts.length - 1].z, y: 0 }];
  const ents = [];
  for (let i = 0; i < P.length - 1; i++) if (!same(P[i], P[i + 1])) ents.push({ type: 'line', a: { ...P[i] }, b: { ...P[i + 1] } });
  ents.push({ type: 'line', a: { ...P[P.length - 1] }, b: { ...P[0] } });
  return ents;
}

/** Dikdörtgen: 4 çizgi */
export function rectEnts(p, q) {
  const a = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) }, c = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) };
  const b = { x: c.x, y: a.y }, d = { x: a.x, y: c.y };
  return [{ type: 'line', a: { ...a }, b: { ...b } }, { type: 'line', a: { ...b }, b: { ...c } }, { type: 'line', a: { ...c }, b: { ...d } }, { type: 'line', a: { ...d }, b: { ...a } }];
}

/** Köşe yuvarlatma (fillet) / pah: aynı noktada birleşen iki çizgiyi kısaltıp yay ya da çizgi ekler */
export function cornerOp(ents, P, kind, val) {
  const at = ents.filter(e => e.type === 'line' && (same(e.a, P) || same(e.b, P)));
  if (at.length !== 2 || !(val > 0)) return { ok: false, msg: 'Köşe iki çizginin birleştiği nokta olmalı' };
  const dirOf = (e) => { const o = same(e.a, P) ? e.b : e.a; const L = Math.hypot(o.x - P.x, o.y - P.y); return { u: { x: (o.x - P.x) / L, y: (o.y - P.y) / L }, L }; };
  const A = dirOf(at[0]), B = dirOf(at[1]);
  const cos = A.u.x * B.u.x + A.u.y * B.u.y, th = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (th < 1e-3 || Math.PI - th < 1e-3) return { ok: false, msg: 'Doğrusal noktaya köşe işlemi uygulanamaz' };
  let t = kind === 'ch' ? val : val / Math.tan(th / 2);
  if (t > Math.min(A.L, B.L) - 1e-6) return { ok: false, msg: `Değer çok büyük: kenara sığmıyor (en fazla ${fmt(kind === 'ch' ? Math.min(A.L, B.L) : Math.min(A.L, B.L) * Math.tan(th / 2))})` };
  const pA = { x: P.x + A.u.x * t, y: P.y + A.u.y * t }, pB = { x: P.x + B.u.x * t, y: P.y + B.u.y * t };
  for (const [e, p] of [[at[0], pA], [at[1], pB]]) { if (same(e.a, P)) e.a = { ...p }; else e.b = { ...p }; }
  if (kind === 'ch') ents.push({ type: 'line', a: { ...pA }, b: { ...pB } });
  else {
    const bis = { x: A.u.x + B.u.x, y: A.u.y + B.u.y }, bl = Math.hypot(bis.x, bis.y);
    const dc = val / Math.sin(th / 2), c = { x: P.x + bis.x / bl * dc, y: P.y + bis.y / bl * dc };
    const mid = { x: c.x - bis.x / bl * val, y: c.y - bis.y / bl * val };
    ents.push({ type: 'arc', a: { ...pA }, m: mid, b: { ...pB } });
  }
  return { ok: true };
}

function fmt(v) { return (+v).toFixed(3).replace(/\.?0+$/, ''); }
