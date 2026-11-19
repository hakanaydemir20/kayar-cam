// Kaba tornalama stratejileri: Z'ye paralel, profile paralel, alın — hepsi aynı doğru parçayı vermeli
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { featurePlan } from '../src/ops/featurePlan.js';
import { makeOp } from '../src/ops/program.js';
import { makePart, profileFromTable } from '../src/part/part.js';

describe('kaba otomatik ön boydan delme', () => {
  function project() {
    const rows = [{ dia: 12, len: 28 }];
    const hole = { id: 'bore', type: 'axialHole', side: 'front', dia: 6, depth: 28, through: true };
    const p = newProject(makePart({ name: 'Sentetik burç', rows, profile: profileFromTable(rows), features: [hole] }));
    const [short, full] = p.tools.filter(t => t.type === 'drill' && t.unit === 'front');
    Object.assign(short, { dia: 6, tipAngle: 90 });
    Object.assign(full, { dia: 6, tipAngle: 140 });
    p.ops.find(op => op.type === 'drill').toolId = short.id;
    return { p, hole, short, full };
  }

  it('erişen takılı matkabı kullanır ve deliği bölmez', () => {
    const { p, hole, full } = project();
    const steps = featurePlan(p).steps.filter(s => s.featureId === hole.id && s.type !== 'center');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: 'drill', side: 'front', tool: full });
    expect(steps[0].preset).toBeUndefined();
    expect(steps[0].params).toBeUndefined();

    p.ops[p.ops.findIndex(op => op.type === 'drill')] = makeOp('drill', steps[0].tool.id, { featureId: hole.id });
    const r = runPipeline(p);
    expect(r.errors).toEqual([]);
    const ss = new StockSim(p, r.sim).runAll();
    expect(ss.collisions).toEqual([]);
    const stock = ss.resultStock();
    for (const z of [1, 14, 27.9]) expect(stock.rin[stock.idx(z)]).toBeCloseTo(3, 3);
  });

  it('erişen kullanıcı seçimini korur', () => {
    const { p, full } = project();
    const preferred = { ...full, id: 'preferred' };
    p.tools.push(preferred);
    p.ops.find(op => op.type === 'drill').toolId = preferred.id;
    expect(featurePlan(p).steps.find(s => s.type === 'drill')?.tool).toBe(preferred);
  });

  it('ön erişim yetersizse bölünmüş delme planını korur', () => {
    const { p, hole, short, full } = project();
    p.tools = p.tools.filter(t => t.id !== full.id);
    const steps = featurePlan(p).steps.filter(s => s.featureId === hole.id && s.type !== 'center');
    expect(steps.map(s => s.type)).toEqual(['drill', 'backDrill']);
    expect(steps[0].tool).toBe(short);
    expect(steps[0].params.through).toBe(false);
  });
});

for (const strategy of ['profile', 'face']) {
  describe('kaba strateji: ' + strategy, () => {
    const p = newProject();
    for (const op of p.ops.filter(o => o.type === 'rough')) op.params.strategy = strategy;
    const r = runPipeline(p);
    const ss = new StockSim(p, r.sim).runAll();
    const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
    it('hatasız, çarpışmasız, Verify tam', () => {
      if (r.errors.length) console.log(r.errors);
      expect(r.errors).toEqual([]);
      if (ss.collisions.length) console.log(ss.collisions.slice(0, 3));
      expect(ss.collisions).toEqual([]);
      expect(c.over).toBe(0);
      expect(c.underMax).toBeLessThan(0.05);
    });
    it('kaba kesme hareketleri üretildi', () => {
      // kaba işlem sonrası finiş öncesi: her G1 kaba hareketi en fazla ap + pay kadar malzeme kaldırır
      const op = p.ops.find(o => o.type === 'rough');
      const ot = r.sim.paths[0].moves.filter(m => r.posted.lineInfo[0][m.line]?.opId === op.id && (m.kind === 'feed'));
      expect(ot.length).toBeGreaterThan(5);
      console.log(strategy, 'kaba hareket', ot.length, 'süre', (ot.reduce((s, m) => s + m.dur, 0)).toFixed(2), 's');
    });
  });
}
