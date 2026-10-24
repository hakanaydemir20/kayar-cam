// Form tanımları ve küçük DOM yardımcıları
import { TOOL_TYPES, UNITS } from '../tools/toolLibrary.js';

export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const OP_PARAMS = {
  face: [['ap', 'Paso derinliği (Z)', 'mm'], ['feed', 'İlerleme (boş = takım)', 'mm/dev'], ['vc', 'Kesme hızı (boş = takım)', 'm/dak']],
  rough: [['ap', 'Paso derinliği (radyal)', 'mm'], ['allowX', 'Finiş payı X (çapta)', 'mm'], ['allowZ', 'Finiş payı Z', 'mm'], ['retract', 'Geri çekme', 'mm'], ['feed', 'İlerleme (boş = takım)', 'mm/dev'], ['vc', 'Kesme hızı (boş = takım)', 'm/dak'], ['contourPass', 'Yarı finiş kontur pasosu', 'bool']],
  finish: [['feed', 'İlerleme (boş = takım)', 'mm/dev'], ['vc', 'Kesme hızı (boş = takım)', 'm/dak'], ['tol', 'Kontur toleransı', 'mm']],
  groove: [['z0', 'Kanal başlangıç Z', 'mm'], ['z1', 'Kanal bitiş Z', 'mm'], ['allow', 'Kaba dalış payı', 'mm'], ['feed', 'İlerleme (boş = takım)', 'mm/dev'], ['vc', 'Kesme hızı (boş = takım)', 'm/dak']],
  thread: [['featureId', 'Diş özelliği', 'feat:thread'], ['firstDepth', 'İlk paso derinliği (radyal)', 'mm'], ['springPasses', 'Boş (yay) paso', 'adet'], ['rpm', 'Devir (boş = Vc’den)', 'dev/dak']],
  center: [['featureId', 'Delik', 'feat:axialHole:front'], ['spotDia', 'Punta pah çapı (boş = delik+0.4)', 'mm']],
  drill: [['featureId', 'Delik', 'feat:axialHole:front'], ['peck', 'Gagalama (boş = 1.5×D)', 'mm'], ['feed', 'İlerleme (boş = takım)', 'mm/dev']],
  tap: [['featureId', 'Delik', 'feat:axialHole:front']],
  crossDrill: [['featureId', 'Çapraz delik', 'feat:crossHole'], ['peck', 'Gagalama (radyal)', 'mm']],
  flatMill: [['featureId', 'Düzlük', 'feat:flat'], ['ap', 'Paso (radyal)', 'mm'], ['stepover', 'Yanal adım (×D)', '']],
  pocketMill: [['featureId', 'Cep', 'feat:pocket'], ['stepDown', 'Helis adımı (devir başına)', 'mm'], ['stepOver', 'Yanal adım', 'mm']],
  pickoff: [['grip', 'Tutma boyu', 'mm'], ['feed', 'Yaklaşma ilerlemesi', 'mm/dak']],
  cutoff: [['feed', 'İlerleme (boş = takım)', 'mm/dev'], ['rpm', 'Devir (boş = Vc’den, senkron)', 'dev/dak'], ['endX', 'Bitiş X (çap)', 'mm']],
  backDrill: [['featureId', 'Arka delik', 'feat:axialHole:back'], ['peck', 'Gagalama', 'mm'], ['feed', 'İlerleme (boş = takım)', 'mm/dev']],
  backTap: [['featureId', 'Arka delik', 'feat:axialHole:back']],
  eject: [],
  rechuck: [],
};

export const TOOL_FIELDS = [
  ['num', 'T No', '', 'int'], ['offset', 'Ofset No', '', 'int'],
  ['name', 'Ad', '', 'text', 'full'],
  ['type', 'Tip', '', 'select:type'], ['unit', 'Ünite', '', 'select:unit'],
  ['dia', 'Çap', 'mm'], ['noseR', 'Uç radyüsü', 'mm'],
  ['width', 'Genişlik (kanal/kesme)', 'mm'], ['pitch', 'Hatve (kılavuz)', 'mm'],
  ['insertAngle', 'Kesici uç açısı', '°'], ['tipAngle', 'Uç açısı (matkap)', '°'],
  ['flutes', 'Ağız sayısı', 'adet', 'int'], ['vc', 'Kesme hızı Vc', 'm/dak'],
  ['feed', 'İlerleme (dev başına)', 'mm/dev'], ['fz', 'Diş başı ilerleme', 'mm/diş'],
  ['yPos', 'Yanal konum (Y1 / arka ünite)', 'mm'],
  ['xPos', 'Radyal montaj (X1, − aşağı)', 'mm'],
];

