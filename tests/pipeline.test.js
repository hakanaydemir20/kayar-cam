import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';

describe('uçtan uca program', () => {
  const p = newProject();
  const r = runPipeline(p);
  it('CAM/post/NC hatası yok', () => {
    if (r.errors.length) console.log(r.errors);
    expect(r.errors).toEqual([]);
  });
  it('iki kanal üretildi ve senkron süreler hesaplandı', () => {
    expect(r.sim.paths.length).toBe(2);
    expect(r.sim.paths[0].totalTime).toBeGreaterThan(5);
    expect(r.sim.paths[1].totalTime).toBeGreaterThan(1);
  });
  it('tüm koordinatlarda ondalık nokta var', () => {
    for (const ln of r.posted.text.split('\n')) {
      const code = ln.replace(/\([^)]*\)/g, '');
      for (const m of code.matchAll(/([XYZCIJKUW])(-?[\d.]+)/g)) expect(m[2]).toContain('.');
    }
  });
  it('örnek çıktı', () => {
    console.log(r.posted.text.split('\n').slice(0, 400).join('\n'));
    console.log('UYARILAR', r.warnings);
  });
});

describe('post: iş koordinatı değişimi', () => {
  it('G54/G55 değişiminden sonra eksenler bastırılmaz (parça atma X0 yazılır)', () => {
    const p = newProject();
    const r = runPipeline(p);
    const l2 = r.posted.paths[1];
    const i = l2.findIndex((s, k) => s === 'G54' && k > 5);
    expect(i).toBeGreaterThan(0);
    const after = l2.slice(i + 1, i + 4).join(' ');
    expect(after).toMatch(/X0\./);
    // simülasyonda parça atma anında karşı iş mili ekseninde (X2 makine ≈ 0)
    const ej = r.sim.paths[1].moves.filter(m => m.event === 'partEject')[0];
    expect(Math.abs(ej.mTo.X)).toBeLessThan(1e-6);
  });
});

describe('post: güvenlik kuralları', () => {
  const p = newProject();
  const r = runPipeline(p);
  const l1 = r.posted.paths[0];
  it('başlıkta G18 düzlem seçimi var', () => {
    expect(l1.find(s => s.startsWith('G18'))).toMatch(/G18 G21 G40 G80 G97 G99/);
  });
  it('her takım değişiminden sonraki ilk G1/G2/G3 satırında F yazılı', () => {
    let afterTool = false, n = 0;
    for (const ln of l1) {
      const code = ln.replace(/\([^)]*\)/g, '');
      if (/^T\d{4}/.test(code)) { afterTool = true; continue; }
      if (afterTool && /(^|\s)G[123](?!\d)/.test(code)) { expect(code, ln).toMatch(/F[\d.]+/); afterTool = false; n++; }
    }
    expect(n).toBeGreaterThan(5);
  });
  it('çubuk ilerletme alın payı bırakır: Z = −(kesme genişliği + alın payı)', () => {
    const i = l1.findIndex(s => s.includes('DURDURUCU'));
    const w = p.tools.find(t => t.type === 'cutoff').width;
    const z = l1.slice(i).find(s => /^G0 Z-/.test(s));
    expect(parseFloat(z.slice(4))).toBeCloseTo(-(w + p.stock.faceStock), 3);
  });
  it('kovan takımı (radyal montaj ofsetli) için makine X1 = program X − 2·xPos', () => {
    const t = p.tools.find(x => x.unit === 'front');
    const m = r.sim.paths[0].moves.find(mv => mv.state.tool === t && mv.kind === 'feed');
    expect(m.mTo.X - m.to.X).toBeCloseTo(-2 * t.xPos, 6);
  });
});
