// Özellik işlemleri planı (kaba otomatik): tanınan geometriler → işlem + en uygun takım (önce taretteki, yoksa takılacak hazır takım).
// Sıra: diş → punta → delme → kılavuz → çapraz delme → frezeleme (düzlük, çokgen, cep, çap kanalı, yazı) → karşı iş mili (arka delme, arka alın).
import { TOOL_CATALOG, MATERIALS, STATIONS, toolNo } from '../tools/toolLibrary.js';
import { frontDrillReach } from '../tools/toolGeom.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;
const catItems = (pred) => TOOL_CATALOG.flatMap(g => g.items).filter(it => pred(it.p));

/** P: proje · mat: malzeme anahtarı. Dönen adımlar: { key, type, featureId, name, title, desc, side, tool? | preset? } */
export function featurePlan(P, mat = P.stock.material || 'free', reserved = new Set()) {
  const M = MATERIALS[mat] || MATERIALS.free;
  const mc = P.machine, f = P.part.features;
  const steps = [], warn = [];
  // istasyon sırası ve kapasitesi (STATIONS): arka ünite ile arka kovan aynı X2 sırasını paylaşır
  const ROWS = { gang: ['gang'], cross: ['cross'], front: ['front'], back: ['back', 'rear'], rear: ['back', 'rear'] };
  const CAP = { gang: STATIONS.gang.length, cross: STATIONS.cross.length, front: STATIONS.front.xPos.length, back: STATIONS.back.length, rear: STATIONS.back.length };
  const planned = {}, replaced = new Set();
  // istasyon dolu ise: bu programda kullanılmayan bir takımın yerine (aynı T no, ofset ve konum)
  const spare = (row) => P.tools.find(x => row.includes(x.unit) && !replaced.has(x.id) && !reserved.has(x.id) && !P.ops.some(o => o.toolId === x.id) && !steps.some(s => s.tool === x));
  const station = (unit) => {
    const row = ROWS[unit] || [unit], rk = row.join();
    const used = P.tools.filter(x => row.includes(x.unit)).length + (planned[rk] || 0);
    if (used < CAP[unit]) { planned[rk] = (planned[rk] || 0) + 1; return {}; }
    const x = spare(row);
    if (!x) return null;
    replaced.add(x.id);
    return { unit: x.unit, num: x.num, offset: x.offset ?? x.num, yPos: x.yPos, xPos: x.xPos, _replace: x.id, _replaceName: `${toolNo(x)} ${x.name}` };
  };
  const presets = new Map();   // aynı takım birden çok adımda: tek preset (tek kez takılır)
  const UNIT_TXT = { gang: 'gang plakasında', cross: 'çapraz tahrikli ünitede', front: 'ön delme kolonunda (T35)', back: 'arka ünitede', rear: 'arka ünitede' };
  const preset = (key, p) => {
    if (presets.has(key)) return presets.get(key);
    const st = station(p.unit);
    if (!st) warn.push(`${p.name}: ${UNIT_TXT[p.unit] || 'ünitede'} boş ya da bu programda kullanılmayan istasyon yok.`);
    const q = st ? { ...p, ...st } : null;
    presets.set(key, q);
    return q;
  };
  const ofExisting = (type, fid, ok) => {
    // kullanıcının o özellik için seçtiği takım uygunsa korunur
    const op = P.ops.find(o => o.type === type && o.params?.featureId === fid);
    const t = op && P.tools.find(x => x.id === op.toolId);
    return t && ok(t) ? t : null;
  };
  const pick = (type, feat, ok, rank, mk) => {
    const own = ofExisting(type, feat.id, ok);
    if (own) return { tool: own };
    const on = P.tools.filter(x => !replaced.has(x.id) && ok(x)).sort(rank || (() => 0))[0];
    if (on) return { tool: on };
    const p = mk();
    return p ? { preset: p } : null;
  };
  const add = (type, feat, title, desc, t, side = 'front', params = null) => {
    if (!t) return false;
    steps.push({ key: `${type}:${feat.id}`, type, featureId: feat.id, name: title, title, desc, side, ...t, ...(params ? { params } : {}) });
    return true;
  };
  const drillFeed = (d) => +Math.min(0.2, 0.02 + d * 0.01).toFixed(3);
  const millPreset = (d) => {
    const it = catItems(p => p.type === 'endmill' && p.unit === 'cross' && near(p.dia, d))[0];
    return preset('em' + d, { ...(it?.p || { name: `Parmak Freze Ø${d}`, type: 'endmill', unit: 'cross', dia: d, fz: +(0.005 + d * 0.003).toFixed(3), flutes: d <= 3 ? 2 : 3 }), vc: M.vcMill });
  };
  const MILLS = [6, 5, 4, 3, 2];
  const em = (t) => t.type === 'endmill' && t.unit === 'cross';

  // 1) dış diş: finiş sonrası
  for (const th of f.filter(x => x.type === 'thread')) {
    const t = pick('thread', th, x => x.type === 'thread' && x.channel === 1, (a, b) => (near(b.pitch, th.pitch) ? 1 : 0) - (near(a.pitch, th.pitch) ? 1 : 0), () => {
      const it = catItems(p => p.type === 'thread' && p.unit === 'gang' && near(p.pitch || 0, th.pitch))[0] || catItems(p => p.type === 'thread' && p.unit === 'gang')[0];
      return it && preset('th' + it.p.name, { ...it.p });
    });
    add('thread', th, `Diş M${th.dia}×${th.pitch}`, `Z ${th.z0}–${th.z1} · G76`, t);
  }
  // 2) ön eksenel delikler: punta (hepsi) → delme
  const front = f.filter(x => x.type === 'axialHole' && x.side !== 'back');
  const maxFront = mc.stations?.frontSleeve?.maxDrill ?? 12;
  for (const hl of front) {
    if (hl.dia > maxFront + 1e-6) { warn.push(`Ön Ø${hl.dia} delik ön kovan kapasitesini (Ø${maxFront}) aşıyor: delinmez, iç tornalama gerekir.`); continue; }
    const t = pick('center', hl, x => x.type === 'center' && x.unit === 'front', (a, b) => b.dia - a.dia, () => {
      const it = catItems(p => p.type === 'center' && p.unit === 'front').sort((a, b) => b.p.dia - a.p.dia)[0];
      return it && preset('ctr', { ...it.p });
    });
    add('center', hl, `Punta Ø${hl.dia}`, 'Matkap girişi için merkez', t);
  }
  const L = P.part.length, r2 = (v) => Math.round(v * 100) / 100;
  for (const hl of front.filter(x => x.dia <= maxFront + 1e-6)) {
    const t = pick('drill', hl, x => x.type === 'drill' && x.unit === 'front' && near(x.dia, hl.dia), null,
      () => preset('dr' + hl.dia, { name: `Matkap Ø${hl.dia}`, type: 'drill', unit: 'front', dia: hl.dia, vc: M.vcDrill, feed: drillFeed(hl.dia), xPos: -52 }));
    if (!t) continue;
    // önden erişim: matkabın kesici boyu ve ön kovan bloğu. Boydan delik erişimden uzunsa önden + arkadan (parça alındıktan sonra) bölünür
    const dt = t.tool || { type: 'drill', unit: 'front', dia: hl.dia, tipAngle: 118, ...t.preset };
    const tip = (hl.dia / 2) / Math.tan(((dt.tipAngle || 118) / 2) * Math.PI / 180), reach = frontDrillReach(dt);
    if (hl.depth + tip + (hl.through ? 0.5 : 0) <= reach + 1e-6) {
      add('drill', hl, `Delme Ø${hl.dia}`, `${hl.through ? 'Boydan' : 'Derinlik ' + hl.depth} · gagalama otomatik`, t);
    } else if (hl.through) {
      const fd = Math.floor((reach - tip - 0.05) * 100) / 100, bd = r2(L - fd + 0.3);
      add('drill', hl, `Delme Ø${hl.dia} (ön kısım)`, `Önden ${fd} mm (Ø${hl.dia} matkap erişimi Z${r2(reach)}) · kalanı arkadan`, t, 'front', { depth: fd, through: false });
      const bt = pick('backDrill', hl, x => x.type === 'drill' && x.channel === 2 && near(x.dia, hl.dia), null,
        () => preset('bd' + hl.dia, { name: `Arka Matkap Ø${hl.dia}`, type: 'drill', unit: 'back', dia: hl.dia, vc: M.vcDrill, feed: drillFeed(hl.dia) }));
      add('backDrill', hl, `Delme Ø${hl.dia} (arka kısım)`, `Arkadan ${bd} mm · ön delikle 0.3 mm bindirme`, bt, 'back', { depth: bd, through: false });
    } else {
      warn.push(`Ön Ø${hl.dia} delik (derinlik ${hl.depth}) Ø${hl.dia} matkabın önden erişimini (Z${r2(reach)}) aşıyor: daha uzun ağızlı matkap gerekir.`);
      continue;
    }
    if (hl.flat && !hl.through) warn.push(`Ön Ø${hl.dia} delik düz dipli: matkap konik dip bırakır (parmak freze ya da iç tornalama gerekir).`);
  }
  // 3) çapraz delikler (tahrikli)
  const maxCross = mc.liveTools?.cross?.maxDrill ?? 7;
  for (const ch of f.filter(x => x.type === 'crossHole')) {
    if (ch.dia > maxCross + 1e-6) { warn.push(`Çapraz Ø${ch.dia} delik çapraz ünite kapasitesini (Ø${maxCross}) aşıyor.`); continue; }
    const t = pick('crossDrill', ch, x => x.type === 'ldrill' && x.unit === 'cross' && near(x.dia, ch.dia), null,
      () => preset('ld' + ch.dia, { name: `Tahrikli Matkap Ø${ch.dia}`, type: 'ldrill', unit: 'cross', dia: ch.dia, vc: M.vcDrill, fz: +(0.01 + ch.dia * 0.006).toFixed(3), flutes: 2 }));
    add('crossDrill', ch, `Çapraz delik Ø${ch.dia}`, `Z ${ch.z} · C${ch.c}°${ch.through ? ' · boydan' : ''}`, t);
  }
  // 4) frezeleme
  for (const fl of f.filter(x => x.type === 'flat')) {
    const len = Math.abs(fl.z1 - fl.z0);
    const t = pick('flatMill', fl, x => em(x) && x.dia <= len + 1e-6, (a, b) => b.dia - a.dia, () => { const d = MILLS.find(d => d <= len + 1e-6); return d && millPreset(d); });
    if (!add('flatMill', fl, `Düzlük C${fl.c}°`, `Z ${fl.z0}–${fl.z1} · derinlik ${fl.depth}`, t)) warn.push(`Düzlük C${fl.c}° (boy ${len}) için yeterince küçük freze yok.`);
  }
  for (const pg of f.filter(x => x.type === 'polygon')) {
    const len = Math.abs(pg.z1 - pg.z0);
    const t = pick('polygonMill', pg, x => em(x) && x.dia <= len + 1e-6, (a, b) => b.dia - a.dia, () => { const d = MILLS.find(d => d <= len + 1e-6); return d && millPreset(d); });
    if (!add('polygonMill', pg, `Çokgen ${pg.n}×AA${pg.af}`, `Z ${pg.z0}–${pg.z1} · ${pg.n} yüz`, t)) warn.push(`Çokgen (boy ${len}) için yeterince küçük freze yok.`);
  }
  for (const pk of f.filter(x => x.type === 'pocket')) {
    const t = pick('pocketMill', pk, x => em(x) && x.dia < pk.dia - 1e-6, (a, b) => b.dia - a.dia, () => { const d = MILLS.find(d => d < pk.dia - 1e-6); return d && millPreset(d); });
    if (!add('pocketMill', pk, `Cep Ø${pk.dia}`, `Z ${pk.z} · C${pk.c}° · derinlik ${pk.depth} · helis`, t)) warn.push(`Ø${pk.dia} cep için daha küçük freze gerekir.`);
  }
  for (const sl of f.filter(x => x.type === 'odSlot')) {
    const t = pick('cylSlot', sl, x => em(x) && near(x.dia, sl.width), null, () => millPreset(sl.width));
    add('cylSlot', sl, `Çap kanalı ${sl.width}`, `G7.1 · derinlik ${sl.depth}`, t);
  }
  for (const e of f.filter(x => x.type === 'engrave')) {
    const t = pick('engrave', e, em, (a, b) => a.dia - b.dia, () => millPreset(2));
    add('engrave', e, `Yazı “${e.text}”`, `h ${e.height} · derinlik ${e.depth}`, t);
  }
  // 5) karşı iş mili (parça alma gerekir)
  const backMax = mc.liveTools?.back?.maxDrillStatic ?? 8;
  for (const hl of f.filter(x => x.type === 'axialHole' && x.side === 'back')) {
    if (hl.dia > backMax + 1e-6) { warn.push(`Arka Ø${hl.dia} delik arka ünite kapasitesini (Ø${backMax}) aşıyor.`); continue; }
    const t = pick('backDrill', hl, x => x.type === 'drill' && x.channel === 2 && near(x.dia, hl.dia), null,
      () => preset('bd' + hl.dia, { name: `Arka Matkap Ø${hl.dia}`, type: 'drill', unit: 'back', dia: hl.dia, vc: M.vcDrill, feed: drillFeed(hl.dia) }));
    add('backDrill', hl, `Arka delme Ø${hl.dia}`, `Karşı iş milinde · derinlik ${hl.depth}`, t, 'back');
  }
  const backEm = (x) => x.type === 'endmill' && x.channel === 2 && x.live;
  // tahrikli takım yalnız arka ünitede
  const backMill = (d) => preset('bem' + d, { name: `Arka Freze Ø${d}`, type: 'endmill', unit: 'back', dia: d, vc: M.vcMill, fz: 0.015, flutes: 3, live: true });
  for (const sl of f.filter(x => x.type === 'faceSlot' && x.side === 'back')) {
    const t = pick('backSlot', sl, x => backEm(x) && near(x.dia, sl.width), null, () => backMill(sl.width));
    add('backSlot', sl, `Arka alın kanalı ${sl.width}`, `C2 · derinlik ${sl.depth}`, t, 'back');
  }
  for (const pg of f.filter(x => x.type === 'facePolygon' && x.side === 'back')) {
    const t = pick('backPolar', pg, backEm, (a, b) => b.dia - a.dia, () => backMill(4));
    add('backPolar', pg, `Arka çokgen ${pg.n}×AA${pg.af}`, `G12.1 · derinlik ${pg.depth}`, t, 'back');
  }
  return { steps, warn };
}
