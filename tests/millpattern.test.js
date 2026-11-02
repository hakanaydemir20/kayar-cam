// Frezeleme desenleri (zikzak Z/Y, tek yön Z/Y, spiral): her desen hatasız, çarpışmasız; düzlük ve bölge tam işlenir, fazla kesim yok
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { makeOp } from '../src/ops/program.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { MILL_PATTERNS } from '../src/ops/generators.js';

const PATS = Object.keys(MILL_PATTERNS);
const check = (P, op, zr) => {
  const r = runPipeline(P);
  expect(r.errors).toEqual([]);
  const ss = new StockSim(P, r.sim).runAll();
  expect(ss.collisions).toEqual([]);
  const T = buildTarget(P, ss.opts), c = compare(ss.resultStock(), T, P.part.length);
  expect(c.over).toBe(0);
  // bölgede kalan malzeme (stok − hedef) ≤ 0.05 mm
  const S = ss.resultStock();
  let left = 0;
  for (let i = S.idx(zr[0]); i <= S.idx(zr[1]); i++) for (let j = 0; j < S.nth; j++) { const k = i * S.nth + j; if (T.r[k] > 0) left = Math.max(left, S.r[k] - T.r[k]); }
  expect(left).toBeLessThan(0.05);
  return r.sim.paths[0].moves.filter(m => r.posted.lineInfo[0][m.line]?.opId === op.id);
};

describe('frezeleme desenleri', () => {
  for (const pat of PATS) {
    it(`düzlük · ${pat}`, () => {
      const P = newProject();
      const op = P.ops.find(o => o.type === 'flatMill');
      op.params.pattern = pat;
      const f = P.part.features.find(x => x.id === op.params.featureId);
      const mv = check(P, op, [f.z0 + 0.3, f.z1 - 0.3]);
      expect(mv.length).toBeGreaterThan(5);
    });
    it(`bölgesel frezeleme · ${pat}`, () => {
      const P = newProject();
      const t = P.tools.find(x => x.type === 'endmill' && x.dia === 4);
      const op = makeOp('areaMill', t.id);
      Object.assign(op.params, { c: 0, depth: 1, ap: 0.5, stepover: 0.5, pattern: pat, contour: true, region: [{ z: 24, y: -4 }, { z: 32, y: -4 }, { z: 32, y: 4 }, { z: 24, y: 4 }] });
      P.ops.splice(P.ops.findIndex(o => o.type === 'cutoff'), 0, op);
      const r = runPipeline(P);
      expect(r.errors).toEqual([]);
      const ss = new StockSim(P, r.sim).runAll();
      expect(ss.collisions).toEqual([]);
      expect(compare(ss.resultStock(), buildTarget(P, ss.opts), P.part.length).over).toBe(0);
      const mv = r.sim.paths[0].moves.filter(m => m.kind === 'feed' && r.posted.lineInfo[0][m.line]?.opId === op.id);
      for (const m of mv) { expect(m.to.Z).toBeGreaterThanOrEqual(24 + 2 - 1e-6); expect(m.to.Z).toBeLessThanOrEqual(32 - 2 + 1e-6); expect(Math.abs(m.to.Y)).toBeLessThanOrEqual(4 - 2 + 1e-6); }
    });
  }
  it('tek yön: bütün kesme pasoları aynı yönde', () => {
    const P = newProject();
    const op = P.ops.find(o => o.type === 'flatMill');
    op.params.pattern = 'onewayZ';
    const r = runPipeline(P);
    const mv = r.sim.paths[0].moves.filter(m => m.kind === 'feed' && r.posted.lineInfo[0][m.line]?.opId === op.id && Math.abs(m.to.Z - m.from.Z) > 0.5 && Math.abs(m.to.Y - m.from.Y) < 1e-6);
    expect(mv.length).toBeGreaterThan(2);
    const sg = new Set(mv.map(m => Math.sign(m.to.Z - m.from.Z)));
    expect(sg.size).toBe(1);
  });
});
