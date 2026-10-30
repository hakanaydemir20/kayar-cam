// Stok ızgarasından (r(d,θ), rin(d)) üçgen ağı. Yerel koordinat: x = −d, y = r cosθ, z = r sinθ.
// Yalnızca değişen satırlar güncellenir; normaller analitik (sonlu fark) hesaplanır.
import * as THREE from 'three';
import { mat } from './materials.js';

// stok: ham çubuk (açık gri-bej) · parça: bitmiş ölçü (mavi) · fazla kesim (kırmızı)
const COL = { stock: [0.78, 0.75, 0.69], part: [0.27, 0.58, 0.95], over: [0.95, 0.24, 0.2] };

export class StockMesh {
  constructor(stock, i0, i1) {
    this.stock = stock; this.i0 = i0; this.i1 = i1;
    const nth = stock.nth, rows = i1 - i0 + 1, ring = nth + 1;
    this.ring = ring; this.rows = rows;
    const nOuter = rows * ring, nInner = rows * ring;
    this.nOuter = nOuter;
    const nv = nOuter + nInner + 4 * ring;
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 3).fill(1);
    const idx = [];
    const quad = (a, b, c, d) => idx.push(a, b, c, b, d, c);
    for (let r = 0; r < rows - 1; r++) for (let j = 0; j < nth; j++) {
      const a = r * ring + j, b = a + 1, c = a + ring, d = c + 1;
      quad(a, c, b, d);
      quad(nOuter + a, nOuter + b, nOuter + c, nOuter + d);
    }
    const capBase = nOuter + nInner;
    this.capBase = capBase;
    for (let j = 0; j < nth; j++) {
      const o0 = capBase + j, o1 = o0 + 1, n0 = capBase + ring + j, n1 = n0 + 1;
      quad(o0, o1, n0, n1);
      const b0 = capBase + 2 * ring + j, b1 = b0 + 1, m0 = capBase + 3 * ring + j, m1 = m0 + 1;
      quad(b0, m0, b1, m1);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3); this.aNrm.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('normal', this.aNrm);
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setIndex(idx);
    this.geometry = g;
    const m = mat('stock').clone();
    m.color.set(0xffffff);                 // renk tamamen köşe renginden (stok / parça / fazla kesim)
    m.vertexColors = true;
    m.side = THREE.DoubleSide;
    this.material = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.cos = new Float32Array(ring); this.sin = new Float32Array(ring);
    for (let j = 0; j < ring; j++) { const t = (j % nth) * 2 * Math.PI / nth; this.cos[j] = Math.cos(t); this.sin[j] = Math.sin(t); }
    // kenar çizgileri (kademe, alın, delik ve düzlük kenarları): yükseklik haritasındaki ani yarıçap değişimleri
    this.eg = new THREE.BufferGeometry();
    this.ePos = new Float32Array(6 * 4096);
    this.eg.setAttribute('position', new THREE.BufferAttribute(this.ePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.edges = new THREE.LineSegments(this.eg, new THREE.LineBasicMaterial({ color: 0x14191f, transparent: true, opacity: 0.8 }));
    this.edges.frustumCulled = false; this.edges.raycast = () => {};
    this.mesh.add(this.edges);
    this.lastVersion = -1;
    this.paintStock();
    this.update(true);
  }

  rr(i, j) { const S = this.stock; return Math.max(S.r[i * S.nth + (j % S.nth)], S.rin[i]); }

  update(force = false) {
    const S = this.stock;
    if (!force && S.version === this.lastVersion) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!force && now - (this._lastT || 0) < 40) return;
    this._lastT = now;
    const since = force ? -1 : this.lastVersion;
    this.lastVersion = S.version;
    const ring = this.ring, P = this.pos, nOuter = this.nOuter;
    let lo = Infinity, hi = -Infinity;
    for (let r = 0; r < this.rows; r++) {
      const i = this.i0 + r;
      if (S.rowVersion[i] <= since) continue;
      if (r < lo) lo = r;
      if (r > hi) hi = r;
      const x = -S.dAt(i), rin = S.rin[i];
      for (let j = 0; j < ring; j++) {
        const rr = this.rr(i, j);
        let k = (r * ring + j) * 3;
        P[k] = x; P[k + 1] = rr * this.cos[j]; P[k + 2] = rr * this.sin[j];
        k = (nOuter + r * ring + j) * 3;
        P[k] = x; P[k + 1] = rin * this.cos[j]; P[k + 2] = rin * this.sin[j];
      }
    }
    if (lo > hi) return;
    // normaller: değişen satırlar ve komşuları
    const a = Math.max(0, lo - 1), b = Math.min(this.rows - 1, hi + 1);
    this.computeNormals(a, b);
    this.updateCaps();
    if ((this.tgt || S.crash) && !this.statusOn) this.colorRows(lo, hi);
    if (this.edges.visible) this.buildEdges();
    // yalnız değişen aralığı GPU'ya gönder
    const s0 = a * ring * 3, c0 = (b - a + 1) * ring * 3;
    for (const attr of [this.aPos, this.aNrm]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(s0, c0);
      attr.addUpdateRange(nOuter * 3 + s0, c0);
      attr.addUpdateRange(this.capBase * 3, 4 * ring * 3);
      attr.needsUpdate = true;
    }
  }

