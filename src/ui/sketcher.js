// "Çizim yap": SolidWorks benzeri serbest 2D çizim. Kesit eksenin üstünde çizilir (x = Z ön alından, y = yarıçap),
// kapalı konturların çift-tek dolgusu eksen etrafında döndürülerek parça olur. İç konturlar boşluktur.
import { h, esc } from './forms.js';
import { solveSection, sectionToPart, rectEnts, cornerOp, entsFromPoints, arcFrom3, arcPoint, discretize, topology, keyOf } from '../part/section.js';
import { SetupWizard } from './setupWizard.js';

const TOOLS = [
  ['select', '⬚', 'Seç', 'Varlığa tıklayın; noktayı sürükleyin (birleşik noktalar birlikte taşınır).'],
  ['line', '╱', 'Çizgi', 'Tıklayarak zincir çizin. Başlangıç noktasına tıklamak konturu kapatır; Esc / çift tıklama zinciri bitirir.'],
  ['rect', '▭', 'Dikdörtgen', 'İki köşeye tıklayın.'],
  ['arc', '◠', 'Yay', 'Başlangıç, bitiş, sonra yay üzerindeki bir noktaya tıklayın.'],
  ['rad', '◜', 'Radyüs', 'Köşeye tıklayın: yandaki değer kadar yuvarlatılır.'],
  ['ch', '◣', 'Pah', 'Köşeye tıklayın: yandaki değer kadar pah kırılır.'],
  ['dim', '↔', 'Ölçü', 'Çizgiye tıklayın: boyu; noktaya tıklayın: Z ve Ø değiştirilir.'],
  ['del', '⌫', 'Sil', 'Silinecek çizgi ya da yaya tıklayın.'],
];
const SNAP_PX = 10;

export class Sketcher {
  constructor(app, opts = {}) {
    this.app = app;
    this.opts = opts;
    this.ents = opts.ents ? JSON.parse(JSON.stringify(opts.ents)) : opts.pts ? entsFromPoints(opts.pts) : [];
    this.name = opts.name || 'Çizim Parça';
    this.features = (opts.features || []).filter(f => !['axialHole', 'innerGroove', 'innerTurn'].includes(f.type));
    this.maxDia = app.project?.machine?.maxBarDia || 20;
    this.tool = this.ents.length ? 'select' : 'line';
    this.grid = 0.5; this.val = { ch: 0.5, rad: 0.5 };
    this.sel = null; this.undo = []; this.redo = []; this.view = null;
    this.chain = null; this.pend = []; this.hover = null;
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
    this.app.openModal('Çizim yap — döner parça kesiti', root, { wide: true, cls: 'sketch', onClose: () => this.close() });
    this.g = this.cv.getContext('2d');
    this.ro = new ResizeObserver(() => { this.resize(); this.draw(); });
    this.ro.observe(this.cvWrap);
    this.bind();
    this.renderBar(); this.recompute(); this.renderPanel();
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
    const xs = this.ents.flatMap(e => [e.a.x, e.b.x]), ys = this.ents.flatMap(e => [e.a.y, e.b.y]);
    const x0 = Math.min(0, ...xs), x1 = Math.max(xs.length ? 4 : 30, ...xs), y1 = Math.max(xs.length ? 3 : this.maxDia / 2 + 0.5, ...ys);
    const s = Math.min((this.w - 80) / (x1 - x0 + 4), (this.h - 60) / (y1 * 1.55 + 2));
    this.view = { s, ox: 50 - (x0 - 1.5) * s, oy: this.h * 0.64 };
    this.draw();
  }
  S(x, y) { return [this.view.ox + x * this.view.s, this.view.oy - y * this.view.s]; }
  W(px, py) { return [(px - this.view.ox) / this.view.s, (this.view.oy - py) / this.view.s]; }

