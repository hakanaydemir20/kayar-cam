// Parça kurulum sihirbazı (standart CAM akışı): parça → torna ekseni → ön yüz → referans noktası (Z0 X0) → çubuk.
// Önizleme ve seçimler parça çerçevesinde; bitince proje oluşturulur ya da mevcut proje güncellenir.
import { h, FEATURE_LABELS, featureText } from './forms.js';
import { PartPreview } from '../view3d/partPreview.js';
import { refixture } from './stepFlow.js';
import { analyzeFaces, toPart } from '../cad/featureRecog.js';
import { makePart, profileFromTable, mirrorTablePart, suggestBar, STD_BARS } from '../part/part.js';
import { newProject, autoOperations } from '../project.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * opts.kind: 'step' (res: importStepFile sonucu) | 'table' (part) ; opts.edit: mevcut projeyi düzenle
 * opts.start: ilk adım anahtarı
 */
export class SetupWizard {
  constructor(app, opts) {
    this.app = app;
    this.kind = opts.kind;
    this.edit = !!opts.edit;
    this.res = opts.res || null;
    const P = app.project;
    if (this.kind === 'step') {
      this.part = this.res.part;
      this.faces = analyzeFaces(this.res.model);
      this.chosen = new Set(this.part.features.map(f => f.id));
    } else {
      this.part = opts.part;
      this.rows = (this.part.rows || []).map(r => ({ ...r }));
    }
    this.zShift = this.edit ? (P.zero?.zShift || 0) : 0;
    this.zMode = this.edit && this.zShift ? (Math.abs(this.zShift - this.part.length) < 1e-6 ? 'back' : 'value') : 'front';
    this.bar = this.edit ? P.stock.barDia : (suggestBar(this.part.maxDia, P.machine.maxBarDia) || 20);
    this.faceStock = this.edit ? P.stock.faceStock : 0.3;
    this.changedGeom = false;
    this.lost = [];
    this.steps = [
      ...(this.kind === 'table' ? [{ key: 'dims', title: 'Ölçüler', hint: 'Parçayı çap/boy satırlarıyla tanımlayın' }] : []),
      ...(this.kind === 'step' ? [{ key: 'axis', title: 'Torna ekseni', hint: 'Parçanın döneceği eksen' }] : []),
      { key: 'front', title: 'Ön yüz', hint: 'Kılavuz burçtan ilk çıkan, Z0 tarafı' },
      { key: 'zero', title: 'Referans noktası', hint: 'Programın Z0 X0 noktası' },
      { key: 'stock', title: 'Çubuk ve özellikler', hint: 'Malzeme ve işlenecek özellikler' },
    ];
    this.i = Math.max(0, this.steps.findIndex(s => s.key === opts.start));
    this.pickMode = null;
  }

  open() {
    const root = h('div', { class: 'wiz' });
    this.view = h('div', { class: 'wiz-view' });
    this.hud = h('div', { class: 'wiz-hud' });
    this.view.append(this.hud);
    this.panel = h('div', { class: 'wiz-panel' });
    root.append(this.view, this.panel);
    this.app.openModal(this.edit ? 'Bağlama ve Referans Noktası' : 'Yeni Parça', root, { wide: true, onClose: () => this.close() });
    this.pv = new PartPreview(this.view);
    this.view.addEventListener('click', (e) => this.onPick(e));
    this.view.addEventListener('pointermove', (e) => this.onHover(e));
    this.render();
  }
  close() { if (this.pv) { this.pv.dispose(); this.pv = null; } }

  get step() { return this.steps[this.i]; }
  marks() { return { highlight: this.step.key === 'front' ? 'front' : this.step.key === 'zero' ? 'zero' : null }; }

