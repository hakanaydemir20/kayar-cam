// Örtüşen çevrim (ESPRIT tarzı): arka işlemler önceki parçada, ön işlemlerle aynı anda
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { makeOp } from '../src/ops/program.js';

function full(p) {
  const r = runPipeline(p);
  const ss = new StockSim(p, r.sim).runAll();
  const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
  return { r, ss, c };
}

describe('örtüşen çevrim', () => {
  const base = full(newProject());
  const p = newProject();
  p.sync = { overlap: true };
  const { r, ss, c } = full(p);
  it('hatasız ve çarpışmasız', () => {
    if (r.errors.length) console.log(r.errors);
    expect(r.errors).toEqual([]);
    if (ss.collisions.length) console.log(ss.collisions.slice(0, 5));
    expect(ss.collisions).toEqual([]);
  });
  it('$2: arka işlemler ve atma, parça almadan ÖNCE', () => {
    const l2 = r.posted.paths[1];
    const iBack = l2.findIndex(s => /^\(ARKA DELME/.test(s));
    const iEject = l2.findIndex(s => /^\(PARCA ATMA/.test(s));
    const iPick = l2.findIndex(s => /^\(KARSI IS MILINE AL/.test(s));
    expect(iBack).toBeGreaterThan(0);
    expect(iBack).toBeLessThan(iEject);
    expect(iEject).toBeLessThan(iPick);
  });
  it('çevrim süresi kısalır (arka işlemler paralel)', () => {
    const T0 = Math.max(...base.r.sim.paths.map(q => q.totalTime));
    const T1 = Math.max(...r.sim.paths.map(q => q.totalTime));
    console.log('çevrim süresi', { sirali: T0.toFixed(2), ortusen: T1.toFixed(2) });
    expect(T1).toBeLessThan(T0 - 1);
  });
  it('Verify: bitmiş parça (önceki parça + bu çevrimin arka işlemleri) tam', () => {
    console.log('örtüşen verify', { over: c.over, under: c.under, underMax: c.underMax, innerOver: c.innerOver, innerUnder: c.innerUnder });
    expect(c.over).toBe(0);
    expect(c.underMax).toBeLessThan(0.05);
    expect(c.innerUnder).toBe(0);
    expect(ss.state.prev).toBe('ejected');
    expect(ss.state.attached).toBe('sub');      // yeni parça alındı, bir sonraki çevrimde arka işlenecek
  });
  it('ara bağlamayla birlikte kullanılamaz', () => {
    const q = newProject();
    q.sync = { overlap: true };
    q.ops.splice(1, 0, makeOp('midRechuck', null, { atZ: 20, shift: 10 }));
    expect(runPipeline(q).errors.some(e => /Örtüşen çevrim ara bağlamayla/.test(e.msg))).toBe(true);
  });
});
