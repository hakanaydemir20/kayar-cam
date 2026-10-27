// Rastgele parça taraması: otomatik plan → G-kod → simülasyon → Verify. Hata, çarpışma, fazla kesim olmamalı.
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { makePart, profileFromTable } from '../src/part/part.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function randomPart(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const n = 1 + Math.floor(r() * 4);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const dia = pick([5, 6, 8, 10, 12, 14, 16]);
    rows.push({ dia, len: pick([4, 6, 8, 10, 14]), ch: pick([0, 0, 0.3, 0.5]) });
  }
  const part0 = makePart({ name: 'F' + seed, profile: profileFromTable(rows), rows });
  const L = part0.length;
  const feats = [];
  let z = 0;
  const spans = rows.map(row => { const s = { z0: z, z1: z + row.len, dia: row.dia }; z += row.len; return s; });
  const first = spans[0];
  if (r() < 0.5 && first.dia >= 8) feats.push({ id: 'h1', type: 'axialHole', side: 'front', dia: 4, depth: Math.min(6, L - 2) });
  const big = spans.filter(s => s.dia >= 8 && s.z1 - s.z0 >= 6);
  if (big.length && r() < 0.5) { const s = pick(big); feats.push({ id: 'c1', type: 'crossHole', dia: 3, z: (s.z0 + s.z1) / 2, c: pick([0, 90]), through: true }); }
  if (big.length && r() < 0.4) { const s = pick(big); feats.push({ id: 'fl', type: 'flat', c: 180, depth: 1, z0: s.z0 + 1, z1: s.z1 - 1 }); }
  const th = spans.filter(s => [6, 8, 10, 12].includes(s.dia) && s.z1 - s.z0 >= 6 && s.z0 > 0);
  if (th.length && r() < 0.4) {
    // gerçekçi diş: önde/arkada büyük omuz varsa uç genişliği kadar boşluk (yoksa CAM açıklayıcı hata verir — ayrı test)
    // gerçekçi diş: girişte uç boşta (önceki bölge diş dibinden küçük), arkada büyük omuz varsa uç genişliği kadar boşluk
    const s = pick(th), k = spans.indexOf(s), pitch = s.dia >= 10 ? 1.5 : 1;
    const airy = spans[k - 1].dia < s.dia - 2 * 0.6134 * pitch - 0.2;
    const nextBig = k < spans.length - 1 && spans[k + 1].dia > s.dia;
    const z0 = s.z0 + 0.5, z1 = s.z1 - (nextBig ? 4 : 1);
    if (airy && z1 - z0 >= 2) feats.push({ id: 't1', type: 'thread', dia: s.dia, pitch: s.dia >= 10 ? 1.5 : 1, z0, z1 });
  }
  const last = spans[spans.length - 1];
  if (r() < 0.3 && last.dia >= 10) feats.push({ id: 'b1', type: 'axialHole', side: 'back', dia: 4, depth: Math.min(4, L - 2) });
  return makePart({ name: 'F' + seed, profile: profileFromTable(rows), rows, features: feats });
}

describe('rastgele parça taraması', () => {
  const N = +(process.env.FUZZ_N || 30);
  for (let seed = 1; seed <= N; seed++) {
    it('tohum ' + seed, () => {
      const part = randomPart(seed);
      const p = newProject(part);
      const r = runPipeline(p);
      const ss = new StockSim(p, r.sim).runAll();
      const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
      const info = { rows: part.rows, feats: part.features, errors: r.errors.slice(0, 3), coll: ss.collisions.slice(0, 2).map(x => x.msg), over: c.over, underMax: c.underMax, io: c.innerOver, iu: c.innerUnder };
      if (r.errors.length || ss.collisions.length || c.over || c.underMax >= 0.05 || c.innerOver) console.log(JSON.stringify(info));
      expect(r.errors).toEqual([]);
      expect(ss.collisions.length).toBe(0);
      expect(c.over).toBe(0);
      expect(c.innerOver).toBe(0);
      expect(c.underMax).toBeLessThan(0.05);
    });
  }
});

describe('kısa parça: karşı iş milinde tutma', () => {
  for (const L of [4, 6, 10]) {
    it(`L${L}: tutma boyu kısalır, arka delik delinir, çarpışma yok`, () => {
      const rows = [{ dia: 12, len: L, ch: 0.3 }];
      const p = newProject(makePart({ name: 'K', profile: profileFromTable(rows), rows, features: [{ id: 'b', type: 'axialHole', side: 'back', dia: 4, depth: 1 }] }));
      const r = runPipeline(p);
      const ss = new StockSim(p, r.sim).runAll();
      const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
      expect(r.errors).toEqual([]);
      expect(ss.collisions).toEqual([]);
      expect(c.over).toBe(0);
      expect(c.innerUnder).toBe(0);
      const grip = r.sim.frames ? L - r.sim.frames.projection : null;
      expect(grip).toBeLessThanOrEqual(L - 1.5 - 0.5 + 1e-9);
    });
  }
});

