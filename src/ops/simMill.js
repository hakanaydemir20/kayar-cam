// Simültane 4 eksen frezeleme (X-Y-Z-C): çapraz tahrikli parmak freze, seçilen 3D yüzeyler.
// Takım ekseni radyal (X), parça C ile döner; takım merkezi Y kadar kaydırılabilir.
// Yöntem (CAM "drop cutter"): her (C, Z) konumunda düz uçlu freze diski (yarıçap R, merkez Y/Z) parça
// üçgenleriyle TAM kesiştirilir (içerideki köşeler, kenar–çember kesişimleri, düzlem içi en yüksek nokta);
// diskin altındaki en yüksek nokta takımın inebileceği X'i verir (örnekleme boşluğu yok → dalma yok).
// Bütün parça yüzeyi kontrol yüzeyidir (seçilmeyen yüzeylere de dalınmaz); seçili yüzeyler bölgeyi belirler.

const DEG = Math.PI / 180;
const r3 = (v) => Math.round(v * 1000) / 1000;
const MAX_CLOUD = 400000;   // nokta bulutu bellek sınırı

/** Parça çerçevesinde nokta bulutu (hedef yüzey / bölge). toPart(fx,p) → [d, a, b]; açı θ = atan2(b, a), C = −θ.
 *  Bölme kenar uzunluğuna göre (üst sınır yok); toplam maxPts'i aşarsa aralık büyütülür (bellek sınırlı). */
export function surfaceCloud(mesh, toPartFn, faceIds, spacing = 0.12, maxPts = MAX_CLOUD) {
  const P = mesh.positions, I = mesh.indices, F = mesh.faceOf;
  const sel = new Set((faceIds || []).map(Number));
  const nTri = I.length / 3;
  const V = (k) => toPartFn([P[3 * k], P[3 * k + 1], P[3 * k + 2]]);
  const tris = [], Ls = new Float64Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const A = V(I[3 * t]), B = V(I[3 * t + 1]), C = V(I[3 * t + 2]);
    tris.push([A, B, C]);
    Ls[t] = Math.max(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]), Math.hypot(B[0] - C[0], B[1] - C[1], B[2] - C[2]), Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]));
  }
  const count = (sp) => { let s = 0; for (let t = 0; t < nTri; t++) { const n = Math.max(1, Math.ceil(Ls[t] / sp)); s += (n + 1) * (n + 2) / 2; } return s; };
  let sp = spacing;
  while (count(sp) > maxPts) sp *= 1.25;
  const N = count(sp);
  const d = new Float32Array(N), a = new Float32Array(N), b = new Float32Array(N), s = new Uint8Array(N);
  let m = 0;
  for (let t = 0; t < nTri; t++) {
    const [A, B, C] = tris[t];
    const on = sel.has(F ? F[t] : -1) ? 1 : 0;
    const n = Math.max(1, Math.ceil(Ls[t] / sp));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      d[m] = A[0] * w + B[0] * u + C[0] * v; a[m] = A[1] * w + B[1] * u + C[1] * v; b[m] = A[2] * w + B[2] * u + C[2] * v; s[m] = on; m++;
    }
  }
  return { d, a, b, sel: s, n: N, spacing: sp };
}

/** Parça çerçevesinde üçgenler: v = [d,a,b]×3, sel = seçili yüzey */
export function surfaceTris(mesh, toPartFn, faceIds) {
  const P = mesh.positions, I = mesh.indices, F = mesh.faceOf;
  const selSet = new Set((faceIds || []).map(Number));
  const n = I.length / 3, v = new Float64Array(9 * n), sel = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = I[3 * t + k], q = toPartFn([P[3 * vi], P[3 * vi + 1], P[3 * vi + 2]]);
      v[9 * t + 3 * k] = q[0]; v[9 * t + 3 * k + 1] = q[1]; v[9 * t + 3 * k + 2] = q[2];
    }
    sel[t] = selSet.has(F ? F[t] : -1) ? 1 : 0;
  }
  return { v, sel, n };
}

