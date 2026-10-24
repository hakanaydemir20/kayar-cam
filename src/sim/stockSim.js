// Stok simülasyonu: silindirik yükseklik haritası r(d, θ) + eksenel delik profili rin(d).
// d = parça ön alnından mesafe (mm). θ parça çerçevesinde açı (0 = +y, artış +z yönüne).
// Yorumlanmış G-kod hareketleri zaman sırasında uygulanır; G0 ile malzemeye temas çarpışma sayılır.
import { movePoint } from './interpreter.js';

const DEG = Math.PI / 180;

export class Stock {
  constructor({ dMin, dMax, dz = 0.05, nth = 120, R }) {
    this.dMin = dMin; this.dz = dz; this.nth = nth; this.R = R;
    this.nz = Math.round((dMax - dMin) / dz) + 1;
    this.r = new Float32Array(this.nz * nth).fill(R);
    this.rin = new Float32Array(this.nz).fill(0);
    this.rowMax = new Float32Array(this.nz).fill(R);   // satır başına en büyük r (hızlı eleme)
    this.version = 0;
    this.rowVersion = new Uint32Array(this.nz);         // satır değişim damgası (görüntü güncellemesi için)
  }
  /** yerinde sıfırla (görüntü ağları aynı nesneyi kullanmaya devam eder) */
  reinit() {
    this.r.fill(this.R); this.rin.fill(0); this.rowMax.fill(this.R);
    this.version++; this.rowVersion.fill(this.version);
  }
  get dMax() { return this.dMin + (this.nz - 1) * this.dz; }
  dAt(i) { return this.dMin + i * this.dz; }
  idx(d) { return Math.round((d - this.dMin) / this.dz); }
  clone() {
    const s = Object.create(Stock.prototype);
    Object.assign(s, this);
    s.r = this.r.slice(); s.rin = this.rin.slice(); s.rowMax = this.rowMax.slice(); s.rowVersion = this.rowVersion.slice();
    return s;
  }
  copyFrom(o) { this.r.set(o.r); this.rin.set(o.rin); this.rowMax.set(o.rowMax); this.version++; }
  maxR(i) { return this.rowMax[i]; }
  recomputeRow(i) { let m = 0; const o = i * this.nth; for (let j = 0; j < this.nth; j++) if (this.r[o + j] > m) m = this.r[o + j]; this.rowMax[i] = m; }
  resetRows() { for (let i = 0; i < this.nz; i++) this.recomputeRow(i); }
  markDirty(i0, i1) {
    this.version++;
    for (let i = Math.max(0, i0); i <= Math.min(this.nz - 1, i1); i++) this.rowVersion[i] = this.version;
  }

