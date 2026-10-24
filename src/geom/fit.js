// Yoğun polilinden doğru + yay (G1/G2/G3) segmentlerine indirgeme.
// Noktalar {z, r}. Yay yönü: (z sağa, r yukarı) çiziminde saat yönü = cw (Fanuc torna G02).

function distPointSeg(p, a, b) {
  const dz = b.z - a.z, dr = b.r - a.r;
  const L2 = dz * dz + dr * dr;
  if (L2 < 1e-18) return Math.hypot(p.z - a.z, p.r - a.r);
  let t = ((p.z - a.z) * dz + (p.r - a.r) * dr) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.z - (a.z + t * dz), p.r - (a.r + t * dr));
}

function lineFits(pts, i, j, tol) {
  const a = pts[i], b = pts[j];
  for (let k = i + 1; k < j; k++) if (distPointSeg(pts[k], a, b) > tol) return false;
  return true;
}

export function circle3(a, b, c) {
  const ax = a.z, ay = a.r, bx = b.z, by = b.r, cx = c.z, cy = c.r;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const uz = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const ur = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { z: uz, r: ur, R: Math.hypot(ax - uz, ay - ur) };
}

function cross(o, a, b) { return (a.z - o.z) * (b.r - o.r) - (a.r - o.r) * (b.z - o.z); }

function arcFits(pts, i, j, tol, maxR, maxGap = 0.06) {
  if (j - i < 6) return null;
  const m = (i + j) >> 1;
  const c = circle3(pts[i], pts[m], pts[j]);
  if (!c || c.R > maxR || c.R < 0.01) return null;
  const sgn = Math.sign(cross(pts[i], pts[m], pts[j]));
  if (sgn === 0) return null;
  // yay yarım daireden büyük olmasın (güvenli IK) ve tüm noktalar tolerans içinde
  let prevAng = Math.atan2(pts[i].r - c.r, pts[i].z - c.z), sweep = 0;
  for (let k = i + 1; k <= j; k++) {
    const p = pts[k];
    // ardışık noktalar arasında örneksiz boşluk varsa yay oraya uydurulamaz (yay arada şişebilir)
    const q = pts[k - 1];
    if (Math.hypot(p.z - q.z, p.r - q.r) > maxGap) return null;
    if (Math.abs(Math.hypot(p.z - c.z, p.r - c.r) - c.R) > tol) return null;
    const ang = Math.atan2(p.r - c.r, p.z - c.z);
    let d = ang - prevAng;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (d * sgn < -1e-9) return null; // yön değişimi
    sweep += Math.abs(d);
    prevAng = ang;
  }
  if (sweep > Math.PI * 0.999) return null;
  // kiriş sapması anlamlı değilse doğru yeterli
  return { center: c, cw: sgn < 0, sweep };
}

function grow(test, i, n, first = 1) {
  // üstel + ikili arama ile en uzak j (test(i+first) doğru kabul edilir)
  let lo = Math.min(n - 1, i + first), step = first * 2, hi;
  if (lo === n - 1) return lo;
  while (true) {
    const j = Math.min(n - 1, i + step);
    if (!test(j)) { hi = j; break; }
    lo = j;
    if (j === n - 1) return lo;
    step *= 2;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (test(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** Ardışık tekrarlanan noktaları temizle */
export function dedupe(pts, eps = 1e-9) {
  const out = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k], q = out[out.length - 1];
    if (Math.abs(p.z - q.z) > eps || Math.abs(p.r - q.r) > eps) out.push(p);
  }
  return out;
}

/**
 * Segmentlere indirge.
 * @returns {Array<{type:'line'|'arc', a, b, center?, cw?}>}
 */
export function fitSegments(points, tol = 0.002, opts = {}) {
  const pts = dedupe(points);
  const maxR = opts.maxR ?? 500;
  const useArcs = opts.arcs !== false;
  const segs = [];
  let i = 0;
  const n = pts.length;
  while (i < n - 1) {
    const jl = grow(j => lineFits(pts, i, j, tol), i, n);
    let ja = i, arc = null;
    if (useArcs && jl - i < n - 1 - i) {
      const testArc = j => !!arcFits(pts, i, j, tol, maxR);
      if (testArc(Math.min(n - 1, i + 8))) {
        ja = grow(testArc, i, n, 8);
        arc = arcFits(pts, i, ja, tol, maxR);
      }
    }
    if (arc && ja > jl + 2) {
      segs.push({ type: 'arc', a: pts[i], b: pts[ja], center: { z: arc.center.z, r: arc.center.r }, R: arc.center.R, cw: arc.cw });
      i = ja;
    } else {
      segs.push({ type: 'line', a: pts[i], b: pts[jl] });
      i = jl;
    }
  }
  return segs;
}

/** Segmentleri yeniden yoğun noktaya çevir (test/simülasyon için) */
export function segmentsToPoints(segs, step = 0.01) {
  const out = [];
  for (const s of segs) {
    if (s.type === 'line') { out.push(s.a); continue; }
    const a0 = Math.atan2(s.a.r - s.center.r, s.a.z - s.center.z);
    let a1 = Math.atan2(s.b.r - s.center.r, s.b.z - s.center.z);
    let d = a1 - a0;
    if (s.cw) { while (d > 0) d -= 2 * Math.PI; } else { while (d < 0) d += 2 * Math.PI; }
    const R = Math.hypot(s.a.z - s.center.z, s.a.r - s.center.r);
    const k = Math.max(2, Math.ceil(Math.abs(d) * R / step));
    for (let q = 0; q < k; q++) {
      const t = a0 + d * q / k;
      out.push({ z: s.center.z + R * Math.cos(t), r: s.center.r + R * Math.sin(t) });
    }
  }
  if (segs.length) out.push(segs[segs.length - 1].b);
  return out;
}
