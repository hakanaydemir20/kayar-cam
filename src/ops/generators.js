// İşlem üreteçleri: her işlem kanal programına (Prog) IR ekler.
import { dilate, noseTipPath, toPolyline, sampleProfile, turnableEnvelope } from '../geom/sampled.js';
import { fitSegments } from '../geom/fit.js';
import { rpmFromVc, threadDepth, round3 } from '../tools/cuttingData.js';
import { rotaryProfile, frontDrillReach } from '../tools/toolGeom.js';
import { textStrokes, unsupportedChars } from '../geom/strokeFont.js';
import { subNut, subBodies, backBodies } from '../sim/bodies.js';
import { moved, subHitsBack } from '../sim/collision.js';
import { LAYOUT } from '../sim/frames.js';
import { insertEdges } from '../tools/toolLibrary.js';

const r3 = round3;
const DEG = Math.PI / 180;

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
  areaMill:   { label: 'Bölgesel Frezeleme (C/Y)', channel: 1, tools: ['endmill'] },
  pocketMill: { label: 'Helikal Cep (G19)', channel: 1, tools: ['endmill'] },
  pickoff:    { label: 'Karşı İş Miline Al', channel: 2, tools: [] },
  cutoff:     { label: 'Kesme', channel: 1, tools: ['cutoff'] },
  backDrill:  { label: 'Arka Delme', channel: 2, tools: ['drill', 'center'] },
  backTap:    { label: 'Arka Kılavuz', channel: 2, tools: ['tap'] },
  eject:      { label: 'Parça Bırakma', channel: 2, tools: [] },
  rechuck:    { label: 'Çubuk İlerletme', channel: 1, tools: [] },
  midRechuck: { label: 'Ara Bağlama (uzun parça)', channel: 1, tools: [] },
  polygonMill:{ label: 'Çokgen Frezeleme (C/Y)', channel: 1, tools: ['endmill'] },
  cylSlot:    { label: 'Silindirik Kanal (G7.1)', channel: 1, tools: ['endmill'] },
  engrave:    { label: 'Çapa Yazı / Gravür (G7.1)', channel: 1, tools: ['endmill'] },
  backTurn:   { label: 'Arka Tornalama', channel: 2, tools: ['turn'] },
  backSlot:   { label: 'Arka Alın Kanalı (C2)', channel: 2, tools: ['endmill'] },
  backPolar:  { label: 'Arka Alın Konturu (G12.1)', channel: 2, tools: ['endmill'] },
};

