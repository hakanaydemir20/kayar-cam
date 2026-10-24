// Makine katı gövdeleri: hem 3D model (machineMesh.js) hem çarpışma kontrolü (collision.js) bu listeden üretilir.
// Şekiller: kutu {t:'box', b:[x0,x1,y0,y1,z0,z1]} ve x eksenli silindir/koni {t:'cyl', x0,x1, r0,r1, cy,cz, bore}.
// Dünya: x eksenel (karşı iş miline doğru +), y yukarı, z operatöre doğru. Takım ucu x = 0.
import { LAYOUT } from './frames.js';
import { rotaryProfile, gangToolBoxes, isRotaryType } from '../tools/toolGeom.js';

export const PAN_Y = -330;                   // talaş teknesi üstü
export const SUB_NUT = 10.4;                 // karşı iş mili pens somununun alından çıkıntısı (mm)
const GANG = (t) => t.unit === 'gang' || t.unit === 'cross' || t.unit === 'front';
const box = (x0, x1, y0, y1, z0, z1, extra = {}) => ({ t: 'box', b: [x0, x1, y0, y1, z0, z1], ...extra });
const cyl = (x0, x1, r0, r1 = r0, extra = {}) => ({ t: 'cyl', x0, x1, r0, r1, cy: 0, cz: 0, ...extra });
/** y eksenli silindir (çapraz tahrikli takımlar) */
const vcyl = (y0, y1, r, cz, extra = {}) => ({ t: 'vcyl', y0, y1, r, cx: 0, cz, ...extra });

/** Kılavuz burç ünitesi (sabit, dünya): ince konik burç ucu — çapraz takım pens somunları üstünden geçer */
export function bushBodies() {
  const F = LAYOUT.bushFace;                 // −3.2
  return [
    box(-95, -32, PAN_Y, 300, -300, 250, { name: 'Burç sütunu', mat: 'paint', r: 8 }),
    cyl(-32, -26, 31, 31, { name: 'Burç flanşı', mat: 'steel' }),
    cyl(-26, -15, 31, 19, { name: 'Burç gövdesi', mat: 'steel' }),
    cyl(-15, -10, 19, 16, { name: 'Burç gövdesi', mat: 'steel' }),
    cyl(-10, F, 16, 16, { name: 'Burç somunu', mat: 'darkSteel', bore: 11 }),
  ];
}

/** Gang tool post gövdeleri (gang yerel çerçevesi: aktif takım ucu hattı orijin). Takım gövdeleri tool alanı taşır. */
export function gangBodies(tools) {
  const all = tools.filter(GANG);
  const out = [];
  const zs = all.map(t => t.yPos);
  const zMin = Math.min(...zs, 0) - 22, zMax = Math.max(...zs, 0) + 30;
  out.push(box(-14, 52, 120, 178, zMin, zMax, { name: 'Gang kızağı', mat: 'paint', r: 6 }));
  out.push(box(-16, 54, 178, 186, zMin - 2, zMax + 2, { name: 'Kızak kapağı', mat: 'starBlue', r: 3 }));
  const turn = all.filter(t => t.unit === 'gang'), cross = all.filter(t => t.unit === 'cross'), front = all.filter(t => t.unit === 'front');
  if (turn.length) {
    const a = Math.min(...turn.map(t => t.yPos)) - 8, b = Math.max(...turn.map(t => t.yPos)) + 8;
    out.push(box(-12, 34, 86, 120, a - 3, b + 3, { name: 'Takım tutucu plakası', mat: 'castDark', r: 3, strip: 'turn' }));
    for (const t of turn) out.push(box(-2, 19, 38, 88, t.yPos - 6.8, t.yPos + 6.8, { name: `T${t.num} bağlama bloğu`, mat: 'blackOx', r: 1.5, clamp: t }));
  }
  if (cross.length) {
    const a = Math.min(...cross.map(t => t.yPos)) - 12, b = Math.max(...cross.map(t => t.yPos)) + 12;
    out.push(box(-14, 46, 50, 122, a, b, { name: 'Çapraz tahrikli ünite', mat: 'paint', r: 5, strip: 'cross' }));
    out.push(box(-5, 33, 73, 111, a - 56, a - 4, { name: 'Çapraz ünite motoru', mat: 'starBlue', motor: true }));
    out.push(box(-6, 34, 72, 112, a - 8, a, { name: 'Motor flanşı', mat: 'castDark', r: 3 }));
    for (const t of cross) {
      const top = rotaryProfile(t).length;
      if (top < 52) out.push(vcyl((t.xPos || 0) + top, (t.xPos || 0) + 52, 12, t.yPos, { name: `T${t.num} tahrikli iş mili`, mat: 'darkSteel', spindleOf: t }));
    }
  }
  if (front.length) {
    const a = Math.min(...front.map(t => t.yPos)) - 11, b = Math.max(...front.map(t => t.yPos)) + 11;
    const xc = front[0].xPos || 0;
    // tutucu kolu plakanın DIŞ ucunda ve bütün tornalama/kovan takımlarının ötesinde (en dıştakinden 14 mm):
    // takım seçimi Y hareketlerinde ve en dıştaki takımla tornalarken öne çıkmış parçanın önünden geçmez
    // (iç tarafta olsaydı Y hareketinde parçayı keserdi — çarpışma kontrolü bunu yakaladı)
    const zArm = Math.max(b, ...all.filter(t => t.unit !== 'cross').map(t => t.yPos)) + 14;
    // blok x ≤ 60 ve üst kenar xc+12: karşı iş mili kısa parçayı alırken basamaklı gövdesi (y ±30) çakışmaz
    out.push(box(30, 60, xc - 12, xc + 12, a, zArm, { name: 'Kovan bloğu (ön)', mat: 'blackOx', r: 3, strip: 'front' }));
    out.push(box(40, 56, xc - 12, 120, zArm, zArm + 8, { name: 'Kovan bloğu kolu', mat: 'castDark', r: 3 }));
  }
  for (const t of all) out.push(...toolBodies(t));
  return out;
}

