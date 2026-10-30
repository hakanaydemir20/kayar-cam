// Kayar CAM ana uygulama
import * as THREE from 'three';
import { Viewer } from '../view3d/scene.js';
import { MachineModel, poseOf } from '../view3d/machineMesh.js';
import { buildPathLines } from '../view3d/pathLines.js';
import { newProject, runPipeline, simulateText, autoOperations, saveProject, loadProject, clone } from '../project.js';
import { StockSim, buildTarget, compare } from '../sim/stockSim.js';
import { COLLISION_DEFAULTS } from '../sim/collision.js';
import { derivePart } from '../sim/derivePart.js';
import { OP_TYPES, defaultParams, pickGrip } from '../ops/generators.js';
import { makeOp } from '../ops/program.js';
import { buildContext } from '../ops/context.js';
import { makeTool, TOOL_TYPES, UNITS, INSERT_SHAPES, INSERT_CODES, insertShapeOf, insertAdvice, theoreticalRa, CHIP_GEOS, TOOL_CATALOG, UNIT_NUMS, MATERIALS, suggestRough, parseInsertCode, insertOutline } from '../tools/toolLibrary.js';
import { toolThumb } from '../view3d/toolThumbs.js';
import { makePart, profileFromTable, STD_BARS, suggestBar, examplePart } from '../part/part.js';
import { h, esc, OP_PARAMS, TOOL_FIELDS, FEATURE_FIELDS, FEATURE_LABELS, featureText, field } from './forms.js';
import { importStepFile, ghostFromMesh, ghostFromProfile, loadToolModel } from './stepFlow.js';
import { customToolModels } from '../view3d/toolMeshes.js';
import { setupSheetHtml, barFlow, profileSvg } from './report.js';
import { SetupWizard } from './setupWizard.js';
import { validateSketch, partFromSketch } from '../part/sketch.js';
import { GcodeEditor, lineMap } from './gcodeEditor.js';
import { Plot2D } from '../view3d/plot2d.js';
import { loadSettings, saveSettings, settingsPanel, control, QUICK_VIEW } from './settings.js';
import { Tour } from './tour.js';
import { Sketcher } from './sketcher.js';

const $ = (id) => document.getElementById(id);
const AUTOSAVE = 'kayarcam.project.v1';
if (typeof window !== 'undefined') window.THREE = THREE; // hata ayıklama

export class App {
  constructor() {
    const restored = this.restore();
    this.firstRun = !restored;
    this.project = restored || newProject();
    this.sel = { kind: 'none' };   // açılışta mini pencere kapalı
    this.cfg = loadSettings();
    this.mode = this.cfg.expert ? 'expert' : 'simple';
    this.view2 = this.cfg.view2;
    this.tour = new Tour();
    this.toolsOpen = false;
    this.t = 0; this.playing = false; this.speed = 1;
    this.viewer = new Viewer($('viewport'));
    this.viewer.view('zone', { instant: true });
    this.viewer.onFrame = (dt) => this.frame(dt);
    this.plot = new Plot2D($('viewport'));
    this.editor = new GcodeEditor($('gedbox'), {
      colorize,
      onEdit: (text) => { if (this.cfg.live) this.runManual(text, { live: true }); },
      onEob: (ln, text) => this.runManual(text, this.cfg.eob ? { eob: ln } : {}),
      onLine: (ln) => this.gotoEditorLine(ln),
    });
    this.manual = null;       // elle düzenlenmiş G-kod metni (null = CAM çıktısı)
    this.lastUi = 0;
    this.bindChrome();
    this.setMode(this.mode);
    this.setView2(this.view2 || '3d');
    this.applyUi();
    this.recalc();
    if (this.firstRun || this.cfg.startScreen) this.openStart();
  }

  // ------------------------------------------------------------ mod ve iş akışı rayı
  setMode(m) {
    this.mode = m === 'expert' ? 'expert' : 'simple';
    document.body.classList.toggle('simple', this.mode === 'simple');
    document.body.classList.toggle('expert', this.mode === 'expert');
    this.cfg.expert = this.mode === 'expert'; saveSettings(this.cfg);
    this.viewer?.resize();
    if (this.result) this.renderTree();
  }
  /** Durum çubuğu: parça, sıfır, işlem/hata özeti; üst çubukta malzeme */
  renderRail() {
    const P = this.project, r = this.result, v = this.verify;
    const M = MATERIALS[P.stock.material] || MATERIALS.free;
    $('matTxt').textContent = M.short;
    const ml = $('matList'); ml.innerHTML = '';
    for (const [k, m] of Object.entries(MATERIALS)) ml.append(h('button', { class: (P.stock.material || 'free') === k ? 'on' : '', onclick: () => { P.stock.material = k; this.recalc(true); this.toast(`Malzeme: ${m.label} — takım kesme değerleri için Takımlar → “öner”`, 3500); } }, h('i', {}, (P.stock.material || 'free') === k ? '✓' : ''), h('span', {}, m.label, h('small', {}, `kaba Vc ${m.vcRough} · f ${m.fRough} · paso ≤ ${m.apMax} mm`))));
    const zs = P.zero?.zShift || 0;
    const simBad = v ? v.ss.collisions.length + (v.c.over ? 1 : 0) : 0;
    $('sbPart').textContent = `⬢ ${P.part.name} · L${P.part.length.toFixed(2)} · Ø${P.stock.barDia} çubuk · Z0 ${!zs ? 'ön alın' : Math.abs(zs - P.part.length) < 1e-6 ? 'arka alın' : 'ön alından ' + zs}`;
    $('sbInfo').textContent = `${this.manual ? 'Manuel G-kod' : P.ops.filter(o => o.enabled).length + ' işlem'} · çevrim ${fmtTime(this.totalTime || 0)}${(r?.errors.length || 0) + simBad ? ' · ' + ((r?.errors.length || 0) + simBad) + ' sorun' : ''}`;
  }
  goStep(k) {
    const tab = (b) => this.rtab(b);
    if (k === 'part') { this.sel = { kind: 'part' }; this.renderTree(); }
    else if (k === 'setup') this.openSetup();
    else if (k === 'ops') {
      const bad = (this.result?.errors || []).find(e => e.op);
      this.sel = { kind: 'op', id: bad?.op || this.project.ops[0]?.id }; this.renderTree();
      if (bad) tab('msgs');
      $('tree').querySelector('.titem.sel')?.scrollIntoView({ block: 'center' });
    } else if (k === 'sim') {
      tab(this.verify && (this.verify.ss.collisions.length || this.verify.c.over) ? 'msgs' : 'verify');
      this.viewer.view('zone', { L: this.project.part.length });
      if (!this.playing) { this.seek(0); this.player('play'); }
    } else if (k === 'nc') this.openOutput();
  }

