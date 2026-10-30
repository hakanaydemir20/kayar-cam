// 2D çizim → döner parça profili. Çizim: parçanın üst dış hattı, ön alından arkaya sıralı köşeler
// [{z, r, ch?, rad?}] (r = yarıçap). İki uç eksene kapatılır; köşelere pah (ch) veya radyüs (rad) uygulanır.
import { makePart } from './part.js';

const EPS = 1e-9;

/** Çizimi denetle: hata metinleri listesi (boş = geçerli) */
export function validateSketch(pts) {
  const err = [];
  if (!pts || pts.length < 2) { err.push('En az iki nokta çizin.'); return err; }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!(Number.isFinite(p.z) && Number.isFinite(p.r))) { err.push(`${i + 1}. nokta: Z ve çap sayı olmalı.`); continue; }
    if (p.r < -EPS) err.push(`${i + 1}. nokta: çap eksi olamaz.`);
    if (i > 0 && p.z < pts[i - 1].z - EPS) err.push(`${i + 1}. nokta geriye gidiyor (Z ${fmt(p.z)} < ${fmt(pts[i - 1].z)}). Torna profili ön alından arkaya ilerlemeli; alttan kesme (undercut) çizilemez.`);
    if (i > 0 && Math.abs(p.z - pts[i - 1].z) < EPS && Math.abs(p.r - pts[i - 1].r) < EPS) err.push(`${i + 1}. nokta bir öncekiyle aynı yerde.`);
  }
  const L = pts[pts.length - 1].z - pts[0].z;
  if (!(L > 0.01)) err.push('Parça boyu sıfır: noktalar Z boyunca ilerlemeli.');
  if (!pts.some(p => p.r > 0.01)) err.push('Bütün noktalar eksen üstünde: çap verin.');
  return err;
}

/** Çizim köşeleri → kapalı profil noktaları (z ön alından, r yarıçap), pah ve radyüslerle */
export function sketchToProfile(pts) {
  const z0 = pts[0].z;
  const P = pts.map(p => ({ ...p, z: p.z - z0, r: Math.max(0, p.r) }));
  // eksene kapat: ön alın (0,0) ve arka alın (L,0)
  const all = [];
  if (P[0].r > EPS) all.push({ z: 0, r: 0 });
  all.push(...P);
  const last = P[P.length - 1];
  if (last.r > EPS) all.push({ z: last.z, r: 0 });
  const out = [];
  for (let i = 0; i < all.length; i++) {
    const v = all[i], a = all[i - 1], b = all[i + 1];
    const ch = +v.ch || 0, rad = +v.rad || 0;
    if (!a || !b || (ch <= 0 && rad <= 0)) { out.push({ z: v.z, r: v.r }); continue; }
    const ua = unit(a.z - v.z, a.r - v.r), ub = unit(b.z - v.z, b.r - v.r);
    const la = Math.hypot(a.z - v.z, a.r - v.r), lb = Math.hypot(b.z - v.z, b.r - v.r);
    const cosT = ua[0] * ub[0] + ua[1] * ub[1];
    const th = Math.acos(Math.max(-1, Math.min(1, cosT)));          // iç açı
    if (th < 1e-3 || Math.PI - th < 1e-3) { out.push({ z: v.z, r: v.r }); continue; }  // doğrusal: köşe yok
    // komşu köşenin payı da düşünülerek kenarın en fazla yarısı
    const lim = Math.min(la, lb) * 0.5;
    if (ch > 0) {
      const t = Math.min(ch, lim);
      out.push({ z: v.z + ua[0] * t, r: v.r + ua[1] * t }, { z: v.z + ub[0] * t, r: v.r + ub[1] * t });
    } else {
      let t = rad / Math.tan(th / 2);
      let R = rad;
      if (t > lim) { t = lim; R = t * Math.tan(th / 2); }
      const s1 = [v.z + ua[0] * t, v.r + ua[1] * t], s2 = [v.z + ub[0] * t, v.r + ub[1] * t];
      const bis = unit(ua[0] + ub[0], ua[1] + ub[1]);
      const dc = R / Math.sin(th / 2);
      const c = [v.z + bis[0] * dc, v.r + bis[1] * dc];
      let a0 = Math.atan2(s1[1] - c[1], s1[0] - c[0]), a1 = Math.atan2(s2[1] - c[1], s2[0] - c[0]);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const n = Math.max(4, Math.ceil(Math.abs(d) / (Math.PI / 24)));
      for (let k = 0; k <= n; k++) { const an = a0 + d * k / n; out.push({ z: c[0] + R * Math.cos(an), r: c[1] + R * Math.sin(an) }); }
    }
  }
  // sayısal temizlik: z artan, r ≥ 0, ardışık aynı noktalar tek
  const clean = [];
  for (const p of out) {
    const q = { z: Math.round(Math.max(0, p.z) * 1e6) / 1e6, r: Math.round(Math.max(0, p.r) * 1e6) / 1e6 };
    if (clean.length) { const l = clean[clean.length - 1]; if (q.z < l.z) q.z = l.z; if (Math.abs(q.z - l.z) < 1e-7 && Math.abs(q.r - l.r) < 1e-7) continue; }
    clean.push(q);
  }
  return clean;
}

/** Çizimden parça */
export function partFromSketch(pts, name = 'Çizim Parça', features = []) {
  const z0 = pts[0].z;
  const sk = pts.map(p => ({ ...p, z: round(p.z - z0), r: round(p.r) }));
  const part = makePart({ name, profile: sketchToProfile(sk), features, source: 'sketch' });
  part.sketch = sk;
  return part;
}

/** Ön ↔ arka çevir: köşeler ters sırada, Z aynalanır (pah/radyüs köşesinde kalır), özellikler aynalanır */
export function mirrorSketchPart(part) {
  const L = part.length;
  const sk = [...part.sketch].reverse().map(p => ({ ...p, z: round(L - p.z) }));
  const lost = [];
  const feats = part.features.map(f => {
    const g = { ...f };
    for (const k of ['z', 'z0', 'z1']) if (g[k] != null) g[k] = round(L - g[k]);
    if (g.z0 != null && g.z1 != null && g.z0 > g.z1) [g.z0, g.z1] = [g.z1, g.z0];
    if (g.c != null) g.c = (360 - g.c) % 360;
    if (g.type === 'axialHole') g.side = g.side === 'back' ? 'front' : 'back';
    return g;
  }).filter(f => { if (f.type === 'faceSlot' || f.type === 'facePolygon') { lost.push(f); return false; } return true; });
  return { part: partFromSketch(sk, part.name, feats), lost };
}

/** Örnek çizim: kademeli pim */
export function exampleSketch() {
  return [{ z: 0, r: 3, ch: 0.5 }, { z: 8, r: 3 }, { z: 8, r: 5, ch: 0.3 }, { z: 20, r: 5 }, { z: 20, r: 3.5 }, { z: 23, r: 3.5 }, { z: 23, r: 7, ch: 0.5 }, { z: 35, r: 7, ch: 0.3 }];
}

function unit(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function round(v) { return Math.round(v * 1e4) / 1e4; }
function fmt(v) { return (+v).toFixed(3).replace(/\.?0+$/, ''); }
