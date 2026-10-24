// İşlem üreteçleri: her işlem kanal programına (Prog) IR ekler.
import { dilate, noseTipPath, toPolyline, sampleProfile, turnableEnvelope } from '../geom/sampled.js';
import { fitSegments } from '../geom/fit.js';
import { rpmFromVc, threadDepth, round3 } from '../tools/cuttingData.js';
import { rotaryProfile } from '../tools/toolGeom.js';
import { SUB_NUT } from '../sim/bodies.js';

const r3 = round3;

export const OP_TYPES = {
  face:       { label: 'Alın Tornalama', channel: 1, tools: ['turn'] },
  rough:      { label: 'Kaba Tornalama', channel: 1, tools: ['turn'] },
  finish:     { label: 'İnce Tornalama', channel: 1, tools: ['turn'] },
  groove:     { label: 'Kanal Açma', channel: 1, tools: ['groove', 'cutoff'] },
  thread:     { label: 'Diş Çekme', channel: 1, tools: ['thread'] },
  center:     { label: 'Punta (Ön)', channel: 1, tools: ['center'] },
  drill:      { label: 'Eksenel Delme (Ön)', channel: 1, tools: ['drill'] },
  tap:        { label: 'Kılavuz (Ön)', channel: 1, tools: ['tap'] },
  crossDrill: { label: 'Çapraz Delme', channel: 1, tools: ['ldrill', 'endmill'] },
  flatMill:   { label: 'Düzlük Frezeleme', channel: 1, tools: ['endmill'] },
  pocketMill: { label: 'Helikal Cep (G19)', channel: 1, tools: ['endmill'] },
  pickoff:    { label: 'Karşı İş Miline Al', channel: 2, tools: [] },
  cutoff:     { label: 'Kesme', channel: 1, tools: ['cutoff'] },
  backDrill:  { label: 'Arka Delme', channel: 2, tools: ['drill', 'center'] },
  backTap:    { label: 'Arka Kılavuz', channel: 2, tools: ['tap'] },
  eject:      { label: 'Parça Atma', channel: 2, tools: [] },
  rechuck:    { label: 'Çubuk İlerletme', channel: 1, tools: [] },
  polygonMill:{ label: 'Çokgen Frezeleme (C/Y)', channel: 1, tools: ['endmill'] },
  cylSlot:    { label: 'Silindirik Kanal (G7.1)', channel: 1, tools: ['endmill'] },
  backTurn:   { label: 'Arka Tornalama', channel: 2, tools: ['turn'] },
  backSlot:   { label: 'Arka Alın Kanalı (C2)', channel: 2, tools: ['endmill'] },
  backPolar:  { label: 'Arka Alın Konturu (G12.1)', channel: 2, tools: ['endmill'] },
};

export function defaultParams(type) {
  switch (type) {
    case 'face': return { ap: 0.15, feed: null, vc: null };
    case 'rough': return { ap: 1.0, allowX: 0.15, allowZ: 0.05, retract: 0.3, feed: null, vc: null, contourPass: true };
    case 'finish': return { feed: null, vc: null, tol: 0.002 };
    case 'groove': return { z0: null, z1: null, allow: 0.05, peck: 0, feed: null, vc: null };
    case 'thread': return { featureId: null, firstDepth: 0.15, springPasses: 1, rpm: null };
    case 'center': return { featureId: null, spotDia: null };
    case 'drill': return { featureId: null, peck: null, feed: null };
    case 'tap': return { featureId: null };
    case 'crossDrill': return { featureId: null, peck: null };
    case 'flatMill': return { featureId: null, ap: 1.0, stepover: 0.6 };
    case 'pocketMill': return { featureId: null, stepDown: 0.5, stepOver: 0.5 };
    case 'pickoff': return { grip: 6, feed: 500 };
    case 'cutoff': return { feed: null, rpm: null, endX: -0.4, backStock: 0 };
    case 'backDrill': return { featureId: null, peck: null, feed: null };
    case 'backTap': return { featureId: null };
    case 'eject': return {};
    case 'rechuck': return {};
    case 'polygonMill': return { featureId: null, ap: 1.0, stepover: 0.6 };
    case 'cylSlot': return { featureId: null, stepDown: 0.5 };
    case 'backTurn': return { face: true, ap: 0.5, allowX: 0.1, allowZ: 0.05, feed: null, vc: null, roughFeed: null };
    case 'backSlot': return { featureId: null, stepDown: 0.5 };
    case 'backPolar': return { featureId: null, stepDown: 0.5, stepOver: 0.6 };
    default: return {};
  }
}

// ---------- yardımcılar ----------
function featureOf(ctx, op, type) {
  const f = ctx.part.features.find(x => x.id === op.params.featureId) || null;
  if (!f) throw new Error(`${op.name}: geometri (özellik) seçilmedi`);
  if (type && f.type !== type) throw new Error(`${op.name}: seçilen özellik tipi uygun değil (${f.type})`);
  return f;
}

function lim(ctx, rpm, which) {
  const m = ctx.machine;
  const max = which === 'sub' ? m.subSpindle.maxRpm : which === 'live' ? m.liveTools.cross.maxRpm : which === 'backLive' ? m.liveTools.back.maxRpm : m.mainSpindle.maxRpm;
  return Math.max(50, Math.min(max, Math.round(rpm)));
}

function startTurning(prog, ctx, tool, op, opts = {}) {
  prog.rapid({ X: ctx.safeX });
  prog.tool(tool);
  prog.feedMode('rev');
  const vc = op.params.vc || tool.vc;
  const maxRpm = Math.min(ctx.machine.mainSpindle.maxRpm, ctx.project.stock.maxRpm || Infinity);
  if (opts.constRpm) prog.spindle({ which: 'main', dir: 'cw', rpm: lim(ctx, opts.constRpm, 'main') });
  else prog.spindle({ which: 'main', dir: 'cw', css: vc, maxRpm: Math.round(maxRpm) });
  prog.coolant(true);
}