  render() {
    const s = this.step;
    this.pv.setPart(this.part, this.zShift, this.marks());
    const P = this.panel; P.innerHTML = '';
    // adım çubuğu
    P.append(h('ol', { class: 'wiz-steps' }, this.steps.map((st, k) => h('li', {
      class: (k === this.i ? 'on' : '') + (k < this.i ? ' done' : ''),
      onclick: () => { if (k <= this.i || this.canLeave()) { this.i = k; this.pickMode = null; this.render(); } },
    }, h('b', {}, String(k + 1)), h('span', {}, st.title)))));
    P.append(h('h2', { class: 'wiz-title' }, s.title), h('p', { class: 'wiz-lead' }, s.hint));
    const body = h('div', { class: 'wiz-body' });
    this['step_' + s.key](body);
    P.append(body);
    // ölçü özeti
    P.append(h('div', { class: 'wiz-facts' },
      fact('Boy', r3(this.part.length) + ' mm'), fact('En büyük çap', 'Ø' + r3(this.part.maxDia)), fact('Referans', zLabel(this))));
    const nav = h('div', { class: 'wiz-nav' });
    if (this.i > 0) nav.append(h('button', { class: 'btn ghost', onclick: () => { this.i--; this.pickMode = null; this.render(); } }, '← Geri'));
    nav.append(h('span', { class: 'sp' }));
    if (this.i < this.steps.length - 1) nav.append(h('button', { class: 'btn pri', onclick: () => { if (this.canLeave()) { this.i++; this.pickMode = null; this.render(); } } }, 'İleri →'));
    else nav.append(h('button', { class: 'btn pri', onclick: () => this.finish() }, this.edit ? 'Uygula' : 'Parçayı Oluştur ve İşlem Planı Hazırla'));
    P.append(nav);
    this.setHud();
  }
  canLeave() {
    if (this.step.key === 'dims' && (!this.rows.length || this.rows.some(r => !(r.dia > 0) || !(r.len > 0)))) { this.app.toast('Her satırda çap ve boy 0’dan büyük olmalı'); return false; }
    return true;
  }
  setHud(text) {
    const t = text ?? (this.pickMode === 'axis' ? 'Silindirik bir yüze tıklayın — torna ekseni o yüzün ekseni olur'
      : this.pickMode === 'zero' ? 'Modelde bir yüze ya da kenara tıklayın — Z0 o konuma alınır'
        : this.step.key === 'front' ? 'İpucu: modelin bir ucuna tıklayarak o ucu ön yüz yapabilirsiniz' : 'Fareyle döndürün, tekerlekle yakınlaştırın');
    this.hud.textContent = t;
    this.hud.classList.toggle('act', !!this.pickMode || this.step.key === 'front');
  }

  // ---------------------------------------------------------------- adımlar
  step_dims(b) {
    const tbl = h('table', { class: 'pt big' }, h('tr', {}, ...['Çap Ø', 'Boy', 'Pah', 'Radyüs', ''].map(x => h('th', {}, x))));
    const upd = () => { this.part = makePart({ name: this.part.name, profile: profileFromTable(this.rows), rows: this.rows, features: this.part.features }); this.pv.setPart(this.part, this.zShift, this.marks()); this.pv.fit(); this.refreshFacts(); };
    this.rows.forEach((r, i) => {
      const cell = (k) => { const inp = h('input', { type: 'number', step: 'any', min: 0, value: r[k] ?? '', 'aria-label': `${i + 1}. satır ${k}` }); inp.addEventListener('change', () => { r[k] = inp.value === '' ? undefined : parseFloat(inp.value); upd(); }); return h('td', {}, inp); };
      tbl.append(h('tr', {}, cell('dia'), cell('len'), cell('ch'), cell('rad'), h('td', {}, h('button', { class: 'x', title: 'Satırı sil', onclick: () => { if (this.rows.length > 1) { this.rows.splice(i, 1); upd(); this.render(); } } }, '✕'))));
    });
    const name = h('input', { type: 'text', value: this.part.name, class: 'name' });
    name.addEventListener('change', () => { this.part.name = name.value || 'Parça'; });
    b.append(h('label', { class: 'lbl' }, 'Parça adı'), name);
    b.append(h('p', { class: 'note' }, 'Satırlar ön yüzden arkaya doğru. Pah ve radyüs, satırın başladığı dış köşeye uygulanır.'));
    b.append(tbl, h('button', { class: 'btn', onclick: () => { const l = this.rows[this.rows.length - 1]; this.rows.push({ dia: l ? l.dia : 10, len: 5 }); upd(); this.render(); } }, '+ Satır ekle'));
  }

