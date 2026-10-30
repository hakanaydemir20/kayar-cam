// OBJ okuma: üçgen ağı + yüz bölgeleri. OBJ'de B-rep yüzü olmadığı için komşu üçgenler normal açısına göre
// bölgelere ayrılır (düzlem / silindir / koni ayrı yüz olur). Çıktı readStep() ile aynı biçimdedir.

/**
 * @param {string} text OBJ içeriği (birim mm kabul edilir)
 * @param {{angle?: number}} opts komşu üçgenler arası en büyük açı (derece) — aynı yüz sayılır
 */
export function readObj(text, opts = {}) {
  const V = [], tris = [];
  for (const raw of text.split('\n')) {
    const ln = raw.trim();
    if (ln.startsWith('v ')) { const p = ln.split(/\s+/); V.push(+p[1], +p[2], +p[3]); }
    else if (ln.startsWith('f ')) {
      const ids = ln.split(/\s+/).slice(1).map(w => { const i = parseInt(w.split('/')[0], 10); return i < 0 ? V.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < ids.length; k++) tris.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  const nv = V.length / 3, nt = tris.length / 3;
  if (!nt) throw new Error('OBJ dosyasında yüz (f) bulunamadı');
  for (const i of tris) if (!(i >= 0 && i < nv)) throw new Error('OBJ dosyasında geçersiz köşe numarası');
  // aynı konumdaki köşeleri birleştir (komşuluk için)
  const key = new Map(), weld = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(V[i * 3] * 1e4)},${Math.round(V[i * 3 + 1] * 1e4)},${Math.round(V[i * 3 + 2] * 1e4)}`;
    if (!key.has(k)) key.set(k, i);
    weld[i] = key.get(k);
  }
  // üçgen normalleri ve alanları
  const TN = new Float64Array(nt * 3), TA = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    TA[t] = l / 2;
    if (l > 0) { TN[t * 3] = nx / l; TN[t * 3 + 1] = ny / l; TN[t * 3 + 2] = nz / l; }
  }
  // kenar → üçgenler
  const edges = new Map();
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const p = weld[tris[t * 3 + e]], q = weld[tris[t * 3 + (e + 1) % 3]];
      const k = p < q ? p * nv + q : q * nv + p;
      const l = edges.get(k); if (l) l.push(t); else edges.set(k, [t]);
    }
  }
  const nb = Array.from({ length: nt }, () => []);
  for (const l of edges.values()) if (l.length === 2) { nb[l[0]].push(l[1]); nb[l[1]].push(l[0]); }
  // 1) düzlemsel parçalar: tohum normaline 0.5° içinde, bağlantılı üçgenler
  const cosPlane = Math.cos(0.5 * Math.PI / 180), cosA = Math.cos(((opts.angle ?? 32) * Math.PI) / 180);
  const dot = (a, b) => TN[a * 3] * TN[b * 3] + TN[a * 3 + 1] * TN[b * 3 + 1] + TN[a * 3 + 2] * TN[b * 3 + 2];
  const patch = new Int32Array(nt).fill(-1), seed = [];
  for (let s = 0; s < nt; s++) {
    if (patch[s] >= 0) continue;
    const r = seed.length; seed.push(s);
    patch[s] = r;
    const stack = [s];
    while (stack.length) {
      const t = stack.pop();
      for (const u of nb[t]) if (patch[u] < 0 && dot(s, u) > cosPlane) { patch[u] = r; stack.push(u); }
    }
  }
  // 2) silindirik yüzler: komşu iki parçadan silindir modeli (eksen, merkez, yarıçap) çıkar; yalnız bu modele
  //    uyan parçaları ekle. Silindire teğet geniş düzlük (frezelenmiş yüz) açısal genişliği büyük olduğu için ayrı kalır.
  const np = seed.length, owner = new Int32Array(np).fill(-1);
  const pTris = Array.from({ length: np }, () => []);
  for (let t = 0; t < nt; t++) pTris[patch[t]].push(t);
  const pNb = Array.from({ length: np }, () => new Map());   // komşu parça → ortak kenar (köşe çifti)
  for (const [k, l] of edges) {
    if (l.length !== 2) continue;
    const A = patch[l[0]], B = patch[l[1]];
    if (A === B) continue;
    const e = [Math.floor(k / nv), k % nv, l[0], l[1]];
    if (!pNb[A].has(B)) pNb[A].set(B, e);
    if (!pNb[B].has(A)) pNb[B].set(A, [e[0], e[1], l[1], l[0]]);
  }
  const vx = (i) => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const tn = (t) => [TN[t * 3], TN[t * 3 + 1], TN[t * 3 + 2]];
  /** e = [v0, v1, tA, tB]: iki üçgenin ortak kenarı → silindir modeli */
  function modelFrom(e) {
    const nA = tn(e[2]), nB = tn(e[3]);
    let a = [nA[1] * nB[2] - nA[2] * nB[1], nA[2] * nB[0] - nA[0] * nB[2], nA[0] * nB[1] - nA[1] * nB[0]];
    const la = Math.hypot(...a); if (la < 1e-6) return null;
    a = a.map(v => v / la);
    const far = (t) => [0, 1, 2].map(j => weld[tris[t * 3 + j]]).find(w => w !== e[0] && w !== e[1]);
    const pts = [vx(e[0]), vx(far(e[2])), vx(far(e[3]))];
    const u = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let e1 = sub3(u, a.map(v => v * dot3(u, a))); const l1 = Math.hypot(...e1); e1 = e1.map(v => v / l1);
    const e2 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
    const q = pts.map(p => [dot3(p, e1), dot3(p, e2)]);
    // çevrel çember
    const [[ax, ay], [bx, by], [cx, cy]] = q;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy);
    if (!(r > 1e-3 && r < 1e5)) return null;
    // dışbükey mi (normal merkezden dışarı)?
    const cen = pts.reduce((s2, p) => [s2[0] + p[0] / 3, s2[1] + p[1] / 3, s2[2] + p[2] / 3], [0, 0, 0]);
    const rad = [dot3(cen, e1) - ux, dot3(cen, e2) - uy];
    const sgn = Math.sign(dot3(nA, e1) * rad[0] + dot3(nA, e2) * rad[1]) || 1;
    return { a, e1, e2, ux, uy, r, sgn, tol: r * 0.03, verts: new Set(), nextFit: 8 };
  }
  function fits(M, t) {
    const n = tn(t);
    const D = opts.dbg || {}, no = (k) => { D[k] = (D[k] || 0) + 1; return false; };   // opts.dbg: ret nedeni sayaçları (test)
    if (Math.abs(dot3(n, M.a)) > 0.02) return no('axis');
    const ang = [];
    for (let j = 0; j < 3; j++) {
      const p = vx(weld[tris[t * 3 + j]]);
      const x = dot3(p, M.e1) - M.ux, y = dot3(p, M.e2) - M.uy;
      if (Math.abs(Math.hypot(x, y) - M.r) > M.tol) return no('rad');
      ang.push(Math.atan2(y, x));
    }
    // üçgenin açısal genişliği (geniş düzlük ≠ silindir şeridi)
    let span = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { let dA = Math.abs(ang[i] - ang[j]); if (dA > Math.PI) dA = 2 * Math.PI - dA; span = Math.max(span, dA); }
    if (span > 32 * Math.PI / 180) return no('span');
    // normal radyal yönde (dışbükey / içbükey tutarlı)
    const c = [0, 1, 2].map(j => vx(weld[tris[t * 3 + j]])).reduce((s2, p) => [s2[0] + p[0] / 3, s2[1] + p[1] / 3, s2[2] + p[2] / 3], [0, 0, 0]);
    const rx = dot3(c, M.e1) - M.ux, ry = dot3(c, M.e2) - M.uy, rl = Math.hypot(rx, ry) || 1;
    return M.sgn * (dot3(n, M.e1) * rx + dot3(n, M.e2) * ry) / rl > 0.85 || no('dir');
  }
  const fitsPatch = (M, P) => pTris[P].every(t => fits(M, t));
  /** Bölgeye parça eklendi: köşeleri topla, yeterince çoğalınca çemberi yeniden oturt (Kåsa en küçük kareler) */
  function grow(M, P) {
    for (const t of pTris[P]) for (let j = 0; j < 3; j++) M.verts.add(weld[tris[t * 3 + j]]);
    if (M.verts.size < M.nextFit) return;
    M.nextFit = Math.ceil(M.verts.size * 1.4);
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0, n = 0;
    for (const v of M.verts) {
      const p = vx(v), x = dot3(p, M.e1), y = dot3(p, M.e2), z = x * x + y * y;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z; n++;
    }
    // [sxx sxy sx; sxy syy sy; sx sy n] [D E F]ᵀ = −[sxz syz sz]ᵀ
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], bb = [-sxz, -syz, -sz];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d0 = det(A);
    if (Math.abs(d0) < 1e-12) return;
    const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? bb[i] : v)));
    const D = det(col(0)) / d0, E = det(col(1)) / d0, F = det(col(2)) / d0;
    const ux = -D / 2, uy = -E / 2, r2 = ux * ux + uy * uy - F;
    if (!(r2 > 0)) return;
    M.ux = ux; M.uy = uy; M.r = Math.sqrt(r2);
    M.tol = M.verts.size < 16 ? M.r * 0.03 : Math.max(0.003, M.r * 0.004);
  }
  let nRegion = 0;
  for (let P = 0; P < np; P++) {
    if (owner[P] >= 0) continue;
    const R = nRegion++;
    owner[P] = R;
    let M = null;
    const queue = [P];
    while (queue.length) {
      const A = queue.shift();
      for (const [B, e] of pNb[A]) {
        if (owner[B] >= 0) continue;
        const c = dot(e[2], e[3]);
        if (c < cosA) continue;
        if (!M) {
          if (c > cosPlane) continue;   // model için gerçek bir açı gerekir
          const m = modelFrom(e);
          if (!m || !fitsPatch(m, P) || !fitsPatch(m, B)) continue;
          M = m; grow(M, P);
        } else if (!fitsPatch(M, B)) continue;
        owner[B] = R; queue.push(B); grow(M, B);
      }
    }
  }
  const region = new Int32Array(nt);
  for (let t = 0; t < nt; t++) region[t] = owner[patch[t]];
  // bölge sırasına göre üçgenleri diz; her bölge kendi köşe kopyalarını alır (yüz başına doğru normal)
  const order = [...Array(nt).keys()].sort((a, b) => region[a] - region[b]);
  const positions = [], normals = [], indices = new Uint32Array(nt * 3), faceOf = new Int32Array(nt), faces = [];
  let cur = -1, vmap = null;
  order.forEach((t, k) => {
    const r = region[t];
    if (r !== cur) { cur = r; vmap = new Map(); faces.push({ tri0: k, tri1: k }); }
    faces[faces.length - 1].tri1 = k;
    faceOf[k] = faces.length - 1;
    for (let e = 0; e < 3; e++) {
      const w = weld[tris[t * 3 + e]];
      let vi = vmap.get(w);
      if (vi === undefined) { vi = positions.length / 3; vmap.set(w, vi); positions.push(V[w * 3], V[w * 3 + 1], V[w * 3 + 2]); normals.push(0, 0, 0); }
      indices[k * 3 + e] = vi;
    }
  });
  // köşe normali: bölge içi üçgen normallerinin açı ağırlıklı ortalaması
  const P = new Float32Array(positions), N = new Float32Array(normals.length);
  for (let k = 0; k < nt; k++) {
    const t = order[k];
    for (let e = 0; e < 3; e++) {
      const i = indices[k * 3 + e], j = indices[k * 3 + (e + 1) % 3], m = indices[k * 3 + (e + 2) % 3];
      const ax = P[j * 3] - P[i * 3], ay = P[j * 3 + 1] - P[i * 3 + 1], az = P[j * 3 + 2] - P[i * 3 + 2];
      const bx = P[m * 3] - P[i * 3], by = P[m * 3 + 1] - P[i * 3 + 1], bz = P[m * 3 + 2] - P[i * 3 + 2];
      const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / ((Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)) || 1))));
      N[i * 3] += TN[t * 3] * ang; N[i * 3 + 1] += TN[t * 3 + 1] * ang; N[i * 3 + 2] += TN[t * 3 + 2] * ang;
    }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return { positions: P, normals: N, indices, faceOf, faces, name: 'OBJ' };
}