/** Güvenli yaklaşma: önce güvenli X, sonra Y/Z, en son X (çapraz hareketle çarpışma yok) */
export function goto(prog, ctx, X, Z, Y = 0) {
  prog.rapid({ X: ctx.safeX });
  prog.rapid(prog.channel === 1 ? { Y, Z } : { Z });
  prog.rapid({ X });
}

function endTool(prog, ctx) {
  prog.rapid({ X: ctx.safeX });
}

function emitSegments(prog, segs, F, ctx) {
  // segment noktaları r (yarıçap) → X (çap)
  let first = true;
  for (const s of segs) {
    const pos = { X: r3(2 * s.b.r), Z: r3(s.b.z) };
    if (s.type === 'line') prog.line(pos, first ? F : undefined);
    else prog.arc(s.cw, pos, { I: r3(s.center.r - s.a.r), K: r3(s.center.z - s.a.z) }, first ? F : undefined);
    first = false;
  }
}

function tipLen(tool) {
  const a = (tool.tipAngle || 118) * Math.PI / 180;
  return (tool.dia / 2) / Math.tan(a / 2);
}

// ---------- işlemler ----------
const GEN = {};

GEN.face = (prog, ctx, op, tool) => {
  const p = op.params;
  const fs = ctx.stock.faceStock;
  const rn = tool.noseR;
  startTurning(prog, ctx, tool, op);
  const F = p.feed || tool.feed;
  const n = Math.max(1, Math.ceil(fs / p.ap - 1e-9));
  const xStart = ctx.stock.barDia + 1;
  for (let k = 1; k <= n; k++) {
    const z = r3(-fs + (fs * k) / n);
    if (k === 1) goto(prog, ctx, xStart, z);   // önce güvenli X (önceki takım ön kovan olabilir), sonra Y/Z
    else prog.rapid({ Z: z });
    prog.line({ X: r3(-2 * rn - 0.1) }, F);
    prog.rapid({ Z: r3(z - 0.5) });
    prog.rapid({ X: xStart });
  }
  endTool(prog, ctx);
};

GEN.rough = (prog, ctx, op, tool) => {
  const p = op.params;
  const env = ctx.envelopeFor(tool);
  const A = dilate(env, p.allowZ, p.allowX / 2);
  const P = noseTipPath(A, tool.noseR);
  const R0 = ctx.barR;
  startTurning(prog, ctx, tool, op);
  const F = p.feed || tool.feed;
  const iEnd = P.idx(ctx.zEnd);
  if (!roughLevels(prog, ctx, P, R0, -0.5, ctx.zEnd, p, F)) { prog.comment('KABA: KALDIRILACAK MALZEME YOK'); return; }
  if (p.contourPass) {
    // yarı finiş kontur pasosu: pay bırakılmış profil boyunca
    const pts = toPolyline(P, P.idx(-0.3), iEnd).map(q => ({ z: q.z, r: Math.min(q.r, R0 + 0.0) }));
    const segs = fitSegments(pts, 0.003);
    goto(prog, ctx, r3(2 * Math.max(0, pts[0].r)), r3(pts[0].z));
    emitSegments(prog, segs, F, ctx);
    prog.rapid({ X: ctx.safeX });
  }
  endTool(prog, ctx);
};

/** Z'ye paralel kaba pasolar: R0 yarıçaplı stoktan P (uç yolu) profiline kadar. Ön ve arka (G55) tornalamada ortak. */
export function roughLevels(prog, ctx, P, R0, zFrom, zTo, p, F) {
  const iStart = P.idx(zFrom), iEnd = P.idx(zTo);
  let minP = Infinity;
  for (let i = iStart; i <= iEnd; i++) minP = Math.min(minP, P.r[i]);
  if (minP >= R0 - 1e-6) return false;
  const lvls = [];
  for (let k = 1; R0 - k * p.ap > minP + 1e-6; k++) lvls.push(r3(R0 - k * p.ap));
  lvls.push(r3(minP + 1e-4));
  let prevLevel = R0;
  for (const lv of lvls) {
    // seviyenin altında kalan aralıklar: P(z) < lv
    let i = iStart;
    while (i <= iEnd) {
      while (i <= iEnd && P.r[i] >= lv - 1e-9) i++;
      if (i > iEnd) break;
      const a = i;
      while (i <= iEnd && P.r[i] < lv - 1e-9) i++;
      const b = i - 1;
      const za = P.zAt(a), zb = P.zAt(b);
      if (zb - za < 0.05) continue;
      const xLv = r3(2 * lv), xUp = r3(2 * (R0 + 0.5));
      if (a === iStart) {
        goto(prog, ctx, r3(Math.min(xUp, 2 * (prevLevel + p.retract))), r3(za));
        prog.line({ X: xLv }, F);
      } else {
        goto(prog, ctx, xUp, r3(za));
        prog.line({ X: xLv }, F); // dalış (profil eğimi takım arka açısı içinde)
      }
      prog.line({ Z: r3(zb) }, F);
      prog.line({ X: r3(xLv + 2 * p.retract), Z: r3(zb - p.retract) }, F);
      prog.rapid({ X: xUp });
    }
    prevLevel = lv;
  }
  return true;
}

GEN.finish = (prog, ctx, op, tool) => {
  const p = op.params;
  const env = ctx.envelopeFor(tool);
  const P = noseTipPath(env, tool.noseR);
  startTurning(prog, ctx, tool, op);
  const F = p.feed || tool.feed;
  const i0 = P.idx(-0.5), i1 = P.idx(ctx.zEnd);
  const pts = toPolyline(P, i0, i1).map(q => ({ z: q.z, r: Math.min(q.r, ctx.barR) }));
  const segs = fitSegments(pts, p.tol || 0.002);
  goto(prog, ctx, r3(2 * pts[0].r), r3(pts[0].z));
  emitSegments(prog, segs, F, ctx);
  prog.line({ X: r3(ctx.stock.barDia + 0.6) }, F);
  endTool(prog, ctx);
};

