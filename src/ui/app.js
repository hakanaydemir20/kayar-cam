// Kayar CAM ana uygulama
import * as THREE from 'three';
import { Viewer } from '../view3d/scene.js';
import { MachineModel, poseOf } from '../view3d/machineMesh.js';
import { buildPathLines } from '../view3d/pathLines.js';
import { newProject, runPipeline, autoOperations, saveProject, loadProject, clone } from '../project.js';
import { StockSim, buildTarget, compare } from '../sim/stockSim.js';
import { OP_TYPES, defaultParams } from '../ops/generators.js';
import { makeOp } from '../ops/program.js';
import { makeTool, TOOL_TYPES, UNITS } from '../tools/toolLibrary.js';
import { makePart, profileFromTable, STD_BARS, suggestBar, examplePart } from '../part/part.js';
import { h, esc, OP_PARAMS, TOOL_FIELDS, FEATURE_FIELDS, FEATURE_LABELS, featureText, field } from './forms.js';
import { importStepFile, ghostFromMesh, ghostFromProfile, refixture, loadToolModel } from './stepFlow.js';
import { customToolModels } from '../view3d/toolMeshes.js';

const $ = (id) => document.getElementById(id);
const AUTOSAVE = 'kayarcam.project.v1';
if (typeof window !== 'undefined') window.THREE = THREE; // hata ayıklama

export class App {
  constructor() {
    this.project = this.restore() || newProject();
    this.sel = { kind: 'op', id: this.project.ops[0]?.id };
    this.t = 0; this.playing = false; this.speed = 1;
    this.viewer = new Viewer($('viewport'));
    this.viewer.view('zone');
    this.viewer.onFrame = (dt) => this.frame(dt);
    this.lastUi = 0;
    this.bindChrome();
    this.recalc();
  }

