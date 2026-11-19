// Simüle edilmiş stoktan ölçüm: G-kodla işlenen parçanın geometrisini incelemek için saf fonksiyonlar.
// Stok ızgarası: z (ön alından uzaklık d, mm) × θ (çevre) hücrelerinde dış yarıçap r, satır başına iç (delik) yarıçap rin.
// Ölçüm belirsizliği ızgara adımıdır: Z yönünde ±dz/2, çevrede ±π·Ø/nth/2 (rapor `resolution` ile döner).

const RMIN = 0.05;   // bu yarıçapın altı malzeme yok sayılır (kesilmiş / boş satır)

/** Satır başına en büyük / en küçük dış yarıçap ve iç yarıçap */
export function profileRows(S) {
  const rows = new Array(S.nz);
  for (let i = 0; i < S.nz; i++) {
    const o = i * S.nth;
    let mx = 0, mn = Infinity;
    for (let j = 0; j < S.nth; j++) { const r = S.r[o + j]; if (r > mx) mx = r; if (r < mn) mn = r; }
    rows[i] = { d: S.dAt(i), rMax: mx, rMin: mx > RMIN ? mn : 0, rin: S.rin[i] };
  }
  return rows;
}

/** Parçanın Z aralığı: ön alın (ilk malzemeli satır, d ≥ 0) ve son (kesildiyse ayrılma, yoksa son işlenen satır) */
export function partRange(S, R, rows = profileRows(S)) {
  const i0 = rows.findIndex(q => q.d >= -1e-6 && q.rMax > RMIN);
  if (i0 < 0) return null;
  let iEnd = -1, cut = false;
  for (let i = i0 + 1; i < rows.length; i++) if (rows[i].rMax <= RMIN) { iEnd = i - 1; cut = true; break; }
  if (!cut) for (let i = rows.length - 1; i > i0; i--) if (rows[i].rMax < R - 0.01 || rows[i].rin > 0 || rows[i].rMin < R - 0.01) { iEnd = i; break; }
  if (iEnd < i0) iEnd = i0;
  return { i0, iEnd, cut, front: rows[i0].d, end: rows[iEnd].d + (cut ? S.dz : 0) };
}

/**
 * Döner profilin elemanları: silindir (sabit Ø), konik/pah (Ø doğrusal değişir), alın (Ø sıçraması).
 * Dönmeyen işlemler (düzlük, kanal, delik) rMin < rMax farkıyla işaretlenir.
 * @returns [{kind:'cyl'|'taper', z0, z1, d0, d1, len, angle, nonRound}]  z: ön alından mm, d: çap mm
 */
export function profileElements(S, R, { tol = 0.01 } = {}) {
  const rows = profileRows(S), rg = partRange(S, R, rows);
  if (!rg) return { elements: [], range: null };
  const seg = [];
  const pts = [];
  for (let i = rg.i0; i <= rg.iEnd; i++) pts.push({ z: rows[i].d - rg.front, r: rows[i].rMax, nr: rows[i].rMax - rows[i].rMin > 2 * tol });
  // eğim değişiminde böl: aynı doğru üzerinde kalan noktalar tek eleman
  let a = 0;
  const flush = (b) => {
    if (b < a) return;
    const A = pts[a], B = pts[b];
    const len = B.z - A.z + S.dz;
    const dd = 2 * (B.r - A.r);
    const cyl = Math.abs(dd) <= 2 * tol;
    const rAvg = cyl ? pts.slice(a, b + 1).reduce((s, p) => s + p.r, 0) / (b - a + 1) : 0;
    seg.push({
      kind: cyl ? 'cyl' : 'taper',
      z0: round(A.z), z1: round(B.z + S.dz), len: round(len),
      d0: round(cyl ? 2 * rAvg : 2 * A.r), d1: round(cyl ? 2 * rAvg : 2 * B.r),
      angle: cyl ? 0 : round(Math.atan2(Math.abs(B.r - A.r), Math.max(B.z - A.z, 1e-9)) * 180 / Math.PI, 1),
      nonRound: pts.slice(a, b + 1).some(p => p.nr),
    });
  };
  for (let i = a + 1; i < pts.length; i++) {
    const A = pts[a], P = pts[i - 1], Q = pts[i];
    const jump = Math.abs(Q.r - P.r) > Math.max(4 * S.dz, 0.1);      // alın / kademe
    let off = false;
    if (!jump && i - a >= 2) {
      // a..i doğrusundan sapma
      const dz = Q.z - A.z, dr = Q.r - A.r, L = Math.hypot(dz, dr) || 1;
      for (let k = a + 1; k < i; k++) if (Math.abs(dz * (A.r - pts[k].r) - (A.z - pts[k].z) * dr) / L > tol) { off = true; break; }
    }
    if (jump || off) { flush(i - 1); a = i; }
  }
  flush(pts.length - 1);
  // komşu aynı çaplı silindirleri birleştir, ızgara gürültüsünden doğan tek satırlık elemanları komşuya kat
  const out = [];
  for (const s of seg) {
    const p = out[out.length - 1];
    if (p && p.kind === 'cyl' && s.kind === 'cyl' && Math.abs(p.d0 - s.d0) <= 2 * tol) { p.z1 = s.z1; p.len = round(p.z1 - p.z0); p.nonRound ||= s.nonRound; continue; }
    out.push({ ...s });
  }
  return { elements: out, range: rg, resolution: { dz: S.dz, dth: round(Math.PI * 2 * R / S.nth, 3) } };
}

/** Verilen Z'de (ön alından) ölçüm: en büyük / en küçük Ø, iç Ø, yuvarlaklık sapması */
export function probeAt(S, R, z) {
  const rows = profileRows(S), rg = partRange(S, R, rows);
  if (!rg) return null;
  const i = Math.max(0, Math.min(S.nz - 1, S.idx(z + rg.front)));
  const q = rows[i];
  return { z: round(q.d - rg.front), dMax: round(2 * q.rMax), dMin: round(2 * q.rMin), dIn: round(2 * q.rin), roundness: round(q.rMax - q.rMin), material: q.rMax > RMIN };
}

/** Verilen Z'de kesit: [{th(derece, parça açısı), r}] — düzlük, kanal ve çapraz delikleri görmek için */
export function sectionAt(S, R, z) {
  const rg = partRange(S, R);
  if (!rg) return { pts: [], rin: 0 };
  const i = Math.max(0, Math.min(S.nz - 1, S.idx(z + rg.front)));
  const o = i * S.nth, pts = [];
  for (let j = 0; j < S.nth; j++) pts.push({ th: j * 360 / S.nth, r: S.r[o + j] });
  return { pts, rin: S.rin[i], z: round(S.dAt(i) - rg.front) };
}

/** Kaldırılan hacim (mm³) ve kalan parça hacmi — çevrim değerlendirmesi için */
export function volumes(S, R) {
  const rg = partRange(S, R);
  if (!rg) return { part: 0, removed: 0 };
  const dth = 2 * Math.PI / S.nth;
  let part = 0, removed = 0;
  for (let i = rg.i0; i <= rg.iEnd; i++) {
    const o = i * S.nth;
    let a = 0;
    for (let j = 0; j < S.nth; j++) a += 0.5 * S.r[o + j] * S.r[o + j] * dth;
    a -= Math.PI * S.rin[i] * S.rin[i];
    part += a * S.dz;
    removed += (Math.PI * R * R - a) * S.dz;
  }
  return { part: round(part, 1), removed: round(removed, 1) };
}

function round(v, n = 3) { const k = 10 ** n; return Math.round(v * k) / k; }
