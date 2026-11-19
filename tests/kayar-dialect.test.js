// Atölye (kayar) lehçesi: küçük sentetik parçalar (özel örnek dosyalar kullanılmaz).
import { describe, it, expect } from 'vitest';
import { interpret } from '../src/sim/interpreter.js';
import { makeFrames } from '../src/sim/frames.js';
import machine from '../src/machine/sb20r-g.json';
import profile from '../src/post/postProfileKayar.json';
import { defaultTools } from '../src/tools/toolLibrary.js';

const run = (p1, p2 = 'M5', tools = []) => interpret(`%\n$1\n${p1}\n$2\n${p2}\n%`, { profile, machine, tools, frames: makeFrames({ L: 30, grip: 5 }) });
const mv = (r, ch, line) => r.paths[ch - 1].moves.filter(m => m.line === line);
const lineOf = (txt, s) => txt.split('\n').indexOf(s);

describe('kayar lehçesi', () => {
  it('makro değişkenleri ve [ifade]', () => {
    const p1 = '#530=10\n#528=2\nT0200\nM3S1000\nG0X[#530+#528]Z0T2';
    const r = run(p1);
    expect(r.errors).toEqual([]);
    expect(mv(r, 1, 4).at(-1).to.X).toBeCloseTo(12);
  });
  it('T0200 seçer, T2 ofseti uygular (Y dahil), T0 iptal eder', () => {
    const tools = defaultTools();
    const r = run('T0200\nT2\nG0X10Z0\nG0T0', 'M5', tools);
    const off = mv(r, 1, 1)[0];          // T2 bloğu: makine yeni takıma gider
    expect(off.mTo.Y).toBeCloseTo(-92);
    expect(off.state.tool.num).toBe(2);
    expect(off.to.Y).toBeCloseTo(0);
    const t0 = mv(r, 1, 3)[0];
    expect(t0.state.tool).toBe(null);
  });
  it('G28U0 / G28W0 referansa döner', () => {
    const r = run('G0X10Z5\nG28U0', 'G28W0');
    expect(mv(r, 1, 1)[0].mTo.X).toBe(profile.homeX1);
    expect(mv(r, 2, 0)[0].mTo.Z).toBe(machine.subHomeZ);
  });
  it('G125 Z sıfır alma olay üretir, konum değişmez', () => {
    const r = run('G0Z-0.2T0\nG125Z-0.2');
    const e = mv(r, 1, 1)[0];
    expect(e.event).toBe('zeroSet');
    expect(e.to.Z).toBeCloseTo(-0.2);
  });
  it('G130 / G131 / T2900 çerçeveleri', () => {
    const r = run('M3S1000\nG0Z20\nM82\nM5', 'G130\nT2900\nG0Z40\nT2000\nM82\nG131\nG0Z-30');
    expect(r.errors).toEqual([]);
    expect(mv(r, 2, 2)[0].state.wo).toBe('T29');
    expect(mv(r, 2, 2)[0].mTo.Z).toBeCloseTo(machine.subHomeZ - 40);
    const g = mv(r, 2, 6)[0];
    expect(g.state.wo).toBe('G131');
    expect(g.mTo.Z).toBeCloseTo(20 + 30);   // ana milin M82 konumuna göre
  });
  it('M82/M40/M41 iki kanalı hizalar; eksik eşleşme hata verir', () => {
    const r = run('G4X2\nM82\nM40\nM41', 'M82\nM40\nM41');
    expect(r.errors).toEqual([]);
    const w1 = r.paths[0].moves.find(m => m.kind === 'wait'), w2 = r.paths[1].moves.find(m => m.kind === 'wait');
    expect(w2.t1).toBeCloseTo(w1.t1);
    expect(run('M82\nM40', 'M82').errors.some(e => /eşleşmedi/.test(e.msg))).toBe(true);
  });
  it('her M82 yakalaması kendi ana mil konumunu kullanır (orta yeniden bağlama)', () => {
    const r = run('M3S1000\nG0Z45\nM82\nG0Z52\nM82', 'M82\nM82\nG131\nG0Z-30');
    expect(mv(r, 2, 3)[0].mTo.Z).toBeCloseTo(52 + 30);
  });
  it('$2 karşı mil duruk + G99: ana milin devriyle ilerler; ana da duruksa hata', () => {
    const ok = run('M3S2000\nG4X5', 'G99\nG0Z195\nG1Z200F1');
    expect(ok.errors).toEqual([]);
    const f = mv(ok, 2, 2)[0];
    expect(f.feed).toBeCloseTo(2000);
    expect(f.dur).toBeCloseTo(5 / 2000 * 60);
    const bad = run('M5\nG4X5', 'G99\nG0Z195\nG1Z200F1');
    expect(bad.errors.some(e => /iş mili duruyor/.test(e.msg))).toBe(true);
    expect(run('M5\nG99\nG1Z5F0.1T0').errors.some(e => /iş mili duruyor/.test(e.msg))).toBe(true);
  });
  it('G87 radyal gagalı delme', () => {
    const r = run('T3100(Q3 MATKAP)\nM36S3000\nG0X12Z5T31\nG98G87X4Q1000F60');
    expect(r.errors).toEqual([]);
    const feeds = mv(r, 1, 3).filter(m => m.kind === 'feed');
    expect(feeds.length).toBeGreaterThan(1);
    expect(Math.min(...feeds.map(m => m.to.X))).toBeCloseTo(4);
  });
  it('G83 W ve M29 S + G84 W', () => {
    const r = run('T0500\nM3S1000\nG0X0Z-2T5\nG99G83W6Q1000F0.02\nM29S500\nG84W4F0.7\nG80');
    expect(r.errors).toEqual([]);
    expect(Math.max(...mv(r, 1, 3).map(m => m.to.Z))).toBeCloseTo(4);
    const tap = mv(r, 1, 5).filter(m => m.kind === 'feed');
    expect(tap[0].feed).toBeCloseTo(350);
    expect(tap[0].to.Z).toBeCloseTo(2);
    expect(run('T0500\nM3S1000\nG0X0Z0T5\nG84W4F0.7').errors.some(e => /M29/.test(e.msg))).toBe(true);
  });
  it('H artımsal C ve C kelimesi C eksenini açar', () => {
    const r = run('T3200\nM36S3000\nG0G98C0T32\nG0H90\nG0C30');
    expect(r.errors).toEqual([]);
    expect(mv(r, 1, 3)[0].to.C).toBeCloseTo(90);
    expect(mv(r, 1, 3)[0].state.cAxis).toBe(true);
  });
  it('M6/M7 C kilidi: kilitli + duruk mil = planyalama (hata yok)', () => {
    const r = run('T0200\nM5\nG0X10Z0T2\nC0\nM6\nG98G1Z5F100\nM7');
    expect(r.errors).toEqual([]);
    expect(mv(r, 1, 4)[0].event).toBe('cClamp');
    expect(run('T0200\nM5\nG0X10Z0T2\nG98G1Z5F100').errors.length).toBeGreaterThan(0);
  });
  it('R ile yay; R < kiriş/2 uyarı (yarım daire); modal G2 R/I/K yok → doğrusal uyarı', () => {
    const a = run('T0200\nM3S1000\nG0X0Z0T2\nG99G2X4W2R2F0.02');
    expect(a.errors).toEqual([]);
    const arc = mv(a, 1, 3)[0];
    expect(arc.kind).toBe('arc');
    expect(arc.arc.r).toBeCloseTo(2);
    const b = run('T0200\nM3S1000\nG0X0Z0T2\nG99G2X3.8W3.8R1.9F0.02\nZ10');
    expect(b.errors).toEqual([]);
    expect(b.warnings.some(w => /yarım daire/.test(w.msg))).toBe(true);
    expect(b.warnings.some(w => /doğrusal hareket/.test(w.msg))).toBe(true);
    expect(mv(b, 1, 4)[0].kind).toBe('feed');
  });
  it('yorumdan otomatik takım', () => {
    const r = run('T3100(Q6 FREZE)\nM36S3000\nG0X10T31', 'T2100(Q2.6 MATKAP)\nT21');
    const t31 = r.autoTools.find(t => t.num === 31), t21 = r.autoTools.find(t => t.num === 21);
    expect(t31).toMatchObject({ type: 'endmill', dia: 6, unit: 'cross', live: true });
    expect(t21).toMatchObject({ type: 'drill', dia: 2.6, unit: 'back', channel: 2 });
  });
  it('ön takımlar T11–T13 → T35 kolonunun katları', () => {
    const tools = defaultTools();
    const r = run('T1200\nM3S1000\nG0X0Z-1T12', 'M5', tools);
    const t = mv(r, 1, 2).at(-1).state.tool;
    expect(t).toMatchObject({ num: 35, offset: 2, unit: 'front' });
    expect(r.autoTools.length).toBe(0);
  });
});