export function defaultParams(type) {
  switch (type) {
    case 'face': return { ap: 0.15, allow: 0, feed: null, vc: null };
    case 'rough': return { strategy: 'z', ap: 1.0, allowX: 0.15, allowZ: 0.05, retract: 0.3, feed: null, vc: null, contourPass: true };
    case 'finish': return { feed: null, vc: null, tol: 0.002 };
    case 'groove': return { z0: null, z1: null, allow: 0.05, peck: 0, feed: null, vc: null };
    case 'thread': return { featureId: null, firstDepth: 0.15, springPasses: 1, rpm: null };
    case 'center': return { featureId: null, spotDia: null };
    case 'drill': return { featureId: null, peck: null, feed: null };
    case 'tap': return { featureId: null };
    case 'crossDrill': return { featureId: null, peck: null };
    case 'flatMill': return { featureId: null, ap: 1.0, stepover: 0.6, pattern: 'zigzagZ' };
    case 'areaMill': return { c: 0, depth: 1, ap: 0.5, stepover: 0.5, pattern: 'zigzagY', contour: true, region: [{ z: 5, y: -3 }, { z: 15, y: -3 }, { z: 15, y: 3 }, { z: 5, y: 3 }] };
    case 'pocketMill': return { featureId: null, stepDown: 0.5, stepOver: 0.5 };
    case 'pickoff': return { grip: 6, feed: 500, gap: 1, dwell: 0.3 };
    case 'cutoff': return { feed: null, rpm: null, endX: -0.4, backStock: 0 };
    case 'backDrill': return { featureId: null, peck: null, feed: null };
    case 'backTap': return { featureId: null };
    case 'eject': return { dropX: 0, dropZ: null, blow: 0.5, ejector: true };
    case 'rechuck': return {};
    case 'midRechuck': return { atZ: 100, shift: 100, grip: 6, feed: 500 };
    case 'polygonMill': return { featureId: null, ap: 1.0, stepover: 0.6, pattern: 'zigzagZ' };
    case 'cylSlot': return { featureId: null, stepDown: 0.5 };
    case 'engrave': return { featureId: null };
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
  // işlem başına iş mili: sabit kesme hızı (G96 + G50 sınırı) veya sabit devir (G97)
  const opMax = +op.params.maxRpm > 0 ? +op.params.maxRpm : Infinity;
  const maxRpm = Math.min(ctx.machine.mainSpindle.maxRpm, ctx.project.stock.maxRpm || Infinity, opMax);
  if (opts.constRpm) prog.spindle({ which: 'main', dir: 'cw', rpm: lim(ctx, opts.constRpm, 'main') });
  else if (op.params.spindleMode === 'rpm' && +op.params.rpm > 0) prog.spindle({ which: 'main', dir: 'cw', rpm: lim(ctx, Math.min(+op.params.rpm, maxRpm), 'main') });
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
  // finiş payı: alın Z = −pay'da biter, kalanı finiş konturu alır (finiş girişi Z−0.5'ten: pay ≤ 0.3)
  const al = Math.min(0.3, Math.max(0, +p.allow || 0));
  if (fs - al <= 1e-6) { prog.comment('ALIN: KALDIRILACAK MALZEME YOK'); endTool(prog, ctx); return; }
  const n = Math.max(1, Math.ceil((fs - al) / p.ap - 1e-9));
  const xStart = ctx.stock.barDia + 1;
  for (let k = 1; k <= n; k++) {
    const z = r3(-fs + ((fs - al) * k) / n);
    if (k === 1) goto(prog, ctx, xStart, z);   // önce güvenli X (önceki takım ön kovan olabilir), sonra Y/Z
    else prog.rapid({ Z: z });
    prog.line({ X: r3(-2 * rn - 0.1) }, F);
    prog.rapid({ Z: r3(z - 0.5) });
    prog.rapid({ X: xStart });
  }
  endTool(prog, ctx);
};

/** Segment (kılavuz burç bölgesi) sınırları: extra.zFrom/zTo yoksa tüm boy */
function zRange(ctx, extra) {
  const z0 = extra?.zFrom != null ? extra.zFrom : -0.5;
  const z1 = extra?.zTo != null ? Math.min(extra.zTo, ctx.zEnd) : ctx.zEnd;
  return [z0, z1, extra?.zFrom != null && extra.zFrom > 0];
}

/** Kontur pasosu girişi: segment içinden başlıyorsa bitmiş bölgeye 0.3 mm geri, profilin 0.2 mm üstüne hızlı, sonra G1 */
function contourEntry(prog, ctx, P, z0, inner, R0, F) {
  if (!inner) {
    const zs = Math.max(-0.5, z0);
    const pts = toPolyline(P, P.idx(zs), P.idx(zs)).map(q => ({ z: q.z, r: Math.min(q.r, R0) }));
    goto(prog, ctx, r3(2 * Math.max(0, pts[0].r)), r3(pts[0].z));
    return zs;
  }
  const zs = z0 - 0.3, r = Math.min(P.at(zs), R0);
  goto(prog, ctx, r3(2 * (r + 0.2)), r3(zs));
  prog.line({ X: r3(2 * r) }, F);
  return zs;
}

GEN.rough = (prog, ctx, op, tool, extra) => {
  const p = op.params;
  const env = ctx.envelopeFor(tool);
  const A = dilate(env, p.allowZ, p.allowX / 2);
  const P = noseTipPath(A, tool.noseR);
  const R0 = ctx.barR;
  let [z0, z1, inner] = zRange(ctx, extra);
  // isteğe bağlı Z aralığı (kalan malzeme: önceki takımın erişemediği bölge)
  if (p.zMin != null && p.zMin !== '' && Number.isFinite(+p.zMin)) { z0 = Math.max(z0, +p.zMin); inner = inner || +p.zMin > 0; }
  if (p.zMax != null && p.zMax !== '' && Number.isFinite(+p.zMax)) z1 = Math.min(z1, +p.zMax);
  if (z1 <= z0 + 1e-6) { prog.comment('KABA: Z ARALIGI BOS'); return; }
  startTurning(prog, ctx, tool, op);
  if (extra?.seg) prog.comment(`SEGMENT ${extra.seg} Z${r3(Math.max(0, z0))}-${r3(z1)}`);
  const F = p.feed || tool.feed;
  const strat = p.strategy || 'z';
  const done = strat === 'profile' ? roughProfile(prog, ctx, P, R0, z0, z1, p, F)
    : strat === 'face' ? roughFace(prog, ctx, P, R0, z0, z1, p, F)
      : roughLevels(prog, ctx, P, R0, z0, z1, p, F);
  if (!done) { prog.comment('KABA: KALDIRILACAK MALZEME YOK'); endTool(prog, ctx); return; }
  if (p.contourPass) {
    // yarı finiş kontur pasosu: pay bırakılmış profil boyunca
    const zs = contourEntry(prog, ctx, P, z0, inner, R0, F);
    const pts = toPolyline(P, P.idx(zs), P.idx(z1)).map(q => ({ z: q.z, r: Math.min(q.r, R0 + 0.0) }));
    emitSegments(prog, fitSegments(pts, 0.003), F, ctx);
    prog.rapid({ X: ctx.safeX });
  }
  endTool(prog, ctx);
};

/** Profile paralel (kontur ofset) kaba: her paso son kontura sabit uzaklıkta (sabit talaş kalınlığı).
 *  Çubuk dışında kalan kısımlar (ofset ≥ R0) hava: atlanır. Pasolar dıştan içe. */
export function roughProfile(prog, ctx, P, R0, zFrom, zTo, p, F) {
  const i0 = P.idx(Math.max(zFrom, 0)), i1 = P.idx(zTo);
  let maxGap = 0;
  for (let i = i0; i <= i1; i++) maxGap = Math.max(maxGap, R0 - P.r[i]);
  if (maxGap <= 1e-6) return false;
  const n = Math.ceil(maxGap / p.ap - 1e-9);
  const xUp = r3(2 * (R0 + 0.5));
  for (let k = n; k >= 1; k--) {
    const o = (k - 1) * p.ap;   // son paso (k = 1) pay bırakılmış konturun kendisi
    // ofset yolu: P + o (o = 0 son paso = pay bırakılmış kontur), çubuk yüzeyinin altı malzeme
    let i = i0;
    while (i <= i1) {
      while (i <= i1 && P.r[i] + o >= R0 - 1e-6) i++;
      if (i > i1) break;
      const a = i;
      while (i <= i1 && P.r[i] + o < R0 - 1e-6) i++;
      const b = i - 1;
      if (P.zAt(b) - P.zAt(a) < 0.05) continue;
      const pts = [];
      for (let q = a; q <= b; q++) pts.push({ z: P.zAt(q), r: Math.min(R0, P.r[q] + o) });
      goto(prog, ctx, xUp, r3(pts[0].z));
      prog.line({ X: r3(2 * pts[0].r) }, F);
      emitSegments(prog, fitSegments(pts, 0.003, { arcs: false }), F, ctx);
      prog.line({ X: r3(2 * pts[pts.length - 1].r + 2 * p.retract), Z: r3(pts[pts.length - 1].z - p.retract) }, F);
      prog.rapid({ X: xUp });
    }
  }
  return true;
}

/** Alın (X'e paralel) kaba: Z adımlarıyla radyal pasolar, büyük basamaklar için. Her Z diliminde dıştan profile. */
export function roughFace(prog, ctx, P, R0, zFrom, zTo, p, F) {
  const zs = Math.max(zFrom, 0), xUp = r3(2 * (R0 + 0.5));
  let any = false;
  // dilim Z: önden arkaya ap adımı; dilimin altındaki en yüksek profil (uç takım bu dilimi kazır)
  for (let z = zs + p.ap; z <= zTo + p.ap - 1e-9; z += p.ap) {
    const ze = Math.min(z, zTo);
    let hi = 0;
    for (let i = P.idx(Math.max(zs, ze - p.ap)), e = P.idx(ze); i <= e; i++) hi = Math.max(hi, P.r[i]);
    // dilimin arkasındaki (daha derin) profil daha yüksekse oraya kadar inilemez: P(ze) ile sınırla
    const target = Math.max(hi, P.at(ze));
    if (target >= R0 - 1e-6) continue;
    any = true;
    goto(prog, ctx, xUp, r3(ze));
    prog.line({ X: r3(2 * target) }, F);
    prog.line({ X: r3(2 * target + 2 * p.retract), Z: r3(ze - p.retract) }, F);
    prog.rapid({ X: xUp });
  }
  return any;
}

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

GEN.finish = (prog, ctx, op, tool, extra) => {
  const p = op.params;
  const env = ctx.envelopeFor(tool);
  const P = noseTipPath(env, tool.noseR);
  let [z0, z1, inner] = zRange(ctx, extra);
  // isteğe bağlı Z aralığı (bitmiş parçada seçilen yüzey)
  if (p.zMin != null && p.zMin !== '' && Number.isFinite(+p.zMin)) { z0 = Math.max(z0, +p.zMin); inner = inner || +p.zMin > 0; }
  if (p.zMax != null && p.zMax !== '' && Number.isFinite(+p.zMax)) z1 = Math.min(z1, +p.zMax);
  if (z1 <= z0 + 1e-6) { prog.comment('FINIS: Z ARALIGI BOS'); return; }
  startTurning(prog, ctx, tool, op);
  if (extra?.seg) prog.comment(`SEGMENT ${extra.seg} Z${r3(Math.max(0, z0))}-${r3(z1)}`);
  const F = p.feed || tool.feed;
  const zs = contourEntry(prog, ctx, P, z0, inner, ctx.barR, F);
  const pts = toPolyline(P, P.idx(zs), P.idx(z1)).map(q => ({ z: q.z, r: Math.min(q.r, ctx.barR) }));
  const segs = fitSegments(pts, p.tol || 0.002);
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
    // parça arka ucuna açılan bölge (arka köşe pahı/radyüsü) kanal değildir: kesme tarafında kalır
    if (R.zAt(hi) >= ctx.L - 0.002) continue;
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
  const zStart = threadStartZ(ctx, op, f, h);
  const xStart = r3(f.dia + 2);
  goto(prog, ctx, xStart, zStart);
  if (ctx.project.post.cycles?.thread === 'g76') {
    // G76 çok pasolu diş çevrimi (FANUC iki bloklu format)
    prog.cycle({ kind: 'g76', X: r3(f.dia - 2 * h), Z: r3(f.z1), height: h, d1: p.firstDepth, m: Math.max(1, p.springPasses + 1), a: 60, F: f.pitch,
      dmin: ctx.project.post.g76MinCut ?? 0.05, allow: ctx.project.post.g76Allowance ?? 0.05 });
  } else for (const d of threadPasses(h, p.firstDepth, p.springPasses)) {
    prog.thread92({ X: r3(f.dia - 2 * d), Z: r3(f.z1) }, f.pitch);
  }
  prog.rapid({ X: ctx.safeX });
};

/** Diş başlangıç Z'si: normal giriş boyu z0 − max(2P, 1.5). Önde diş dibinden yüksek omuz varsa uç (60° V, ±3 mm)
 *  ve tutucu (uçtan 5.2 mm yukarıda) omza değmeyecek kadar z0'a yaklaşılır; en az 0.5P giriş kalmalı.
 *  Diş sonunda (z1 + 0.5'ten sonra) da V ucun yanına omuz gelmemeli (boşaltma kanalı gerekir). */
function threadStartZ(ctx, op, f, h) {
  const rMin = (f.dia - 2 * h) / 2, P = f.pitch, TAN60 = Math.tan(60 * DEG);
  const zAllowed = f.z0 - 1.5 * P;                  // hedefte diş bu Z'den itibaren serbest (stockSim.buildTarget)
  const R = f.dia / 2;
  const ok = (zt) => {
    // G92/G76 her pasoda X'e HIZLI dalar: başlangıç noktasında uç (60° V, ±3 mm) boşta olmalı
    for (let z = Math.max(0, zt - 3); z <= Math.min(ctx.L, zt + 3) + 1e-9; z += 0.02) {
      if (ctx.rAt(z) > rMin + TAN60 * Math.abs(z - zt) + 0.002) return false;
    }
    for (let z = Math.max(0, zt - 12); z < f.z0 - 1e-9; z += 0.02) {
      const r = ctx.rAt(z);
      if (z >= zAllowed && r <= R + 0.01) continue;   // diş girişi (pah vb.): hedefte kesilebilir
      const a = zt - z;
      const lim = a <= 0 ? rMin : a <= 3 ? rMin + TAN60 * a : rMin + 5.2;
      if (r > lim + 0.002) return false;
    }
    return true;
  };
  const zMax = f.z0 - 0.5 * P;
  let zt = f.z0 - Math.max(2 * P, 1.5);
  while (zt <= zMax + 1e-9 && !ok(zt)) zt += 0.05;
  if (zt > zMax + 1e-9) throw new Error(`${op.name}: diş girişi için boş yer yok — diş kateri her pasoda X'e hızlı dalar, başlangıç noktası boşta olmalı. Dişin önünde diş dibinden (Ø${r3(2 * rMin)}) küçük bir bölge (parça önü, pah veya boşaltma kanalı) bırakın; büyük omuz varsa diş başlangıcı omuzdan en az ${r3(3 + 0.5 * P)} mm uzakta olmalı`);
  for (let z = f.z1 + 0.5; z <= Math.min(ctx.L, f.z1 + 3) + 1e-9; z += 0.02) {
    if (ctx.rAt(z) > Math.max(R + 0.01, rMin + TAN60 * (z - f.z1)) + 0.002) throw new Error(`${op.name}: diş sonunda omuz var — diş ucu omza çarpar. Diş sonuna boşaltma kanalı ekleyin veya diş boyunu kısaltın (Z${r3(f.z1)})`);
  }
  return r3(zt);
}

function axialDrillCycle(prog, ctx, Zend, peck, F) {
  // varsayılan: açık hareketlerle gagalama (çevrim parametresine bağımlılık yok); Post ayarında G83 seçilebilir
  const zr = -1; // yaklaşma (yüzeyden 1 mm önce)
  if (prog.channel === 1) goto(prog, ctx, 0, zr);
  else { prog.rapid({ Z: -5 }); prog.rapid({ X: 0 }); prog.rapid({ Z: zr }); }
  if (ctx.project.post.cycles?.drill && peck > 0 && peck < Zend) {
    prog.cycle({ kind: 'g83', Z: r3(Zend), R: 0, Q: r3(peck), F });   // R0: R noktası = başlangıç (dönüş belirsizliği yok)
    return;
  }
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
  const f0 = featureOf(ctx, op, 'axialHole');
  const p = op.params;
  // bölünmüş delik (kaba otomatik): işlem kendi derinliğini taşır (önden erişilebilen kısım / arkadan kalan)
  const f = p.depth != null ? { ...f0, depth: +p.depth, through: !!p.through } : f0;
  if (which === 'sub' && f.depth + tipLen(tool) + (f.through ? 0.5 : 0) > backAxialLimit(ctx, tool)) throw new Error(`${op.name}: delik derinliği + uç boyu arka işleme sınırını (${r3(backAxialLimit(ctx, tool))} mm) aşıyor — karşı iş mili arka ünitedeki takımlara çarpar. Tutma boyunu azaltın veya komşu istasyonu boşaltın.`);
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
    if (which === 'main' && Zend > frontDrillReach(tool) + 1e-6) throw new Error(`${op.name}: delik derinliği (${r3(f.depth)} mm + uç ${r3(Zend - f.depth)}) Ø${tool.dia} matkabın önden erişimini aşıyor (en çok Z${r3(frontDrillReach(tool))}: ağız boyu / ön kovan bloğu). Kaba otomatik deliği önden ve arkadan bölerek planlar; ya da daha uzun ağızlı matkap seçin.`);
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
  const rigid = !!ctx.project.post.cycles?.rigidTap;
  prog.tool(tool);
  prog.feedMode('rev');
  if (!rigid) prog.spindle({ which, dir: 'cw', rpm });   // rijit modda iş mili M29 ile konum kontrolüne alınır (M3 yok)
  const zr = r3(-3 * tool.pitch);
  const depth = r3(f.threadDepth || Math.max(0.5, f.depth - 2 * tool.pitch));
  if (prog.channel === 1) goto(prog, ctx, 0, zr);
  else { prog.rapid({ Z: -5 }); prog.rapid({ X: 0 }); prog.rapid({ Z: zr }); }
  if (ctx.project.post.cycles?.rigidTap) {
    prog.comment('RIJIT KILAVUZ: M29 + G84');
    prog.rigid(which, rpm);
    prog.cycle({ kind: 'g84', Z: depth, R: 0, F: tool.pitch });
    prog.spindle({ which, dir: 'stop' });
    return;
  }
  prog.comment('YUZER KILAVUZ: G32 + TERS DONUS');
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

/** Ara bağlama ($1): parça atZ kadar dışarıda; karşı iş mili ucu tutar, ana pens açılır, başlık 'shift' kadar geri,
 *  pens kapanır. Program Z (parça koordinatı) korunur: iş kaydırması G10 P0 Z (makine Z1 = program Z + kaydırma). */
GEN.midRechuck = (prog, ctx, op, tool, extra) => {
  const p = op.params;
  const z1 = ctx.machine.axes.Z1;
  if (!(p.shift > 0)) throw new Error(`${op.name}: geri çekme boyu (shift) > 0 olmalı`);
  if (p.atZ - p.shift < z1.min) throw new Error(`${op.name}: geri çekme Z1 alt sınırını aşar (atZ − shift = ${r3(p.atZ - p.shift)})`);
  if (p.grip >= p.atZ - 2) throw new Error(`${op.name}: tutma boyu parçanın dışarıdaki boyundan küçük olmalı`);
  prog.comment(`ARA BAGLAMA Z${r3(p.atZ)} GERI ${r3(p.shift)}`);
  prog.rapid({ X: ctx.safeX });
  prog.spindle({ which: 'main', dir: 'stop' });
  prog.rapid({ Y: 0 });
  prog.rapid({ Z: r3(p.atZ) });
  prog.wait(extra.a);                // karşı iş mili tutmaya gelebilir
  prog.wait(extra.b);                // karşı iş mili tuttu
  prog.m('mainChuckOpen');
  prog.dwell(0.3);
  prog.rapid({ Z: r3(p.atZ - p.shift) });
  prog.m('mainChuckClose');
  prog.dwell(0.3);
  // başlık geri gitti, parça yerinde: aynı parça noktası artık makinede 'shift' kadar geride
  prog.workShift(r3(extra.ext - p.shift));
  prog.wait(extra.c);                // karşı iş mili bırakabilir
  ctx.extZ = extra.ext - p.shift;
};
/** Ara bağlama ($2 tarafı): G54 aktarma çerçevesinde parça önü dünya x = atZ (parça koordinatı) */
GEN.midRechuckSub = (prog, ctx, op, tool, extra) => {
  const p = op.params;
  const park = subPark(ctx);
  prog.comment('ARA BAGLAMA - KARSI IS MILI DESTEK');
  prog.workOffset('G54');
  prog.spindle({ which: 'sub', dir: 'stop' });
  prog.rapid({ X: 0 });
  prog.rapid({ Z: Math.max(park, r3(p.atZ + 5)) });
  prog.m('subChuckOpen');
  prog.wait(extra.a);
  const zg = r3(p.atZ - p.grip);
  prog.rapid({ Z: r3(zg + 1) });
  prog.feedMode('min');
  prog.line({ Z: zg }, p.feed);
  prog.m('subChuckClose');
  prog.dwell(0.3);
  prog.wait(extra.b);
  prog.wait(extra.c);
  prog.m('subChuckOpen');
  prog.dwell(0.3);
  prog.rapid({ Z: Math.max(park, r3(p.atZ + 5)) });
};

GEN.rechuck = (prog, ctx, op) => {
  // kesme takımı durdurucu olarak kullanılır: pens aç, başlık geri, pens kapa
  const w = ctx.cutW;
  prog.comment('CUBUK ILERLETME - DURDURUCU KESME TAKIMI');
  prog.line({ X: 0 }, 0.5);
  prog.spindle({ which: 'main', dir: 'stop' });
  prog.m('mainChuckOpen');
  prog.dwell(0.3);
  if (ctx.extZ) { prog.workShift(0); ctx.extZ = 0; } // ara bağlama kaydırması sıfırlanır (pens açıkken: makine yerinde)
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
  const grip = r3(pickGrip(p.grip, ctx.L, ctx.backStock, ctx.machine));
  if (grip < 2) throw new Error(`${op.name}: parça boyu karşı iş milinde tutmak için çok kısa (en az ${r3(2 + subNut(ctx.machine).len + 0.5)} mm gerekir)`);
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
  const gap = Math.max(0.2, +p.gap || 1);           // hızlı yaklaşma boşluğu (tutma noktasının önünde)
  prog.rapid({ Z: r3(zGrip + gap) });
  prog.line({ Z: r3(zGrip) }, p.feed);
  prog.m('subChuckClose');
  prog.dwell(Math.max(0.1, +p.dwell || 0.3));       // pens kapanma beklemesi
  prog.wait(extra.w2);
  prog.wait(extra.w3);
  prog.m('spindleSyncOff');
  prog.rapid({ Z: park });
  op._grip = grip;
};

/** Karşı iş milinde gerçek tutma boyu: parça boyunu ve pens somunu çıkıntısını aşmaz
 *  (somun alnı kesme düzleminden en az 0.5 mm önde kalır — kesme bıçağına değmez). */
export function pickGrip(gripParam, L, backStock, machine) {
  return Math.min(+gripParam || 6, L - 1, L + (backStock || 0) - subNut(machine).len - 0.5);
}

/** Arka işlemlerde en büyük derinlik (G55 Z): pens somunu (pens alnından subNut().len çıkıntılı) arka takım uçlarına 1 mm yaklaşabilir */
export function backMaxDepth(ctx) { return ctx.L - ctx.grip - subNut(ctx.machine).len - 1; }

/** Eksenel arka işlemde (delme, kılavuz, alın frezesi) en büyük takım dalma boyu (G55 Z): karşı iş mili
 *  (somun, burun, flanş) arka ünitedeki komşu takımlara / tutuculara 0.5 mm'den fazla yaklaşmaz.
 *  Çarpışma kontrolüyle aynı gövdeler ve aynı kural (collision.subHitsBack). */
export function backAxialLimit(ctx, tool) {
  const p = ctx.L - ctx.grip;
  const lat = LAYOUT.backLat + (tool.yPos || 0);
  const bb = backBodies(ctx.tools), sb = subBodies(ctx.barR, ctx.machine);
  const hits = (z) => { const face = LAYOUT.backToolX + p - z; return sb.some(s => { const m = moved(s, face, 0, lat); return bb.some(b => subHitsBack(m, b, tool)); }); };
  if (hits(0)) return 0;
  let lo = 0, hi = 120;
  if (!hits(hi)) return hi;
  while (hi - lo > 0.01) { const mid = (lo + hi) / 2; if (hits(mid)) hi = mid; else lo = mid; }
  return Math.max(0, lo - 0.5);
}

/** Karşı iş mili bekleme konumu (G54 Z): parçanın önünde ve ön kovan takımlarının erişiminin dışında */
export function subPark(ctx) {
  let reach = 0;
  for (const t of ctx.tools.filter(t => t.unit === 'front')) reach = Math.max(reach, 58, rotaryProfile(t).length);
  const zMax = ctx.machine.axes.Z2.max;
  const park = Math.min(zMax, Math.max(ctx.L + 40, reach + 25));
  // uzun parça: Z2 sınırında beklenir; parça önü (L + pay) pens somununa 1 mm'den fazla yaklaşmamalı
  if (park - subNut(ctx.machine).len < ctx.L + (ctx.backStock || 0) + 1) throw new Error(`Parça (${ctx.L} mm) karşı iş mili bekleme konumuna sığmıyor (Z2 en çok ${zMax})`);
  return r3(park);
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
/** Parça bırakma makrosu (kayar otomat çevrim sonu): karşı iş mili durur, arka takımlardan uzaklaşır, makinedeki
 *  bırakma alanına (X2 yanal, isteğe bağlı Z2) gider; hava üfleme açık, pens açılır, itici parçayı iter, hava kapanır.
 *  Parça pensteyken bekleme konumuna (ön takımların önüne) DÖNÜLMEZ: örtüşen çevrimde ana kanal o sırada ön delme
 *  takımlarıyla çalışıyor olabilir (çarpışma kontrolü yakaladı). Varsayılan bırakma yeri arka ünite tarafında, uzakta. */
GEN.eject = (prog, ctx, op) => {
  const p = op?.params || {}, C = ctx.project.post.codes, ax = ctx.machine.axes;
  prog.spindle({ which: 'sub', dir: 'stop' });
  prog.workOffset('G55');
  prog.rapid({ Z: -5 });          // arka takımlardan uzaklaş
  prog.workOffset('G54');
  prog.comment('PARCA BIRAKMA');
  const x = +p.dropX || 0;
  if (x < ax.X2.min || x > ax.X2.max) throw new Error(`${op.name}: bırakma konumu X2 ${x} strok dışında (${ax.X2.min}…${ax.X2.max})`);
  prog.rapid({ X: r3(x) });       // önce yanal, sonra eksenel (çapraz hareket yok)
  if (p.dropZ != null && p.dropZ !== '') {
    const z = +p.dropZ;
    if (z < ax.Z2.min || z > ax.Z2.max) throw new Error(`${op.name}: bırakma konumu Z2 ${z} strok dışında (${ax.Z2.min}…${ax.Z2.max})`);
    prog.rapid({ Z: r3(z) });
  }
  const blow = Math.max(0, +p.blow || 0);
  if (blow && C.airBlowOn) prog.m('airBlowOn');
  prog.m('subChuckOpen');
  if (p.ejector !== false) prog.m('partEject');
  prog.dwell(Math.max(0.2, blow || 0.5));
  if (blow && C.airBlowOff) prog.m('airBlowOff');
};

// ================================================================ C/Y frezeleme (ana iş mili, çapraz tahrikli)
/** Tek düzlük: C açısında, Rloc dış çaptan h yüksekliğine kadar Y zikzak (startLive sonrası çağrılır) */
/** Düzlük/çokgen bölgesinin yerel yarıçapı: bölgenin içinden örneklenir (uçtaki flanş/omuz yarıçapı sayılmaz; hedef ve tanıma ile aynı) */
function flatLocalR(ctx, z0, z1) {
  let R = 0;
  const e = Math.min(0.1, (z1 - z0) / 4);
  for (let z = z0 + e; z <= z1 - e + 1e-9; z += 0.05) R = Math.max(R, ctx.rAt(z));
  return R;
}
/** Frezeleme desenleri (düzlük, çokgen, bölgesel frezeleme): düz pasolar veya dıştan içe spiral */
export const MILL_PATTERNS = {
  zigzagZ: 'Zikzak · Z yönünde',
  zigzagY: 'Zikzak · Y yönünde',
  onewayZ: 'Tek yön · Z yönünde',
  onewayY: 'Tek yön · Y yönünde',
  spiral: 'Spiral · dıştan içe',
};
/** lines: [{at, a, b}] — along ekseninde a→b, diğer eksen = at. Zikzakta komşu pasolar örtüşüyorsa kesmeden bağlanır;
 *  tek yönde her paso aynı yönde, aralarda kalkış (hep aynı freze yönü: aynı/ters yönlü kesme) */
function millLines(prog, lines, along, feed, x, xUp, oneway) {
  const other = along === 'Y' ? 'Z' : 'Y';
  lines.forEach((L, k) => {
    const rev = !oneway && k % 2 === 1;
    const [s, e] = rev ? [L.b, L.a] : [L.a, L.b];
    const prev = lines[k - 1];
    const linked = !oneway && prev && Math.min(prev.b, L.b) - Math.max(prev.a, L.a) > 0.05;
    if (!linked) { prog.rapid({ X: xUp }); prog.rapid({ [along]: r3(s), [other]: r3(L.at) }); prog.line({ X: x }, feed); }
    else {
      // önceki pasonun sonundan iki pasonun örtüşen ucuna, diğer eksende yeni pasoya, sonra pasonun başına
      const v = rev ? Math.min(prev.b, L.b) : Math.max(prev.a, L.a);
      prog.line({ [along]: r3(v) }, feed); prog.line({ [other]: r3(L.at) }, feed); prog.line({ [along]: r3(s) }, feed);
    }
    prog.line({ [along]: r3(e) }, feed);
  });
  prog.rapid({ X: xUp });
}
/** Spiral: kapalı konturlar dıştan içe; konturlar arası kesmeden geçiş */
function millLoops(prog, loops, feed, x, xUp) {
  loops.forEach((lp, k) => {
    if (k === 0) { prog.rapid({ X: xUp }); prog.rapid({ Y: r3(lp[0].y), Z: r3(lp[0].z) }); prog.line({ X: x }, feed); }
    else prog.line({ Y: r3(lp[0].y), Z: r3(lp[0].z) }, feed);
    for (const q of [...lp.slice(1), lp[0]]) prog.line({ Y: r3(q.y), Z: r3(q.z) }, feed);
  });
  prog.rapid({ X: xUp });
}
/** Dikdörtgen bölge deseni: takım merkezi z∈[za,zb], y∈[y0,y1] */
function rectPattern(pat, za, zb, y0, y1, step) {
  const span = (a, b) => { const n = Math.max(1, Math.ceil((b - a) / step - 1e-9)); return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n); };
  if (pat === 'spiral') {
    const loops = [];
    for (let d = 0; loops.length < 400; d += step) {
      const a = za + d, b = zb - d, c = y0 + d, e = y1 - d;
      if (b - a < 1e-3 || e - c < 1e-3) {
        // son: orta çizgi (dar kenar boyunca kalan şerit)
        const zm = (za + zb) / 2, ym = (y0 + y1) / 2;
        loops.push(zb - za >= y1 - y0 ? [{ z: Math.min(a, zm), y: ym }, { z: Math.max(b, zm), y: ym }] : [{ z: zm, y: Math.min(c, ym) }, { z: zm, y: Math.max(e, ym) }]);
        break;
      }
      loops.push([{ z: a, y: c }, { z: b, y: c }, { z: b, y: e }, { z: a, y: e }]);
    }
    return { loops };
  }
  if (pat === 'zigzagY' || pat === 'onewayY') return { along: 'Y', lines: (zb - za < 1e-6 ? [za] : span(za, zb)).map(z => ({ at: z, a: y0, b: y1 })), oneway: pat === 'onewayY' };
  return { along: 'Z', lines: span(y0, y1).map(y => ({ at: y, a: za, b: zb })), oneway: pat === 'onewayZ' };
}

function flatPasses(prog, ctx, tool, c, depth, z0, z1, p, feed) {
  const rt = tool.dia / 2;
  const Rloc = flatLocalR(ctx, z0, z1);
  const h = Rloc - depth;
  if (h < 0) throw new Error('düzlük derinliği yarıçaptan büyük');
  if (z1 - z0 < tool.dia - 1e-6) throw new Error(`düzlük boyu (${r3(z1 - z0)}) takım çapından (${tool.dia}) küçük`);
  const b = Math.sqrt(Math.max(0, Rloc * Rloc - h * h));
  const za = r3(z0 + rt), zb = r3(Math.max(z0 + rt, z1 - rt));
  const yMax = b + 0.3;
  const levels = [];
  for (let lv = Rloc - p.ap; lv > h + 1e-6; lv -= p.ap) levels.push(lv);
  levels.push(h);
  prog.rapid({ X: ctx.safeX });
  prog.rapid({ C: r3(c) });
  // seçilen desen her katta düzlüğün dikdörtgen bölgesinde (takım merkezi z∈[za,zb], y∈[−yMax,yMax])
  const pat = p.pattern || 'zigzagZ';
  const step = Math.max(0.05, p.stepover * tool.dia), xUp = r3(2 * (Rloc + 1));
  const D = rectPattern(pat, za, zb, -yMax, yMax, step);
  goto(prog, ctx, xUp, D.loops ? D.loops[0][0].z : D.along === 'Z' ? za : D.lines[0].at, D.loops ? D.loops[0][0].y : -yMax);
  for (const lv of levels) {
    const x = r3(2 * lv);
    // Z boyu ≈ 0 ise (düzlük boyu = takım çapı) Z pasoları boş: yalnız uç süpürmesi
    if (D.loops) millLoops(prog, D.loops, feed, x, xUp); else if (D.along !== 'Z' || zb - za > 0.05) millLines(prog, D.lines, D.along, feed, x, xUp, D.oneway);
    // Z yönlü desenlerden sonra uç temizliği: düzlük uçlarında (za, zb) tam Y süpürmesi → pasolar arası tarak izi kalmaz
    if (D.along === 'Z') millLines(prog, za < zb - 1e-6 ? [{ at: zb, a: -yMax, b: yMax }, { at: za, a: -yMax, b: yMax }] : [{ at: za, a: -yMax, b: yMax }], 'Y', feed, x, xUp, D.oneway);
  }
  prog.rapid({ Y: 0 });
}

/** Çokgenin z düşey doğrusuyla kesişimi: y aralıkları (çift-tek) */
function sliceY(poly, z) {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) ys.push(a.y + (b.y - a.y) * (z - a.z) / (b.z - a.z));
  }
  ys.sort((p, q) => p - q);
  const out = [];
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]]);
  return out;
}
/** Takım merkezinin z'de girebileceği y aralığı: diskin bütün kirişleri bölge içinde kalır (tutucu sınır) */
function centerRange(poly, z, rt) {
  let lo = -Infinity, hi = Infinity;
  const n = 8;
  for (let k = -n; k <= n; k++) {
    const dz = (rt * k) / n, w = Math.sqrt(Math.max(0, rt * rt - dz * dz));
    const iv = sliceY(poly, z + dz);
    if (!iv.length) return null;
    // merkezin bulunduğu aralık: en geniş olanı seç (basit bölge varsayımı)
    const [a, b] = iv.reduce((m, q) => (q[1] - q[0] > m[1] - m[0] ? q : m), iv[0]);
    lo = Math.max(lo, a + w); hi = Math.min(hi, b - w);
  }
  return hi - lo > 1e-3 ? [lo, hi] : null;
}
/** İçbükey olmayan çokgeni d kadar içe ofsetle (kenar pasosu); içbükeyse null */
function insetConvex(poly, d) {
  const n = poly.length;
  let area = 0; for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a.z * b.y - b.z * a.y; }
  const s = Math.sign(area) || 1;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n]; if (Math.sign((b.z - a.z) * (c.y - b.y) - (b.y - a.y) * (c.z - b.z)) === -s) return null; }
  const lines = poly.map((a, i) => { const b = poly[(i + 1) % n], L = Math.hypot(b.z - a.z, b.y - a.y) || 1; const nz = -s * (b.y - a.y) / L, ny = s * (b.z - a.z) / L; return { a: { z: a.z + nz * d, y: a.y + ny * d }, u: { z: (b.z - a.z) / L, y: (b.y - a.y) / L } }; });
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = lines[(i + n - 1) % n], q = lines[i];
    const den = p.u.z * q.u.y - p.u.y * q.u.z;
    if (Math.abs(den) < 1e-9) { out.push(q.a); continue; }
    const t = ((q.a.z - p.a.z) * q.u.y - (q.a.y - p.a.y) * q.u.z) / den;
    out.push({ z: p.a.z + p.u.z * t, y: p.a.y + p.u.y * t });
  }
  // ofset çökmesin
  let a2 = 0; for (let i = 0; i < n; i++) { const a = out[i], b = out[(i + 1) % n]; a2 += a.z * b.y - b.z * a.y; }
  return Math.sign(a2) === s && Math.abs(a2) > 1e-6 ? out : null;
}
/** Bölgesel frezeleme: C konumla, Y–Z düzleminde serbest çokgen bölgeyi parmak frezeyle katlar halinde tara */
GEN.areaMill = (prog, ctx, op, tool) => {
  const p = op.params, rt = tool.dia / 2;
  const poly = (p.region || []).map(q => ({ z: +q.z, y: +q.y })).filter(q => Number.isFinite(q.z) && Number.isFinite(q.y));
  if (poly.length < 3) throw new Error(`${op.name}: bölge en az 3 köşeli olmalı`);
  const zs = poly.map(q => q.z), zmin = Math.min(...zs), zmax = Math.max(...zs);
  if (zmin < -0.01 || zmax > ctx.L + 0.01) throw new Error(`${op.name}: bölge parça boyu (0–${r3(ctx.L)}) dışında`);
  let Rloc = 0;
  for (let z = zmin; z <= zmax + 1e-9; z += 0.05) Rloc = Math.max(Rloc, ctx.rAt(z));
  const h = Rloc - (+p.depth || 0);
  if (!(p.depth > 0)) throw new Error(`${op.name}: derinlik 0’dan büyük olmalı`);
  if (h < 0) throw new Error(`${op.name}: derinlik (${p.depth}) yerel yarıçaptan (${r3(Rloc)}) büyük`);
  const step = Math.max(0.05, (+p.stepover || 0.5) * tool.dia);
  // tarama doğruları (sabit Z, Y boyunca)
  const lines = [];
  for (let z = zmin + rt; z <= zmax - rt + 1e-6; z += step) { const r = centerRange(poly, z, rt); if (r) lines.push({ z: r3(z), y0: r3(r[0]), y1: r3(r[1]) }); }
  if (!lines.length) { const zc = (zmin + zmax) / 2, r = centerRange(poly, zc, rt); if (r) lines.push({ z: r3(zc), y0: r3(r[0]), y1: r3(r[1]) }); }
  if (!lines.length) throw new Error(`${op.name}: bölge takım çapından (Ø${tool.dia}) dar — daha küçük freze seçin`);
  // seçilen desen: Z yönünde doğrular (eksenleri değiştirilmiş çokgende aynı hesap) veya spiral (dışbükey bölge)
  const pat = p.pattern || 'zigzagY';
  let alt = null;
  if (pat === 'zigzagZ' || pat === 'onewayZ') {
    const sw = poly.map(q => ({ z: q.y, y: q.z })), ys = sw.map(q => q.z), ya = Math.min(...ys), yb = Math.max(...ys);
    const L2 = [];
    for (let y = ya + rt; y <= yb - rt + 1e-6; y += step) { const r = centerRange(sw, y, rt); if (r) L2.push({ at: y, a: r[0], b: r[1] }); }
    if (L2.length) alt = { along: 'Z', lines: L2, oneway: pat === 'onewayZ' };
  } else if (pat === 'onewayY') alt = { along: 'Y', lines: lines.map(L => ({ at: L.z, a: L.y0, b: L.y1 })), oneway: true };
  else if (pat === 'spiral') {
    const loops = [];
    for (let d = rt; loops.length < 400; d += step) { const q = insetConvex(poly, d); if (!q) break; loops.push(q); }
    if (loops.length) alt = { loops };
    else prog.comment('SPIRAL ICIN DISBUKEY BOLGE GEREKIR - ZIKZAK');
  }
  const levels = [];
  const ap = Math.max(0.05, +p.ap || 0.5);
  for (let lv = Rloc - ap; lv > h + 1e-6; lv -= ap) levels.push(lv);
  levels.push(h);
  const { feed } = liveData(ctx, tool);
  const xUp = r3(2 * (Rloc + 1));
  startLive(prog, ctx, tool, +p.c || 0);
  prog.comment(`BOLGE C${r3(+p.c || 0)} Z${r3(zmin)}-${r3(zmax)} DERINLIK ${r3(p.depth)}`);
  for (const lv of levels) {
    const x = r3(2 * lv);
    if (alt) { if (alt.loops) millLoops(prog, alt.loops, feed, x, xUp); else millLines(prog, alt.lines, alt.along, feed, x, xUp, alt.oneway); continue; }
    lines.forEach((L, k) => {
      const [ya, yb] = k % 2 === 0 ? [L.y0, L.y1] : [L.y1, L.y0];
      const prev = lines[k - 1];
      // komşu doğruya geçiş: aralıklar örtüşüyorsa kesmeden geç, değilse kalk
      const linked = prev && Math.abs(prev.z - L.z) <= step + 1e-6 && Math.min(prev.y1, L.y1) - Math.max(prev.y0, L.y0) > 0.05 && k > 0;
      if (!linked) { prog.rapid({ X: xUp }); prog.rapid({ Y: ya, Z: L.z }); prog.line({ X: x }, feed); }
      else { prog.line({ Y: Math.max(L.y0, Math.min(L.y1, k % 2 === 0 ? L.y0 : L.y1)) }, feed); prog.line({ Z: L.z }, feed); }
      prog.line({ Y: yb }, feed);
    });
    prog.rapid({ X: xUp });
  }
  // kenar pasosu: bölgenin takım yarıçapı kadar içinden (dışbükey bölgeler)
  if (p.contour) {
    const ins = insetConvex(poly, rt);
    if (ins) {
      const x = r3(2 * h);
      prog.rapid({ Y: r3(ins[0].y), Z: r3(ins[0].z) });
      prog.line({ X: x }, feed);
      for (const q of [...ins.slice(1), ins[0]]) prog.line({ Y: r3(q.y), Z: r3(q.z) }, feed);
      prog.rapid({ X: xUp });
    } else prog.comment('KENAR PASOSU YOK (ICBUKEY BOLGE)');
  }
  prog.rapid({ Y: 0 });
  endLive(prog, ctx);
};

