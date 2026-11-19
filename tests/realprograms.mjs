// Atölyenin gerçek programları (örnek cam dosyaları, repoya girmez): her P1/P2 çifti yorumlanır, hatalar gruplanır.
// node tests/realprograms.mjs [klasör] [-v]
import fs from 'fs';
import path from 'path';
import { interpret } from '../src/sim/interpreter.js';
import { makeFrames } from '../src/sim/frames.js';
import machineDef from '../src/machine/sb20r-g.json' with { type: 'json' };
import profile from '../src/post/postProfileKayar.json' with { type: 'json' };

const dir = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '../örnek cam dosyaları';
const verbose = process.argv.includes('-v');
const files = fs.readdirSync(dir).filter(f => !/\.(stp|step|sldprt|jpg|x_t|pdf)$/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
const read = (f) => fs.readFileSync(path.join(dir, f), 'latin1').replace(/\r/g, '');
const side = (t) => /SUB TARAFI/.test(t) ? 2 : /MAIN TARAFI/.test(t) ? 1 : 0;
const key = (f) => f.replace(/\.(txt|TXT)$/, '').replace(/-?P\d+$/i, '').replace(/^MK180003037AA /, '').trim();
const pairs = new Map();
for (const f of files) { const t = read(f), s = side(t); if (!s) continue; const k = key(f); (pairs.get(k) || pairs.set(k, {}).get(k))[s] = (pairs.get(k)[s] ? pairs.get(k)[s] + '|' : '') + f; }
const groups = new Map(); let ok = 0, total = 0;
for (const [k, pr] of pairs) {
  const p1 = pr[1]?.split('|')[0], p2 = pr[2]?.split('|')[0];
  if (!p1 || !p2) { (groups.get('EŞİ YOK (tek dosya)') || groups.set('EŞİ YOK (tek dosya)', []).get('EŞİ YOK (tek dosya)')).push(k); continue; }
  const text = '%\n$1\n' + (p1 ? read(p1) : '') + '\n$2\n' + (p2 ? read(p2) : '') + '\n%';
  const m = JSON.parse(JSON.stringify(machineDef));
  let sim;
  try { sim = interpret(text, { profile, machine: m, tools: [], frames: makeFrames({ L: 30, grip: 5 }) }); }
  catch (e) { (groups.get('İSTİSNA ' + e.message) || groups.set('İSTİSNA ' + e.message, []).get('İSTİSNA ' + e.message)).push(k); total++; continue; }
  total++;
  const msgs = [...sim.errors.map(e => 'H ' + e.msg.replace(/-?\d+(\.\d+)?/g, '#')), ...sim.warnings.map(w => 'U ' + w.msg.replace(/-?\d+(\.\d+)?/g, '#'))];
  if (!sim.errors.length) ok++;
  for (const g of new Set(msgs)) (groups.get(g) || groups.set(g, []).get(g)).push(k);
  if (verbose && sim.errors.length) for (const e of sim.errors.slice(0, 5)) console.log(k, '$' + e.path, 'satır', e.line + 1, e.msg, '|', sim.paths[e.path - 1]?.lines[e.line]?.src?.trim());
}
console.log(`çift ${total}, hatasız ${ok}`);
for (const [g, ks] of [...groups].sort((a, b) => b[1].length - a[1].length)) console.log(String(ks.length).padStart(3), g.slice(0, 110), '·', ks.slice(0, 3).join(', '));