/** Kanallar: gerçek profilin, takımın zarfının altına indiği bölgeler */
export function findGrooves(ctx, turnTool) {
  const env = ctx.envelopeFor(turnTool || { insertAngle: 35 });
  const out = [];
  const R = ctx.real;
  let i = R.idx(0);
  const iEnd = R.idx(ctx.L);
  while (i <= iEnd) {
    while (i <= iEnd && R.r[i] >= env.r[i] - 0.01) i++;
    if (i > iEnd) break;
    const a = i;
    while (i <= iEnd && R.r[i] < env.r[i] - 0.01) i++;
    let lo = a, hi = i - 1;
    if (R.zAt(hi) - R.zAt(lo) > 0.05) {
      let minR = Infinity;
      for (let k = lo; k <= hi; k++) minR = Math.min(minR, R.r[k]);
      // kanal tabanı devam ediyorsa (aynı seviyede) bölgeyi genişlet
      while (lo > 0 && R.r[lo - 1] <= minR + 0.001) lo--;
      while (hi < R.n - 1 && R.r[hi + 1] <= minR + 0.001) hi++;
      out.push({ z0: r3(R.zAt(lo)), z1: r3(R.zAt(hi)), minDia: r3(2 * minR) });
      i = Math.max(i, hi + 1);
    }
  }
  return out;
}

GEN.groove = (prog, ctx, op, tool) => {
  const p = op.params;
  const w = tool.width;
  let z0 = p.z0, z1 = p.z1;
  if (z0 == null || z1 == null) {
    const g = findGrooves(ctx)[0];
    if (!g) throw new Error(`${op.name}: kanal bulunamadı (z0/z1 girin)`);
    z0 = g.z0; z1 = g.z1;
  }
  if (z1 - z0 < w - 1e-6) throw new Error(`${op.name}: kanal genişliği (${r3(z1 - z0)}) takım genişliğinden (${w}) küçük`);
  const R = ctx.real;
  const hAt = (Z) => { // takım [Z, Z+w] altındaki en yüksek gerçek profil
    let m = 0;
    for (let i = R.idx(Z), e = R.idx(Z + w); i <= e; i++) m = Math.max(m, R.r[i]);
    return m;
  };
  startTurning(prog, ctx, tool, op);
  const F = p.feed || tool.feed;
  let top = 0;
  for (let i = R.idx(z0 - 1), e = R.idx(z1 + 1); i <= e; i++) top = Math.max(top, R.r[i]);
  const xApp = r3(2 * (Math.max(top, ctx.barR) + 0.3));
  // kaba dalışlar
  const zs = [];
  const span = z1 - w;
  const n = Math.max(1, Math.ceil((span - z0) / (0.8 * w) - 1e-9));
  for (let k = 0; k <= n; k++) zs.push(r3(z0 + ((span - z0) * k) / n));
  let first = true;
  for (const Z of [...new Set(zs)]) {
    const h = hAt(Z) + p.allow;
    if (first) goto(prog, ctx, xApp, Z); else prog.rapid({ Z });
    first = false;
    prog.line({ X: r3(2 * h) }, F);
    prog.rapid({ X: xApp });
  }
  // finiş: tabanı izle
  const pts = [];
  for (let Z = z0; Z <= span + 1e-9; Z += 0.01) pts.push({ z: Z, r: hAt(Z) });
  if (pts[pts.length - 1].z < span - 1e-6) pts.push({ z: span, r: hAt(span) });
  const segs = fitSegments(pts, 0.002, { arcs: false });
  prog.rapid({ Z: r3(z0) });
  prog.line({ X: r3(2 * pts[0].r) }, F);
  emitSegments(prog, segs, F, ctx);
  prog.rapid({ X: xApp });
  endTool(prog, ctx);
};

export function threadPasses(h, first, spring) {
  const N = Math.max(4, Math.ceil((h / first) ** 2));
  const out = [];
  for (let i = 1; i <= N; i++) out.push(r3(h * Math.sqrt(i / N)));
  for (let s = 0; s < spring; s++) out.push(r3(h));
  return out;
}

GEN.thread = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'thread');
  const p = op.params;
  const h = threadDepth(f.pitch);
  const rpm = lim(ctx, p.rpm || rpmFromVc(tool.vc, f.dia), 'main');
  prog.rapid({ X: ctx.safeX });
  prog.tool(tool);
  prog.feedMode('rev');
  prog.spindle({ which: 'main', dir: 'cw', rpm });
  prog.coolant(true);
  const zStart = r3(f.z0 - Math.max(2 * f.pitch, 1.5));
  const xStart = r3(f.dia + 2);
  goto(prog, ctx, xStart, zStart);
  for (const d of threadPasses(h, p.firstDepth, p.springPasses)) {
    prog.thread92({ X: r3(f.dia - 2 * d), Z: r3(f.z1) }, f.pitch);
  }
  prog.rapid({ X: ctx.safeX });
};

function axialDrillCycle(prog, ctx, Zend, peck, F) {
  // açık hareketlerle gagalama (çevrim parametresine bağımlılık yok)
  const zr = -1; // yaklaşma (yüzeyden 1 mm önce)
  if (prog.channel === 1) goto(prog, ctx, 0, zr);
  else { prog.rapid({ Z: -5 }); prog.rapid({ X: 0 }); prog.rapid({ Z: zr }); }
  if (!peck || peck >= Zend) { prog.line({ Z: r3(Zend) }, F); prog.rapid({ Z: zr }); return; }
  let z = 0;
  while (z < Zend - 1e-6) {
    const nz = Math.min(Zend, z + peck);
    if (z > 0) prog.rapid({ Z: r3(z - 0.2) });
    prog.line({ Z: r3(nz) }, F);
    prog.rapid({ Z: zr });
    z = nz;
  }
}

