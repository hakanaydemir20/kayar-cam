// "Çizim yap": döner parçanın üst dış hattını 2D çiz (ön yüz solda, Z sağa, yukarı yarıçap).
// Araçlar: çiz, düzenle (sürükle), pah, radyüs, nokta sil; ızgara/köşe yakalama, dik açı, geri al.
import { h, esc } from './forms.js';
import { validateSketch, sketchToProfile, partFromSketch, exampleSketch } from '../part/sketch.js';
import { SetupWizard } from './setupWizard.js';

const TOOLS = [
  ['draw', '✎', 'Çiz', 'Tıklayarak nokta ekleyin. Çift tıklama, Enter veya Esc çizimi bitirir.'],
  ['edit', '✥', 'Düzenle', 'Noktayı sürükleyin. Ölçü yazısına (boy veya Ø) tıklayınca değeri yerinde değiştirin.'],
  ['ch', '◣', 'Pah', 'Köşeye tıklayın: yandaki değer kadar pah kırılır.'],
  ['rad', '◜', 'Radyüs', 'Köşeye tıklayın: yandaki değer kadar radyüs verilir.'],
  ['hole', '◎', 'Delik', 'Ön ya da arka alından parçanın içine doğru sürükleyin: eksenel delik (çap × derinlik).'],
  ['del', '⌫', 'Sil', 'Silinecek noktaya ya da deliğe tıklayın.'],
];

export class Sketcher {
  constructor(app, opts = {}) {
    this.app = app;
    this.pts = (opts.pts || []).map(p => ({ ...p }));
    this.name = opts.name || 'Çizim Parça';
    this.features = (opts.features || []).filter(f => f.type !== 'axialHole');
    this.holes = (opts.features || []).filter(f => f.type === 'axialHole').map(f => ({ side: f.side, dia: f.dia, depth: f.depth }));
    this.maxDia = app.project?.machine?.maxBarDia || 20;
    this.tool = this.pts.length ? 'edit' : 'draw';
    this.grid = 0.5; this.ortho = true; this.val = { ch: 0.5, rad: 0.5 };
    this.sel = -1; this.hover = null; this.undo = []; this.redo = [];
    this.view = null;
  }
  open() {
    window.__lastSketcher = this;   // hata ayıklama / uçtan uca test
    const root = h('div', { class: 'sk' });
    this.bar = h('div', { class: 'sk-bar' });
    this.cvWrap = h('div', { class: 'sk-cv' });
    this.cv = h('canvas');
    this.hud = h('div', { class: 'sk-hud' });
    this.cvWrap.append(this.cv, this.hud);
    this.panel = h('div', { class: 'sk-panel' });
    root.append(h('div', { class: 'sk-main' }, this.bar, this.cvWrap), this.panel);
    this.app.openModal('Çizim yap — 2D parça profili', root, { wide: true, cls: 'sketch', onClose: () => this.close() });
    this.g = this.cv.getContext('2d');
    this.ro = new ResizeObserver(() => { this.resize(); this.draw(); });
    this.ro.observe(this.cvWrap);
    this.bind();
    this.renderBar(); this.renderPanel();
    this.resize(); this.fit(); this.draw();
  }
  close() { this.closeEdit(); this.ro?.disconnect(); window.removeEventListener('keydown', this._key, true); }

  // ---------------------------------------------------------------- görünüm
  resize() {
    const w = this.cvWrap.clientWidth, hh = this.cvWrap.clientHeight, d = Math.min(devicePixelRatio || 1, 2);
    if (!w || !hh) return;
    this.w = w; this.h = hh; this.dpr = d;
    this.cv.width = w * d; this.cv.height = hh * d; this.cv.style.width = w + 'px'; this.cv.style.height = hh + 'px';
    if (!this.view) this.fit();
  }
  fit() {
    if (!this.w) return;
    const zs = this.pts.map(p => p.z), rs = this.pts.map(p => p.r);
    const z1 = Math.max(this.pts.length ? 10 : 30, ...zs), r1 = Math.max(this.pts.length ? 4 : this.maxDia / 2 + 0.5, ...rs);
    const z0 = Math.min(0, ...zs);
    const s = Math.min((this.w - 80) / (z1 - z0 + 4), (this.h - 60) / (r1 * 1.55 + 2));
    this.view = { s, ox: 50 - (z0 - 1.5) * s, oy: this.h * 0.64 };
    this.draw();
  }
  S(z, r) { return [this.view.ox + z * this.view.s, this.view.oy - r * this.view.s]; }
  W(x, y) { return [(x - this.view.ox) / this.view.s, (this.view.oy - y) / this.view.s]; }

