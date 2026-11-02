// Takım kartı çizimi (teknik çizim üslubu, kullanıcının örnek görseli gibi): açık gri dolgu, koyu kontur, beyaz zemin,
// uç yukarıda. Tornalama tutucusu uç tipine göre: kol sıkmalı (negatif), vidalı (pozitif), 45° kare, dar boyunlu (yuvarlak).
import { insertOutline, insertShapeOf, parseInsertCode } from '../tools/toolLibrary.js';

const F = '#a9acb0', FI = '#c8cacd', ST = '#34373c', W = 120, H = 160;
const path = (d, fill = F, sw = 1.3) => `<path d="${d}" fill="${fill}" stroke="${ST}" stroke-width="${sw}" stroke-linejoin="round"/>`;
const line = (x1, y1, x2, y2, sw = 1) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ST}" stroke-width="${sw}"/>`;
const circ = (cx, cy, r, fill = FI, sw = 1.1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${ST}" stroke-width="${sw}"/>`;
const poly = (pts) => 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + ' Z';
const wrap = (body) => `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>`;

/** Kesici uç: talaş kırıcı iç hat + vida deliği; uç merkezi (ox, oy), ölçek k, dönüş rot° */
function insert(t, ox, oy, k, rot = 0) {
  const pts = insertOutline(t, 8);
  const mx = Math.max(...pts.map(p => p[0])), my = Math.max(...pts.map(p => p[1]));
  // alan ağırlık merkezi (burun yayının sık noktaları ortalamayı uca çekmesin)
  let A = 0, cx0 = 0, cy0 = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length], cr = x1 * y2 - x2 * y1; A += cr; cx0 += (x1 + x2) * cr; cy0 += (y1 + y2) * cr; }
  const c = Math.abs(A) > 1e-9 ? [cx0 / (3 * A), cy0 / (3 * A)] : [mx / 2, my / 2];
  // ekran: y aşağı → uç yukarıda kalsın diye y çevrilmez (uç modelde en altta = ekranda en üstte olmalı): y' = y
  const tr = (p, s = 1) => { const x = (p[0] - c[0]) * s, y = (p[1] - c[1]) * s; const a = rot * Math.PI / 180; const X = x * Math.cos(a) - y * Math.sin(a), Y = x * Math.sin(a) + y * Math.cos(a); return [ox + X * k, oy + Y * k]; };
  const hole = Math.max(1.6, Math.min(mx, my) * 0.17) * k;
  const [cx, cy] = tr(c);
  return path(poly(pts.map(p => tr(p))), FI, 1.4) + path(poly(pts.map(p => tr(p, 0.8))), 'none', 0.9) + path(poly(pts.map(p => tr(p, 0.66))), 'none', 0.7) + circ(cx, cy, hole * 1.35, FI, 0.9) + circ(cx, cy, hole, '#e4e5e7', 1);
}