/** Üçgenin θ aralığı {t0, w} (rad); eksene değen / ekseni saran üçgen → null (tam tur) */
function triArc(v, t) {
  const th = [], A = [], Bv = [];
  for (let k = 0; k < 3; k++) {
    const a = v[9 * t + 3 * k + 1], b = v[9 * t + 3 * k + 2];
    if (Math.hypot(a, b) < 1e-6) return null;
    A.push(a); Bv.push(b);
    let x = Math.atan2(b, a); if (x < 0) x += 2 * Math.PI; th.push(x);
  }
  const cr = (i, j) => A[i] * Bv[j] - A[j] * Bv[i];
  const c0 = cr(0, 1), c1 = cr(1, 2), c2 = cr(2, 0);
  const area = Math.abs((A[1] - A[0]) * (Bv[2] - Bv[0]) - (A[2] - A[0]) * (Bv[1] - Bv[0]));
  if (area > 1e-12 && ((c0 >= 0 && c1 >= 0 && c2 >= 0) || (c0 <= 0 && c1 <= 0 && c2 <= 0))) return null;
  th.sort((x, y) => x - y);
  const gaps = [th[1] - th[0], th[2] - th[1], th[0] + 2 * Math.PI - th[2]];
  let g = 0; for (let k = 1; k < 3; k++) if (gaps[k] > gaps[g]) g = k;
  if (gaps[g] <= Math.PI) return null;
  return { t0: th[(g + 1) % 3], w: 2 * Math.PI - gaps[g] };
}

/** Z × θ (2°) kovaları; üçgen kapladığı her kovaya kaydedilir. Bellek sınırı için Z kovası büyütülür. */
function bucket(T, zb = 0.25, nt = 180, maxEntries = 4e6) {
  let zmin = Infinity, zmax = -Infinity;
  const tz0 = new Float64Array(T.n), tz1 = new Float64Array(T.n), arcs = [];
  for (let t = 0; t < T.n; t++) {
    const d0 = T.v[9 * t], d1 = T.v[9 * t + 3], d2 = T.v[9 * t + 6];
    tz0[t] = Math.min(d0, d1, d2); tz1[t] = Math.max(d0, d1, d2);
    if (tz0[t] < zmin) zmin = tz0[t]; if (tz1[t] > zmax) zmax = tz1[t];
    arcs.push(triArc(T.v, t));
  }
  if (!(zmax >= zmin)) { zmin = 0; zmax = 0; }
  const dth = 2 * Math.PI / nt;
  const thCells = (t) => { const a = arcs[t]; if (!a) return [0, nt]; const i0 = Math.floor(a.t0 / dth); return [i0, Math.min(nt, Math.floor((a.t0 + a.w) / dth) - i0 + 1)]; };
  let nz, total;
  for (;;) {
    nz = Math.max(1, Math.ceil((zmax - zmin) / zb) + 1); total = 0;
    for (let t = 0; t < T.n; t++) total += (Math.min(nz - 1, Math.floor((tz1[t] - zmin) / zb)) - Math.floor((tz0[t] - zmin) / zb) + 1) * thCells(t)[1];
    if (total <= maxEntries || zb > 1e3) break;
    zb *= 2;
  }
  const each = (t, f) => {
    const iz0 = Math.floor((tz0[t] - zmin) / zb), iz1 = Math.min(nz - 1, Math.floor((tz1[t] - zmin) / zb));
    const [i0, m] = thCells(t);
    for (let iz = iz0; iz <= iz1; iz++) for (let k = 0; k < m; k++) f(iz * nt + ((i0 + k) % nt));
  };
  const cnt = new Uint32Array(nz * nt + 1);
  for (let t = 0; t < T.n; t++) each(t, (key) => cnt[key + 1]++);
  for (let k = 1; k < cnt.length; k++) cnt[k] += cnt[k - 1];
  const idx = new Uint32Array(total), fill = cnt.slice(0, nz * nt);
  for (let t = 0; t < T.n; t++) each(t, (key) => { idx[fill[key]++] = t; });
  return { zmin, zb, nz, nt, start: cnt, idx, stamp: new Uint32Array(T.n), q: 0 };
}

/** Üçgen ∩ disk üzerinde en büyük u (takım ekseni yönü). Disk (s, z) düzleminde merkez (Y, Z), yarıçap R.
 *  Doğrusal fonksiyonun dışbükey bölgedeki en büyüğü sınırdadır: içerideki köşeler, kenar–çember kesişimleri,
 *  çember üzerinde gradyan yönündeki nokta (üçgen içindeyse). Kesişim yoksa −∞. */
