import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { barFlow, setupSheetHtml, profileSvg } from '../src/ui/report.js';

describe('çubuk akışı ve kurulum föyü', () => {
  const p = newProject();
  const r = runPipeline(p);
  const T = Math.max(...r.sim.paths.map(q => q.totalTime));
  it('çubuk başına parça = ⌊(2500 − 250) / (35 + 2 + 0.3)⌋ = 60', () => {
    const bf = barFlow(p, T);
    expect(bf.perPart).toBeCloseTo(37.3, 6);
    expect(bf.parts).toBe(60);
    expect(bf.yield).toBeCloseTo(60 * 35 / 2500, 6);
    expect(bf.partsPerHour).toBeCloseTo(3600 / T, 6);
  });
  it('föy: bütün takımlar, işlemler, uyarılar ve profil çizimi', () => {
    const html = setupSheetHtml(p, r, {}, T);
    for (const t of p.tools) expect(html).toContain('T' + String(t.num).padStart(2, '0'));
    expect(html).toContain('DOĞRULANMADI');
    expect(html).toContain('<svg');
    expect(html).toContain('Çubuk başına parça');
  });
  it('profil çiziminde çap ölçüleri', () => {
    const s = profileSvg(p.part);
    for (const d of ['Ø6', 'Ø10', 'Ø7', 'Ø14']) expect(s).toContain(d);
  });
  it('parça sayacı kodu tanımlıysa program sonunda yazılır, boşsa yazılmaz', () => {
    expect(r.posted.paths[0].join('\n')).not.toMatch(/M56/);
    const q = newProject(); q.post.codes.partCount = 'M56';
    const rr = runPipeline(q);
    expect(rr.errors).toEqual([]);
    const l = rr.posted.paths[0];
    expect(l.indexOf('M56')).toBeGreaterThan(l.findIndex(s => /DURDURUCU/.test(s)));
  });
});
