// 2D simülasyon penceresi (torna XZ kesiti): yatay = parça ekseni (dünya x = −d, sağ = karşı iş mili),
// dikey = yarıçap (X/2, üst yarı gerçek, alt yarı ayna). Stok, hedef profil, takım yolları ve aktif takım çizilir.
import { movePoint } from '../sim/interpreter.js';
import { LAYOUT } from '../sim/frames.js';
import { insertOutline } from '../tools/toolLibrary.js';

const COL = { rapid: '#f59e0b', feed: '#38bdf8', arc: '#a78bfa', thread: '#34d399', stock: '#8a99a8', target: '#3ecf8e', tool: '#f472b6', back: '#c084fc' };

/** Program konumundan parça çerçevesi (wx = −d, y = yarıçap) */
export function partXY(ch, p, st, project) {
  if (!p || !st) return null;
  const zs = project.zero?.zShift || 0, L = project.part.length;
  if (ch === 1) return { x: -(p.Z + zs), y: p.X / 2 };
  if (st.wo === 'G55') return { x: -(L - p.Z), y: p.X / 2 };
  return null;   // $2 G54: transfer çerçevesi (karşı iş mili alnı ayrıca çizilir)
}

export class Plot2D {
  constructor(container) {
    this.container = container;
    this.cv = document.createElement('canvas');
    this.cv.className = 'plot2d';
    container.append(this.cv);
    this.g = this.cv.getContext('2d');
    this.view = null;            // {cx, cy, s} dünya merkezi + px/mm
    this.visible = false;
    let drag = null;
    this.cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy }; this.cv.setPointerCapture(e.pointerId); });
    this.cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.view.cx = drag.cx - (e.clientX - drag.x) / this.view.s;
      this.view.cy = drag.cy + (e.clientY - drag.y) / this.view.s;
      this.dirty = true;
    });
    this.cv.addEventListener('pointerup', () => { drag = null; });
    this.cv.addEventListener('dblclick', () => this.fit());
    this.cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.cv.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * 0.0015);
      const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.view.s *= k;
      this.view.cx = wx - (wx - this.view.cx) / k;
      this.view.cy = wy - (wy - this.view.cy) / k;
      this.dirty = true;
    }, { passive: false });
    new ResizeObserver(() => { this.resize(); this.dirty = true; }).observe(container);
    this.resize();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !h) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.cv.width = w * dpr; this.cv.height = h * dpr;
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    if (!this.view && this.project) this.fit();
  }
  setVisible(on) { this.visible = on; this.cv.style.display = on ? 'block' : 'none'; if (on) { this.resize(); this.dirty = true; } }
  toScreen(x, y) { return [this.w / 2 + (x - this.view.cx) * this.view.s, this.h / 2 - (y - this.view.cy) * this.view.s]; }
  toWorld(sx, sy) { return [this.view.cx + (sx - this.w / 2) / this.view.s, this.view.cy - (sy - this.h / 2) / this.view.s]; }
  fit() {
    if (!this.project || !this.w) return;
    const L = this.project.part.length, R = this.project.stock.barDia / 2;
    const x0 = -L - 8, x1 = 14, y0 = -R - 6, y1 = R + 14;
    const s = Math.min(this.w / (x1 - x0), this.h / (y1 - y0)) * 0.88;
    this.view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + 2, s };
    this.dirty = true;
  }

  /** Yeni simülasyon: takım yollarını parça çerçevesinde önceden hesapla */
  setData(project, sim, stockSim) {
    const first = !this.project;
    this.project = project; this.sim = sim; this.stockSim = stockSim;
    this.paths = [];
    sim?.paths.forEach((p, pi) => {
      for (const m of p.moves) {
        if (m.kind !== 'rapid' && m.kind !== 'feed' && m.kind !== 'arc' && m.kind !== 'thread') continue;
        const n = m.kind === 'arc' ? 16 : 1, pts = [];
        for (let k = 0; k <= n; k++) { const q = partXY(pi + 1, k === 0 ? m.from : k === n ? m.to : movePoint(m, k / n), m.state, project); if (q) pts.push(q); }
        if (pts.length > 1) this.paths.push({ kind: m.kind, ch: pi + 1, line: m.line, t0: m.t0, pts });
      }
    });
    if (first || !this.view) this.fit();
    this.dirty = true;
  }

  /** t anındaki durumu çiz (yalnız görünürken) */
  draw(app) {
    if (!this.visible || !this.view || !this.project) return;
    const g = this.g, P = this.project, ss = this.stockSim, M = app.machine;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#0f1419'; g.fillRect(0, 0, this.w, this.h);
    this.grid();
    const S = (x, y) => this.toScreen(x, y);
    const st = ss?.state;
    const onSub = st && (st.attached === 'sub' || st.attached === 'ejected');
    const front = M ? ss.mainFrontWorld(M.pose1.m.Z) : 0;
    // kılavuz burç ve karşı iş mili (parça çerçevesine göre)
    const R = P.stock.barDia / 2;
    if (M && !onSub) {
      const bx = LAYOUT.bushFace - front;
      this.rect(bx - 22, R + 0.3, bx, R + 9, '#2b3540', '#4a5a6a'); this.rect(bx - 22, -R - 9, bx, -R - 0.3, '#2b3540', '#4a5a6a');
      this.label('Burç', bx - 11, R + 12, '#6c7a88');
    }
    if (M && P.ops.some(o => o.type === 'pickoff' && o.enabled)) {
      const grip = ss.sim.frames ? ss.L - ss.sim.frames.projection : 5;
      const sx = onSub ? -(ss.L - grip) : M.pose2.m.Z - front;      // karşı iş mili alnı
      const nr = (P.machine.subSpindle?.nutDia || 30) / 2;
      if (sx < 400) {
        this.rect(sx, R + 0.4, sx + 26, nr, '#3a3550', '#6b5fa0'); this.rect(sx, -nr, sx + 26, -R - 0.4, '#3a3550', '#6b5fa0');
        this.label('Karşı mil', sx + 13, nr + 3, '#8b80c0');
      }
    }
    // stok (kesit siluet + iç delik)
    if (ss) {
      const K = ss.stock, lim = st.separated && !onSub ? null : null;
      const dMaxDraw = st.separated ? ss.L + (ss.bs || 0) + 0.01 : K.dMax;
      g.beginPath();
      let started = false;
      for (let i = 0; i < K.nz; i++) {
        const d = K.dAt(i); if (d > dMaxDraw) break;
        const r = K.rowMax[i]; const [x, y] = S(-d, r);
        if (!started) { const [x0, y0] = S(-d, 0); g.moveTo(x0, y0); started = true; }
        g.lineTo(x, y);
      }
      for (let i = Math.min(K.nz - 1, K.idx(dMaxDraw)); i >= 0; i--) { const d = K.dAt(i); const [x, y] = S(-d, -K.rowMax[i]); g.lineTo(x, y); }
      g.closePath();
      g.fillStyle = onSub || st.attached === 'main' ? 'rgba(138,153,168,.42)' : 'rgba(138,153,168,.2)';
      g.fill(); g.strokeStyle = COL.stock; g.lineWidth = 1; g.stroke();
      void lim;
      // iç delik
      g.fillStyle = '#0f1419';
      for (let i = 0; i < K.nz; i++) {
        const ri = K.rin[i]; if (ri <= 0) continue;
        const d = K.dAt(i); if (d > dMaxDraw) break;
        const [x, y] = S(-d, ri), [, y2] = S(-d, -ri);
        g.fillRect(x - Math.max(1, K.dz * this.view.s) / 2, y, Math.max(1, K.dz * this.view.s) + 0.5, y2 - y);
      }
    }
    // hedef profil (kesikli yeşil)
    if (app.ghostOn !== false) {
      g.setLineDash([4, 3]); g.strokeStyle = COL.target; g.lineWidth = 1;
      for (const sgn of [1, -1]) {
        g.beginPath();
        P.part.profile.forEach((p, i) => { const [x, y] = S(-p.z, sgn * p.r); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      }
      g.setLineDash([]);
    }
    // eksen + referans
    g.strokeStyle = 'rgba(147,161,175,.5)'; g.setLineDash([10, 4, 2, 4]);
    g.beginPath(); { const [a, y] = S(-P.part.length - 30, 0); const [b] = S(60, 0); g.moveTo(a, y); g.lineTo(b, y); } g.stroke(); g.setLineDash([]);
    const zs = P.zero?.zShift || 0;
    { const [x, y] = S(-zs, 0); g.strokeStyle = '#3b82f6'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 26, y); g.moveTo(x, y); g.lineTo(x, y - 26); g.stroke();
      g.fillStyle = '#60a5fa'; g.font = '600 11px Segoe UI, sans-serif'; g.fillText('Z+', x - 42, y + 4); g.fillStyle = '#f26d6d'; g.fillText('X+', x - 6, y - 30); g.fillStyle = '#93a1af'; g.fillText('Z0 X0', x + 4, y + 14); }
    // takım yolları
    const mode = app.pathMode || 'all';
    if (mode !== 'none') {
      const li = app.result?.posted?.lineInfo || [];
      const act = new Set([li[0]?.[M?.m1?.line]?.opId, li[1]?.[M?.m2?.line]?.opId].filter(Boolean));
      const selId = app.sel?.kind === 'op' ? app.sel.id : null;
      const hidden = new Set(P.ops.filter(o => o.hidePath).map(o => o.id));
      g.lineWidth = 1.1;
      for (const p of this.paths) {
        const op = li[p.ch - 1]?.[p.line]?.opId;
        if (op && hidden.has(op)) continue;
        if (mode === 'op' && !act.has(op)) continue;
        if (mode === 'sel' && op !== selId) continue;
        const done = p.t0 <= app.t;
        g.strokeStyle = p.ch === 2 && p.kind !== 'rapid' ? COL.back : COL[p.kind];
        g.globalAlpha = done ? 0.95 : 0.35;
        if (p.kind === 'rapid') g.setLineDash([5, 4]);
        g.beginPath(); p.pts.forEach((q, i) => { const [x, y] = S(q.x, q.y); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
    }
    // aktif takımlar
    if (M) {
      for (const ch of [1, 2]) {
        const mv = ch === 1 ? M.m1 : M.m2, pose = ch === 1 ? M.pose1 : M.pose2;
        const t = mv?.state?.tool; if (!t) continue;
        const q = partXY(ch, pose.p, mv.state, P); if (!q) continue;
        this.tool(t, q, ch);
      }
    }
    this.dirty = false;
  }

  grid() {
    const g = this.g, s = this.view.s;
    const step = [0.5, 1, 2, 5, 10, 20, 50, 100].find(v => v * s > 46) || 100;
    const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(this.w, this.h);
    g.lineWidth = 1; g.font = '10px Cascadia Mono, Consolas, monospace';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen(x, 0); g.strokeStyle = 'rgba(255,255,255,.045)'; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, this.h); g.stroke();
      g.fillStyle = '#4b5866'; g.fillText((-x).toFixed(step < 1 ? 1 : 0), sx + 2, this.h - 4);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = this.toScreen(0, y); g.strokeStyle = 'rgba(255,255,255,.045)'; g.beginPath(); g.moveTo(0, sy); g.lineTo(this.w, sy); g.stroke();
      g.fillStyle = '#4b5866'; g.fillText('Ø' + (2 * y).toFixed(step < 1 ? 1 : 0), 3, sy - 2);
    }
  }
  rect(x0, y0, x1, y1, fill, stroke) {
    const [a, b] = this.toScreen(x0, y1), [c, d] = this.toScreen(x1, y0);
    this.g.fillStyle = fill; this.g.fillRect(a, b, c - a, d - b);
    if (stroke) { this.g.strokeStyle = stroke; this.g.lineWidth = 1; this.g.strokeRect(a, b, c - a, d - b); }
  }
  label(txt, x, y, col) {
    const [sx, sy] = this.toScreen(x, y);
    this.g.fillStyle = col; this.g.font = '10.5px Segoe UI, sans-serif'; this.g.textAlign = 'center'; this.g.fillText(txt, sx, sy); this.g.textAlign = 'left';
  }
  /** Takım silueti: uç q noktasında */
  tool(t, q, ch) {
    const g = this.g, s = this.view.s;
    const [x, y] = this.toScreen(q.x, q.y);
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(244,114,182,.32)'; g.strokeStyle = COL.tool; g.lineWidth = 1.4 / s;
    const shape = (pts) => { g.beginPath(); pts.forEach(([a, b], i) => i ? g.lineTo(a, -b) : g.moveTo(a, -b)); g.closePath(); g.fill(); g.stroke(); };
    const d = t.dia || 4, w = t.width || 0;
    if (t.unit === 'front') shape([[0, -d / 2], [26, -d / 2], [26, d / 2], [0, d / 2]].map(([a, b], i) => t.type === 'drill' || t.type === 'center' ? (i === 0 ? [d * 0.28, -d / 2] : i === 3 ? [d * 0.28, d / 2] : [a, b]) : [a, b]).concat(t.type === 'drill' || t.type === 'center' ? [[0, 0]] : []));
    else if (ch === 2) shape([[0, -d / 2], [-26, -d / 2], [-26, d / 2], [0, d / 2]]);
    else if (t.unit === 'cross') shape([[-d / 2, 0], [d / 2, 0], [d / 2, 22], [-d / 2, 22]]);
    else if (w > 0) shape([[0, 0], [w, 0], [w, 12], [w + 2, 18], [-4, 18], [0, 12]].map(([a, b]) => [a - w, b]));   // kanal/kesme: sol kenar referans değil, uç sağ köşe
    else if (t.type === 'thread') shape([[0, 0], [1.4, 2.4], [1.4, 18], [-1.4, 18], [-1.4, 2.4]]);
    else {   // tornalama: ISO kesici uç + tutucu
      g.fillStyle = 'rgba(120,130,145,.35)'; shape([[1, 6], [13, 6], [13, 34], [1, 34]]);
      g.fillStyle = 'rgba(244,114,182,.45)'; shape(insertOutline(t, 6));
    }
    g.restore();
    g.fillStyle = COL.tool; g.font = '600 11px Segoe UI, sans-serif';
    g.fillText('T' + String(t.num).padStart(2, '0'), x + 8, y - 8);
  }
}
