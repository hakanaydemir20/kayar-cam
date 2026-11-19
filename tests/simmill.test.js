// Simültane 4 eksen frezeleme: STEP altıgen pimde düzlükler seçilen yüzeylerle (çokgen işlemi yerine) işlenir.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { createRequire } from 'module';
import { readStep } from '../src/cad/stepImport.js';
import { partFromModel } from '../src/cad/featureRecog.js';
import { newProject, runPipeline } from '../src/project.js';
import { makeOp } from '../src/ops/program.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { suggestBar } from '../src/part/part.js';

const require = createRequire(import.meta.url);
let occt, model;
beforeAll(async () => {
  occt = await require('occt-import-js')();
  model = readStep(occt, new Uint8Array(fs.readFileSync('tests/fixtures/altigen_pim.step')));
}, 60000);

/** Eksene paralel düzlem yüzler (altıgenin kenarları) */
function flatFaces(part) {
  const m = part.mesh, A = part.fixture.A, N = m.normals, I = m.indices, info = {};
  for (let t = 0; t < I.length / 3; t++) {
    const f = m.faceOf[t], k = I[3 * t] * 3, n = [N[k], N[k + 1], N[k + 2]];
    const d = info[f] ||= { a: 0, v: 0, n0: n };
    d.a = Math.max(d.a, Math.abs(n[0] * A[0] + n[1] * A[1] + n[2] * A[2]));
    d.v = Math.max(d.v, Math.hypot(n[0] - d.n0[0], n[1] - d.n0[1], n[2] - d.n0[2]));
  }
  return Object.entries(info).filter(([, d]) => d.a < 0.1 && d.v < 0.02).map(([f]) => +f);
}

for (const strategy of ['parallelZ', 'circC', 'spiral', 'contour']) {
  describe('Simültane frezeleme: ' + strategy, () => {
    it('hatasız, çarpışmasız, fazla kesimsiz; X-Y-Z-C kodu', () => {
      const { part } = partFromModel(model);
      part.mesh = model;
      const p = newProject(part);
      p.stock.barDia = suggestBar(part.maxDia) || 20;
      const faces = flatFaces(part);
      expect(faces.length).toBe(6);
      for (const o of p.ops) if (o.type === 'polygonMill') o.enabled = false;
      const em = p.tools.find(t => t.type === 'endmill' && t.unit === 'cross');
      const op = makeOp('simMill', em.id, { faceIds: faces, strategy, ap: 1, stockLeave: 0.02 });
      const ci = p.ops.findIndex(o => o.type === 'cutoff');
      p.ops.splice(ci, 0, op);
      const t0 = performance.now();
      const r = runPipeline(p);
      const ms = performance.now() - t0;
      if (r.errors.length) console.log(strategy, r.errors);
      expect(r.errors).toEqual([]);
      const txt = r.posted.text;
      expect(txt).toMatch(/SIMULTANE 4 EKSEN/);
      // simültane kesme satırı: aynı blokta X ile C (ya da Z ile C) — G0 değil
      expect(txt.split('\n').some(l => !/^G0|\(/.test(l) && /[XZ]-?[\d.]+.*C-?[\d.]+/.test(l))).toBe(true);
      const ss = new StockSim(p, r.sim).runAll();
      if (ss.collisions.length) console.log(strategy, ss.collisions.slice(0, 3));
      expect(ss.collisions).toEqual([]);
      const c = compare(ss.stock, buildTarget(p, ss.opts), p.part.length);
      // anahtar ağzı: altıgen ortasında (Z16) flat yönünde yarıçap ≈ AA/2 + üst ölçü
      const S = ss.stock, i = S.idx(16);
      let rmin = Infinity; for (let j = 0; j < S.nth; j++) rmin = Math.min(rmin, S.r[i * S.nth + j]);
      console.log(strategy, { ms: Math.round(ms), lines: txt.split('\n').length, over: c.over, overMax: c.overMax, underMax: c.underMax, rmin, time: Math.round(r.sim.paths[0].moves.at(-1).t1) });
      expect(c.over).toBe(0);
      // kontur yalnız yüzey kenarını izler (orta boşaltılmaz); diğerleri düzlüğü üst ölçüye indirir
      // (radyal eksenli düz uç, düzlük ortası dışında eğik keser → küçük tarak izi, < 0.06)
      if (strategy !== 'contour') {
        expect(rmin).toBeGreaterThan(5 + 0.02 - 0.03);
        expect(rmin).toBeLessThan(5 + 0.02 + 0.06);
      }
    }, 240000);
  });
}