  /** Başlangıç: yeni parça nasıl eklenecek */
  openStart() {
    const card = (icon, title, text, fn, pri) => h('button', { class: 'scard' + (pri ? ' pri' : ''), onclick: fn }, h('span', { class: 'si', html: icon }), h('b', {}, title), h('span', {}, text));
    const ico = {
      step: '<svg viewBox="0 0 32 32"><path d="M16 3 28 9.5v13L16 29 4 22.5v-13z M4 9.5 16 16l12-6.5M16 16v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      table: '<svg viewBox="0 0 32 32"><path d="M3 20h5v-8h8v-4h6v4h7v8H3zM3 24h26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      demo: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 11l8 5-8 5z" fill="currentColor"/></svg>',
      sketch: '<svg viewBox="0 0 32 32"><path d="M4 24h6v-6h8v-6h10M4 28h24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M22 4l4 4-9 9h-4v-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
      type: '<svg viewBox="0 0 32 32"><rect x="3" y="8" width="26" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 13h2M13 13h2M18 13h2M23 13h1M8 18h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      gcode: '<svg viewBox="0 0 32 32"><path d="M6 4h14l6 6v18H6zM20 4v6h6M10 15h12M10 19h9M10 23h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      open: '<svg viewBox="0 0 32 32"><path d="M4 8h9l3 3h12v15H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    };
    const body = h('div', { class: 'start' },
      h('p', { class: 'start-lead' }, 'Bir parça açın: program sizi ön yüz, referans noktası ve çubuk seçiminden geçirir, işlem planını hazırlar ve NC kodu simülasyonla doğrular. Hazır bir G-kod programını da doğrudan simüle edebilirsiniz.'),
      h('div', { class: 'scards' },
        card(ico.step, '3D parça aç', 'STEP (.stp / .step) veya OBJ dosyası', () => { this.closeModal(); $('fileStep').click(); }, true),
        card(ico.sketch, 'Çizim yap', 'Parça profilini 2D çizin', () => { this.closeModal(); new Sketcher(this).open(); }),
        card(ico.gcode, 'G kodu ile simülasyon', 'Hazır NC dosyasını aç', () => { this.closeModal(); $('fileNc').click(); }),
        card(ico.type, 'Sıfırdan G-kod yaz', 'Boş program; satır satır yaz ve oynat', () => { this.closeModal(); this.action('gblank'); }),
        card(ico.demo, 'Örnek parçayla dene', 'Hazır pim: dış çap, diş, delik, düzlük', () => { this.closeModal(); new SetupWizard(this, { kind: 'table', part: examplePart() }).open(); }),
        card(ico.open, 'Kayıtlı projeyi aç', '.kcam proje dosyası', () => { this.closeModal(); $('fileProj').click(); })));
    this.openModal('Yeni parça', body);
  }
  newTablePart() {
    const rows = [{ dia: 8, len: 10, ch: 0.5 }, { dia: 12, len: 15, ch: 0.5 }];
    new SetupWizard(this, { kind: 'table', part: makePart({ name: 'Yeni Parça', profile: profileFromTable(rows), rows, features: [] }) }).open();
  }
  async openSetup(start = 'front') {
    const p = this.project.part;
    if (p.source === 'step') {
      if (!p.mesh) { this.toast('3D model yükleniyor…'); await this.reviveStep(); }
      if (!p.mesh) { this.toast('3D model yüklenemedi — STEP dosyasını yeniden açın', 4500); return; }
      const res = { model: p.mesh, b64: p.stepB64, name: p.name, part: p, flip: !!p.flip, axisFaceId: p.axisFaceId ?? null, fmt: p.meshFmt || 'step' };
      new SetupWizard(this, { kind: 'step', res, edit: true, start }).open();
    } else {
      new SetupWizard(this, { kind: p.source === 'sketch' ? 'sketch' : 'table', part: p, edit: true, start }).open();
    }
  }
  /** NC çıktısı: özet + indir */
  openOutput() {
    const r = this.result, v = this.verify;
    if (!r?.sim) { this.toast('Önce programı hesaplayın'); return; }
    const errs = r.errors.length + (v ? v.ss.collisions.length + (v.c.over ? 1 : 0) : 0);
    const P = this.project;
    const body = h('div', { class: 'pbody out' },
      h('div', { class: 'wiz-facts' },
        h('div', {}, h('span', {}, 'Program'), h('b', {}, 'O' + String(P.post.programNumber).padStart(4, '0'))),
        h('div', {}, h('span', {}, 'Satır $1 / $2'), h('b', {}, `${r.sim.paths[0]?.lines.length || 0} / ${r.sim.paths[1]?.lines.length || 0}`)),
        h('div', {}, h('span', {}, 'Çevrim süresi'), h('b', {}, fmtTime(this.totalTime || 0)))),
      !v ? h('div', { class: 'msg w' }, h('span', { class: 'k' }, '…'), 'Simülasyon kontrolü sürüyor; bitince indirme açılır.')
        : errs ? h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), `${errs} sorun var, indirme kilitli. Hatalar sekmesinde her birinin nedeni yazıyor.`)
          : h('div', { class: 'msg o' }, h('span', { class: 'k' }, '✓'), 'Hata yok, çarpışma yok, fazla kesim yok.'),
      P.post.verified ? null : h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), 'Post-processor makinedeki örnek programla henüz doğrulanmadı. İlk çalıştırmayı kuru (parçasız) ya da tek blok modunda yapın.'),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn pri big', disabled: !v || errs ? true : null, onclick: () => this.downloadNC() }, 'NC kodunu indir'),
        h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(this.codeText()); this.toast('G-kod panoya kopyalandı'); } }, 'Kopyala'),
        h('button', { class: 'btn', onclick: () => { this.closeModal(); this.openSetupSheet(); } }, 'Kurulum föyü'),
        errs ? h('button', { class: 'btn', onclick: () => { this.closeModal(); this.rtab('msgs'); } }, 'Hataları göster') : null));
    this.openModal('NC kod', body);
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
  saveViewOpts() { this.cfg.view2 = this.view2; saveSettings(this.cfg); }
  /** Bir ayar değişti */
  setCfg(k) {
    saveSettings(this.cfg);
    if (k === 'expert') this.setMode(this.cfg.expert ? 'expert' : 'simple');
    if (k === 'view2') this.setView2(this.cfg.view2);
    if (k === 'speed') { this.speed = parseFloat(this.cfg.speed); $('speed').value = this.cfg.speed; }
    if (k === 'autoVerify' && this.cfg.autoVerify && !this.verify) this.runVerify();
    this.applyUi(); this.applyOptions();
    this.renderQuickView();
  }
  /** Arayüz ayarları: yazı boyutu, paneller, arka plan */
  applyUi() {
    const c = this.cfg, b = document.body;
    document.documentElement.style.fontSize = (+c.uiScale || 100) + '%';
    document.documentElement.style.setProperty('--ui-z', String((+c.uiScale || 100) / 100));
    document.documentElement.style.setProperty('--code-fs', (+c.codeFont || 12) + 'px');
    document.documentElement.style.setProperty('--code-lh', Math.round((+c.codeFont || 12) * 1.5) + 'px');
    b.classList.toggle('no-legend', !c.legend);
    b.classList.toggle('no-status', !c.statusbar);
    b.dataset.bg = c.bg;
    b.dataset.theme = c.theme;
    this.editor.colorOn = c.colorize; this.editor._lh = 0; this.editor.paint();
    this.viewer.resize();
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
    if (this.manual != null && this.manual !== res.posted?.text) this.toast('İşlem listesi değişti: G-kod CAM çıktısıyla yenilendi', 3500);
    this.manual = null;
    this.result = res;
    this._map = res.posted ? lineMap(res.posted.text) : null;
    this.applySim(keepTime);
    $('postChip').className = 'chip ' + (P.post.verified ? 'ok' : 'warn');
    $('postChip').textContent = P.post.verified ? 'POST DOĞRULANDI' : 'POST DOĞRULANMADI';
    $('codeMode').textContent = 'CAM'; $('codeMode').className = 'chip';
    this.autosave();
  }
  /** Simülasyon sonucu değişti: sahne, ağaç, kod, raporlar */
  applySim(keepTime) {
    const P = this.project, res = this.result;
    this.verify = null;
    if (res.sim) {
      this.stockSim = new StockSim(P, res.sim);
      this.totalTime = this.stockSim.totalTime;
      this.buildScene();
      if (!keepTime) this.t = 0;
      this.t = Math.min(this.t, this.totalTime);
      this.stockSim.seek(this.t);
    }
    this.opTimes = this.computeOpTimes();
    this.renderTree(); this._partWin?.(); this._toolWin?.(); this.renderNC(); this.renderSync(); this.renderMsgs(); this.renderVerify(); this.renderRail();
    const nErr = res.errors.length;
    this.status(nErr ? `${nErr} hata` : 'Hazır', nErr ? 'err' : '');
    clearTimeout(this._vt);
    if (this.cfg.autoVerify) this._vt = setTimeout(() => this.runVerify(), this.manual != null ? 700 : 350);
    else this.status(nErr ? `${nErr} hata` : 'Hazır · kontrol kapalı (⟳ ile çalıştırın)', nErr ? 'err' : '');
  }
  /** Elle yazılan / yapıştırılan G-kodu yorumla. opts.eob: Enter/Insert ile biten editör satırı → o satırı oynat */
  runManual(text, opts = {}) {
    const P = this.project;
    let sim;
    try { sim = simulateText(P, text); } catch (e) { console.error(e); this.status('G-kod okunamadı: ' + e.message, 'err'); return; }
    if (!sim.paths.length) { this.status('G-kod boş', 'err'); return; }
    this.manual = text;
    const t0 = this.t;
    this.result = { built: null, posted: null, sim, errors: sim.errors.map(e => ({ ...e, src: 'nc' })), warnings: sim.warnings.map(w => ({ ...w, src: 'nc' })) };
    this._map = lineMap(text);
    this.playing = false; this.playUntil = null; $('playBtn').textContent = '▶';
    this.applySim(true);
    $('codeMode').textContent = 'MANUEL'; $('codeMode').className = 'chip warn';
    if (opts.eob != null) this.playEditorLine(opts.eob);
    else if (opts.start) this.seek(0);
    else this.seek(Math.min(t0, this.totalTime));
    try { localStorage.setItem('kayarcam.manual.v1', text); } catch { /* */ }
  }
  /** Editör satırına karşılık gelen hareketler: {ch, li, moves} */
  movesOfEditorLine(ln) {
    const m = (this._map || lineMap(this.codeText())).fwd[ln];
    if (!m || !this.result?.sim) return null;
    const moves = (this.result.sim.paths[m.pi]?.moves || []).filter(x => x.line === m.li);
    return { ch: m.pi + 1, li: m.li, moves };
  }
  /** EOB: satırın hareketini oynat (satır öncesi duruma gidip satır sonunda durur) */
  playEditorLine(ln) {
    const r = this.movesOfEditorLine(ln);
    if (!r || !r.moves.length) return;
    const a = r.moves[0].t0, b = r.moves[r.moves.length - 1].t1;
    this.seek(a);
    if (b - a > 1e-4) { this.playUntil = b; this.playing = true; $('playBtn').textContent = '❚❚'; }
  }
  gotoEditorLine(ln) {
    const r = this.movesOfEditorLine(ln);
    if (!r || !r.moves.length) return;
    this.playing = false; this.playUntil = null; $('playBtn').textContent = '▶';
    const a = r.moves[0].t0, b = r.moves[r.moves.length - 1].t1;
    this.seek(Math.max(a, b - 1e-6));   // satır sonu (bir sonraki satıra geçmeden)
  }
  codeText() { return this.manual ?? this.result?.posted?.text ?? ''; }
  blankProgram() {
    const P = this.project, a = P.post.spindleAddress?.main || 'S', c = P.post.codes;
    const t = P.tools.filter(x => x.unit === 'gang' && x.type === 'turn').sort((p, q) => p.num - q.num)[0] || P.tools[0];
    const tc = t ? 'T' + String(t.num).padStart(2, '0') + String(t.num).padStart(2, '0') : 'T0101';
    const R = P.stock.barDia;
    return ['%', '$1', 'O1000 (MANUEL PROGRAM)', 'G18 G21 G40 G80 G97 G99', tc, `G50 ${a}8000`, `G96 ${a}150 ${c.mainCW || 'M3'}`, `G0 X${(R + 2).toFixed(1)} Z-0.5`, 'G1 X0. F0.05', `G0 X${(R + 2).toFixed(1)}`, '', '%', ''].join('\n');
  }

  runVerify() {
    if (!this.result?.sim) return;
    const t0 = performance.now();
    this.status('Doğrulanıyor (Verify)…', 'busy');
    setTimeout(() => {
      try {
        const ss = new StockSim(this.project, this.result.sim).runAll();
        const T = buildTarget(this.project, ss.opts);
        // G-koddan çıkarılan parçada hedef = kodun sonucu: karşılaştırma anlamsız (dönel olmayan kesimler sahte fazla kesim olur)
        const c = this.project.part.source === 'gcode' ? { over: 0, under: 0, overMax: 0, underMax: 0, cells: 0, innerOver: 0, innerUnder: 0, status: null, skipped: true } : compare(ss.resultStock(), T, this.project.part.length);
        this.verify = { ss, c, ms: performance.now() - t0 };
        this.renderMsgs(); this.renderVerify(); this.applyVerifyColors(); this.renderRail();
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
    this.plot.setData(this.project, this.result.sim, this.stockSim);
    try { this.target = buildTarget(this.project, this.stockSim.opts); } catch (e) { console.warn('hedef', e); this.target = null; }
    this.applyFinishColor();
    // hedef model (hayalet)
    const ghost = this.project.part.mesh && this.project.part.fixture ? ghostFromMesh(this.project.part) : ghostFromProfile(this.project.part);
    this.ghost = ghost;
    this.machine.partMesh.mesh.add(ghost);
    this.applyOptions();
    this.machine.update(this.stockSim, this.t, 0);
  }
  applyOptions() {
    const c = this.cfg;
    document.body.classList.toggle('no-dro', !c.dro);
    document.body.classList.toggle('no-code', !c.code);
    this.pathMode = c.path;
    this.ghostOn = c.ghost;
    this.plot.dirty = true;
    this.viewer.resize();
    if (!this.machine) return;
    if (this.ghost) this.ghost.visible = c.ghost;
    this.machine.toolMode = c.tools;
    this.machine.coolantOn = c.coolant;
    const body = c.body, cab = c.cabin;
    this.machine.setCabin(cab ? 'full' : 'none');
    this.machine.setBody(body);
    this.machine.setHolders(c.holders);
    this.machine.setEdges(c.edges);
    for (const sm of [this.machine.partMesh, this.machine.barMesh, this.machine.prevMesh]) if (sm && sm.edges.visible !== c.edges) sm.setEdges(c.edges);
    if (this._fc !== c.finishColor) { this._fc = c.finishColor; this.applyFinishColor(); }
    this.viewer.setFloor(body || cab);
    this.machine.setAxesVisible(c.axes);
    this.applyPathVis(true);
    this.applyVerifyColors();
  }
  /** Canlı parça/stok renkleri (bitmiş ölçü = parça rengi) */
  applyFinishColor() {
    const m = this.machine; if (!m) return;
    const T = this.cfg.finishColor && this.project.part.source !== 'gcode' ? this.target : null;
    for (const sm of [m.partMesh, m.prevMesh]) if (sm) sm.setTarget(T);
  }
  /** 3D ↔ 2D grafik penceresi */
  setView2(v) {
    this.view2 = v === '2d' ? '2d' : '3d';
    document.querySelectorAll('[data-view2]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view2 === this.view2)));
    document.body.classList.toggle('v2d', this.view2 === '2d');
    this.plot.setVisible(this.view2 === '2d');
    this.viewer.renderer.domElement.style.visibility = this.view2 === '2d' ? 'hidden' : 'visible';
  }
  /** Takım yolu görünürlüğü: Tümü | Aktif işlem | Seçili işlem | Gizli; ayrıca işlem başına göz düğmesi */
  applyPathVis(force = false) {
    if (!this.pathByOp) return;
    const mode = this.cfg.path;
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
    const on = this.cfg.verify && this.verify;
    const pm = this.machine.prevMesh;
    if (on) {
      if (pm) {
        // örtüşen çevrim: bitmiş parça = karşı iş milindeki önceki parça; atılmadan hemen önceki ana git
        const ev = this.result.sim.paths[1].moves.find(m => m.kind === 'event' && m.event === 'subChuckOpen');
        this.seek(ev ? ev.t0 - 1e-3 : this.totalTime);
        pm.setStatusColors(this.verify.c.status);
      } else {
        // renkler son durumu gösterir: simülasyonu sona al
        this.seek(this.totalTime);
        this.machine.partMesh.setStatusColors(this.verify.c.status);
      }
    } else { this.machine.partMesh.setStatusColors(null); if (pm) pm.setStatusColors(null); }
  }

  frame(dt) {
    if (!this.stockSim) return;
    if (this.playing) {
      const end = this.playUntil != null ? Math.min(this.playUntil, this.totalTime) : this.totalTime;
      this.t = Math.min(end, this.t + dt * this.speed);
      if (this.t >= end) { this.playing = false; this.playUntil = null; $('playBtn').textContent = '▶'; }
      const nc = this.stockSim.collisions.length;
      this.stockSim.seek(this.t);
      if (this.cfg.stopOnCollision && this.stockSim.collisions.length > nc) {
        this.playing = false; this.playUntil = null; $('playBtn').textContent = '▶';
        const c = this.stockSim.collisions.at(-1);
        this.toast('Çarpışma: ' + (c.msg || '') + ' — oynatma durdu', 5000);
      }
    }
    this.machine.update(this.stockSim, this.t, this.playing ? dt * Math.min(this.speed, 3) : 0);
    if (this.plot.visible && (this.playing || this.plot.dirty || this._t2 !== this.t)) { this._t2 = this.t; this.plot.draw(this); }
    const now = performance.now();
    if (now - this.lastUi > 90) { this.lastUi = now; this.updateLive(); }
  }
  seek(t) {
    this.t = Math.max(0, Math.min(this.totalTime || 0, t));
    this.stockSim.seek(this.t);
    this.machine.update(this.stockSim, this.t, 0);
    this.plot.dirty = true;
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
    if (this.cfg.axes) m.updateLabels();
    if (this.cfg.path === 'op') this.applyPathVis();
    // G-kod editöründe aktif satırlar
    const map = this._map;
    if (map) {
      const l1 = m.m1 ? map.rev[0]?.[m.m1.line] : null, l2 = m.m2 ? map.rev[1]?.[m.m2.line] : null;
      const key = l1 + ':' + l2;
      if (force || key !== this._edKey) { this._edKey = key; this.editor.setCurrent(l1 ?? null, l2 ?? null, this.cfg.follow || force); }
    }
    const cur = $('syncCursor');
    if (cur && T) cur.style.left = `calc(${(this.t / T) * 100}% - 1px)`;
    // aktif işlem ağaçta
    const op1 = this.result.posted?.lineInfo[0]?.[m.m1?.line]?.opId;
    const op2 = this.result.posted?.lineInfo[1]?.[m.m2?.line]?.opId;
    document.querySelectorAll('.card.op.active').forEach(e => { if (e.dataset.id !== op1 && e.dataset.id !== op2) e.classList.remove('active'); });
    for (const id of [op1, op2]) if (id) document.querySelector(`.card.op[data-id="${id}"]`)?.classList.add('active');
  }

  // ------------------------------------------------------------ arayüz bağlama
  bindChrome() {
    // açılır menü davranışı
    const menus = [...document.querySelectorAll('.menu')];
    const closeAll = () => menus.forEach(m => m.classList.remove('open'));
    for (const m of menus) {
      const b = m.querySelector(':scope > button');
      b.addEventListener('click', (e) => { e.stopPropagation(); const was = m.classList.contains('open'); closeAll(); if (!was) m.classList.add('open'); });
      b.addEventListener('mouseenter', () => { if (menus.some(x => x.classList.contains('open')) && !m.classList.contains('open')) { closeAll(); m.classList.add('open'); } });
      m.querySelector('.dd').addEventListener('click', (e) => { if (e.target.closest('button')) closeAll(); });
    }
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu')) closeAll(); });
    document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this.action(b.dataset.act, b)));
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      if (this.view2 === '2d') { this.plot.fit(); return; }
      this.viewer.view(b.dataset.view, this.viewFocus());
      document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
    }));
    document.querySelectorAll('[data-view2]').forEach(b => b.addEventListener('click', () => { this.setView2(b.dataset.view2); this.saveViewOpts(); }));
    this.renderQuickView();
    $('btnPaths').addEventListener('click', () => this.togglePaths());
    this.speed = parseFloat(this.cfg.speed) || 1; $('speed').value = String(this.cfg.speed);
    document.querySelectorAll('[data-pl]').forEach(b => b.addEventListener('click', () => this.player(b.dataset.pl)));
    $('speed').addEventListener('change', e => { this.speed = parseFloat(e.target.value); });
    const sc = $('scrub');
    sc.addEventListener('input', () => { this._scrubbing = true; this.seek((sc.value / 1000) * this.totalTime); });
    sc.addEventListener('change', () => { this._scrubbing = false; });
    document.querySelectorAll('.rt').forEach(b => b.addEventListener('click', () => this.rtab(b.dataset.rt)));
    // G-kod araçları
    $('gCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.editor.value); this.toast('G-kod panoya kopyalandı'); }
      catch { this.editor.ta.select(); document.execCommand('copy'); this.toast('G-kod kopyalandı'); }
    });
    $('gPaste').addEventListener('click', async () => {
      let t = '';
      try { t = await navigator.clipboard.readText(); } catch { this.toast('Pano okunamadı: editöre tıklayıp Ctrl+V ile yapıştırın', 4000); return; }
      if (!t.trim()) { this.toast('Panoda metin yok'); return; }
      this.editor.setText(t.replace(/\r/g, '')); this.runManual(this.editor.value, { start: true });
      if (!this.deriveFromCode(true)) this.toast('G-kod yapıştırıldı');
    });
    $('gDerive').addEventListener('click', () => this.deriveFromCode());
    // editöre Ctrl+V ile bütün program yapıştırılınca da parça çıkarılır
    this.editor.ta.addEventListener('paste', (e) => {
      const t = e.clipboardData?.getData('text') || '';
      if (t.split('\n').length < 4) return;
      setTimeout(() => { this.runManual(this.editor.value, { start: true }); this.deriveFromCode(true); }, 30);
    });
    $('gReset').addEventListener('click', () => {
      if (this.manual == null) { this.toast('Kod zaten CAM çıktısı'); return; }
      if (!confirm('Elle yapılan değişiklikler silinip CAM koduna dönülsün mü?')) return;
      this.manual = null; this.recalc(true);
    });
    $('mclose').addEventListener('click', () => this.closeModal());
    $('sbPart').addEventListener('click', () => this.openPart());
    $('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) this.closeModal(); });
    $('fileStep').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.loadStep(f); });
    $('fileProj').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { this.project = loadProject(await f.text()); this.sel = { kind: 'part' }; await this.reviveStep(); this.recalc(); this.toast('Proje açıldı: ' + f.name); }
      catch (err) { this.toast('Proje açılamadı: ' + err.message, 5000); }
    });
    $('fileNc').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const t = (await f.text()).replace(/\r/g, '');
      this.rtab('code');
      this.editor.setText(t);
      this.runManual(t, { start: true });
      this.deriveFromCode(true);
      this.toast(`${f.name} açıldı · ${this.result.errors.length ? this.result.errors.length + ' uyarı/hata, Mesajlar sekmesine bakın' : 'hatasız okundu'}`, 4000);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && $('modal').classList.contains('on')) { this.closeModal(); return; }
      if (e.code === 'Escape') { closeAll(); if (this.sel.kind === 'op' && !this.tour.tip) { this.sel = { kind: 'none' }; this.renderTree(); } }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !$('modal').classList.contains('on')) {
        const k = { KeyS: 'save', KeyO: 'open', KeyN: 'new' }[e.code];
        if (k) { e.preventDefault(); this.action(k); return; }
      }
      const tg = e.target.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA' || $('modal').classList.contains('on')) return;
      if (e.code === 'Space') { e.preventDefault(); this.player('play'); }
      if (e.code === 'ArrowRight') this.player('fwd');
      if (e.code === 'ArrowLeft') this.player('back');
      if (e.code === 'Digit2') { this.setView2('2d'); this.saveViewOpts(); }
      if (e.code === 'Digit3') { this.setView2('3d'); this.saveViewOpts(); }
      if (e.code === 'KeyT') this.togglePaths();
      if (e.code === 'KeyE') { this.cfg.axes = !this.cfg.axes; this.setCfg('axes'); }
      if (e.key === '?' || e.code === 'F1') { e.preventDefault(); this.tour.start(); }
    });
    if (this._pendingStep) this.reviveStep().then(() => this.recalc(true));
    else this.reviveToolModels().then(n => { if (n) this.recalc(true); });
  }
  /** Parça penceresi: profil/çizim, özellikler, Z0, çubuk (sol menüde parça kartı yok) */
  openPart(kind = 'part') {
    const box = h('div', { class: 'partwin' });
    const render = () => {
      const P = this.project, zs = P.zero?.zShift || 0;
      if (!['part', 'feature', 'zero', 'stock'].includes(this.sel.kind)) this.sel = { kind };
      const k = this.sel.kind === 'feature' ? 'part' : this.sel.kind;
      box.innerHTML = '';
      const tab = (key, label) => h('button', { class: k === key ? 'on' : '', onclick: () => { this.sel = { kind: key }; render(); } }, label);
      box.append(h('div', { class: 'pw-head' },
        h('div', { class: 'pw-t' }, h('b', {}, P.part.name), h('small', {}, `${P.part.source === 'step' ? (P.part.meshFmt === 'obj' ? 'OBJ' : 'STEP') + ' modeli' : P.part.source === 'sketch' ? 'Çizim' : P.part.source === 'gcode' ? 'G-koddan' : 'Profil'} · boy ${fmtN(P.part.length)} mm · en büyük Ø${fmtN(P.part.maxDia)}`)),
        h('button', { class: 'btn', onclick: () => { this.closeModal(); this.openSetup('front'); } }, 'Bağlama, ön yüz ve sıfır…')),
        h('div', { class: 'pw-tabs' }, tab('part', `Parça · ${P.part.features.length} özellik`), tab('zero', 'Z0 ' + (!zs ? 'ön alın' : Math.abs(zs - P.part.length) < 1e-6 ? 'arka alın' : 'ön alından ' + zs)), tab('stock', 'Çubuk Ø' + P.stock.barDia)));
      const b = h('div', { class: 'pw-body' }); this.renderProps(b); box.append(b);
    };
    this._partWin = render;
    this.sel = { kind };
    render();
    this.openModal('Parça', box, { onClose: () => { this._partWin = null; if (['part', 'feature', 'zero', 'stock'].includes(this.sel.kind)) this.sel = { kind: 'none' }; } });
  }
  /** Takımlar penceresi: kare kartlar (T no + 3D görsel) → karta girince ayarlar; “+ Yeni takım” → katalog */
  openTools(id = null) {
    const box = h('div', { class: 'toolwin' });
    this._tv = id ? { view: 'detail', id } : { view: 'grid', filter: this._tv?.filter || 'all' };
    const render = () => {
      const P = this.project, v = this._tv;
      box.innerHTML = '';
      if (v.view === 'detail' && !P.tools.some(t => t.id === v.id)) v.view = 'grid';
      if (v.view === 'grid') {
        const units = [['all', 'Tümü'], ['gang', 'Tornalama'], ['cross', 'Tahrikli'], ['front', 'Kovan ön'], ['sub', 'Karşı mil']];
        box.append(h('div', { class: 'tw-bar' }, ...units.map(([k, l]) => h('button', { class: 'pill' + (v.filter === k ? ' on' : ''), onclick: () => { v.filter = k; render(); } }, l)),
          h('span', { class: 'gsp' }), h('span', { class: 'tw-count' }, `${P.tools.length} takım`)));
        const grid = h('div', { class: 'tw-grid' });
        const list = [...P.tools].filter(t => v.filter === 'all' || (v.filter === 'sub' ? t.channel === 2 : t.unit === v.filter)).sort((a, b) => a.num - b.num);
        for (const t of list) {
          const used = P.ops.filter(o => o.toolId === t.id).length;
          grid.append(h('button', { class: 'tcard', onclick: () => { this._tv = { view: 'detail', id: t.id, filter: v.filter }; render(); } },
            h('div', { class: 'tc-img' }, h('img', { src: toolThumb(t), alt: '' }), h('span', { class: 'tc-no' }, 'T' + String(t.num).padStart(2, '0')), t.live ? h('span', { class: 'tc-live', title: 'Tahrikli (döner) takım' }, '⟳ tahrikli') : null),
            h('div', { class: 'tc-tx' }, h('b', {}, t.name), h('small', {}, toolSub(t)), h('span', { class: 'tc-foot' }, h('em', {}, UNITS[t.unit].label.replace(/ \(.*\)/, '')), h('em', { class: used ? 'u' : '' }, used ? used + ' işlemde' : 'kullanılmıyor')))));
        }
        grid.append(h('button', { class: 'tcard add', onclick: () => { this._tv = { view: 'catalog', filter: v.filter }; render(); } }, h('span', { class: 'plus' }, '＋'), h('b', {}, 'Yeni takım'), h('small', {}, 'Hazır tiplerden seç')));
        box.append(grid);
      } else if (v.view === 'catalog') {
        box.append(h('div', { class: 'tw-bar' }, h('button', { class: 'btn', onclick: () => { this._tv = { view: 'grid', filter: v.filter }; render(); } }, '← Takımlar'), h('b', { class: 'tw-title' }, 'Yeni takım: tip seçin')));
        const wrap = h('div', { class: 'tw-cat' });
        for (const g of TOOL_CATALOG) {
          wrap.append(h('div', { class: 'tw-g' }, g.group));
          const grid = h('div', { class: 'tw-grid' });
          for (const it of g.items) {
            const tmp = makeTool({ ...it.p, num: 0 });
            grid.append(h('button', { class: 'tcard', onclick: () => { const t = this.addToolFrom(it.p); this._tv = { view: 'detail', id: t.id }; render(); } },
              h('div', { class: 'tc-img' }, h('img', { src: toolThumb(tmp), alt: '' }), tmp.live ? h('span', { class: 'tc-live' }, '⟳ tahrikli') : null),
              h('div', { class: 'tc-tx' }, h('b', {}, it.label), h('small', {}, toolSub(tmp)))));
          }
          wrap.append(grid);
        }
        box.append(wrap);
      } else {
        const t = P.tools.find(x => x.id === v.id);
        this.sel = { kind: 'tool', id: t.id };
        box.append(h('div', { class: 'tw-bar' }, h('button', { class: 'btn', onclick: () => { this._tv = { view: 'grid', filter: v.filter || 'all' }; this.sel = { kind: 'none' }; render(); } }, '← Takımlar'),
          h('b', { class: 'tw-title' }, 'T' + String(t.num).padStart(2, '0') + ' · ' + t.name)));
        const d = h('div', { class: 'tw-detail' });
        this.renderToolDetail(d, t);
        box.append(d);
      }
    };
    this._toolWin = render;
    render();
    this.openModal('Takımlar', box, { wide: true, cls: 'tools', onClose: () => { this._toolWin = null; if (this.sel.kind === 'tool') this.sel = { kind: 'none' }; } });
  }
  /** Takımın elmasıyla erişilemeyen bölgeler: dönel zarf (uç açısı + 93° yaklaşma) − gerçek profil */
  roughZones(tool) {
    const ctx = buildContext(this.project), env = ctx.envelopeFor(tool), real = ctx.real, L = ctx.L;
    const zones = []; let cur = null;
    for (let i = 0; i < real.n; i++) {
      const z = real.zAt(i);
      if (z < 0 || z > L) { if (cur) { zones.push(cur); cur = null; } continue; }
      const d = env.r[i] - real.r[i];
      if (d > 0.01) { if (!cur) cur = { z0: z, z1: z, depth: 0 }; cur.z1 = z; cur.depth = Math.max(cur.depth, d); }
      else if (cur) { zones.push(cur); cur = null; }
    }
    if (cur) zones.push(cur);
    return zones.filter(z => z.z1 - z.z0 > 0.03 && z.depth > 0.02).map(z => ({ z0: +z.z0.toFixed(3), z1: +z.z1.toFixed(3), depth: +z.depth.toFixed(3) }));
  }
  /** Kaba tornalama sihirbazı: malzeme, takım(lar), paso, ilerleme, devir; erişilemeyen bölgeler ve takım önerisi */
  openRough() {
    const P = this.project;
    const turns = P.tools.filter(t => t.type === 'turn' && t.channel === 1).sort((a, b) => a.num - b.num);
    if (!turns.length) { this.toast('Ana iş milinde tornalama takımı yok — Takımlar penceresinden ekleyin', 4500); return; }
    const old = P.ops.find(o => o.type === 'rough');
    const st = this._rough = {
      mat: P.stock.material || 'free',
      t1: (old && turns.find(t => t.id === old.toolId)) ? old.toolId : turns[0].id,
      t2: '', strategy: old?.params.strategy || 'z', touched: {},
    };
    const apply = () => {
      const t = turns.find(x => x.id === st.t1), sg = suggestRough(st.mat, t, P.stock.barDia, P.stock.maxRpm || 8000);
      for (const k of ['ap', 'feed', 'vc', 'allowX', 'allowZ']) if (!st.touched[k]) st[k] = sg[k];
      if (st.retract == null) st.retract = old?.params.retract ?? 0.5;
      if (st.maxRpm == null) st.maxRpm = P.stock.maxRpm || 8000;
      if (st.contourPass == null) st.contourPass = !!old?.params.contourPass;
    };
    apply();
    const box = h('div', { class: 'rw' });
    const render = () => {
      box.innerHTML = '';
      const t1 = turns.find(x => x.id === st.t1);
      const zones = this.roughZones(t1);
      const M = MATERIALS[st.mat];
      // --- sol: ayarlar
      const L = h('div', { class: 'rw-form' });
      const sel = (label, val, items, on) => { const s = h('select', {}, items.map(([v, l]) => h('option', { value: v }, l))); s.value = val; s.addEventListener('change', () => on(s.value)); return h('div', { class: 'f full' }, h('label', {}, label), s); };
      const num = (k, label, unit, step = '0.01') => {
        const i = h('input', { type: 'number', step, min: '0', value: st[k] });
        i.addEventListener('change', () => { st[k] = Math.max(0, parseFloat(i.value) || 0); st.touched[k] = true; render(); });
        return h('div', { class: 'f' + (st.touched[k] ? ' edited' : '') }, h('label', {}, label, h('span', { class: 'u' }, unit)), i);
      };
      L.append(h('h4', {}, 'Malzeme ve takım'),
        sel('Malzeme cinsi', st.mat, Object.entries(MATERIALS).map(([k, m]) => [k, m.label]), (v) => { st.mat = v; st.touched = {}; apply(); render(); }),
        sel('Kaba takımı (ana)', st.t1, turns.map(t => [t.id, `T${String(t.num).padStart(2, '0')} ${t.name}${t.insertCode ? ' · ' + t.insertCode : ''}`]), (v) => { st.t1 = v; st.touched = {}; apply(); render(); }),
        h('div', { class: 'insprev' + (zones.length ? ' warn' : ''), html: insertSvg(t1) }),
        sel('Strateji', st.strategy, [['z', 'Z’ye paralel (boyuna pasolar)'], ['profile', 'Profile paralel (kontur ofset)'], ['face', 'Alın (X’e paralel)']], (v) => { st.strategy = v; }),
        h('h4', {}, 'Kesme değerleri ', h('button', { class: 'btn ghost mini', title: 'Malzeme ve takıma göre yeniden öner', onclick: () => { st.touched = {}; apply(); render(); } }, '✦ Öner')));
      const g = h('div', { class: 'fg' });
      g.append(num('ap', 'En fazla talaş derinliği (radyal)', 'mm'), num('feed', 'İlerleme', 'mm/dev', '0.005'), num('vc', 'Kesme hızı Vc (G96)', 'm/dak', '5'), num('maxRpm', 'Devir sınırı G50', 'dev/dak', '100'),
        num('allowX', 'Finiş payı X (çapta)', 'mm'), num('allowZ', 'Finiş payı Z', 'mm'), num('retract', 'Geri çekme', 'mm', '0.1'));
      const cp = h('input', { type: 'checkbox' }); cp.checked = st.contourPass; cp.addEventListener('change', () => { st.contourPass = cp.checked; });
      g.append(h('div', { class: 'f full' }, h('label', { class: 'chk' }, cp, ' Son kaba pasodan sonra yarı finiş kontur pasosu')));
      L.append(g);
      const D = P.stock.barDia, n0 = Math.min(st.maxRpm, st.vc * 1000 / (Math.PI * D));
      const dMin = Math.max(1, P.part.profile.reduce((m, p) => p.r > 0.2 ? Math.min(m, p.r * 2) : m, D));
      const n1 = Math.min(st.maxRpm, st.vc * 1000 / (Math.PI * dMin));
      L.append(h('div', { class: 'kv' },
        h('span', {}, `Devir (Ø${D} çubuk)`), h('span', {}, Math.round(n0) + ' dev/dak'),
        h('span', {}, `Devir (Ø${+dMin.toFixed(2)} en küçük)`), h('span', {}, Math.round(n1) + ' dev/dak' + (n1 >= st.maxRpm - 1 ? ' (G50 sınırı)' : '')),
        h('span', {}, 'İlerleme hızı'), h('span', {}, Math.round(st.feed * n0) + ' mm/dak'),
        h('span', {}, 'Talaş hacmi'), h('span', {}, (st.vc * st.ap * st.feed).toFixed(1) + ' cm³/dak')));
      if (st.feed > (t1.noseR || 0.4) * 0.6) L.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), `İlerleme burun radyüsüne göre yüksek (f ≤ ${(0.5 * (t1.noseR || 0.4)).toFixed(2)} mm/dev önerilir).`));
      if (st.ap > M.apMax) L.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), `${M.short} için en fazla ${M.apMax} mm paso önerilir.`));
      const adv = insertAdvice(t1);
      if (st.ap > adv.apMax + 1e-6) L.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), `Paso, ${t1.insertCode || 'ucun'} kesme kenarına göre büyük (en fazla ≈ ${adv.apMax} mm). Daha büyük uç ya da daha küçük paso seçin.`));
      if (st.ap < (t1.noseR || 0.4) - 1e-6) L.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), `Paso derinliği burun radyüsünden (R${t1.noseR}) küçük: talaş kırılmaz, kenar ezer. rε ≤ ap olmalı.`));
      L.append(h('div', { class: 'hint' }, `Teorik yüzey (kaba paso): Ra ≈ ${theoreticalRa(st.feed, t1.noseR || 0.4, t1.chipGeo === 'W').toFixed(2)} µm · ${CHIP_GEOS[t1.chipGeo || 'M'].label}`));
      // --- sağ: erişim analizi
      const R = h('div', { class: 'rw-side' }, h('h4', {}, 'Erişim analizi'), h('div', { class: 'rw-svg', html: zoneSvg(P.part, zones) }));
      if (!zones.length) R.append(h('div', { class: 'msg o' }, h('span', { class: 'k' }, '✓'), `T${String(t1.num).padStart(2, '0')} bütün profile erişiyor; tek takım yeterli.`));
      else {
        R.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), `T${String(t1.num).padStart(2, '0')} (${INSERT_SHAPES[t1.insertShape]?.label || 'uç'}) ${zones.length} bölgeye erişemiyor; buralarda malzeme kalır.`));
        const zl = h('div', { class: 'rw-zones' });
        zones.forEach((z, i) => zl.append(h('div', {}, h('b', {}, `${i + 1}`), `Z ${z.z0} – ${z.z1}`, h('span', {}, `kalan ≤ ${z.depth} mm`))));
        R.append(zl);
        // taretteki takımlar: her biri bu bölgelere erişiyor mu?
        const reach = turns.filter(t => t.id !== t1.id).map(t => { const z2 = this.roughZones(t); return { t, n: zones.filter(zz => !z2.some(q => q.z1 > zz.z0 + 0.01 && q.z0 < zz.z1 - 0.01)).length }; });
        const tl = h('div', { class: 'rw-tools' }, h('div', { class: 'sub' }, 'Taretteki takımlar'));
        for (const x of reach) {
          const full = x.n === zones.length;
          tl.append(h('div', { class: 'rw-trow' + (st.t2 === x.t.id ? ' on' : '') }, h('img', { src: toolThumb(x.t), alt: '' }),
            h('span', { class: 'tx' }, h('b', {}, `T${String(x.t.num).padStart(2, '0')} ${x.t.name}`), h('small', { class: full ? 'ok' : x.n ? 'mid' : 'bad' }, full ? '✓ bütün bölgelere erişir' : x.n ? `${x.n}/${zones.length} bölgeye erişir` : '✗ erişemez')),
            x.n ? h('button', { class: 'btn' + (st.t2 === x.t.id ? ' pri' : ''), onclick: () => { st.t2 = x.t.id; render(); } }, st.t2 === x.t.id ? 'Seçili' : 'Kullan') : null));
        }
        // kanal takımı: genişliği bölgeye sığıyorsa dalarak işler
        const grooves = P.tools.filter(t => t.type === 'groove' && t.channel === 1);
        const gz = zones.filter(z => grooves.some(g => (g.width || 2) <= z.z1 - z.z0 + 0.4));
        if (grooves.length && gz.length) {
          const g = grooves.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
          tl.append(h('div', { class: 'rw-trow' }, h('img', { src: toolThumb(g), alt: '' }), h('span', { class: 'tx' }, h('b', {}, `T${String(g.num).padStart(2, '0')} ${g.name}`), h('small', { class: 'ok' }, `kanal işlemiyle ${gz.length} bölgeyi dalarak işler`)),
            h('button', { class: 'btn', onclick: () => {
              const ci = P.ops.findIndex(o => o.type === 'cutoff');
              const ops = gz.map(z => { const op = makeOp('groove', g.id); op.params.z0 = +Math.max(0, z.z0 - 0.05).toFixed(3); op.params.z1 = +(z.z1 + 0.05).toFixed(3); op.name = `Kanal (kalan) T${String(g.num).padStart(2, '0')} Z${+z.z0.toFixed(1)}–${+z.z1.toFixed(1)}`; return op; });
              P.ops.splice(ci >= 0 ? ci : P.ops.filter(o => OP_TYPES[o.type].channel === 1).length, 0, ...ops);
              this.recalc(true); this.toast(`${ops.length} kanal işlemi eklendi (kalan bölgeler)`, 3500); render();
            } }, 'Kanal ekle')));
        }
        R.append(tl);
        const ok = reach.filter(x => x.n === zones.length);
        if (ok.length) {
          const best = ok.sort((a, b) => (b.t.insertAngle || 35) - (a.t.insertAngle || 35))[0].t;   // erişenlerin en güçlü kenarlısı
          if (!st.t2) st.t2 = best.id;
          R.append(h('div', { class: 'msg o' }, h('span', { class: 'k' }, '✦'), `Öneri: kalan bölgeler için T${String(best.num).padStart(2, '0')} ${best.name} (${INSERT_SHAPES[best.insertShape]?.label || ''}) kullanın.`));
        } else R.append(h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), 'Bu bölgelere erişen tornalama takımı yok. Daha dar uçlu (V 35°) bir takım ekleyin ya da kanal işlemi kullanın.'),
          h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { const nt = this.addToolFrom(TOOL_CATALOG[0].items[0].p); turns.push(nt); st.t2 = nt.id; render(); } }, '＋ V 35° takım ekle')));
        R.append(sel('Kalan bölgeler için ikinci takım', st.t2, [['', '— kullanma (malzeme kalsın) —'], ...turns.filter(t => t.id !== t1.id).map(t => [t.id, `T${String(t.num).padStart(2, '0')} ${t.name}`])], (v) => { st.t2 = v; render(); }));
        if (st.t2) { const z2 = this.roughZones(turns.find(t => t.id === st.t2)); const still = zones.filter(zz => z2.some(q => q.z1 > zz.z0 + 0.01 && q.z0 < zz.z1 - 0.01)); if (still.length) R.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), `İkinci takım da ${still.length} bölgeye tam erişemiyor.`)); }
      }
      R.append(h('div', { class: 'hint' }, 'Analiz, uç açısı ve 93° yaklaşma açısından kalan geri açıyla parçanın dönel profilini karşılaştırır. Kırmızı: seçilen kaba takımın bırakacağı malzeme.'));
      box.append(L, R,
        h('div', { class: 'rw-nav' }, h('button', { class: 'btn ghost', onclick: () => this.closeModal() }, 'Vazgeç'), h('span', { class: 'sp' }),
          h('button', { class: 'btn pri big', onclick: () => this.applyRough(st, zones) }, old ? 'Kaba işlemleri güncelle' : 'Kaba işlemleri oluştur')));
    };
    render();
    this.openModal('Kaba tornalama', box, { wide: true, cls: 'rough' });
  }
  /** Kaba sihirbazı sonucunu işlem listesine yaz: ana kaba + (varsa) kalan bölgeler için ikinci takım */
  applyRough(st, zones) {
    const P = this.project;
    P.stock.material = st.mat;
    const params = { strategy: st.strategy, ap: st.ap, feed: st.feed, vc: st.vc, allowX: st.allowX, allowZ: st.allowZ, retract: st.retract, contourPass: st.contourPass, maxRpm: st.maxRpm };
    const olds = P.ops.filter(o => o.type === 'rough');
    let at = olds.length ? P.ops.indexOf(olds[0]) : (() => { const f = P.ops.map(o => o.type).lastIndexOf('face'); if (f >= 0) return f + 1; const c = P.ops.findIndex(o => OP_TYPES[o.type].channel === 1 && !['face'].includes(o.type)); return c >= 0 ? c : P.ops.filter(o => OP_TYPES[o.type].channel === 1).length; })();
    for (const o of olds) P.ops.splice(P.ops.indexOf(o), 1);
    const t1 = P.tools.find(t => t.id === st.t1);
    const main = makeOp('rough', st.t1); main.params = { ...main.params, ...params }; main.name = `Kaba Tornalama T${String(t1.num).padStart(2, '0')}`;
    const add = [main];
    if (st.t2 && zones.length) {
      // yakın bölgeleri birleştir (arası < 1 mm)
      const zs = [];
      for (const z of zones) { const l = zs[zs.length - 1]; if (l && z.z0 - l.z1 < 1) l.z1 = z.z1; else zs.push({ ...z }); }
      const t2 = P.tools.find(t => t.id === st.t2);
      const s2 = suggestRough(st.mat, t2, P.stock.barDia, st.maxRpm);
      for (const z of zs) {
        const op = makeOp('rough', st.t2);
        op.params = { ...op.params, ...params, ap: Math.min(st.ap, s2.ap), feed: Math.min(st.feed, s2.feed), zMin: +(z.z0 - 0.5).toFixed(3), zMax: +(z.z1 + 0.5).toFixed(3) };
        op.name = `Kaba (kalan) T${String(t2.num).padStart(2, '0')} Z${+z.z0.toFixed(1)}–${+z.z1.toFixed(1)}`;
        add.push(op);
      }
    }
    P.ops.splice(Math.min(at, P.ops.length), 0, ...add);
    this.closeModal();
    this.sel = { kind: 'op', id: main.id };
    this.recalc(true);
    this.toast(`${add.length} kaba işlemi ${olds.length ? 'güncellendi' : 'eklendi'}${add.length > 1 ? ' (ikinci takım kalan bölgeleri işler)' : ''}`, 4000);
  }
  /** Senkron alma: karşı iş mili ana mille aynı eksende, aynı devirde (M senkron) parçayı tutar; kesmeden sonra çeker */
  openSync() {
    const P = this.project, L = P.part.length;
    const cut = P.ops.find(o => o.type === 'cutoff' && o.enabled);
    let pk = P.ops.find(o => o.type === 'pickoff');
    const bs = Math.max(0, +cut?.params.backStock || 0), zs = P.zero?.zShift || 0;
    const st = { grip: pk?.params.grip ?? 6, feed: pk?.params.feed ?? 500, gap: pk?.params.gap ?? 1, dwell: pk?.params.dwell ?? 0.3 };
    const maxGrip = pickGrip(99, L, bs, P.machine);
    const box = h('div', { class: 'syncwin' });
    const render = () => {
      box.innerHTML = '';
      const grip = Math.min(st.grip, maxGrip);
      const zGrip = L + bs - grip;                    // parça ön alnına göre karşı mil pens alnı (tutma noktası)
      const zRel = zGrip - zs;                         // parça sıfır noktasına göre
      const rpm = this.result?.built?.progs?.[1] ? null : null;
      const num = (k, label, unit, step, onCh) => { const i = h('input', { type: 'number', step, value: k === 'zRel' ? +zRel.toFixed(3) : st[k] }); i.addEventListener('change', () => { const v = parseFloat(i.value); if (!Number.isFinite(v)) return; onCh ? onCh(v) : (st[k] = Math.max(0, v)); render(); }); return h('div', { class: 'f' }, h('label', {}, label, h('span', { class: 'u' }, unit)), i); };
      box.append(
        h('ol', { class: 'sync-steps' },
          h('li', {}, h('b', {}, 'Hizala'), 'Karşı iş mili park konumundan ana mil eksenine gelir (X2 = 0), pens açık.'),
          h('li', {}, h('b', {}, 'Senkronla'), `Karşı mil ana mil ile aynı devre çıkar ve senkron kodu (${P.post.codes.spindleSync || 'M?'}) verilir.`),
          h('li', {}, h('b', {}, 'Yanaş'), `Tutma noktasının ${st.gap} mm önüne hızlı, sonra ${st.feed} mm/dak ile tutma noktasına.`),
          h('li', {}, h('b', {}, 'Tut'), `Pens kapanır (${P.post.codes.subChuckClose || 'M?'}), ${st.dwell} s beklenir; $1 kesmeyi yapar.`),
          h('li', {}, h('b', {}, 'Al'), `Senkron kapanır (${P.post.codes.spindleSyncOff || 'M?'}), karşı mil parçayla geri çekilir.`)),
        h('div', { class: 'fg' },
          num('grip', 'Tutma boyu (pens içine giren parça)', 'mm', '0.1', (v) => { st.grip = Math.max(2, Math.min(maxGrip, v)); }),
          num('zRel', 'Yanaşma konumu (parça sıfırına göre Z)', 'mm', '0.1', (v) => { st.grip = Math.max(2, Math.min(maxGrip, L + bs - zs - v)); }),
          num('gap', 'Hızlı yaklaşma boşluğu', 'mm', '0.1'), num('feed', 'Yaklaşma ilerlemesi', 'mm/dak', '10'), num('dwell', 'Pens kapanma beklemesi', 's', '0.1')),
        h('div', { class: 'kv' },
          h('span', {}, 'Tutma noktası (ön alından)'), h('span', {}, `Z ${zGrip.toFixed(3)} mm`),
          h('span', {}, 'Tutma noktası (Z0’a göre)'), h('span', {}, `Z ${zRel.toFixed(3)} mm`),
          h('span', {}, 'En fazla tutma'), h('span', {}, `${maxGrip.toFixed(2)} mm (parça boyu ve pens somunu)`),
          h('span', {}, 'Senkron devir'), h('span', {}, 'kesme işlemi devriyle aynı (otomatik)')),
        !cut ? h('div', { class: 'msg w' }, h('span', { class: 'k' }, '!'), 'İşlem listesinde kesme yok: senkron alma eklenince bir kesme işlemi de eklenecek.') : null,
        h('div', { class: 'btnrow', style: { justifyContent: 'flex-end', marginTop: '6px' } },
          pk ? h('button', { class: 'btn dan', onclick: () => { P.ops.splice(P.ops.indexOf(pk), 1); this.closeModal(); this.recalc(true); this.toast('Senkron alma kaldırıldı'); } }, 'Kaldır') : null,
          h('button', { class: 'btn pri', onclick: () => {
            if (!cut) this.addOp('cutoff');
            pk = P.ops.find(o => o.type === 'pickoff');
            if (!pk) { this.addOp('pickoff'); pk = P.ops.find(o => o.type === 'pickoff'); }
            Object.assign(pk.params, { grip: +Math.min(st.grip, maxGrip).toFixed(3), feed: st.feed, gap: st.gap, dwell: st.dwell });
            pk.enabled = true; pk.name = 'Senkron alma (karşı mile al)';
            this.closeModal(); this.sel = { kind: 'op', id: pk.id }; this.recalc(true);
            this.toast(`Senkron alma: tutma ${pk.params.grip} mm, yanaşma Z${(L + bs - pk.params.grip - zs).toFixed(2)} (Z0’a göre)`, 4000);
          } }, pk ? 'Güncelle' : 'İşlem olarak ekle')));
      void rpm;
    };
    render();
    this.openModal('Senkron alma — karşı iş miline parça alma', box);
  }
  /** Sıfırdan G-kod: stok çapı ve malzeme sorulur, işlem listesi boş yeni proje, editörde boş program */
  openBlankGcode() {
    const P0 = this.project;
    const st = { dia: P0.stock.barDia || 12, mat: P0.stock.material || 'free', len: 30 };
    const box = h('div', { class: 'pbody', style: { minWidth: 'min(520px,86vw)' } });
    const bars = STD_BARS.filter(b => b <= P0.machine.maxBarDia);
    const ds = h('select', {}, bars.map(b => h('option', { value: b }, 'Ø' + b))); ds.value = String(bars.includes(st.dia) ? st.dia : bars[bars.length - 1]);
    const ms = h('select', {}, Object.entries(MATERIALS).map(([k, m]) => h('option', { value: k }, m.label))); ms.value = st.mat;
    const ln = h('input', { type: 'number', step: '1', min: '5', value: st.len });
    box.append(h('div', { class: 'hint' }, 'Boş bir programla başlarsınız: işlem listesi boştur, kodu satır satır yazıp Enter (EOB) ile oynatırsınız. 3D modelde çubuk bu çapta oluşturulur.'),
      h('div', { class: 'fg' }, h('div', { class: 'f' }, h('label', {}, 'Stok (çubuk) çapı'), ds), h('div', { class: 'f' }, h('label', {}, 'Görünen çubuk boyu', h('span', { class: 'u' }, 'mm')), ln),
        h('div', { class: 'f full' }, h('label', {}, 'Malzeme'), ms)),
      h('div', { class: 'btnrow', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn ghost', onclick: () => this.closeModal() }, 'Vazgeç'),
        h('button', { class: 'btn pri', onclick: () => {
          if (this.manual != null && this.cfg.confirm && !confirm('Editördeki elle yazılmış kod silinip boş programla başlansın mı?')) return;
          const R = +ds.value / 2, L = Math.max(5, +ln.value || 30);
          const part = makePart({ name: 'Manuel program', profile: [{ z: 0, r: 0 }, { z: 0, r: R }, { z: L, r: R }, { z: L, r: 0 }], features: [], source: 'gcode' });
          const P = newProject(part);
          for (const k of ['tools', 'post', 'machine']) P[k] = P0[k];
          P.ops = []; P.stock.barDia = +ds.value; P.stock.material = ms.value; P.name = 'Manuel program';
          this.project = P; this.sel = { kind: 'none' }; this.manual = null;
          this.closeModal();
          this.recalc();
          const t = this.blankProgram();
          this.rtab('code'); this.editor.setText(t); this.runManual(t, { start: true });
          this.editor.focusLine(t.split('\n').length - 4);
          this.toast(`Ø${ds.value} çubuk hazır: satırı yazıp Enter (EOB) ile oynatın; bitince “Parça çıkar” ile parçayı çizdirin`, 5000);
        } }, 'Boş programı başlat')));
    this.openModal('Sıfırdan G-kod yaz', box);
  }
  /** G-kodu sonuna kadar simüle et, kalan malzemeden bitmiş parçayı çıkar ve parça olarak ata (işlem listesi temizlenir) */
  deriveFromCode(silent = false) {
    const text = this.codeText();
    if (!text.trim() || !this.result?.sim) return false;
    const P = this.project;
    let d;
    try { const ss = new StockSim(P, this.result.sim).runAll(); d = derivePart(ss.stock, P.stock.barDia / 2, P.part.source === 'gcode' ? P.part.name : 'G-kod parçası'); }
    catch (e) { console.error(e); this.toast('Parça çıkarılamadı: ' + e.message, 4500); return false; }
    if (!d.part) { if (!silent) this.toast(d.info, 3500); return false; }
    P.part = d.part; P.name = d.part.name; P.ops = [];
    if ((P.zero?.zShift || 0) > d.L) P.zero = { zShift: 0, label: 'Ön alın merkezi' };
    this.runManual(text, { start: true });        // parça boyu değişti: çerçeveler yeniden kurulur
    this.toast('Koddan parça çizildi: ' + d.info, 5000);
    return true;
  }
  /** Katalogdan takım: ünitenin boş numarası ve yanındaki boş montaj yeri */
  addToolFrom(preset) {
    const P = this.project, unit = preset.unit;
    const [a, b] = UNIT_NUMS[unit] || [1, 99];
    let num = a; while (P.tools.some(t => t.num === num) && num < b) num++;
    if (P.tools.some(t => t.num === num)) num = Math.max(...P.tools.map(t => t.num)) + 1;
    const same = P.tools.filter(t => t.unit === unit).map(t => t.yPos);
    const def = { gang: 110, cross: -20, front: 38, rear: 40, back: -20 }[unit] ?? 0;
    const yPos = !same.length ? def : unit === 'gang' || unit === 'cross' ? Math.min(...same) - 18 : Math.max(...same) + 20;
    const t = makeTool({ ...preset, num, yPos: preset.yPos ?? yPos });
    P.tools.push(t);
    this.recalc(true);
    this.toast(`T${String(num).padStart(2, '0')} ${t.name} eklendi — montaj konumunu (Y) kontrol edin`, 3500);
    return t;
  }
  /** Takım ayarları: bölümlere ayrılmış, yalnız takım tipine uygun alanlar */
  renderToolDetail(box, t) {
    const P = this.project;
    const change = (key) => { this.toolChanged(t, key); };
    const turn = t.type === 'turn', rot = isRotaryTool(t), blade = t.type === 'groove' || t.type === 'cutoff';
    const left = h('div', { class: 'td-side' }, h('img', { class: 'td-img', src: toolThumb(t), alt: '' }));
    if (turn) left.append(h('div', { class: 'insprev', html: insertSvg(t) }));
    const used = P.ops.filter(o => o.toolId === t.id);
    left.append(h('div', { class: 'td-used' }, h('b', {}, used.length ? used.length + ' işlemde kullanılıyor' : 'Hiçbir işlemde kullanılmıyor'), ...used.map(o => h('small', {}, '· ' + o.name))));
    const right = h('div', { class: 'td-main' });
    const sec = (title, fields, extra) => {
      const g = h('div', { class: 'fg' });
      for (const f of fields) if (f) g.append(f);
      right.append(h('section', { class: 'td-sec' }, h('h4', {}, title), g, extra || null));
    };
    const F = (k, label, unit, kind = 'num', full = false) => field(t, k, label, unit, kind, change, { full });
    sec('Genel', [F('num', 'T No', '', 'int'), F('offset', 'Ofset No', '', 'int'), F('name', 'Ad', '', 'text', true), F('type', 'Takım tipi', '', 'select:type', true), F('unit', 'Bağlandığı ünite', '', 'select:unit', true),
      t.unit === 'back' && rot ? F('live', 'Tahrikli (döner) takım', '', 'bool') : null]);
    if (turn) {
      const code = F('insertCode', 'ISO uç kodu (listeden seçin ya da yazın)', '', 'text', true);
      code.querySelector('input').setAttribute('list', 'insertCodes');
      // katere (uç tipine) uyumlu elmaslar: tıklayınca takılır
      const fam = insertShapeOf(t);
      const fit = INSERT_CODES.filter(([c]) => c[0] === fam);
      const chips = h('div', { class: 'ins-grid' }, ...fit.map(([c, d]) => {
        const ic = parseInsertCode(c), tmp = { ...t, insertShape: ic.shape, insertSize: ic.size, noseR: ic.noseR ?? t.noseR };
        return h('button', { class: 'ins-chip' + (String(t.insertCode || '').replace(/\s/g, '') === c.replace(/\s/g, '') ? ' on' : ''), title: d, onclick: () => { t.insertCode = c; change('insertCode'); } },
          h('span', { class: 'ins-svg', html: insertSvg(tmp).split('</svg>')[0] + '</svg>' }), h('b', {}, c), h('small', {}, d.split('·').slice(1).join('·').trim()));
      }));
      const adv = insertAdvice(t);
      sec('Kesici uç (elmas)', [code, F('insertShape', 'Kater / uç tipi', '', 'select:insertShape', true), F('insertSize', 'Kenar boyu', 'mm'), F('noseR', 'Burun radyüsü rε', 'mm'),
        F('chipGeo', 'Talaş kırıcı (geometri)', '', 'select:chipGeo', true)],
        h('div', {}, h('div', { class: 'hint' }, `Bu katere (${INSERT_SHAPES[fam].label}) uyan elmaslar — tıklayınca takılır:`), chips,
          h('ul', { class: 'advice' }, ...adv.lines.map(l => h('li', {}, l)))));
    }
    sec('Ölçüler', [
      !turn && t.type !== 'thread' && !blade ? F('dia', 'Çap', 'mm') : null,
      blade ? F('width', 'Genişlik', 'mm') : null,
      blade || t.type === 'thread' ? F('noseR', 'Uç radyüsü', 'mm') : null,
      t.type === 'tap' || t.type === 'ltap' ? F('pitch', 'Hatve', 'mm') : null,
      t.type === 'drill' || t.type === 'center' || t.type === 'ldrill' ? F('tipAngle', 'Uç açısı', '°') : null,
      rot && t.type !== 'tap' && t.type !== 'ltap' ? F('flutes', 'Ağız sayısı', 'adet', 'int') : null,
      F('length', 'Çıkıntı boyu', 'mm')]);
    const mat = MATERIALS[P.stock.material] || MATERIALS.free;
    sec('Kesme değerleri', [F('vc', 'Kesme hızı Vc', 'm/dak'), t.live ? F('fz', 'Diş başı ilerleme fz', 'mm/diş') : F('feed', 'İlerleme f', 'mm/dev')],
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', title: 'Parça malzemesine göre öner', onclick: () => {
        if (turn) { const sg = suggestRough(P.stock.material, t, P.stock.barDia); t.vc = sg.vc; t.feed = sg.feed; }
        else if (t.live) { t.vc = t.type === 'endmill' ? mat.vcMill : mat.vcDrill; }
        else if (t.type === 'drill' || t.type === 'center') t.vc = mat.vcDrill;
        else if (blade) { t.vc = Math.round(mat.vcRough * 0.6); t.feed = Math.round(mat.fFinish * 0.6 * 1000) / 1000; }
        change('vc'); this.toast(`${mat.short} için önerilen değerler uygulandı`);
      } }, '✦ ' + mat.short + ' için öner')));
    sec('Montaj', [F('yPos', 'Yanal konum (Y1 / arka ünite)', 'mm'), t.unit === 'gang' || t.unit === 'cross' || t.unit === 'front' ? F('xPos', 'Radyal montaj (X1, − aşağı)', 'mm') : null],
      h('div', { class: 'hint' }, `Kanal $${t.channel} · ${t.live ? 'tahrikli (döner)' : 'sabit'} takım. Takımlar arasında en az 15 mm bırakın; çarpışma kontrolü uyarır.`));
    // 3D model ve işlemler
    const tf = h('input', { type: 'file', accept: '.stp,.step,.STP,.STEP', hidden: true });
    tf.addEventListener('change', async () => {
      const f = tf.files[0]; if (!f) return;
      this.status('Takım modeli okunuyor…', 'busy');
      try { const m = await loadToolModel(f); customToolModels.set(t.id, m); t.model = { b64: m.b64, name: f.name, flip: false, axis: null, rotY: 0 }; this.recalc(true); this.toast('Takım modeli bağlandı: ' + f.name); }
      catch (e) { this.toast('Model okunamadı: ' + e.message, 5000); this.status('Hazır'); }
    });
    const tm = (fn) => () => { if (!t.model) return; fn(t.model); this.recalc(true); };
    right.append(h('section', { class: 'td-sec' }, h('h4', {}, '3D model ve işlemler'), tf,
      h('div', { class: 'hint' }, t.model ? `Üretici STEP modeli bağlı (${t.model.name || 'model'}). Yalnız görseldir; hesap ölçülerden yapılır.` : 'Parametrik model. Üreticinin STEP modelini bağlayabilirsiniz (Sandvik, Iscar, Vargus…).'),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn', onclick: () => tf.click() }, 'STEP model yükle'),
        t.model ? h('button', { class: 'btn', onclick: tm(m => { m.flip = !m.flip; }) }, 'Ucu çevir') : null,
        t.model ? h('button', { class: 'btn', onclick: tm(m => { m.axis = ((m.axis ?? 0) + 1) % 3; }) }, 'Ekseni değiştir') : null,
        t.model ? h('button', { class: 'btn dan', onclick: () => { delete t.model; customToolModels.delete(t.id); this.recalc(true); } }, 'Modeli kaldır') : null,
        h('button', { class: 'btn', onclick: () => { const c = clone(t); c.id = makeTool({}).id; c.num = Math.max(...P.tools.map(x => x.num)) + 1; c.offset = c.num; c.name += ' (kopya)'; P.tools.push(c); this._tv = { view: 'detail', id: c.id }; this.recalc(true); } }, 'Kopyala'),
        h('button', { class: 'btn dan', onclick: () => { if (used.length) { this.toast('Bu takım işlemlerde kullanılıyor; önce işlemlerden çıkarın'); return; } if (this.cfg.confirm && !confirm(`${t.name} silinsin mi?`)) return; P.tools.splice(P.tools.indexOf(t), 1); this._tv = { view: 'grid', filter: 'all' }; this.recalc(true); } }, 'Sil'))));
    box.append(left, right);
    if (!document.getElementById('insertCodes')) document.body.append(h('datalist', { id: 'insertCodes' }, INSERT_CODES.map(([c, d]) => h('option', { value: c }, d))));
  }
  /** Takım alanı değişti: bağımlı alanları güncelle, yeniden hesapla */
  toolChanged(t, key) {
    if (key === 'unit') { t.channel = UNITS[t.unit].channel; }
    if (key === 'type' || key === 'unit') t.live = TOOL_TYPES[t.type].live || t.unit === 'cross' || (t.unit === 'back' && !!t.live && isRotaryTool(t));
    if (key === 'type' && t.type === 'turn' && !INSERT_SHAPES[t.insertShape]) t.insertShape = 'V';
    if (key === 'insertCode') {
      const ic = parseInsertCode(t.insertCode);
      if (!ic) { if (t.insertCode) this.toast('Uç kodu çözülemedi — örnek: VCMT 110304, DCGT 11T302, CNMG 120408', 4500); }
      else { t.insertShape = ic.shape; t.insertSize = ic.size; if (ic.noseR != null) t.noseR = ic.noseR; this.toast(`${INSERT_SHAPES[ic.shape].label} · kenar ${ic.size} mm${ic.noseR != null ? ' · burun R' + ic.noseR : ''}${ic.clearance != null ? ' · serbest açı ' + ic.clearance + '°' : ''}`, 4000); }
    }
    if (INSERT_SHAPES[t.insertShape]) t.insertAngle = INSERT_SHAPES[t.insertShape].angle;
    this.recalc(true);
  }
  /** Takım yollarının hepsini aç / kapat (araç çubuğu düğmesi, kısayol T) */
  togglePaths() {
    if (this.cfg.path === 'none') this.cfg.path = this._lastPath && this._lastPath !== 'none' ? this._lastPath : 'all';
    else { this._lastPath = this.cfg.path; this.cfg.path = 'none'; }
    this.setCfg('path');
    this.toast(this.cfg.path === 'none' ? 'Takım yolları gizlendi' : 'Takım yolları gösteriliyor', 1600);
  }
  /** Ön/üst görünüm odağı: parçanın burçtan çıkan (görünen) kısmı */
  viewFocus() {
    const bush = -3.2;
    let front = this.project.part.length * 0.5;
    try { front = this.stockSim.mainFrontWorld(this.machine.pose1.m.Z); } catch { /* */ }
    const vis = Math.max(8, front - bush);
    return { L: vis + 10, cx: (front + bush) / 2 };
  }
  /** Görünüm menüsü (grafik penceresi): sık kullanılan görünüm ayarları */
  renderQuickView() {
    const pb = $('btnPaths');
    if (pb) { const on = this.cfg.path !== 'none'; pb.setAttribute('aria-pressed', String(on)); pb.title = (on ? 'Takım yollarını gizle' : 'Takım yollarını göster') + ' (T)'; }
    const box = $('quickView'); if (!box) return;
    box.innerHTML = '';
    for (const k of QUICK_VIEW) box.append(control(this.cfg, k, (key) => this.setCfg(key), true));
    box.append(h('hr'), h('button', { onclick: () => this.openSettings('view') }, h('i', {}, '⚙'), 'Tüm görünüm ayarları…'));
  }
  openSettings(cat = 'view') {
    const extra = {
      coll: () => {
        const P = this.project;
        const c = P.machine.collision = { ...COLLISION_DEFAULTS, ...(P.machine.collision || {}) };
        const ch = () => { this.recalc(true); };
        const box = h('div', { class: 'st-extra' }, h('p', {}, 'Bu tanımlar projeyle kaydedilir. Bir ihlal olursa Uyarılar sekmesinde listelenir ve NC kodunun indirilmesi kilitlenir.'));
        const sw = (k, label, desc) => {
          const inp = h('input', { type: 'checkbox', role: 'switch' }); inp.checked = !!c[k];
          inp.addEventListener('change', () => { c[k] = inp.checked; ch(); });
          return h('label', { class: 'st-row is-bool' }, h('span', { class: 'st-txt' }, h('b', {}, label), h('small', {}, desc)), h('span', { class: 'sw' }, inp, h('i')));
        };
        const num = (k, label, desc) => {
          const inp = h('input', { type: 'number', step: '0.05', min: '0', value: c[k] });
          inp.addEventListener('change', () => { c[k] = Math.max(0, parseFloat(inp.value) || 0); inp.value = c[k]; ch(); });
          return h('label', { class: 'st-row is-sel' }, h('span', { class: 'st-txt' }, h('b', {}, label), h('small', {}, desc)), h('span', { class: 'st-num' }, inp, 'mm'));
        };
        box.append(
          sw('enabled', 'Makine gövdesi çarpışma kontrolü', 'Takım tutucuları, burç, karşı iş mili, arka ünite ve parça'),
          num('clearPart', 'Tutucu – parça güvenlik mesafesi', 'Kesmeyen gövdeler (tutucu, pens, ünite) parçaya bundan fazla yaklaşamaz. 0 = yalnız temas'),
          num('clearBody', 'Gövde – gövde güvenlik mesafesi', 'Takım tutucusu ↔ burç, karşı iş mili ve arka ünite arası en az mesafe'),
          sw('checkBush', 'Kılavuz burç kontrolü', 'Tutucular ve karşı iş mili burç gövdesine çarpmasın'),
          sw('checkSub', 'Karşı iş mili kontrolü', 'Gang takımları karşı iş mili gövdesine çarpmasın'),
          sw('checkBack', 'Arka ünite kontrolü', 'Takımlar ve karşı iş mili arka üniteye çarpmasın'),
          sw('checkRapid', 'G0 bindirme kontrolü', 'Hızlı harekette (G0) takım malzemeye girmesin'),
          num('rapidTol', 'Bindirme toleransı', 'G0 ile bu değerden fazla malzemeye girilirse hata'),
          h('div', { class: 'btnrow', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: () => { P.machine.collision = { ...COLLISION_DEFAULTS }; this.recalc(true); this.openSettings('coll'); } }, 'Varsayılana dön')));
        return box;
      },
      post: () => h('div', { class: 'st-extra' },
        h('p', {}, 'M kodları, program numarası, sabit çevrimler, iş mili adresleri ve eksen limitleri.'),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn pri', onclick: () => this.openPostConfig() }, 'Post-processor ve makine ayarlarını aç'), h('button', { class: 'btn', onclick: () => this.openSetupSheet() }, 'Kurulum föyü'))),
      keys: () => h('div', { class: 'st-keys' }, ...[
        ['Boşluk', 'Oynat / duraklat'], ['← →', 'Önceki / sonraki satır'], ['2 / 3', '2D / 3D grafik'], ['T', 'Takım yollarını gizle / göster'], ['E', 'Eksen okları'],
        ['Ctrl+S', 'Kaydet'], ['Ctrl+O', 'Proje aç'], ['Ctrl+N', 'Yeni parça'], ['Enter / Insert', 'G-kod: satırı oynat (EOB)'], ['F1 / ?', 'Yardım turu'], ['Esc', 'Pencereyi / menüyü kapat'],
      ].map(([k, d]) => h('div', {}, h('kbd', {}, k), h('span', {}, d)))),
      ui: () => h('div', { class: 'btnrow', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => { this.closeModal(); this.tour.start(); } }, 'Yardım turunu başlat'),
        h('button', { class: 'btn dan', onclick: () => { if (!confirm('Bütün ayarlar varsayılana dönsün mü?')) return; try { localStorage.removeItem('kayarcam.settings.v1'); } catch { /* */ } this.cfg = loadSettings(); this.setCfg('expert'); this.setCfg('speed'); this.openSettings('ui'); } }, 'Ayarları sıfırla')),
    };
    this.openModal('Ayarlar', settingsPanel(this.cfg, (k) => this.setCfg(k), extra, cat), { wide: true, cls: 'settings' });
  }
  /** Sağ panel sekmesi */
  rtab(k) {
    if (!this.cfg.code) { this.cfg.code = true; this.setCfg('code'); }
    document.querySelectorAll('.rt').forEach(x => x.classList.toggle('active', x.dataset.rt === k));
    document.querySelectorAll('.rpane').forEach(x => x.classList.toggle('active', x.id === 'pane-' + k));
    if (k === 'code') this.editor.paint();
  }

  player(cmd) {
    if (!this.stockSim) return;
    this.playUntil = null;
    if (cmd === 'play') {
      if (this.t >= this.totalTime - 1e-6) this.seek(0);
      this.playing = !this.playing;
      $('playBtn').textContent = this.playing ? '❚❚' : '▶';
      if (this.playing && this.cfg.verify) { this.cfg.verify = false; this.setCfg('verify'); }
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

  action(a, el) {
    switch (a) {
      case 'addop': this.openOpMenu(el || $('btnAddOp')); break;
      case 'output': this.openOutput(); break;
      case 'tools': this.openTools(); break;
      case 'rough': this.openRough(); break;
      case 'theme': this.cfg.theme = this.cfg.theme === 'light' ? 'dark' : 'light'; this.setCfg('theme'); break;
      case 'settings': this.openSettings(); break;
      case 'tour': this.tour.start(); break;
      case 'gcode': $('fileNc').click(); break;
      case 'sketch': new Sketcher(this).open(); break;
      case 'gblank': this.openBlankGcode(); break;
      case 'new': this.openStart(); break;
      case 'open': $('fileProj').click(); break;
      case 'save': download((this.project.name || 'proje') + '.kcam', saveProject(this.project), 'application/json'); this.toast('Proje kaydedildi'); break;
      case 'step': $('fileStep').click(); break;
      case 'fixture': this.openSetup(); break;
      case 'profile': case 'part': this.openPart(); break;
      case 'auto':
        if (this.project.ops.length && this.cfg.confirm && !confirm('Mevcut işlem listesi silinip özelliklere göre otomatik plan oluşturulsun mu?')) return;
        this.project.ops = autoOperations(this.project); this.sel = { kind: 'op', id: this.project.ops[0]?.id }; this.recalc(); break;
      case 'calc': this.recalc(); if (!this.cfg.autoVerify) setTimeout(() => this.runVerify(), 50); this.toast('Program yeniden hesaplandı'); break;
      case 'download': this.downloadNC(); break;
      case 'sheet': this.openSetupSheet(); break;
      case 'postcfg': this.openPostConfig(); break;
    }
  }

  downloadNC() {
    const r = this.result;
    if (!r?.sim) { this.toast('Önce programı hesaplayın'); return; }
    if (!this.verify) { this.toast('Verify ve çarpışma kontrolü sürüyor — bitince indirin.', 3500); return; }
    const errs = r.errors.length + this.verify.ss.collisions.length + (this.verify.c.over ? 1 : 0);
    if (errs) { this.toast(`İndirme kilitli: ${errs} hata var. Mesajlar sekmesine bakın.`, 4500); this.rtab('msgs'); return; }
    const name = `O${String(this.project.post.programNumber).padStart(4, '0')}`;
    download(name + (this.manual != null ? '_manuel' : '') + '.nc', this.codeText().replace(/\n/g, '\r\n'), 'text/plain');
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

  // ------------------------------------------------------------ sol panel: kartlar
  /** Parça, takımlar ve işlemler kart olarak; seçili kartın ayarları kartın içinde açılır */
  renderTree() {
    const P = this.project, tree = $('tree');
    const st = tree.scrollTop;
    tree.innerHTML = '';
    const errs = this.result?.errors || [];
    const errOps = new Set(errs.filter(e => e.op).map(e => e.op));
    const s = this.sel;
    const pick = (kind, id = null, after) => (e) => { e?.stopPropagation(); const same = s.kind === kind && (id == null || s.id === id); this.sel = same && kind !== 'part' ? { kind: 'none' } : { kind, id }; this.renderTree(); after?.(); };
    const body = () => { const b = h('div', { class: 'cbody' }); this.renderProps(b); return b; };
    if (this.mode === 'expert') {
      const ms = s.kind === 'machine';
      tree.append(h('section', { class: 'card mach' + (ms ? ' sel' : '') }, h('div', { class: 'ch', onclick: pick('machine') }, h('span', { class: 'ci', html: ICON.machine }), h('span', { class: 'tx' }, h('b', {}, P.machine.name), h('small', {}, P.machine.control)), h('span', { class: 'chev' }, ms ? '▴' : '▾')), ms ? body() : null));
    }
    if (this.manual != null) tree.append(h('div', { class: 'tnote' }, 'G-kod elle düzenleniyor. İşlemlerde bir değişiklik yaparsanız kod CAM çıktısıyla yenilenir.'));
    // --- işlemler
    let no = 0;
    for (const ch of [1, 2]) {
      const ops = P.ops.filter(op => OP_TYPES[op.type].channel === ch);
      const tot = ops.reduce((a, op) => { const ot = this.opTimes?.[op.id]; return a + (ot && op.enabled ? ot.t1 - ot.t0 : 0); }, 0);
      const allHid = ops.length && ops.every(o => o.hidePath);
      const grp = h('div', { class: 'ops-group' },
        h('div', { class: 'gh' }, h('span', { class: 'gch' }, '$' + ch), h('b', {}, ch === 1 ? 'Ana iş mili' : 'Karşı iş mili'), h('small', {}, `${ops.length} işlem · ${tot.toFixed(1)} s`),
          ops.length ? h('button', { class: 'geye' + (allHid ? ' hid' : ''), title: allHid ? 'Bu gruptaki bütün takım yollarını göster' : 'Bu gruptaki bütün takım yollarını gizle', onclick: () => { for (const o of ops) o.hidePath = !allHid; this.renderTree(); this.applyPathVis(true); this.plot.dirty = true; this.autosave(); } }, allHid ? '◌' : '◉') : null));
      if (!ops.length) grp.append(h('div', { class: 'empty' }, ch === 1 ? 'Henüz işlem yok. Kaba tornalama için “Kaba otomatik”, diğer işlemler için “İşlem ekle” düğmesine basın.' : 'Karşı iş mili işlemi yok.'));
      for (const op of ops) {
        no++;
        const ot = this.opTimes?.[op.id];
        const tool = P.tools.find(t => t.id === op.toolId);
        const on = s.kind === 'op' && s.id === op.id;
        const bad = errOps.has(op.id);
        const sw = h('input', { type: 'checkbox', title: 'İşlemi aç / kapat', onclick: (e) => e.stopPropagation(), onchange: (e) => { op.enabled = e.target.checked; this.recalc(true); } });
        sw.checked = op.enabled;
        const eye = h('button', { class: 'eye' + (op.hidePath ? ' hid' : ''), title: op.hidePath ? 'Takım yolunu göster' : 'Takım yolunu gizle', onclick: (e) => { e.stopPropagation(); op.hidePath = !op.hidePath; this.renderTree(); this.applyPathVis(true); this.plot.dirty = true; this.autosave(); } }, op.hidePath ? '◌' : '◉');
        const card = h('section', { class: 'card op' + (on ? ' sel' : '') + (op.enabled ? '' : ' off') + (bad ? ' err' : ''), 'data-id': op.id, draggable: 'true' },
          h('div', { class: 'ch', onclick: pick('op', op.id, () => { if (ot && this.sel.kind === 'op') this.seek(ot.t0); this.applyPathVis(true); }) },
            h('span', { class: 'no' }, String(no)),
            h('span', { class: 'oi' }, OP_ICONS[op.type] || '›'),
            h('span', { class: 'tx' }, h('b', {}, op.name), h('small', {}, [tool ? 'T' + String(tool.num).padStart(2, '0') + ' ' + tool.name : OP_TYPES[op.type].label, ot ? (ot.t1 - ot.t0).toFixed(1) + ' s' : ''].filter(Boolean).join(' · '))),
            bad ? h('span', { class: 'bad', title: 'Bu işlemde hata var' }, '!') : null,
            eye, h('label', { class: 'sw mini', onclick: (e) => e.stopPropagation() }, sw, h('i'))));
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/op', op.id); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', (e) => {
          e.preventDefault(); card.classList.remove('drag-over');
          const id = e.dataTransfer.getData('text/op');
          const from = P.ops.findIndex(o => o.id === id);
          if (from < 0 || id === op.id) return;
          if (OP_TYPES[P.ops[from].type].channel !== ch) { this.toast('İşlem yalnız kendi iş milinin listesinde taşınabilir'); return; }
          const [mv] = P.ops.splice(from, 1);
          P.ops.splice(P.ops.findIndex(o => o.id === op.id), 0, mv);
          this.recalc(true);
        });
        grp.append(card);
      }
      tree.append(grp);
      if (ch === 1) {
        // $1 ile $2 arası: senkron alma (karşı iş milini hizala, devri eşitle, parçayı tut, kesmeden sonra al)
        const pk = P.ops.find(o => o.type === 'pickoff' && o.enabled);
        const g = pk ? pickGrip(pk.params.grip, P.part.length, Math.max(0, +P.ops.find(o => o.type === 'cutoff' && o.enabled)?.params.backStock || 0), P.machine) : null;
        tree.append(h('button', { class: 'syncbtn' + (pk ? ' on' : ''), id: 'btnSync', onclick: () => this.openSync() },
          h('span', { class: 'si' }, '⇄'), h('span', { class: 'tx' }, h('b', {}, 'Senkron alma'), h('small', {}, pk ? `tutma ${+g.toFixed(2)} mm · yanaşma ${pk.params.feed} mm/dak · devir senkron` : 'Kesmeden önce karşı iş milini hizala ve senkronla')), h('span', { class: 'chev' }, pk ? '✓' : '＋')));
      }
    }
    tree.scrollTop = st;
    this.renderFlyout();
  }
  /** İşlem ayarları: sol menünün yanında açılan mini pencere */
  renderFlyout() {
    const fl = $('flyout'), s = this.sel;
    const op = s.kind === 'op' ? this.project.ops.find(o => o.id === s.id) : null;
    if (!op) { fl.classList.remove('on'); fl.innerHTML = ''; return; }
    const st = fl.querySelector('.fly-body')?.scrollTop || 0;
    fl.innerHTML = '';
    const def = OP_TYPES[op.type];
    const card = document.querySelector(`.card.op[data-id="${op.id}"]`);
    fl.append(h('div', { class: 'fly-head' }, h('span', { class: 'oi' }, OP_ICONS[op.type] || '›'), h('div', { class: 'tx' }, h('b', {}, op.name), h('small', {}, def.label + ' · $' + def.channel)),
      h('button', { class: 'fly-x', title: 'Kapat (Esc)', onclick: () => { this.sel = { kind: 'none' }; this.renderTree(); } }, '✕')));
    const b = h('div', { class: 'fly-body' }); this.renderProps(b); fl.append(b);
    fl.classList.add('on');
    // kartın hizasında aç (ekrana sığdır)
    const top = card ? card.getBoundingClientRect().top : 70;
    const T = Math.max(104, Math.min(window.innerHeight - Math.min(fl.offsetHeight, window.innerHeight - 120) - 14, top - 8));
    fl.style.top = T + 'px'; fl.style.maxHeight = (window.innerHeight - T - 12) + 'px';   // ekrandan taşmasın
    b.scrollTop = st;
  }

  /** İşlem ekleme menüsü: gruplu, tam adlarla (uzman modunda şerit de var) */
  openOpMenu(anchor) {
    document.querySelector('.opmenu')?.remove();
    const groups = [
      ['Tornalama', ['face', 'rough', 'finish', 'groove', 'thread', 'cutoff']],
      ['Delme', ['center', 'drill', 'tap', 'crossDrill']],
      ['Frezeleme (C/Y)', ['flatMill', 'polygonMill', 'pocketMill', 'cylSlot', 'engrave']],
      ['Karşı iş mili', ['pickoff', 'backTurn', 'backDrill', 'backTap', 'backSlot', 'backPolar', 'eject']],
      ['Çubuk', ['rechuck', 'midRechuck']],
    ];
    const m = h('div', { class: 'opmenu', role: 'menu' });
    for (const [g, types] of groups) {
      m.append(h('div', { class: 'og' }, g));
      for (const t of types) m.append(h('button', { role: 'menuitem', onclick: () => { m.remove(); this.addOp(t); } }, h('i', {}, OP_ICONS[t] || '+'), OP_TYPES[t].label));
    }
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = r.left + 'px';
    m.style.top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8) + 'px';
    m.querySelector('button')?.focus();
    const off = (e) => { if (!m.contains(e.target) && e.target !== anchor) { m.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { m.remove(); anchor.focus(); } });
  }

  addTool() { this.openTools(); this._tv = { view: 'catalog', filter: 'all' }; this._toolWin?.(); }

  /** Seçili öğenin ayarları (kartın gövdesine). box verilmezse kartlar yeniden çizilir */
  renderProps(box) {
    if (!box) { this.renderTree(); return; }
    const P = this.project;
    const change = () => this.recalc(true);
    const head = () => {};
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
        } else if (unit && unit.startsWith('select:')) g.append(field(op.params, k, label, '', unit, change, { full: true }));
        else g.append(field(op.params, k, label, unit === 'bool' ? '' : unit, unit === 'bool' ? 'bool' : unit === 'adet' ? 'int' : 'num', change));
      }
      body.append(g);
      if (['face', 'rough', 'finish', 'groove'].includes(op.type)) {
        // iş mili devri: G96 sabit kesme hızı + G50 sınırı ya da G97 sabit devir
        const tl = P.tools.find(t => t.id === op.toolId);
        const vc = +op.params.vc || tl?.vc || 0, D = P.stock.barDia;
        const lim = Math.min(P.machine.mainSpindle.maxRpm, P.stock.maxRpm || Infinity, +op.params.maxRpm > 0 ? +op.params.maxRpm : Infinity);
        const sg = h('div', { class: 'fg' });
        if (op.params.spindleMode !== 'rpm') op.params.spindleMode = 'css';
        sg.append(field(op.params, 'spindleMode', 'İş mili devri', '', 'select:x', change, { full: true, items: [['css', 'Sabit kesme hızı (G96, Vc)'], ['rpm', 'Sabit devir (G97, dev/dak)']] }));
        if (op.params.spindleMode === 'rpm') sg.append(field(op.params, 'rpm', 'Devir', 'dev/dak', 'int', change));
        sg.append(field(op.params, 'maxRpm', 'Devir sınırı G50 (boş = genel)', 'dev/dak', 'int', change));
        body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'İş mili'), sg,
          h('div', { class: 'hint' }, op.params.spindleMode === 'rpm'
            ? `Ø${D} çubukta kesme hızı ≈ ${Math.round(Math.PI * D * Math.min(+op.params.rpm || 0, lim) / 1000)} m/dak · sınır ${Math.round(lim)} dev/dak`
            : `Vc ${vc} m/dak → Ø${D} çubukta ${Math.round(Math.min(lim, vc * 1000 / (Math.PI * D)))} dev/dak; çap küçüldükçe devir ${Math.round(lim)} dev/dak sınırına kadar artar.`));
      }
      const errs = (this.result?.errors || []).filter(e => e.op === op.id);
      for (const e of errs) body.append(h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), e.msg));
      const ot = this.opTimes?.[op.id];
      if (ot) body.append(h('div', { class: 'kv' }, h('span', {}, 'Süre'), h('span', {}, (ot.t1 - ot.t0).toFixed(2) + ' s'), h('span', {}, 'Başlangıç'), h('span', {}, ot.t0.toFixed(2) + ' s')));
      body.append(h('div', { class: 'btnrow' },
        h('button', { class: 'btn', onclick: () => { const i = P.ops.indexOf(op); if (i > 0) { P.ops.splice(i, 1); P.ops.splice(i - 1, 0, op); change(); } } }, '↑ Yukarı'),
        h('button', { class: 'btn', onclick: () => { const i = P.ops.indexOf(op); if (i < P.ops.length - 1) { P.ops.splice(i, 1); P.ops.splice(i + 1, 0, op); change(); } } }, '↓ Aşağı'),
        h('button', { class: 'btn', onclick: () => { const c = clone(op); c.id = makeOp(op.type).id; c.name += ' (kopya)'; P.ops.splice(P.ops.indexOf(op) + 1, 0, c); this.sel = { kind: 'op', id: c.id }; change(); } }, 'Kopyala'),
        h('button', { class: 'btn', onclick: () => { op.params = { ...defaultParams(op.type), featureId: op.params.featureId }; change(); } }, 'Varsayılan'),
        h('button', { class: 'btn dan', onclick: () => { if (this.cfg.confirm && !confirm(`“${op.name}” silinsin mi?`)) return; P.ops.splice(P.ops.indexOf(op), 1); this.sel = { kind: 'none' }; change(); } }, 'Sil')));
      body.append(h('div', { class: 'hint' }, 'Boş bırakılan ilerleme/kesme hızı takım değerinden alınır. Bütün değerler makine limitleriyle sınırlanır; aşımda hata verilir.'));
    } else if (s.kind === 'tool') {
      const t = P.tools.find(x => x.id === s.id);
      if (!t) return;
      this.renderToolDetail(body, t);
    } else if (s.kind === 'stock') {
      head('Stok (Çubuk)', 'Mastercam: Stock Setup');
      const g = h('div', { class: 'fg' });
      g.append(field(P.stock, 'barDia', 'Çubuk çapı', 'mm', 'select:x', change, { items: STD_BARS.filter(b => b <= P.machine.maxBarDia).map(b => [b, 'Ø' + b]) }));
      g.append(field(P.stock, 'faceStock', 'Alın payı', 'mm', 'num', change));
      g.append(field(P.stock, 'maxRpm', 'G50 devir limiti', 'dev/dak', 'int', change));
      g.append(field(P.stock, 'segment', 'Kılavuz burç segment boyu (0 = kapalı)', 'mm', 'num', change));
      if (P.stock.barLength == null) P.stock.barLength = 2500;
      if (P.stock.remnant == null) P.stock.remnant = 250;
      g.append(field(P.stock, 'barLength', 'Çubuk boyu', 'mm', 'num', change));
      g.append(field(P.stock, 'remnant', 'Kalan uç (çubuk sonu)', 'mm', 'num', change));
      body.append(g);
      const bf = barFlow(P, this.totalTime || 0);
      body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'Çubuk akışı'));
      body.append(h('div', { class: 'kv' },
        h('span', {}, 'Çubuk başına parça'), h('span', {}, String(bf.parts)),
        h('span', {}, 'Malzeme verimi'), h('span', {}, '%' + (bf.yield * 100).toFixed(1)),
        h('span', {}, 'Saatte parça'), h('span', {}, bf.partsPerHour.toFixed(1)),
        h('span', {}, 'Bir çubuk süresi'), h('span', {}, (bf.barTime / 60).toFixed(1) + ' dk')));
      const cut = P.tools.find(t => t.type === 'cutoff');
      body.append(h('div', { class: 'kv' },
        h('span', {}, 'Parça boyu'), h('span', {}, P.part.length.toFixed(3) + ' mm'),
        h('span', {}, 'En büyük çap'), h('span', {}, 'Ø' + P.part.maxDia.toFixed(3)),
        h('span', {}, 'Önerilen çubuk'), h('span', {}, 'Ø' + (suggestBar(P.part.maxDia, P.machine.maxBarDia) ?? '— (makine kapasitesi aşıldı)')),
        h('span', {}, 'Kesme genişliği'), h('span', {}, (cut ? cut.width : 2) + ' mm'),
        h('span', {}, 'Parça başı çubuk'), h('span', {}, (P.part.length + (cut ? cut.width : 2) + P.stock.faceStock).toFixed(2) + ' mm')));
      if (P.part.maxDia > P.stock.barDia + 1e-6) body.append(h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), 'Parça çapı çubuk çapından büyük!'));
    } else if (s.kind === 'zero') {
      head('Bağlama ve referans noktası', 'Z0 X0');
      if (!P.zero) P.zero = { zShift: 0, label: 'Ön alın merkezi' };
      body.append(h('div', { class: 'kv' },
        h('span', {}, 'Ön yüz'), h('span', {}, P.part.source === 'step' ? (P.part.flip ? 'modelin diğer ucu (çevrildi)' : 'modelin otomatik ön ucu') : 'tablonun ilk satırı'),
        h('span', {}, 'Torna ekseni'), h('span', {}, P.part.source === 'step' ? (P.part.axisFaceId != null ? 'seçilen silindir yüzü' : 'en büyük dış silindir') : 'profil ekseni'),
        h('span', {}, 'Referans (Z0)'), h('span', {}, P.zero.label || 'Ön alın merkezi'),
        h('span', {}, 'X0'), h('span', {}, 'torna ekseni')));
      body.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn pri', onclick: () => this.openSetup('front') }, 'Ön yüzü değiştir'), h('button', { class: 'btn', onclick: () => this.openSetup('zero') }, 'Referans noktasını değiştir')));
      body.append(h('div', { class: 'hint' }, 'Kurulum penceresinde parçayı 3D görürsünüz: ön yüz yeşil, arka turuncu halkayla işaretlidir; referans noktasını listeden seçebilir ya da modelde bir yüze tıklayarak belirleyebilirsiniz.'));
      if (this.mode === 'expert') {
        const g = h('div', { class: 'fg' });
        g.append(field(P.zero, 'zShift', 'Z0 (ön alından)', 'mm', 'num', () => { const z = +P.zero.zShift || 0; P.zero.label = !z ? 'Ön alın merkezi' : Math.abs(z - P.part.length) < 1e-6 ? 'Arka alın merkezi' : `Ön alından ${z} mm`; change(); }));
        body.append(g);
      }
    } else if (s.kind === 'part' || s.kind === 'feature') {
      body.append(field(P.part, 'name', 'Parça adı', '', 'text', () => { P.name = P.part.name; change(); }, { full: true }));
      body.append(h('div', { class: 'svgprev', html: profileSvg(P.part, { w: 300, h: 130 }) }));
      if (P.part.source === 'gcode') {
        body.append(h('div', { class: 'hint' }, 'Bu parça G-koddan çıkarıldı: kod sonuna kadar simüle edildi, kalan malzemenin dış profili ve eksenel delikleri alındı.'),
          h('div', { class: 'kv' }, h('span', {}, 'Boy'), h('span', {}, P.part.length.toFixed(3)), h('span', {}, 'Maks. çap'), h('span', {}, P.part.maxDia.toFixed(3)), h('span', {}, 'Profil noktası'), h('span', {}, String(P.part.profile.length))),
          h('div', { class: 'btnrow' }, h('button', { class: 'btn pri', onclick: () => { this.closeModal(); this.deriveFromCode(); } }, 'Koddan yeniden çıkar')));
      } else if (P.part.source === 'sketch') {
        body.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn pri', onclick: () => {
          const w = new Sketcher(this, { pts: P.part.sketch, name: P.part.name, features: P.part.features });
          w.finish = () => { const err = validateSketch(w.pts); if (err.length) { this.toast(err[0], 4500); return; } const part = partFromSketch(w.pts, w.name, w.allFeatures()); this.closeModal(); new SetupWizard(this, { kind: 'sketch', part, edit: true, geomChanged: true, start: 'front' }).open(); };
          w.open();
        } }, '✎ Çizimi düzenle')));
        body.append(h('div', { class: 'kv' }, h('span', {}, 'Boy'), h('span', {}, P.part.length.toFixed(3)), h('span', {}, 'Maks. çap'), h('span', {}, P.part.maxDia.toFixed(3)), h('span', {}, 'Köşe noktası'), h('span', {}, String(P.part.sketch?.length || 0))));
      } else if (P.part.source !== 'step') {
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
      for (const f of P.part.features) {
        const fs = s.kind === 'feature' && s.id === f.id;
        body.append(h('div', { class: 'feat' + (fs ? ' on' : ''), onclick: () => { this.sel = fs ? { kind: 'part' } : { kind: 'feature', id: f.id }; this._partWin ? this._partWin() : this.renderTree(); } }, h('b', {}, FEATURE_LABELS[f.type]), featureText(f)));
        if (fs) { const fb = h('div', { class: 'fbody' }); this.renderFeature(fb, f, change); body.append(fb); }
      }
      body.append(h('div', { class: 'btnrow' }, ...Object.keys(FEATURE_FIELDS).map(ft => h('button', { class: 'btn', onclick: () => this.addFeature(ft) }, '+ ' + FEATURE_LABELS[ft]))));
    } else if (s.kind === 'featureOnly') {
      const f = P.part.features.find(x => x.id === s.id);
      if (!f) return;
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

  renderFeature(box, f, change) {
    const P = this.project;
    const g = h('div', { class: 'fg' });
    for (const [k, label, unit] of FEATURE_FIELDS[f.type]) g.append(field(f, k, label, unit === 'bool' || unit === 'text' || unit.startsWith('select') ? '' : unit, unit === 'bool' || unit === 'text' ? unit : unit.startsWith('select') ? unit : unit === 'adet' ? 'int' : 'num', change, { full: unit === 'text' }));
    box.append(g);
    box.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn dan', onclick: () => { if (this.cfg.confirm && !confirm('Bu özellik silinsin mi?')) return; P.part.features.splice(P.part.features.indexOf(f), 1); this.sel = { kind: 'part' }; change(); } }, 'Özelliği sil')));
  }

  addFeature(ft) {
    const P = this.project, L = P.part.length;
    const id = 'u' + Math.random().toString(36).slice(2, 7);
    // en uzun silindirik bölüm (çokgen/yazı/kanal varsayılanları oraya, o bölümün çapına göre)
    let best = null;
    for (let i = 0; i < P.part.profile.length - 1; i++) {
      const a = P.part.profile[i], b = P.part.profile[i + 1];
      if (Math.abs(a.r - b.r) < 1e-6 && a.r > 0 && b.z - a.z > 2 && (!best || b.z - a.z > best.z1 - best.z0)) best = { z0: a.z, z1: b.z, r: a.r };
    }
    if (!best) best = { z0: 0, z1: L, r: P.part.maxDia / 2 };
    const zm = (best.z0 + best.z1) / 2, half = Math.max(1, Math.min(4, (best.z1 - best.z0) / 2 - 1));
    const r1 = (v) => Math.round(v * 10) / 10;
    const defs = {
      axialHole: { side: 'front', dia: 4, depth: Math.min(6, L / 2), through: false },
      crossHole: { dia: 3, z: L / 2, c: 0, y: 0, through: true, depthDia: null },
      flat: { c: 0, depth: 1, z0: L / 2 - 3, z1: L / 2 + 3 },
      thread: { dia: Math.round(P.part.maxDia * 0.7), pitch: 1, z0: 1, z1: Math.min(10, L / 2) },
      pocket: { dia: 6, depth: 1, z: L / 2, c: 0 },
      polygon: { n: 6, af: r1(2 * best.r * 0.8), z0: r1(zm - half), z1: r1(zm + half), c: 0 },
      odSlot: { width: 4, depth: r1(Math.min(0.8, best.r * 0.15)), z0: r1(zm - half + 2), c0: 0, z1: r1(zm + half - 2), c1: 90 },
      faceSlot: { side: 'back', width: 4, depth: 1, c: 0 },
      engrave: { text: 'KAYAR', height: r1(Math.min(3, (best.z1 - best.z0) - 1)), depth: 0.15, z: r1(zm), c: 0 },
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
    const text = this.codeText();
    if (this.manual == null) this.editor.setText(text);
    if (!this._map) this._map = lineMap(text);
    const errs = [];
    for (const e of r.errors) if (e.src === 'nc' && e.path) { const l = this._map.rev[e.path - 1]?.[e.line]; if (l != null) errs.push(l); }
    this.editor.setErrors(errs);
  }
  seekLine(ch, li) {
    const m = this.result.sim.paths[ch - 1]?.moves.find(x => x.line >= li);
    if (m) { this.playing = false; this.playUntil = null; $('playBtn').textContent = '▶'; this.seek(m.t0 + 1e-6); }
    const l = this._map?.rev[ch - 1]?.[li];
    if (l != null) { this.rtab('code'); this.editor.focusLine(l); }
  }

  // ------------------------------------------------------------ senkronizasyon
  renderSync() {
    const box = $('sync'), r = this.result, P = this.project;
    box.innerHTML = '';
    if (!r.sim) return;
    const T = this.totalTime || 1;
    const colors = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#f59e0b', '#22d3ee'];
    // senkron ayarları (ESPRIT senkronizasyon yöneticisi)
    const ov = h('input', { type: 'checkbox' });
    ov.checked = !!P.sync?.overlap;
    ov.addEventListener('change', () => { P.sync = { ...(P.sync || {}), overlap: ov.checked }; this.recalc(true); });
    box.append(h('div', { class: 'syncbar' },
      h('label', { title: '$2, önceki çevrimde aldığı parçanın arka işlemlerini ve atmayı önce yapar, sonra yeni parçayı alır. Arka işlemler $1 ön işlemleriyle paralel yürür. İlk çevrimde karşı iş mili boştur.' }, ov, ' Örtüşen çevrim (arka işlemler bir sonraki parçanın ön işlemleriyle paralel)'),
      h('span', { class: 'sb-hint' }, 'Blokları sürükleyip başka bir bloğun üstüne bırakarak sırayı değiştirin.')));
    box.append(h('div', { class: 'axis' }, ...[0, 0.25, 0.5, 0.75, 1].map(f => h('span', {}, (T * f).toFixed(1) + 's'))));
    for (const ch of [1, 2]) {
      const lane = h('div', { class: 'lt' });
      let k = 0;
      for (const op of P.ops) {
        const ot = this.opTimes[op.id];
        if (!ot || ot.path !== ch) continue;
        const left = (ot.t0 / T) * 100, w = Math.max(0.3, ((ot.t1 - ot.t0) / T) * 100);
        const blk = h('div', { class: 'blk', draggable: 'true', title: `${op.name}  ${(ot.t1 - ot.t0).toFixed(2)} s — sürükleyerek sırala`, style: { left: left + '%', width: w + '%', background: colors[k++ % colors.length] }, onclick: () => { this.sel = { kind: 'op', id: op.id }; this.renderTree(); this.seek(ot.t0); } }, op.name);
        blk.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/op', op.id); });
        blk.addEventListener('dragover', (e) => { e.preventDefault(); blk.classList.add('drag-over'); });
        blk.addEventListener('dragleave', () => blk.classList.remove('drag-over'));
        blk.addEventListener('drop', (e) => {
          e.preventDefault(); blk.classList.remove('drag-over');
          const id = e.dataTransfer.getData('text/op');
          const from = P.ops.findIndex(o => o.id === id);
          if (from < 0 || id === op.id) return;
          if (OP_TYPES[P.ops[from].type].channel !== ch) { this.toast('İşlem yalnız kendi kanalında sıralanabilir'); return; }
          const [mv] = P.ops.splice(from, 1);
          P.ops.splice(P.ops.findIndex(o => o.id === op.id), 0, mv);
          this.recalc(true);
        });
        lane.append(blk);
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
      box.append(h('div', { class: 'msg ' + m.k, onclick: () => { if (m.path != null && m.line != null) this.seekLine(m.path, m.line); if (m.op) { this.sel = { kind: 'op', id: m.op }; this.renderTree(); } } },
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
    if (c.skipped) box.append(h('div', { class: 'msg w' }, h('span', { class: 'k' }, 'i'), 'Parça G-koddan çıkarıldı: hedef, kodun kendi sonucu olduğu için fazla kesim / kalan malzeme karşılaştırması yapılmaz. Çarpışma ve bindirme kontrolleri çalışır.'));
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
    this.openModal('3D parça yükleniyor', h('div', {}, h('div', { class: 'spinner' }), h('div', { class: 'hint', style: { textAlign: 'center' } }, file.name + (/\.obj$/i.test(file.name) ? ' — OBJ ağı okunuyor, yüzler ayrılıyor…' : ' — OpenCascade ile okunuyor…'))));
    try {
      const res = await importStepFile(file);
      this.closeModal();
      new SetupWizard(this, { kind: 'step', res }).open();
    } catch (e) {
      console.error(e);
      this.openModal('3D parça açılamadı', h('div', { class: 'msg e' }, h('span', { class: 'k' }, '✗'), e.message));
    }
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
      const res = await importStepFile(null, p.stepB64, { flip: !!p.flip, axisFaceId: p.axisFaceId, fmt: p.meshFmt });
      p.mesh = res.part.mesh; p.fixture = res.part.fixture;
    } catch (e) { console.warn('STEP yeniden yüklenemedi', e); }
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
    body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'Sabit çevrimler'));
    body.append(h('div', { class: 'hint' }, 'Kapalıyken bütün hareketler açık yazılır (en güvenli; makine parametresinden bağımsız). Açarsanız simülasyon çevrimi FANUC kılavuzundaki biçimiyle açar — makinenizde kuru çalıştırma ile doğrulayın. G71/G70 bilinçli olarak yok: hareketi kontrol parametrelerine (5132/5133, tip I/II) bağlıdır, simülasyon garanti edemez.'));
    if (!post.cycles) post.cycles = { drill: false, rigidTap: false, thread: 'g92' };
    const cyc = h('div', { class: 'fg' });
    cyc.append(field(post.cycles, 'drill', 'G83 gagalamalı delme', '', 'bool', () => {}));
    cyc.append(field(post.cycles, 'rigidTap', 'Rijit kılavuz (M29 + G84)', '', 'bool', () => {}));
    cyc.append(field(post.cycles, 'thread', 'Diş çevrimi', '', 'select:x', () => {}, { items: [['g92', 'G92 (paso paso)'], ['g76', 'G76 (çok pasolu)']] }));
    cyc.append(field(post, 'peckClearance', 'G83 geri dönüş boşluğu (par. 5114)', 'mm', 'num', () => {}));
    cyc.append(field(post, 'workShift', 'İş kaydırması şablonu', '', 'text', () => {}));
    body.append(cyc);
    body.append(h('div', { class: 'tsec', style: { padding: '8px 0 2px' } }, 'M Kodları'));
    const labels = { mainCW: 'Ana mil ileri', mainCCW: 'Ana mil geri', mainStop: 'Ana mil dur', subCW: 'Karşı mil ileri', subCCW: 'Karşı mil geri', subStop: 'Karşı mil dur', liveCW: 'Tahrikli ileri', liveCCW: 'Tahrikli geri', liveStop: 'Tahrikli dur', backLiveCW: 'Arka tahrikli ileri', backLiveCCW: 'Arka tahrikli geri', backLiveStop: 'Arka tahrikli dur', coolantOn: 'Soğutma aç', coolantOff: 'Soğutma kapa', backCoolantOn: 'Arka soğutma aç', backCoolantOff: 'Arka soğutma kapa', mainCAxisOn: 'C1 ekseni aç', mainCAxisOff: 'C1 ekseni kapa', subCAxisOn: 'C2 ekseni aç', subCAxisOff: 'C2 ekseni kapa', rigidTap: 'Rijit kılavuz (M29)', partCount: 'Parça sayacı (boş = yok)', mainChuckClose: 'Ana pens kapa', mainChuckOpen: 'Ana pens aç', subChuckClose: 'Karşı pens kapa', subChuckOpen: 'Karşı pens aç', spindleSync: 'Senkron aç', spindleSyncOff: 'Senkron kapa', cutoffCheck: 'Kesim kontrol', partEject: 'Parça atma', barFeedStart: 'Çubuk besleme başla', barFeedEnd: 'Çubuk besleme bitir', programEnd: 'Program sonu', optionalStop: 'Opsiyonel dur' };
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

  openSetupSheet() {
    if (!this.result?.posted) { this.toast('Önce programı hesaplayın'); return; }
    const html = setupSheetHtml(this.project, this.result, this.opTimes || {}, this.totalTime || 0);
    const fr = h('iframe', { class: 'sheet' });
    fr.srcdoc = html;
    const body = h('div', {}, fr, h('div', { class: 'btnrow' },
      h('button', { class: 'btn pri', onclick: () => fr.contentWindow?.print() }, 'Yazdır'),
      h('button', { class: 'btn', onclick: () => download(`kurulum_O${String(this.project.post.programNumber).padStart(4, '0')}.html`, html, 'text/html') }, 'HTML İndir')));
    this.openModal('Kurulum Föyü — ' + this.project.part.name, body);
  }

  openModal(title, content, opts = {}) {
    if (this._onClose) { const f = this._onClose; this._onClose = null; f(); }
    $('mtitle').textContent = title;
    const b = $('mbody'); b.innerHTML = ''; b.append(content);
    $('modal').querySelector('.mbox').classList.toggle('wide', !!opts.wide);
    $('modal').querySelector('.mbox').dataset.kind = opts.cls || '';
    this._onClose = opts.onClose || null;
    $('modal').classList.add('on');
    setTimeout(() => (b.querySelector('.btn.pri:not([disabled])') || b.querySelector('button'))?.focus({ preventScroll: true }), 30);
  }
  closeModal() {
    $('modal').classList.remove('on');
    if (this._onClose) { const f = this._onClose; this._onClose = null; f(); }
  }
}

// ------------------------------------------------------------ yardımcılar
const OP_ICONS = { face: '⊣', rough: '▥', finish: '◜', groove: '⊔', thread: '≋', center: '▽', drill: '↧', tap: '⇊', cutoff: '✂', rechuck: '⇤', midRechuck: '⇆', crossDrill: '⊥', flatMill: '▭', polygonMill: '⬡', cylSlot: '◍', engrave: 'Ａ', pocketMill: '◎', pickoff: '⇥', backTurn: '◺', backDrill: '↤', backTap: '⇇', backSlot: '⊖', backPolar: '⬢', eject: '⏏' };
/** Kesici uç önizlemesi (SVG): şekil, burun radyüsü, uç açısı */
function insertSvg(t) {
  const p = insertOutline(t, 10), W = Math.max(...p.map(q => q[0])), H = Math.max(...p.map(q => q[1]));
  const k = 86 / Math.max(W, H), pad = 8;
  const d = p.map(([x, y], i) => (i ? 'L' : 'M') + (pad + x * k).toFixed(1) + ' ' + (pad + (H - y) * k).toFixed(1)).join(' ') + 'Z';
  const S = INSERT_SHAPES[t.insertShape] || {};
  return `<svg viewBox="0 0 ${Math.ceil(W * k + 2 * pad)} ${Math.ceil(H * k + 2 * pad)}" width="${Math.ceil(W * k + 2 * pad)}" height="${Math.ceil(H * k + 2 * pad)}"><path d="${d}" fill="rgba(207,165,58,.28)" stroke="#cfa53a" stroke-width="1.4"/><circle cx="${pad}" cy="${pad + H * k}" r="2.6" fill="#f472b6"/></svg><div><b>${esc(t.insertCode || (t.insertShape || '') + ' tipi')}</b><span>${esc(S.label || '')}</span><span>Burun R${t.noseR} · kenar ${t.insertSize || S.size || ''} mm</span><span>Pembe nokta: hayali uç (takım ofseti)</span></div>`;
}
const fmtN = (v) => (+v).toFixed(2).replace(/\.?0+$/, '');
const ICON = {
  part: '<svg viewBox="0 0 24 24"><path d="M3 9h5v6H3zM8 7h7v10H8zM15 10h6v4h-6z"/></svg>',
  tool: '<svg viewBox="0 0 24 24"><path d="M4 20 14 10M14 10l3-6 3 3-6 3M4 20l2-5 3 3z"/></svg>',
  machine: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
};
const isRotaryTool = (t) => ['drill', 'center', 'tap', 'endmill', 'ldrill', 'ltap'].includes(t.type);
/** Takım kartı alt satırı: tipe göre en önemli ölçü */
function toolSub(t) {
  const T = TOOL_TYPES[t.type]?.label || t.type;
  if (t.type === 'turn') return `${T} · ${t.insertCode || (t.insertShape || 'V') + ' tipi'} · R${t.noseR}`;
  if (t.type === 'groove' || t.type === 'cutoff') return `${T} · ${t.width} mm`;
  if (t.type === 'thread') return T;
  if (t.type === 'tap' || t.type === 'ltap') return `${T} · M${t.dia}×${t.pitch}`;
  return `${T} · Ø${t.dia}`;
}
/** Parça profili (üst yarı) + erişilemeyen bölgeler (kırmızı) — SVG */
function zoneSvg(part, zones) {
  const W = 340, H = 150, L = part.length, R = part.maxDia / 2 || 1;
  const sx = (W - 20) / L, sy = (H - 30) / R, X = (z) => W - 10 - z * sx, Y = (r) => H - 14 - r * sy;   // ön alın sağda (makine ve 2D grafikle aynı yön)
  const d = part.profile.map((p, i) => (i ? 'L' : 'M') + X(p.z).toFixed(1) + ' ' + Y(p.r).toFixed(1)).join(' ');
 const zr = zones.map(z => `<rect x="${X(z.z1).toFixed(1)}" y="${Y(R).toFixed(1)}" width="${Math.max(2, (z.z1 - z.z0) * sx).toFixed(1)}" height="${(Y(0) - Y(R)).toFixed(1)}" fill="rgba(248,113,113,.22)" stroke="#f87171" stroke-dasharray="3 2"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%"><line x1="6" y1="${Y(0)}" x2="${W - 6}" y2="${Y(0)}" stroke="#6f7e8d" stroke-dasharray="8 3 2 3"/>${zr}<path d="${d}" fill="rgba(75,139,255,.18)" stroke="#6ea2ff" stroke-width="1.6"/><text x="${W - 10}" y="12" fill="#3ecf8e" font-size="10" text-anchor="end">ön alın (Z0)</text><text x="10" y="12" fill="#a7b4c2" font-size="10">L ${+L.toFixed(2)} · arka</text></svg>`;
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