  /** Dönen iş milinde: her d için tüm θ'yu cap değerine indir. cap: Map/array (index → r) */
  applyRotCap(i0, i1, cap, collide) {
    let removed = 0;
    for (let i = Math.max(0, i0); i <= Math.min(this.nz - 1, i1); i++) {
      const c = cap[i - i0];
      if (!(c < Infinity)) continue;
      if (this.rowMax[i] <= c + 1e-4) continue;
      const o = i * this.nth;
      for (let j = 0; j < this.nth; j++) {
        if (this.r[o + j] > c + 1e-4) {
          if (this.r[o + j] > this.rin[i] + 1e-4) removed = Math.max(removed, this.r[o + j] - Math.max(c, 0));
          this.r[o + j] = Math.max(c, 0);
        }
      }
      this.rowMax[i] = Math.min(this.rowMax[i], Math.max(c, 0));
    }
    if (removed > 0) this.markDirty(i0, i1);
    return removed;
  }
  /** Eksenel delik: rin(d) = max(rin, f(d)) */
  applyInner(i0, i1, fn) {
    let removed = 0;
    for (let i = Math.max(0, i0); i <= Math.min(this.nz - 1, i1); i++) {
      const v = fn(this.dAt(i));
      if (v > this.rin[i] + 1e-4) {
        if (this.maxR(i) > this.rin[i] + 1e-4) removed = Math.max(removed, Math.min(v, this.maxR(i)) - this.rin[i]);
        this.rin[i] = v;
      }
    }
    if (removed > 0) this.markDirty(i0, i1);
    return removed;
  }
  /** Radyal tahrikli takım (part açısı phi, radyan). bottom(rho) → takım alt yüzeyinin eksenden yüksekliği */
  applyRadial(phi, h, s0, z0, Rt, bottomSlope) {
    let removed = 0;
    const i0 = Math.max(0, this.idx(z0 - Rt)), i1 = Math.min(this.nz - 1, this.idx(z0 + Rt));
    const dth = 2 * Math.PI / this.nth;
    // hızlı eleme: takım alt noktası bu satırlardaki en büyük yarıçapın üstündeyse kesim yok
    let mx = 0;
    for (let i = i0; i <= i1; i++) if (this.rowMax[i] > mx) mx = this.rowMax[i];
    if (h >= mx - 1e-4) return 0;
    // açısal pencere: |r sinΔ| ≤ |s0| + Rt ve r cosΔ > h
    let half = Math.PI / 2;
    if (h > 0.05) half = Math.min(Math.PI / 2, Math.asin(Math.min(1, (Math.abs(s0) + Rt) / h)) + 2 * dth);
    const jc = Math.round(phi / dth), jw = Math.ceil(half / dth);
    for (let i = i0; i <= i1; i++) {
      const dd = this.dAt(i) - z0;
      if (Math.abs(dd) > Rt) continue;
      if (this.rowMax[i] <= h) continue;
      const o = i * this.nth;
      let touched = false;
      for (let q = -jw; q <= jw; q++) {
        const j = ((jc + q) % this.nth + this.nth) % this.nth;
        let D = j * dth - phi;
        D = Math.atan2(Math.sin(D), Math.cos(D));
        const cs = Math.cos(D);
        if (cs <= 0.02) continue;
        const r = this.r[o + j];
        const s = r * Math.sin(D);
        const rho2 = (s - s0) ** 2 + dd * dd;
        if (rho2 > Rt * Rt) continue;
        const hb = h + Math.sqrt(rho2) * bottomSlope;
        if (r * cs > hb + 1e-4) {
          const nr = Math.max(0, hb / cs);
          removed = Math.max(removed, r - nr);
          this.r[o + j] = nr;
          touched = true;
        }
      }
      if (touched) this.recomputeRow(i);
    }
    if (removed > 0) this.markDirty(i0, i1);
    return removed;
  }
}

// ---- takım kesme profilleri (dönen iş mili) ----
function turnLower(tool, rp, zp) {
  const rn = Math.max(tool.noseR || 0, 0.01);
  const cr = rp + rn, cz = zp - rn;
  const beta = (tool.backAngle ?? Math.max(5, 180 - 93 - (tool.insertAngle || 35))) * DEG;
  const ut = -rn * Math.sin(beta), ht = cr - rn * Math.cos(beta), tb = Math.tan(beta);
  return {
    d0: cz - 6, d1: cz + rn,
    f(d) {
      const u = d - cz;
      if (u > rn) return Infinity;
      if (u >= ut) return cr - Math.sqrt(Math.max(0, rn * rn - u * u));
      return ht + (ut - u) * tb;
    },
  };
}
function bladeLower(tool, rp, zp) {
  const w = tool.width || 2;
  return { d0: zp, d1: zp + w, f: () => rp };
}
function threadLower(tool, rp, zp) {
  return { d0: zp - 1.2, d1: zp + 1.2, f: (d) => rp + Math.abs(d - zp) / Math.tan(30 * DEG) };
}
function shapeFor(tool) {
  if (tool.type === 'turn') return turnLower;
  if (tool.type === 'groove' || tool.type === 'cutoff') return bladeLower;
  if (tool.type === 'thread') return threadLower;
  return null;
}