function drillOnSpindle(prog, ctx, op, tool, which) {
  const f = featureOf(ctx, op, 'axialHole');
  const p = op.params;
  if (which === 'sub' && f.depth + tipLen(tool) > backMaxDepth(ctx)) throw new Error(`${op.name}: delik derinliği arka işleme sınırını (${r3(backMaxDepth(ctx))} mm) aşıyor — pens somunu arka takımlara çarpar`);
  if (tool.type !== 'center' && tool.dia > f.dia + 1e-6) throw new Error(`${op.name}: matkap Ø${tool.dia} > delik Ø${f.dia}`);
  const limDrill = which === 'main' ? ctx.machine.stations.frontSleeve.maxDrill : ctx.machine.liveTools.back.maxDrillStatic;
  if (tool.dia > limDrill) throw new Error(`${op.name}: Ø${tool.dia} matkap makine kapasitesini (Ø${limDrill}) aşıyor`);
  const rpm = lim(ctx, rpmFromVc(tool.vc, tool.dia), which);
  prog.tool(tool);
  prog.feedMode('rev');
  prog.spindle({ which, dir: 'cw', rpm });
  prog.coolant(true, which === 'sub');
  let Zend;
  if (tool.type === 'center') {
    if (p.spotDia && p.spotDia > tool.dia - 0.1) throw new Error(`${op.name}: punta pah çapı (Ø${p.spotDia}) takım çapından (Ø${tool.dia}) büyük olamaz`);
    const spot = p.spotDia || Math.min(f.dia + 0.4, tool.dia - 0.2);
    Zend = (spot / 2) / Math.tan(((tool.tipAngle || 90) / 2) * Math.PI / 180);
  } else {
    Zend = f.depth + (f.through ? tipLen(tool) + 0.5 : tipLen(tool));
  }
  const peck = tool.type === 'center' ? 0 : (p.peck || tool.dia * 1.5);
  axialDrillCycle(prog, ctx, r3(Zend), r3(peck), p.feed || tool.feed);
  prog.coolant(false, which === 'sub');
}

/** Ön eksenel takıma geçiş: parça önce takım düzleminin arkasına çekilir (takım gövdesi parçaya değmesin) */
function frontToolSafe(prog, ctx) {
  prog.rapid({ X: ctx.safeX });
  prog.rapid({ Z: -1 });
}
GEN.center = (prog, ctx, op, tool) => { frontToolSafe(prog, ctx); drillOnSpindle(prog, ctx, op, tool, 'main'); };
GEN.drill = (prog, ctx, op, tool) => { frontToolSafe(prog, ctx); drillOnSpindle(prog, ctx, op, tool, 'main'); };

function tapOnSpindle(prog, ctx, op, tool, which) {
  const f = featureOf(ctx, op, 'axialHole');
  const rpm = lim(ctx, Math.min(rpmFromVc(tool.vc, tool.dia), 800), which);
  prog.tool(tool);
  prog.feedMode('rev');
  prog.spindle({ which, dir: 'cw', rpm });
  const zr = r3(-3 * tool.pitch);
  const depth = r3(f.threadDepth || Math.max(0.5, f.depth - 2 * tool.pitch));
  prog.comment('YUZER KILAVUZ: G32 + TERS DONUS');
  if (prog.channel === 1) goto(prog, ctx, 0, zr);
  else { prog.rapid({ Z: -5 }); prog.rapid({ X: 0 }); prog.rapid({ Z: zr }); }
  prog.thread32({ Z: depth }, tool.pitch);
  prog.spindle({ which, dir: 'ccw', rpm });
  prog.thread32({ Z: zr }, tool.pitch);
  prog.spindle({ which, dir: 'stop' });
}
GEN.tap = (prog, ctx, op, tool) => { frontToolSafe(prog, ctx); tapOnSpindle(prog, ctx, op, tool, 'main'); };

function startLive(prog, ctx, tool, cDeg) {
  prog.rapid({ X: ctx.safeX });
  prog.spindle({ which: 'main', dir: 'stop' });
  prog.m('mainCAxisOn');
  prog.tool(tool);
  prog.feedMode('min');
  const { rpm } = liveData(ctx, tool);
  prog.spindle({ which: 'live', dir: 'cw', rpm });
  prog.coolant(true);
  prog.rapid({ C: r3(cDeg) });
}
function endLive(prog, ctx) {
  prog.rapid({ X: ctx.safeX });
  prog.spindle({ which: 'live', dir: 'stop' });
  prog.rapid({ C: 0 });
  prog.m('mainCAxisOff');
}
export function liveData(ctx, tool) {
  const max = ctx.machine.liveTools.cross.maxRpm;
  const rpm = Math.min(max, Math.round(rpmFromVc(tool.vc, tool.dia)));
  const feed = Math.round(Math.max(5, (tool.type === 'ldrill' ? tool.fz * tool.flutes : tool.fz * tool.flutes) * rpm));
  return { rpm, feed };
}

GEN.crossDrill = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'crossHole');
  if (tool.dia > ctx.machine.liveTools.cross.maxDrill + 1e-6) throw new Error(`${op.name}: Ø${tool.dia} çapraz delme kapasitesini aşıyor (Ø${ctx.machine.liveTools.cross.maxDrill})`);
  if (Math.abs(tool.dia - f.dia) > 1e-6) throw new Error(`${op.name}: takım Ø${tool.dia} ≠ delik Ø${f.dia}`);
  const Rloc = Math.max(ctx.rAt(f.z - f.dia / 2), ctx.rAt(f.z), ctx.rAt(f.z + f.dia / 2));
  const tl = tool.type === 'ldrill' ? tipLen(tool) : 0;
  const { feed } = liveData(ctx, tool);
  const peck = op.params.peck || tool.dia * 1.2;
  const sides = f.through ? [f.c, f.c + 180] : [f.c];
  const xBottom = f.through ? -2 * (tl + 0.3) : (f.depthDia != null ? f.depthDia - 2 * tl : 2 * (Rloc - f.depth - tl));
  startLive(prog, ctx, tool, sides[0]);
  sides.forEach((c, si) => {
    if (si > 0) { prog.rapid({ X: ctx.safeX }); prog.rapid({ C: r3(c) }); }
    const xTop = r3(2 * (Rloc + 1));
    goto(prog, ctx, xTop, r3(f.z));
    let x = 2 * Rloc;
    const xEnd = r3(xBottom);
    while (x > xEnd + 1e-6) {
      const nx = Math.max(xEnd, x - 2 * peck);
      if (x < 2 * Rloc - 1e-6) prog.rapid({ X: r3(x + 0.4) });
      prog.line({ X: r3(nx) }, feed);
      prog.rapid({ X: xTop });
      x = nx;
    }
  });
  endLive(prog, ctx);
};

