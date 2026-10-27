// Proje: makine + post + stok + parça + takımlar + işlemler. JSON kaydet/aç.
import machineDef from './machine/sb20r-g.json';
import postDef from './post/postProfile.json';
import { defaultTools } from './tools/toolLibrary.js';
import { examplePart, suggestBar } from './part/part.js';
import { makeOp, buildProgram } from './ops/program.js';
import { buildContext } from './ops/context.js';
import { findGrooves, pickGrip } from './ops/generators.js';
import { postProcess } from './post/fanucStar.js';
import { interpret } from './sim/interpreter.js';
import { makeFrames } from './sim/frames.js';

export const clone = (o) => JSON.parse(JSON.stringify(o));

export function newProject(part = examplePart()) {
  const p = {
    version: 1,
    name: part.name,
    machine: clone(machineDef),
    post: clone(postDef),
    stock: { barDia: suggestBar(part.maxDia) || 20, faceStock: 0.3, maxRpm: 8000 },
    zero: { zShift: 0, label: 'Ön alın merkezi' },
    part,
    tools: defaultTools(),
    ops: [],
  };
  p.ops = autoOperations(p);
  return p;
}

const tt = (p, num) => p.tools.find(t => t.num === num)?.id ?? null;

/** Özelliklerden otomatik işlem planı (ESPRIT "feature-based" mantığı) */
export function autoOperations(p) {
  const ops = [];
  const f = p.part.features;
  ops.push(makeOp('face', tt(p, 1)));
  ops.push(makeOp('rough', tt(p, 1)));
  ops.push(makeOp('finish', tt(p, 2)));
  const gTool = p.tools.find(t => t.num === 3);
  for (const g of findGrooves(buildContext(p), p.tools.find(t => t.num === 2))) {
    ops.push(makeOp('groove', gTool?.id ?? null, { z0: g.z0, z1: g.z1 }, `Kanal Z${g.z0}-${g.z1}`));
  }
  for (const h of f.filter(x => x.type === 'axialHole' && x.side === 'front')) {
    ops.push(makeOp('center', tt(p, 21), { featureId: h.id }, 'Punta Ø' + h.dia));
    const d = p.tools.find(t => t.unit === 'front' && t.type === 'drill' && Math.abs(t.dia - h.dia) < 1e-6);
    ops.push(makeOp('drill', d?.id ?? null, { featureId: h.id }, 'Delme Ø' + h.dia));
  }
  for (const th of f.filter(x => x.type === 'thread')) ops.push(makeOp('thread', tt(p, 4), { featureId: th.id }, `Diş M${th.dia}x${th.pitch}`));
  for (const c of f.filter(x => x.type === 'crossHole')) {
    const d = p.tools.find(t => t.unit === 'cross' && t.type === 'ldrill' && Math.abs(t.dia - c.dia) < 1e-6);
    ops.push(makeOp('crossDrill', d?.id ?? null, { featureId: c.id }, `Çapraz Delik Ø${c.dia}`));
  }
  for (const fl of f.filter(x => x.type === 'flat')) {
    // düzlük boyuna sığan en büyük parmak freze (yoksa T12)
    const fit = p.tools.filter(t => t.unit === 'cross' && t.type === 'endmill' && t.dia <= Math.abs(fl.z1 - fl.z0) + 1e-6).sort((a, b) => b.dia - a.dia)[0];
    ops.push(makeOp('flatMill', fit?.id ?? tt(p, 12), { featureId: fl.id }, 'Düzlük C' + fl.c));
  }
  for (const pk of f.filter(x => x.type === 'pocket')) {
    // cep çapından küçük en büyük parmak freze (helis için takım < cep)
    const fit = p.tools.filter(t => t.unit === 'cross' && t.type === 'endmill' && t.dia < pk.dia - 1e-6).sort((a, b) => b.dia - a.dia)[0];
    ops.push(makeOp('pocketMill', fit?.id ?? tt(p, 13), { featureId: pk.id }, 'Cep Ø' + pk.dia));
  }
  const crossMill = (dia) => p.tools.find(t => t.unit === 'cross' && t.type === 'endmill' && (dia == null || Math.abs(t.dia - dia) < 1e-6));
  for (const pg of f.filter(x => x.type === 'polygon')) ops.push(makeOp('polygonMill', (crossMill(6) || crossMill())?.id ?? null, { featureId: pg.id }, `Çokgen ${pg.n}×AA${pg.af}`));
  for (const sl of f.filter(x => x.type === 'odSlot')) ops.push(makeOp('cylSlot', crossMill(sl.width)?.id ?? null, { featureId: sl.id }, `Çap Kanalı ${sl.width} (G7.1)`));
  const smallest = p.tools.filter(t => t.unit === 'cross' && t.type === 'endmill').sort((a, b) => a.dia - b.dia)[0];
  for (const e of f.filter(x => x.type === 'engrave')) ops.push(makeOp('engrave', smallest?.id ?? null, { featureId: e.id }, `Yazı "${e.text}"`));
  const back = f.filter(x => x.type === 'axialHole' && x.side === 'back');
  const backMill = f.filter(x => (x.type === 'faceSlot' || x.type === 'facePolygon') && x.side === 'back');
  const needSub = back.length || backMill.length;
  if (needSub) ops.push(makeOp('pickoff'));
  ops.push(makeOp('cutoff', tt(p, 5)));
  const backEnd = (dia) => p.tools.find(t => t.unit === 'back' && t.live && t.type === 'endmill' && (dia == null || Math.abs(t.dia - dia) < 1e-6));
  for (const sl of backMill.filter(x => x.type === 'faceSlot')) ops.push(makeOp('backSlot', backEnd(sl.width)?.id ?? null, { featureId: sl.id }, `Arka Alın Kanalı ${sl.width}`));
  for (const pg of backMill.filter(x => x.type === 'facePolygon')) ops.push(makeOp('backPolar', backEnd()?.id ?? null, { featureId: pg.id }, `Arka Çokgen ${pg.n}×AA${pg.af} (G12.1)`));
  for (const h of back) {
    const d = p.tools.find(t => (t.unit === 'back' || t.unit === 'rear') && t.type === 'drill' && Math.abs(t.dia - h.dia) < 1e-6);
    ops.push(makeOp('backDrill', d?.id ?? null, { featureId: h.id }, 'Arka Delme Ø' + h.dia));
  }
  if (needSub) ops.push(makeOp('eject'));
  ops.push(makeOp('rechuck'));
  return ops;
}