/**
 * Simülasyon motoru. step(t) ile zamanda ileri gider.
 */
export class StockSim {
  constructor(project, sim) {
    this.project = project;
    this.sim = sim;
    const L = project.part.length;
    this.L = L;
    const cut = project.tools.find(t => t.type === 'cutoff');
    this.cutW = cut ? cut.width : 2;
    this.opts = { dMin: -(project.stock.faceStock + 1), dMax: L + this.cutW + 12, dz: 0.05, nth: 120, R: project.stock.barDia / 2 };
    this.moves = [];
    for (const p of sim.paths) for (const m of p.moves) this.moves.push(m);
    this.moves.sort((a, b) => a.t0 - b.t0 || a.path - b.path);
    this.totalTime = Math.max(0, ...sim.paths.map(p => p.totalTime || 0));
    this.reset();
  }
  reset() {
    if (this.stock) this.stock.reinit(); else this.stock = new Stock(this.opts);
    // çubuk ön alnının önünde malzeme yok
    const S = this.stock, fs = this.project.stock.faceStock;
    for (let i = 0; i < S.nz; i++) if (S.dAt(i) < -fs - 1e-6) { S.r.fill(0, i * S.nth, (i + 1) * S.nth); S.rowMax[i] = 0; }
    S.markDirty(0, S.nz - 1);
    this.mi = 0; this.t = 0; this.pending = [];
    this.state = { mainOpen: false, frontWorld: null, barOffset: 0, z1: -1, subClosed: false, separated: false, attached: 'main', mainC: 0, subC: 0 };
    this.collisions = [];
    this.events = [];
  }
  /** t zamanına kadar ilerle (geri gidilirse baştan). Başlamış ama bitmemiş hareketler ayrı tutulur. */
  seek(t) {
    if (t < this.t - 1e-9) this.reset();
    const frac = (m) => (m.t1 > m.t0 ? Math.min(1, (t - m.t0) / (m.t1 - m.t0)) : 1);
    // önce yarım kalanlar (zaman sırasıyla)
    const still = [];
    for (const it of this.pending) {
      const f = frac(it.m);
      if (f > it.f) { this.applyMove(it.m, it.f, f); it.f = f; }
      if (it.f < 1) still.push(it);
    }
    this.pending = still;
    while (this.mi < this.moves.length && (this.moves[this.mi].t0 < t || (this.moves[this.mi].t0 <= t && this.moves[this.mi].t1 <= t))) {
      const m = this.moves[this.mi++];
      const f = frac(m);
      this.applyMove(m, 0, f);
      if (f < 1) this.pending.push({ m, f });
    }
    this.t = t;
  }
  runAll() { this.seek(Infinity); return this; }
  /** kanal için t anındaki hareket (ikili arama) */
  currentMove(path, t = this.t) {
    const ms = this.sim.paths[path - 1]?.moves;
    if (!ms || !ms.length) return null;
    let lo = 0, hi = ms.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ms[mid].t0 <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    // aynı t0'lı sıfır süreli olaylarda sonuncusunu al
    return ms[best];
  }

