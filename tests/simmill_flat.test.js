// Simültane frezeleme: sentetik silindir + tek düzlük (asimetrik) — C yönü, Y kaydırma, 0°/360° geçişi, boşluksuz yükseklik.
import { describe, it, expect } from 'vitest';
import { genSimMill, surfaceTris, dropAt, selRegion, surfaceCloud, strategyPaths } from '../src/ops/simMill.js';

const DEG = Math.PI / 180;
const RC = 5, L = 20, H0 = 4;   // silindir yarıçapı, boy, düzlük mesafesi

/** Parça çerçevesinde ([d, a, b]) silindir; C = cDeg yönünde (θ = −C) eksenden H0 uzaklıkta düzlük.
 *  Yüz: 0 silindir, 1 düzlük, 2 uçlar. Uzun (L boyunda) üçgenler: eski nokta örneklemesinde boşluk bırakıyordu. */
function flatCylinder(cDeg, nSeg = 72) {
  const thF = -cDeg * DEG, half = Math.acos(H0 / RC);
  const ang = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const prof = [];   // {a,b,face} — kenar (k→k+1) yüzü
  for (let k = 0; k < nSeg; k++) {
    const th = k * 2 * Math.PI / nSeg;
    if (Math.abs(ang(th - thF)) < half) continue;
    prof.push({ th });
  }
  prof.push({ th: thF - half, f0: true }, { th: thF + half, f1: true });
  prof.sort((p, q) => ang(p.th - thF + Math.PI) - ang(q.th - thF + Math.PI));
  // sıralı: thF−π'den başlayıp dolaşır; f0 → f1 arası düzlük
  const pos = [], idx = [], faceOf = [];
  const P = prof.map(p => [Math.cos(p.th) * RC, Math.sin(p.th) * RC, p]);
  const n = P.length;
  for (const z of [0, L]) for (const q of P) pos.push(z, q[0], q[1]);
  pos.push(0, 0, 0, L, 0, 0);
  const c0 = 2 * n, c1 = 2 * n + 1;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n, face = P[k][2].f0 && P[j][2].f1 ? 1 : 0;
    idx.push(k, j, n + j, k, n + j, n + k); faceOf.push(face, face);
    idx.push(c0, j, k, c1, n + k, n + j); faceOf.push(2, 2);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), faceOf };
}

function run(cDeg, opts = {}) {
  const mesh = flatCylinder(cDeg);
  const moves = [];
  const prog = { comment() {}, rapid(t) { moves.push({ ...t, g: 0 }); }, line(t, F) { moves.push({ ...t, g: 1, F }); } };
  const op = { name: 'SM', params: { faceIds: [1], strategy: opts.strategy || 'parallelZ', ap: 2, stockLeave: 0, y: opts.y || 0 } };
  const ctx = { part: { mesh, fixture: {} }, project: { ops: [op] }, barR: RC, rAt: () => RC };
  const H = { toPart: (fx, q) => q, startLive() {}, endLive() {}, liveData: () => ({ feed: 100 }) };
  genSimMill(prog, ctx, op, { type: 'endmill', dia: 3 }, H);
  return { mesh, moves };
}

/** Bağımsız kontrol: yoğun örneklenmiş gerçek yüzey disk altında X/2'nin üstüne çıkmamalı */
function overcut(mesh, moves, Y, R) {
  const cl = surfaceCloud(mesh, (q) => q, [], 0.05, 3e6);
  let worst = 0;
  for (const m of moves) {
    if (m.g !== 1) continue;
    const phi = -m.C * DEG, cp = Math.cos(phi), sp = Math.sin(phi);
    for (let i = 0; i < cl.n; i++) {
      const dz = cl.d[i] - m.Z; if (Math.abs(dz) > R) continue;
      const s = -cl.a[i] * sp + cl.b[i] * cp - Y; if (s * s + dz * dz > R * R * 0.98) continue;
      const u = cl.a[i] * cp + cl.b[i] * sp;
      worst = Math.max(worst, u - m.X / 2);
    }
  }
  return worst;
}