describe('diş omuz kontrolü', () => {
  const mk = (rows, th) => { const p = newProject(makePart({ name: 'D', profile: profileFromTable(rows), rows, features: [{ id: 't', type: 'thread', ...th }] })); return runPipeline(p); };
  it('büyük omuzdan hemen sonra başlayan diş: açıklayıcı hata (omza dalmaz)', () => {
    const r = mk([{ dia: 14, len: 10 }, { dia: 8, len: 10 }], { dia: 8, pitch: 1, z0: 10.5, z1: 19 });
    expect(r.errors.some(e => /diş girişi için boş yer yok/.test(e.msg))).toBe(true);
  });
  it('silindirin ortasından başlayan diş (giriş malzemede): açıklayıcı hata', () => {
    const r = mk([{ dia: 8, len: 20, ch: 0.5 }], { dia: 8, pitch: 1, z0: 8, z1: 18 });
    expect(r.errors.some(e => /diş girişi için boş yer yok/.test(e.msg))).toBe(true);
  });
  it('büyük omza dayanan diş sonu: açıklayıcı hata', () => {
    const r = mk([{ dia: 8, len: 10, ch: 0.5 }, { dia: 14, len: 10 }], { dia: 8, pitch: 1, z0: 0, z1: 9.5 });
    expect(r.errors.some(e => /diş sonunda omuz/.test(e.msg))).toBe(true);
  });
  it('omuza yakın ama sığan diş: giriş kısalır, çarpışma/fazla kesim yok', () => {
    const rows = [{ dia: 10, len: 8 }, { dia: 6.5, len: 3 }, { dia: 8, len: 10, ch: 0.5 }];   // boşaltma kanalı Ø6.5 < diş dibi
    const p = newProject(makePart({ name: 'D', profile: profileFromTable(rows), rows, features: [{ id: 't', type: 'thread', dia: 8, pitch: 1, z0: 11, z1: 19 }] }));
    const r = runPipeline(p);
    const ss = new StockSim(p, r.sim).runAll();
    const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
    expect(r.errors).toEqual([]);
    expect(ss.collisions).toEqual([]);
    expect(c.over).toBe(0);
  });
});

/** Karma tarama: frezeleme (çokgen, çap kanalı, cep, yazı), arka alın işlemleri, çevrim seçenekleri, örtüşen çevrim */
function mixedProject(seed) {
  const r = rng(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const d1 = pick([6, 8]), d2 = pick([12, 14, 16]), d3 = pick([10, 12]);
  const rows = [{ dia: d1, len: pick([5, 6, 8]), ch: 0.3 }, { dia: d2, len: pick([12, 14, 16]), ch: 0.5 }, { dia: d3, len: pick([8, 10]), ch: 0.3 }];
  const z1 = rows[0].len, z2 = z1 + rows[1].len, L = z2 + rows[2].len;
  const feats = [];
  const mid = (z1 + z2) / 2;
  const k = Math.floor(r() * 5);
  if (k === 0) feats.push({ id: 'g', type: 'polygon', n: pick([4, 6]), af: d2 - 3, z0: z1 + 2, z1: z2 - 2, c: 0 });
  if (k === 1) feats.push({ id: 'g', type: 'odSlot', width: 4, depth: 0.6, z0: z1 + 3, c0: 0, z1: z2 - 3, c1: pick([0, 45, 90]) });
  if (k === 2) feats.push({ id: 'g', type: 'pocket', dia: 5, depth: 1, z: mid, c: pick([0, 90]) });
  if (k === 3 && rows[1].len >= 16) feats.push({ id: 'g', type: 'engrave', text: pick(['A1', 'K-7', 'STAR']), height: 8, depth: 0.15, z: mid, c: 10 });
  if (k === 4) feats.push({ id: 'g', type: 'crossHole', dia: 3, z: mid, c: 0, through: false, depthDia: 4 });
  if (r() < 0.5) feats.push({ id: 'b', type: pick(['faceSlot', 'facePolygon']), side: 'back', width: 4, n: 6, af: d3 - 4, depth: 0.8, c: 30 });
  if (r() < 0.4) feats.push({ id: 'h', type: 'axialHole', side: 'front', dia: 4, depth: 5 });
  const part = makePart({ name: 'M' + seed, profile: profileFromTable(rows), rows, features: feats });
  const p = newProject(part);
  p.post.cycles = { drill: r() < 0.5, rigidTap: false, thread: 'g92' };
  if (r() < 0.4) p.sync = { overlap: true };
  if (r() < 0.3) p.stock.segment = pick([10, 15]);
  return { p, info: { rows, feats, cycles: p.post.cycles, sync: p.sync, seg: p.stock.segment } };
}

describe('karma tarama', () => {
  const N = +(process.env.FUZZ_N || 30);
  for (let seed = 1; seed <= N; seed++) {
    it('tohum ' + seed, () => {
      const { p, info } = mixedProject(seed);
      const r = runPipeline(p);
      const ss = new StockSim(p, r.sim).runAll();
      const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
      if (r.errors.length || ss.collisions.length || c.over || c.underMax >= 0.05 || c.innerOver)
        console.log(JSON.stringify({ ...info, errors: r.errors.slice(0, 3), coll: ss.collisions.slice(0, 2).map(x => x.msg), over: c.over, underMax: c.underMax, io: c.innerOver, iu: c.innerUnder }));
      expect(r.errors).toEqual([]);
      expect(ss.collisions.length).toBe(0);
      expect(c.over).toBe(0);
      expect(c.innerOver).toBe(0);
      expect(c.underMax).toBeLessThan(0.05);
    });
  }
});