  computeNormals(a, b) {
    const S = this.stock, ring = this.ring, N = this.nrm, nOuter = this.nOuter, nth = S.nth;
    const dz = S.dz, dth = 2 * Math.PI / nth;
    for (let r = a; r <= b; r++) {
      const i = this.i0 + r;
      const ip = this.i0 + Math.min(this.rows - 1, r + 1), im = this.i0 + Math.max(0, r - 1);
      const span = (ip - im) * dz || dz;
      for (let j = 0; j < ring; j++) {
        const c = this.cos[j], s = this.sin[j];
        const drdd = (this.rr(ip, j) - this.rr(im, j)) / span;
        const r0 = this.rr(i, j) || 1e-3;
        const drdt = (this.rr(i, j + 1) - this.rr(i, (j + nth - 1) % nth)) / (2 * dth);
        // P = (−d, r c, r s): ∂P/∂d = (−1, r' c, r' s), ∂P/∂θ = (0, r_t c − r s, r_t s + r c)
        const ux = -1, uy = drdd * c, uz = drdd * s;
        const vy = drdt * c - r0 * s, vz = drdt * s + r0 * c;
        let nx = uy * vz - uz * vy, ny = -ux * vz, nz = ux * vy;
        if (ny * c + nz * s < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        let k = (r * ring + j) * 3;
        N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l;
        k = (nOuter + r * ring + j) * 3;
        N[k] = 0; N[k + 1] = -c; N[k + 2] = -s;
      }
    }
  }

  updateCaps() {
    const S = this.stock, ring = this.ring, P = this.pos, N = this.nrm;
    const caps = [[this.i0, 0, 1], [this.i1, 2, -1]];
    for (const [i, off, nxs] of caps) {
      const x = -S.dAt(i), rin = S.rin[i];
      for (let j = 0; j < ring; j++) {
        const rr = this.rr(i, j);
        let k = (this.capBase + off * ring + j) * 3;
        P[k] = x; P[k + 1] = rr * this.cos[j]; P[k + 2] = rr * this.sin[j];
        N[k] = nxs; N[k + 1] = 0; N[k + 2] = 0;
        k = (this.capBase + (off + 1) * ring + j) * 3;
        P[k] = x; P[k + 1] = rin * this.cos[j]; P[k + 2] = rin * this.sin[j];
        N[k] = nxs; N[k + 1] = 0; N[k + 2] = 0;
      }
    }
  }

  /** Canlı bitiş rengi için hedef parça (buildTarget). null → tek renk stok */
  setTarget(T, tolUnder = 0.03, tolOver = 0.02) {
    if (!T) { this.tgt = null; if (this.stock.crash) this.colorRows(0, this.rows - 1); else this.paintStock(); return; }
    const S = this.stock, nth = S.nth, n = this.rows * nth;
    const mx = new Float32Array(n), mn = new Float32Array(n);
    for (let r = 0; r < this.rows; r++) {
      const i = this.i0 + r;
      for (let j = 0; j < nth; j++) {
        let a = Infinity, b = -Infinity;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di; if (ii < 0 || ii >= T.nz) continue;
          for (let dj = -1; dj <= 1; dj++) { const v = T.r[ii * nth + (j + dj + nth) % nth]; if (v < a) a = v; if (v > b) b = v; }
        }
        const low = T.lowAllowed ? T.lowAllowed[i] : NaN, lc = T.lowCell ? T.lowCell[i * nth + j] : NaN;
        if (!Number.isNaN(low)) a = Math.min(a, low);
        if (!Number.isNaN(lc)) a = Math.min(a, lc);
        mn[r * nth + j] = a; mx[r * nth + j] = T.r[i * nth + j] < 0 ? -1 : b;
      }
    }
    this.tgt = { mx, mn, rin: T.rin, tolUnder, tolOver };
    this.colorRows(0, this.rows - 1);
  }
  paintStock() { this.col.fill(0); for (let k = 0; k < this.col.length; k += 3) this.col.set(COL.stock, k); this.geometry.attributes.color.needsUpdate = true; }
  /** Satır renkleri: bitmiş ölçüde parça rengi, işlenmemiş stok rengi, fazla kesim kırmızı */
  colorRows(a, b) {
    const S = this.stock, nth = S.nth, ring = this.ring, C = this.col, T = this.tgt, X = S.crash;
    const cell = (r, j) => {
      const i = this.i0 + r;
      if (X && X[i * nth + (j % nth)]) return COL.over;       // çarpışma kesiği
      if (!T) return COL.stock;
      const k = r * nth + (j % nth), t = T.mx[k];
      if (t < 0) return COL.stock;
      const s = S.r[i * nth + (j % nth)];
      if (s < T.mn[k] - T.tolOver) return COL.over;
      return s <= t + T.tolUnder ? COL.part : COL.stock;
    };
    for (let r = a; r <= b; r++) {
      const i = this.i0 + r;
      const tri = T ? T.rin[i] || 0 : 0, sri = S.rin[i];
      const inner = T && tri > 0 && sri >= tri - T.tolUnder ? (sri > tri + T.tolOver ? COL.over : COL.part) : COL.stock;
      for (let j = 0; j < ring; j++) {
        C.set(cell(r, j), (r * ring + j) * 3);
        C.set(inner, (this.nOuter + r * ring + j) * 3);
      }
    }
    // alın kapakları: uç satırın rengi
    for (const [r, off] of [[0, 0], [this.rows - 1, 2]]) for (let j = 0; j < ring; j++) { const c = cell(r, j); C.set(c, (this.capBase + off * ring + j) * 3); C.set(c, (this.capBase + (off + 1) * ring + j) * 3); }
    const attr = this.geometry.attributes.color;
    attr.needsUpdate = true;
  }
  /** Verify renk haritası: status (0 tamam, 1 fazla kesim, 2 kalan), null → canlı renk */
  setStatusColors(status) {
    this.statusOn = !!status;
    if (!status) { if (this.tgt || this.stock.crash) this.colorRows(0, this.rows - 1); else this.paintStock(); return; }
    const S = this.stock, ring = this.ring, C = this.col;
    for (let r = 0; r < this.rows; r++) {
      const i = this.i0 + r;
      for (let j = 0; j < ring; j++) {
        const s = status ? status[i * S.nth + (j % S.nth)] : 0;
        const k = (r * ring + j) * 3;
        const c = s === 1 ? [0.95, 0.2, 0.2] : s === 2 ? [0.25, 0.55, 1.0] : [0.35, 0.85, 0.5];
        C[k] = c[0]; C[k + 1] = c[1]; C[k + 2] = c[2];
      }
    }
    this.geometry.attributes.color.needsUpdate = true;
  }
  /** Kenar çizgileri: eksenel kademe (|Δr|/dz > 1), çevresel kenar (|Δr|/(r·dθ) > 1), uç alınları ve delik ağızları */
  buildEdges() {
    const S = this.stock, nth = S.nth, dz = S.dz, dth = 2 * Math.PI / nth;
    let E = this.ePos, n = 0;
    const seg = (x1, r1, j1, x2, r2, j2) => {
      if (n + 6 > E.length) { const e2 = new Float32Array(E.length * 2); e2.set(E); E = this.ePos = e2; this.eg.setAttribute('position', new THREE.BufferAttribute(E, 3).setUsage(THREE.DynamicDrawUsage)); }
      E[n++] = x1; E[n++] = r1 * this.cos[j1]; E[n++] = r1 * this.sin[j1];
      E[n++] = x2; E[n++] = r2 * this.cos[j2]; E[n++] = r2 * this.sin[j2];
    };
    const R = (i, j) => this.rr(i, j);
    for (let r = 0; r < this.rows; r++) {
      const i = this.i0 + r, x = -S.dAt(i);
      const ends = r === 0 || r === this.rows - 1;
      const nx = r < this.rows - 1 ? i + 1 : -1;
      for (let j = 0; j < nth; j++) {
        const a = R(i, j), b = R(i, j + 1);
        if (a <= 1e-4 && b <= 1e-4) continue;
        // alın kenarı veya bir sonraki satırla kademe: daha büyük yarıçapta halka parçası
        if (ends) seg(x, a, j, x, b, j + 1);
        else if (nx >= 0) {
          const c = R(nx, j), d = R(nx, j + 1);
          if (Math.abs(a - c) > dz && Math.abs(b - d) > dz) { const xr = a > c ? x : -S.dAt(nx); seg(xr, Math.max(a, c), j, xr, Math.max(b, d), j + 1); }
        }
        // çevresel kenar (düzlük, çapraz delik ağzı): komşu açıya göre ani değişim
        const jn = (j + 1) % nth, j2 = (j + 2) % nth;
        const s1 = Math.abs(R(i, jn) - a), s2 = Math.abs(R(i, j2) - R(i, jn));
        if (nx >= 0 && Math.abs(s2 - s1) > Math.max(a, 0.5) * dth * 0.9) seg(x, R(i, jn), jn, -S.dAt(nx), R(nx, jn), jn);
      }
      // delik ağzı / iç kademe
      const ri = S.rin[i];
      if (ri > 0 && (ends || (nx >= 0 && Math.abs(S.rin[nx] - ri) > dz))) for (let j = 0; j < nth; j++) seg(x, ri, j, x, ri, j + 1);
    }
    this.eg.setDrawRange(0, n / 3);
    this.eg.attributes.position.needsUpdate = true;
  }
  setEdges(on) { this.edges.visible = on; if (on) this.buildEdges(); }
  dispose() { this.geometry.dispose(); this.material.dispose(); this.eg.dispose(); }
}