  applyMove(m, fa, fb) {
    const st = this.state;
    if (m.kind === 'event') {
      if (fb < 1) return;
      switch (m.event) {
        case 'mainChuckOpen': st.frontWorld = this.mainFrontWorld(m.mTo.Z); st.mainOpen = true; break;
        case 'mainChuckClose': st.mainOpen = false; st.barOffset = st.frontWorld - m.mTo.Z; break;
        case 'subChuckClose': st.subClosed = true; this.checkSeparation(); break;
        case 'subChuckOpen': st.subClosed = false; if (st.attached === 'sub') { st.attached = 'ejected'; this.events.push({ t: m.t1, type: 'eject' }); } break;
        case 'partEject': if (st.attached === 'sub') st.attached = 'ejected'; break;
      }
      return;
    }
    if (m.path === 1 && m.mTo) st.z1 = m.mTo.Z;
    if (m.kind === 'wait' || m.kind === 'dwell') return;
    const tool = m.state.tool;
    if (!tool) return;
    // gang takımlarında ızgaradan (0.05) ince adım: V/burun profili ayrıklaştırma hatası < 0.01 mm
    const stepLen = m.path === 1 && tool.unit === 'gang' ? (tool.type === 'thread' ? 0.005 : 0.0125) : tool.unit === 'cross' ? 0.06 : 0.04;
    const steps = Math.max(1, Math.ceil(moveLen(m) * (fb - fa) / stepLen));
    let maxRemoved = 0;
    if (m.path === 1 && tool.unit === 'gang') {
      maxRemoved = this.gangSweep(m, tool, fa, fb, steps);
    } else for (let k = 1; k <= steps; k++) {
      const t = fa + (fb - fa) * k / steps;
      const p = movePoint(m, t);
      const mp = m.mFrom && m.mTo ? lerpM(m.mFrom, m.mTo, t) : p;
      const removed = this.cutAt(m, tool, p, mp, k === 1 ? movePoint(m, fa) : null);
      if (removed > maxRemoved) maxRemoved = removed;
    }
    if (m.kind === 'rapid' && maxRemoved > 0.02) {
      if (!this.collisions.some(c => c.path === m.path && c.line === m.line)) {
        this.collisions.push({ path: m.path, line: m.line, msg: `G0 hızlı hareketle malzemeye temas (${maxRemoved.toFixed(2)} mm) — ${tool.name}`, t: m.t0 });
      }
    }
    if (tool.type === 'cutoff') this.checkSeparation();
  }