export function triDiskMax(v, t, cp, sp, Y, Z, R) {
  const x = [0, 0, 0], y = [0, 0, 0], u = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const d = v[9 * t + 3 * k], a = v[9 * t + 3 * k + 1], b = v[9 * t + 3 * k + 2];
    u[k] = a * cp + b * sp; x[k] = -a * sp + b * cp - Y; y[k] = d - Z;
  }
  const R2 = R * R * (1 + 1e-9) + 1e-12;
  let best = -Infinity;
  for (let k = 0; k < 3; k++) {
    if (x[k] * x[k] + y[k] * y[k] <= R2 && u[k] > best) best = u[k];
    const j = (k + 1) % 3, ex = x[j] - x[k], ey = y[j] - y[k];
    const A = ex * ex + ey * ey; if (A < 1e-18) continue;
    const Bq = 2 * (x[k] * ex + y[k] * ey), Cq = x[k] * x[k] + y[k] * y[k] - R * R;
    const D = Bq * Bq - 4 * A * Cq; if (D < 0) continue;
    const sq = Math.sqrt(D);
    for (const tt of [(-Bq - sq) / (2 * A), (-Bq + sq) / (2 * A)]) {
      if (tt < 0 || tt > 1) continue;
      const uu = u[k] + (u[j] - u[k]) * tt; if (uu > best) best = uu;
    }
  }
  const x1 = x[1] - x[0], y1 = y[1] - y[0], x2 = x[2] - x[0], y2 = y[2] - y[0];
  const det = x1 * y2 - x2 * y1;
  if (Math.abs(det) > 1e-12) {
    const u1 = u[1] - u[0], u2 = u[2] - u[0];
    const gx = (u1 * y2 - u2 * y1) / det, gy = (x1 * u2 - x2 * u1) / det;
    const gn = Math.hypot(gx, gy);
    const px = gn > 1e-12 ? R * gx / gn : 0, py = gn > 1e-12 ? R * gy / gn : 0;
    const qx = px - x[0], qy = py - y[0];
    const l1 = (qx * y2 - x2 * qy) / det, l2 = (x1 * qy - qx * y1) / det;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l1 + l2 <= 1 + 1e-9) {
      const uu = u[0] + gx * qx + gy * qy; if (uu > best) best = uu;
    }
  }
  return best;
}

/** Disk altındaki en yüksek nokta: takım ekseni φ = −C açısında, merkez (Y, Z), yarıçap R.
 *  Dönüş: { h: radyal yükseklik (X/2), disk altında yüzey yoksa −∞; sel: diskin altında seçili yüzey var mı } */
export function dropAt(T, B, C, Y, Z, R) {
  const phi = -C * DEG, cp = Math.cos(phi), sp = Math.sin(phi);
  let best = -Infinity, hitSel = false;
  const iz0 = Math.max(0, Math.floor((Z - R - B.zmin) / B.zb)), iz1 = Math.min(B.nz - 1, Math.floor((Z + R - B.zmin) / B.zb));
  if (iz1 < iz0) return { h: -Infinity, sel: false };
  if (++B.q >= 0xffffffff) { B.stamp.fill(0); B.q = 1; }
  const qs = B.q;
  let thc = phi % (2 * Math.PI); if (thc < 0) thc += 2 * Math.PI;
  const itc = Math.floor(thc / (2 * Math.PI) * B.nt), dth = 2 * Math.PI / B.nt, lat = Math.abs(Y) + R;
  for (let q = 0; q <= B.nt / 2; q++) {
    // q kova uzaklığındaki noktaların en fazla çıkabileceği yükseklik: lat / tan(δ)
    const delta = Math.max(0, (q - 1)) * dth;
    if (delta > 0 && (delta >= Math.PI / 2 || lat / Math.tan(delta) < best)) break;
    for (const sgn of q === 0 ? [0] : [1, -1]) {
      const it = ((itc + sgn * q) % B.nt + B.nt) % B.nt;
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = iz * B.nt + it;
        for (let m = B.start[k]; m < B.start[k + 1]; m++) {
          const t = B.idx[m];
          if (B.stamp[t] === qs) continue;
          B.stamp[t] = qs;
          const v = T.v, o = 9 * t;
          if (Math.min(v[o], v[o + 3], v[o + 6]) > Z + R || Math.max(v[o], v[o + 3], v[o + 6]) < Z - R) continue;
          const umax = Math.max(v[o + 1] * cp + v[o + 2] * sp, v[o + 4] * cp + v[o + 5] * sp, v[o + 7] * cp + v[o + 8] * sp);
          if (umax <= best && !(T.sel[t] && !hitSel)) continue;
          const h = triDiskMax(v, t, cp, sp, Y, Z, R);
          if (h === -Infinity) continue;
          if (T.sel[t]) hitSel = true;
          if (h > best) best = h;
        }
      }
    }
  }
  return { h: best, sel: hitSel };
}

