// İşlem listesinden iki kanallı programı kurar (ESPRIT tarzı otomatik senkronizasyon).
import { Prog } from '../toolpath/ir.js';
import { GEN, OP_TYPES, defaultParams } from './generators.js';
import { buildContext } from './context.js';
import { findTool } from '../tools/toolLibrary.js';
import { rpmFromVc } from '../tools/cuttingData.js';

let _opn = 0;
export function makeOp(type, toolId = null, params = {}, name = null) {
  return {
    id: 'op' + (++_opn) + '_' + Math.random().toString(36).slice(2, 6),
    type, toolId, enabled: true,
    name: name || OP_TYPES[type].label,
    params: { ...defaultParams(type), ...params },
  };
}

export function buildProgram(project) {
  const ctx = buildContext(project);
  const errors = [], warnings = [];
  const p1 = new Prog(1), p2 = new Prog(2);
  const ops = project.ops.filter(o => o.enabled);
  const pick = ops.find(o => o.type === 'pickoff');
  const cut = ops.find(o => o.type === 'cutoff');
  if (pick && !cut) errors.push({ op: pick.id, msg: 'Karşı iş miline alma için Kesme işlemi gerekli' });

  let cutRpm = 1000;
  if (cut) {
    const t = findTool(project.tools, cut.toolId);
    if (t) cutRpm = Math.max(50, Math.min(project.machine.mainSpindle.maxRpm, project.machine.subSpindle.maxRpm, Math.round(cut.params.rpm || rpmFromVc(t.vc, project.stock.barDia))));
    cut.params._syncRpm = cutRpm;
  }
  if (pick) ctx.grip = Math.min(pick.params.grip, ctx.L - 1);
  if (cut) ctx.backStock = Math.max(0, +cut.params.backStock || 0);
  // bekleme kodları programdaki sırayla dağıtılır: ara bağlamalar (her biri 3), sonra parça alma (3)
  let wn = 1;
  const mids = ops.filter(o => o.type === 'midRechuck');
  const midW = new Map();
  let ext = 0;
  for (const m of mids) { midW.set(m.id, { a: wn++, b: wn++, c: wn++, ext }); ext -= m.params.shift; }
  const W = { w1: wn++, w2: wn++, w3: wn++ };
  // Z1 stroku: parça + kesme, ara bağlama kaydırmalarıyla birlikte strok içinde kalmalı
  const zNeed = ctx.L + ctx.backStock + ctx.cutW + ext;   // ext ≤ 0
  if (zNeed > project.machine.axes.Z1.max) errors.push({ msg: `Parça (${ctx.L} mm) + kesme Z1 stroku ${project.machine.axes.Z1.max} mm'yi aşıyor: ${mids.length ? 'ara bağlama geri çekmelerini artırın' : '"Ara Bağlama" işlemi ekleyin'} (gereken ${r3(zNeed - project.machine.axes.Z1.max)} mm daha)` });

  const runSub = (op, extra) => {
    const mark = p2.items.length;
    try { p2.opStart(op); GEN.midRechuckSub(p2, ctx, op, null, extra); p2.opEnd(op); }
    catch (e) { p2.items.length = mark; errors.push({ op: op.id, msg: e.message }); }
  };
  const run = (prog, op, extra) => {
    const def = OP_TYPES[op.type];
    let tool = null;
    if (def.tools.length) {
      tool = findTool(project.tools, op.toolId);
      if (!tool) { errors.push({ op: op.id, msg: `${op.name}: takım seçilmedi` }); return; }
      if (!def.tools.includes(tool.type)) { errors.push({ op: op.id, msg: `${op.name}: ${tool.name} bu işleme uygun değil` }); return; }
      if (tool.channel !== def.channel) { errors.push({ op: op.id, msg: `${op.name}: ${tool.name} ${def.channel}. kanalda değil` }); return; }
    }
    const mark = prog.items.length;
    try {
      prog.opStart(op);
      GEN[op.type](prog, ctx, op, tool, extra);
      prog.opEnd(op);
    } catch (e) {
      prog.items.length = mark;
      errors.push({ op: op.id, msg: e.message });
    }
  };

  // ---- $1 ----
  ctx.extZ = 0;
  if (mids.length) p1.workShift(0);   // yarıda kalmış çevrimden kalan kaydırmayı temizle
  const ch1 = ops.filter(o => OP_TYPES[o.type].channel === 1 && o.type !== 'rechuck');
  const seq = segmentSequence(project, ctx, ch1, warnings);
  for (const { op, extra } of seq) {
    if (op.type === 'cutoff') {
      if (seq[seq.length - 1].op !== op) warnings.push({ op: op.id, msg: 'Kesmeden sonra gelen ön işlemler kesmeden önce yapılacak şekilde sıralanmalı' });
      run(p1, op, pick ? { pick: true, ...W } : null);
    } else if (op.type === 'midRechuck') run(p1, op, midW.get(op.id));
    else run(p1, op, extra);
  }
  const re = ops.find(o => o.type === 'rechuck');
  if (re) run(p1, re);
  p1.coolant(false);
  p1.spindle({ which: 'main', dir: 'stop' });
  p1.rapid({ X: ctx.safeX });
  p1.m('programEnd');

  // ---- $2 ----
  for (const m of mids) runSub(m, midW.get(m.id));
  if (pick) run(p2, pick, { ...W, rpm: cutRpm });
  for (const op of ops.filter(o => OP_TYPES[o.type].channel === 2 && o.type !== 'pickoff')) {
    if (!pick) { errors.push({ op: op.id, msg: `${op.name}: önce Karşı İş Miline Al işlemi gerekli` }); continue; }
    run(p2, op);
  }
  if (cut && ctx.backStock > 0 && !ops.some(o => o.type === 'backTurn')) errors.push({ op: cut.id, msg: `Arka alın payı ${ctx.backStock} mm bırakılıyor ama Arka Tornalama işlemi yok` });
  if (pick && !ops.some(o => o.type === 'eject')) warnings.push({ op: pick.id, msg: 'Parça atma işlemi yok: parça karşı iş milinde kalır' });
  p2.spindle({ which: 'sub', dir: 'stop' });
  p2.m('programEnd');

  return { progs: [p1, p2], ctx, errors, warnings, cutRpm };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** İşlemin Z kapsamı (segment ataması için): en büyük Z */
function opZ(op, part) {
  const f = part.features.find(x => x.id === op.params.featureId);
  switch (op.type) {
    case 'groove': return op.params.z1 ?? null;
    case 'midRechuck': return null;
    default:
      if (!f) return null;
      if (f.type === 'crossHole' || f.type === 'pocket' || f.type === 'engrave') return f.z + (f.dia || f.height || 0) / 2;
      if (f.z1 != null) return Math.max(f.z0 ?? 0, f.z1);
      return null;
  }
}

/** Kılavuz burç segmentasyonu (ESPRIT "program segmentation"): stock.segment > 0 ise kaba/ince tornalama
 *  segment segment yapılır ve Z'li işlemler (kanal, diş, çapraz…) kendi segmentinin hemen ardından gelir.
 *  Böylece bitmiş ince bölüm burçtan desteksiz uzamaz. Ara bağlamalar atZ'den sonraki ilk segmentten önce. */
function segmentSequence(project, ctx, ch1, warnings) {
  const S = +project.stock.segment || 0;
  if (!(S > 0)) return ch1.map(op => ({ op }));
  const zEnd = ctx.zEnd;
  const n = Math.max(1, Math.ceil((zEnd - 1e-6) / S));
  const bounds = [];
  for (let k = 0; k < n; k++) bounds.push([k === 0 ? null : r3(k * S), k === n - 1 ? null : r3((k + 1) * S)]);
  const pre = [], tail = [], mids = [], turn = [], zops = [];
  for (const op of ch1) {
    if (op.type === 'rough' || op.type === 'finish') turn.push(op);
    else if (op.type === 'cutoff') tail.push(op);
    else if (op.type === 'midRechuck') mids.push(op);
    else if (opZ(op, project.part) != null) zops.push(op);
    else pre.push(op);
  }
  const seq = pre.map(op => ({ op }));
  const placed = new Set();
  bounds.forEach(([z0, z1], k) => {
    const zs = z0 ?? 0;
    for (const m of mids) if (!placed.has(m) && m.params.atZ <= zs + 1e-6 && k > 0) { seq.push({ op: m }); placed.add(m); }
    for (const op of turn) seq.push({ op, extra: { zFrom: z0, zTo: z1, seg: k + 1 } });
    const zHi = z1 ?? Infinity;
    for (const op of zops) if (!placed.has(op) && opZ(op, project.part) <= zHi + 1e-6) { seq.push({ op }); placed.add(op); }
  });
  for (const op of zops) if (!placed.has(op)) seq.push({ op });
  for (const m of mids) if (!placed.has(m)) { seq.push({ op: m }); warnings.push({ op: m.id, msg: `${m.name}: segment sınırına denk gelmedi, sona alındı` }); }
  for (const op of tail) seq.push({ op });
  return seq;
}
