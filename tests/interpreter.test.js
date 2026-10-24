import { describe, it, expect } from 'vitest';
import { interpret, movePoint } from '../src/sim/interpreter.js';
import machine from '../src/machine/sb20r-g.json';
import post from '../src/post/postProfile.json';
import { defaultTools } from '../src/tools/toolLibrary.js';
import { fmt, cleanComment } from '../src/post/fanucStar.js';

const tools = defaultTools();
const run = (text) => interpret(text, { profile: post, machine, tools });
const P1 = (body) => `%\n$1\nO1000\nG21 G99\n${body}\nM30\n$2\nO1000\nM30\n%`;

describe('sayı formatı ve yorumlar', () => {
  it('ondalık nokta her zaman yazılır', () => {
    expect(fmt(12)).toBe('12.');
    expect(fmt(-0.0001)).toBe('0.');
    expect(fmt(3.14159)).toBe('3.142');
    expect(fmt(0.5)).toBe('0.5');
  });
  it('Türkçe karakterler panel için dönüştürülür', () => {
    expect(cleanComment('Çapraz Delik Ø3 (şık)')).toBe('CAPRAZ DELIK D3 SIK');
  });
});

describe('G2/G3 (G18, ZX düzlemi)', () => {
  it('çeyrek yay: merkez, yön ve uzunluk', () => {
    const r = run(P1('T0101\nG96 S1=100 M3\nG50 S1=3000\nG0 X10. Z0.\nG3 X14. Z-2. I0. K-2. F0.1'));
    // dikkat: G50 sonra geldi → uyarı olabilir; hata olmamalı
    expect(r.errors).toEqual([]);
    const m = r.paths[0].moves.find(x => x.kind === 'arc');
    expect(m.arc.r).toBeCloseTo(2, 6);
    expect(m.arc.length).toBeCloseTo(Math.PI, 3);
    const mid = movePoint(m, 0.5);
    // (Z,X/2): başlangıç (0,5), merkez (-2,5), bitiş (-2,7) — G3 saat yönü tersi
    expect(mid.Z).toBeCloseTo(-2 + 2 * Math.cos(Math.PI / 4), 4);
    expect(mid.X / 2).toBeCloseTo(5 + 2 * Math.sin(Math.PI / 4), 4);
  });
  it('yarıçap tutarsız yay hata verir', () => {
    const r = run(P1('T0101\nG97 S1=1000 M3\nG0 X10. Z0.\nG2 X14. Z-2. I0.5 K-2. F0.1'));
    expect(r.errors.some(e => /Yay yarıçap tutarsız/.test(e.msg))).toBe(true);
  });
});

describe('G19 helikal (YZ düzlemi, X çapta)', () => {
  it('yarım tur helis: X lineer iner, yay YZ düzleminde', () => {
    const r = run(P1('M5\nM18\nT1212\nG98\nG97 S3=3000 M53\nG19\nG0 X12. Y2. Z10.\nG3 X11. Y-2. Z10. J-2. K0. F100.'));
    expect(r.errors).toEqual([]);
    const m = r.paths[0].moves.find(x => x.kind === 'arc');
    expect(m.arc.plane).toBe('yz');
    const q = movePoint(m, 0.5);
    expect(q.X).toBeCloseTo(11.5, 6);
    expect(Math.hypot(q.Y, q.Z - 10)).toBeCloseTo(2, 6);
    expect(m.feed).toBe(100);
  });
  it('tahrikli takım dönmüyorsa hata', () => {
    const r = run(P1('M5\nM18\nT1212\nG98\nG0 X12. Y0. Z10.\nG1 X10. F100.'));
    expect(r.errors.some(e => /dönmüyor/.test(e.msg))).toBe(true);
  });
});

describe('G92 diş çevrimi', () => {
  it('her blok 4 hareket üretir ve başlangıca döner', () => {
    const r = run(P1('T0404\nG97 S1=1000 M3\nG0 X12. Z-2.\nG92 X9.5 Z10. F1.\nX9.2'));
    expect(r.errors).toEqual([]);
    const ms = r.paths[0].moves.filter(m => m.line >= 5);
    const thr = ms.filter(m => m.kind === 'thread');
    expect(thr.length).toBe(2);
    expect(thr[1].from.X).toBe(9.2);
    expect(thr[0].feed).toBe(1000); // F1 × 1000 dev/dak
    const last = ms[ms.length - 1];
    expect(last.to.X).toBe(12); expect(last.to.Z).toBe(-2);
  });
});

describe('hata yakalama', () => {
  it('F yoksa hata', () => {
    const r = run(P1('T0101\nG97 S1=1000 M3\nG0 X10. Z0.\nG1 X8.'));
    expect(r.errors.some(e => /F/.test(e.msg))).toBe(true);
  });
  it('iş mili dururken kesme hata', () => {
    const r = run(P1('T0101\nG0 X10. Z0.\nG1 X8. F0.1'));
    expect(r.errors.some(e => /iş mili/i.test(e.msg))).toBe(true);
  });
  it('devir limiti aşımı hata', () => {
    const r = run(P1('T0101\nG97 S1=12000 M3'));
    expect(r.errors.some(e => /limiti/.test(e.msg))).toBe(true);
  });
  it('tanımsız takım hata', () => {
    const r = run(P1('T9999\nG0 X10.'));
    expect(r.errors.some(e => /Tanımsız takım/.test(e.msg))).toBe(true);
  });
  it('$2 takımı $1de kullanılamaz', () => {
    const r = run(P1('T4141\nG0 X10.'));
    expect(r.errors.some(e => /kanalda/.test(e.msg))).toBe(true);
  });
  it('Z1 strok dışı hata', () => {
    const r = run(P1('T0101\nG0 X16. Z300.'));
    expect(r.errors.some(e => /Z1 strok/.test(e.msg))).toBe(true);
  });
});

describe('kanal senkronizasyonu', () => {
  it('bekleme kodları iki kanalı hizalar', () => {
    const text = `%\n$1\nO1\nG4 U2.\nM201\nM30\n$2\nO1\nM201\nG4 U1.\nM30\n%`;
    const r = run(text);
    expect(r.errors).toEqual([]);
    const w1 = r.paths[0].moves.find(m => m.kind === 'wait');
    const w2 = r.paths[1].moves.find(m => m.kind === 'wait');
    expect(w1.t1).toBeCloseTo(2, 6);
    expect(w2.t1).toBeCloseTo(2, 6);
    expect(r.paths[1].totalTime).toBeCloseTo(3 + 0.05, 1);
  });
  it('eşleşmeyen bekleme hata', () => {
    const r = run(`%\n$1\nO1\nM201\nM30\n$2\nO1\nM30\n%`);
    expect(r.errors.some(e => /eşleşmedi|kilitlenme/.test(e.msg))).toBe(true);
  });
  it('farklı beklemeler kilitlenme hatası', () => {
    const r = run(`%\n$1\nO1\nM201\nM30\n$2\nO1\nM202\nM30\n%`);
    expect(r.errors.some(e => /kilitlenme/.test(e.msg))).toBe(true);
  });
});
