// Bölgesel frezeleme (C/Y): serbest çokgen bölge, katlar, kenar pasosu; simülasyonda bölge kesilir, dışı korunur
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { makeOp } from '../src/ops/program.js';
import { StockSim } from '../src/sim/stockSim.js';

function project(region, extra = {}) {
  const P = newProject();
  const t = P.tools.find(x => x.type === 'endmill' && x.dia === 4);
  const op = makeOp('areaMill', t.id);
  Object.assign(op.params, { c: 0, depth: 1, ap: 0.5, stepover: 0.5, region, ...extra });
  P.ops.splice(P.ops.findIndex(o => o.type === 'cutoff'), 0, op);
  return { P, op };
}
describe('bölgesel frezeleme', () => {
  it('dikdörtgen bölge: hatasız kod, Y–Z hareketleri bölge sınırında, kenar pasosu', () => {
    const { P, op } = project([{ z: 24, y: -3 }, { z: 32, y: -3 }, { z: 32, y: 3 }, { z: 24, y: 3 }]);
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    const mv = r.sim.paths[0].moves.filter(m => m.kind === 'feed' && r.posted.lineInfo[0][m.line]?.opId === op.id);
    expect(mv.length).toBeGreaterThan(10);
    for (const m of mv) { expect(m.to.Z).toBeGreaterThanOrEqual(24 + 2 - 1e-6); expect(m.to.Z).toBeLessThanOrEqual(32 - 2 + 1e-6); expect(Math.abs(m.to.Y)).toBeLessThanOrEqual(3 - 2 + 1e-6); }
    const ss = new StockSim(P, r.sim).runAll();
    expect(ss.collisions).toEqual([]);
    // bölge ortasında (z=28, C0 yönü) malzeme indi, bölge dışında (z=20) çubuk/parça yarıçapı korundu
    const S = ss.stock, j0 = 0, r28 = S.r[S.idx(28) * S.nth + j0];
    expect(r28).toBeLessThan(7 - 0.9);
  });
  it('üçgen (dışbükey) ve L (içbükey) bölge; dar bölge hata verir', () => {
    expect(runPipeline(project([{ z: 24, y: -3 }, { z: 33, y: 0 }, { z: 24, y: 3 }]).P).errors).toEqual([]);
    const L = [{ z: 23, y: -3 }, { z: 33, y: -3 }, { z: 33, y: 0 }, { z: 28, y: 0 }, { z: 28, y: 3 }, { z: 23, y: 3 }];
    expect(runPipeline(project(L).P).errors).toEqual([]);
    expect(runPipeline(project([{ z: 24, y: -1 }, { z: 32, y: -1 }, { z: 32, y: 1 }, { z: 24, y: 1 }]).P).errors.map(e => e.msg).join()).toMatch(/dar/);
  });
});

import { buildTarget, compare } from '../src/sim/stockSim.js';
describe('bölgesel frezeleme doğrulaması', () => {
  it('bölge hedefe dahil: Verify fazla kesim göstermez', () => {
    const { P } = project([{ z: 24, y: -4 }, { z: 32, y: -4 }, { z: 32, y: 4 }, { z: 24, y: 4 }]);
    const r = runPipeline(P);
    const ss = new StockSim(P, r.sim).runAll();
    const c = compare(ss.resultStock(), buildTarget(P, ss.opts), P.part.length);
    expect(c.over).toBe(0);
  });
});
