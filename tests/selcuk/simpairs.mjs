// Selçuk QA: gerçek P1/P2 çiftlerini manuel moddaki gibi simüle eder (örnekler repoya kopyalanmaz).
// node tests/selcuk/simpairs.mjs [klasör] [--fine] [--only=KEY,KEY]
import fs from 'fs'; import path from 'path';
import { newProject, simulateText } from '../../src/project.js';
import { makePart } from '../../src/part/part.js';
import { StockSim } from '../../src/sim/stockSim.js';
import { profileElements, probeAt, sectionAt, volumes, profileRows, partRange } from '../../src/sim/inspect.js';
import { derivePart } from '../../src/sim/derivePart.js';
import { joinChannelTexts } from '../../src/ui/gcodeEditor.js';
const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) || '../örnek cam dosyaları';
const fine = args.includes('--fine');
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const read = f => fs.readFileSync(path.join(dir, f), 'latin1').replace(/\r/g, '');
const files = fs.readdirSync(dir).filter(f => !/\.(stp|step|sldprt|jpg|x_t|pdf)$/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
const side = t => /SUB TARAFI/.test(t) ? 2 : /MAIN TARAFI/.test(t) ? 1 : 0;
const key = f => f.replace(/\.(txt|TXT)$/, '').replace(/-?P\d+$/i, '').replace(/^MK180003037AA /, '').trim();
const pairs = new Map();
for (const f of files) { const t = read(f), s = side(t); if (!s) continue; const k = key(f); const e = pairs.get(k) || {}; if (!e[s]) e[s] = f; pairs.set(k, e); }
const num = (t, v) => { const m = new RegExp('#' + v + String.raw`\s*=\s*([-\d.]+)`).exec(t); return m ? +m[1] : null; };
const out = [];
for (const [k, pr] of pairs) {
  if (!pr[1] || !pr[2]) continue;
  if (only.length && !only.includes(k)) continue;
  const t1 = read(pr[1]), t2 = read(pr[2]);
  const d531 = num(t1, 531), L530 = num(t1, 530), cw = num(t1, 528);
  const bar = d531 ? d531 - 1 : 20;
  const R = bar / 2, L = 30;
  const part = makePart({ name: k, profile: [{ z: 0, r: 0 }, { z: 0, r: R }, { z: L, r: R }, { z: L, r: 0 }], features: [], source: 'gcode' });
  const P = newProject(part); P.ops = []; P.stock.barDia = bar;
  const row = { k, bar, L530, cw };
  try {
    const t0 = performance.now();
    const text = joinChannelTexts(t1, t2);
    const sim = simulateText(P, text);
    row.err = sim.errors.length; row.warn = sim.warnings.length;
    row.errs = [...new Set(sim.errors.map(e => '$' + e.path + ' ' + e.msg))].slice(0, 4);
    row.warns = [...new Set(sim.warnings.map(e => e.msg.replace(/-?\d+(\.\d+)?/g, '#')))].slice(0, 4);
    row.cyc = Math.max(0, ...sim.paths.map(p => p.totalTime || 0));
    row.pt = sim.paths.map(p => +(p.totalTime || 0).toFixed(1));
    row.nmoves = sim.paths.map(p => p.moves.length);
    let zmax = 0; for (const m of sim.paths[0]?.moves || []) if (m.state?.tool && Number.isFinite(m.to?.Z)) zmax = Math.max(zmax, m.to.Z);
    row.zmaxP1 = +zmax.toFixed(2);
    const t1i = performance.now();
    const ss = new StockSim(P, sim, fine ? { grid: { dz: 0.02, nth: 720 } } : {}).runAll();
    const t2i = performance.now();
    const S = ss.stock;
    row.dMax = ss.opts.dMax; row.grid = [S.nz, S.nth];
    row.coll = ss.collisions.length; row.st = { sep: ss.state.separated, att: ss.state.attached };
    const pe = profileElements(S, R);
    const rg = pe.range;
    row.cut = rg?.cut; row.len = rg ? +(rg.end - rg.front).toFixed(3) : null; row.front = rg?.front;
    row.els = pe.elements.map(e => e.kind === 'cyl' ? `C${e.d0}x${e.len}${e.nonRound ? '*' : ''}` : `T${e.d0}-${e.d1}`).join(' ');
    row.vol = volumes(S, R);
    const rows = profileRows(S);
    if (rg) {
      let nr = 0, maxIn = 0; for (let i = rg.i0; i <= rg.iEnd; i++) { if (rows[i].rMax - rows[i].rMin > 0.05) nr++; maxIn = Math.max(maxIn, rows[i].rin); }
      row.nonRoundRows = nr; row.maxHoleD = +(2 * maxIn).toFixed(3);
      row.probeMid = probeAt(S, R, row.len / 2);
      const sec = sectionAt(S, R, row.len / 2); row.secMinR = +Math.min(...sec.pts.map(p => p.r)).toFixed(3);
    }
    const d = derivePart(S, R, k);
    row.derive = d.part ? { L: d.L, feats: d.part.features.map(f => `${f.side}:Ø${f.dia}x${f.depth}${f.through ? 'T' : ''}`) } : d.info;
    // P2 sonrası alt iş mili stoku var mı?
    row.subStock = ss.sub ? 'var' : (ss.prev ? 'prev' : 'yok');
    row.ms = { interp: Math.round(t1i - t0), stock: Math.round(t2i - t1i) };
    // X bitirme değerleri (P1, G1 X) en küçük birkaç pozitif
    const xs = [...t1.matchAll(/G0?1[^\n(]*X(\d+\.?\d*)/g)].map(m => +m[1]).filter(v => v > 0 && v <= bar);
    row.xvals = [...new Set(xs)].sort((a, b) => a - b).slice(0, 8);
  } catch (e) { row.exc = e.stack.split('\n').slice(0, 3).join(' | '); }
  out.push(row);
  console.error(k, row.exc ? 'EXC ' + row.exc : `${row.ms?.interp}+${row.ms?.stock}ms len ${row.len}`);
}
fs.writeFileSync(process.env.OUT || 'sim-out.json', JSON.stringify(out, null, 1));