  // ------------------------------------------------------------ durum
  restore() {
    try {
      const s = localStorage.getItem(AUTOSAVE);
      if (!s) return null;
      const p = loadProject(s);
      if (p.part.source === 'step' && p.part.stepB64) this._pendingStep = true;
      return p;
    } catch { return null; }
  }
  saveViewOpts() {
    const o = {};
    for (const id of ['optPath', 'optTools', 'optCabin']) o[id] = $(id).value;
    for (const id of ['optAxes', 'optGhost']) o[id] = $(id).checked;
    try { localStorage.setItem('kayarcam.view.v1', JSON.stringify(o)); } catch { /* */ }
  }
  loadViewOpts() {
    try {
      const o = JSON.parse(localStorage.getItem('kayarcam.view.v1') || '{}');
      for (const [k, v] of Object.entries(o)) { const el = $(k); if (!el) continue; if (typeof v === 'boolean') el.checked = v; else el.value = v; }
    } catch { /* */ }
  }
  autosave() {
    try { localStorage.setItem(AUTOSAVE, saveProject(this.project)); } catch { /* kota */ }
  }
  status(txt, kind = '') {
    $('statusTxt').textContent = txt;
    $('statusDot').className = 'dot ' + kind;
  }
  toast(msg, ms = 2600) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), ms);
  }

  // ------------------------------------------------------------ hesap
  recalc(keepTime = false) {
    this.status('Hesaplanıyor…', 'busy');
    const P = this.project;
    let res;
    try { res = runPipeline(P); } catch (e) { console.error(e); this.status('Hata', 'err'); this.toast('Hesaplama hatası: ' + e.message, 5000); return; }
    this.result = res;
    this.verify = null;
    if (res.sim) {
      this.stockSim = new StockSim(P, res.sim);
      this.totalTime = this.stockSim.totalTime;
      this.buildScene();
      if (!keepTime) this.t = 0;
      this.stockSim.seek(this.t);
    }
    this.opTimes = this.computeOpTimes();
    this.renderTree(); this.renderProps(); this.renderNC(); this.renderSync(); this.renderMsgs(); this.renderVerify();
    $('postChip').className = 'chip ' + (P.post.verified ? 'ok' : 'warn');
    $('postChip').textContent = P.post.verified ? 'POST DOĞRULANDI' : 'POST DOĞRULANMADI';
    const nErr = res.errors.length;
    this.status(nErr ? `${nErr} hata` : 'Hazır', nErr ? 'err' : '');
    this.autosave();
    clearTimeout(this._vt);
    this._vt = setTimeout(() => this.runVerify(), 350);
  }

  runVerify() {
    if (!this.result?.sim) return;
    const t0 = performance.now();
    this.status('Doğrulanıyor (Verify)…', 'busy');
    setTimeout(() => {
      try {
        const ss = new StockSim(this.project, this.result.sim).runAll();
        const T = buildTarget(this.project, ss.opts);
        const c = compare(ss.stock, T, this.project.part.length);
        this.verify = { ss, c, ms: performance.now() - t0 };
        this.renderMsgs(); this.renderVerify(); this.applyVerifyColors();
        const bad = this.result.errors.length + ss.collisions.length + (c.over ? 1 : 0);
        this.status(bad ? `${bad} sorun` : 'Hazır · Doğrulandı', bad ? 'err' : '');
      } catch (e) { console.error(e); this.status('Verify hatası', 'err'); }
    }, 20);
  }

  computeOpTimes() {
    const out = {};
    const r = this.result;
    if (!r.sim || !r.posted) return out;
    r.sim.paths.forEach((p, pi) => {
      const info = r.posted.lineInfo[pi] || [];
      for (const m of p.moves) {
        const op = info[m.line]?.opId;
        if (!op) continue;
        const o = out[op] || (out[op] = { t0: Infinity, t1: 0, path: pi + 1, line0: m.line });
        o.t0 = Math.min(o.t0, m.t0); o.t1 = Math.max(o.t1, m.t1);
      }
    });
    return out;
  }

  // ------------------------------------------------------------ sahne
  buildScene() {
    const v = this.viewer;
    if (this.machine) v.scene.remove(this.machine.root);
    this.machine = new MachineModel(this.project);
    v.scene.add(this.machine.root);
    this.machine.attachStock(this.stockSim);
    // takım yolu
    const { g1, g2, byOp } = buildPathLines(this.result.sim, this.project.part.length, this.result.posted?.lineInfo);
    this.path1 = g1; this.path2 = g2; this.pathByOp = byOp;
    this.machine.mainHolder.add(g1);
    this.machine.subHolder.add(g2);
    // hedef model (hayalet)
    const ghost = this.project.part.mesh && this.project.part.fixture ? ghostFromMesh(this.project.part) : ghostFromProfile(this.project.part);
    this.ghost = ghost;
    this.machine.partMesh.mesh.add(ghost);
    this.applyOptions();
    this.machine.update(this.stockSim, this.t, 0);
  }
  applyOptions() {
    if (!this.machine) return;
    if (this.ghost) this.ghost.visible = $('optGhost').checked;
    this.machine.toolMode = $('optTools').value;
    this.machine.setCabin($('optCabin').value);
    this.machine.setAxesVisible($('optAxes').checked);
    this.viewer.grid.visible = true;
    this.applyPathVis(true);
    this.applyVerifyColors();
  }
  /** Takım yolu görünürlüğü: Tümü | Aktif işlem | Seçili işlem | Gizli; ayrıca işlem başına göz düğmesi */
  applyPathVis(force = false) {
    if (!this.pathByOp) return;
    const mode = $('optPath').value;
    const m = this.machine, li = this.result.posted?.lineInfo || [];
    const act = new Set([li[0]?.[m?.m1?.line]?.opId, li[1]?.[m?.m2?.line]?.opId].filter(Boolean));
    const key = mode + '|' + [...act].join(',') + '|' + (this.sel.kind === 'op' ? this.sel.id : '');
    if (!force && key === this._pathKey) return;
    this._pathKey = key;
    const hidden = new Set(this.project.ops.filter(o => o.hidePath).map(o => o.id));
    for (const [id, groups] of this.pathByOp) {
      const on = !hidden.has(id) && (mode === 'all' || (mode === 'op' && act.has(id)) || (mode === 'sel' && this.sel.kind === 'op' && this.sel.id === id));
      for (const g of groups) g.visible = on;
    }
  }
  applyVerifyColors() {
    if (!this.machine) return;
    const on = $('optVerify').checked && this.verify;
    if (on) {
      // renkler son durumu gösterir: simülasyonu sona al
      this.seek(this.totalTime);
      this.machine.partMesh.setStatusColors(this.verify.c.status);
    } else this.machine.partMesh.setStatusColors(null);
  }

  frame(dt) {
    if (!this.stockSim) return;
    if (this.playing) {
      this.t = Math.min(this.totalTime, this.t + dt * this.speed);
      if (this.t >= this.totalTime) { this.playing = false; $('playBtn').textContent = '▶'; }
      this.stockSim.seek(this.t);
    }
    this.machine.update(this.stockSim, this.t, this.playing ? dt * Math.min(this.speed, 3) : 0);
    const now = performance.now();
    if (now - this.lastUi > 90) { this.lastUi = now; this.updateLive(); }
  }
  seek(t) {
    this.t = Math.max(0, Math.min(this.totalTime || 0, t));
    this.stockSim.seek(this.t);
    this.machine.update(this.stockSim, this.t, 0);
    this.updateLive(true);
  }

  updateLive(force = false) {
    const T = this.totalTime || 0;
    $('ptime').textContent = `${this.t.toFixed(1)} / ${T.toFixed(1)} s  (${fmtTime(T)})`;
    if (!this._scrubbing) $('scrub').value = T ? Math.round((this.t / T) * 1000) : 0;
    // DRO
    const m = this.machine;
    if (!m) return;
    const rows = { 1: [], 2: [] };
    const b = (title, ch, pose, mv) => {
      const st = mv?.state;
      const tool = st?.tool;
      const p = pose.p, mm = pose.m;
      const to = mv ? mv.to : p;
      const S = ch === 1 ? (mv?.rpm && !st?.cAxis ? Math.round(mv.rpm) : st?.main.dir !== 'stop' ? Math.round(st?.main.rpm || 0) : 0) : Math.round(st?.sub.rpm || 0);
      const live = ch === 1 ? (st?.live.dir !== 'stop' ? st?.live.rpm : 0) : (st?.backLive.dir !== 'stop' ? st?.backLive.rpm : 0);
      const axes = ch === 1 ? [['X', 'X1'], ['Y', 'Y1'], ['Z', 'Z1'], ['C', 'C1']] : [['X', 'X2'], ['Z', 'Z2'], ['C', 'C2']];
      const f = (v, k) => (v ?? 0).toFixed(k === 'C' ? 2 : 3);
      const tr = axes.map(([k, name]) => {
        const rem = (to?.[k] ?? 0) - (p[k] ?? 0);
        rows[ch].push([name, f(p[k], k), f(mm[k], k)]);
        return `<tr><th>${name}</th><td>${f(p[k], k)}</td><td class="mc">${f(mm[k], k)}</td><td class="rm">${Math.abs(rem) > 5e-4 ? f(rem, k) : ''}</td></tr>`;
      }).join('');
      return `<div class="drob"><h4><span>${title}</span><span>${st ? st.wo : ''} · ${mv ? kindLabel(mv.kind) : ''}</span></h4>
        <table class="drot"><tr class="hd"><th></th><td>Mutlak</td><td class="mc">Makine</td><td class="rm">Kalan</td></tr>${tr}</table>
        <div class="r"><span>S</span><span>${S || 0}${live ? ' · ' + live : ''} dev/dk</span></div>
        <div class="r"><span>F</span><span>${mv && mv.feed ? mv.feed.toFixed(0) + ' mm/dk' : mv?.kind === 'rapid' ? 'G0' : '—'}</span></div>
        <div class="tl">${tool ? 'T' + String(tool.num).padStart(2, '0') + ' ' + esc(tool.name) : 'Takım yok'}</div></div>`;
    };
    $('dro').innerHTML = b('$1 ANA İŞ MİLİ', 1, m.pose1, m.m1) + (this.result.sim.paths[1] ? b('$2 KARŞI İŞ MİLİ', 2, m.pose2, m.m2) : '');
    if ($('optAxes').checked) m.updateLabels();
    if ($('optCabin').value === 'full') {
      const ln = m.m1 ? this.result.sim.paths[0].lines[m.m1.line]?.src : '';
      m.cabin.drawScreen({ axes: [...rows[1], ...rows[2].slice(0, 2)], foot: (m.m1 ? 'N' + (m.m1.line + 1) + ' ' : '') + (ln || '') });
    }
    if ($('optPath').value === 'op') this.applyPathVis();
    // NC satır vurgusu
    for (const ch of [1, 2]) {
      const mv = ch === 1 ? m.m1 : m.m2;
      const col = $('nc' + ch);
      const prev = col.querySelector('.nl.cur');
      const li = mv ? mv.line : -1;
      if (prev && +prev.dataset.l === li) continue;
      if (prev) prev.classList.remove('cur');
      const el = col.querySelector(`.nl[data-l="${li}"]`);
      if (el) {
        el.classList.add('cur');
        const top = el.offsetTop, hgt = col.clientHeight;
        if (force || top < col.scrollTop + 20 || top > col.scrollTop + hgt - 40) col.scrollTop = top - hgt / 3;
      }
    }
    const cur = $('syncCursor');
    if (cur && T) cur.style.left = `calc(${(this.t / T) * 100}% - 1px)`;
    // aktif işlem ağaçta
    const op1 = this.result.posted?.lineInfo[0]?.[m.m1?.line]?.opId;
    const op2 = this.result.posted?.lineInfo[1]?.[m.m2?.line]?.opId;
    document.querySelectorAll('.titem.active').forEach(e => { if (e.dataset.id !== op1 && e.dataset.id !== op2) e.classList.remove('active'); });
    for (const id of [op1, op2]) if (id) document.querySelector(`.titem[data-id="${id}"]`)?.classList.add('active');
  }

  // ------------------------------------------------------------ arayüz bağlama
  bindChrome() {
    const P = () => this.project;
    const groups = {
      rbTurn: ['face', 'rough', 'finish', 'groove', 'thread', 'center', 'drill', 'tap', 'cutoff', 'rechuck', 'midRechuck'],
      rbMill: ['crossDrill', 'flatMill', 'polygonMill', 'cylSlot', 'engrave', 'pocketMill'],
      rbSub: ['pickoff', 'backTurn', 'backDrill', 'backTap', 'backSlot', 'backPolar', 'eject'],
    };
    const icons = { face: '⊣', rough: '▥', finish: '◜', groove: '⊔', thread: '≋', center: '▽', drill: '↧', tap: '⇊', cutoff: '✂', rechuck: '⇤', midRechuck: '⇆', crossDrill: '⊥', flatMill: '▭', polygonMill: '⬡', cylSlot: '◍', engrave: 'Ａ', pocketMill: '◎', pickoff: '⇥', backTurn: '◺', backDrill: '↤', backTap: '⇇', backSlot: '⊖', backPolar: '⬢', eject: '⏏' };
    for (const [gid, types] of Object.entries(groups)) {
      const box = $(gid);
      for (const t of types) box.append(h('button', { class: 'rb', title: OP_TYPES[t].label, onclick: () => this.addOp(t) }, h('i', {}, icons[t] || '+'), shortLabel(t)));
    }
    document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this.action(b.dataset.act)));
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      this.viewer.view(b.dataset.view);
      document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
    }));
    ['optPath', 'optGhost', 'optVerify', 'optTools', 'optCabin', 'optAxes'].forEach(id => $(id).addEventListener('change', () => { this.applyOptions(); this.saveViewOpts(); }));
    this.loadViewOpts();
    document.querySelectorAll('[data-pl]').forEach(b => b.addEventListener('click', () => this.player(b.dataset.pl)));
    $('speed').addEventListener('change', e => { this.speed = parseFloat(e.target.value); });
    const sc = $('scrub');
    sc.addEventListener('input', () => { this._scrubbing = true; this.seek((sc.value / 1000) * this.totalTime); });
    sc.addEventListener('change', () => { this._scrubbing = false; });
    document.querySelectorAll('.bt').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.bt').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.bpane').forEach(x => x.classList.toggle('active', x.id === 'pane-' + b.dataset.bt));
    }));
    $('mclose').addEventListener('click', () => this.closeModal());
    $('fileStep').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.loadStep(f); });
    $('fileProj').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { this.project = loadProject(await f.text()); this.sel = { kind: 'stock' }; await this.reviveStep(); this.recalc(); this.toast('Proje açıldı: ' + f.name); }
      catch (err) { this.toast('Proje açılamadı: ' + err.message, 5000); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); this.player('play'); }
      if (e.code === 'ArrowRight') this.player('fwd');
      if (e.code === 'ArrowLeft') this.player('back');
      if (e.code === 'KeyT') { const o = $('optPath'); o.value = o.value === 'none' ? 'all' : 'none'; this.applyOptions(); this.saveViewOpts(); }
      if (e.code === 'KeyE') { const o = $('optAxes'); o.checked = !o.checked; this.applyOptions(); this.saveViewOpts(); }
    });
    // görünümde yüz seçimi (bağlama modu)
    this.viewer.renderer.domElement.addEventListener('click', (e) => this.pick(e));
    if (this._pendingStep) this.reviveStep().then(() => this.recalc(true));
    else this.reviveToolModels().then(n => { if (n) this.recalc(true); });
  }

  player(cmd) {
    if (!this.stockSim) return;
    if (cmd === 'play') {
      if (this.t >= this.totalTime - 1e-6) this.seek(0);
      this.playing = !this.playing;
      $('playBtn').textContent = this.playing ? '❚❚' : '▶';
      if (this.playing && $('optVerify').checked) { $('optVerify').checked = false; this.applyOptions(); }
    } else if (cmd === 'start') { this.playing = false; $('playBtn').textContent = '▶'; this.seek(0); }
    else if (cmd === 'end') { this.playing = false; $('playBtn').textContent = '▶'; this.seek(this.totalTime); }
    else if (cmd === 'fwd' || cmd === 'back') {
      this.playing = false; $('playBtn').textContent = '▶';
      // aktif kanalda sonraki/önceki NC satırı
      const all = [...this.result.sim.paths[0].moves, ...(this.result.sim.paths[1]?.moves || [])].filter(m => m.kind !== 'wait').sort((a, b) => a.t0 - b.t0);
      if (cmd === 'fwd') { const n = all.find(m => m.t1 > this.t + 1e-6); if (n) this.seek(n.t1); }
      else { const p = [...all].reverse().find(m => m.t0 < this.t - 1e-6); if (p) this.seek(p.t0); }
    }
  }

  action(a) {
    switch (a) {
      case 'new': if (confirm('Yeni proje açılsın mı? Kaydedilmemiş değişiklikler kaybolur.')) { this.project = newProject(examplePart()); this.sel = { kind: 'stock' }; this.recalc(); } break;
      case 'open': $('fileProj').click(); break;
      case 'save': download((this.project.name || 'proje') + '.kcam', saveProject(this.project), 'application/json'); this.toast('Proje kaydedildi'); break;
      case 'step': $('fileStep').click(); break;
      case 'fixture': this.sel = { kind: 'zero' }; this.renderProps(); this.renderTree(); break;
      case 'profile': this.sel = { kind: 'part' }; this.renderProps(); this.renderTree(); break;
      case 'auto':
        if (!confirm('Mevcut işlem listesi silinip özelliklere göre otomatik plan oluşturulsun mu?')) return;
        this.project.ops = autoOperations(this.project); this.sel = { kind: 'op', id: this.project.ops[0]?.id }; this.recalc(); break;
      case 'calc': this.recalc(); this.toast('Program yeniden hesaplandı'); break;
      case 'download': this.downloadNC(); break;
      case 'postcfg': this.openPostConfig(); break;
    }
  }

  downloadNC() {
    const r = this.result;
    if (!r?.posted) { this.toast('Önce programı hesaplayın'); return; }
    if (!this.verify) { this.toast('Verify ve çarpışma kontrolü sürüyor — bitince indirin.', 3500); return; }
    const errs = r.errors.length + this.verify.ss.collisions.length + (this.verify.c.over ? 1 : 0);
    if (errs) { this.toast(`İndirme kilitli: ${errs} hata var. Hatalar sekmesine bakın.`, 4500); document.querySelector('[data-bt="msgs"]').click(); return; }
    const name = `O${String(this.project.post.programNumber).padStart(4, '0')}`;
    download(name + '.nc', r.posted.text.replace(/\n/g, '\r\n'), 'text/plain');
    if (!this.project.post.verified) this.toast('UYARI: Post doğrulanmadı — makinede önce kuru çalıştırma / tek blok ile deneyin!', 6000);
  }

  // ------------------------------------------------------------ işlemler
  addOp(type) {
    const P = this.project;
    const def = OP_TYPES[type];
    const tool = def.tools.length ? P.tools.find(t => def.tools.includes(t.type) && t.channel === def.channel) : null;
    const op = makeOp(type, tool?.id ?? null);
    const featType = (OP_PARAMS[type].find(p => p[0] === 'featureId') || [])[2];
    if (featType) {
      const [, ft, side] = featType.split(':');
      const used = new Set(P.ops.filter(o => o.type === type).map(o => o.params.featureId));
      const f = P.part.features.find(x => x.type === ft && (!side || x.side === side) && !used.has(x.id)) || P.part.features.find(x => x.type === ft && (!side || x.side === side));
      if (f) op.params.featureId = f.id;
    }
    // konum: $1 işlemleri kesmeden önce, $2 işlemleri sona (atmadan önce)
    let idx = P.ops.length;
    if (def.channel === 1 && type !== 'rechuck') {
      const ci = P.ops.findIndex(o => o.type === 'cutoff' || o.type === 'pickoff');
      if (ci >= 0 && type !== 'cutoff') idx = ci;
      if (type === 'cutoff') { const ri = P.ops.findIndex(o => o.type === 'rechuck'); if (ri >= 0) idx = ri; }
    } else if (def.channel === 2 && type !== 'eject') {
      const ei = P.ops.findIndex(o => o.type === 'eject');
      if (ei >= 0) idx = ei;
      if (type === 'pickoff') { const ci = P.ops.findIndex(o => o.type === 'cutoff'); if (ci >= 0) idx = ci; }
    }
    P.ops.splice(idx, 0, op);
    this.sel = { kind: 'op', id: op.id };
    this.recalc(true);
    this.toast(`${op.name} eklendi`);
  }

  // ------------------------------------------------------------ sol ağaç
  renderTree() {
    const P = this.project, tree = $('tree');
    tree.innerHTML = '';
    const errOps = new Set((this.result?.errors || []).filter(e => e.op).map(e => e.op));
    const item = (kind, id, icon, name, extra = '', opts = {}) => {
      const sel = this.sel.kind === kind && (id == null || this.sel.id === id);
      const el = h('div', { class: 'titem' + (sel ? ' sel' : '') + (opts.off ? ' off' : ''), 'data-id': id || '', onclick: () => { this.sel = { kind, id }; this.renderTree(); this.renderProps(); if (opts.onSel) opts.onSel(); } },
        opts.check || null, h('span', { class: 'ic' }, icon), h('span', { class: 'nm' }, name), extra ? h('span', { class: 'tm', html: extra }) : null, opts.tail || null);
      return el;
    };
    tree.append(h('div', { class: 'tsec' }, 'Makine Grubu'));
    tree.append(item('machine', null, '⚙', P.machine.name));
    tree.append(item('stock', null, '▮', `Stok Ø${P.stock.barDia} çubuk`));
    tree.append(item('zero', null, '⊕', `Sıfır: ${P.zero?.label || 'Ön alın'}${P.zero?.zShift ? ' (Z' + P.zero.zShift + ')' : ''}`));
    tree.append(item('part', null, '⬢', `${P.part.name} · L${P.part.length.toFixed(2)}`));
    for (const f of P.part.features) tree.append(item('feature', f.id, '·', `${FEATURE_LABELS[f.type]} ${featureText(f)}`));
    tree.append(h('div', { class: 'tsec' }, `Takımlar (${P.tools.length})`));
    for (const t of [...P.tools].sort((a, b) => a.num - b.num)) tree.append(item('tool', t.id, t.channel === 2 ? '②' : '①', `T${String(t.num).padStart(2, '0')} ${t.name}`, UNITS[t.unit].label));
    tree.append(h('div', { class: 'btnrow', style: { padding: '4px 18px' } }, h('button', { class: 'btn', onclick: () => this.addTool() }, '+ Takım')));
    for (const ch of [1, 2]) {
      tree.append(h('div', { class: 'tsec' }, ch === 1 ? '$1 İşlemler — Ana İş Mili' : '$2 İşlemler — Karşı İş Mili'));
      P.ops.forEach((op, i) => {
        if (OP_TYPES[op.type].channel !== ch) return;
        const ot = this.opTimes?.[op.id];
        const chk = h('input', { type: 'checkbox', onclick: (e) => e.stopPropagation(), onchange: (e) => { op.enabled = e.target.checked; this.recalc(true); } });
        chk.checked = op.enabled;
        const eye = h('button', { class: 'eye' + (op.hidePath ? ' hid' : ''), title: op.hidePath ? 'Takım yolunu göster' : 'Takım yolunu gizle',
          onclick: (e) => { e.stopPropagation(); op.hidePath = !op.hidePath; this.renderTree(); this.applyPathVis(true); this.autosave(); } }, op.hidePath ? '◌' : '◉');
        const el = item('op', op.id, errOps.has(op.id) ? '✗' : '›', op.name, (errOps.has(op.id) ? '<span class="bad">!</span> ' : '') + (ot ? (ot.t1 - ot.t0).toFixed(1) + 's' : ''), { check: chk, off: !op.enabled, tail: eye, onSel: () => { if (ot) this.seek(ot.t0); this.applyPathVis(true); } });
        el.draggable = true;
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/op', op.id); });
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
        el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
        el.addEventListener('drop', (e) => {
          e.preventDefault(); el.classList.remove('drag-over');
          const id = e.dataTransfer.getData('text/op');
          const from = P.ops.findIndex(o => o.id === id);
          if (from < 0 || id === op.id) return;
          const [mv] = P.ops.splice(from, 1);
          P.ops.splice(P.ops.findIndex(o => o.id === op.id), 0, mv);
          this.recalc(true);
        });
        tree.append(el);
      });
    }
  }

  addTool() {
    const P = this.project;
    const num = Math.max(0, ...P.tools.map(t => t.num)) + 1;
    const t = makeTool({ num, name: 'Yeni Takım', type: 'turn', unit: 'gang', yPos: 110 });
    P.tools.push(t);
    this.sel = { kind: 'tool', id: t.id };
    this.recalc(true);
  }

  // ------------------------------------------------------------ sağ panel
  renderProps() {
    const P = this.project, box = $('props');
    box.innerHTML = '';
    const change = () => this.recalc(true);
    const head = (title, sub) => box.append(h('div', { class: 'ph' }, h('h3', {}, title), sub ? h('span', { class: 'sub' }, sub) : null));
    const body = h('div', { class: 'pbody' });
    const s = this.sel;
    if (s.kind === 'op') {
      const op = P.ops.find(o => o.id === s.id);
      if (!op) { head('Seçim yok'); return; }
      const def = OP_TYPES[op.type];
      head(op.name, def.label + ' · $' + def.channel);
      const g = h('div', { class: 'fg' });
      g.append(field(op, 'name', 'İşlem adı', '', 'text', () => this.renderTree(), { full: true }));
      if (def.tools.length) {
        const items = [['', '— seçin —'], ...P.tools.filter(t => def.tools.includes(t.type) && t.channel === def.channel).map(t => [t.id, `T${String(t.num).padStart(2, '0')} ${t.name}`])];
        g.append(field(op, 'toolId', 'Takım', '', 'select:x', change, { items, full: true }));
      }
      for (const [k, label, unit] of OP_PARAMS[op.type]) {
        if (unit && unit.startsWith('feat:')) {
          const [, ft, side] = unit.split(':');
          const items = [['', '— seçin —'], ...P.part.features.filter(f => f.type === ft && (!side || f.side === side)).map(f => [f.id, featureText(f)])];
          g.append(field(op.params, k, label, '', 'select:x', change, { items, full: true }));
        } else g.append(field(op.params, k, label, unit === 'bool' ? '' : unit, unit === 'bool' ? 'bool' : unit === 'adet' ? 'int' : 'num', change));
      }
      body.append(g);
      const errs = (this.result?.errors || []).filter(e => e.op === op.id);
      for (const e of errs) body.append(h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), e.msg));
      const ot = this.opTimes?.[op.id];
      if (ot) body.append(h('div', { class: 'kv' }, h('span', {}, 'Süre'), h('span', {}, (ot.t1 - ot.t0).toFixed(2) + ' s'), h('span', {}, 'Başlangıç'), h('span', {}, ot.t0.toFixed(2) + ' s')));
      body.append(h('div', { class: 'btnrow' },
        h('button', { class: 'btn', onclick: () => { const i = P.ops.indexOf(op); if (i > 0) { P.ops.splice(i, 1); P.ops.splice(i - 1, 0, op); change(); } } }, '↑ Yukarı'),
        h('button', { class: 'btn', onclick: () => { const i = P.ops.indexOf(op); if (i < P.ops.length - 1) { P.ops.splice(i, 1); P.ops.splice(i + 1, 0, op); change(); } } }, '↓ Aşağı'),
        h('button', { class: 'btn', onclick: () => { const c = clone(op); c.id = makeOp(op.type).id; c.name += ' (kopya)'; P.ops.splice(P.ops.indexOf(op) + 1, 0, c); this.sel = { kind: 'op', id: c.id }; change(); } }, 'Kopyala'),
        h('button', { class: 'btn', onclick: () => { op.params = { ...defaultParams(op.type), featureId: op.params.featureId }; change(); } }, 'Varsayılan'),
        h('button', { class: 'btn dan', onclick: () => { P.ops.splice(P.ops.indexOf(op), 1); this.sel = { kind: 'stock' }; change(); } }, 'Sil')));
      body.append(h('div', { class: 'hint' }, 'Boş bırakılan ilerleme/kesme hızı takım değerinden alınır. Bütün değerler makine limitleriyle sınırlanır; aşımda hata verilir.'));
    } else if (s.kind === 'tool') {
      const t = P.tools.find(x => x.id === s.id);
      if (!t) return;
      head(`T${String(t.num).padStart(2, '0')} ${t.name}`, TOOL_TYPES[t.type].label);
      const g = h('div', { class: 'fg' });
      for (const [k, label, unit, kind, full] of TOOL_FIELDS) g.append(field(t, k, label, unit, kind || 'num', (key) => {
        if (key === 'unit') { t.channel = UNITS[t.unit].channel; }
        if (key === 'type' || key === 'unit') t.live = TOOL_TYPES[t.type].live || t.unit === 'cross';
        change();
      }, { full: full === 'full' }));
      body.append(g);
      body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, '3D Model'));
      body.append(h('div', { class: 'hint' }, t.model ? `Üretici STEP modeli bağlı (${t.model.name || 'model'}). Görsel amaçlıdır; kesme hesabı takım ölçülerinden yapılır.` : 'Parametrik model kullanılıyor. Üreticinin sitesinden (Sandvik, Iscar, Kennametal, Vargus vb.) indirdiğiniz STEP modelini bağlayabilirsiniz.'));
      const tf = h('input', { type: 'file', accept: '.stp,.step,.STP,.STEP', hidden: true });
      tf.addEventListener('change', async () => {
        const f = tf.files[0]; if (!f) return;
        this.status('Takım modeli okunuyor…', 'busy');
        try {
          const m = await loadToolModel(f);
          customToolModels.set(t.id, m);
          t.model = { b64: m.b64, name: f.name, flip: false, axis: null, rotY: 0 };
          this.recalc(true); this.toast('Takım modeli bağlandı: ' + f.name);
        } catch (e) { this.toast('Model okunamadı: ' + e.message, 5000); this.status('Hazır'); }
      });
      body.append(tf);
      const tm = (fn) => () => { if (!t.model) return; fn(t.model); this.recalc(true); };
      body.append(h('div', { class: 'btnrow' },
        h('button', { class: 'btn pri', onclick: () => tf.click() }, 'STEP Model Yükle'),
        t.model ? h('button', { class: 'btn', onclick: tm(m => { m.flip = !m.flip; }) }, 'Ucu Çevir') : null,
        t.model ? h('button', { class: 'btn', onclick: tm(m => { m.axis = ((m.axis ?? 0) + 1) % 3; }) }, 'Ekseni Değiştir') : null,
        t.model ? h('button', { class: 'btn', onclick: tm(m => { m.rotY = ((m.rotY || 0) + 90) % 360; }) }, '90° Döndür') : null,
        t.model ? h('button', { class: 'btn dan', onclick: () => { delete t.model; customToolModels.delete(t.id); this.recalc(true); } }, 'Modeli Kaldır') : null));
      body.append(h('div', { class: 'hint' }, `Kanal: $${t.channel} · ${t.live ? 'Tahrikli (döner) takım' : 'Sabit takım'}. Yanal konum, takımın gang plakasında Y1 ofsetidir; çarpışma olmaması için takımlar arası en az 15 mm bırakın.`));
      body.append(h('div', { class: 'btnrow' },
        h('button', { class: 'btn', onclick: () => { const c = clone(t); c.id = makeTool({}).id; c.num = Math.max(...P.tools.map(x => x.num)) + 1; c.offset = c.num; c.name += ' (kopya)'; P.tools.push(c); this.sel = { kind: 'tool', id: c.id }; change(); } }, 'Kopyala'),
        h('button', { class: 'btn dan', onclick: () => { if (P.ops.some(o => o.toolId === t.id)) { this.toast('Bu takım işlemlerde kullanılıyor'); return; } P.tools.splice(P.tools.indexOf(t), 1); this.sel = { kind: 'stock' }; change(); } }, 'Sil')));
    } else if (s.kind === 'stock') {
      head('Stok (Çubuk)', 'Mastercam: Stock Setup');
      const g = h('div', { class: 'fg' });
      g.append(field(P.stock, 'barDia', 'Çubuk çapı', 'mm', 'select:x', change, { items: STD_BARS.filter(b => b <= P.machine.maxBarDia).map(b => [b, 'Ø' + b]) }));
      g.append(field(P.stock, 'faceStock', 'Alın payı', 'mm', 'num', change));
      g.append(field(P.stock, 'maxRpm', 'G50 devir limiti', 'dev/dak', 'int', change));
      g.append(field(P.stock, 'segment', 'Kılavuz burç segment boyu (0 = kapalı)', 'mm', 'num', change));
      body.append(g);
      const cut = P.tools.find(t => t.type === 'cutoff');
      body.append(h('div', { class: 'kv' },
        h('span', {}, 'Parça boyu'), h('span', {}, P.part.length.toFixed(3) + ' mm'),
        h('span', {}, 'En büyük çap'), h('span', {}, 'Ø' + P.part.maxDia.toFixed(3)),
        h('span', {}, 'Önerilen çubuk'), h('span', {}, 'Ø' + (suggestBar(P.part.maxDia, P.machine.maxBarDia) ?? '— (makine kapasitesi aşıldı)')),
        h('span', {}, 'Kesme genişliği'), h('span', {}, (cut ? cut.width : 2) + ' mm'),
        h('span', {}, 'Parça başı çubuk'), h('span', {}, (P.part.length + (cut ? cut.width : 2) + P.stock.faceStock).toFixed(2) + ' mm')));
      if (P.part.maxDia > P.stock.barDia + 1e-6) body.append(h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), 'Parça çapı çubuk çapından büyük!'));
    } else if (s.kind === 'zero') {
      head('Bağlama ve Sıfır Noktası', 'Work Zero');
      if (!P.zero) P.zero = { zShift: 0, label: 'Ön alın merkezi' };
      body.append(h('div', { class: 'hint' }, 'Torna ekseni parça eksenine bağlanır. X0 her zaman eksen merkezidir. Z0 varsayılan olarak parça ön alnıdır (Star alışkanlığı). Farklı bir yüze almak için kaydırma girin.'));
      const g = h('div', { class: 'fg' });
      g.append(field(P.zero, 'zShift', 'Z0 kaydırma (ön alından)', 'mm', 'num', () => { P.zero.label = P.zero.zShift ? 'Kaydırılmış' : 'Ön alın merkezi'; change(); }));
      body.append(g);
      body.append(h('div', { class: 'btnrow' },
        h('button', { class: 'btn', onclick: () => { P.zero = { zShift: 0, label: 'Ön alın merkezi' }; change(); } }, 'Ön alın merkezi'),
        h('button', { class: 'btn', onclick: () => { P.zero = { zShift: P.part.length, label: 'Arka alın (kesme yüzü)' }; change(); } }, 'Arka alın')));
      if (P.part.source === 'step') {
        body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'STEP Bağlama'));
        body.append(h('div', { class: 'hint' }, 'Torna eksenini değiştirmek için "Eksen Seç" düğmesine basıp 3D görünümde hedef modelin silindirik bir yüzüne tıklayın.'));
        body.append(h('div', { class: 'btnrow' },
          h('button', { class: 'btn pri', onclick: () => { this.pickMode = 'axis'; this.toast('3D görünümde silindirik bir yüze tıklayın'); } }, 'Eksen Seç (yüze tıkla)'),
          h('button', { class: 'btn', onclick: () => this.flipPart() }, 'Ön/Arka Çevir (180°)')));
      }
    } else if (s.kind === 'part') {
      head(P.part.name, P.part.source === 'step' ? 'STEP modelinden' : 'Profil tablosundan');
      body.append(field(P.part, 'name', 'Parça adı', '', 'text', () => { P.name = P.part.name; change(); }, { full: true }));
      if (P.part.source !== 'step') {
        const rows = P.part.rows || [];
        const tbl = h('table', { class: 'pt' }, h('tr', {}, ...['Ø', 'Boy', 'Son Ø', 'Pah', 'R', ''].map(x => h('th', {}, x))));
        const upd = () => { P.part = { ...makePart({ name: P.part.name, profile: profileFromTable(rows), features: P.part.features }), rows }; change(); };
        rows.forEach((r, i) => {
          const cell = (k) => { const inp = h('input', { type: 'number', step: 'any', value: r[k] ?? '' }); inp.addEventListener('change', () => { r[k] = inp.value === '' ? undefined : parseFloat(inp.value); upd(); }); return h('td', {}, inp); };
          tbl.append(h('tr', {}, cell('dia'), cell('len'), cell('endDia'), cell('ch'), cell('rad'), h('td', {}, h('button', { onclick: () => { rows.splice(i, 1); upd(); } }, '✕'))));
        });
        body.append(h('div', { class: 'hint' }, 'Profil: ön alından arkaya doğru çap/boy satırları. Pah/R satır başındaki dış köşeye uygulanır.'));
        body.append(tbl);
        body.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { rows.push({ dia: rows.length ? rows[rows.length - 1].dia : 10, len: 5 }); upd(); } }, '+ Satır')));
      } else {
        body.append(h('div', { class: 'kv' }, h('span', {}, 'Boy'), h('span', {}, P.part.length.toFixed(3)), h('span', {}, 'Maks. çap'), h('span', {}, P.part.maxDia.toFixed(3)), h('span', {}, 'Profil noktası'), h('span', {}, P.part.profile.length)));
      }
      body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'Özellikler'));
      for (const f of P.part.features) body.append(h('div', { class: 'feat', onclick: () => { this.sel = { kind: 'feature', id: f.id }; this.renderTree(); this.renderProps(); } }, h('b', {}, FEATURE_LABELS[f.type]), featureText(f)));
      body.append(h('div', { class: 'btnrow' }, ...Object.keys(FEATURE_FIELDS).map(ft => h('button', { class: 'btn', onclick: () => this.addFeature(ft) }, '+ ' + FEATURE_LABELS[ft]))));
    } else if (s.kind === 'feature') {
      const f = P.part.features.find(x => x.id === s.id);
      if (!f) return;
      head(FEATURE_LABELS[f.type], featureText(f));
      const g = h('div', { class: 'fg' });
      for (const [k, label, unit] of FEATURE_FIELDS[f.type]) g.append(field(f, k, label, unit === 'bool' || unit === 'text' || unit.startsWith('select') ? '' : unit, unit === 'bool' || unit === 'text' ? unit : unit.startsWith('select') ? unit : unit === 'adet' ? 'int' : 'num', change, { full: unit === 'text' }));
      body.append(g);
      body.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn dan', onclick: () => { P.part.features.splice(P.part.features.indexOf(f), 1); this.sel = { kind: 'part' }; change(); } }, 'Özelliği Sil')));
    } else if (s.kind === 'machine') {
      head(P.machine.name, P.machine.control);
      body.append(h('div', { class: 'hint' }, P.machine.notes));
      const kv = h('div', { class: 'kv' });
      for (const [k, a] of Object.entries(P.machine.axes)) if (!k.startsWith('C')) kv.append(h('span', {}, k), h('span', {}, `${a.min} … ${a.max} mm${a.estimated ? ' (tahmini)' : ''}`));
      kv.append(h('span', {}, 'Ana iş mili'), h('span', {}, `${P.machine.mainSpindle.maxRpm} dev/dak`), h('span', {}, 'Karşı iş mili'), h('span', {}, `${P.machine.subSpindle.maxRpm} dev/dak`), h('span', {}, 'Çapraz tahrikli'), h('span', {}, `${P.machine.liveTools.cross.maxRpm} dev/dak · Ø${P.machine.liveTools.cross.maxDrill} delme`), h('span', {}, 'Hızlı ilerleme'), h('span', {}, `${P.machine.rapid / 1000} m/dak`));
      body.append(kv);
      body.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => this.openPostConfig() }, 'Makine / Post Ayarları')));
    }
    box.append(body);
  }

  addFeature(ft) {
    const P = this.project, L = P.part.length;
    const id = 'u' + Math.random().toString(36).slice(2, 7);
    const defs = {
      axialHole: { side: 'front', dia: 4, depth: Math.min(6, L / 2), through: false },
      crossHole: { dia: 3, z: L / 2, c: 0, y: 0, through: true, depthDia: null },
      flat: { c: 0, depth: 1, z0: L / 2 - 3, z1: L / 2 + 3 },
      thread: { dia: Math.round(P.part.maxDia * 0.7), pitch: 1, z0: 1, z1: Math.min(10, L / 2) },
      pocket: { dia: 6, depth: 1, z: L / 2, c: 0 },
      polygon: { n: 6, af: Math.round(P.part.maxDia * 0.8 * 10) / 10, z0: L / 2 - 3, z1: L / 2 + 3, c: 0 },
      odSlot: { width: 4, depth: 0.8, z0: L / 2 - 3, c0: 0, z1: L / 2 + 3, c1: 90 },
      faceSlot: { side: 'back', width: 4, depth: 1, c: 0 },
      engrave: { text: 'KAYAR', height: 3, depth: 0.15, z: L / 2, c: 0 },
      facePolygon: { side: 'back', n: 6, af: Math.round(P.part.maxDia * 0.6 * 10) / 10, depth: 2, c: 0 },
    };
    const f = { id, type: ft, ...defs[ft] };
    P.part.features.push(f);
    this.sel = { kind: 'feature', id };
    this.recalc(true);
  }

  // ------------------------------------------------------------ NC görünümü
  renderNC() {
    const r = this.result;
    for (const ch of [1, 2]) {
      const col = $('nc' + ch);
      col.innerHTML = '';
      const p = r.sim?.paths[ch - 1];
      col.append(h('div', { class: 'hd' }, ch === 1 ? '$1 — Ana İş Mili / Gang' : '$2 — Karşı İş Mili / Arka Ünite'));
      if (!p) continue;
      const errLines = new Set(r.errors.filter(e => e.path === ch && e.src === 'nc').map(e => e.line));
      const frag = document.createDocumentFragment();
      p.lines.forEach((ln, i) => {
        if (ln.empty) return;
        const el = document.createElement('div');
        el.className = 'nl' + (errLines.has(i) ? ' errl' : '');
        el.dataset.l = i;
        el.innerHTML = `<span class="n">${i + 1}</span><span>${colorize(ln.src)}</span>`;
        el.addEventListener('click', () => this.seekLine(ch, i));
        frag.append(el);
      });
      col.append(frag);
    }
  }
  seekLine(ch, li) {
    const m = this.result.sim.paths[ch - 1].moves.find(x => x.line >= li);
    if (m) { this.playing = false; $('playBtn').textContent = '▶'; this.seek(m.t0 + 1e-6); }
  }

  // ------------------------------------------------------------ senkronizasyon
  renderSync() {
    const box = $('sync'), r = this.result, P = this.project;
    box.innerHTML = '';
    if (!r.sim) return;
    const T = this.totalTime || 1;
    const colors = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#f59e0b', '#22d3ee'];
    box.append(h('div', { class: 'axis' }, ...[0, 0.25, 0.5, 0.75, 1].map(f => h('span', {}, (T * f).toFixed(1) + 's'))));
    for (const ch of [1, 2]) {
      const lane = h('div', { class: 'lt' });
      let k = 0;
      for (const op of P.ops) {
        const ot = this.opTimes[op.id];
        if (!ot || ot.path !== ch) continue;
        const left = (ot.t0 / T) * 100, w = Math.max(0.3, ((ot.t1 - ot.t0) / T) * 100);
        lane.append(h('div', { class: 'blk', title: `${op.name}  ${(ot.t1 - ot.t0).toFixed(2)} s`, style: { left: left + '%', width: w + '%', background: colors[k++ % colors.length] }, onclick: () => { this.sel = { kind: 'op', id: op.id }; this.renderTree(); this.renderProps(); this.seek(ot.t0); } }, op.name));
      }
      for (const m of r.sim.paths[ch - 1]?.moves || []) if (m.kind === 'wait') lane.append(h('div', { class: 'wt', style: { left: (m.t1 / T) * 100 + '%' } }, h('span', {}, 'W' + m.n)));
      if (ch === 1) lane.append(h('div', { class: 'cursor', id: 'syncCursor' }));
      box.append(h('div', { class: 'lane' }, h('div', { class: 'ln' }, ch === 1 ? '$1 Ana iş mili' : '$2 Karşı iş mili', h('br'), h('span', { style: { color: 'var(--t3)', fontFamily: 'var(--mono)' } }, (r.sim.paths[ch - 1]?.totalTime || 0).toFixed(1) + ' s')), lane));
    }
    box.append(h('div', { class: 'hint', style: { marginTop: '6px' } }, `Çevrim süresi: ${fmtTime(T)}  ·  Yeşil çizgiler bekleme (senkron) kodlarıdır; iki kanal o noktada birbirini bekler. Bloklara tıklayarak işleme gidin.`));
  }

  // ------------------------------------------------------------ mesajlar
  renderMsgs() {
    const box = $('msgs'), r = this.result;
    box.innerHTML = '';
    const list = [];
    for (const e of r.errors) list.push({ k: 'e', ...e });
    if (this.verify) for (const c of this.verify.ss.collisions) list.push({ k: 'e', src: 'verify', ...c });
    if (this.verify && this.verify.c.over) list.push({ k: 'e', src: 'verify', msg: `Fazla kesim: ${this.verify.c.over} hücre, en fazla ${this.verify.c.overMax.toFixed(3)} mm (kırmızı bölgeler)` });
    for (const w of r.warnings) list.push({ k: 'w', ...w });
    if (!this.project.post.verified) list.push({ k: 'w', src: 'post', msg: 'Post-processor M kodları makineden doğrulanmadı. Makinede çalışan örnek programı ekleyin ve Post Ayarları’ndan düzeltin.' });
    for (const [k, a] of Object.entries(this.project.machine.axes)) if (a.estimated) { list.push({ k: 'w', src: 'makine', msg: `${k} eksen stroku tahmini (${a.min}…${a.max}). Makineden doğrulayın.` }); break; }
    if (!list.some(x => x.k === 'e')) list.unshift({ k: 'o', src: 'durum', msg: this.verify ? `Hata yok · Verify tamam (${this.verify.ms.toFixed(0)} ms)` : 'Hata yok · Verify çalışıyor…' });
    const labels = { cam: 'CAM', post: 'POST', nc: 'NC', verify: 'VERIFY', makine: 'MAKİNE', durum: 'DURUM' };
    for (const m of list) {
      const loc = m.path ? `$${m.path} satır ${m.line + 1}` : labels[m.src] || '';
      box.append(h('div', { class: 'msg ' + m.k, onclick: () => { if (m.path != null && m.line != null) this.seekLine(m.path, m.line); if (m.op) { this.sel = { kind: 'op', id: m.op }; this.renderTree(); this.renderProps(); } } },
        h('span', { class: 'k' }, m.k === 'e' ? '✗' : m.k === 'w' ? '⚠' : '✓'), h('span', { class: 'src' }, loc || labels[m.src]), h('span', {}, m.msg)));
    }
    const ne = list.filter(x => x.k === 'e').length;
    $('msgBadge').textContent = ne || list.filter(x => x.k === 'w').length;
    $('msgBadge').className = 'badge' + (ne ? ' err' : '');
  }

  renderVerify() {
    const box = $('verify');
    box.innerHTML = '';
    if (!this.verify) { box.append(h('div', { class: 'spinner' })); return; }
    const { c, ss } = this.verify;
    const card = (l, v, cls) => h('div', { class: 'vcard ' + cls }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v));
    box.append(h('div', { class: 'vsum' },
      card('Fazla kesim', c.over ? `${c.over} · ${c.overMax.toFixed(3)} mm` : 'YOK', c.over ? 'bad' : 'ok'),
      card('Kalan malzeme', c.under ? `${((c.under / c.cells) * 100).toFixed(2)}% · ${c.underMax.toFixed(3)} mm` : 'YOK', c.under ? 'mid' : 'ok'),
      card('Çarpışma (takım, tutucu, makine)', ss.collisions.length ? String(ss.collisions.length) : 'YOK', ss.collisions.length ? 'bad' : 'ok'),
      card('İç delik', c.innerOver ? `${c.innerOver} fazla` : c.innerUnder ? `${c.innerUnder} eksik` : 'TAMAM', c.innerOver ? 'bad' : c.innerUnder ? 'mid' : 'ok'),
      card('Parça transferi', ss.state.separated ? (ss.state.attached === 'dropped' ? 'Düştü' : 'Karşı mile alındı') : 'Kesilmedi', ss.state.separated ? 'ok' : 'bad'),
      card('Çevrim süresi', fmtTime(this.totalTime), 'ok')));
    box.append(h('div', { class: 'hint', style: { marginTop: '10px' } }, 'Verify: simülasyon sonu stok, hedef parça ile hücre hücre karşılaştırılır (ızgara 0.05 mm × 3°). 3D görünümde "Verify renkleri" ile: yeşil = doğru, kırmızı = fazla kesim, mavi = kalan malzeme.'));
  }

  // ------------------------------------------------------------ STEP
  async loadStep(file) {
    this.openModal('STEP Yükleniyor', h('div', {}, h('div', { class: 'spinner' }), h('div', { class: 'hint', style: { textAlign: 'center' } }, file.name + ' — OpenCascade ile okunuyor…')));
    try {
      const res = await importStepFile(file);
      this.showStepResult(res);
    } catch (e) {
      console.error(e);
      this.openModal('STEP Hatası', h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), e.message));
    }
  }
  showStepResult(res) {
    const { part } = res;
    const bar = suggestBar(part.maxDia, this.project.machine.maxBarDia);
    const body = h('div', { class: 'pbody' });
    body.append(h('div', { class: 'kv' },
      h('span', {}, 'Model'), h('span', {}, part.name),
      h('span', {}, 'Parça boyu'), h('span', {}, part.length.toFixed(3) + ' mm'),
      h('span', {}, 'En büyük çap'), h('span', {}, 'Ø' + part.maxDia.toFixed(3)),
      h('span', {}, 'Önerilen çubuk'), h('span', {}, bar ? 'Ø' + bar : 'MAKİNE KAPASİTESİ (Ø20) AŞILDI'),
      h('span', {}, 'Torna ekseni'), h('span', {}, 'En büyük dış silindir (otomatik)'),
      h('span', {}, 'Sıfır noktası'), h('span', {}, 'Ön alın merkezi (Z0 X0)')));
    body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, `Tanınan özellikler (${part.features.length})`));
    const chosen = new Set(part.features.map(f => f.id));
    for (const f of part.features) {
      const cb = h('input', { type: 'checkbox' }); cb.checked = true;
      cb.addEventListener('change', () => { if (cb.checked) chosen.add(f.id); else chosen.delete(f.id); });
      body.append(h('label', { class: 'feat' }, cb, h('b', {}, FEATURE_LABELS[f.type]), featureText(f)));
    }
    body.append(h('div', { class: 'hint' }, 'Kanallar ve profil otomatik olarak döner profilden işlenir. Diş, STEP’te modellenmediği için Parça panelinden eklenmelidir.'));
    body.append(h('div', { class: 'btnrow' },
      h('button', { class: 'btn', onclick: () => { this.closeModal(); this.showStepResult(refixture(res, { flip: !res.flip })); } }, 'Ön/Arka Çevir'),
      h('button', { class: 'btn pri', onclick: () => {
        part.features = part.features.filter(f => chosen.has(f.id));
        const P = newProject(part);
        if (bar) P.stock.barDia = bar;
        P.part.stepB64 = res.b64;
        this.project = P;
        this.sel = { kind: 'zero' };
        this.closeModal();
        this.recalc();
        this.toast('STEP parça bağlandı, otomatik işlem planı oluşturuldu');
      } }, 'Onayla ve İşlem Planı Oluştur')));
    this.openModal('STEP Parça — Bağlama ve Özellik Tanıma', body);
    this._stepRes = res;
  }
  async reviveToolModels() {
    const list = this.project.tools.filter(t => t.model && t.model.b64 && !customToolModels.has(t.id));
    for (const t of list) {
      try { customToolModels.set(t.id, await loadToolModel(null, t.model.b64)); } catch (e) { console.warn('Takım modeli yüklenemedi', t.name, e); }
    }
    return list.length;
  }
  async reviveStep() {
    this.reviveToolModels().then(n => { if (n) this.recalc(true); });
    const p = this.project.part;
    if (p.source !== 'step' || !p.stepB64 || p.mesh) return;
    try {
      const res = await importStepFile(null, p.stepB64, { flip: !!p.flip, axisFaceId: p.axisFaceId });
      p.mesh = res.part.mesh; p.fixture = res.part.fixture;
    } catch (e) { console.warn('STEP yeniden yüklenemedi', e); }
  }
  async flipPart() {
    const p = this.project.part;
    if (p.source !== 'step' || !p.stepB64) return;
    const res = await importStepFile(null, p.stepB64, { flip: !p.flip, axisFaceId: p.axisFaceId });
    this.applyRefixture(res);
  }
  applyRefixture(res) {
    const P = this.project, old = P.part;
    res.part.stepB64 = old.stepB64;
    res.part.name = old.name;
    const np = newProject(res.part);
    np.stock = P.stock; np.tools = P.tools; np.post = P.post; np.machine = P.machine; np.zero = P.zero;
    this.project = np;
    this.recalc();
    this.toast('Bağlama güncellendi, işlem planı yeniden oluşturuldu');
  }
  pick(e) {
    if (this.pickMode !== 'axis' || !this.ghost || !this.project.part.mesh) return;
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.viewer.camera);
    const hit = rc.intersectObject(this.ghost, true)[0];
    if (!hit) { this.toast('Model yüzeyine tıklayın'); return; }
    const fid = this.project.part.mesh.faceOf[hit.faceIndex];
    this.pickMode = null;
    importStepFile(null, this.project.part.stepB64, { axisFaceId: fid }).then(res => this.applyRefixture(res)).catch(err => this.toast(err.message, 5000));
  }

  // ------------------------------------------------------------ post ayarları
  openPostConfig() {
    const P = this.project, post = P.post;
    const body = h('div', { class: 'pbody' });
    body.append(h('div', { class: 'hint' }, post.verifiedNote + ' Makinenizde COMM > M-CODE ekranından veya çalışan bir programdan kodları kontrol edin.'));
    const g = h('div', { class: 'fg' });
    g.append(field(post, 'programNumber', 'Program no (O)', '', 'int', () => {}));
    g.append(field(post, 'waitStart', 'Bekleme kodu başlangıcı (M)', '', 'int', () => {}));
    g.append(field(post, 'twoPath', 'İki kanal ($1/$2)', '', 'bool', () => {}));
    g.append(field(post, 'lineNumbers', 'Satır numarası (N)', '', 'bool', () => {}));
    g.append(field(post.spindleAddress, 'main', 'Ana iş mili adresi', '', 'text', () => {}));
    g.append(field(post.spindleAddress, 'sub', 'Karşı iş mili adresi', '', 'text', () => {}));
    g.append(field(post.spindleAddress, 'live', 'Tahrikli takım adresi', '', 'text', () => {}));
    g.append(field(post, 'toolCall', 'Takım çağırma şablonu', '', 'text', () => {}));
    body.append(g);
    body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'M Kodları'));
    const labels = { mainCW: 'Ana mil ileri', mainCCW: 'Ana mil geri', mainStop: 'Ana mil dur', subCW: 'Karşı mil ileri', subCCW: 'Karşı mil geri', subStop: 'Karşı mil dur', liveCW: 'Tahrikli ileri', liveCCW: 'Tahrikli geri', liveStop: 'Tahrikli dur', backLiveCW: 'Arka tahrikli ileri', backLiveCCW: 'Arka tahrikli geri', backLiveStop: 'Arka tahrikli dur', coolantOn: 'Soğutma aç', coolantOff: 'Soğutma kapa', backCoolantOn: 'Arka soğutma aç', backCoolantOff: 'Arka soğutma kapa', mainCAxisOn: 'C1 ekseni aç', mainCAxisOff: 'C1 ekseni kapa', subCAxisOn: 'C2 ekseni aç', subCAxisOff: 'C2 ekseni kapa', mainChuckClose: 'Ana pens kapa', mainChuckOpen: 'Ana pens aç', subChuckClose: 'Karşı pens kapa', subChuckOpen: 'Karşı pens aç', spindleSync: 'Senkron aç', spindleSyncOff: 'Senkron kapa', cutoffCheck: 'Kesim kontrol', partEject: 'Parça atma', barFeedStart: 'Çubuk besleme başla', barFeedEnd: 'Çubuk besleme bitir', programEnd: 'Program sonu', optionalStop: 'Opsiyonel dur' };
    const cg = h('div', { class: 'codes' });
    for (const k of Object.keys(post.codes)) cg.append(field(post.codes, k, labels[k] || k, '', 'text', () => {}));
    body.append(cg);
    const ver = h('label', { class: 'feat' }, h('input', { type: 'checkbox' }), h('b', {}, 'Doğrulandı'), 'M kodlarını makinedeki örnek programla karşılaştırdım');
    ver.querySelector('input').checked = !!post.verified;
    ver.querySelector('input').addEventListener('change', (e) => { post.verified = e.target.checked; });
    body.append(ver);
    body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'Makine limitleri'));
    const mg = h('div', { class: 'fg' });
    for (const [k, a] of Object.entries(P.machine.axes)) if (!k.startsWith('C')) { mg.append(field(a, 'min', k + ' min', 'mm', 'num', () => { a.estimated = false; })); mg.append(field(a, 'max', k + ' max', 'mm', 'num', () => { a.estimated = false; })); }
    mg.append(field(P.machine.mainSpindle, 'maxRpm', 'Ana mil maks.', 'dev/dak', 'int', () => {}));
    mg.append(field(P.machine.subSpindle, 'maxRpm', 'Karşı mil maks.', 'dev/dak', 'int', () => {}));
    mg.append(field(P.machine.liveTools.cross, 'maxRpm', 'Çapraz tahrikli maks.', 'dev/dak', 'int', () => {}));
    mg.append(field(P.machine.liveTools.back, 'maxRpm', 'Arka tahrikli maks.', 'dev/dak', 'int', () => {}));
    body.append(mg);
    body.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn pri', onclick: () => { this.closeModal(); this.recalc(true); this.toast('Post / makine ayarları uygulandı'); } }, 'Uygula ve Yeniden Hesapla')));
    this.openModal('Post-Processor ve Makine Ayarları', body);
  }

  openModal(title, content) {
    $('mtitle').textContent = title;
    const b = $('mbody'); b.innerHTML = ''; b.append(content);
    $('modal').classList.add('on');
  }
  closeModal() { $('modal').classList.remove('on'); }
}