  /** Gang tornalama takımı: hareket boyunca alt sınırı biriktir, tek seferde uygula */
  gangSweep(m, tool, fa, fb, steps) {
    const S = this.stock, shape = shapeFor(tool);
    if (!shape) return 0;
    if (!this.capBuf || this.capBuf.length !== S.nz) this.capBuf = new Float32Array(S.nz);
    const cap = this.capBuf;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k <= steps; k++) {
      const t = fa + (fb - fa) * k / steps;
      const p = movePoint(m, t);
      const mp = lerpM(m.mFrom, m.mTo, t);
      const sh = shape(tool, p.X / 2, this.mainFrontWorld(mp.Z));
      const i0 = Math.max(0, S.idx(sh.d0)), i1 = Math.min(S.nz - 1, S.idx(sh.d1));
      if (i0 > i1) continue;
      if (lo > hi) { for (let i = i0; i <= i1; i++) cap[i] = Infinity; lo = i0; hi = i1; }
      else {
        if (i0 < lo) { for (let i = i0; i < lo; i++) cap[i] = Infinity; lo = i0; }
        if (i1 > hi) { for (let i = hi + 1; i <= i1; i++) cap[i] = Infinity; hi = i1; }
      }
      for (let i = i0; i <= i1; i++) { const v = sh.f(S.dAt(i)); if (v < cap[i]) cap[i] = v; }
    }
    if (!(lo <= hi)) return 0;
    const spinning = m.state.main.dir !== 'stop' && !m.state.cAxis;
    const sub = cap.subarray(lo, hi + 1);
    return spinning ? S.applyRotCap(lo, hi, sub) : this.capCheckOnly(lo, hi, sub);
  }

  mainFrontWorld(z1) { return this.state.mainOpen ? this.state.frontWorld : z1 + this.state.barOffset; }

  cutAt(m, tool, p, mp) {
    const st = this.state, S = this.stock;
    if (m.path === 1) {
      if (st.attached !== 'main' && st.separated && tool.type !== 'cutoff') {
        // parça ayrıldı: kalan çubuk (d > L+w) yalnızca
      }
      const d = this.mainFrontWorld(mp.Z); // takım ucu dünya x=0 → parça çerçevesinde d
      const rp = p.X / 2;
      const spinning = m.state.main.dir !== 'stop' && !m.state.cAxis;
      if (tool.unit === 'gang') {
        const shape = shapeFor(tool);
        if (!shape) return 0;
        const sh = shape(tool, rp, d);
        const i0 = S.idx(sh.d0), i1 = S.idx(sh.d1);
        const cap = new Array(i1 - i0 + 1);
        for (let i = i0; i <= i1; i++) cap[i - i0] = sh.f(S.dAt(i));
        if (!spinning) return this.capCheckOnly(i0, i1, cap);
        return S.applyRotCap(i0, i1, cap);
      }
      if (tool.unit === 'front') {
        // eksenel takım: uç d konumunda, eksende (X≈0)
        if (Math.abs(p.X) > 0.05 || Math.abs(p.Y) > 0.05) {
          // eksen dışında: dış yüzeye çarpma kontrolü
          return this.axialOffCenter(tool, d, p);
        }
        return S.applyInner(S.idx(-10), S.idx(d), innerFn(tool, d));
      }
      if (tool.unit === 'cross') {
        const phi = -(mp.C || 0) * DEG;
        const slope = tool.type === 'ldrill' ? 1 / Math.tan(((tool.tipAngle || 118) / 2) * DEG) : 0;
        return S.applyRadial(phi, p.X / 2, p.Y, d, tool.dia / 2, slope);
      }
      return 0;
    }
    // ---- kanal 2: karşı iş milindeki parça ----
    if (st.attached !== 'sub' || m.state.wo !== 'G55') return 0;
    const db = this.L - p.Z; // arka alından derinlik → ön çerçeve
    if (tool.unit === 'back' || tool.unit === 'rear') {
      if (tool.type === 'drill' || tool.type === 'center' || tool.type === 'tap') {
        if (Math.abs(p.X) > 0.05) return 0;
        return S.applyInner(S.idx(db), S.idx(this.L + 1), innerFnBack(tool, db));
      }
    }
    return 0;
  }

  capCheckOnly(i0, i1, cap) {
    // iş mili dururken tornalama takımı malzemeye değerse çarpışma
    const S = this.stock;
    let worst = 0;
    for (let i = Math.max(0, i0); i <= Math.min(S.nz - 1, i1); i++) {
      const c = cap[i - i0];
      if (c < S.maxR(i) - 0.02 && S.maxR(i) > S.rin[i]) worst = Math.max(worst, S.maxR(i) - c);
    }
    return worst;
  }
  axialOffCenter(tool, d, p) {
    const S = this.stock, i = S.idx(d);
    if (i < 0 || i >= S.nz) return 0;
    const reach = Math.hypot(p.X / 2, p.Y) - tool.dia / 2;
    const mr = S.maxR(i);
    return mr > S.rin[i] + 1e-3 && mr > reach + 0.02 ? mr - Math.max(reach, S.rin[i]) : 0;
  }
  checkSeparation() {
    const st = this.state;
    if (st.separated) { if (st.subClosed && st.attached === 'main') st.attached = 'sub'; return; }
    const S = this.stock;
    const i0 = S.idx(this.L + 0.05), i1 = S.idx(this.L + this.cutW - 0.05);
    for (let i = i0; i <= i1; i++) if (S.maxR(i) > Math.max(0.15, S.rin[i] + 0.01)) {
      // en az bir dilim tam kesildiyse yeterli
      let full = false;
      for (let k = i0; k <= i1; k++) if (S.maxR(k) <= Math.max(0.15, S.rin[k] + 0.01)) { full = true; break; }
      if (!full) return;
      break;
    }
    st.separated = true;
    st.attached = st.subClosed ? 'sub' : 'dropped';
    this.events.push({ t: this.t, type: st.attached === 'sub' ? 'pick' : 'drop' });
  }
}