GEN.flatMill = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'flat');
  const { feed } = liveData(ctx, tool);
  startLive(prog, ctx, tool, f.c);
  try { flatPasses(prog, ctx, tool, f.c, f.depth, f.z0, f.z1, op.params, feed); }
  catch (e) { throw new Error(`${op.name}: ${e.message}`); }
  endLive(prog, ctx);
};

GEN.pocketMill = (prog, ctx, op, tool) => {
  // G19 Y-Z düzleminde helikal cep (eski dosyanın mantığı, X ÇAP olarak düzeltildi)
  const f = featureOf(ctx, op, 'pocket');
  const p = op.params;
  const rt = tool.dia / 2;
  const finalR = f.dia / 2 - rt;
  if (finalR <= 0.01) throw new Error(`${op.name}: takım çapı cep çapından küçük olmalı`);
  const Rloc = Math.max(ctx.rAt(f.z - f.dia / 2), ctx.rAt(f.z + f.dia / 2), ctx.rAt(f.z));
  const xTop = 2 * (Rloc + 0.2), xBot = 2 * (Rloc - f.depth);
  const { feed } = liveData(ctx, tool);
  startLive(prog, ctx, tool, f.c);
  prog.plane('yz');
  let R = Math.min(finalR, Math.max(0.05, p.stepOver));
  goto(prog, ctx, r3(2 * (Rloc + 1)), r3(f.z), r3(R));
  prog.rapid({ X: r3(xTop) });
  let x = xTop;
  const sd = 2 * p.stepDown; // çapta
  while (x > xBot + 1e-6) {
    const nx = Math.max(xBot, x - sd), mid = (x + nx) / 2;
    prog.arc(false, { X: r3(mid), Y: r3(-R), Z: r3(f.z) }, { J: r3(-R), K: 0 }, feed);
    prog.arc(false, { X: r3(nx), Y: r3(R), Z: r3(f.z) }, { J: r3(R), K: 0 }, feed);
    x = nx;
  }
  // radyal genişletme + taban
  while (true) {
    prog.arc(false, { X: r3(xBot), Y: r3(-R), Z: r3(f.z) }, { J: r3(-R), K: 0 }, feed);
    prog.arc(false, { X: r3(xBot), Y: r3(R), Z: r3(f.z) }, { J: r3(R), K: 0 }, feed);
    if (R >= finalR - 1e-6) break;
    const nR = Math.min(finalR, R + p.stepOver);
    prog.line({ Y: r3(nR) }, feed);
    R = nR;
  }
  prog.line({ Y: r3(R - 0.1) }, feed);
  prog.rapid({ X: r3(2 * (Rloc + 1)) });
  prog.rapid({ Y: 0 });
  prog.plane('zx');
  endLive(prog, ctx);
};

GEN.cutoff = (prog, ctx, op, tool, extra) => {
  const p = op.params;
  if ((ctx.backStock || 0) > 0.5 * tool.width + 1e-9) throw new Error(`${op.name}: arka alın payı (${ctx.backStock}) kesme genişliğinin yarısını (${0.5 * tool.width}) aşamaz`);
  const rpm = lim(ctx, p.rpm || rpmFromVc(tool.vc, ctx.stock.barDia), 'main');
  prog.rapid({ X: ctx.safeX });
  prog.tool(tool);
  prog.feedMode('rev');
  prog.spindle({ which: 'main', dir: 'cw', rpm });
  prog.coolant(true);
  const Z = r3(ctx.L + (ctx.backStock || 0)); // arka alın payı: arka tornalamada alınır
  goto(prog, ctx, r3(ctx.stock.barDia + 1), Z);
  const F = p.feed || tool.feed;
  if (extra && extra.pick) {
    prog.wait(extra.w1);  // karşı iş mili yaklaşabilir
    prog.wait(extra.w2);  // karşı iş mili parçayı tuttu
  }
  prog.line({ X: r3(2 * Math.max(ctx.rAt(ctx.L - 0.01), ctx.rAt(Z)) + 0.4) }, F * 2);
  prog.line({ X: r3(p.endX) }, F);
  if (extra && extra.pick) prog.wait(extra.w3);
  op._cutRpm = rpm;
};

GEN.rechuck = (prog, ctx, op) => {
  // kesme takımı durdurucu olarak kullanılır: pens aç, başlık geri, pens kapa
  const w = ctx.cutW;
  prog.comment('CUBUK ILERLETME - DURDURUCU KESME TAKIMI');
  prog.line({ X: 0 }, 0.5);
  prog.spindle({ which: 'main', dir: 'stop' });
  prog.m('mainChuckOpen');
  prog.dwell(0.3);
  // yeni çubuk alnı kesme bıçağının arka kenarına dayanır (takım ref. + w);
  // bir sonraki çevrimde alın payı kalsın diye alın Z = −alın payı olacak şekilde geri gidilir
  prog.rapid({ Z: r3(-w - (ctx.stock.faceStock || 0)) });
  prog.m('mainChuckClose');
  prog.dwell(0.3);
  prog.rapid({ X: ctx.safeX });
  prog.rapid({ Z: r3(-ctx.stock.faceStock - 0.5) });
};

