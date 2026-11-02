// Döner parçanın tam kesiti (dış profil + iç profil/delikler): LatheGeometry için kapalı kontur.
// İç yarıçap: serbest çizim iç profili (part.inner) ve eksenel delik özellikleri (ön/arka).
import * as THREE from 'three';
import { profileR } from '../sim/stockSim.js';

export function innerRAt(part, d) {
  const L = part.length;
  let r = part.inner ? profileR(part.inner, d) : 0;
  for (const f of part.features || []) {
    if (f.type !== 'axialHole') continue;
    const inHole = f.side === 'back' ? d >= L - f.depth - 1e-9 && d <= L + 1e-9 : d >= -1e-9 && d <= f.depth + 1e-9;
    if (inHole) r = Math.max(r, f.dia / 2);
  }
  return r;
}

/** Kesit noktaları (r, z) — dış profil önden arkaya, iç profil arkadan öne; iç yoksa dış profil aynen */
export function sectionPoints(part) {
  const L = part.length, out = part.profile;
  const zs = new Set([0, L]);
  for (const p of part.inner || []) zs.add(p.z);
  for (const f of part.features || []) if (f.type === 'axialHole') zs.add(f.side === 'back' ? L - f.depth : f.depth);
  const ks = [...zs].filter(z => z >= 0 && z <= L).sort((a, b) => a - b);
  const e = 1e-4;
  const inner = [];
  for (const z of ks) {
    const a = innerRAt(part, Math.max(0, z - e)), b = innerRAt(part, Math.min(L, z + e));
    if (z > 0) inner.push({ z, r: a });
    if (z < L || !inner.length) inner.push({ z, r: b });
  }
  if (!inner.some(p => p.r > 1e-4)) return out.map(p => ({ r: Math.max(0, p.r), z: p.z }));
  // dış profil: eksendeki uç noktalar (r=0) iç yarıçapla değişir
  const o = out.filter((p, i) => !(p.r <= 1e-6 && (i === 0 || i === out.length - 1)));
  const pts = [{ z: 0, r: inner[0].r }, ...o, { z: L, r: inner[inner.length - 1].r }];
  for (let i = inner.length - 1; i >= 0; i--) pts.push(inner[i]);
  pts.push({ ...pts[0] });
  // ardışık çift noktaları ayıkla
  return pts.filter((p, i) => i === 0 || Math.abs(p.z - pts[i - 1].z) > 1e-7 || Math.abs(p.r - pts[i - 1].r) > 1e-7);
}

/** Kesitten döner geometri (parça çerçevesi: x = −d) */
export function sectionGeometry(part, segs = 120) {
  const pts = sectionPoints(part).map(p => new THREE.Vector2(Math.max(0, p.r), -p.z));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(-Math.PI / 2);
  return g;
}