/** Bir takımın gövdeleri (gang yerel ya da dünya), cut = kesici bölge (aktifken parçaya değebilir) */
export function toolBodies(t) {
  const out = [];
  const tag = { tool: t, name: `T${String(t.num).padStart(2, '0')} ${t.name}` };
  if (t.unit === 'gang' || (t.unit === 'cross' && !isRotaryType(t))) {
    for (const g of gangToolBoxes(t)) {
      const [x0, x1, y0, y1, z0, z1] = g.box;
      out.push(box(x0, x1, y0 + (t.xPos || 0), y1 + (t.xPos || 0), z0 + t.yPos, z1 + t.yPos, { ...tag, cut: g.cut }));
    }
    return out;
  }
  if (t.unit === 'cross') {
    // dikey (−y yönüne bakan) dönen takım
    for (const s of rotaryProfile(t).segs) out.push(vcyl((t.xPos || 0) + s.y0, (t.xPos || 0) + s.y1, s.r, t.yPos, { ...tag, cut: s.cut }));
    return out;
  }
  if (t.unit === 'front') {
    // eksenel: gövde +x, uç x = 0 (burca bakar)
    const cy = t.xPos || 0, cz = t.yPos;
    const pr = rotaryProfile(t);
    for (const s of pr.segs) out.push(cyl(s.y0, s.y1, s.r, s.r, { cy, cz, ...tag, cut: s.cut }));
    const R = Math.max(7, (t.dia || 4) / 2 + 4), x0 = Math.max(14, pr.length - 14), x1 = 58;
    if (x1 > x0) out.push(cyl(x0, x1, R, R, { cy, cz, ...tag, cut: false, sleeve: true }));
    return out;
  }
  // arka ünite / arka kovan (dünya): uç x = backToolX, gövde −x
  const X = LAYOUT.backToolX, cz = LAYOUT.backLat + t.yPos;
  if (isRotaryType(t)) {
    const pr = rotaryProfile(t);
    for (const s of pr.segs) out.push(cyl(X - s.y1, X - s.y0, s.r, s.r, { cy: 0, cz, ...tag, cut: s.cut }));
    const R = Math.max(7, (t.dia || 4) / 2 + 4), x0 = Math.max(14, pr.length - 14), x1 = 62;
    if (x1 > x0) out.push(cyl(X - x1, X - x0, R, R, { cy: 0, cz, ...tag, cut: false, sleeve: true }));
  } else {
    // eksenel bağlanan tornalama takımı: sap −x, kesici uç radyal dışarı (+z) — bkz. backTurn
    out.push(box(X - 10, X, -1.8, 1.8, cz, cz + 11.5, { ...tag, cut: true }));
    out.push(box(X - 15.5, X - 10, -6, 6, cz + 0.5, cz + 13.5, { ...tag, cut: false }));
    out.push(box(X - 95, X - 15, -6, 6, cz + 1, cz + 13, { ...tag, cut: false }));
  }
  return out;
}

/** Arka ünite (sabit, dünya) */
export function backBodies(tools) {
  const bt = tools.filter(t => t.unit === 'back' || t.unit === 'rear');
  if (!bt.length) return [];
  const bz = bt.map(t => LAYOUT.backLat + t.yPos);
  const a = Math.min(...bz) - 13, b = Math.max(...bz) + 13;
  const X = LAYOUT.backToolX;
  const out = [
    box(X - 62, X - 30, -22, 22, a, b, { name: 'Arka ünite', mat: 'starBlue', r: 4 }),
    box(X - 70, X - 30, PAN_Y + 26, -22, a + 4, b - 4, { name: 'Arka ünite ayağı', mat: 'paint', r: 5 }),
  ];
  for (const t of bt) out.push(...toolBodies(t));
  return out;
}

/** Karşı iş mili (yerel: x = pens alnından, z = karşı iş mili ekseninden yanal). Delik (bore): parça bu çapa kadar girer. */
export function subBodies(barR) {
  const bore = barR + 0.3;
  return [
    cyl(-SUB_NUT, 0, 18, 18, { name: 'Karşı iş mili pens somunu', mat: 'chrome', bore, collet: true }),
    cyl(0, 26, 22, 22, { name: 'Karşı iş mili burnu', mat: 'steel', bore }),
    cyl(26, 34, 28, 28, { name: 'Karşı iş mili flanşı', mat: 'darkSteel', bore }),
    box(34, 96, -30, 30, -32, 32, { name: 'Karşı iş mili gövdesi', mat: 'white', r: 9 }),
    box(96, 262, -58, 52, -50, 50, { name: 'Karşı iş mili gövdesi', mat: 'white', r: 14 }),
    box(150, 250, 52, 60, -40, 40, { name: 'Karşı iş mili kapağı', mat: 'paintMid', r: 3 }),
    box(84, 250, PAN_Y + 36, -58, -42, 42, { name: 'X2/Z2 kızağı', mat: 'paint', r: 6 }),
    box(80, 254, PAN_Y + 36, PAN_Y + 52, -48, 48, { name: 'Kızak tabanı', mat: 'castDark', r: 3 }),
  ];
}
