// Kapalı işlem: G-kodda / ile kalır (FANUC blok atlama), simülasyon ve doğrulama onu yok sayar; modal durum bozulmaz
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';

describe('kapalı işlem → blok atlama', () => {
  it('kapalı delme / ile yazılır, hareket üretmez, kalan program aynı çalışır', () => {
    const P = newProject();
    const on = runPipeline(P);
    const op = P.ops.find(o => o.type === 'flatMill');
    op.enabled = false;
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    const lines = r.posted.text.split('\n');
    const sk = lines.filter(l => l.startsWith('/'));
    expect(sk.length).toBeGreaterThan(5);
    expect(sk.some(l => l.includes('KAPALI'))).toBe(true);
    expect(sk.some(l => /G1 |G0 /.test(l))).toBe(true);
    // atlanan satırlar dışındaki program: kapalı işlem hiç yokmuş gibi (modal durum korunur)
    const rest = lines.filter(l => !l.startsWith('/')).join('\n');
    const P2 = newProject(); P2.ops = P2.ops.filter(o => o.type !== 'flatMill');
    expect(rest).toBe(runPipeline(P2).posted.text);
    // simülasyon: kapalı işlemin hareketi yok
    expect(r.sim.paths[0].moves.filter(m => r.posted.lineInfo[0][m.line]?.opId === op.id && m.kind !== 'wait').length).toBe(0);
    const ss = new StockSim(P, r.sim).runAll();
    expect(ss.collisions).toEqual([]);
    expect(compare(ss.resultStock(), buildTarget(P, ss.opts), P.part.length).over).toBe(0);
    expect(on.posted.text).not.toContain('\n/');
  });
  it('takımı olmayan kapalı işlem: yalnız açıklama satırı, hata yok', () => {
    const P = newProject();
    const op = P.ops.find(o => o.type === 'drill'); op.toolId = null; op.enabled = false;
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    expect(r.posted.text).toContain('/(KAPALI ISLEM - KOD URETILEMEDI)');
  });
  it('arka kanal kapalı işlem ve satır numarası ile', () => {
    const P = newProject(); P.post.lineNumbers = true;
    const op = P.ops.find(o => o.type === 'backDrill'); op.enabled = false;
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    expect(r.posted.text).toMatch(/\n\/N\d+ /);
  });
});
