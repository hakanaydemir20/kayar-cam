// Kılavuz burç segmentasyonu ve uzun parça (Z1 stroku 205 mm'den uzun) için ara bağlama
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { makePart, profileFromTable } from '../src/part/part.js';
import { makeOp } from '../src/ops/program.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';

const tool = (p, n) => p.tools.find(t => t.num === n);

describe('segmentasyon', () => {
  const p = newProject();
  p.stock.segment = 12;
  const r = runPipeline(p);
  const ss = new StockSim(p, r.sim).runAll();
  const c = compare(ss.stock, buildTarget(p, ss.opts), p.part.length);
  it('hatasız, çarpışmasız, Verify tam', () => {
    if (r.errors.length) console.log(r.errors);
    expect(r.errors).toEqual([]);
    expect(ss.collisions).toEqual([]);
    expect(c.over).toBe(0);
    expect(c.underMax).toBeLessThan(0.05);
  });
  it('kaba/ince segment segment ve kanal kendi segmentinden hemen sonra', () => {
    const l = r.posted.paths[0];
    const segs = l.map((s, i) => [s, i]).filter(([s]) => /^\(SEGMENT/.test(s));
    expect(segs.length).toBe(2 * 3 + 0);                       // 35+1=36 mm → 3 segment × (kaba + ince)
    const iGroove = l.findIndex(s => /^\(KANAL/.test(s));
    const iSeg3 = segs.filter(([s]) => /SEGMENT 3/.test(s))[0][1];
    expect(iGroove).toBeLessThan(iSeg3);                        // kanal Z20–23 → 2. segmentten sonra, 3.'den önce
  });
});

describe('uzun parça: ara bağlama (260 mm > Z1 205 mm)', () => {
  const rows = [{ dia: 8, len: 260, ch: 0.5 }];
  const part = makePart({ name: 'Uzun Mil', profile: profileFromTable(rows), rows, features: [] });
  it('ara bağlama olmadan açıklayıcı hata verir', () => {
    const p = newProject(part);
    const r = runPipeline(p);
    expect(r.errors.some(e => /Ara Bağlama/.test(e.msg))).toBe(true);
  });
  const p = newProject(part);
  p.stock.segment = 50;
  p.ops.splice(p.ops.findIndex(o => o.type === 'cutoff'), 0, makeOp('midRechuck', null, { atZ: 150, shift: 120 }));
  const r = runPipeline(p);
  const ss = new StockSim(p, r.sim).runAll();
  const c = compare(ss.stock, buildTarget(p, ss.opts), p.part.length);
  it('hatasız ve çarpışmasız', () => {
    if (r.errors.length) console.log(r.errors.slice(0, 5));
    expect(r.errors).toEqual([]);
    if (ss.collisions.length) console.log(ss.collisions.slice(0, 5));
    expect(ss.collisions).toEqual([]);
  });
  it('iş kaydırması G10 P0 Z-120. ve sonunda sıfırlanır; bekleme kodları sırayla', () => {
    const t1 = r.posted.paths[0].join('\n'), t2 = r.posted.paths[1].join('\n');
    expect(t1).toMatch(/G10 P0 Z-120\./);
    expect((t1.match(/G10 P0 Z0\./g) || []).length).toBe(2);   // başta temizleme + çubuk ilerletmede
    expect(t1.indexOf('M201')).toBeLessThan(t1.indexOf('G10 P0 Z-120.'));
    expect(t2).toMatch(/M201[\s\S]*M202[\s\S]*M203/);       // ara bağlama 1–3 (arka işlem yok → parça alma yok)
    expect(t2).not.toMatch(/M204/);
  });
  it('makine Z1 her zaman strok içinde, ara bağlamadan sonra parça koordinatı korunur', () => {
    const mv = r.sim.paths[0].moves.filter(m => m.kind !== 'event');
    for (const m of mv) expect(m.mTo.Z).toBeLessThanOrEqual(205 + 1e-6);
    const last = mv.filter(m => m.state.extZ === -120 && m.kind === 'feed');
    expect(Math.max(...last.map(m => m.to.Z))).toBeGreaterThan(200);   // parça koordinatında 200+ işlendi
  });
  it('Verify: tüm boy doğru işlendi (fazla kesim yok, kalan yok)', () => {
    console.log('uzun verify', { over: c.over, under: c.under, underMax: c.underMax, cells: c.cells });
    expect(c.over).toBe(0);
    expect(c.underMax).toBeLessThan(0.05);
  });
});
