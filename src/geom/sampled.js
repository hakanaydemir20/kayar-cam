// Örneklenmiş profil fonksiyonları: r(z) değerleri sabit adımlı ızgarada.
// Koordinat: z = parça ön alından mesafe (mm, + başlığa doğru), r = yarıçap (mm).

export class Sampled {
  constructor(z0, z1, dz, fill = 0) {
    this.z0 = z0; this.dz = dz;
    this.n = Math.max(2, Math.round((z1 - z0) / dz) + 1);
    this.r = new Float64Array(this.n).fill(fill);
  }
  get z1() { return this.z0 + (this.n - 1) * this.dz; }
  zAt(i) { return this.z0 + i * this.dz; }
  idx(z) { return Math.round((z - this.z0) / this.dz); }
  at(z) {
    const f = (z - this.z0) / this.dz;
    if (f <= 0) return this.r[0];
    if (f >= this.n - 1) return this.r[this.n - 1];
    const i = Math.floor(f), t = f - i;
    return this.r[i] * (1 - t) + this.r[i + 1] * t;
  }
  clone() {
    const s = new Sampled(this.z0, this.z1, this.dz);
    s.r.set(this.r);
    return s;
  }
  map(fn) { const s = this.clone(); for (let i = 0; i < s.n; i++) s.r[i] = fn(s.r[i], s.zAt(i), i); return s; }
}

/** Polilinden (z,r) örnekle — her z'de polilinin maksimum r değeri (dikey yüzler dahil). */
export function sampleProfile(points, z0, z1, dz, outside = 0) {
  const s = new Sampled(z0, z1, dz, outside);
  const has = new Uint8Array(s.n);
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k], b = points[k + 1];
    const zmin = Math.min(a.z, b.z), zmax = Math.max(a.z, b.z);
    let i0 = Math.ceil((zmin - s.z0) / dz - 1e-9), i1 = Math.floor((zmax - s.z0) / dz + 1e-9);
    i0 = Math.max(0, i0); i1 = Math.min(s.n - 1, i1);
    for (let i = i0; i <= i1; i++) {
      const z = s.zAt(i);
      let r;
      if (Math.abs(b.z - a.z) < 1e-12) r = Math.max(a.r, b.r);
      else r = a.r + (b.r - a.r) * (z - a.z) / (b.z - a.z);
      if (!has[i] || r > s.r[i]) { s.r[i] = r; has[i] = 1; }
    }
  }
  return s;
}

/** Talaşsız (undercut'sız) zarf: +Z yönünde ilerleyen kater için geriye bakan
 *  yüzeylerin eğimini takımın arka boşluk açısıyla sınırlar. */
export function turnableEnvelope(s, backAngleDeg) {
  const e = s.clone();
  const drop = Math.tan(backAngleDeg * Math.PI / 180) * s.dz;
  for (let i = 1; i < e.n; i++) e.r[i] = Math.max(e.r[i], e.r[i - 1] - drop);
  return e;
}

/** Dikdörtgen genişletme: eksenel w, radyal u pay (finiş payı). */
export function dilate(s, w, u) {
  const e = s.clone();
  const k = Math.round(w / s.dz);
  if (k > 0) {
    // kayan pencere maksimumu (deque)
    const out = new Float64Array(s.n);
    const dq = [];
    for (let i = 0, j = 0; i < s.n; i++) {
      const hi = Math.min(s.n - 1, i + k);
      while (j <= hi) { while (dq.length && s.r[dq[dq.length - 1]] <= s.r[j]) dq.pop(); dq.push(j); j++; }
      while (dq[0] < i - k) dq.shift();
      out[i] = s.r[dq[0]];
    }
    e.r.set(out);
  }
  for (let i = 0; i < e.n; i++) e.r[i] += u;
  return e;
}

/** Uç radyüsü telafisi: rn yarıçaplı burun merkezinin zarfı c(z), sonra
 *  hayali uç noktası P = C + (-rn radyal, +rn eksenel) (uç yönü 3). Dönüş: Sampled (P_r)
 *  P'nin z ekseni c'ye göre +rn kaydırılmış olarak yeniden örneklenir. */
export function noseTipPath(s, rn) {
  if (!(rn > 0)) return s.clone();
  const k = Math.ceil(rn / s.dz);
  const sq = new Float64Array(2 * k + 1);
  for (let u = -k; u <= k; u++) {
    const du = u * s.dz;
    sq[u + k] = du * du <= rn * rn ? Math.sqrt(rn * rn - du * du) : -Infinity;
  }
  const c = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) {
    let m = -Infinity;
    const lo = Math.max(0, i - k), hi = Math.min(s.n - 1, i + k);
    for (let j = lo; j <= hi; j++) {
      const v = s.r[j] + sq[j - i + k];
      if (v > m) m = v;
    }
    c[i] = m;
  }
  // P(z + rn) = c(z) - rn  →  P(z) = c(z - rn) - rn
  const p = s.clone();
  const shift = Math.round(rn / s.dz);
  for (let i = 0; i < s.n; i++) {
    const j = Math.max(0, i - shift);
    p.r[i] = c[j] - rn;
  }
  return p;
}

/** Örneklenmiş fonksiyonu polilinye çevir (dikey sıçramalar korunur). */
export function toPolyline(s, i0 = 0, i1 = s.n - 1) {
  const pts = [];
  for (let i = i0; i <= i1; i++) pts.push({ z: s.zAt(i), r: s.r[i] });
  return pts;
}