/** Çokgen (altıgen, kare…): her kenar bir düzlük, C ile indekslenir */
GEN.polygonMill = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'polygon');
  if (!(f.n >= 3)) throw new Error(`${op.name}: kenar sayısı en az 3 olmalı`);
  const Rloc = flatLocalR(ctx, f.z0, f.z1);
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

/** Yazı geometrisi (hedef model ve takım yolu ortak): her çizgi [{z, c}] — yazı C yönünde, yükseklik Z yönünde */
export function engraveStrokes(f, R) {
  const { strokes } = textStrokes(f.text || '', f.height);
  const k = 180 / (Math.PI * R);
  return strokes.map(st => st.map(p => ({ c: f.c + p.x * k, z: f.z - f.height / 2 + p.y })));
}

/** Çapa yazı: her çizgi silindirik interpolasyonla (G7.1), çizgiler arası G7.1 kapalı + hızlı konumlama */
GEN.engrave = (prog, ctx, op, tool) => {
  const f = featureOf(ctx, op, 'engrave');
  const bad = unsupportedChars(f.text || '');
  if (bad.length) throw new Error(`${op.name}: desteklenmeyen karakter: ${bad.join(' ')}`);
  if (!(f.height > 0) || !(f.depth > 0)) throw new Error(`${op.name}: yazı yüksekliği ve derinliği girin`);
  if (tool.dia > f.height / 2 + 1e-9) throw new Error(`${op.name}: Ø${tool.dia} takım ${f.height} mm yazı için kalın (en çok yükseklik/2)`);
  const rt = tool.dia / 2;
  let Rmin = Infinity, Rmax = 0;
  for (let z = f.z - f.height / 2 - rt; z <= f.z + f.height / 2 + rt + 1e-9; z += 0.05) { const r = ctx.rAt(z); Rmin = Math.min(Rmin, r); Rmax = Math.max(Rmax, r); }
  if (Rmax - Rmin > 0.01) throw new Error(`${op.name}: yazı bölgesi silindirik değil (Ø${r3(2 * Rmin)}…Ø${r3(2 * Rmax)})`);
  const R = Rmax;
  const strokes = engraveStrokes(f, R);
  if (!strokes.length) throw new Error(`${op.name}: yazı boş`);
  const { feed } = liveData(ctx, tool);
  const xTop = r3(2 * (R + 0.5)), xCut = r3(2 * (R - f.depth));
  startLive(prog, ctx, tool, r3(strokes[0][0].c));
  goto(prog, ctx, xTop, r3(strokes[0][0].z));
  for (const st of strokes) {
    prog.rapid({ X: xTop });
    prog.rapid({ Z: r3(st[0].z), C: r3(st[0].c) });
    prog.line({ X: xCut }, Math.round(feed * 0.5));
    prog.cyl(r3(R));
    for (const q of st.slice(1)) prog.line({ Z: r3(q.z), C: r3(q.c) }, feed);
    prog.cyl(0);
    prog.rapid({ X: xTop });
  }
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
  const E = insertEdges(tool);
  const back = tool.backAngle ?? (E.round ? 89 : Math.max(1, E.back - 2));
  const env = turnableEnvelope(B, back, E.round ? 0 : E.front);
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
  if (f.depth > backAxialLimit(ctx, tool)) throw new Error(`${op.name}: kanal derinliği (${f.depth}) arka işleme sınırını (${r3(backAxialLimit(ctx, tool))}) aşıyor — karşı iş mili arka ünitedeki takımlara çarpar`);
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
  if (f.depth > backAxialLimit(ctx, tool)) throw new Error(`${op.name}: derinlik (${f.depth}) arka işleme sınırını (${r3(backAxialLimit(ctx, tool))}) aşıyor — karşı iş mili arka ünitedeki takımlara çarpar`);
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
