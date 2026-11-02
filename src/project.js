// Proje: makine + post + stok + parça + takımlar + işlemler. JSON kaydet/aç.
import machineDef from './machine/sb20r-g.json';
import postDef from './post/postProfile.json';
import { defaultTools, STATIONS } from './tools/toolLibrary.js';
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
    layout: 2,              // takım yerleşimi: makine çizimi (STATIONS)
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
    ops.push(makeOp('center', p.tools.find(t => t.unit === 'front' && t.type === 'center')?.id ?? null, { featureId: h.id }, 'Punta Ø' + h.dia));
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
    ops.push(makeOp('flatMill', fit?.id ?? null, { featureId: fl.id }, 'Düzlük C' + fl.c));
  }
  for (const pk of f.filter(x => x.type === 'pocket')) {
    // cep çapından küçük en büyük parmak freze (helis için takım < cep)
    const fit = p.tools.filter(t => t.unit === 'cross' && t.type === 'endmill' && t.dia < pk.dia - 1e-6).sort((a, b) => b.dia - a.dia)[0];
    ops.push(makeOp('pocketMill', fit?.id ?? null, { featureId: pk.id }, 'Cep Ø' + pk.dia));
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
    sim = simulateText(project, posted.text);
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

/** NC metnini projenin makinesi/takımlarıyla yorumlar (CAM çıktısı veya elle yazılmış kod) */
export function simulateText(project, text) {
  const pick = project.ops.find(o => o.type === 'pickoff' && o.enabled);
  const cutOp = project.ops.find(o => o.type === 'cutoff' && o.enabled);
  const grip = pick ? Math.round(pickGrip(pick.params.grip, project.part.length, Math.max(0, +cutOp?.params.backStock || 0), project.machine) * 1000) / 1000 : 5;
  const frames = makeFrames({ L: project.part.length, grip, zShift: project.zero?.zShift || 0 });
  const sim = interpret(text, { profile: project.post, machine: project.machine, tools: project.tools, frames });
  sim.frames = frames;
  return sim;
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
  if ((p.layout || 1) < 2) migrateLayout(p);
  fitStations(p);
  return p;
}

/** Eski takım yerleşimi (yerleşim 1) → makine çizimi yerleşimi (STATIONS). T numaraları korunur, yalnız montaj
 *  konumları istasyonlara taşınır; tahmini X1/X2 strokları yeni yerleşimin gerektirdiği değerlere güncellenir. */
export function migrateLayout(p) {
  const by = (u) => p.tools.filter(t => t.unit === u).sort((a, b) => a.num - b.num || (a.offset ?? a.num) - (b.offset ?? b.num));
  by('cross').forEach((t, i) => { t.yPos = STATIONS.cross[i] ?? STATIONS.cross.at(-1) - 30 * (i - STATIONS.cross.length + 1); t.xPos = 0; });
  const F = STATIONS.front;
  by('front').forEach((t, i) => { const k = i % F.xPos.length, c = Math.floor(i / F.xPos.length); t.yPos = F.yPos - 30 * c; t.xPos = F.xPos[k]; });
  const back = [...by('back'), ...by('rear')];
  back.forEach((t, i) => { t.yPos = STATIONS.back[i] ?? STATIONS.back.at(-1) + 30 * (i - STATIONS.back.length + 1); });
  for (const k of ['X1', 'X2']) {
    const a = p.machine.axes[k], d = machineDef.axes[k];
    if (a?.estimated) { a.min = d.min; a.max = d.max; }
  }
  p.layout = 2;
  return p;
}

/** Takımları makinenin gerçek istasyonlarına oturt (gang 6, çapraz 4, T35 3 kat, arka 4). İstasyon dışındaki takım
 *  boş istasyona taşınır; yer kalmazsa programda kullanılmayan takım taretten çıkarılır. Kullanılan ama sığmayan
 *  takım silinmez (p._overflow listesine yazılır). Döner: çıkarılan takım adları. */
export function fitStations(p) {
  const used = new Set(p.ops.map(o => o.toolId));
  const removed = [], overflow = [];
  const fit = (units, slots, keyOf, put) => {
    const ts = p.tools.filter(t => units.includes(t.unit)).sort((a, b) => (used.has(b.id) - used.has(a.id)) || a.num - b.num || (a.offset ?? a.num) - (b.offset ?? b.num));
    // önce kullanılan takımlar istasyon alır (kendi istasyonu geçerliyse korunur), sonra kullanılmayanlar
    const taken = new Set();
    const order = [...ts.filter(t => used.has(t.id)), ...ts.filter(t => !used.has(t.id))];
    const rest = [];
    for (const t of order) { const k = keyOf(t); if (k >= 0 && !taken.has(k)) taken.add(k); else rest.push(t); }
    // kendi istasyonunu kaybeden kullanılmayan takımlar, sırada kullanılan takım varsa yer açmak için en sona
    for (const t of rest) {
      const k = slots.findIndex((_, i) => !taken.has(i));
      if (k >= 0) { taken.add(k); put(t, k); continue; }
      if (used.has(t.id)) {
        // istasyonu tutan kullanılmayan takımı sök
        const v = ts.find(x => !used.has(x.id) && p.tools.includes(x) && keyOf(x) >= 0 && !rest.includes(x));
        if (v) { const kv = keyOf(v); removed.push(v.name); p.tools = p.tools.filter(x => x !== v); put(t, kv); continue; }
        overflow.push(t.name);
      } else { removed.push(t.name); p.tools = p.tools.filter(x => x !== t); }
    }
  };
  const near = (list, y, tol) => list.findIndex(q => Math.abs(q - y) < tol);
  fit(['gang'], STATIONS.gang, t => near(STATIONS.gang, t.yPos, 1), (t, k) => { t.yPos = STATIONS.gang[k]; });
  fit(['cross'], STATIONS.cross, t => near(STATIONS.cross, t.yPos, 1), (t, k) => { t.yPos = STATIONS.cross[k]; t.xPos = 0; });
  fit(['back', 'rear'], STATIONS.back, t => near(STATIONS.back, t.yPos, 1), (t, k) => { t.yPos = STATIONS.back[k]; });
  const F = STATIONS.front;
  fit(['front'], F.xPos, t => { const k = (t.offset ?? 0) - 1; return t.num === 35 && Math.abs(t.yPos - F.yPos) < 1 && k < F.xPos.length ? k : -1; },
    (t, k) => { t.num = 35; t.offset = k + 1; t.yPos = F.yPos; t.xPos = F.xPos[k]; });
  if (overflow.length) p._overflow = overflow; else delete p._overflow;
  return removed;
}
