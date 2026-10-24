// C/Y frezeleme (çokgen, G7.1) ve arka işlemler (arka tornalama, C2 kanal, G12.1) uçtan uca
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { makePart, profileFromTable } from '../src/part/part.js';
import { makeOp } from '../src/ops/program.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';

function verify(p) {
  const r = runPipeline(p);
  if (r.errors.length) console.log(r.errors);
  const ss = new StockSim(p, r.sim).runAll();
  const T = buildTarget(p, ss.opts);
  const c = compare(ss.stock, T, p.part.length);
  return { r, ss, c };
}
const tool = (p, num) => p.tools.find(t => t.num === num);

describe('çokgen (C/Y) + silindirik kanal (G7.1) + arka alın kanalı (C2)', () => {
  const rows = [{ dia: 8, len: 6, ch: 0.3 }, { dia: 12, len: 22, ch: 0.5 }, { dia: 14, len: 8, ch: 0.5 }];
  const part = makePart({
    name: 'Freze Testi', profile: profileFromTable(rows), rows,
    features: [
      { id: 'g1', type: 'polygon', n: 6, af: 10, z0: 8, z1: 16, c: 0 },
      { id: 'g2', type: 'odSlot', width: 4, depth: 0.8, z0: 20, c0: 0, z1: 26, c1: 90 },
      { id: 'g3', type: 'faceSlot', side: 'back', width: 4, depth: 1, c: 30 },
    ],
  });
  const p = newProject(part);
  const { r, ss, c } = verify(p);
  const nc = r.posted.text;
  it('otomatik plan işlemleri ekledi', () => {
    const types = p.ops.map(o => o.type);
    expect(types).toContain('polygonMill');
    expect(types).toContain('cylSlot');
    expect(types).toContain('backSlot');
    expect(types).toContain('pickoff');
  });
  it('CAM/post/NC hatası yok', () => expect(r.errors).toEqual([]));
  it('G7.1 aç/kapa ve C2 ekseni kodları var', () => {
    expect(nc).toMatch(/G7\.1 C6\./);
    expect(nc).toMatch(/G7\.1 C0\./);
    expect(nc).toMatch(/M38/);
    expect(nc).toMatch(/M37/);
  });
  it('G7.1 ilerleme süresi yüzey boyuna göre hesaplanır', () => {
    const li = r.sim.paths[0].lines.findIndex(l => /G7\.1 C6\./.test(l.src));
    const mv = r.sim.paths[0].moves.find(m => m.line > li && m.kind === 'feed' && m.to.C !== m.from.C);
    const surf = Math.hypot(mv.to.Z - mv.from.Z, (mv.to.C - mv.from.C) * Math.PI / 180 * 6);
    expect(mv.dur).toBeCloseTo(surf / mv.feed * 60, 6);
  });
  it('çarpışma yok', () => { if (ss.collisions.length) console.log(ss.collisions); expect(ss.collisions).toEqual([]); });
  it('Verify: fazla kesim yok, kalan malzeme az', () => {
    console.log('freze verify', { over: c.over, overMax: c.overMax, under: c.under, underMax: c.underMax, cells: c.cells });
    expect(c.over).toBe(0);
    expect(c.under / c.cells).toBeLessThan(0.002);
    expect(c.underMax).toBeLessThan(0.05);
  });
  it('çokgen kenarları gerçekten kesildi (Z12 kesitinde en küçük yarıçap ≈ AA/2)', () => {
    const S = ss.stock, i = S.idx(12);
    let mn = Infinity;
    for (let j = 0; j < S.nth; j++) mn = Math.min(mn, S.r[i * S.nth + j]);
    expect(mn).toBeGreaterThan(5 - 0.03);
    expect(mn).toBeLessThan(5 + 0.03);
  });
});

describe('arka tornalama (alın payı + geriye bakan omuz) ve G12.1 arka alın çokgeni', () => {
  // Ø12 gövde, arkada Ø8 boyun: Z20'deki omuz arkaya bakar (ön takım ulaşamaz) → arka tornalama
  const rows = [{ dia: 8, len: 6, ch: 0.3 }, { dia: 12, len: 14, ch: 0.5 }, { dia: 8, len: 10 }];
  const part = makePart({
    name: 'Arka Test', profile: profileFromTable(rows), rows,
    features: [{ id: 'h1', type: 'facePolygon', side: 'back', n: 6, af: 6, depth: 2, c: 0 }],
  });
  const p = newProject(part);
  // ön tarafta kanal işlemi yerine arka tornalama kullan
  p.ops = p.ops.filter(o => o.type !== 'groove');
  const cut = p.ops.find(o => o.type === 'cutoff');
  cut.params.backStock = 0.3;
  const iPick = p.ops.findIndex(o => o.type === 'backPolar');
  p.ops.splice(iPick, 0, makeOp('backTurn', tool(p, 42).id));
  const { r, ss, c } = verify(p);
  const nc = r.posted.text;
  it('CAM/post/NC hatası yok', () => expect(r.errors).toEqual([]));
  it('kesme arka alın payıyla yapılır (Z = L + 0.3)', () => {
    expect(r.posted.paths[0].join('\n')).toMatch(/Y0\. Z30\.3$/m);
  });
  it('G12.1 / G13.1 polar interpolasyon var, polar satırlarında gerçek eksen dönüşümü yapılır', () => {
    expect(nc).toMatch(/G12\.1/);
    expect(nc).toMatch(/G13\.1/);
    const l2 = r.sim.paths[1];
    const i = l2.lines.findIndex(l => /G12\.1/.test(l.src));
    const j = l2.lines.findIndex((l, k) => k > i && /G13\.1/.test(l.src));
    const pm = l2.moves.filter(m => m.line > i && m.line < j && m.kind === 'feed' && Math.abs(m.to.C - m.from.C) > 1e-6);
    expect(pm.length).toBeGreaterThan(20);
    // C ekseni sürekli (atlama yok)
    for (const m of pm) expect(Math.abs(m.to.C - m.from.C)).toBeLessThan(30);
  });
  it('çarpışma yok', () => { if (ss.collisions.length) console.log(ss.collisions); expect(ss.collisions).toEqual([]); });
  it('Verify: omuz arkadan tornalandı, çokgen doğru, fazla kesim yok', () => {
    console.log('arka verify', { over: c.over, overMax: c.overMax, under: c.under, underMax: c.underMax, cells: c.cells });
    expect(c.over).toBe(0);
    expect(c.under / c.cells).toBeLessThan(0.002);
    expect(c.underMax).toBeLessThan(0.05);
    // omuz arkası (Z24, Ø8) arkadan tornalanmış olmalı
    const S = ss.stock, i = S.idx(24);
    let mx = 0;
    for (let j = 0; j < S.nth; j++) mx = Math.max(mx, S.r[i * S.nth + j]);
    expect(mx).toBeLessThan(4 + 0.03);
  });
  it('arka alın payı yok olmadan arka tornalama silinirse hata verir', () => {
    const q = JSON.parse(JSON.stringify(p));
    q.ops = q.ops.filter(o => o.type !== 'backTurn');
    const rr = runPipeline(q);
    expect(rr.errors.some(e => /Arka Tornalama işlemi yok/.test(e.msg))).toBe(true);
  });
});
