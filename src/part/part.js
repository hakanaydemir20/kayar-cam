// Parça modeli: döner profil + özellikler.
// Profil noktaları {z, r}: z ön alından (0) arkaya (L) doğru, r yarıçap.

const ARC_STEP = 0.01;

function arcPts(cz, cr, R, a0, a1, out) {
  const k = Math.max(4, Math.ceil(Math.abs(a1 - a0) * R / ARC_STEP));
  for (let q = 1; q <= k; q++) {
    const t = a0 + (a1 - a0) * q / k;
    out.push({ z: cz + R * Math.cos(t), r: cr + R * Math.sin(t) });
  }
}

/**
 * Profil tablosundan nokta listesi.
 * rows: [{dia, len, endDia?, ch?, rad?}] — ch/rad: bu satırın başındaki dış köşeye pah/radyüs.
 * Basamak aşağı inerse pah/radyüs önceki satırın bitiş köşesine uygulanır.
 */
export function profileFromTable(rows) {
  const pts = [{ z: 0, r: 0 }];
  let z = 0, prevR = 0;
  rows.forEach((row, idx) => {
    const r0 = row.dia / 2;
    const r1 = (row.endDia ?? row.dia) / 2;
    // aynı çaplı iki satırın birleşiminde köşe yok: pah/radyüs yok sayılır (yoksa sahte V-kanal oluşur)
    const corner = idx === 0 || Math.abs(r0 - prevR) > 1e-9;
    const ch = corner ? +row.ch || 0 : 0, rad = corner ? +row.rad || 0 : 0;
    if (r0 >= prevR) {
      // yukarı basamak: köşe (z, r0) dışbükey
      if (rad > 0) {
        pts.push({ z, r: r0 - rad });
        arcPts(z + rad, r0 - rad, rad, Math.PI, Math.PI / 2, pts);
      } else if (ch > 0) {
        pts.push({ z, r: r0 - ch });
        pts.push({ z: z + ch, r: r0 });
      } else {
        pts.push({ z, r: r0 });
      }
    } else {
      // aşağı basamak: önceki satırın bitiş köşesi (z, prevR) dışbükey
      const last = pts.pop();
      if (rad > 0) {
        pts.push({ z: z - rad, r: prevR });
        arcPts(z - rad, prevR - rad, rad, Math.PI / 2, 0, pts);
      } else if (ch > 0) {
        pts.push({ z: z - ch, r: prevR });
        pts.push({ z, r: prevR - ch });
      } else {
        pts.push(last);
      }
      pts.push({ z, r: r0 });
    }
    z += row.len;
    pts.push({ z, r: r1 });
    prevR = r1;
  });
  pts.push({ z, r: 0 });
  return pts;
}

export function profileLength(pts) { return Math.max(...pts.map(p => p.z)); }
export function profileMaxDia(pts) { return 2 * Math.max(...pts.map(p => p.r)); }

export const STD_BARS = [3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 18, 20];
export function suggestBar(maxDia, maxBar = 20) {
  const b = STD_BARS.find(d => d >= maxDia - 1e-6);
  return b && b <= maxBar ? b : null;
}

/**
 * Parça nesnesi oluştur.
 * features: [{type:'axialHole', side:'front'|'back', dia, depth}
 *            {type:'crossHole', dia, z, c, through, depthDia}
 *            {type:'flat', c, depth, z0, z1}
 *            {type:'thread', z0, z1, dia, pitch}
 *            {type:'pocket', c, z, dia, depth}]
 */
export function makePart({ name = 'Parça', profile, features = [], source = 'table', mesh = null, rows = null }) {
  const L = profileLength(profile);
  const part = { name, profile, features, source, mesh, length: L, maxDia: profileMaxDia(profile) };
  if (rows) part.rows = rows;
  return part;
}

export function examplePart() {
  const rows = [
    { dia: 6, len: 8, ch: 0.5 },
    { dia: 10, len: 12, ch: 0.3 },
    { dia: 7, len: 3 },
    { dia: 14, len: 12, ch: 0.5 },
  ];
  return makePart({
    name: 'Örnek Pim',
    profile: profileFromTable(rows),
    features: [
      { type: 'axialHole', side: 'front', dia: 4, depth: 6, id: 'f1' },
      { type: 'thread', z0: 8, z1: 18, dia: 10, pitch: 1.0, id: 'f2' },
      { type: 'crossHole', dia: 3, z: 29, c: 0, through: true, id: 'f3' },
      { type: 'flat', c: 90, depth: 1.5, z0: 26, z1: 33, id: 'f4' },
      { type: 'axialHole', side: 'back', dia: 4, depth: 5, id: 'f5' },
    ],
    rows,
  });
}

/**
 * Profil tablosu parçasını ön ↔ arka çevir (180°). Satırlar ters sıralanır, köşe pah/radyüsleri komşu satıra taşınır,
 * özelliklerin Z'si aynalanır, C açıları ters döner. Tabloda arka uç köşesine pah yazılamadığından ön alın pahı
 * düşer; ön alın özellikleri (alın kanalı/çokgeni yalnız arkada desteklenir) düşer. Dönüş: { part, lost: [metin] }
 */
export function mirrorTablePart(part) {
  const rows = part.rows || [];
  const n = rows.length, L = part.length, lost = [];
  if (rows[0] && (+rows[0].ch || +rows[0].rad)) lost.push('ön alın pahı/radyüsü (yeni arka uçta tabloyla tanımlanamaz)');
  const out = [];
  for (let j = n - 1; j >= 0; j--) {
    const r = rows[j], next = rows[j + 1];
    const row = { dia: r.endDia ?? r.dia, len: r.len };
    if (r.endDia != null) row.endDia = r.dia;
    if (next) { if (+next.ch) row.ch = next.ch; if (+next.rad) row.rad = next.rad; }
    out.push(row);
  }
  const mz = (z) => Math.round((L - z) * 1000) / 1000;
  const mc = (c) => c == null ? c : ((360 - (+c || 0)) % 360);
  const features = [];
  for (const f0 of part.features) {
    const f = { ...f0 };
    switch (f.type) {
      case 'axialHole': f.side = f.side === 'back' ? 'front' : 'back'; break;
      case 'crossHole': case 'pocket': case 'engrave': f.z = mz(f.z); f.c = mc(f.c); break;
      case 'flat': case 'thread': case 'polygon': { const a = mz(f.z1), b = mz(f.z0); f.z0 = a; f.z1 = b; if ('c' in f) f.c = mc(f.c); break; }
      case 'odSlot': f.z0 = mz(f.z0); f.z1 = mz(f.z1); f.c0 = mc(f.c0); f.c1 = mc(f.c1); break;
      default: lost.push(`${f.type} (ön alında desteklenmiyor)`); continue;
    }
    features.push(f);
  }
  return { part: makePart({ name: part.name, profile: profileFromTable(out), rows: out, features }), lost };
}