/** Tam boru hattı: işlemler → IR → G-kod → yorumla (simülasyon/doğrulama girdisi) */
export function runPipeline(project) {
  const built = buildProgram(project);
  let posted = null, sim = null;
  const errors = built.errors.map(e => ({ ...e, src: 'cam' }));
  const warnings = built.warnings.map(e => ({ ...e, src: 'cam' }));
  try {
    posted = postProcess(built.progs, project.post, {
      partName: project.part.name, date: new Date().toISOString().slice(0, 10),
      stock: `CUBUK D${project.stock.barDia} BOY ${project.part.length.toFixed(2)}`,
      zShift: project.zero?.zShift || 0,
    });
  } catch (e) {
    errors.push({ src: 'post', msg: e.message });
  }
  if (posted) {
    const pick = project.ops.find(o => o.type === 'pickoff' && o.enabled);
    const cutOp = project.ops.find(o => o.type === 'cutoff' && o.enabled);
    const grip = pick ? Math.round(pickGrip(pick.params.grip, project.part.length, Math.max(0, +cutOp?.params.backStock || 0), project.machine) * 1000) / 1000 : 5;
    const frames = makeFrames({ L: project.part.length, grip, zShift: project.zero?.zShift || 0 });
    sim = interpret(posted.text, { profile: project.post, machine: project.machine, tools: project.tools, frames });
    sim.frames = frames;
    for (const e of sim.errors) errors.push({ ...e, src: 'nc' });
    // öz-kontrol: CAM'in amaçladığı konum = makinenin yorumlanan konumu
    posted.checks.forEach((list, pi) => {
      const moves = sim.paths[pi]?.moves || [];
      const byLine = new Map();
      for (const m of moves) if (m.kind === 'rapid' || m.kind === 'feed' || m.kind === 'arc') byLine.set(m.line, m);
      for (const c of list) {
        const m = byLine.get(c.line);
        if (!m) continue;
        for (const [a, v] of Object.entries(c.pos)) {
          if (Math.abs((m.to[a] ?? 0) - v) > 0.0011) {
            errors.push({ path: pi + 1, line: c.line, src: 'nc', msg: `Post tutarsızlığı: ${a} amaçlanan ${v.toFixed(3)}, makinede ${(+m.to[a]).toFixed(3)}` });
            break;
          }
        }
      }
    });
    for (const w of sim.warnings) warnings.push({ ...w, src: 'nc' });
  }
  return { built, posted, sim, errors, warnings };
}

export function saveProject(p) {
  const { part, ...rest } = p;
  const lightPart = { ...part, mesh: null }; // ağ STEP'ten (stepB64) yeniden üretilir
  return JSON.stringify({ ...rest, part: lightPart }, null, 1);
}
export function loadProject(text) {
  const p = JSON.parse(text);
  if (!p.version || !p.part || !p.tools || !p.ops) throw new Error('Geçersiz proje dosyası');
  return migrate(p);
}

/** Eski proje dosyaları: yeni eklenen post/makine anahtarlarını varsayılanlarla tamamla (kullanıcı değerleri korunur) */
export function migrate(p) {
  const deep = (def, cur) => {
    if (cur == null) return clone(def);
    if (typeof def !== 'object' || Array.isArray(def)) return cur;
    const out = { ...cur };
    for (const [k, v] of Object.entries(def)) out[k] = k in cur ? deep(v, cur[k]) : clone(v);
    return out;
  };
  p.post = deep(postDef, p.post);
  p.machine = deep(machineDef, p.machine);
  for (const t of p.tools) if (t.xPos == null) t.xPos = 0;
  return p;
}
