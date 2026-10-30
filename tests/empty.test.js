// İşlem listesi boş proje (yeni parça, plan henüz kurulmadı) hatasız simüle edilir
import { it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim } from '../src/sim/stockSim.js';
it('boş işlem listesi', () => {
  const P = newProject(); P.ops = [];
  const r = runPipeline(P);
  const ss = new StockSim(P, r.sim).runAll();
  expect(r.errors).toEqual([]);
  expect(ss.totalTime).toBeGreaterThanOrEqual(0);
});