describe('Simültane frezeleme: asimetrik düzlük', () => {
  it('sarmal bitiş turunu tek 360 derece blok yerine örnekler', () => {
    const [path] = strategyPaths({ za: 0, zb: 5, ca: 0, cb: 360 }, { full: true, rmax: 5 }, 'spiral', 2);
    expect(path.at(-1).z).toBe(5);
    expect(path.at(-1).c).toBeCloseTo(1260);
    expect(Math.max(...path.slice(1).map((p, i) => p.c - path[i].c))).toBeLessThan(3);
  });
  it('yükseklik haritasında boşluk yok (uzun üçgenler)', () => {
    const mesh = flatCylinder(60);
    const T = surfaceTris(mesh, (q) => q, [1]);
    // dropAt iç kovaya erişim için genSimMill dışından: küçük kova kurulumu genSimMill içinde; burada tam döngü
    const { moves } = run(60);
    for (const m of moves) if (m.X != null && !Number.isFinite(m.X)) throw new Error(JSON.stringify(m));
    expect(T.n).toBeGreaterThan(0);
  });

  for (const [cDeg, y] of [[60, 0], [60, 0.8], [0, 0], [200, -0.5]]) {
    it(`düzlük C${cDeg}, Y${y}: doğru açıda keser, fazla kesim yok`, () => {
      const { mesh, moves } = run(cDeg, { y });
      const cut = moves.filter(m => m.g === 1);
      expect(cut.length).toBeGreaterThan(10);
      // en derin kesim düzlükte: X/2 ≈ H0 ve C doğru açıda (ayna açıda değil)
      const deep = cut.filter(m => m.X / 2 < H0 + 0.25);
      expect(deep.length).toBeGreaterThan(0);
      for (const m of deep) {
        const dc = ((m.C - cDeg) % 360 + 540) % 360 - 180;
        expect(Math.abs(dc)).toBeLessThan(40);
      }
      // mutlak C makul aralıkta (bölge c0 ∈ [−180,180))
      for (const m of moves) if (m.C != null) expect(Math.abs(m.C)).toBeLessThan(400);
      expect(overcut(mesh, moves, y, 1.5)).toBeLessThan(0.01);
    }, 60000);
  }

  it('0°/360° geçen bölge sürekli (C sıçraması yok)', () => {
    const mesh = flatCylinder(0);
    const reg = selRegion(surfaceCloud(mesh, (q) => q, [1]));
    expect(reg.full).toBe(false);
    expect(reg.c0).toBeGreaterThanOrEqual(-180);
    expect(reg.c0).toBeLessThan(0);
    expect(reg.c1).toBeGreaterThan(0);
    const { moves } = run(0);
    const cut = moves.filter(m => m.g === 1);
    // bütün kesim C değerleri 0° çevresinde tek parça aralıkta (360 sıçraması yok)
    for (const m of cut) expect(Math.abs(m.C)).toBeLessThan(60);
  });

  it('dropAt silindir şeridinde gerçek yüksekliği verir', () => {
    const mesh = flatCylinder(90);
    const T = surfaceTris(mesh, (q) => q, []);
    // kova olmadan doğrudan: tüm üçgenler tek kovada
    const B = { zmin: -1, zb: 100, nz: 1, nt: 1, start: Uint32Array.from([0, T.n]), idx: Uint32Array.from({ length: T.n }, (_, i) => i), stamp: new Uint32Array(T.n), q: 0 };
    for (const c of [-90, 0, 17, 200, 271]) {
      const r = dropAt(T, B, c, 0, 10, 1);
      expect(r.h).toBeGreaterThan(RC * Math.cos(2.5 * DEG) - 1e-6);   // kiriş sehimi
      expect(r.h).toBeLessThanOrEqual(RC + 1e-6);
    }
    const r = dropAt(T, B, 90, 0, 10, 1);   // düzlük
    expect(r.h).toBeCloseTo(H0, 3);
  });
});
