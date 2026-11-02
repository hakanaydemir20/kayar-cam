// Parça bırakma makrosu: bırakma konumu, hava üfleme, pens açma, itici; strok denetimi
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim } from '../src/sim/stockSim.js';

describe('parça bırakma', () => {
  it('X2 bırakma konumu, hava üfleme ve itici koda yazılır; hatasız ve çarpışmasız', () => {
    const P = newProject();
    Object.assign(P.post.codes, { airBlowOn: 'M80', airBlowOff: 'M81' });
    Object.assign(P.ops.find(o => o.type === 'eject').params, { dropX: 40, blow: 1.2 });
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    const t2 = r.posted.paths[1].join('\n');
    expect(t2).toMatch(/\(PARCA BIRAKMA\)\nG0 X40\.\nM80\nM21\nM70\nG4 U1\.2\nM81/);
    const ss = new StockSim(P, r.sim).runAll();
    expect(ss.collisions).toEqual([]);
    expect(ss.state.attached).toBe('ejected');
  });
  it('hava üfleme kodu tanımsızsa yalnız pens açma ve itici', () => {
    const P = newProject();
    const t2 = runPipeline(P).posted.paths[1].join('\n');
    expect(t2).toMatch(/\(PARCA BIRAKMA\)\nG0 X0\.\nM21\nM70\nG4 U0\.5/);
  });
  it('strok dışı bırakma konumu açıklayıcı hata verir', () => {
    const P = newProject();
    P.ops.find(o => o.type === 'eject').params.dropX = 500;
    expect(runPipeline(P).errors.some(e => /bırakma konumu X2 500 strok dışında/.test(e.msg))).toBe(true);
  });
});