// ---- Kanal 2 ----
GEN.pickoff = (prog, ctx, op, tool, extra) => {
  const p = op.params;
  const grip = Math.min(p.grip, ctx.L - 1);
  if (grip < 2) throw new Error(`${op.name}: parça boyu karşı iş milinde tutmak için çok kısa`);
  const park = subPark(ctx);
  prog.workOffset('G54');
  prog.rapid({ X: 0 });
  prog.rapid({ Z: park });
  prog.m('subChuckOpen');
  prog.wait(extra.w1);
  prog.feedMode('min');
  prog.spindle({ which: 'sub', dir: 'cw', rpm: extra.rpm });
  prog.m('spindleSync');
  // parça önü kesme anında L + arka alın payı konumunda: tutma boyu tam 'grip' olsun (G55 çerçevesi buna dayanır)
  const zGrip = ctx.L + (ctx.backStock || 0) - grip;
  prog.rapid({ Z: r3(zGrip + 1) });
  prog.line({ Z: r3(zGrip) }, p.feed);
  prog.m('subChuckClose');
  prog.dwell(0.3);
  prog.wait(extra.w2);
  prog.wait(extra.w3);
  prog.m('spindleSyncOff');
  prog.rapid({ Z: park });
  op._grip = grip;
};

/** Arka işlemlerde en büyük derinlik (G55 Z): pens somunu (alından SUB_NUT çıkıntılı) arka takım uçlarına 1 mm yaklaşabilir */
export function backMaxDepth(ctx) { return ctx.L - ctx.grip - SUB_NUT - 1; }

/** Karşı iş mili bekleme konumu (G54 Z): parçanın önünde ve ön kovan takımlarının erişiminin dışında */
export function subPark(ctx) {
  let reach = 0;
  for (const t of ctx.tools.filter(t => t.unit === 'front')) reach = Math.max(reach, 58, rotaryProfile(t).length);
  return r3(Math.max(ctx.L + 40, reach + 25));
}

function backStart(prog, ctx) {
  prog.workOffset('G55');
}

GEN.backDrill = (prog, ctx, op, tool) => {
  backStart(prog, ctx);
  prog.rapid({ Z: r3(-5) });
  drillOnSpindle(prog, ctx, op, tool, 'sub');
  prog.rapid({ Z: r3(-5) });
};
GEN.backTap = (prog, ctx, op, tool) => {
  backStart(prog, ctx);
  prog.rapid({ Z: r3(-5) });
  tapOnSpindle(prog, ctx, op, tool, 'sub');
  prog.rapid({ Z: r3(-5) });
};
GEN.eject = (prog, ctx) => {
  prog.spindle({ which: 'sub', dir: 'stop' });
  prog.workOffset('G55');
  prog.rapid({ Z: -5 });          // arka takımlardan uzaklaş
  prog.workOffset('G54');
  prog.rapid({ X: 0 });           // önce yanal, sonra eksenel (çapraz hareket yok)
  prog.rapid({ Z: subPark(ctx) });
  prog.m('subChuckOpen');
  prog.m('partEject');
  prog.dwell(0.5);
};

// ================================================================ C/Y frezeleme (ana iş mili, çapraz tahrikli)
/** Tek düzlük: C açısında, Rloc dış çaptan h yüksekliğine kadar Y zikzak (startLive sonrası çağrılır) */
function flatPasses(prog, ctx, tool, c, depth, z0, z1, p, feed) {
  const rt = tool.dia / 2;
  let Rloc = 0;
  for (let z = z0; z <= z1 + 1e-9; z += 0.05) Rloc = Math.max(Rloc, ctx.rAt(z));
  const h = Rloc - depth;
  if (h < 0) throw new Error('düzlük derinliği yarıçaptan büyük');
  if (z1 - z0 < tool.dia - 1e-6) throw new Error(`düzlük boyu (${r3(z1 - z0)}) takım çapından (${tool.dia}) küçük`);
  const b = Math.sqrt(Math.max(0, Rloc * Rloc - h * h));
  const za = r3(z0 + rt), zb = r3(Math.max(z0 + rt, z1 - rt));
  const yMax = b + 0.3;
  const n = Math.max(1, Math.ceil((2 * yMax) / (p.stepover * tool.dia)));
  const ys = [];
  for (let k = 0; k <= n; k++) ys.push(r3(-yMax + (2 * yMax * k) / n));
  const levels = [];
  for (let lv = Rloc - p.ap; lv > h + 1e-6; lv -= p.ap) levels.push(lv);
  levels.push(h);
  prog.rapid({ X: ctx.safeX });
  prog.rapid({ C: r3(c) });
  const yN = ys[ys.length - 1];
  for (const lv of levels) {
    const x = r3(2 * lv);
    goto(prog, ctx, r3(2 * (Rloc + 1)), za, ys[0]);
    prog.line({ X: x }, feed);
    // çevre: iki uçta (za, zb) tam Y süpürmesi → düzlük uçlarında tarak izi kalmaz
    prog.line({ Y: yN }, feed);
    prog.line({ Z: zb }, feed);
    prog.line({ Y: ys[0] }, feed);
    // iç: Z yönünde zikzak
    ys.forEach((y, k) => {
      if (k > 0) prog.line({ Y: y }, feed);
      prog.line({ Z: k % 2 === 0 ? za : zb }, feed);
    });
    prog.rapid({ X: r3(2 * (Rloc + 1)) });
  }
  prog.rapid({ Y: 0 });
}

/** Çokgen (altıgen, kare…): her kenar bir düzlük, C ile indekslenir */
GEN.polygonMill = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'polygon');
  if (!(f.n >= 3)) throw new Error(`${op.name}: kenar sayısı en az 3 olmalı`);
  let Rloc = 0;
  for (let z = f.z0; z <= f.z1 + 1e-9; z += 0.05) Rloc = Math.max(Rloc, ctx.rAt(z));
  const depth = Rloc - f.af / 2;
  if (depth <= 0.001) throw new Error(`${op.name}: anahtar ağzı (${f.af}) çaptan (Ø${r3(2 * Rloc)}) küçük olmalı`);
  const { feed } = liveData(ctx, tool);
  startLive(prog, ctx, tool, f.c || 0);
  for (let k = 0; k < f.n; k++) {
    const c = (f.c || 0) + (360 * k) / f.n;
    try { flatPasses(prog, ctx, tool, c, depth, f.z0, f.z1, op.params, feed); }
    catch (e) { throw new Error(`${op.name}: ${e.message}`); }
  }
  endLive(prog, ctx);
};