  // ---------------------------------------------------------------- geometri yardımcıları
  points() {
    const m = new Map();
    for (const e of this.ents) for (const p of [e.a, e.b]) m.set(keyOf(p), p);
    return [...m.values()];
  }
  /** Yakalama: uç nokta > orta nokta > orijin/eksen > hiza (yatay/dikey) > ızgara. Shift: serbest */
  snap(px, py, free = false) {
    let [x, y] = this.W(px, py);
    const tol = SNAP_PX / this.view.s;
    const guides = [];
    if (!free) {
      let best = null;
      const cand = (p, kind) => { const d = Math.hypot(p.x - x, p.y - y); if (d < tol && (!best || d < best.d)) best = { x: p.x, y: p.y, kind, d }; };
      for (const p of this.points()) cand(p, 'uç nokta');
      for (const e of this.ents) if (e.type === 'line') cand({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, 'orta nokta');
      cand({ x: 0, y: 0 }, 'orijin');
      if (best) return { x: best.x, y: best.y, kind: best.kind, guides };
      // hiza: zincir başı/son noktası ve diğer uç noktalarla yatay / dikey
      const refs = [...(this.chain ? [this.chain] : []), ...this.pend, ...this.points()];
      let hx = null, hy = null;
      for (const p of refs) {
        if (hx == null && Math.abs(p.x - x) < tol) hx = p;
        if (hy == null && Math.abs(p.y - y) < tol) hy = p;
      }
      if (Math.abs(y) < tol) { y = 0; guides.push({ t: 'axis' }); }
      if (hx) { x = hx.x; guides.push({ t: 'v', p: hx }); }
      if (hy) { y = hy.y; guides.push({ t: 'h', p: hy }); }
      const g = this.grid;
      if (!hx) x = Math.round(x / g) * g;
      if (!hy && !guides.some(q => q.t === 'axis')) y = Math.round(y / g) * g;
      return { x: rnd(x), y: rnd(Math.max(0, y)), kind: guides.length ? (guides.some(q => q.t === 'axis') ? 'eksen' : 'hiza') : 'ızgara', guides };
    }
    return { x: rnd(x), y: rnd(Math.max(0, y)), kind: 'serbest', guides };
  }
  hitEnt(px, py) {
    let best = null, bd = 8;
    for (const [i, e] of this.ents.entries()) {
      for (const s of discretize([e])) {
        const [ax, ay] = this.S(s.a.x, s.a.y), [bx, by] = this.S(s.b.x, s.b.y);
        const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2));
        const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
  hitPoint(px, py) {
    let best = null, bd = 9;
    for (const p of this.points()) { const [x, y] = this.S(p.x, p.y); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  /** aynı konumdaki bütün uç noktaları taşı (birleşik nokta) */
  movePoint(P, x, y) {
    const k = keyOf(P);
    for (const e of this.ents) {
      for (const n of ['a', 'b']) if (keyOf(e[n]) === k) e[n] = { x, y };
      if (e.type === 'arc' && e.m) { /* yay ara noktası: uçlar taşınınca ortaya kaydır */ }
    }
    for (const e of this.ents) if (e.type === 'arc') { const A = arcFrom3(e.a, e.m, e.b); if (!A) e.m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 + 0.1 }; }
  }

  // ---------------------------------------------------------------- olaylar
  bind() {
    const cv = this.cv;
    let pan = null, drag = null;
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.chain) { this.chain = null; this.draw(); } });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2) { pan = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy }; return; }
      const p = this.local(e);
      const lab = this.hitLabel(p);
      if (lab && this.tool !== 'line' && this.tool !== 'rect' && this.tool !== 'arc') { e.preventDefault(); this.editLabel(lab); return; }
      this.closeEdit();
      const q = this.snap(p.x, p.y, e.shiftKey);
      const T = this.tool;
      if (T === 'line') this.lineClick(q);
      else if (T === 'rect') {
        if (!this.pend.length) this.pend = [q];
        else { const a = this.pend[0]; this.pend = []; if (Math.abs(a.x - q.x) > 1e-6 && Math.abs(a.y - q.y) > 1e-6) { this.push(); this.ents.push(...rectEnts(a, q)); this.changed(); } }
      } else if (T === 'arc') {
        this.pend.push(q);
        if (this.pend.length === 3) { const [a, b, m] = this.pend; this.pend = []; if (arcFrom3(a, m, b)) { this.push(); this.ents.push({ type: 'arc', a: { x: a.x, y: a.y }, m: { x: m.x, y: m.y }, b: { x: b.x, y: b.y } }); this.changed(); } else this.app.toast('Üç nokta aynı doğru üzerinde: yay çizilemez'); }
      } else if (T === 'rad' || T === 'ch') {
        const P = this.hitPoint(p.x, p.y);
        if (!P) return;
        const copy = JSON.stringify(this.ents);
        const r = cornerOp(this.ents, P, T, this.val[T]);
        if (!r.ok) { this.ents = JSON.parse(copy); this.app.toast(r.msg); } else { this.undo.push(copy); this.redo = []; this.changed(); }
      } else if (T === 'del') {
        const i = this.hitEnt(p.x, p.y);
        if (i != null) { this.push(); this.ents.splice(i, 1); this.sel = null; this.changed(); }
      } else if (T === 'dim') {
        const P = this.hitPoint(p.x, p.y);
        if (P) { this.editLabel({ kind: 'pt', p: P, x0: p.x, y0: p.y }); return; }
        const i = this.hitEnt(p.x, p.y);
        if (i != null && this.ents[i].type === 'line') this.editLabel({ kind: 'len', i, x0: p.x, y0: p.y });
      } else {
        const P = this.hitPoint(p.x, p.y);
        if (P) { this.push(); drag = { P: { ...P } }; this.sel = { pt: P }; this.renderPanel(); }
        else { const i = this.hitEnt(p.x, p.y); this.sel = i != null ? { ent: i } : null; this.renderPanel(); }
      }
      this.draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (pan) { this.view.ox = pan.ox + e.clientX - pan.x; this.view.oy = pan.oy + e.clientY - pan.y; this.draw(); return; }
      const p = this.local(e);
      if (drag) { const q = this.snapDrag(p, e.shiftKey, drag.P); this.movePoint(drag.P, q.x, q.y); drag.P = { x: q.x, y: q.y }; this.sel = { pt: drag.P }; this.recompute(); this.draw(); return; }
      this.hover = this.snap(p.x, p.y, e.shiftKey);
      this.cv.style.cursor = this.hitLabel(p) && !['line', 'rect', 'arc'].includes(this.tool) ? 'pointer' : '';
      this.hud.textContent = `Z ${f3(this.hover.x)}   Ø ${f3(this.hover.y * 2)}   · ${this.hover.kind}`;
      this.draw();
    });
    cv.addEventListener('pointerup', () => { if (drag) { drag = null; this.changed(); } pan = null; });
    cv.addEventListener('dblclick', () => { if (this.chain) { this.chain = null; this.draw(); } });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.local(e), k = Math.exp(-e.deltaY * 0.0015);
      this.view.ox = p.x - (p.x - this.view.ox) * k; this.view.oy = p.y - (p.y - this.view.oy) * k; this.view.s *= k;
      this.draw();
    }, { passive: false });
    this._key = (e) => {
      if (!this.cv.isConnected) return;
      // Esc pencereyi kapatmaz: düzenleme kutusu → süren çizim → araç → seçim
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (this.edBox) this.closeEdit();
        else if (this.chain || this.pend.length) { this.chain = null; this.pend = []; }
        else if (this.tool !== 'select') this.setTool('select');
        else { this.sel = null; this.renderPanel(); }
        this.draw();
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? this.doRedo() : this.doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); e.stopPropagation(); this.doRedo(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.chain = null; this.pend = []; this.draw(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel?.ent != null) { e.preventDefault(); this.push(); this.ents.splice(this.sel.ent, 1); this.sel = null; this.changed(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = { KeyL: 'line', KeyR: 'rect', KeyA: 'arc', KeyS: 'select', KeyD: 'dim' }[e.code];
        if (k) { e.preventDefault(); e.stopPropagation(); this.setTool(k); }
      }
    };
    window.addEventListener('keydown', this._key, true);
  }
  snapDrag(p, free, P) {
    // sürüklenen noktanın kendisine yakalanmasın
    const keep = this.ents; const k = keyOf(P);
    this.ents = keep.map(e => ({ ...e, a: keyOf(e.a) === k ? { x: 1e9, y: 1e9 } : e.a, b: keyOf(e.b) === k ? { x: 1e9, y: 1e9 } : e.b }));
    const q = this.snap(p.x, p.y, free);
    this.ents = keep;
    return q;
  }
  lineClick(q) {
    if (!this.chain) { this.chain = { x: q.x, y: q.y, start: { x: q.x, y: q.y } }; return; }
    const a = this.chain;
    if (Math.abs(a.x - q.x) < 1e-9 && Math.abs(a.y - q.y) < 1e-9) return;
    this.push();
    this.ents.push({ type: 'line', a: { x: a.x, y: a.y }, b: { x: q.x, y: q.y } });
    const closed = Math.abs(q.x - a.start.x) < 1e-9 && Math.abs(q.y - a.start.y) < 1e-9;
    // başka bir uç noktaya bağlandıysa ve o nokta artık çift bağlıysa zinciri bitir (kontur kapandı)
    const deg = this.ents.filter(e => [e.a, e.b].some(p => keyOf(p) === keyOf(q))).length;
    this.chain = closed || (q.kind === 'uç nokta' && deg >= 2) ? null : { x: q.x, y: q.y, start: a.start };
    if (!this.chain) this.app.toast('Kontur kapandı', 1200);
    this.changed();
  }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  push() { this.undo.push(JSON.stringify(this.ents)); if (this.undo.length > 300) this.undo.shift(); this.redo = []; }
  doUndo() { if (!this.undo.length) return; this.redo.push(JSON.stringify(this.ents)); this.ents = JSON.parse(this.undo.pop()); this.sel = null; this.chain = null; this.changed(); }
  doRedo() { if (!this.redo.length) return; this.undo.push(JSON.stringify(this.ents)); this.ents = JSON.parse(this.redo.pop()); this.sel = null; this.changed(); }
  changed() { this.recompute(); this.renderPanel(); this.draw(); }
  setTool(t) { this.tool = t; this.chain = null; this.pend = []; this.renderBar(); this.draw(); }
  recompute() {
    this.res = this.ents.length ? sectionToPart(this.ents, this.name, this.features) : null;
    this.sec = this.ents.length ? (this.res.S || solveSection(this.ents)) : null;
  }

  // ---------------------------------------------------------------- ölçü düzenleme (yerinde)
  hitLabel(p) { return (this.labels || []).find(l => p.x >= l.x0 && p.x <= l.x1 && p.y >= l.y0 && p.y <= l.y1) || null; }
  closeEdit() { this.edBox?.remove(); this.edBox = null; }
  editLabel(l) {
    this.closeEdit();
    const box = h('div', { class: 'sk-edit' }), inputs = [];
    const fld = (label, val, unit) => { const inp = h('input', { type: 'number', step: 'any', value: val ?? '' }); inputs.push(inp); box.append(h('label', {}, label, inp, unit ? h('span', {}, unit) : null)); return inp; };
    let apply;
    if (l.kind === 'len') {
      const e = this.ents[l.i], L0 = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      const Lf = fld('Boy', rnd(L0), 'mm');
      apply = () => {
        const v = parseFloat(Lf.value); if (!(v > 0)) { this.app.toast('Boy 0’dan büyük olmalı'); return false; }
        this.push();
        const ux = (e.b.x - e.a.x) / L0, uy = (e.b.y - e.a.y) / L0;
        // b ucunu taşı; b'den sonraki, b ile aynı doğrultudaki noktalar da kayar (sonraki ölçüler korunur)
        const old = { ...e.b }, nb = { x: rnd(e.a.x + ux * v), y: rnd(e.a.y + uy * v) }, dx = nb.x - old.x, dy = nb.y - old.y;
        if (Math.abs(uy) < 1e-9) { for (const p of this.points()) if (p.x >= old.x - 1e-9 && keyOf(p) !== keyOf(e.a)) this.movePoint(p, rnd(p.x + dx), p.y); }
        else if (Math.abs(ux) < 1e-9) { for (const p of this.points()) if (keyOf(p) === keyOf(old)) this.movePoint(p, p.x, rnd(p.y + dy)); }
        else this.movePoint(old, nb.x, nb.y);
        return true;
      };
    } else {
      const P = l.p;
      const Z = fld('Z', rnd(P.x), 'mm'), D = fld('Ø', rnd(2 * P.y), 'mm');
      apply = () => { const z = parseFloat(Z.value), d = parseFloat(D.value); if (!Number.isFinite(z) || !(d >= 0)) { this.app.toast('Z sayı, Ø 0 veya büyük olmalı'); return false; } this.push(); this.movePoint(P, rnd(z), rnd(d / 2)); return true; };
    }
    const ok = h('button', { class: 'btn pri', onclick: () => { if (apply()) { this.closeEdit(); this.changed(); } } }, '✓');
    box.append(ok);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok.click(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeEdit(); } });
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.cvWrap.append(box);
    box.style.left = Math.max(6, Math.min(this.cvWrap.clientWidth - box.offsetWidth - 6, l.x0)) + 'px';
    box.style.top = Math.max(6, (l.y0 || 0) - box.offsetHeight - 8) + 'px';
    this.edBox = box;
    setTimeout(() => { inputs[0].focus(); inputs[0].select(); }, 0);
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
    b.append(gs,
      h('button', { class: 'ib', title: 'Geri al (Ctrl+Z)', onclick: () => this.doUndo() }, '↶'),
      h('button', { class: 'ib', title: 'Yinele (Ctrl+Y)', onclick: () => this.doRedo() }, '↷'),
      h('button', { class: 'ib', title: 'Çizimi sığdır', onclick: () => this.fit() }, '⤢ Sığdır'));
    this.hud.textContent = TOOLS.find(t => t[0] === this.tool)[3];
  }
  renderPanel() {
    const P = this.panel; P.innerHTML = '';
    const name = h('input', { type: 'text', value: this.name, class: 'name' });
    name.addEventListener('change', () => { this.name = name.value || 'Çizim Parça'; this.recompute(); });
    P.append(h('div', { class: 'sk-sec' }, h('label', { class: 'lbl' }, 'Parça adı'), name));
    const part = this.res?.part;
    P.append(h('div', { class: 'wiz-facts', html: `<div><span>Boy</span><b>${part ? f3(part.length) + ' mm' : '—'}</b></div><div><span>En büyük çap</span><b>${part ? 'Ø' + f3(part.maxDia) : '—'}</b></div><div><span>Varlık</span><b>${this.ents.length}</b></div>` }));
    const sec = h('div', { class: 'sk-sec grow' });
    // seçili varlık / nokta
    if (this.sel?.ent != null && this.ents[this.sel.ent]) {
      const e = this.ents[this.sel.ent];
      const tbl = h('table', { class: 'pt big' }, h('tr', {}, ...['', 'Z', 'Ø'].map(x => h('th', {}, x))));
      const row = (lbl, key) => {
        const c = (k, mul) => { const inp = h('input', { type: 'number', step: 'any', value: rnd(e[key][k] * mul) }); inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!Number.isFinite(v)) return; this.push(); const old = { ...e[key] }; const nx = k === 'x' ? rnd(v) : old.x, ny = k === 'y' ? rnd(v / 2) : old.y; if (key === 'm') e.m = { x: nx, y: ny }; else this.movePoint(old, nx, ny); this.changed(); }); return h('td', {}, inp); };
        tbl.append(h('tr', {}, h('td', { class: 'x' }, lbl), c('x', 1), c('y', 2)));
      };
      row('Başlangıç', 'a'); row('Bitiş', 'b'); if (e.type === 'arc') row('Yay noktası', 'm');
      sec.append(h('div', { class: 'sub' }, e.type === 'arc' ? 'Seçili yay' : `Seçili çizgi · boy ${f3(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y))} mm`), tbl,
        h('div', { class: 'btnrow' }, h('button', { class: 'btn dan', onclick: () => { this.push(); this.ents.splice(this.sel.ent, 1); this.sel = null; this.changed(); } }, 'Sil')));
    }
    // iç geometri sınıflandırması
    const feats = part ? part.features.filter(f => ['axialHole', 'innerGroove', 'innerTurn'].includes(f.type)) : [];
    if (feats.length) {
      sec.append(h('div', { class: 'sub' }, 'İç geometri (otomatik tanındı)'));
      for (const f of feats) sec.append(h('div', { class: 'feat-row ' + (f.type === 'axialHole' && !f.flat ? 'ok' : 'warn') },
        h('b', {}, f.type === 'axialHole' ? (f.flat ? 'Düz dipli delik' : f.through ? 'Boydan delik' : 'Delik (matkap)') : f.type === 'innerGroove' ? 'İç kanal / segman' : 'İç tornalama'),
        h('span', {}, f.type === 'axialHole' ? `${f.side === 'front' ? 'ön' : 'arka'} alından Ø${f.dia} × ${f.depth}` : `Z ${f.z0}–${f.z1} · Ø${f.dia}`),
        h('small', {}, f.type === 'axialHole' ? (f.flat ? 'parmak freze / dalma ya da iç tornalama' : 'punta + matkap') : 'iç kanal / iç tornalama takımı (elle)')));
    }
    if (!this.ents.length) sec.append(h('div', { class: 'note' }, 'Kesiti eksenin üstüne çizin: ön yüz solda (Z0), Z sağa doğru. “Çizgi” ile istediğiniz noktalara tıklayarak kapalı bir kontur oluşturun (başlangıç noktasına tıklayınca kapanır). Delik, kanal, kademe gibi iç boşlukları içeri ayrı kapalı kontur olarak çizin ya da dış konturun parçası yapın; ne olduğu otomatik tanınır.'));
    const tpl = h('div', { class: 'btnrow' },
      h('button', { class: 'btn', onclick: () => this.template('bar') }, 'Çubuk (Ø × L)'),
      h('button', { class: 'btn', onclick: () => this.template('ex') }, 'Örnek çizim'),
      this.ents.length ? h('button', { class: 'btn dan', onclick: () => { if (!confirm('Çizim temizlensin mi?')) return; this.push(); this.ents = []; this.sel = null; this.changed(); this.setTool('line'); } }, 'Temizle') : null);
    sec.append(tpl);
    P.append(sec);
    this.msgBox = h('div', { class: 'sk-msgs' });
    P.append(this.msgBox);
    this.okBtn = h('button', { class: 'btn pri big', onclick: () => this.finish() }, 'Parçayı oluştur →');
    P.append(h('div', { class: 'wiz-nav' }, h('button', { class: 'btn ghost', onclick: () => this.app.closeModal() }, 'İptal'), h('span', { class: 'sp' }), this.okBtn));
    this.refreshMsgs();
  }
  refreshMsgs() {
    const err = !this.ents.length ? ['Çizim boş.'] : [...(this.res?.errors || [])];
    const part = this.res?.part;
    if (part && part.maxDia > this.maxDia + 1e-6) err.push(`En büyük çap Ø${f3(part.maxDia)}: makine en fazla Ø${this.maxDia} çubuk işler.`);
    const warn = this.res?.warnings || [];
    this.msgBox.innerHTML = (err.length ? err.map(e => `<div class="msg e"><span class="k">✗</span>${esc(e)}</div>`).join('') : '<div class="msg o"><span class="k">✓</span>Kesit geçerli: parça oluşturulabilir.</div>') + warn.map(w => `<div class="msg w"><span class="k">!</span>${esc(w)}</div>`).join('');
    this.okBtn.disabled = !!err.length;
    this.errs = err;
  }
  template(k) {
    this.push();
    if (k === 'bar') { const D = Math.min(this.maxDia, this.app.project?.stock?.barDia || 12); this.ents = rectEnts({ x: 0, y: 0 }, { x: 30, y: D / 2 }); }
    else {
      // kademeli burç: dış kademe, ön delik (matkap), arka düz dipli delik, iç segman kanalı
      const L = (a, b) => ({ type: 'line', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
      const poly = (...p) => p.map((q, i) => L(q, p[(i + 1) % p.length]));
      this.ents = [...poly([0, 0], [0, 4], [10, 4], [10, 6], [28, 6], [28, 0]), ...poly([0, 0], [0, 2], [12, 2], [12, 2.6], [13.2, 2.6], [13.2, 2], [18, 2], [18, 0])];
      cornerOp(this.ents, { x: 0, y: 4 }, 'ch', 0.5); cornerOp(this.ents, { x: 10, y: 6 }, 'ch', 0.3);
    }
    this.sel = null; this.changed(); this.fit();
  }
  finish() {
    this.recompute(); this.refreshMsgs();
    if (this.errs.length) { this.app.toast(this.errs[0], 4500); return; }
    const part = this.res.part;
    this.app.closeModal();
    new SetupWizard(this.app, this.opts.edit ? { kind: 'sketch', part, edit: true, geomChanged: true, start: 'front' } : { kind: 'sketch', part }).open();
  }

  // ---------------------------------------------------------------- çizim
  draw() {
    if (!this.g || !this.view || !this.w) return;
    const g = this.g, s = this.view.s;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#0e1419'; g.fillRect(0, 0, this.w, this.h);
    // ızgara
    const minor = [0.1, 0.5, 1, 2, 5, 10, 20].find(v => v * s > 14) || 20, major = minor * 5;
    const [xa, yb] = this.W(0, this.h), [xb, ya] = this.W(this.w, 0);
    g.lineWidth = 1;
    for (const [step, col] of [[minor, 'rgba(255,255,255,.035)'], [major, 'rgba(255,255,255,.08)']]) {
      g.strokeStyle = col; g.beginPath();
      for (let x = Math.ceil(xa / step) * step; x <= xb; x += step) { const [X] = this.S(x, 0); g.moveTo(X + 0.5, 0); g.lineTo(X + 0.5, this.h); }
      for (let y = Math.ceil(yb / step) * step; y <= ya; y += step) { const [, Y] = this.S(0, y); g.moveTo(0, Y + 0.5); g.lineTo(this.w, Y + 0.5); }
      g.stroke();
    }
    g.fillStyle = '#56657a'; g.font = '10.5px Cascadia Mono, Consolas, monospace';
    for (let x = Math.ceil(xa / major) * major; x <= xb; x += major) { const [X] = this.S(x, 0); g.fillText(fmtG(x), X + 3, this.h - 5); }
    for (let y = Math.ceil(Math.max(0, yb) / major) * major; y <= ya; y += major) { if (y <= 0) continue; const [, Y] = this.S(0, y); g.fillText('Ø' + fmtG(2 * y), 4, Y - 3); }
    const [x0, y0] = this.S(0, 0);
    g.strokeStyle = 'rgba(147,161,175,.7)'; g.setLineDash([12, 4, 2, 4]); g.beginPath(); g.moveTo(0, y0); g.lineTo(this.w, y0); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#93a1af'; g.font = '600 11px Segoe UI, sans-serif'; g.fillText('torna ekseni (döndürme ekseni)', this.w - 190, y0 - 6);
    g.strokeStyle = 'rgba(62,207,142,.45)'; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, this.h); g.stroke();
    g.fillStyle = '#3ecf8e'; g.fillText('Z0', x0 + 5, 16);
    // kesit dolgusu (çözülen aralıklar) + ayna
    const sec = this.sec;
    if (sec?.spans?.length) {
      for (const sgn of [1, -1]) {
        g.fillStyle = sgn > 0 ? 'rgba(75,139,255,.2)' : 'rgba(75,139,255,.07)';
        for (const sp of sec.spans) {
          g.beginPath();
          g.moveTo(...this.S(sp.z0, sgn * sp.in0)); g.lineTo(...this.S(sp.z1, sgn * sp.in1)); g.lineTo(...this.S(sp.z1, sgn * sp.out1)); g.lineTo(...this.S(sp.z0, sgn * sp.out0)); g.closePath(); g.fill();
        }
      }
      // hatalı bölgeler
      for (const b of sec.bad || []) { const [a] = this.S(b.z0, 0), [c] = this.S(b.z1, 0); g.fillStyle = 'rgba(248,113,113,.16)'; g.fillRect(a, 0, c - a, this.h); }
    }
    // varlıklar
    this.labels = [];
    const lab = (kind, extra, txt, x, y, align) => {
      const w = g.measureText(txt).width, hh = 14, X = align === 'center' ? x - w / 2 : x;
      this.labels.push({ kind, ...extra, x0: X - 3, y0: y - hh + 2, x1: X + w + 3, y1: y + 4 });
    };
    this.ents.forEach((e, i) => {
      const on = this.sel?.ent === i;
      g.strokeStyle = e.construction ? 'rgba(234,240,246,.35)' : on ? '#4b8bff' : '#eaf0f6'; g.lineWidth = on ? 2.4 : 1.6;
      g.beginPath();
      if (e.type === 'line') { g.moveTo(...this.S(e.a.x, e.a.y)); g.lineTo(...this.S(e.b.x, e.b.y)); }
      else { const n = 40; for (let k = 0; k <= n; k++) { const p = arcPoint(e, k / n); const [X, Y] = this.S(p.x, p.y); k ? g.lineTo(X, Y) : g.moveTo(X, Y); } }
      g.stroke(); g.lineWidth = 1;
      // ölçü: yatay ve dikey çizgi boyları (tıklanabilir)
      if (e.type === 'line') {
        const [ax, ay] = this.S(e.a.x, e.a.y), [bx, by] = this.S(e.b.x, e.b.y), Lp = Math.hypot(bx - ax, by - ay);
        if (Lp > 34 && (Math.abs(e.a.y - e.b.y) < 1e-9 || Math.abs(e.a.x - e.b.x) < 1e-9)) {
          const t = fmtG(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y));
          g.font = '11px Cascadia Mono, Consolas, monospace';
          const mx = (ax + bx) / 2 + (Math.abs(e.a.x - e.b.x) < 1e-9 ? 6 : 0), my = (ay + by) / 2 + (Math.abs(e.a.y - e.b.y) < 1e-9 ? -6 : 4);
          lab('len', { i }, t, mx, my, Math.abs(e.a.x - e.b.x) < 1e-9 ? 'left' : 'center');
          g.fillStyle = '#a7b4c2'; g.textAlign = Math.abs(e.a.x - e.b.x) < 1e-9 ? 'left' : 'center'; g.fillText(t, mx, my); g.textAlign = 'left';
        }
      }
    });
    // noktalar: açık uç kırmızı, seçili mavi; çap etiketi (tıklanabilir)
    const open = new Set(topology(this.ents).open.map(keyOf));
    g.font = '10.5px Cascadia Mono, Consolas, monospace';
    for (const p of this.points()) {
      const [X, Y] = this.S(p.x, p.y), k = keyOf(p), on = this.sel?.pt && keyOf(this.sel.pt) === k;
      g.beginPath(); g.arc(X, Y, on ? 5.5 : open.has(k) ? 5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = on ? '#4b8bff' : open.has(k) ? '#f87171' : '#eaf0f6'; g.fill();
      if (p.y > 1e-6) { const t = 'Ø' + fmtG(2 * p.y); lab('pt', { p }, t, X + 7, Y - 7); g.fillStyle = on ? '#cfe0ff' : '#7f8fa0'; g.fillText(t, X + 7, Y - 7); }
    }
    // süren çizim önizlemesi + kılavuzlar
    const hv = this.hover;
    if (hv) {
      const [hx, hy] = this.S(hv.x, hv.y);
      g.strokeStyle = 'rgba(75,139,255,.55)'; g.setLineDash([4, 4]);
      for (const gd of hv.guides || []) {
        g.beginPath();
        if (gd.t === 'v') { const [px] = this.S(gd.p.x, 0); g.moveTo(px, 0); g.lineTo(px, this.h); }
        else if (gd.t === 'h') { const [, py] = this.S(0, gd.p.y); g.moveTo(0, py); g.lineTo(this.w, py); }
        g.stroke();
      }
      g.setLineDash([]);
      g.strokeStyle = '#f5a524';
      if (this.tool === 'line' && this.chain) { g.setLineDash([5, 4]); g.beginPath(); g.moveTo(...this.S(this.chain.x, this.chain.y)); g.lineTo(hx, hy); g.stroke(); g.setLineDash([]); }
      if (this.tool === 'rect' && this.pend.length) { const [ax, ay] = this.S(this.pend[0].x, this.pend[0].y); g.setLineDash([5, 4]); g.strokeRect(Math.min(ax, hx), Math.min(ay, hy), Math.abs(hx - ax), Math.abs(hy - ay)); g.setLineDash([]); }
      if (this.tool === 'arc' && this.pend.length) {
        g.setLineDash([5, 4]); g.beginPath();
        if (this.pend.length === 1) { g.moveTo(...this.S(this.pend[0].x, this.pend[0].y)); g.lineTo(hx, hy); }
        else { const e = { a: this.pend[0], b: this.pend[1], m: hv }; for (let k = 0; k <= 30; k++) { const p = arcFrom3(e.a, e.m, e.b) ? arcPoint(e, k / 30) : e.a; const [X, Y] = this.S(p.x, p.y); k ? g.lineTo(X, Y) : g.moveTo(X, Y); } }
        g.stroke(); g.setLineDash([]);
      }
      if (['line', 'rect', 'arc'].includes(this.tool)) {
        g.beginPath(); g.moveTo(hx - 9, hy); g.lineTo(hx + 9, hy); g.moveTo(hx, hy - 9); g.lineTo(hx, hy + 9); g.stroke();
        if (hv.kind === 'uç nokta' || hv.kind === 'orta nokta' || hv.kind === 'orijin') { g.strokeStyle = '#3ecf8e'; g.beginPath(); g.arc(hx, hy, 7, 0, Math.PI * 2); g.stroke(); }
      }
    }
  }
}

const rnd = (v) => Math.round(v * 1e4) / 1e4;
const f3 = (v) => (+v).toFixed(3);
const fmtG = (v) => (+v).toFixed(3).replace(/\.?0+$/, '');
