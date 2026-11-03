// Kesici uç – parça teması: simülasyonun malzeme kaldırması ekrandaki uç geometrisiyle (insertOutline, 3D ağ aynı
// dış hattı kullanır) aynı olmalı. Her an, ucun kapladığı bölgede kalan stok olmamalı (gömülme = uç parçanın içinde
// görünür ama malzeme kalkmamış). Bütün ISO uç tipleri, örnek parçalar.
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline, autoOperations } from '../src/project.js';
import { StockSim } from '../src/sim/stockSim.js';
import { insertOutline, makeTool } from '../src/tools/toolLibrary.js';
import { SAMPLE_PARTS } from '../src/samples/sampleParts.js';

const SHAPES = [['C', 'CCMT 09T304', 9.7, 0.4], ['D', 'DCMT 11T304', 11.6, 0.4], ['V', 'VCMT 110304', 11, 0.4], ['T', 'TCMT 110204', 11, 0.4], ['W', 'WCMT 06T304', 6.5, 0.4], ['S', 'SCMT 09T304', 9.5, 0.4], ['R', 'RCMT 0803M0', 8, 4]];

function penetration(p) {
  const r = runPipeline(p);
  if (!r.sim) return { err: r.errors.map(e => e.msg) };
  const S = new StockSim(p, r.sim, { bodies: false });
  const N = Math.ceil(S.totalTime / 0.02);
  const outl = new Map();
  let worst = { pen: 0 };
  for (let k = 1; k <= N; k++) {
    const t = S.totalTime * k / N;
    S.seek(t);
    const m = S.currentMove(1, t);
    const tool = m?.state?.tool;
    if (!tool || tool.type !== 'turn' || tool.unit !== 'gang' || m.kind === 'event' || S.state.mainOpen) continue;
    if (!outl.has(tool.id)) outl.set(tool.id, insertOutline(tool, 24));
    const f = m.t1 > m.t0 ? Math.min(1, Math.max(0, (t - m.t0) / (m.t1 - m.t0))) : 1;
    const X = m.mFrom.X + (m.mTo.X - m.mFrom.X) * f, Zm = m.mFrom.Z + (m.mTo.Z - m.mFrom.Z) * f;
    if (m.kind === 'arc') continue;   // yayda doğrusal ara değer yayın ortasını kaçırır
    const zp = S.mainFrontWorld(Zm), st = S.stock;
    const pts = outl.get(tool.id);
    // her ızgara dilimi merkezinde (d) ucun alt hattı: dış hat kenarlarının o eksenel konumdaki en alt kesişimi
    const xs = pts.map(q => q[0]), xMax = Math.max(...xs);
    const i0 = Math.max(0, st.idx(zp - xMax) + 1), i1 = Math.min(st.nz - 1, st.idx(zp) - 1);
    for (let i = i0; i <= i1; i++) {
      const d = st.dAt(i); if (d > S.L) break;
      const x = zp - d; let yLow = Infinity;
      for (let j = 0; j < pts.length; j++) {
        const [x1, y1] = pts[j], [x2, y2] = pts[(j + 1) % pts.length];
        if ((x1 - x) * (x2 - x) > 0 || x1 === x2) continue;
        const y = y1 + (y2 - y1) * (x - x1) / (x2 - x1); if (y < yLow) yLow = y;
      }
      if (!isFinite(yLow)) continue;
      const rr = Math.abs(X / 2 + yLow), g = st.rowMax[i] - rr;
      if (g > worst.pen) worst = { pen: +g.toFixed(3), t: +t.toFixed(2), line: m.line, d: +d.toFixed(2), tool: tool.name };
    }
  }
  return worst;
}

describe('uç–parça teması (ekrandaki uç = kesme modeli)', () => {
  for (const sp of SAMPLE_PARTS) for (const [sh, code, size, rn] of SHAPES) {
    it(`${sp.name} · ${sh} ucu (${code})`, () => {
      const p = newProject(sp.make());
      const t = makeTool({ num: 1, name: 'Deneme ' + code, type: 'turn', unit: 'gang', insertCode: code, insertShape: sh, insertSize: size, noseR: rn, vc: 150, feed: 0.1, yPos: 110 });
      p.tools = p.tools.map(x => (x.num === 1 ? t : x));
      p.ops = autoOperations(p).filter(o => ['face', 'rough', 'finish'].includes(o.type));
      for (const o of p.ops) o.toolId = t.id;
      const w = penetration(p);
      expect(w.err, JSON.stringify(w.err)).toBeUndefined();
      expect(w.pen, JSON.stringify(w)).toBeLessThan(0.03);
    }, 60000);
  }
});
