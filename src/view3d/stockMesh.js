// Stok ızgarasından (r(d,θ), rin(d)) üçgen ağı. Yerel koordinat: x = −d, y = r cosθ, z = r sinθ.
// Yalnızca değişen satırlar güncellenir; normaller analitik (sonlu fark) hesaplanır.
import * as THREE from 'three';
import { mat } from './materials.js';

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
    m.vertexColors = true;
    m.side = THREE.DoubleSide;
    this.material = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.cos = new Float32Array(ring); this.sin = new Float32Array(ring);
    for (let j = 0; j < ring; j++) { const t = (j % nth) * 2 * Math.PI / nth; this.cos[j] = Math.cos(t); this.sin[j] = Math.sin(t); }
    this.lastVersion = -1;
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

  /** Verify renk haritası: status (0 tamam, 1 fazla kesim, 2 kalan), null → doğal renk */
  setStatusColors(status) {
    const S = this.stock, ring = this.ring, C = this.col;
    for (let r = 0; r < this.rows; r++) {
      const i = this.i0 + r;
      for (let j = 0; j < ring; j++) {
        const s = status ? status[i * S.nth + (j % S.nth)] : 0;
        const k = (r * ring + j) * 3;
        const c = !status ? [1, 1, 1] : s === 1 ? [0.95, 0.2, 0.2] : s === 2 ? [0.25, 0.55, 1.0] : [0.35, 0.85, 0.5];
        C[k] = c[0]; C[k + 1] = c[1]; C[k + 2] = c[2];
      }
    }
    this.geometry.attributes.color.needsUpdate = true;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
