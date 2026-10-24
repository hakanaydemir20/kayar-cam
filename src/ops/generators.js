// İşlem üreteçleri: her işlem kanal programına (Prog) IR ekler.
import { dilate, noseTipPath, toPolyline, sampleProfile } from '../geom/sampled.js';
import { fitSegments } from '../geom/fit.js';
import { rpmFromVc, threadDepth, round3 } from '../tools/cuttingData.js';

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
    case 'cutoff': return { feed: null, rpm: null, endX: -0.4 };
    case 'backDrill': return { featureId: null, peck: null, feed: null };
    case 'backTap': return { featureId: null };
    case 'eject': return {};
    case 'rechuck': return {};
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
    prog.rapid({ X: xStart, Y: 0, Z: r3(z - 0.0) });
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
  const iStart = P.idx(-0.5), iEnd = P.idx(ctx.zEnd);
  let minP = Infinity;
  for (let i = iStart; i <= iEnd; i++) minP = Math.min(minP, P.r[i]);
  if (minP >= R0 - 1e-6) { prog.comment('KABA: KALDIRILACAK MALZEME YOK'); return; }
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
  for (const Z of [...new Set(zs)]) {
    const h = hAt(Z) + p.allow;
    prog.rapid({ X: xApp, Y: 0, Z });
    prog.line({ X: r3(2 * h) }, F);
    prog.rapid({ X: xApp });
  }
  // finiş: tabanı izle
  const pts = [];
  for (let Z = z0; Z <= span + 1e-9; Z += 0.01) pts.push({ z: Z, r: hAt(Z) });
  if (pts[pts.length - 1].z < span - 1e-6) pts.push({ z: span, r: hAt(span) });
  const segs = fitSegments(pts, 0.002, { arcs: false });
  prog.rapid({ X: xApp, Z: r3(z0) });
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
  prog.rapid({ X: xStart, Y: 0, Z: zStart });
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
  const p = op.params;
  const rt = tool.dia / 2;
  let Rloc = 0;
  for (let z = f.z0; z <= f.z1; z += 0.05) Rloc = Math.max(Rloc, ctx.rAt(z));
  const h = Rloc - f.depth;
  if (h < 0) throw new Error(`${op.name}: düzlük derinliği yarıçaptan büyük`);
  const b = Math.sqrt(Math.max(0, Rloc * Rloc - h * h));
  const { feed } = liveData(ctx, tool);
  const za = r3(f.z0 + rt), zb = r3(Math.max(f.z0 + rt, f.z1 - rt));
  const ys = [];
  const yMax = b + 0.3; // takım merkezi düzlük kenarına kadar
  const n = Math.max(1, Math.ceil((2 * yMax) / (p.stepover * tool.dia)));
  for (let k = 0; k <= n; k++) ys.push(r3(-yMax + (2 * yMax * k) / n));
  const levels = [];
  for (let lv = Rloc - p.ap; lv > h + 1e-6; lv -= p.ap) levels.push(lv);
  levels.push(h);
  startLive(prog, ctx, tool, f.c);
  for (const lv of levels) {
    const x = r3(2 * lv);
    goto(prog, ctx, r3(2 * (Rloc + 1)), za, ys[0]);
    prog.line({ X: x }, feed);
    ys.forEach((y, k) => {
      if (k > 0) prog.line({ Y: y }, feed);
      prog.line({ Z: k % 2 === 0 ? zb : za }, feed);
    });
    prog.rapid({ X: r3(2 * (Rloc + 1)) });
  }
  prog.rapid({ Y: 0 });
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
  const rpm = lim(ctx, p.rpm || rpmFromVc(tool.vc, ctx.stock.barDia), 'main');
  prog.rapid({ X: ctx.safeX });
  prog.tool(tool);
  prog.feedMode('rev');
  prog.spindle({ which: 'main', dir: 'cw', rpm });
  prog.coolant(true);
  const Z = r3(ctx.L);
  prog.rapid({ X: r3(ctx.stock.barDia + 1), Y: 0, Z });
  const F = p.feed || tool.feed;
  if (extra && extra.pick) {
    prog.wait(extra.w1);  // karşı iş mili yaklaşabilir
    prog.wait(extra.w2);  // karşı iş mili parçayı tuttu
  }
  prog.line({ X: r3(2 * ctx.rAt(ctx.L - 0.01) + 0.4) }, F * 2);
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
  const park = r3(ctx.L + 40);
  prog.workOffset('G54');
  prog.rapid({ X: 0, Z: park });
  prog.m('subChuckOpen');
  prog.wait(extra.w1);
  prog.feedMode('min');
  prog.spindle({ which: 'sub', dir: 'cw', rpm: extra.rpm });
  prog.m('spindleSync');
  prog.rapid({ Z: r3(ctx.L - grip + 1) });
  prog.line({ Z: r3(ctx.L - grip) }, p.feed);
  prog.m('subChuckClose');
  prog.dwell(0.3);
  prog.wait(extra.w2);
  prog.wait(extra.w3);
  prog.m('spindleSyncOff');
  prog.rapid({ Z: park });
  op._grip = grip;
};

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
  prog.rapid({ Z: r3(ctx.L + 40) });
  prog.m('subChuckOpen');
  prog.m('partEject');
  prog.dwell(0.5);
};

export { GEN };
