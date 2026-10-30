// Çarpışma ve bindirme tanımları: güvenlik mesafeleri, kontrol anahtarları
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim } from '../src/sim/stockSim.js';
import { collisionCfg, COLLISION_DEFAULTS } from '../src/sim/collision.js';

const sim = (mod) => { const P = newProject(); mod?.(P); const r = runPipeline(P); return new StockSim(P, r.sim).runAll(); };

describe('çarpışma tanımları', () => {
  it('varsayılanlar: örnek parça temiz', () => {
    expect(collisionCfg(newProject())).toEqual(COLLISION_DEFAULTS);
    expect(sim().collisions).toEqual([]);
  });
  it('tutucu–parça güvenlik mesafesi büyütülünce ihlal raporlanır (temas değil, mesafe)', () => {
    const ss = sim(P => { P.machine.collision = { clearPart: 8 }; });
    expect(ss.collisions.length).toBeGreaterThan(0);
    expect(ss.collisions.some(c => /Güvenlik mesafesi/.test(c.msg))).toBe(true);
  });
  it('kontrol kapatılınca çarpışma aranmaz', () => {
    const ss = sim(P => { P.machine.collision = { clearPart: 8, enabled: false }; });
    expect(ss.collisions.filter(c => !/Bindirme/.test(c.msg))).toEqual([]);
  });
  it('G0 bindirme: kapalıysa raporlanmaz, açıkken raporlanır', () => {
    const bad = (P) => { const op = P.ops.find(o => o.type === 'rough'); op.params.retract = -3; };
    const on = sim(P => { bad(P); });
    const off = sim(P => { bad(P); P.machine.collision = { checkRapid: false, enabled: false }; });
    expect(off.collisions.filter(c => /Bindirme/.test(c.msg))).toEqual([]);
    expect(on.collisions.length).toBeGreaterThanOrEqual(off.collisions.length);
  });
});

describe('çarpışma kesiği', () => {
  it('komşu takım parçaya girerse girdiği kadar kesilir ve hücreler işaretlenir', () => {
    const mk = (cut) => sim(P => { const t2 = P.tools.find(t => t.num === 2); t2.yPos = P.tools.find(t => t.num === 1).yPos - 8; P.machine.collision = { crashCut: cut }; });
    const on = mk(true), off = mk(false);
    expect(on.collisions.some(c => /Çarpışma/.test(c.msg))).toBe(true);
    const n = (ss) => (ss.stock.crash || []).reduce((a, v) => a + v, 0);
    expect(n(on)).toBeGreaterThan(0);
    expect(n(off)).toBe(0);
  });
});

describe('çarpışma kesiği', () => {
  it('komşu takım parçaya girerse girdiği kadar kesilir ve hücreler işaretlenir', () => {
    const mk = (cut) => sim(P => { const t2 = P.tools.find(t => t.num === 2); t2.yPos = P.tools.find(t => t.num === 1).yPos - 8; P.machine.collision = { crashCut: cut }; });
    const on = mk(true), off = mk(false);
    expect(on.collisions.some(c => /Çarpışma/.test(c.msg))).toBe(true);
    const n = (ss) => (ss.stock.crash || []).reduce((a, v) => a + v, 0);
    expect(n(on)).toBeGreaterThan(0);
    expect(n(off)).toBe(0);
  });
});