function turning(t) {
  const sh = insertShapeOf(t), code = parseInsertCode(t.insertCode || '');
  const neg = code ? code.clearance === 0 : false;
  const shank = path(poly([[34, 62], [86, 62], [86, 150], [34, 150]]));
  if (sh === 'R') {
    // dar boyunlu profil tutucusu (görseldeki 3.)
    return wrap(path(poly([[44, 34], [62, 34], [62, 60], [86, 104], [86, 150], [40, 150], [40, 62], [44, 58]])) + insert(t, 53, 26, 2.4));
  }
  if (sh === 'S') {
    // 45° kare uçlu tutucu (görseldeki 2.)
    const head = path(poly([[36, 52], [84, 52], [84, 150], [36, 150]]));
    return wrap(head + line(36, 74, 84, 74) + insert(t, 60, 46, 2.9, 45));
  }
  // C/D/V/T/W: kafa ucun arkasında eğimli; negatifte kol pimi (görseldeki 1. ve 4.), pozitifte vida
  // baş: sol üst köşede uç cebi (uç başın üstüne oturur, ucun kesen köşesi dışarıda)
  const head = path(poly([[28, 54], [44, 38], [72, 40], [92, 58], [92, 150], [34, 150], [34, 80], [28, 76]]));
  const ins = insert(t, 47, 50, 3.1, sh === 'C' || sh === 'W' ? -20 : -12);
  const clamp = neg ? path('M58 44 L70 40 L74 58 L62 62 Z', '#b9bcc0') + circ(66, 70, 4.5) : '';
  return wrap(head + line(34, 92, 92, 92) + line(34, 96, 92, 96) + ins + clamp);
}
function blade(t) {
  const w = Math.max(6, Math.min(16, (t.width || 2) * 5));
  return wrap(path(poly([[60 - w / 2, 18], [60 + w / 2, 18], [60 + w / 2, 70], [76, 82], [76, 150], [44, 150], [44, 82], [60 - w / 2, 70]])) +
    path(poly([[60 - w / 2, 10], [60 + w / 2, 10], [60 + w / 2, 22], [60 - w / 2, 22]]), FI, 1.3) + line(44, 100, 76, 100));
}
function threadTool() {
  return wrap(path(poly([[38, 40], [82, 40], [86, 150], [34, 150]])) + path('M52 14 L68 14 L60 4 Z', FI, 1.3) + path(poly([[50, 14], [70, 14], [72, 40], [48, 40]]), FI, 1.2) + circ(60, 30, 3.2));
}
function drill(t, live) {
  const d = Math.max(10, Math.min(28, (t.dia || 4) * 3.2)), x0 = 60 - d / 2;
  let flutes = '';
  for (let y = 24; y < 92; y += 9) flutes += line(x0, y + 7, x0 + d, y, 1);
  const tip = t.type === 'center' ? `M${x0} 40 L${x0 + d} 40 L60 ${40 - d * 0.5} Z` : `M${x0} 22 L${x0 + d} 22 L60 ${22 - d * 0.32} Z`;
  const body = t.type === 'center' ? path(poly([[x0, 40], [x0 + d, 40], [x0 + d, 70], [x0, 70]])) : path(poly([[x0, 22], [x0 + d, 22], [x0 + d, 92], [x0, 92]])) + flutes;
  return wrap(body + path(tip, F, 1.3) + path(poly([[60 - 11, t.type === 'center' ? 70 : 92], [71, t.type === 'center' ? 70 : 92], [71, 150], [49, 150]])) + (live ? path(poly([[40, 112], [80, 112], [80, 134], [40, 134]]), '#bfc2c6') : ''));
}
function endmill(t) {
  const d = Math.max(10, Math.min(28, (t.dia || 4) * 3.2)), x0 = 60 - d / 2;
  let fl = '';
  for (let y = 16; y < 70; y += 8) fl += line(x0, y + 8, x0 + d, y, 1);
  return wrap(path(poly([[x0, 12], [x0 + d, 12], [x0 + d, 74], [x0, 74]])) + fl + line(x0, 12, x0 + d, 12, 2) + path(poly([[49, 74], [71, 74], [71, 150], [49, 150]])) + path(poly([[40, 112], [80, 112], [80, 134], [40, 134]]), '#bfc2c6'));
}
function tap(t) {
  const d = Math.max(10, Math.min(26, (t.dia || 5) * 3)), x0 = 60 - d / 2;
  let th = '';
  for (let y = 26; y < 78; y += 4.5) th += line(x0 - 1, y, x0 + d + 1, y + 2, 0.9);
  return wrap(path(poly([[x0 + 3, 16], [x0 + d - 3, 16], [x0 + d, 26], [x0 + d, 80], [x0, 80], [x0, 26]])) + th + path(poly([[51, 80], [69, 80], [69, 150], [51, 150]])) + path(poly([[54, 140], [66, 140], [66, 150], [54, 150]]), '#8f9297'));
}

/** SVG metni (kartlarda html olarak) */
export function toolArt(t) {
  if (t.type === 'turn') return turning(t);
  if (t.type === 'groove' || t.type === 'cutoff') return blade(t);
  if (t.type === 'thread') return threadTool(t);
  if (t.type === 'endmill') return endmill(t);
  if (t.type === 'tap' || t.type === 'ltap') return tap(t);
  return drill(t, t.type === 'ldrill' || (t.live && t.unit !== 'front'));
}
