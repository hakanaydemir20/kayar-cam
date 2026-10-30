// G-koddan parça çıkarma: örnek pimin CAM kodu simüle edilip parça geri elde edilir
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim } from '../src/sim/stockSim.js';
import { derivePart } from '../src/sim/derivePart.js';
import { profileR } from '../src/sim/stockSim.js';

describe('G-koddan parça', () => {
  it('örnek pim: boy, çaplar ve ön delik geri bulunur', () => {
    const P = newProject();
    const r = runPipeline(P);
    const ss = new StockSim(P, r.sim).runAll();
    const d = derivePart(ss.stock, P.stock.barDia / 2);
    expect(d.part).toBeTruthy();
    expect(d.L).toBeCloseTo(P.part.length, 0);
    for (const z of [4, 21.5, 30]) expect(profileR(d.part.profile, z)).toBeCloseTo(profileR(P.part.profile, z), 1);
    // M10×1 dişli bölge (Z8–18): diş dibi ile anma çapı arasında
    const rt = profileR(d.part.profile, 14);
    expect(rt).toBeGreaterThan(4.3); expect(rt).toBeLessThanOrEqual(5.001);
    const h = d.part.features.find(f => f.type === 'axialHole' && f.side === 'front');
    expect(h?.dia).toBeCloseTo(4, 1);
  });
  it('malzemeye dokunmayan kod: parça yok', () => {
    const P = newProject(); P.ops = [];
    const r = runPipeline(P);
    const ss = new StockSim(P, r.sim).runAll();
    expect(derivePart(ss.stock, P.stock.barDia / 2).part).toBeNull();
  });
});

import { buildTarget, compare } from '../src/sim/stockSim.js';
describe('G-koddan parça doğrulaması', () => {
  it('dönel parça: çıkarılan parça, kodun ürettiği stokla karşılaştırılınca fazla kesim yok', () => {
    const P = newProject();
    P.part.features = P.part.features.filter(f => f.type === 'axialHole');   // düzlük / çapraz delik dönel değil
    P.ops = P.ops.filter(o => !['flatMill', 'crossDrill', 'thread'].includes(o.type));
    const r = runPipeline(P);
    const ss = new StockSim(P, r.sim).runAll();
    const d = derivePart(ss.stock, P.stock.barDia / 2);
    const P2 = { ...P, part: { ...d.part } };
    const T = buildTarget(P2, ss.opts);
    const c = compare(ss.resultStock(), T, d.part.length);
    expect(c.over).toBeLessThan(c.cells * 0.002);
  });
});