  step_axis(b) {
    b.append(h('p', { class: 'note' }, 'Program, parçanın en büyük dış silindirini torna ekseni olarak seçti. Yanlışsa doğru silindirik yüzü modelde gösterin.'));
    b.append(choice('Otomatik (en büyük dış silindir)', this.part.axisFaceId == null, () => { this.refix({ axisFaceId: null }); }));
    b.append(choice('Modelde yüz seçerek', this.part.axisFaceId != null || this.pickMode === 'axis', () => { this.pickMode = 'axis'; this.render(); }, this.part.axisFaceId != null ? `seçili yüz #${this.part.axisFaceId}` : 'tıklayın'));
  }

  step_front(b) {
    b.append(h('p', { class: 'note' }, 'Kayar otomatta parça kılavuz burçtan ön yüzüyle çıkar; ilk işlenen taraf burasıdır. Arka uç kesme ile ayrılır ve gerekirse karşı iş milinde işlenir.'));
    b.append(h('div', { class: 'ends' },
      h('div', { class: 'end front' }, h('i', {}), h('b', {}, 'Ön yüz'), h('span', {}, 'yeşil halka')),
      h('div', { class: 'end back' }, h('i', {}), h('b', {}, 'Arka'), h('span', {}, 'turuncu halka'))));
    b.append(h('button', { class: 'btn big', onclick: () => this.flip() }, '⇄  Ön ve arkayı değiştir'));
    if (this.lost.length) b.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), 'Çevirmede düşenler: ' + this.lost.join(', ')));
  }

  step_zero(b) {
    b.append(h('p', { class: 'note' }, 'X0 her zaman torna eksenidir. Z0 için parçanın ön alnı kayar otomatlarda alışılmış seçimdir.'));
    const L = this.part.length;
    const set = (mode, z) => { this.zMode = mode; this.zShift = r3(z); this.pickMode = null; this.render(); };
    b.append(choice('Ön alın merkezi', this.zMode === 'front', () => set('front', 0), 'önerilen'));
    b.append(choice('Arka alın merkezi', this.zMode === 'back', () => set('back', L)));
    b.append(choice('Modelden seç', this.zMode === 'pick' || this.pickMode === 'zero', () => { this.pickMode = 'zero'; this.zMode = 'pick'; this.render(); }, 'yüze tıklayın'));
    const inp = h('input', { type: 'number', step: 'any', value: this.zMode === 'value' || this.zMode === 'pick' ? this.zShift : '', placeholder: '0' });
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (Number.isFinite(v) && v >= 0 && v <= L) set('value', v); else this.app.toast(`0 ile ${r3(L)} arasında bir değer girin`); });
    b.append(h('div', { class: 'choice val' + (this.zMode === 'value' ? ' on' : '') }, h('span', { class: 'rd' }), h('span', {}, 'Ön alından uzaklık'), inp, h('span', { class: 'u' }, 'mm')));
  }

  step_stock(b) {
    const P = this.app.project;
    const sug = suggestBar(this.part.maxDia, P.machine.maxBarDia);
    const sel = h('select', {}, STD_BARS.filter(d => d <= P.machine.maxBarDia).map(d => h('option', { value: d }, 'Ø' + d + (d === sug ? '  (önerilen)' : ''))));
    sel.value = String(this.bar);
    sel.addEventListener('change', () => { this.bar = +sel.value; this.render(); });
    const fs = h('input', { type: 'number', step: 'any', value: this.faceStock });
    fs.addEventListener('change', () => { this.faceStock = Math.max(0, parseFloat(fs.value) || 0); });
    b.append(h('div', { class: 'fg' },
      h('div', { class: 'f' }, h('label', {}, 'Çubuk çapı'), sel),
      h('div', { class: 'f' }, h('label', {}, 'Alın payı', h('span', { class: 'u' }, 'mm')), fs)));
    if (!sug) b.append(h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), `Parça çapı (Ø${r3(this.part.maxDia)}) makine kapasitesini (Ø${P.machine.maxBarDia}) aşıyor.`));
    else if (this.bar < this.part.maxDia - 1e-6) b.append(h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), 'Çubuk çapı parçadan küçük.'));
    if (this.kind === 'step') {
      b.append(h('div', { class: 'sub' }, `Tanınan özellikler (${this.part.features.length})`));
      if (!this.part.features.length) b.append(h('p', { class: 'note' }, 'Döner profil dışında özellik bulunmadı. Diş ve benzerlerini sonra Parça panelinden ekleyebilirsiniz.'));
      for (const f of this.part.features) {
        const cb = h('input', { type: 'checkbox' }); cb.checked = this.chosen.has(f.id);
        cb.addEventListener('change', () => { if (cb.checked) this.chosen.add(f.id); else this.chosen.delete(f.id); });
        b.append(h('label', { class: 'feat' }, cb, h('b', {}, FEATURE_LABELS[f.type]), featureText(f)));
      }
      b.append(h('p', { class: 'note' }, 'Diş STEP modelinde genellikle bulunmaz; Parça panelinden ekleyin.'));
    } else if (this.part.features.length) {
      b.append(h('div', { class: 'sub' }, `Özellikler (${this.part.features.length})`));
      for (const f of this.part.features) b.append(h('div', { class: 'feat' }, h('b', {}, FEATURE_LABELS[f.type]), featureText(f)));
    }
  }

  refreshFacts() {
    const el = this.panel.querySelector('.wiz-facts');
    if (el) el.replaceWith(h('div', { class: 'wiz-facts' }, fact('Boy', r3(this.part.length) + ' mm'), fact('En büyük çap', 'Ø' + r3(this.part.maxDia)), fact('Referans', zLabel(this))));
  }

  // ---------------------------------------------------------------- işlemler
  refix(o) {
    try {
      const r = refixture(this.res, { flip: o.flip ?? this.res.flip, axisFaceId: 'axisFaceId' in o ? o.axisFaceId : this.res.axisFaceId });
      r.part.name = this.part.name;
      this.res = r; this.part = r.part;
      this.chosen = new Set(this.part.features.map(f => f.id));
      this.changedGeom = true;
      if (this.zMode === 'back') this.zShift = this.part.length;
      this.zShift = Math.min(this.zShift, this.part.length);
      this.pickMode = null;
      this.pv.part = null;                 // görünümü yeniden sığdır
      this.render();
    } catch (e) { this.app.toast(e.message, 4500); }
  }
  flip() {
    if (this.kind === 'step') { this.refix({ flip: !this.res.flip }); }
    else {
      const m = mirrorTablePart(this.part);
      this.part = m.part; this.rows = m.part.rows.map(r => ({ ...r })); this.lost = m.lost;
      this.changedGeom = true;
      if (this.zMode === 'back') this.zShift = this.part.length;
      else if (this.zMode !== 'front') this.zShift = r3(this.part.length - this.zShift);
      this.render();
    }
    this.app.toast('Ön ve arka değiştirildi');
  }

  /** Tıklanan noktanın ön alından uzaklığı; düz alın yüzüne ya da profil köşesine yapışır */
  snapD(hit) {
    const L = this.part.length;
    if (this.kind === 'step') {
      const fid = this.part.mesh.faceOf[hit.faceIndex];
      const f = this.faces[fid], fx = this.part.fixture;
      if (f && f.type === 'plane' && Math.abs(f.n[0] * fx.A[0] + f.n[1] * fx.A[1] + f.n[2] * fx.A[2]) > 0.98) return { d: r3(toPart(fx, f.c)[0]), snap: 'düz yüz' };
    }
    let best = null;
    for (const p of this.part.profile) { const dd = Math.abs(p.z - hit.d); if (dd < 0.4 && (!best || dd < best.dd)) best = { dd, z: p.z }; }
    if (best) return { d: r3(best.z), snap: 'köşe' };
    return { d: Math.max(0, Math.min(L, Math.round(hit.d * 100) / 100)), snap: null };
  }
  onHover(e) {
    if (this.pickMode !== 'zero') return;
    const hit = this.pv.pick(e);
    if (!hit) { this.setHud(); return; }
    const s = this.snapD(hit);
    this.setHud(`Z0 buraya: ön alından ${s.d} mm${s.snap ? ' (' + s.snap + ')' : ''} — tıklayın`);
  }
  onPick(e) {
    const hit = this.pv.pick(e);
    if (!hit) return;
    const key = this.step.key;
    if (this.pickMode === 'axis') {
      const fid = this.part.mesh.faceOf[hit.faceIndex];
      if (this.faces[fid]?.type !== 'cyl') { this.app.toast('Bu yüz silindirik değil — silindirik bir yüz seçin'); return; }
      this.refix({ axisFaceId: fid });
      this.app.toast('Torna ekseni seçilen yüze göre ayarlandı');
    } else if (this.pickMode === 'zero') {
      const s = this.snapD(hit);
      this.zShift = s.d; this.zMode = 'pick'; this.pickMode = null;
      this.render();
    } else if (key === 'front') {
      if (hit.d > this.part.length / 2) this.flip();
      else this.app.toast('Bu uç zaten ön yüz');
    }
  }

  finish() {
    const app = this.app, P0 = app.project;
    if (!(this.bar >= this.part.maxDia - 1e-6)) { this.app.toast('Çubuk çapı parçadan küçük olamaz'); return; }
    const part = this.part;
    if (this.kind === 'step') { part.features = part.features.filter(f => this.chosen.has(f.id)); part.stepB64 = this.res.b64; }
    const zero = { zShift: this.zShift, label: zLabel(this) };
    let P;
    if (this.edit && !this.changedGeom && !(this.kind === 'table' && JSON.stringify(this.rows) !== JSON.stringify(P0.part.rows))) {
      P = P0; P.part = part;
    } else if (this.edit) {
      // geometri değişti: makine, post, takımlar ve stok ayarları korunur, işlem planı yeniden kurulur
      P = newProject(part);
      for (const k of ['stock', 'tools', 'post', 'machine', 'sync']) if (P0[k] !== undefined) P[k] = P0[k];
      P.ops = autoOperations(P);
    } else P = newProject(part);
    P.name = part.name;
    P.zero = zero;
    P.stock.barDia = this.bar;
    P.stock.faceStock = this.faceStock;
    app.project = P;
    app.sel = { kind: 'part' };
    app.closeModal();
    app.recalc();
    app.toast(this.edit ? 'Bağlama ve referans güncellendi' : `${part.name} hazır — ${P.ops.length} işlemlik plan oluşturuldu`, 3500);
  }
}

function fact(k, v) { return h('div', {}, h('span', {}, k), h('b', {}, v)); }
function choice(label, on, onclick, tag) {
  return h('button', { class: 'choice' + (on ? ' on' : ''), onclick, type: 'button' }, h('span', { class: 'rd' }), h('span', {}, label), tag ? h('em', {}, tag) : null);
}
function zLabel(w) {
  if (!w.zShift) return 'Ön alın merkezi';
  if (Math.abs(w.zShift - w.part.length) < 1e-6) return 'Arka alın merkezi';
  return `Ön alından ${w.zShift} mm`;
}