/** Çapta kanal: silindirik interpolasyon (G7.1). Z ve C (derece) birlikte; ilerleme yüzey boyunca. */
GEN.cylSlot = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'odSlot');
  if (Math.abs(tool.dia - f.width) > 1e-6) throw new Error(`${op.name}: takım Ø${tool.dia} ≠ kanal genişliği ${f.width}`);
  let Rloc = 0;
  // kanal bölgesi (uçlar hariç 0.01: komşu basamağın dikey yüzü sayılmasın)
  const zl = Math.min(f.z0, f.z1) - tool.dia / 2 + 0.01, zh = Math.max(f.z0, f.z1) + tool.dia / 2 - 0.01;
  for (let z = zl; z <= zh + 1e-9; z += 0.05) Rloc = Math.max(Rloc, ctx.rAt(z));
  if (f.depth >= Rloc) throw new Error(`${op.name}: derinlik yarıçaptan büyük`);
  const { feed } = liveData(ctx, tool);
  const levels = [];
  for (let d = op.params.stepDown; d < f.depth - 1e-6; d += op.params.stepDown) levels.push(d);
  levels.push(f.depth);
  startLive(prog, ctx, tool, f.c0);
  const xTop = r3(2 * (Rloc + 1));
  goto(prog, ctx, xTop, r3(f.z0));
  let atStart = true;
  for (const d of levels) {
    const x = r3(2 * (Rloc - d));
    prog.line({ X: x }, Math.round(feed * 0.5));               // dalış (kanal ucunda)
    prog.cyl(r3(Rloc));                                        // G7.1 (silindir yarıçapı)
    prog.line(atStart ? { Z: r3(f.z1), C: r3(f.c1) } : { Z: r3(f.z0), C: r3(f.c0) }, feed);
    prog.cyl(0);
    atStart = !atStart;
  }
  prog.rapid({ X: xTop });
  endLive(prog, ctx);
};

// ================================================================ arka işlemler ($2, G55: Z = arka alından derinlik)
function backTurnStart(prog, ctx, tool, op) {
  prog.workOffset('G55');
  prog.rapid({ Z: -5 });
  prog.tool(tool);
  prog.feedMode('rev');
  const vc = op.params.vc || tool.vc;
  prog.spindle({ which: 'sub', dir: 'cw', css: vc, maxRpm: Math.round(Math.min(ctx.machine.subSpindle.maxRpm, ctx.project.stock.maxRpm || Infinity)) });
  prog.coolant(true, true);
}

/** Arka tornalama: alın (kesme yüzü / pay) + profil, karşı iş mili pens bölgesine kadar.
 *  Geometri ön tornalamanın aynısı: profil arka alından aynalanır. Yalnız doğru segmentler (G1). */
GEN.backTurn = (prog, ctx, op, tool) => {
  const p = op.params;
  const L = ctx.L, grip = ctx.grip;
  const zLim = r3(backMaxDepth(ctx));       // pens somunu arka takım uç düzlemine 1 mm'den fazla yaklaşmaz
  if (zLim < 0.3) throw new Error(`${op.name}: parça karşı iş milinden yeterince çıkmıyor (tutma ${grip} mm)`);
  const B = ctx.backProfile();
  const back = tool.backAngle ?? Math.max(5, 180 - 93 - (tool.insertAngle || 35));
  const env = turnableEnvelope(B, back);
  const P = noseTipPath(env, tool.noseR);
  const Pr = noseTipPath(dilate(env, p.allowZ, p.allowX / 2), tool.noseR);
  const R0 = ctx.barR, rn = tool.noseR, bs = ctx.backStock || 0;
  const F = p.feed || tool.feed, Fr = p.roughFeed || F;
  backTurnStart(prog, ctx, tool, op);
  const xOut = r3(2 * (R0 + 0.5));
  // alın: arka alın payı (varsa) pasolarla, sonra Z0
  if (p.face || bs > 0) {
    const n = Math.max(1, Math.ceil(bs / Math.max(0.05, p.ap) - 1e-9));
    for (let k = bs > 0 ? 1 : n; k <= n; k++) {
      const z = r3(-bs + (bs * k) / n);
      prog.rapid({ X: xOut });
      prog.rapid({ Z: z });
      prog.line({ X: r3(-2 * rn - 0.1) }, F);
      prog.rapid({ Z: r3(z - 0.5) });
    }
    prog.rapid({ X: xOut });
  }
  // kaba (profil arka açı içinde ulaşılabiliyorsa)
  roughLevels(prog, ctx, Pr, R0, -0.5, zLim, { ...p, retract: 0.3 }, Fr);
  // finiş: arka alından pens bölgesine (yalnız doğrular: aynalı çerçevede yay yönü belirsizliği yok)
  const pts = toPolyline(P, P.idx(-0.5), P.idx(zLim)).map(q => ({ z: q.z, r: Math.min(q.r, R0) }));
  const segs = fitSegments(pts, 0.002, { arcs: false });
  goto(prog, ctx, r3(2 * Math.max(0, pts[0].r)), r3(pts[0].z));
  emitSegments(prog, segs, F, ctx);
  prog.line({ X: xOut }, F);
  prog.rapid({ X: ctx.safeX });
  prog.rapid({ Z: -5 });
  prog.coolant(false, true);
};

