import { makeOp } from './program.js';
import { buildContext } from './context.js';
import { backAxialLimit, backMaxDepth, pickGrip } from './generators.js';

export function planBack(project, mode) {
  const { ops, tools, part, machine } = project;
  const active = type => ops.find(op => op.type === type && op.enabled);
  const cut = active('cutoff'), pick = active('pickoff');
  const eject = ops.findIndex(op => op.type === 'eject');
  const plan = { ops: [], warnings: [], index: eject < 0 ? ops.length : eject };
  const warn = message => plan.warnings.push(message);
  if (!cut || !pick) {
    warn('Önce Kesme ve Senkron alma işlemlerini etkinleştirin.');
    return plan;
  }

  const ctx = buildContext(project);
  ctx.backStock = Math.max(0, +cut.params.backStock || 0);
  ctx.grip = pickGrip(pick.params.grip, ctx.L, ctx.backStock, machine);
  if (ctx.grip < 2 || backMaxDepth(ctx) < 0.3) {
    warn('Mevcut tutma boyuyla arka işleme alanı yetersiz.');
    return plan;
  }

  const rear = tools.filter(t => t.channel === 2 && (t.unit === 'back' || t.unit === 'rear'));
  if (mode === 'finish') {
    if (ops.some(op => op.type === 'backTurn')) {
      warn('Arka tornalama işlem listesinde mevcut.');
    } else if (!(ctx.backStock > 0)) {
      warn('Otomatik arka alın finişi için Kesme işleminde arka alın payı tanımlayın.');
    } else {
      const tool = rear.find(t => t.type === 'turn' && t.unit === 'back');
      if (tool) plan.ops.push(makeOp('backTurn', tool.id, { face: true, faceOnly: true }, 'Karşı mil · Arka alın finişi'));
      else warn('Takımlar penceresinden karşı mile uygun bir tornalama takımı takın.');
    }
    return plan;
  }

  const used = new Set(ops.filter(op => op.enabled).map(op => op.toolId));
  for (const f of part.features) {
    if (f.type !== 'axialHole' || f.side !== 'back') continue;
    if (ops.some(op => op.type === 'backDrill' && op.params.featureId === f.id)) continue;
    if (f.flat && !f.through) {
      warn('Düz dipli arka delik için uygun dip işleme stratejisini manuel seçin.');
      continue;
    }
    const capacity = machine.liveTools?.back?.maxDrillStatic;
    const tool = Number.isFinite(capacity) && f.dia <= capacity && rear
      .filter(t => t.type === 'drill' && !t.live && Math.abs(t.dia - f.dia) < 1e-6)
      .filter(t => {
        const tip = (t.dia / 2) / Math.tan((t.tipAngle || 118) * Math.PI / 360);
        return f.depth > 0 && f.depth + tip + (f.through ? 0.5 : 0) <= backAxialLimit(ctx, t);
      })
      .sort((a, b) => Number(used.has(b.id)) - Number(used.has(a.id)))[0];
    if (!tool) {
      warn(`Arka Ø${f.dia}: çap, erişim ve bağlamaya uygun takılı matkap bulunamadı.`);
      continue;
    }
    used.add(tool.id);
    plan.ops.push(makeOp('backDrill', tool.id, { featureId: f.id }, `Karşı mil · Arka delme Ø${f.dia}`));
  }

  if (part.features.some(f => f.side === 'back' && /^(faceSlot|facePolygon)$/.test(f.type))) {
    warn('Arka frezeleme için takım, kontrol modu ve bağlamayı doğrulayıp işlemi manuel ekleyin.');
  }
  return plan;
}
