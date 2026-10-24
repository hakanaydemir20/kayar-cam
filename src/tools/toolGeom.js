// Takım geometrisi (saf hesap, three.js yok): 3D model (toolMeshes.js) ile çarpışma gövdeleri aynı ölçüleri kullanır.
// Takım çerçevesi: uç orijinde, gövde +Y yönünde. Dönen takımlar Y ekseni etrafında simetrik.

const DEG = Math.PI / 180;

/** Dönen takım (matkap, punta, kılavuz, parmak freze) eksenel profil: [{y0, y1, r, cut}] (cut = kesici bölge) */
export function rotaryProfile(t) {
  const R = Math.max(0.3, (t.dia || 3) / 2);
  const fluteLen = Math.max(8, Math.min(45, (t.dia || 3) * 4 + 6));
  const segs = [];
  let y = 0;
  if (t.type === 'drill' || t.type === 'ldrill' || t.type === 'center') {
    const tipH = R / Math.tan(((t.tipAngle || 118) / 2) * DEG);
    if (t.type === 'center') {
      segs.push({ y0: 0, y1: tipH + 6, r: R, cut: true }); y = tipH + 6;
      segs.push({ y0: y, y1: y + 20, r: Math.max(R, 3), cut: false }); y += 20;
    } else {
      segs.push({ y0: 0, y1: tipH + fluteLen, r: R, cut: true }); y = tipH + fluteLen;
      segs.push({ y0: y, y1: y + 18, r: R * 0.98, cut: false }); y += 18;
    }
  } else if (t.type === 'tap' || t.type === 'ltap') {
    const p = t.pitch || 1;
    const thr = 1 + Math.ceil(12 / p) * p;
    segs.push({ y0: 0, y1: Math.max(13, thr), r: R, cut: true }); y = 13;
    segs.push({ y0: y, y1: y + 22, r: R * 0.75, cut: false }); y += 22;
    segs.push({ y0: y, y1: y + 6, r: R * 0.85, cut: false }); y += 6;     // kare uç (köşegen ≈ 0.85·R·√2·… sınır)
  } else {
    const fl = fluteLen * 0.8;
    segs.push({ y0: 0, y1: fl, r: R, cut: true }); y = fl;
    segs.push({ y0: y, y1: y + 20, r: R, cut: false }); y += 20;
  }
  const holder = holderType(t);
  if (holder === 'er') {
    const D = t.unit === 'cross' && (t.dia || 0) <= 5 ? 19 : 28;
    segs.push({ y0: y - 15, y1: y - 11, r: D / 2 - 3, cut: false });     // pens
    segs.push({ y0: y - 14, y1: y - 3, r: D / 2, cut: false });          // ER somunu
  } else if (holder === 'sleeve') {
    segs.push({ y0: y - 12, y1: y + 18, r: Math.max(R + 3, 6), cut: false });
  }
  return { segs, length: Math.max(...segs.map(s => s.y1)), holder };
}

export function holderType(t) {
  return t.unit === 'cross' || (t.unit === 'back' && t.live) ? 'er' : 'sleeve';
}

export function isRotaryType(t) {
  return !['turn', 'groove', 'cutoff', 'thread'].includes(t.type);
}

/** Gang tornalama/kanal/diş takımı kutuları (takım çerçevesi): [{box:[x0,x1,y0,y1,z0,z1], cut}] */
export function gangToolBoxes(t) {
  if (t.type === 'groove' || t.type === 'cutoff') {
    const w = t.width || 2;
    return [
      { box: [-w, 0, 0, 24, -6, 6], cut: true },                                          // bıçak (merkeze kadar dalabilir)
      { box: [-w / 2 + 2 - (w * 0.85 + 8) / 2, -w / 2 + 2 + (w * 0.85 + 8) / 2, 22, 34, -7, 7], cut: false }, // bıçak bağlama
      { box: [-2, 10, 29, 99, -6, 6], cut: false },                                        // sap
    ];
  }
  if (t.type === 'thread') {
    return [
      { box: [-3, 3, 0, 5.2, -1.75, 1.75], cut: true },
      { box: [-2, 12, 5.5, 15.5, -6, 6], cut: false },
      { box: [0, 12, 15, 95, -6, 6], cut: false },
    ];
  }
  // tornalama: kesici uç üçgeni (x 0…~11, y 0…~10; arka boşluk kesme simülasyonunda), tutucu başı, sap
  return [
    { box: [0, 11.5, 0, 10, -1.8, 1.8], cut: true },
    { box: [0.5, 14.5, 10, 15.5, -6, 6], cut: false },
    { box: [1, 13, 15, 95, -6, 6], cut: false },
  ];
}