/** Seçili yüzeylerin bölgesi: Z aralığı ve C aralığı (tam tur ya da yay) */
export function selRegion(cl) {
  let z0 = Infinity, z1 = -Infinity, rmax = 0;
  const bins = new Uint8Array(360);
  for (let i = 0; i < cl.n; i++) {
    if (!cl.sel[i]) continue;
    if (cl.d[i] < z0) z0 = cl.d[i]; if (cl.d[i] > z1) z1 = cl.d[i];
    const r = Math.hypot(cl.a[i], cl.b[i]); if (r > rmax) rmax = r;
    if (r < 1e-3) continue;
    let c = -Math.atan2(cl.b[i], cl.a[i]) / DEG; c = ((c % 360) + 360) % 360;
    bins[Math.floor(c) % 360] = 1;
  }
  if (!(z1 >= z0)) return null;
  const used = bins.reduce((s, v) => s + v, 0);
  if (used >= 300) return { z0, z1, rmax, full: true, c0: 0, c1: 360 };
  // en büyük boşluğun tümleyeni
  let bestLen = -1, bestStart = 0;
  for (let s = 0; s < 360; s++) {
    if (bins[s] || !bins[(s + 359) % 360]) continue;
    let L = 0; while (L < 360 && !bins[(s + L) % 360]) L++;
    if (L > bestLen) { bestLen = L; bestStart = s; }
  }
  // C aralığı: c0 ∈ [−180, 180), c1 = c0 + genişlik (yol içinde süreklilik korunur, 360 üstü mutlak C yok)
  let c0 = bestStart + bestLen, c1 = bestStart + 360;
  const k = 360 * Math.floor((c0 + 180) / 360); c0 -= k; c1 -= k;
  return { z0, z1, rmax, full: false, c0, c1 };
}

/** Yükseklik haritası: C × Z ızgarasında takımın inebileceği X/2 ve seçili yüzey maskesi */
export function heightMap(cl, B, reg, R, Y, opts = {}) {
  const ext = R + 0.2;
  const za = reg.z0 - (opts.zExt ?? 0), zb = reg.z1 + (opts.zExt ?? 0);
  const dz = opts.dz || 0.15;
  const cExt = reg.full ? 0 : (ext / Math.max(1, reg.rmax)) / DEG;
  const ca = reg.full ? 0 : reg.c0 - cExt, cb = reg.full ? 360 : reg.c1 + cExt;
  const dc = opts.dc || Math.max(0.25, Math.min(3, (dz / Math.max(1, reg.rmax)) / DEG));
  const nz = Math.max(2, Math.ceil((zb - za) / dz) + 1), nc = Math.max(2, Math.ceil((cb - ca) / dc) + 1);
  const H = new Float32Array(nz * nc), S = new Uint8Array(nz * nc);
  for (let i = 0; i < nz; i++) {
    const z = za + (zb - za) * i / (nz - 1);
    for (let j = 0; j < nc; j++) {
      const c = ca + (cb - ca) * j / (nc - 1);
      const r = dropAt(cl, B, c, Y, z, R);
      H[i * nc + j] = r.h; S[i * nc + j] = r.sel ? 1 : 0;
    }
  }
  const wrap = (c) => reg.full ? ((c % 360) + 360) % 360 : c;
  const at = (c, z) => {
    c = wrap(c);
    // komşu dört hücrenin en büyüğü (güvenli taraf: hücre arasında dalma olmaz)
    const fi = (z - za) / (zb - za) * (nz - 1), fj = (c - ca) / (cb - ca) * (nc - 1);
    const i0 = Math.max(0, Math.min(nz - 1, Math.floor(fi))), j0 = Math.max(0, Math.min(nc - 1, Math.floor(fj)));
    const i1 = Math.min(nz - 1, i0 + 1), j1 = Math.min(nc - 1, j0 + 1);
    return Math.max(H[i0 * nc + j0], H[i0 * nc + j1], H[i1 * nc + j0], H[i1 * nc + j1]);
  };
  const selAt = (c, z) => {
    c = wrap(c);
    const i = Math.round((z - za) / (zb - za) * (nz - 1)), j = Math.round((c - ca) / (cb - ca) * (nc - 1));
    return i >= 0 && i < nz && j >= 0 && j < nc && S[i * nc + j] === 1;
  };
  return { za, zb, ca, cb, nz, nc, dz, dc, H, S, at, selAt };
}