function innerFn(tool, dTip) {
  const R = (tool.type === 'tap' ? tool.dia - tool.pitch : tool.dia) / 2;
  const half = ((tool.type === 'tap' ? 118 : tool.tipAngle || 118) / 2) * DEG;
  return (d) => (d > dTip ? 0 : Math.min(R, (dTip - d) * Math.tan(half)));
}
function innerFnBack(tool, dTip) {
  const R = (tool.type === 'tap' ? tool.dia - tool.pitch : tool.dia) / 2;
  const half = ((tool.type === 'tap' ? 118 : tool.tipAngle || 118) / 2) * DEG;
  return (d) => (d < dTip ? 0 : Math.min(R, (d - dTip) * Math.tan(half)));
}
function moveLen(m) {
  if (m.kind === 'arc') return m.arc.length;
  const a = m.from, b = m.to;
  return Math.hypot((b.X - a.X) / 2, (b.Y || 0) - (a.Y || 0), b.Z - a.Z) + Math.abs((b.C || 0) - (a.C || 0)) * 0.05;
}
function lerpM(a, b, t) {
  return { X: a.X + (b.X - a.X) * t, Y: a.Y + (b.Y - a.Y) * t, Z: a.Z + (b.Z - a.Z) * t, C: a.C + (b.C - a.C) * t };
}

// ---- hedef (ideal parça) ve karşılaştırma ----
/** Profil + özelliklerden ideal hedef ızgarası */
export function buildTarget(project, opts) {
  const T = new Stock(opts);
  const prof = project.part.profile;
  // profil örnekle
  const L = project.part.length;
  for (let i = 0; i < T.nz; i++) {
    const d = T.dAt(i);
    let r = 0;
    if (d >= 0 && d <= L) r = profileR(prof, d);
    else r = -1; // parça dışı
    const o = i * T.nth;
    for (let j = 0; j < T.nth; j++) T.r[o + j] = r;
  }
  T.lowAllowed = new Float32Array(T.nz).fill(NaN);   // diş bölgesi: izin verilen alt sınır
  T.innerFree = new Uint8Array(T.nz);                  // delik giriş pahı / matkap ucu konisi
  for (const f of project.part.features) {
    if (f.type === 'thread') {
      const minor = f.dia / 2 - 0.6134 * f.pitch - 0.01;
      for (let i = T.idx(f.z0 - 1.5 * f.pitch); i <= T.idx(f.z1 + 0.5); i++) if (i >= 0 && i < T.nz) T.lowAllowed[i] = minor;
    } else if (f.type === 'axialHole') {
      const R = f.dia / 2;
      const cone = R / Math.tan(59 * Math.PI / 180);
      for (let i = 0; i < T.nz; i++) {
        const d = T.dAt(i);
        const inHole = f.side === 'front' ? d >= 0 && d <= f.depth : d <= L && d >= L - f.depth;
        if (inHole) T.rin[i] = Math.max(T.rin[i], R);
        const fromEnd = f.side === 'front' ? d : L - d;
        if (fromEnd >= -0.1 && fromEnd <= 0.6) T.innerFree[i] = 1;                       // giriş pahı
        if (fromEnd > f.depth && fromEnd <= f.depth + cone + 0.1) T.innerFree[i] = 1;      // uç konisi
      }
    } else if (f.type === 'crossHole') {
      const phi = -f.c * DEG;
      const Rl = profileR(prof, f.z);
      const h = f.through ? -Rl : f.depthDia != null ? f.depthDia / 2 : Rl - f.depth;
      T.applyRadial(phi, h, 0, f.z, f.dia / 2, 0);
      if (f.through) T.applyRadial(phi + Math.PI, -Rl, 0, f.z, f.dia / 2, 0);
    } else if (f.type === 'flat') {
      const phi = -f.c * DEG;
      let Rl = 0;
      for (let z = f.z0; z <= f.z1; z += 0.05) Rl = Math.max(Rl, profileR(prof, z));
      const h = Rl - f.depth;
      for (let i = T.idx(f.z0); i <= T.idx(f.z1); i++) {
        const o = i * T.nth;
        for (let j = 0; j < T.nth; j++) {
          let D = j * 2 * Math.PI / T.nth - phi; D = Math.atan2(Math.sin(D), Math.cos(D));
          const cs = Math.cos(D);
          if (cs > 0.02 && T.r[o + j] * cs > h) T.r[o + j] = h / cs;
        }
      }
    } else if (f.type === 'pocket') {
      const phi = -f.c * DEG;
      const Rl = profileR(prof, f.z);
      T.applyRadial(phi, Rl - f.depth, 0, f.z, f.dia / 2, 0);
    }
  }
  return T;
}

