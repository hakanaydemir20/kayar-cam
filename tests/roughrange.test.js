// Kaba tornalama Z aralığı (kalan malzeme işlemi) ve erişilemeyen bölgeler
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { makeOp } from '../src/ops/program.js';

describe('kaba Z aralığı', () => {
  it('zMin/zMax verilince pasolar yalnız o aralıkta', () => {
    const P = newProject();
    const op = P.ops.find(o => o.type === 'rough');
    op.params.zMin = 20; op.params.zMax = 30;
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    const moves = r.sim.paths[0].moves.filter(m => m.kind === 'feed' && r.posted.lineInfo[0][m.line]?.opId === op.id);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) { expect(m.to.Z).toBeGreaterThan(19); expect(m.to.Z).toBeLessThan(31); }
  });
  it('boş aralık: işlem kod üretmez, hata yok', () => {
    const P = newProject();
    const op = P.ops.find(o => o.type === 'rough');
    op.params.zMin = 30; op.params.zMax = 10;
    expect(runPipeline(P).errors).toEqual([]);
  });
});

describe('işlem iş mili devri', () => {
  it('G97 sabit devir ve işlem başına G50 sınırı koda yazılır', () => {
    const P = newProject();
    const op = P.ops.find(o => o.type === 'rough');
    op.params.spindleMode = 'rpm'; op.params.rpm = 2500;
    const fin = P.ops.find(o => o.type === 'finish');
    fin.params.maxRpm = 3000;
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    expect(r.posted.text).toMatch(/G97 S1=2500 M3/);
    expect(r.posted.text).toMatch(/G50 S1=3000/);
  });
});

import { buildContext } from '../src/ops/context.js';
import { makeTool } from '../src/tools/toolLibrary.js';
describe('elmas erişim analizi', () => {
  const zones = (P, t) => {
    const ctx = buildContext(P), env = ctx.envelopeFor(t), real = ctx.real; let area = 0;
    for (let i = 0; i < real.n; i++) { const z = real.zAt(i); if (z >= 0 && z <= ctx.L) area += Math.max(0, env.r[i] - real.r[i]) * 0.001; }
    return area;
  };
  it('dar uç (V 35°) geniş uçtan (C 80°) daha az malzeme bırakır; boyun bölgesinde kalan var', () => {
    const P = newProject();
    const v = makeTool({ type: 'turn', insertShape: 'V' }), c = makeTool({ type: 'turn', insertShape: 'C' });
    const aV = zones(P, v), aC = zones(P, c);
    expect(aC).toBeGreaterThan(aV);
    expect(aV).toBeGreaterThan(0);
  });
});