export const FEATURE_FIELDS = {
  axialHole: [['side', 'Taraf', 'select:side'], ['dia', 'Çap', 'mm'], ['depth', 'Derinlik', 'mm'], ['through', 'Boydan', 'bool']],
  crossHole: [['dia', 'Çap', 'mm'], ['z', 'Z konumu', 'mm'], ['c', 'C açısı', '°'], ['y', 'Y kaçıklık', 'mm'], ['through', 'Boydan', 'bool'], ['depthDia', 'Kör: dip çapı X', 'mm']],
  flat: [['c', 'C açısı', '°'], ['depth', 'Derinlik (dış çaptan)', 'mm'], ['z0', 'Z başlangıç', 'mm'], ['z1', 'Z bitiş', 'mm']],
  thread: [['dia', 'Nominal çap', 'mm'], ['pitch', 'Hatve', 'mm'], ['z0', 'Z başlangıç', 'mm'], ['z1', 'Z bitiş', 'mm']],
  pocket: [['dia', 'Cep çapı', 'mm'], ['depth', 'Derinlik', 'mm'], ['z', 'Z konumu', 'mm'], ['c', 'C açısı', '°']],
};
export const FEATURE_LABELS = { axialHole: 'Eksenel Delik', crossHole: 'Çapraz Delik', flat: 'Düzlük', thread: 'Diş', pocket: 'Cep' };

export function featureText(f) {
  switch (f.type) {
    case 'axialHole': return `${f.side === 'back' ? 'Arka' : 'Ön'} Ø${f.dia} × ${f.depth}${f.through ? ' (boydan)' : ''}`;
    case 'crossHole': return `Ø${f.dia} Z${f.z} C${f.c}°${f.through ? ' boydan' : ''}`;
    case 'flat': return `C${f.c}° derinlik ${f.depth}  Z${f.z0}–${f.z1}`;
    case 'thread': return `M${f.dia}×${f.pitch}  Z${f.z0}–${f.z1}`;
    case 'pocket': return `Ø${f.dia} derinlik ${f.depth} Z${f.z} C${f.c}°`;
    default: return f.type;
  }
}

/** Genel alan oluşturucu. get/set obj alanı; onChange çağrılır */
export function field(obj, key, label, unit, kind, onChange, opts = {}) {
  const lab = h('label', {}, label, unit ? h('span', { class: 'u' }, unit) : null);
  let inp;
  const v = obj[key];
  if (kind === 'bool') {
    inp = h('input', { type: 'checkbox' });
    inp.checked = !!v;
    inp.addEventListener('change', () => { obj[key] = inp.checked; onChange(key); });
  } else if (kind && kind.startsWith('select:')) {
    const which = kind.slice(7);
    const items = opts.items || (which === 'type' ? Object.entries(TOOL_TYPES).map(([k, d]) => [k, d.label])
      : which === 'unit' ? Object.entries(UNITS).map(([k, d]) => [k, d.label])
        : which === 'side' ? [['front', 'Ön'], ['back', 'Arka']] : []);
    inp = h('select', {}, items.map(([k, l]) => h('option', { value: k }, l)));
    inp.value = v ?? '';
    const numeric = items.length && typeof items[items.length - 1][0] === 'number';
    inp.addEventListener('change', () => { obj[key] = inp.value === '' ? null : numeric ? parseFloat(inp.value) : inp.value; onChange(key); });
  } else if (kind === 'text') {
    inp = h('input', { type: 'text', value: v ?? '' });
    inp.style.fontFamily = 'var(--ui)'; inp.style.color = 'var(--t1)';
    inp.addEventListener('change', () => { obj[key] = inp.value; onChange(key); });
  } else {
    inp = h('input', { type: 'number', step: kind === 'int' ? '1' : 'any', value: v ?? '' });
    inp.addEventListener('change', () => {
      const s = inp.value.trim();
      obj[key] = s === '' ? null : kind === 'int' ? parseInt(s) : parseFloat(s);
      onChange(key);
    });
  }
  return h('div', { class: 'f' + (opts.full ? ' full' : '') }, lab, inp);
}