/** Strateji yolları: (C, Z) parametre düzleminde çoklu çizgiler [{c, z}] */
export function strategyPaths(HM, reg, strategy, stepMm) {
  const rS = Math.max(1, reg.rmax);
  const stepC = Math.max(0.2, (stepMm / rS) / DEG);
  const paths = [];
  const { za, zb, ca, cb } = HM;
  const dzS = 0.2, dcS = Math.max(0.2, (0.2 / rS) / DEG);
  const lineZ = (c, rev) => { const p = []; const n = Math.max(1, Math.ceil((zb - za) / dzS)); for (let k = 0; k <= n; k++) { const t = rev ? 1 - k / n : k / n; p.push({ c, z: za + (zb - za) * t }); } return p; };
  const lineC = (z, rev) => { const p = []; const n = Math.max(1, Math.ceil((cb - ca) / dcS)); for (let k = 0; k <= n; k++) { const t = rev ? 1 - k / n : k / n; p.push({ c: ca + (cb - ca) * t, z }); } return p; };
  if (strategy === 'parallelZ') {
    let k = 0;
    for (let c = ca; c <= cb + 1e-9 - (reg.full ? stepC * 0.5 : 0); c += stepC) paths.push(lineZ(c, k++ % 2 === 1));
  } else if (strategy === 'spiral' && reg.full) {
    // sürekli sarmal: C artarken Z tur başına adım kadar ilerler
    const turns = Math.max(1, (zb - za) / stepMm), n = Math.ceil(turns * 360 / dcS);
    const p = [];
    for (let k = 0; k <= n; k++) { const c = k * dcS; p.push({ c, z: Math.min(zb, za + (c / 360) * stepMm) }); }
    p.push({ c: p[p.length - 1].c + 360, z: zb });   // son tur: Z sonunda tam tur (iz kalmasın)
    paths.push(p);
  } else if (strategy === 'contour') {
    // seçili bölgenin sınırı: her Z satırında seçili C aralığının uçları; sol kenar yukarı, sağ kenar aşağı
    const left = [], right = [];
    for (let i = 0; i < HM.nz; i++) {
      const z = za + (zb - za) * i / (HM.nz - 1);
      let lo = null, hi = null;
      for (let j = 0; j < HM.nc; j++) if (HM.S[i * HM.nc + j]) { const c = ca + (cb - ca) * j / (HM.nc - 1); if (lo == null) lo = c; hi = c; }
      if (lo != null) { left.push({ c: lo, z }); right.push({ c: hi, z }); }
    }
    if (reg.full) { paths.push(lineC(za, false)); paths.push(lineC(zb, true)); }
    else if (left.length) paths.push([...left, ...right.reverse(), left[0]]);
  } else {
    // çevresel (C boyunca) — sarmal tam tur olmayan bölgede de bu kullanılır
    let k = 0;
    for (let z = za; z <= zb + 1e-9; z += stepMm) paths.push(lineC(Math.min(z, zb), !reg.full && k++ % 2 === 1));
    if (paths.length && paths[paths.length - 1][0].z < zb - 1e-6) paths.push(lineC(zb, !reg.full && k % 2 === 1));
  }
  return paths;
}