export function profileR(pts, d) {
  let r = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z);
    if (d < lo - 1e-9 || d > hi + 1e-9) continue;
    const v = Math.abs(b.z - a.z) < 1e-12 ? Math.max(a.r, b.r) : a.r + (b.r - a.r) * (d - a.z) / (b.z - a.z);
    if (v > r) r = v;
  }
  return r;
}

/**
 * Simüle edilen stok ile hedefi karşılaştır. Dönüş: hücre başına durum (0 tamam, 1 fazla kesim, 2 kalan) ve özet
 */
export function compare(stock, target, L, tolOver = 0.02, tolUnder = 0.03) {
  const n = stock.nz * stock.nth;
  const status = new Uint8Array(n);
  let over = 0, under = 0, overMax = 0, underMax = 0, cells = 0;
  const nb = (arr, i, j) => {
    // ±1 dilim komşulukta min/max (ızgara ayrıklaştırma toleransı)
    let mn = Infinity, mx = -Infinity;
    for (let di = -1; di <= 1; di++) {
      const ii = i + di;
      if (ii < 0 || ii >= stock.nz) continue;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = (j + dj + stock.nth) % stock.nth;
        const v = arr[ii * stock.nth + jj];
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
    }
    return [mn, mx];
  };
  for (let i = 0; i < stock.nz; i++) {
    const d = stock.dAt(i);
    if (d < 0.05 || d > L - 0.05) continue;
    for (let j = 0; j < stock.nth; j++) {
      const k = i * stock.nth + j;
      const s = stock.r[k], t = target.r[k];
      if (t < 0) continue;
      cells++;
      const [tmn0, tmx] = nb(target.r, i, j);
      const low = target.lowAllowed ? target.lowAllowed[i] : NaN;
      const tmn = Number.isNaN(low) ? tmn0 : Math.min(tmn0, low);
      if (s < tmn - tolOver) { status[k] = 1; over++; overMax = Math.max(overMax, tmn - s); }
      else if (s > tmx + tolUnder) { status[k] = 2; under++; underMax = Math.max(underMax, s - tmx); }
    }
  }
  // iç delik
  let innerOver = 0, innerUnder = 0;
  for (let i = 0; i < stock.nz; i++) {
    const d = stock.dAt(i);
    if (d < 0.1 || d > L - 0.1) continue;
    if (target.innerFree && target.innerFree[i]) continue;
    const s = stock.rin[i], t = target.rin[i];
    const tn = Math.min(target.rin[Math.max(0, i - 2)], target.rin[Math.min(stock.nz - 1, i + 2)], t);
    const tx = Math.max(target.rin[Math.max(0, i - 2)], target.rin[Math.min(stock.nz - 1, i + 2)], t);
    if (s > tx + tolOver) innerOver++;
    else if (s < tn - tolUnder && t > 0) innerUnder++;
  }
  return { status, over, under, overMax, underMax, cells, innerOver, innerUnder };
}
