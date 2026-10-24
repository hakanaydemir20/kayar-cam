// Sabit çevrim seçeneği: G83 gagalamalı delme, G84 rijit kılavuz (M29), G76 diş. Simülasyon post'un yazdığını açar.
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline, autoOperations } from '../src/project.js';
import { makePart, profileFromTable } from '../src/part/part.js';
import { makeOp } from '../src/ops/program.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { interpret } from '../src/sim/interpreter.js';
import postDef from '../src/post/postProfile.json';
import machineDef from '../src/machine/sb20r-g.json';
import { defaultTools } from '../src/tools/toolLibrary.js';

function full(p) {
  const r = runPipeline(p);
  const ss = new StockSim(p, r.sim).runAll();
  const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
  return { r, ss, c };
}

describe('G83 + G76 açık: örnek parça', () => {
  const p = newProject();
  p.post.cycles = { drill: true, rigidTap: false, thread: 'g76' };
  const { r, ss, c } = full(p);
  const t1 = r.posted.paths[0].join('\n');
  it('hatasız, çarpışmasız, Verify tam', () => {
    if (r.errors.length) console.log(r.errors);
    expect(r.errors).toEqual([]);
    expect(ss.collisions).toEqual([]);
    expect(c.over).toBe(0);
    expect(c.underMax).toBeLessThan(0.05);
    expect(c.innerOver).toBe(0);
    expect(c.innerUnder).toBe(0);
  });
  it('G83 Z R Q(µm, noktasız) F ve G80', () => {
    expect(t1).toMatch(/^G83 Z7\.202 R0\. Q6000 F0\.06$/m);
    expect(t1).toMatch(/G83[^\n]*\nG80/);
  });
  it('G76 iki blok: P(m)(r)(a) Q R  /  X Z R0 P(k µm) Q(Δd µm) F', () => {
    expect(t1).toMatch(/^G76 P020060 Q50 R0\.05$/m);
    expect(t1).toMatch(/^G76 X8\.774 Z18\. R0\. P613 Q150 F1\.$/m);
  });
  it('G76 açılımı: son pasolar diş dibinde, derinlikler artan', () => {
    const l = r.sim.paths[0];
    const li = l.lines.findIndex(x => /^G76 X/.test(x.src));
    const th = l.moves.filter(m => m.line === li && m.kind === 'thread');
    const xs = th.map(m => m.from.X);
    expect(Math.min(...xs)).toBeCloseTo(8.774, 3);
    expect(xs.filter(x => Math.abs(x - 8.774) < 1e-6).length).toBe(2);   // m = 2 finiş
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] + 1e-9);
  });
});

describe('G84 rijit kılavuz (M29)', () => {
  const rows = [{ dia: 10, len: 20, ch: 0.5 }];
  const part = makePart({ name: 'Kılavuz', profile: profileFromTable(rows), rows, features: [{ id: 'h', type: 'axialHole', side: 'front', dia: 4.2, depth: 10 }] });
  const p = newProject(part);
  p.tools.find(t => t.num === 22).dia = 4.2;
  p.ops = autoOperations(p);
  p.ops.splice(p.ops.findIndex(o => o.type === 'drill') + 1, 0, makeOp('tap', p.tools.find(t => t.num === 24).id, { featureId: 'h' }));
  p.post.cycles = { drill: true, rigidTap: true, thread: 'g92' };
  const { r, ss, c } = full(p);
  const t1 = r.posted.paths[0].join('\n');
  it('hatasız, çarpışmasız, diş dibi deliği doğru', () => {
    if (r.errors.length) console.log(r.errors);
    expect(r.errors).toEqual([]);
    expect(ss.collisions).toEqual([]);
    expect(c.innerOver).toBe(0);
  });
  it('M29 S1=… + G84 Z R F(hatve) + G80; kılavuzda M3 yok', () => {
    expect(t1).toMatch(/^M29 S1=\d+$/m);
    expect(t1).toMatch(/^G84 Z8\.4 R0\. F0\.8\nG80$/m);
    const i = r.posted.paths[0].findIndex(s => /^T2424/.test(s)), j = r.posted.paths[0].findIndex(s => /^G84/.test(s));
    expect(r.posted.paths[0].slice(i, j).some(s => /\bM3\b/.test(s))).toBe(false);
  });
});

describe('yorumlayıcı: çevrim açılımı', () => {
  const tools = defaultTools();
  const run = (body) => interpret(`$1\nG99\nT2222\nG97 S1=1000 M3\nG0 X0. Z-1.\n${body}\nM30\n`, { profile: postDef, machine: machineDef, tools });
  it('G83: her gagada R noktasına dönüş, sonraki gagada R−boşluk noktasına hızlı iniş', () => {
    const s = run('G83 Z5. R0. Q2000 F0.05\nG80');
    expect(s.errors).toEqual([]);
    const li = s.paths[0].lines.findIndex(x => /^G83/.test(x.src));
    const m = s.paths[0].moves.filter(x => x.line === li && (x.kind === 'feed' || x.kind === 'rapid'));
    const feeds = m.filter(x => x.kind === 'feed').map(x => [x.from.Z, x.to.Z]);
    expect(feeds).toEqual([[-1, 1], [0.8, 3], [2.8, 5]]);
    expect(m[m.length - 1].to.Z).toBe(-1);
  });
  it('G84 M29 olmadan hata verir', () => {
    const s = run('G84 Z5. R0. F0.8\nG80');
    expect(s.errors.some(e => /M29/.test(e.msg))).toBe(true);
  });
});
