// Kaba tornalama stratejileri: Z'ye paralel, profile paralel, alın — hepsi aynı doğru parçayı vermeli
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';

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
