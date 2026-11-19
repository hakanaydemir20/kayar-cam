// Simüle edilmiş stoktan ölçüm (manuel G-kod parça incelemesi)
import { describe, it, expect } from 'vitest';
import { Stock, StockSim, profileR } from '../src/sim/stockSim.js';
import { profileElements, probeAt, sectionAt, volumes, partRange } from '../src/sim/inspect.js';
import { newProject, runPipeline } from '../src/project.js';

/** Sentetik stok: Ø10 çubuktan Z0–5 Ø6, Z5–6 pah Ø6→Ø8, Z6–12 Ø8, Z12'de kesik; Z2'de 90°'lik düzlük */
function synth() {
  const S = new Stock({ dMin: -1, dMax: 20, dz: 0.05, nth: 120, R: 5 });
  for (let i = 0; i < S.nz; i++) {
    const d = S.dAt(i);
    let r = d < -1e-9 ? 0 : d < 5 - 1e-9 ? 3 : d < 6 - 1e-9 ? 3 + (d - 5) : d < 12 - 1e-9 ? 4 : 0;
    for (let j = 0; j < S.nth; j++) S.r[i * S.nth + j] = r;
    if (Math.abs(d - 2) < 0.3) for (let j = 0; j < 10; j++) S.r[i * S.nth + j] = 2.5;   // düzlük
    S.recomputeRow(i);
  }
  return S;
}

describe('parça ölçümü', () => {
  it('silindir, pah ve kesik boyu ızgara çözünürlüğünde bulunur', () => {
    const S = synth();
    const { elements, range } = profileElements(S, 5);
    expect(range.cut).toBe(true);
    expect(range.end - range.front).toBeCloseTo(12, 1);
    const cyl = elements.filter(e => e.kind === 'cyl');
    expect(cyl.map(e => e.d0)).toEqual([6, 8]);
    expect(cyl[0].len).toBeCloseTo(5, 1);
    expect(cyl[1].len).toBeCloseTo(6, 1);
    const ch = elements.find(e => e.kind === 'taper');
    expect(ch.angle).toBeCloseTo(45, 0);
    expect(cyl[0].nonRound).toBe(true);     // düzlük dönmeyen işlem olarak işaretli
  });
  it('Z noktasında Ø ve yuvarlaklık; kesitte düzlük görünür', () => {
    const S = synth();
    const p = probeAt(S, 5, 2);
    expect(p.dMax).toBeCloseTo(6, 3); expect(p.dMin).toBeCloseTo(5, 3); expect(p.roundness).toBeCloseTo(0.5, 3);
    expect(probeAt(S, 5, 8).dMax).toBeCloseTo(8, 3);
    const s = sectionAt(S, 5, 2);
    expect(s.pts.filter(q => q.r < 2.9).length).toBe(10);
  });
  it('hacimler: parça + kaldırılan = çubuk silindiri', () => {
    const S = synth(), v = volumes(S, 5), rg = partRange(S, 5);
    const L = (rg.iEnd - rg.i0 + 1) * S.dz;
    expect(v.part + v.removed).toBeCloseTo(Math.PI * 25 * L, 0);
  });
  it('gerçek boru hattı: örnek pimde ölçülen çaplar tasarımla uyuşur', () => {
    const P = newProject();
    const r = runPipeline(P);
    const ss = new StockSim(P, r.sim).runAll();
    const R = P.stock.barDia / 2;
    for (const z of [4, 30]) expect(probeAt(ss.stock, R, z).dMax).toBeCloseTo(2 * profileR(P.part.profile, z), 1);
    expect(probeAt(ss.stock, R, 1).dIn).toBeCloseTo(4, 1);
  });
});
