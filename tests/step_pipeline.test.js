import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { createRequire } from 'module';
import { readStep } from '../src/cad/stepImport.js';
import { partFromModel } from '../src/cad/featureRecog.js';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { suggestBar } from '../src/part/part.js';

const require = createRequire(import.meta.url);
let occt;
beforeAll(async () => { occt = await require('occt-import-js')(); }, 60000);

for (const f of ['pim_x_ekseni.step', 'kanalli_mil.step', 'capraz_delikli_burc.step']) {
  describe('STEP → CAM → NC → Verify: ' + f, () => {
    it('hatasız, çarpışmasız, fazla kesimsiz', () => {
      const model = readStep(occt, new Uint8Array(fs.readFileSync('tests/fixtures/' + f)));
      const { part } = partFromModel(model);
      const p = newProject(part);
      p.stock.barDia = suggestBar(part.maxDia) || 20;
      const r = runPipeline(p);
      if (r.errors.length) console.log(f, r.errors);
      expect(r.errors).toEqual([]);
      const ss = new StockSim(p, r.sim).runAll();
      if (ss.collisions.length) console.log(f, ss.collisions);
      expect(ss.collisions).toEqual([]);
      const c = compare(ss.stock, buildTarget(p, ss.opts), p.part.length);
      console.log(f, { over: c.over, overMax: c.overMax, under: c.under, cells: c.cells, underMax: c.underMax, innerOver: c.innerOver, innerUnder: c.innerUnder });
      expect(c.over).toBe(0);
      expect(c.innerOver).toBe(0);
    });
  });
}