/** Ardışık doğrusal noktaları seyrelt (tolerans içinde) */
function simplify(pts, tol = 0.004) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let a = 0;
  for (let k = 2; k < pts.length; k++) {
    const A = pts[a], Bq = pts[k];
    let ok = true;
    for (let m = a + 1; m < k && ok; m++) {
      const t = (m - a) / (k - a), M = pts[m];
      ok = Math.abs(A.x + (Bq.x - A.x) * t - M.x) <= tol && Math.abs(A.z + (Bq.z - A.z) * t - M.z) <= tol && Math.abs(A.c + (Bq.c - A.c) * t - M.c) <= 0.05;
    }
    if (!ok) { out.push(pts[k - 1]); a = k - 1; }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * İşlem: prog (IR), ctx (bağlam), op, tool, yardımcılar {startLive, endLive, liveData}
 * Parametreler: faceIds, strategy, stockLeave (üst ölçü), approach (giriş mesafesi), ap (talaş derinliği),
 * finishAllow (finiş payı), stepover (yanal adım ×D), y (takım ekseni Y kaydırma), finishPass
 */
export function genSimMill(prog, ctx, op, tool, H) {
  const p = op.params, name = op.name;
  const part = ctx.part;
  if (!part.mesh || !part.fixture) throw new Error(`${name}: 3D model (STEP) gerekli — yüzey seçimi için parçayı STEP olarak açın`);
  if (!(p.faceIds || []).length) throw new Error(`${name}: işlenecek yüzey seçilmedi — “Yüzey seç” ile modelde yüzeylere tıklayın`);
  if (tool.type !== 'endmill') throw new Error(`${name}: parmak freze gerekli`);
  const R = tool.dia / 2, Y = +p.y || 0;
  const leave = Math.max(0, +p.stockLeave || 0), fin = Math.max(0, +p.finishAllow || 0);
  const ap = Math.max(0.02, +p.ap || 0.5), appr = Math.max(0.2, +(p.approach ?? 1) || 0);
  const stepMm = Math.max(0.02, (+p.stepover || 0.3) * tool.dia);
  const tp = (q) => H.toPart(part.fixture, q);
  const reg = selRegion(surfaceCloud(part.mesh, tp, p.faceIds, 0.12, 150000));
  if (!reg) throw new Error(`${name}: seçili yüzeyler modelde bulunamadı`);
  const T = surfaceTris(part.mesh, tp, p.faceIds);
  const B = bucket(T);
  const HM = heightMap(T, B, reg, R, Y, { zExt: 0 });
  const strategy = p.strategy || 'parallelZ';
  if (strategy === 'spiral' && !reg.full) prog.comment('SARMAL ICIN TAM TUR YUZEY GEREKIR - CEVRESEL');
  const paths = strategyPaths(HM, reg, strategy, stepMm);
  if (!paths.length) throw new Error(`${name}: bölge takım için çok dar`);
  // başlangıç stok yüzeyi: tornalanmış profil (takım genişliğinde en büyük) — kaba katlar buradan iner
  // önce tornalama yoksa stok çubuk çapındadır
  const ops = ctx.project.ops || [], me = ops.indexOf(op);
  const turned = ops.some((o, k) => o.enabled !== false && k < (me < 0 ? ops.length : me) && ['rough', 'finish'].includes(o.type));
  const rS = (z) => turned ? ctx.rAt(z) : ctx.barR;
  const top = (z) => { let m = 0; for (let t = -R; t <= R + 1e-9; t += Math.max(0.05, R / 6)) m = Math.max(m, rS(z + t)); return m; };
  let topMax = 0; for (let z = HM.za - R; z <= HM.zb + R; z += 0.1) topMax = Math.max(topMax, rS(z));
  const xUp = r3(2 * (topMax + appr));
  // her yol noktasında son (bitiş) yüksekliği
  const P = paths.map(path => path.map(q => {
    const hh = HM.at(q.c, q.z);
    // yükseklik yoksa (disk altında yüzey yok) asla 0 sayılmaz: hava; seçili bölgedeyse hata
    if (!Number.isFinite(hh) && HM.selAt(q.c, q.z)) throw new Error(`${name}: C${r3(q.c)} Z${r3(q.z)} konumunda model yüzeyi bulunamadı — model kapalı değil ya da seçim hatalı`);
    return { c: q.c, z: q.z, hf: Number.isFinite(hh) ? hh + leave : NaN, top: top(q.z) };
  }));
  // katlar: üstten ap kadar, finiş payında dur; sonra finiş pasosu (p.finishPass false ise yalnız kaba)
  let maxDepth = 0;
  for (const path of P) for (const q of path) if (Number.isFinite(q.hf)) maxDepth = Math.max(maxDepth, q.top - (q.hf + fin));
  const levels = [];
  for (let k = 1; k * ap < maxDepth - 1e-6; k++) levels.push(k * ap);
  levels.push(Infinity);   // kaba son kat: finiş payına kadar
  const passes = levels.map(dl => ({ off: fin, dl }));
  if (p.finishPass !== false) passes.push({ off: 0, dl: Infinity, finish: true });
  const { feed } = H.liveData(ctx, tool);
  const ff = Math.max(5, +p.feed || feed);
  H.startLive(prog, ctx, tool, r3(P[0][0].c));
  prog.comment(`SIMULTANE 4 EKSEN ${({ parallelZ: 'PARALEL Z', circC: 'CEVRESEL C', spiral: 'SARMAL', contour: 'KONTUR' })[strategy] || ''} - YUZEY ${p.faceIds.length}`);
  prog.comment(`UST OLCU ${r3(leave)} FINIS PAYI ${r3(fin)} TALAS ${r3(ap)} GIRIS ${r3(appr)}`);
  let cur = null;   // son komut konumu {X,Y,Z,C}
  const emit = (pt, rapid) => {
    const t = { X: r3(pt.x), Y: r3(Y), Z: r3(pt.z), C: r3(pt.c) };
    if (rapid) { prog.rapid(t); cur = t; return; }
    // FANUC G98: döner eksenli bileşik harekette F = √(ΔX²+ΔY²+ΔZ²+ΔC°²) üzerinden → yüzey hızını korumak için F ölçeklenir
    const a = cur || t;
    const Lc = Math.hypot((t.X - a.X) / 2, t.Y - a.Y, t.Z - a.Z, t.C - a.C);
    const rr = Math.max(Math.abs(t.X), Math.abs(a.X)) / 2;
    const Ls = Math.hypot((t.X - a.X) / 2, t.Y - a.Y, t.Z - a.Z, (t.C - a.C) * DEG * rr);
    const F = Ls > 1e-6 ? Math.max(5, Math.min(20000, Math.round(ff * Lc / Ls))) : ff;
    prog.line(t, F); cur = t;
  };
  for (const pass of passes) {
    for (const path of P) {
      const pts = path.map(q => {
        if (!Number.isFinite(q.hf)) return { c: q.c, z: q.z, x: 2 * q.top, air: true };
        const floor = q.hf + pass.off;
        const lv = pass.dl === Infinity ? floor : Math.max(floor, q.top - pass.dl);
        return { c: q.c, z: q.z, x: 2 * lv, air: !pass.finish && lv >= q.top - 1e-3 };
      });
      // havada kalan bölümleri atla: kesen bölümler ayrı ayrı (giriş/çıkış X yukarıda)
      let seg = [];
      const flush = () => {
        if (!seg.length) return;
        let s = simplify(seg);
        // C'yi son konuma en yakın 360° katına kaydır (aynı geometri; gereksiz geri sarma yok)
        if (cur) { const k = 360 * Math.round((cur.C - s[0].c) / 360); if (k) s = s.map(q => ({ ...q, c: q.c + k })); }
        emit({ x: xUp, z: s[0].z, c: s[0].c }, true);
        emit({ x: s[0].x + 2 * appr, z: s[0].z, c: s[0].c }, true);
        emit(s[0], false);
        for (let k = 1; k < s.length; k++) emit(s[k], false);
        emit({ x: xUp, z: s[s.length - 1].z, c: s[s.length - 1].c }, true);
        seg = [];
      };
      for (const q of pts) { if (q.air) flush(); else seg.push(q); }
      flush();
    }
  }
  prog.rapid({ X: xUp }); prog.rapid({ Y: 0 });
  // Sarmal/tam tur yollarında C sürekli artar (tur başına +360); endLive C0'a döner (geri sarma = son C kadar,
  // hızlı harekette). Kısa geri sarma için post tarafında C ekseni sıfırlama kodu gerekir (postta yok).
  H.endLive(prog, ctx);
}