  // ---------------------------------------------------------------- olaylar
  bind() {
    const cv = this.cv;
    let pan = null, drag = null;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2) { pan = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy }; return; }
      const p = this.local(e);
      const lab = this.hitLabel(p);
      if (lab) { e.preventDefault(); this.editLabel(lab); return; }
      this.closeEdit();
      const hit = this.hitVertex(p);
      if (this.tool === 'draw') { this.addPoint(this.snap(p, e.shiftKey)); return; }
      if (this.tool === 'hole') { this.startHole(p, e.shiftKey); return; }
      if (this.tool === 'del') { const hi = this.hitHole(p); if (hi >= 0) { this.push(); this.holes.splice(hi, 1); this.changed(); return; } }
      if (hit < 0) { this.sel = -1; this.renderPanel(); this.draw(); return; }
      if (this.tool === 'edit') { this.push(); this.sel = hit; drag = { i: hit }; this.renderPanel(); }
      else if (this.tool === 'del') { this.push(); this.pts.splice(hit, 1); this.sel = -1; this.changed(); }
      else if (this.tool === 'ch' || this.tool === 'rad') {
        if (hit === 0 && this.pts[0].r <= 0 || hit === this.pts.length - 1 && this.pts[hit].r <= 0) { this.app.toast('Eksen üstündeki uca pah/radyüs verilemez'); return; }
        this.push();
        const v = this.pts[hit];
        v[this.tool] = this.val[this.tool]; delete v[this.tool === 'ch' ? 'rad' : 'ch'];
        this.sel = hit; this.changed();
      }
      this.draw();
    });
    cv.addEventListener('pointermove', (e) => {
      this.cv.style.cursor = !pan && !drag && this.hitLabel(this.local(e)) ? 'pointer' : '';
      if (pan) { this.view.ox = pan.ox + e.clientX - pan.x; this.view.oy = pan.oy + e.clientY - pan.y; this.draw(); return; }
      const p = this.local(e);
      if (drag) { const q = this.snap(p, e.shiftKey, drag.i); Object.assign(this.pts[drag.i], { z: q.z, r: q.r }); this.changed(false); return; }
      if (this.holeDrag) { this.moveHole(p, e.shiftKey); return; }
      this.hover = this.tool === 'draw' ? this.snap(p, e.shiftKey) : null;
      this.hoverV = this.tool !== 'draw' ? this.hitVertex(p) : -1;
      const [z, r] = this.W(p.x, p.y);
      this.hud.textContent = this.tool === 'draw' && this.hover ? `Z ${f3(this.hover.z)}   Ø ${f3(this.hover.r * 2)}${this.hover.snap ? '  · ' + this.hover.snap : ''}` : `Z ${f3(z)}   Ø ${f3(Math.max(0, r) * 2)}`;
      this.draw();
    });
    cv.addEventListener('pointerup', () => { if (drag) { drag = null; this.changed(); } if (this.holeDrag) this.endHole(); pan = null; });
    cv.addEventListener('dblclick', () => { if (this.tool === 'draw') this.setTool('edit'); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.local(e), k = Math.exp(-e.deltaY * 0.0015);
      this.view.ox = p.x - (p.x - this.view.ox) * k; this.view.oy = p.y - (p.y - this.view.oy) * k; this.view.s *= k;
      this.draw();
    }, { passive: false });
    this._key = (e) => {
      if (!this.cv.isConnected) return;
      // Esc pencereyi kapatmaz: önce düzenleme kutusu, sonra çizim aracı, sonra seçim bırakılır
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (this.edBox) this.closeEdit();
        else if (this.tool === 'draw') { this.setTool('edit'); this.app.toast('Çizim aracı bırakıldı', 1400); }
        else if (this.sel >= 0) { this.sel = -1; this.renderPanel(); this.draw(); }
        return;
      }
      if (e.target.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? this.doRedo() : this.doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); e.stopPropagation(); this.doRedo(); }
      else if (e.key === 'Enter' && this.tool === 'draw') { e.preventDefault(); this.setTool('edit'); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) { e.preventDefault(); this.push(); this.pts.splice(this.sel, 1); this.sel = -1; this.changed(); }
    };
    window.addEventListener('keydown', this._key, true);
  }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  hitVertex(p) {
    let best = -1, bd = 10;
    this.pts.forEach((v, i) => { const [x, y] = this.S(v.z, v.r); const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  /** Yakalama: köşe hizası → dik açı → ızgara. free: Shift ile serbest (0.001 mm) */
  snap(p, free, self = -1) {
    let [z, r] = this.W(p.x, p.y);
    r = Math.max(0, r);
    const g = free ? 0.001 : this.grid;
    let snap = '';
    const ref = self >= 0 ? this.pts[self - 1] : this.pts[this.pts.length - 1];
    if (this.ortho && ref && !free) {
      const dz = Math.abs(z - ref.z) * this.view.s, dr = Math.abs(r - ref.r) * this.view.s;
      if (dr < dz * 0.35) { r = ref.r; snap = 'yatay'; } else if (dz < dr * 0.35) { z = ref.z; snap = 'dikey'; }
    }
    if (!free) {
      // başka köşelerle hiza (8 px)
      const tol = 8 / this.view.s;
      for (const [i, v] of this.pts.entries()) {
        if (i === self) continue;
        if (snap !== 'dikey' && Math.abs(v.z - z) < tol) { z = v.z; snap = snap ? snap + ' · hiza' : 'Z hizası'; break; }
      }
      for (const [i, v] of this.pts.entries()) {
        if (i === self) continue;
        if (snap !== 'yatay' && Math.abs(v.r - r) < tol) { r = v.r; snap = snap ? snap + ' · hiza' : 'çap hizası'; break; }
      }
      if (snap !== 'dikey' && !/Z hizası/.test(snap)) z = Math.round(z / g) * g;
      if (snap !== 'yatay' && !/çap hizası/.test(snap)) r = Math.round(r / g) * g;
    }
    return { z: rnd(z), r: rnd(Math.max(0, r)), snap };
  }
  addPoint(q) {
    const last = this.pts[this.pts.length - 1];
    if (last && Math.abs(last.z - q.z) < 1e-9 && Math.abs(last.r - q.r) < 1e-9) return;
    // iç kontur (delik): dış hat arka alına çizildikten sonra parçanın içinde öne doğru geri giden noktalar
    if (this.inner) { this.addInner(q); return; }
    if (last && q.z < last.z - 1e-9) {
      if (this.pts.length >= 2 && q.r < Math.max(...this.pts.map(p => p.r)) - 1e-9 && q.r > 0) {
        this.push();
        // arka alında aşağı inilen nokta (delik ağzı) dış hatta değil iç konturda sayılır
        const prev = this.pts[this.pts.length - 2];
        if (prev && Math.abs(last.z - prev.z) < 1e-9 && last.r < prev.r && Math.abs(last.r - q.r) < this.grid + 1e-9) this.pts.pop();
        const face = Math.max(...this.pts.map(p => p.z));
        this.inner = { face, z: face, r: q.r };
        this.addInner(q, true);
        return;
      }
      this.app.toast('Profil ön alından arkaya ilerlemeli; delik için parçanın içinde (dış çaptan küçük) geri nokta atın'); return;
    }
    this.push();
    this.pts.push({ z: q.z, r: q.r });
    this.sel = this.pts.length - 1;
    this.changed();
  }
  /** İç kontur noktası: öne doğru → delik derinliği; aynı Z'de aşağı → kademe (daha küçük çap) */
  addInner(q, first = false) {
    const I = this.inner, [zf] = this.ends();
    if (!first) this.push();
    if (q.z < I.z - 1e-9) {
      const through = q.z <= zf + this.grid * 0.5 + 1e-9;
      const depth = rnd(through ? I.face - zf : I.face - q.z);
      // aynı kademenin önceki kaydını derinleştir, yoksa yeni delik
      const ex = this.holes.find(o => o._inner === I && Math.abs(o.dia - 2 * I.r) < 1e-6);
      if (ex) ex.depth = depth; else this.holes.push({ side: 'back', dia: rnd(2 * I.r), depth, _inner: I });
      I.z = through ? zf : q.z;
      this.app.toast(`Delik Ø${fmtG(2 * I.r)} × ${fmtG(depth)} mm${through ? ' (boydan)' : ''} — arka alından`, 2200);
      if (through) this.inner = null;
    } else if (Math.abs(q.z - I.z) < 1e-6 && q.r < I.r - 1e-9 && q.r > 0) {
      I.r = q.r;   // kademe: bir sonraki geri nokta bu çapta devam eder
    } else { this.app.toast('İç kontur ön alına doğru ilerlemeli (ya da aynı Z’de daha küçük çapa inmeli)'); return; }
    this.changed();
  }
  snap0() { return JSON.stringify({ pts: this.pts, holes: this.holes.map(({ _inner, ...o }) => o) }); }
  load0(j) { const o = JSON.parse(j); this.pts = o.pts; this.holes = o.holes; this.inner = null; }
  push() { this.undo.push(this.snap0()); if (this.undo.length > 200) this.undo.shift(); this.redo = []; }
  doUndo() { if (!this.undo.length) return; this.redo.push(this.snap0()); this.load0(this.undo.pop()); this.sel = -1; this.changed(); }
  doRedo() { if (!this.redo.length) return; this.undo.push(this.snap0()); this.load0(this.redo.pop()); this.sel = -1; this.changed(); }
  changed(panel = true) { if (panel) this.renderPanel(); else this.refreshFacts(); this.draw(); }
  setTool(t) { this.inner = null; this.tool = t; this.hover = null; this.renderBar(); this.draw(); }

  /** parça uçları (ön alın z, arka alın z) */
  ends() { const zs = this.pts.map(q => q.z); return zs.length ? [Math.min(...zs), Math.max(...zs)] : [0, 0]; }
  startHole(p, free) {
    if (this.pts.length < 2) { this.app.toast('Önce parçanın dış hattını çizin'); return; }
    const [zf, zb] = this.ends(), q = this.snap(p, free, -2);
    const side = Math.abs(q.z - zf) <= Math.abs(q.z - zb) ? 'front' : 'back';
    this.holeDrag = { side, face: side === 'front' ? zf : zb, r: Math.max(this.grid, Math.abs(this.W(p.x, p.y)[1])), z: q.z };
    this.moveHole(p, free);
  }
  moveHole(p, free) {
    const H = this.holeDrag, [z, r] = this.W(p.x, p.y), g = free ? 0.001 : this.grid;
    H.r = Math.max(g, Math.round(Math.abs(r) / g) * g);
    H.z = Math.round(z / g) * g;
    const L = this.ends()[1] - this.ends()[0];
    H.depth = rnd(Math.min(L, Math.max(0, H.side === 'front' ? H.z - H.face : H.face - H.z)));
    this.hud.textContent = `Delik Ø${f3(2 * H.r)} × ${f3(H.depth)} mm · ${H.side === 'front' ? 'ön' : 'arka'} alından`;
    this.draw();
  }
  endHole() {
    const H = this.holeDrag; this.holeDrag = null;
    if (!(H.depth > 0.05) || !(H.r > 0.05)) { this.draw(); return; }
    this.push();
    this.holes.push({ side: H.side, dia: rnd(2 * H.r), depth: H.depth });
    this.changed();
  }
  hitHole(p) {
    const [zf, zb] = this.ends();
    return this.holes.findIndex(o => { const a = o.side === 'front' ? zf : zb - o.depth, b = a + o.depth; const [x0, y0] = this.S(a, o.dia / 2), [x1, y1] = this.S(b, -o.dia / 2); return p.x >= Math.min(x0, x1) && p.x <= Math.max(x0, x1) && p.y >= Math.min(y0, y1) && p.y <= Math.max(y0, y1); });
  }
  hitLabel(p) { return (this.labels || []).find(l => p.x >= l.x0 && p.x <= l.x1 && p.y >= l.y0 && p.y <= l.y1) || null; }
  closeEdit() { this.edBox?.remove(); this.edBox = null; if (this.edLab) { this.edLab = null; this.draw(); } }
  /** Ölçü yazısına tıklanınca yerinde düzenleme: boy (yatay kenar) veya köşe (Ø, pah, R) */
  editLabel(l) {
    this.closeEdit();
    this.edLab = l;
    const box = h('div', { class: 'sk-edit' });
    const inputs = [];
    const fld = (label, val, unit) => { const inp = h('input', { type: 'number', step: 'any', value: val ?? '' }); inputs.push(inp); box.append(h('label', {}, label, inp, unit ? h('span', {}, unit) : null)); return inp; };
    let apply;
    if (l.kind === 'hole') {
      const o = this.holes[l.i];
      const D = fld('Ø', o.dia, 'mm'), Dp = fld('Derinlik', o.depth, 'mm');
      apply = () => { const d = parseFloat(D.value), p = parseFloat(Dp.value); if (!(d > 0 && p > 0)) { this.app.toast('Çap ve derinlik 0’dan büyük olmalı'); return false; } this.push(); o.dia = rnd(d); o.depth = rnd(p); return true; };
    } else if (l.kind === 'len') {
      const a = this.pts[l.i - 1], b = this.pts[l.i];
      const L = fld('Boy', rnd(b.z - a.z), 'mm');
      apply = () => {
        const v = parseFloat(L.value); if (!(v > 0)) { this.app.toast('Boy 0’dan büyük olmalı'); return false; }
        const dz = v - (b.z - a.z); this.push();
        for (let k = l.i; k < this.pts.length; k++) this.pts[k].z = rnd(this.pts[k].z + dz);   // sonraki ölçüler korunur
        return true;
      };
    } else {
      const p = this.pts[l.i];
      const D = fld('Ø', rnd(2 * p.r), 'mm'), C = fld('Pah', p.ch ?? '', 'mm'), R = fld('R', p.rad ?? '', 'mm');
      apply = () => {
        const d = parseFloat(D.value); if (!(d >= 0)) { this.app.toast('Çap 0 veya daha büyük olmalı'); return false; }
        this.push();
        const old = p.r, r = rnd(d / 2);
        // aynı çaplı yatay kenarla bağlı komşular da birlikte değişir (silindir silindir kalır)
        for (const dir of [-1, 1]) for (let k = l.i + dir; k >= 0 && k < this.pts.length; k += dir) { const q = this.pts[k], pr = this.pts[k - dir]; if (Math.abs(q.r - old) < 1e-9 && Math.abs(pr.r - old) < 1e-9 && Math.abs(q.z - pr.z) > 1e-9) q.r = r; else break; }
        p.r = r;
        const c = parseFloat(C.value), rr = parseFloat(R.value);
        delete p.ch; delete p.rad;
        if (c > 0) p.ch = c; else if (rr > 0) p.rad = rr;
        return true;
      };
    }
    const ok = h('button', { class: 'btn pri', onclick: () => { if (apply()) { this.closeEdit(); this.changed(); } } }, '✓');
    box.append(ok);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeEdit(); }
    });
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.cvWrap.append(box);
    const W = this.cvWrap.clientWidth;
    box.style.left = Math.max(6, Math.min(W - box.offsetWidth - 6, l.x0)) + 'px';
    box.style.top = Math.max(6, l.y0 - box.offsetHeight - 6) + 'px';
    this.edBox = box;
    setTimeout(() => { inputs[0].focus(); inputs[0].select(); }, 0);   // tıklama bitince (aksi halde odak tuvale döner)
    this.draw();
  }

  // ---------------------------------------------------------------- araç çubuğu ve panel
  renderBar() {
    const b = this.bar; b.innerHTML = '';
    const seg = h('div', { class: 'sk-tools' });
    for (const [k, ic, l, tip] of TOOLS) seg.append(h('button', { class: this.tool === k ? 'on' : '', title: tip, onclick: () => this.setTool(k) }, h('i', {}, ic), l));
    b.append(seg);
    if (this.tool === 'ch' || this.tool === 'rad') {
      const inp = h('input', { type: 'number', step: '0.1', min: '0', value: this.val[this.tool] });
      inp.addEventListener('change', () => { this.val[this.tool] = Math.max(0, +inp.value || 0); });
      b.append(h('label', { class: 'sk-val' }, this.tool === 'ch' ? 'Pah' : 'R', inp, 'mm'));
    }
    b.append(h('span', { class: 'gsp' }));
    const gs = h('select', { title: 'Izgara adımı' }, [0.05, 0.1, 0.25, 0.5, 1, 2].map(v => h('option', { value: v }, 'Izgara ' + v)));
    gs.value = String(this.grid); gs.addEventListener('change', () => { this.grid = +gs.value; this.draw(); });
    const or = h('input', { type: 'checkbox' }); or.checked = this.ortho; or.addEventListener('change', () => { this.ortho = or.checked; });
    b.append(gs, h('label', { class: 'sk-chk', title: 'Çizerken yatay/dikey yakala' }, or, 'Dik açı'),
      h('button', { class: 'ib', title: 'Geri al (Ctrl+Z)', onclick: () => this.doUndo() }, '↶'),
      h('button', { class: 'ib', title: 'Yinele (Ctrl+Y)', onclick: () => this.doRedo() }, '↷'),
      h('button', { class: 'ib', title: 'Çizimi sığdır', onclick: () => this.fit() }, '⤢ Sığdır'));
    this.hud.textContent = TOOLS.find(t => t[0] === this.tool)[3];
  }
  renderPanel() {
    const P = this.panel; P.innerHTML = '';
    const name = h('input', { type: 'text', value: this.name, class: 'name' });
    name.addEventListener('change', () => { this.name = name.value || 'Çizim Parça'; });
    P.append(h('div', { class: 'sk-sec' }, h('label', { class: 'lbl' }, 'Parça adı'), name));
    this.facts = h('div', { class: 'wiz-facts' });
    P.append(this.facts);
    // nokta tablosu
    const tbl = h('table', { class: 'pt big' }, h('tr', {}, ...['#', 'Z', 'Ø', 'Pah', 'R', ''].map(x => h('th', {}, x))));
    this.pts.forEach((p, i) => {
      const cell = (k, mul = 1) => {
        const inp = h('input', { type: 'number', step: 'any', value: p[k] != null ? rnd(p[k] * mul) : '' });
        inp.addEventListener('focus', () => { this.sel = i; this.draw(); });
        inp.addEventListener('change', () => { this.push(); const v = inp.value === '' ? null : parseFloat(inp.value) / mul; if (v == null) delete p[k]; else p[k] = v; if (k === 'ch' && v) delete p.rad; if (k === 'rad' && v) delete p.ch; this.changed(); });
        return h('td', {}, inp);
      };
      tbl.append(h('tr', { class: i === this.sel ? 'on' : '', onclick: () => { this.sel = i; this.draw(); } }, h('td', { class: 'x' }, String(i + 1)), cell('z'), cell('r', 2), cell('ch'), cell('rad'),
        h('td', {}, h('button', { class: 'x', title: 'Noktayı sil', onclick: (e) => { e.stopPropagation(); this.push(); this.pts.splice(i, 1); this.sel = -1; this.changed(); } }, '✕'))));
    });
    P.append(h('div', { class: 'sk-sec grow' }, h('div', { class: 'sub' }, 'Köşe noktaları (ön alından arkaya)'), this.pts.length ? tbl : h('div', { class: 'note' }, 'Henüz nokta yok. Soldaki ekranda “Çiz” aracıyla parçanın üst dış hattını ön yüzden başlayarak tıklayın. Uçlar eksene kendiliğinden kapanır.'),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn', onclick: () => { this.push(); const l = this.pts[this.pts.length - 1]; this.pts.push(l ? { z: rnd(l.z + 5), r: l.r } : { z: 0, r: 5 }); this.changed(); } }, '+ Nokta'),
        h('button', { class: 'btn', onclick: () => { this.push(); this.pts = exampleSketch(); this.sel = -1; this.changed(); this.fit(); } }, 'Örnek çizim'),
        this.pts.length ? h('button', { class: 'btn dan', onclick: () => { if (!confirm('Çizim temizlensin mi?')) return; this.push(); this.pts = []; this.sel = -1; this.changed(); this.setTool('draw'); } }, 'Temizle') : null)));
    if (this.holes.length) {
      const ht = h('table', { class: 'pt big' }, h('tr', {}, ...['#', 'Taraf', 'Ø', 'Derinlik', ''].map(x => h('th', {}, x))));
      this.holes.forEach((o, i) => {
        const c = (k) => { const inp = h('input', { type: 'number', step: 'any', value: o[k] }); inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (v > 0) { this.push(); o[k] = rnd(v); this.changed(); } }); return h('td', {}, inp); };
        const sd = h('select', {}, h('option', { value: 'front' }, 'Ön'), h('option', { value: 'back' }, 'Arka')); sd.value = o.side; sd.addEventListener('change', () => { this.push(); o.side = sd.value; this.changed(); });
        ht.append(h('tr', {}, h('td', { class: 'x' }, String(i + 1)), h('td', {}, sd), c('dia'), c('depth'), h('td', {}, h('button', { class: 'x', title: 'Deliği sil', onclick: () => { this.push(); this.holes.splice(i, 1); this.changed(); } }, '✕'))));
      });
      P.querySelector('.sk-sec.grow').append(h('div', { class: 'sub' }, 'Delikler (eksenel)'), ht);
    }
    this.msgBox = h('div', { class: 'sk-msgs' });
    P.append(this.msgBox);
    this.okBtn = h('button', { class: 'btn pri big', onclick: () => this.finish() }, 'Parçayı oluştur →');
    P.append(h('div', { class: 'wiz-nav' }, h('button', { class: 'btn ghost', onclick: () => this.app.closeModal() }, 'İptal'), h('span', { class: 'sp' }), this.okBtn));
    this.refreshFacts();
  }
  refreshFacts() {
    const err = this.pts.length ? validateSketch(this.pts) : ['Çizim boş.'];
    const Dmax = this.pts.length ? 2 * Math.max(...this.pts.map(q => q.r)) : 0;
    if (Dmax > this.maxDia + 1e-6) err.push(`En büyük çap Ø${f3(Dmax)}: makine en fazla Ø${this.maxDia} çubuk işler.`);
    for (const [i, o] of this.holes.entries()) {
      const pr = this.pts.length >= 2 ? sketchToProfile(this.pts) : [];
      const [zf, zb] = this.ends(), L = zb - zf;
      if (o.depth > L + 1e-6) err.push(`${i + 1}. delik derinliği parça boyundan (${f3(L)}) büyük.`);
      const z0 = o.side === 'front' ? 0 : L - o.depth, z1 = o.side === 'front' ? o.depth : L;
      const minR = pr.filter(q => q.z >= z0 - 1e-6 && q.z <= z1 + 1e-6 && q.r > 0).reduce((m, q) => Math.min(m, q.r), Infinity);
      if (minR < Infinity && o.dia / 2 >= minR - 0.2) err.push(`${i + 1}. delik (Ø${o.dia}) parça cidarını deliyor: bu bölgede dış çap Ø${f3(2 * minR)}.`);
    }
    const zs = this.pts.map(p => p.z), rs = this.pts.map(p => p.r);
    const L = zs.length ? Math.max(...zs) - Math.min(...zs) : 0, D = rs.length ? 2 * Math.max(...rs) : 0;
    if (this.facts) this.facts.innerHTML = `<div><span>Boy</span><b>${f3(L)} mm</b></div><div><span>En büyük çap</span><b>Ø${f3(D)}</b></div><div><span>Nokta</span><b>${this.pts.length}</b></div>`;
    if (this.msgBox) this.msgBox.innerHTML = err.length ? err.map(e => `<div class="msg e"><span class="k">✗</span>${esc(e)}</div>`).join('') : '<div class="msg o"><span class="k">✓</span>Çizim geçerli: parça oluşturulabilir.</div>';
    if (this.okBtn) this.okBtn.disabled = !!err.length;
  }
  finish() {
    const err = validateSketch(this.pts);
    if (err.length) { this.app.toast(err[0], 4500); return; }
    const part = partFromSketch(this.pts, this.name, this.allFeatures());
    this.app.closeModal();
    new SetupWizard(this.app, { kind: 'sketch', part }).open();
  }

  /** Çizim delikleri → eksenel delik özellikleri (diğer özellikler korunur) */
  allFeatures() {
    const [zf, zb] = this.ends(), L = zb - zf;
    return [...this.features, ...this.holes.map(({ _inner, ...o }, i) => ({ id: 'sh' + (i + 1) + Math.random().toString(36).slice(2, 5), type: 'axialHole', side: o.side, dia: o.dia, depth: o.depth, through: o.depth >= L - 0.01 }))];
  }

  // ---------------------------------------------------------------- çizim
  draw() {
    if (!this.g || !this.view || !this.w) return;
    const g = this.g, s = this.view.s;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#0e1419'; g.fillRect(0, 0, this.w, this.h);
    // ızgara
    const minor = [0.1, 0.5, 1, 2, 5, 10, 20].find(v => v * s > 14) || 20, major = minor * 5;
    const [za, rb] = this.W(0, this.h), [zb, ra] = this.W(this.w, 0);
    g.lineWidth = 1;
    for (const [step, col] of [[minor, 'rgba(255,255,255,.035)'], [major, 'rgba(255,255,255,.08)']]) {
      g.strokeStyle = col; g.beginPath();
      for (let z = Math.ceil(za / step) * step; z <= zb; z += step) { const [x] = this.S(z, 0); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, this.h); }
      for (let r = Math.ceil(rb / step) * step; r <= ra; r += step) { const [, y] = this.S(0, r); g.moveTo(0, y + 0.5); g.lineTo(this.w, y + 0.5); }
      g.stroke();
    }
    g.fillStyle = '#56657a'; g.font = '10.5px Cascadia Mono, Consolas, monospace';
    for (let z = Math.ceil(za / major) * major; z <= zb; z += major) { const [x] = this.S(z, 0); g.fillText(fmtG(z), x + 3, this.h - 5); }
    for (let r = Math.ceil(Math.max(0, rb) / major) * major; r <= ra; r += major) { if (r <= 0) continue; const [, y] = this.S(0, r); g.fillText('Ø' + fmtG(2 * r), 4, y - 3); }
    // eksen ve ön yüz
    const [x0, y0] = this.S(0, 0);
    g.strokeStyle = 'rgba(147,161,175,.7)'; g.setLineDash([12, 4, 2, 4]); g.beginPath(); g.moveTo(0, y0); g.lineTo(this.w, y0); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#93a1af'; g.font = '600 11px Segoe UI, sans-serif'; g.fillText('torna ekseni', this.w - 80, y0 - 6);
    g.strokeStyle = 'rgba(62,207,142,.5)'; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, this.h); g.stroke();
    g.fillStyle = '#3ecf8e'; g.fillText('ÖN YÜZ  Z0', x0 + 5, 16);
    // profil
    const pts = this.pts;
    if (pts.length >= 2 && !validateSketch(pts).some(e => /geriye/.test(e))) {
      const pr = sketchToProfile(pts), zMin = pts[0].z;
      g.beginPath(); pr.forEach((p, i) => { const [x, y] = this.S(p.z + zMin, p.r); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.fillStyle = 'rgba(75,139,255,.16)'; g.fill();
      g.beginPath(); pr.forEach((p, i) => { const [x, y] = this.S(p.z + zMin, -p.r); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.fillStyle = 'rgba(75,139,255,.06)'; g.fill(); g.strokeStyle = 'rgba(75,139,255,.35)'; g.stroke();
      g.beginPath(); pr.forEach((p, i) => { const [x, y] = this.S(p.z + zMin, p.r); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = '#6ea2ff'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
    }
    // çizgi (ham kenarlar) + ölçüler (tıklanabilir etiketler)
    this.labels = [];
    // delikler (eksenel): parça içinde koyu, kesikli kenar
    const [hzf, hzb] = this.ends();   // parça uçları (delikler)
    const lab = (kind, i, txt, x, y, align) => {
      const w = g.measureText(txt).width, hh = 14;
      const x0 = align === 'center' ? x - w / 2 : x;
      this.labels.push({ kind, i, x0: x0 - 3, y0: y - hh + 2, x1: x0 + w + 3, y1: y + 4 });
      if (this.edLab && this.edLab.kind === kind && this.edLab.i === i) { g.fillStyle = 'rgba(75,139,255,.25)'; g.fillRect(x0 - 3, y - hh + 2, w + 6, hh + 2); }
    };
    const drawHole = (o, i, ghost) => {
      const a = o.side === 'front' ? hzf : hzb - o.depth;
      const [x0, y0] = this.S(a, o.dia / 2), [x1, y1] = this.S(a + o.depth, -o.dia / 2);
      g.fillStyle = ghost ? 'rgba(245,165,36,.25)' : 'rgba(10,15,20,.85)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = ghost ? '#f5a524' : '#6ea2ff'; g.setLineDash([5, 3]); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
      // matkap ucu konisi (118°)
      const tipZ = o.side === 'front' ? a + o.depth : a, cone = (o.dia / 2) / Math.tan(59 * Math.PI / 180), dir = o.side === 'front' ? 1 : -1;
      if (!ghost && o.depth < hzb - hzf - 0.01) { const [tx, ty] = this.S(tipZ + dir * cone, 0); g.beginPath(); g.moveTo(...this.S(tipZ, o.dia / 2)); g.lineTo(tx, ty); g.lineTo(...this.S(tipZ, -o.dia / 2)); g.strokeStyle = '#6ea2ff'; g.stroke(); }
      if (!ghost) { const t = `Ø${fmtG(o.dia)} × ${fmtG(o.depth)}`; g.font = '11px Cascadia Mono, Consolas, monospace'; const ty = (y0 + y1) / 2 + 4, tx = Math.min(x0, x1) + 6; lab('hole', i, t, tx, ty); g.fillStyle = '#cfe0ff'; g.fillText(t, tx, ty); }
    };
    if (pts.length >= 2) { this.holes.forEach((o, i) => drawHole(o, i, false)); if (this.holeDrag) drawHole({ side: this.holeDrag.side, dia: 2 * this.holeDrag.r, depth: this.holeDrag.depth || 0 }, -1, true); }
    if (pts.length) {
      g.strokeStyle = 'rgba(234,240,246,.35)'; g.setLineDash([3, 3]); g.beginPath();
      pts.forEach((p, i) => { const [x, y] = this.S(p.z, p.r); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
      g.font = '11px Cascadia Mono, Consolas, monospace';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const [xa, ya] = this.S(a.z, a.r), [xb, yb] = this.S(b.z, b.r);
        if (Math.abs(a.r - b.r) < 1e-9 && b.z - a.z > 1e-9 && xb - xa > 34) { const t = fmtG(b.z - a.z); lab('len', i, t, (xa + xb) / 2, ya - 6, 'center'); g.fillStyle = '#a7b4c2'; g.textAlign = 'center'; g.fillText(t, (xa + xb) / 2, ya - 6); }
      }
      g.textAlign = 'left';
    }
    // köşe noktaları
    pts.forEach((p, i) => {
      const [x, y] = this.S(p.z, p.r);
      const on = i === this.sel, hv = i === this.hoverV;
      g.beginPath(); g.arc(x, y, on || hv ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = on ? '#4b8bff' : hv ? '#f5a524' : '#eaf0f6'; g.fill();
      g.strokeStyle = '#0e1419'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
      const tag = p.ch ? 'C' + fmtG(p.ch) : p.rad ? 'R' + fmtG(p.rad) : '';
      g.fillStyle = on ? '#cfe0ff' : '#8796a6'; g.font = '11px Cascadia Mono, Consolas, monospace';
      const t = `Ø${fmtG(2 * p.r)}${tag ? ' ' + tag : ''}`;
      lab('pt', i, t, x + 8, y - 8);
      g.fillStyle = on ? '#cfe0ff' : '#8796a6';
      g.fillText(t, x + 8, y - 8);
    });
    // çizim önizleme
    if (this.tool === 'draw' && this.hover) {
      const [hx, hy] = this.S(this.hover.z, this.hover.r);
      const l = pts[pts.length - 1];
      if (l) { const [lx, ly] = this.S(l.z, l.r); g.strokeStyle = '#f5a524'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(lx, ly); g.lineTo(hx, hy); g.stroke(); g.setLineDash([]); }
      g.strokeStyle = '#f5a524'; g.beginPath(); g.moveTo(hx - 9, hy); g.lineTo(hx + 9, hy); g.moveTo(hx, hy - 9); g.lineTo(hx, hy + 9); g.stroke();
    }
  }
}

const rnd = (v) => Math.round(v * 1e4) / 1e4;
const f3 = (v) => (+v).toFixed(3);
const fmtG = (v) => (+v).toFixed(3).replace(/\.?0+$/, '');
