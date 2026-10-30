// G-koddan parça: program sonuna kadar simüle edilmiş stoktan bitmiş parçanın döner profilini ve eksenel deliklerini çıkarır.
// Ön alın d=0; parça boyu: kesmeyle ayrıldıysa ayrılma noktası, yoksa işlenen son nokta.
import { makePart } from '../part/part.js';

/** Ramer–Douglas–Peucker: profil noktalarını tol içinde sadeleştir (uçlar korunur) */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const A = pts[a], B = pts[b], dz = B.z - A.z, dr = B.r - A.r, L = Math.hypot(dz, dr) || 1;
    let mx = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dz * (A.r - pts[i].r) - (A.z - pts[i].z) * dr) / L; if (d > mx) { mx = d; mi = i; } }
    if (mx > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * @param stock  runAll() sonrası Stock (ana iş milindeki ızgara; parça ayrıldıysa aynı ızgarada kalır)
 * @param R      çubuk yarıçapı
 * @returns {{part, L, info}} part: makePart(source 'gcode') — işlenmemişse null
 */
export function derivePart(stock, R, name = 'G-kod parçası') {
  const S = stock, rows = [];
  for (let i = 0; i < S.nz; i++) rows.push({ d: S.dAt(i), r: S.rowMax[i], rin: S.rin[i] });
  // ön alın: alın tornalamadan sonra ilk malzemeli satır (d ≥ 0 civarı)
  let i0 = rows.findIndex(q => q.d >= -1e-6 && q.r > 0.05);
  if (i0 < 0) return { part: null, info: 'Malzeme kalmadı' };
  // Z0 = programın sıfırı (alın Z0'a tornalandıysa ilk malzemeli düğüm 0–2 ızgara adımı içindedir): kaydırma yok,
  // aksi halde hedef parça ile stok arasında yapay kayma oluşur
  const front = rows[i0].d <= 2.5 * S.dz ? 0 : rows[i0].d;
  // parça sonu: ön alından sonra malzemenin bittiği (kesme) ilk satır; yoksa işlenen son satır
  let iEnd = -1;
  for (let i = i0 + 1; i < rows.length; i++) if (rows[i].r <= 0.05) { iEnd = i - 1; break; }
  let cut = iEnd >= 0;
  if (!cut) { for (let i = rows.length - 1; i > i0; i--) if (rows[i].r < R - 0.01 || rows[i].rin > 0) { iEnd = i; break; } }
  if (iEnd <= i0) return { part: null, info: 'İşlenmiş bölge bulunamadı: kod malzemeye dokunmuyor' };
  const pts = [{ z: 0, r: 0 }];
  for (let i = i0; i <= iEnd; i++) pts.push({ z: Math.max(0, rows[i].d - front), r: Math.round(rows[i].r * 1000) / 1000 });
  // kesildiyse sınır ilk boş düğümde (son malzemeli düğüm + adım)
  const L = Math.round((rows[iEnd].d - front + (cut ? S.dz : 0)) * 1000) / 1000;
  if (cut) pts.push({ z: L, r: pts[pts.length - 1].r });
  pts.push({ z: L, r: 0 });
  const profile = simplify(pts, 0.004).map(q => ({ z: Math.round(q.z * 1000) / 1000, r: q.r }));
  // eksenel delikler: ön ve arka alından başlayan sürekli iç çap (en geniş kademe derinliği)
  const features = [];
  const holeFrom = (side) => {
    const seq = side === 'front' ? rows.slice(i0, iEnd + 1) : rows.slice(i0, iEnd + 1).reverse();
    if (!(seq[0].rin > 0.05)) return;
    let n = 0; const rs = [];
    while (n < seq.length && seq[n].rin > 0.05) { rs.push(seq[n].rin); n++; }
    const dmin = rs.sort((x, y) => x - y)[Math.floor(rs.length * 0.6)];   // matkap ucu konisi ve ağız pahı ortalamayı bozmasın
    const depth = Math.abs(seq[Math.max(0, n - 1)].d - seq[0].d) + S.dz;
    features.push({ id: 'g' + side, type: 'axialHole', side, dia: Math.round(2 * dmin * 1000) / 1000, depth: Math.round(Math.min(L, depth) * 1000) / 1000, through: n >= seq.length - 1 });
  };
  holeFrom('front');
  if (!features[0]?.through) holeFrom('back');
  const part = makePart({ name, profile, features, source: 'gcode' });
  return { part, L, cut, info: `${cut ? 'kesilen' : 'işlenen'} parça · boy ${L.toFixed(3)} mm · en büyük Ø${(2 * Math.max(...profile.map(q => q.r))).toFixed(3)}${features.length ? ' · ' + features.length + ' eksenel delik' : ''}` };
}
