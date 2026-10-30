// Ayarlar: tek kaynak (tanım + varsayılan), tarayıcıda saklanır. Ayarlar penceresi ve hızlı görünüm menüsü buradan üretilir.
import { h } from './forms.js';

const KEY = 'kayarcam.settings.v1';

/** [anahtar, etiket, tür, varsayılan, açıklama, seçenekler] — tür: bool | select | range */
export const SETTINGS = [
  { cat: 'view', icon: '◰', title: 'Görünüm', items: [
    ['view2', 'Açılışta grafik penceresi', 'select', '3d', '', [['3d', '3D simülasyon'], ['2d', '2D grafik (XZ kesit)']]],
    ['body', 'Makine iç yapısı', 'bool', true, 'Burç sütunu, kayar başlık, kızaklar, ünite gövdeleri'],
    ['cabin', 'Dış kaporta', 'bool', false, 'Makinenin dış sacı ve kapıları'],
    ['holders', 'Takım tutma blokları', 'bool', false, 'Gang plakası, çapraz ve kovan blokları, arka ünite gövdesi'],
    ['tools', 'Takımlar', 'select', 'active', '', [['active', 'Yalnız çalışan takım'], ['ghost', 'Çalışan + diğerleri saydam'], ['all', 'Tümü']]],
    ['path', 'Takım yolu', 'select', 'all', '', [['all', 'Tümü'], ['op', 'Çalışan işlem'], ['sel', 'Seçili işlem'], ['none', 'Gizli']]],
    ['ghost', 'Hedef parça (saydam)', 'bool', true, 'Bitmiş parçanın hayaleti'],
    ['edges', 'Kenar çizgileri', 'bool', true, 'Gölgeli + kenarlı görünüm (SolidWorks gibi)'],
    ['finishColor', 'Parça / stok renkleri', 'bool', true, 'Bitmiş ölçüye ulaşan yüzey mavi, işlenmemiş stok gri, fazla kesim kırmızı'],
    ['axes', 'Eksen okları ve koordinatlar', 'bool', false, 'X1 Y1 Z1 C1 X2 Z2 C2 okları'],
    ['legend', 'Hareket renk açıklaması', 'bool', true, 'G0 / G1 / G2-G3 / diş'],
    ['dro', 'Eksen göstergesi (DRO)', 'bool', true, 'Mutlak, makine ve kalan değerler'],
    ['coolant', 'Soğutma sıvısı efekti', 'bool', true, ''],
    ['bg', 'Grafik arka planı', 'select', 'gradient', '', [['gradient', 'Gri-mavi geçiş (CAM)'], ['dark', 'Koyu'], ['light', 'Açık']]],
  ] },
  { cat: 'sim', icon: '▶', title: 'Simülasyon', items: [
    ['speed', 'Varsayılan oynatma hızı', 'select', '1', '', [['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['5', '5×'], ['10', '10×'], ['25', '25×']]],
    ['verify', 'Verify renkleri', 'bool', false, 'Yeşil doğru · kırmızı fazla kesim · mavi kalan malzeme'],
    ['autoVerify', 'Her değişiklikte Verify ve çarpışma kontrolü', 'bool', true, 'Kapalıyken yalnız ⟳ ile çalışır'],
    ['stopOnCollision', 'Çarpışmada oynatmayı durdur', 'bool', true, ''],
    ['follow', 'Oynatırken G-kod satırını takip et', 'bool', true, ''],
  ] },
  { cat: 'code', icon: '≣', title: 'G-kod editörü', items: [
    ['code', 'G-kod paneli', 'bool', true, 'Sağ panel'],
    ['live', 'Yazarken canlı önizleme', 'bool', true, 'Her tuştan kısa süre sonra kod yeniden simüle edilir'],
    ['eob', 'Enter / Insert (EOB) satırı oynatsın', 'bool', true, ''],
    ['codeFont', 'Yazı boyutu', 'select', '12', '', [['11', 'Küçük'], ['12', 'Normal'], ['14', 'Büyük'], ['16', 'Çok büyük']]],
    ['colorize', 'Renkli kod', 'bool', true, 'G0 turuncu, G1 mavi, G2/G3 mor, M kodları sarı'],
  ] },
  { cat: 'ui', icon: '☰', title: 'Arayüz', items: [
    ['theme', 'Tema', 'select', 'dark', '', [['dark', 'Koyu'], ['light', 'Açık']]],
    ['uiScale', 'Yazı ve düğme boyutu', 'select', '100', '', [['90', 'Sıkı'], ['100', 'Normal'], ['112', 'Büyük'], ['125', 'Çok büyük']]],
    ['expert', 'Uzman seçenekleri', 'bool', false, 'Takım listesi, makine ayrıntıları, profil tablosu, ek parametreler'],
    ['startScreen', 'Açılışta başlangıç ekranı', 'bool', false, 'Kayıtlı çalışma varken de “Yeni parça” penceresi açılsın'],
    ['confirm', 'Silme ve sıfırlamada onay sor', 'bool', true, ''],
    ['statusbar', 'Durum çubuğu', 'bool', true, 'Alt satır: parça, çevrim süresi, sorunlar'],
  ] },
];

export const QUICK_VIEW = ['body', 'cabin', 'holders', 'tools', 'path', 'ghost', 'finishColor', 'edges', 'axes', 'dro', 'verify'];

export function defaults() {
  const o = {};
  for (const c of SETTINGS) for (const [k, , , d] of c.items) o[k] = d;
  return o;
}
export function loadSettings() {
  const o = defaults();
  try { Object.assign(o, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* */ }
  return o;
}
export function saveSettings(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* */ } }
export function settingDef(k) { for (const c of SETTINGS) for (const it of c.items) if (it[0] === k) return it; return null; }

/** Tek ayar denetimi: { el, set(v) } */
export function control(cfg, k, onChange, compact = false) {
  const [, label, type, , desc, items] = settingDef(k);
  let inp;
  if (type === 'bool') {
    inp = h('input', { type: 'checkbox', role: 'switch' });
    inp.checked = !!cfg[k];
    inp.addEventListener('change', () => { cfg[k] = inp.checked; onChange(k); });
  } else {
    inp = h('select', {}, items.map(([v, l]) => h('option', { value: v }, l)));
    inp.value = String(cfg[k]);
    inp.addEventListener('change', () => { cfg[k] = inp.value; onChange(k); });
  }
  const txt = h('span', { class: 'st-txt' }, h('b', {}, label), !compact && desc ? h('small', {}, desc) : null);
  return h('label', { class: 'st-row ' + (type === 'bool' ? 'is-bool' : 'is-sel'), 'data-k': k }, txt, type === 'bool' ? h('span', { class: 'sw' }, inp, h('i')) : inp);
}

/** Ayarlar penceresi gövdesi: solda kategoriler, sağda ayarlar. extra: { [cat]: () => Node } ek içerik */
export function settingsPanel(cfg, onChange, extra = {}, start = 'view') {
  const cats = [...SETTINGS, { cat: 'coll', icon: '⚠', title: 'Çarpışma ve bindirme', items: [] }, { cat: 'post', icon: '⚙', title: 'Post ve makine', items: [] }, { cat: 'keys', icon: '⌨', title: 'Kısayollar', items: [] }];
  const nav = h('nav', { class: 'st-nav' }), body = h('div', { class: 'st-body' });
  const show = (cat) => {
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
    body.innerHTML = '';
    const c = cats.find(x => x.cat === cat);
    body.append(h('h3', {}, c.title));
    for (const it of c.items) body.append(control(cfg, it[0], onChange));
    if (extra[cat]) body.append(extra[cat]());
  };
  for (const c of cats) nav.append(h('button', { 'data-cat': c.cat, onclick: () => show(c.cat) }, h('i', {}, c.icon), c.title));
  const q = h('input', { type: 'search', placeholder: 'Ayar ara…', class: 'st-q' });
  q.addEventListener('input', () => {
    const s = q.value.trim().toLocaleLowerCase('tr');
    if (!s) { show(nav.querySelector('button.on')?.dataset.cat || 'view'); return; }
    body.innerHTML = ''; body.append(h('h3', {}, 'Arama: ' + q.value));
    for (const c of SETTINGS) for (const it of c.items) if ((it[1] + ' ' + (it[4] || '')).toLocaleLowerCase('tr').includes(s)) body.append(control(cfg, it[0], onChange));
  });
  const root = h('div', { class: 'st' }, h('div', { class: 'st-side' }, q, nav), body);
  show(start);
  return root;
}
