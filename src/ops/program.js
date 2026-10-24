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
  const W = { w1: 1, w2: 2, w3: 3 };
  if (pick) ctx.grip = Math.min(pick.params.grip, ctx.L - 1);
  if (cut) ctx.backStock = Math.max(0, +cut.params.backStock || 0);

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
  const ch1 = ops.filter(o => OP_TYPES[o.type].channel === 1 && o.type !== 'rechuck');
  for (const op of ch1) {
    if (op.type === 'cutoff') {
      const pre = ch1.indexOf(op);
      if (pre !== ch1.length - 1) warnings.push({ op: op.id, msg: 'Kesmeden sonra gelen ön işlemler kesmeden önce yapılacak şekilde sıralanmalı' });
      run(p1, op, pick ? { pick: true, ...W } : null);
    } else run(p1, op);
  }
  const re = ops.find(o => o.type === 'rechuck');
  if (re) run(p1, re);
  p1.coolant(false);
  p1.spindle({ which: 'main', dir: 'stop' });
  p1.rapid({ X: ctx.safeX });
  p1.m('programEnd');

  // ---- $2 ----
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
