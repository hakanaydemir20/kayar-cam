import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';

describe('stok simülasyonu (Verify)', () => {
  const p = newProject();
  const r = runPipeline(p);
  const t0 = Date.now();
  const ss = new StockSim(p, r.sim).runAll();
  const ms = Date.now() - t0;
  it('makul sürede çalışır', () => { console.log('sim ms', ms); expect(ms).toBeLessThan(8000); });
  it('G0 çarpışması yok', () => { if (ss.collisions.length) console.log(ss.collisions); expect(ss.collisions).toEqual([]); });
  it('parça kesildi ve karşı iş miline geçti, sonra atıldı', () => {
    expect(ss.state.separated).toBe(true);
    expect(['sub', 'ejected']).toContain(ss.state.attached);
  });
  it('hedefle karşılaştırma: fazla kesim yok', () => {
    const T = buildTarget(p, ss.opts);
    const c = compare(ss.stock, T, p.part.length);
    console.log('verify', { over: c.over, overMax: c.overMax, under: c.under, underMax: c.underMax, cells: c.cells, innerOver: c.innerOver, innerUnder: c.innerUnder });
    expect(c.over).toBe(0);
    expect(c.under / c.cells).toBeLessThan(0.002);
    expect(c.underMax).toBeLessThan(0.05);
  });
});

describe('adım adım oynatma = toplu simülasyon', () => {
  it('küçük zaman adımlarıyla aynı sonucu verir', () => {
    const p = newProject();
    const r = runPipeline(p);
    const a = new StockSim(p, r.sim).runAll();
    const b = new StockSim(p, r.sim);
    for (let t = 0; t <= b.totalTime + 1; t += 0.37) b.seek(t);
    b.seek(b.totalTime + 1);
    // takım ayak izinin tam sınırındaki birkaç hücre kayan nokta yuvarlamasıyla farklı olabilir
    let diff = 0;
    for (let i = 0; i < a.stock.r.length; i++) if (Math.abs(a.stock.r[i] - b.stock.r[i]) > 0.02) diff++;
    expect(diff).toBeLessThanOrEqual(3);
    expect(b.state.attached).toBe(a.state.attached);
    expect(b.collisions.length).toBe(a.collisions.length);
  });
  it('ara zamanda talaş kaldırılmış olur (bekleme hareketleri engellemez)', () => {
    const p = newProject();
    const r = runPipeline(p);
    const b = new StockSim(p, r.sim);
    b.seek(30);
    expect(b.stock.r[b.stock.idx(4) * b.stock.nth]).toBeLessThan(5);
  });
});
