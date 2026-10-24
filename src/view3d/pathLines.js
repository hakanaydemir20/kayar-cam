// Takım yolu çizgileri (yorumlanmış G-kod hareketlerinden), işlem bazında gruplu
import * as THREE from 'three';
import { movePoint } from '../sim/interpreter.js';

const COL = { rapid: 0xf59e0b, feed: 0x38bdf8, arc: 0xa78bfa, thread: 0x34d399 };
const MATS = {};
function lineMat(k) {
  if (MATS[k]) return MATS[k];
  MATS[k] = k === 'rapid'
    ? new THREE.LineDashedMaterial({ color: COL[k], dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.75 })
    : new THREE.LineBasicMaterial({ color: COL[k], transparent: true, opacity: 0.95 });
  return MATS[k];
}

/**
 * $1: ana parça çerçevesinde (x = −Z_makine, y = X/2, z = Y)
 * $2 (G55): karşı parça çerçevesinde (x = Z − L, z = X/2)
 * lineInfo: posted.lineInfo (satır → opId). Dönüş: { g1, g2, byOp: Map(opId → Group[]) }
 */
export function buildPathLines(sim, L, lineInfo = []) {
  const g1 = new THREE.Group(), g2 = new THREE.Group();
  const byOp = new Map();
  const build = (moves, ch) => {
    const info = lineInfo[ch - 1] || [];
    const perOp = new Map(); // opId → {rapid:[],...}
    for (const m of moves) {
      if (!COL[m.kind]) continue;
      if (ch === 2 && m.state.wo !== 'G55') continue;
      if (ch === 1 && !m.state.tool) continue;
      const op = info[m.line]?.opId || '_';
      let seg = perOp.get(op);
      if (!seg) perOp.set(op, seg = { rapid: [], feed: [], arc: [], thread: [] });
      const n = m.kind === 'arc' ? Math.max(4, Math.ceil(m.arc.length / 0.15)) : 1;
      let prev = pt(m, 0, ch, L);
      for (let k = 1; k <= n; k++) {
        const cur = pt(m, k / n, ch, L);
        seg[m.kind].push(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2]);
        prev = cur;
      }
    }
    const grp = ch === 1 ? g1 : g2;
    for (const [op, seg] of perOp) {
      const og = new THREE.Group(); og.userData.opId = op;
      for (const [k, arr] of Object.entries(seg)) {
        if (!arr.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const ls = new THREE.LineSegments(geo, lineMat(k));
        if (k === 'rapid') ls.computeLineDistances();
        ls.renderOrder = 2;
        og.add(ls);
      }
      grp.add(og);
      if (!byOp.has(op)) byOp.set(op, []);
      byOp.get(op).push(og);
    }
  };
  build(sim.paths[0]?.moves || [], 1);
  if (sim.paths[1]) build(sim.paths[1].moves, 2);
  return { g1, g2, byOp };
}

function pt(m, t, ch, L) {
  const p = movePoint(m, t);
  if (ch === 1) {
    const dz = m.mFrom.Z - m.from.Z - (m.state.extZ || 0); // sıfır kaydırması (iş kaydırması hariç: yol parça çerçevesinde)
    return [-(p.Z + dz), p.X / 2, p.Y || 0];
  }
  return [p.Z - L, 0, p.X / 2];
}