function backLiveStart(prog, ctx, tool) {
  prog.workOffset('G55');
  prog.rapid({ Z: -5 });
  prog.spindle({ which: 'sub', dir: 'stop' });
  prog.m('subCAxisOn');
  prog.tool(tool);
  prog.feedMode('min');
  const max = ctx.machine.liveTools.back.maxRpm;
  const rpm = Math.min(max, Math.round(rpmFromVc(tool.vc, tool.dia)));
  prog.spindle({ which: 'backLive', dir: 'cw', rpm });
  prog.coolant(true, true);
  return { rpm, feed: Math.round(Math.max(5, tool.fz * (tool.flutes || 2) * rpm)) };
}
function backLiveEnd(prog, ctx) {
  prog.rapid({ Z: -5 });
  prog.spindle({ which: 'backLive', dir: 'stop' });
  prog.coolant(false, true);
  prog.rapid({ C: 0 });
  prog.m('subCAxisOff');
}
function backLiveCheck(ctx, op, tool) {
  if (!tool.live || tool.unit !== 'back') throw new Error(`${op.name}: arka ünitede tahrikli takım gerekli`);
  if (tool.dia > ctx.machine.liveTools.back.maxDrillLive + 1e-6) throw new Error(`${op.name}: Ø${tool.dia} arka tahrikli kapasiteyi aşıyor`);
}

/** Arka alında merkezden geçen kanal (tornavida kanalı): C2 indeks + X2 boyunca */
GEN.backSlot = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'faceSlot');
  backLiveCheck(ctx, op, tool);
  if (Math.abs(tool.dia - f.width) > 1e-6) throw new Error(`${op.name}: takım Ø${tool.dia} ≠ kanal genişliği ${f.width} (X2 tek eksen: genişlik = takım çapı)`);
  if (f.depth > backMaxDepth(ctx)) throw new Error(`${op.name}: kanal derinliği (${f.depth}) arka işleme sınırını (${r3(backMaxDepth(ctx))}) aşıyor — pens somunu arka takımlara çarpar`);
  const Rb = ctx.rAt(ctx.L - 0.01);
  const { feed } = backLiveStart(prog, ctx, tool);
  prog.rapid({ C: r3(f.c || 0) });
  const xa = r3(2 * (Rb + tool.dia / 2 + 1)), xb = -xa;
  prog.rapid({ X: xa });
  prog.rapid({ Z: -1 });
  let side = 0;
  for (let d = Math.min(op.params.stepDown, f.depth); ; d = Math.min(f.depth, d + op.params.stepDown)) {
    prog.line({ Z: r3(d) }, feed);
    prog.line({ X: side ? xa : xb }, feed);
    side ^= 1;
    if (d >= f.depth - 1e-9) break;
  }
  prog.rapid({ Z: -1 });
  prog.rapid({ X: 0 });
  backLiveEnd(prog, ctx);
};

/** Çokgen kontur (dış offset, keskin köşe = köşede oyma yok). (x, y) hipotetik düzlem noktaları. */
export function polygonLoop(n, af, rotDeg, off) {
  const a = af / 2 + off;
  const R = a / Math.cos(Math.PI / n);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const th = (rotDeg * Math.PI) / 180 + (2 * k + 1) * Math.PI / n; // köşeler kenar normalleri arasında
    pts.push({ x: R * Math.cos(th), y: R * Math.sin(th) });
  }
  return pts;
}

/** Arka alın konturu (altıgen vb.): polar interpolasyon G12.1 (X çap, C hipotetik mm) */
GEN.backPolar = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'facePolygon');
  backLiveCheck(ctx, op, tool);
  if (!(f.n >= 3)) throw new Error(`${op.name}: kenar sayısı en az 3 olmalı`);
  const Rb = ctx.rAt(ctx.L - 0.01);
  if (f.af / 2 >= Rb - 0.001) throw new Error(`${op.name}: anahtar ağzı çaptan küçük olmalı`);
  if (f.depth > backMaxDepth(ctx)) throw new Error(`${op.name}: derinlik (${f.depth}) arka işleme sınırını (${r3(backMaxDepth(ctx))}) aşıyor — pens somunu arka takımlara çarpar`);
  const rt = tool.dia / 2, p = op.params;
  const { feed } = backLiveStart(prog, ctx, tool);
  // radyal pasolar: dış stoktan kontura (son paso offset = rt)
  const offs = [];
  const outer = Rb - f.af / 2;
  for (let o = rt + outer; o > rt + 1e-6; o -= p.stepOver * tool.dia) offs.push(o);
  offs.push(rt);
  const levels = [];
  for (let d = p.stepDown; d < f.depth - 1e-6; d += p.stepDown) levels.push(d);
  levels.push(f.depth);
  const xs = r3(2 * (Rb + rt + 1));                // giriş/çıkış: +x ekseni üstünde stok dışı
  prog.rapid({ C: 0 });
  prog.rapid({ X: xs });
  prog.rapid({ Z: -1 });
  const ang = (q) => { let t = Math.atan2(q.y, q.x); if (t < 0) t += 2 * Math.PI; return t; };
  for (const d of levels) {
    prog.polar(true);
    prog.line({ Z: r3(d) }, feed);
    for (const o of offs) {
      const loop = polygonLoop(f.n, f.af, f.c || 0, o).sort((u, v) => ang(u) - ang(v));
      // +x eksenini kesen kenar (son köşe → ilk köşe) üzerinden giriş/çıkış
      const last = loop[loop.length - 1], first = loop[0];
      const tt = last.y / (last.y - first.y);
      const xe = last.x + (first.x - last.x) * tt;
      prog.line({ X: r3(2 * xe), C: 0 }, feed);
      for (const q of loop) prog.line({ X: r3(2 * q.x), C: r3(q.y) }, feed);  // CCW
      prog.line({ X: r3(2 * xe), C: 0 }, feed);
    }
    prog.line({ X: xs, C: 0 }, feed);
    prog.rapid({ Z: -1 });
    prog.polar(false);
  }
  backLiveEnd(prog, ctx);
};

export { GEN };