// ------------------------------------------------------------ yardımcılar
function shortLabel(t) {
  return { face: 'Alın', rough: 'Kaba', finish: 'İnce', groove: 'Kanal', thread: 'Diş', center: 'Punta', drill: 'Delme', tap: 'Kılavuz', cutoff: 'Kesme', rechuck: 'Çubuk', midRechuck: 'Ara Bağ.', crossDrill: 'Ç.Delme', flatMill: 'Düzlük', pocketMill: 'Cep G19', polygonMill: 'Çokgen', cylSlot: 'Kanal G7.1', engrave: 'Yazı', pickoff: 'Al', backTurn: 'A.Torna', backDrill: 'A.Delme', backTap: 'A.Kılavuz', backSlot: 'A.Kanal', backPolar: 'A.G12.1', eject: 'Atma' }[t] || t;
}
function kindLabel(k) { return { rapid: 'G0', feed: 'G1', arc: 'G2/G3', thread: 'DİŞ', dwell: 'G4', wait: 'BEKLE', event: 'M' }[k] || ''; }
function fmtTime(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`; }
function colorize(src) {
  // yorumları ayır, kalan kısmı tek geçişte renklendir
  return src.split(/(\([^)]*\))/).map(part => {
    if (part.startsWith('(')) return `<span class="c-cmt">${esc(part)}</span>`;
    return esc(part).replace(/\b([GMT])(\d+)\b(?!\.)/g, (w, a, n) => {
      const v = parseInt(n, 10);
      if (a === 'T') return `<span class="c-t">${w}</span>`;
      if (a === 'M') return `<span class="${v >= 200 && v < 300 ? 'c-w' : 'c-m'}">${w}</span>`;
      if (v === 0) return `<span class="c-g0">${w}</span>`;
      if (v === 1 || v === 32 || v === 92) return `<span class="c-g1">${w}</span>`;
      if (v === 2 || v === 3) return `<span class="c-g2">${w}</span>`;
      return w;
    });
  }).join('');
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
