// Takım kütüphanesi — Star SB-20R G tipik takım yerleşimi.
// unit: gang (tornalama, X1/Y1 gang plakası), cross (çapraz tahrikli, radyal),
//       front (kovan tutucu ön, eksenel), rear (kovan tutucu arka, karşı iş miline),
//       back (arka 4'lü ünite, karşı iş miline)
// channel: 1 = $1 (ana iş mili), 2 = $2 (karşı iş mili)

export const TOOL_TYPES = {
  turn:     { label: 'Tornalama Kateri', live: false },
  groove:   { label: 'Kanal Kateri', live: false },
  cutoff:   { label: 'Kesme Kateri', live: false },
  thread:   { label: 'Diş Kateri', live: false },
  drill:    { label: 'Matkap', live: false },
  center:   { label: 'Punta Matkabı', live: false },
  tap:      { label: 'Kılavuz', live: false },
  endmill:  { label: 'Parmak Freze', live: true },
  ldrill:   { label: 'Tahrikli Matkap', live: true },
  ltap:     { label: 'Tahrikli Kılavuz', live: true },
};

export const UNITS = {
  gang:  { label: 'Gang (Tornalama)', channel: 1, dir: 'radial' },
  cross: { label: 'Çapraz Tahrikli', channel: 1, dir: 'radial' },
  front: { label: 'Kovan Ön', channel: 1, dir: 'axialFront' },
  rear:  { label: 'Kovan Arka', channel: 2, dir: 'axialBack' },
  back:  { label: 'Arka Ünite', channel: 2, dir: 'axialBack' },
};

/** ISO 1832 kesici uç şekilleri (kodun 1. harfi). angle: burun (uç) açısı; size: varsayılan kenar boyu (mm) */
export const INSERT_SHAPES = {
  C: { label: 'C · 80° eşkenar dörtgen', angle: 80, size: 9.7 },
  D: { label: 'D · 55° eşkenar dörtgen', angle: 55, size: 11 },
  V: { label: 'V · 35° eşkenar dörtgen', angle: 35, size: 11 },
  K: { label: 'K · 55° paralelkenar', angle: 55, size: 11, para: true },
  T: { label: 'T · 60° üçgen', angle: 60, size: 11, tri: true },
  W: { label: 'W · 80° trigon', angle: 80, size: 6.5, trigon: true },
  S: { label: 'S · 90° kare', angle: 90, size: 9.5 },
  R: { label: 'R · yuvarlak', angle: 90, size: 10, round: true },
};
/** Kodun 2. harfi: serbest (boşluk) açısı */
const CLEARANCE = { N: 0, A: 3, B: 5, C: 7, D: 15, E: 20, F: 25, G: 30, P: 11 };
const shapeOfAngle = (a) => ({ 35: 'V', 55: 'D', 60: 'T', 80: 'C', 90: 'S' })[Math.round(a || 35)] || 'V';

/**
 * ISO uç kodu çöz: "VCMT 110304", "DCGT11T304", "CNMG120408", "RCMT 1003M0".
 * @returns {{shape, clearance, size, noseR, code}|null}
 */
export function parseInsertCode(code) {
  const c = String(code || '').toUpperCase().replace(/[\s-]/g, '');
  const m = /^([CDVKTWSR])([NABCDEFGP])([A-Z])([A-Z])(\d{2})(\d{2}|T\d)(\d{2}|M0)?/.exec(c);
  if (!m) return null;
  const sh = INSERT_SHAPES[m[1]];
  const size = +m[5];
  const noseR = m[7] && m[7] !== 'M0' ? +m[7] / 10 : null;
  return { shape: m[1], clearance: CLEARANCE[m[2]] ?? null, size: size > 0 ? size : sh.size, noseR, code: c };
}

/** Takımın uç şekli (eski projelerde açıdan çıkarılır) */
export function insertShapeOf(t) { return INSERT_SHAPES[t.insertShape] ? t.insertShape : shapeOfAngle(t.insertAngle); }

/**
 * Kesici uç dış hattı (takım çerçevesi: x = eksenel, y = radyal yukarı; hayali uç orijinde, uç en altta/en solda).
 * Ana kesme kenarı 93° yaklaşma; burun radyüsü yalnız kesen köşede.
 */
export function insertOutline(t, arcSeg = 10) {
  const key = insertShapeOf(t), S = INSERT_SHAPES[key];
  const L = t.insertSize > 0 ? t.insertSize : S.size;
  const rn = Math.max(t.noseR || 0.2, 0.05);
  const D2R = Math.PI / 180;
  let pts;
  if (S.round) {
    const r = L / 2, n = 48;
    pts = Array.from({ length: n }, (_, i) => [r + r * Math.cos(Math.PI + i * 2 * Math.PI / n), r + r * Math.sin(Math.PI + i * 2 * Math.PI / n)]);
    return normalize(pts);
  }
  const ang = S.angle * D2R;
  const d1 = 87 * D2R, d2 = 87 * D2R - ang;          // e1: ana kenar, e2: arka kenar
  const e1 = [Math.cos(d1), Math.sin(d1)], e2 = [Math.cos(d2), Math.sin(d2)];
  // köşeler (uç önce, e1 boyunca → … → e2 boyunca geri)
  let poly;
  if (S.tri) poly = [[0, 0], [e1[0] * L, e1[1] * L], [e2[0] * L, e2[1] * L]];
  else if (S.trigon) {
    // 3 × 80° köşe + 3 × 160° kırık: kenar başına iki parça, dönüş sırasıyla 20° ve 100° (saat yönü)
    poly = [[0, 0]]; let dir = d1, p = [0, 0];
    const turns = [20, 100, 20, 100, 20];
    for (let i = 0; i < 5; i++) { p = [p[0] + Math.cos(dir) * L / 2, p[1] + Math.sin(dir) * L / 2]; poly.push(p); dir -= turns[i] * D2R; }
  } else {
    const k = S.para ? 0.55 : 1;                        // paralelkenar: kısa kenar
    poly = [[0, 0], [e1[0] * L, e1[1] * L], [e1[0] * L + e2[0] * L * k, e1[1] * L + e2[1] * L * k], [e2[0] * L * k, e2[1] * L * k]];
  }
  // burun radyüsü (uç köşesi)
  const bis = Math.atan2(e1[1] + e2[1], e1[0] + e2[0]), dc = rn / Math.sin(ang / 2);
  const cx = Math.cos(bis) * dc, cy = Math.sin(bis) * dc;
  const a2 = d2 - Math.PI / 2;                        // e2 kenarındaki teğet noktası (yay oradan e1 kenarına döner)
  const arc = [];
  for (let i = 0; i <= arcSeg; i++) { const a = a2 - (Math.PI - ang) * i / arcSeg; arc.push([cx + rn * Math.cos(a), cy + rn * Math.sin(a)]); }   // saat yönünde a2 → a1
  pts = [...arc, ...poly.slice(1)];
  return normalize(pts);
  function normalize(q) {
    const mx = Math.min(...q.map(p => p[0])), my = Math.min(...q.map(p => p[1]));
    return q.map(([x, y]) => [x - mx, y - my]);
  }
}

/** Sık kullanılan ISO kesici uçlar (tornalama) — her uç tipinden en yaygın 5 kod */
export const INSERT_CODES = [
  ['CCMT 060204', 'C 80° · pozitif · küçük, hassas'], ['CCMT 09T304', 'C 80° · pozitif · genel kaba'], ['CCGT 060202', 'C 80° · taşlanmış · ince, alüminyum'], ['CNMG 120404', 'C 80° · negatif · orta'], ['CNMG 120408', 'C 80° · negatif · ağır kaba'],
  ['DCMT 070204', 'D 55° · pozitif · küçük'], ['DCMT 11T304', 'D 55° · pozitif · genel'], ['DCGT 11T302', 'D 55° · taşlanmış · ince'], ['DNMG 150604', 'D 55° · negatif · orta'], ['DNMG 150608', 'D 55° · negatif · kaba'],
  ['VCMT 110304', 'V 35° · pozitif · kopyalama'], ['VCGT 110302', 'V 35° · taşlanmış · ince, alüminyum'], ['VBMT 110304', 'V 35° · 5° serbest · kopyalama'], ['VBMT 160404', 'V 35° · 5° serbest · büyük'], ['VNMG 160404', 'V 35° · negatif · profil'],
  ['TCMT 110204', 'T 60° · pozitif'], ['TCMT 16T304', 'T 60° · pozitif · büyük'], ['TCGT 110202', 'T 60° · taşlanmış · ince'], ['TNMG 160404', 'T 60° · negatif · orta'], ['TNMG 160408', 'T 60° · negatif · kaba'],
  ['WCMT 040204', 'W 80° trigon · pozitif · küçük'], ['WCMT 06T304', 'W 80° trigon · pozitif'], ['WNMG 060404', 'W 80° trigon · negatif · küçük'], ['WNMG 080404', 'W 80° trigon · negatif · orta'], ['WNMG 080408', 'W 80° trigon · negatif · kaba'],
  ['SCMT 09T304', 'S 90° kare · pozitif · pah/alın'], ['SCMT 120408', 'S 90° kare · pozitif · büyük'], ['SCGT 09T304', 'S 90° kare · taşlanmış'], ['SNMG 090308', 'S 90° kare · negatif'], ['SNMG 120408', 'S 90° kare · negatif · kaba'],
  ['RCMT 0602M0', 'R Ø6 yuvarlak · profil'], ['RCMT 0803M0', 'R Ø8 yuvarlak · profil'], ['RCMT 10T3M0', 'R Ø10 yuvarlak · profil'], ['RCGT 0803M0', 'R Ø8 · taşlanmış · alüminyum'], ['RCMX 1204M0', 'R Ø12 · ağır profil'],
];

/** Takım kataloğu (ISO tutucu tanımlarına göre, □12 sap — kayar otomat). Her kategoriden en yaygın 5 tip. */
const TURN = (label, code, shape, size, rn, extra = {}) => ({ label, p: { name: label, type: 'turn', unit: 'gang', insertCode: code, insertShape: shape, insertSize: size, noseR: rn, vc: 160, feed: Math.min(0.12, rn * 0.4), chipGeo: 'M', ...extra } });
export const TOOL_CATALOG = [
  { group: 'Dış tornalama (gang, $1)', items: [
    TURN('SVJCR 1212 · V 35° 93° kopyalama', 'VCMT 110304', 'V', 11, 0.4),
    TURN('SDJCR 1212 · D 55° 93° genel', 'DCMT 11T304', 'D', 11, 0.4),
    TURN('SCLCR 1212 · C 80° 95° kaba', 'CCMT 09T304', 'C', 9.7, 0.4, { chipGeo: 'R' }),
    TURN('STGCR 1212 · T 60° 91° kaba-orta', 'TCMT 110204', 'T', 11, 0.4),
    TURN('SVJCR 1212 · V 35° ince (taşlanmış)', 'VCGT 110302', 'V', 11, 0.2, { vc: 190, feed: 0.04, chipGeo: 'F' }),
    TURN('MWLNR 1212 · W 80° 95° negatif', 'WNMG 060404', 'W', 6.5, 0.4, { chipGeo: 'M' }),
    TURN('SRDCN 1212 · R yuvarlak profil', 'RCMT 0602M0', 'R', 6, 3, { feed: 0.1 }),
  ] },
  { group: 'Kanal (gang, $1)', items: [1.0, 1.5, 2.0, 2.5, 3.0].map(w => ({ label: `Kanal kateri ${w.toFixed(1)} mm`, p: { name: `Kanal ${w.toFixed(1)} mm`, type: 'groove', unit: 'gang', width: w, noseR: w <= 1 ? 0.05 : 0.1, vc: 90, feed: 0.02 + w * 0.005 } })) },
  { group: 'Kesme (gang, $1)', items: [1.2, 1.5, 2.0, 2.5, 3.0].map(w => ({ label: `Kesme kateri ${w.toFixed(1)} mm`, p: { name: `Kesme ${w.toFixed(1)} mm`, type: 'cutoff', unit: 'gang', width: w, noseR: 0.1, vc: 80, feed: 0.02 + w * 0.003 } })) },
  { group: 'Diş (gang, $1)', items: [
    { label: 'Diş kateri dış 60° ISO 0.5–1.5', p: { name: 'Diş Kateri 60° (16ER A60)', type: 'thread', unit: 'gang', noseR: 0.05, vc: 80, feed: 0 } },
    { label: 'Diş kateri 16ER 1.0 ISO', p: { name: 'Diş 16ER 1.0 ISO', type: 'thread', unit: 'gang', noseR: 0.12, pitch: 1, vc: 80, feed: 0 } },
    { label: 'Diş kateri 16ER 1.5 ISO', p: { name: 'Diş 16ER 1.5 ISO', type: 'thread', unit: 'gang', noseR: 0.18, pitch: 1.5, vc: 80, feed: 0 } },
    { label: 'Diş kateri 11ER 0.5 ISO (ince)', p: { name: 'Diş 11ER 0.5 ISO', type: 'thread', unit: 'gang', noseR: 0.05, pitch: 0.5, vc: 70, feed: 0 } },
    { label: 'Diş kateri 16ER AG55 (BSP/Whitworth)', p: { name: 'Diş 16ER AG55', type: 'thread', unit: 'gang', noseR: 0.1, vc: 80, feed: 0 } },
  ] },
  { group: 'Tahrikli — parmak freze (çapraz, $1)', items: [2, 3, 4, 5, 6].map(d => ({ label: `Parmak freze Ø${d}`, p: { name: `Parmak Freze Ø${d}`, type: 'endmill', unit: 'cross', dia: d, vc: 60 + d * 5, fz: +(0.005 + d * 0.003).toFixed(3), flutes: d <= 3 ? 2 : 3 } })) },
  { group: 'Tahrikli — matkap ve kılavuz (çapraz, $1)', items: [
    ...[2, 3, 4, 5].map(d => ({ label: `Tahrikli matkap Ø${d}`, p: { name: `Tahrikli Matkap Ø${d}`, type: 'ldrill', unit: 'cross', dia: d, vc: 45 + d * 4, fz: +(0.01 + d * 0.006).toFixed(3), flutes: 2 } })),
    { label: 'Tahrikli kılavuz M4', p: { name: 'Tahrikli Kılavuz M4', type: 'ltap', unit: 'cross', dia: 4, pitch: 0.7, vc: 8 } },
  ] },
  { group: 'Kovan — matkap (eksenel ön, $1)', items: [2, 3, 4, 5, 6].map(d => ({ label: `Matkap Ø${d} (karbür)`, p: { name: `Matkap Ø${d}`, type: 'drill', unit: 'front', dia: d, vc: 45 + d * 3, feed: +(0.02 + d * 0.01).toFixed(3), xPos: -52 } })) },
  { group: 'Kovan — punta ve kılavuz (eksenel ön, $1)', items: [
    { label: 'Punta Ø4 90°', p: { name: 'Punta Ø4 90°', type: 'center', unit: 'front', dia: 4, tipAngle: 90, vc: 40, feed: 0.03, xPos: -52 } },
    { label: 'Punta Ø6 90°', p: { name: 'Punta Ø6 90°', type: 'center', unit: 'front', dia: 6, tipAngle: 90, vc: 40, feed: 0.03, xPos: -52 } },
    ...[[3, 0.5], [4, 0.7], [5, 0.8]].map(([d, pt]) => ({ label: `Kılavuz M${d}×${pt}`, p: { name: `Kılavuz M${d}x${pt}`, type: 'tap', unit: 'front', dia: d, pitch: pt, vc: 8, xPos: -52 } })),
  ] },
  { group: 'Karşı iş mili ($2)', items: [
    { label: 'Arka matkap Ø4', p: { name: 'Arka Matkap Ø4', type: 'drill', unit: 'back', dia: 4, vc: 50, feed: 0.06 } },
    { label: 'Arka punta Ø6', p: { name: 'Arka Punta Ø6', type: 'center', unit: 'rear', dia: 6, tipAngle: 90, vc: 40, feed: 0.03 } },
    { label: 'Arka kılavuz M5', p: { name: 'Arka Kılavuz M5', type: 'tap', unit: 'back', dia: 5, pitch: 0.8, vc: 8 } },
    { label: 'Arka tahrikli freze Ø4', p: { name: 'Arka Freze Ø4', type: 'endmill', unit: 'back', dia: 4, vc: 70, fz: 0.015, flutes: 3, live: true } },
    { label: 'Arka pah kateri V 35°', p: { name: 'Arka Pah Kateri', type: 'turn', unit: 'back', insertCode: 'VCGT 110302', insertShape: 'V', insertSize: 11, noseR: 0.2, vc: 120, feed: 0.03 } },
  ] },
];

/** Ünite başına takım numarası aralığı (Star yerleşimi) */
export const UNIT_NUMS = { gang: [1, 9], cross: [11, 19], front: [21, 29], rear: [31, 39], back: [41, 49] };

/** Malzeme kesme verileri (karbür uç; üretici kataloglarının orta değerleri, kayar otomat küçük çaplarına göre) */
export const MATERIALS = {
  free:  { label: 'Otomat çeliği (11SMnPb30, 9SMn28)', short: 'Otomat çeliği', vcRough: 180, vcFinish: 220, fRough: 0.12, fFinish: 0.05, apMax: 1.5, vcDrill: 70, vcMill: 110 },
  c45:   { label: 'Karbon çeliği (C45, 1040)',          short: 'C45', vcRough: 150, vcFinish: 190, fRough: 0.10, fFinish: 0.05, apMax: 1.2, vcDrill: 55, vcMill: 90 },
  alloy: { label: 'Alaşımlı çelik (42CrMo4, 4140)',      short: '42CrMo4', vcRough: 120, vcFinish: 160, fRough: 0.09, fFinish: 0.04, apMax: 1.0, vcDrill: 45, vcMill: 75 },
  ss:    { label: 'Paslanmaz (304 / 316L)',             short: 'Paslanmaz', vcRough: 110, vcFinish: 140, fRough: 0.08, fFinish: 0.04, apMax: 0.8, vcDrill: 30, vcMill: 60 },
  brass: { label: 'Pirinç (CuZn39Pb3)',                 short: 'Pirinç', vcRough: 250, vcFinish: 300, fRough: 0.12, fFinish: 0.05, apMax: 2.0, vcDrill: 90, vcMill: 180 },
  alu:   { label: 'Alüminyum (6061 / 7075)',            short: 'Alüminyum', vcRough: 300, vcFinish: 400, fRough: 0.12, fFinish: 0.06, apMax: 2.0, vcDrill: 120, vcMill: 250 },
  ti:    { label: 'Titanyum (Ti6Al4V)',                 short: 'Titanyum', vcRough: 50, vcFinish: 70, fRough: 0.08, fFinish: 0.04, apMax: 0.6, vcDrill: 20, vcMill: 40 },
  pom:   { label: 'Plastik (POM / PA)',                 short: 'Plastik', vcRough: 250, vcFinish: 300, fRough: 0.15, fFinish: 0.08, apMax: 2.0, vcDrill: 80, vcMill: 200 },
};

/** Talaş kırıcı (uç geometrisi) grupları — üretici kataloglarındaki uygulama aralıkları (dış tornalama, ortalama) */
export const CHIP_GEOS = {
  F: { label: 'F · finiş (küçük paso, düşük ilerleme)', f: [0.03, 0.15], ap: [0.1, 1.5] },
  M: { label: 'M · orta (genel amaçlı)', f: [0.08, 0.3], ap: [0.5, 3] },
  R: { label: 'R · kaba (büyük paso, güçlü kenar)', f: [0.2, 0.5], ap: [1.5, 6] },
  W: { label: 'W · silici (wiper: aynı yüzeyde 2× ilerleme)', f: [0.08, 0.4], ap: [0.3, 3] },
};
/** Uç tipine göre en fazla paso / kesme kenarı boyu oranı (yaklaşma açısı 93°) */
const AP_PER_L = { C: 0.66, D: 0.5, V: 0.25, K: 0.5, T: 0.5, W: 0.5, S: 0.66, R: 0.4 };

/** Kesici uç önerileri (Sandvik Coromant uç seçim kuralları): paso sınırı, rε ≤ ap, pozitif/negatif */
export function insertAdvice(t) {
  const key = insertShapeOf(t), S = INSERT_SHAPES[key];
  const L = t.insertSize > 0 ? t.insertSize : S.size, rn = t.noseR || 0.4;
  const code = parseInsertCode(t.insertCode || '');
  const neg = code ? code.clearance === 0 : false;
  const geo = CHIP_GEOS[t.chipGeo] || CHIP_GEOS.M;
  return {
    apMax: +(L * (AP_PER_L[key] ?? 0.5)).toFixed(2),
    apMin: +Math.max(rn, geo.ap[0]).toFixed(2),
    fMax: +Math.min(geo.f[1], (t.chipGeo === 'W' ? 0.8 : 0.5) * rn * 2).toFixed(3),
    negative: neg,
    lines: [
      `${S.label}: ${S.angle >= 80 ? 'büyük köşe açısı — güçlü kenar, yüksek ilerleme; kuvvet ve titreşim daha fazla' : S.angle <= 35 ? 'küçük köşe açısı — dar profillere erişim, düşük kuvvet; kenar daha zayıf ve ısıya duyarlı' : 'orta köşe açısı — erişim ile dayanım dengesi'}.`,
      `Kesme kenarı ${L} mm → en fazla paso ≈ ${(L * (AP_PER_L[key] ?? 0.5)).toFixed(2)} mm.`,
      `Burun radyüsü R${rn}: paso derinliği en az ${rn} mm olmalı (rε ≤ ap); titreşimde daha küçük radyüs seçin.`,
      neg ? 'Negatif uç (0° serbest açı): çift taraflı, güçlü kenar — dış ve ağır tornalama.' : code ? `Pozitif uç (${code.clearance}° serbest açı): düşük kesme kuvveti — hassas ve küçük parçalar için ilk tercih.` : '',
      `${geo.label}: ilerleme ${geo.f[0]}–${geo.f[1]} mm/dev, paso ${geo.ap[0]}–${geo.ap[1]} mm.`,
    ].filter(Boolean),
  };
}
/** Teorik yüzey pürüzlülüğü Ra (µm) ≈ f² / (32·rε) · 1000; silici uçta yaklaşık yarısı */
export function theoreticalRa(f, rn, wiper = false) { return (f * f) / (32 * Math.max(rn, 0.01)) * 1000 * (wiper ? 0.5 : 1); }

/** Kaba tornalama önerisi: malzeme + takım (uç açısı, burun radyüsü) + çubuk çapı */
export function suggestRough(matKey, tool, barDia, maxRpm = 8000) {
  const M = MATERIALS[matKey] || MATERIALS.free;
  const shape = INSERT_SHAPES[insertShapeOf(tool || {})];
  const k = !shape ? 1 : shape.angle <= 35 ? 0.75 : shape.angle <= 55 ? 0.9 : 1;   // dar uçta daha az paso
  const rn = tool?.noseR || 0.4;
  const adv = tool?.type === 'turn' ? insertAdvice(tool) : null;
  // paso: malzeme sınırı, uç kenar boyu sınırı (kenar boyu × oran), en az rε (rε ≤ ap kuralı)
  let ap = Math.min(M.apMax * k, Math.max(0.3, rn * 3.5), barDia / 8, adv ? adv.apMax : Infinity);
  if (adv) ap = Math.max(ap, Math.min(adv.apMin, adv.apMax));
  ap = Math.round(ap * 100) / 100;
  const feed = Math.round(Math.min(M.fRough, rn * 0.5, adv ? adv.fMax : Infinity) * 1000) / 1000;   // f ≤ 0.5·rε ve geometri aralığı
  const vc = M.vcRough;
  const rpm = Math.min(maxRpm, Math.round(vc * 1000 / (Math.PI * Math.max(barDia, 1))));
  return { ap, feed, vc, rpm, allowX: 0.2, allowZ: 0.05, finishFeed: M.fFinish, finishVc: M.vcFinish };
}

let _id = 0;
export function makeTool(p) {
  const t = {
    id: p.id || 'T' + (++_id) + '_' + Math.random().toString(36).slice(2, 6),
    num: 1, offset: null, name: '', type: 'turn', unit: 'gang',
    dia: 0, length: 40, noseR: 0.2, width: 0, pitch: 0, flutes: 2,
    vc: 120, feed: 0.05, fz: 0.02, tipAngle: 118, insertAngle: 35,
    yPos: 0, xPos: 0, color: null,
    ...p,
  };
  if (t.offset == null) t.offset = t.num;
  if (t.type === 'turn' && !INSERT_SHAPES[t.insertShape]) t.insertShape = shapeOfAngle(t.insertAngle);
  if (INSERT_SHAPES[t.insertShape]) t.insertAngle = INSERT_SHAPES[t.insertShape].angle;
  t.channel = UNITS[t.unit].channel;
  t.live = TOOL_TYPES[t.type].live || t.unit === 'cross' || (t.unit === 'back' && !!p.live);
  return t;
}

// Varsayılan takım listesi (örnek programla kesinleşecek numaralandırma)
export function defaultTools() {
  // Gang adımı 18 mm: Ø20 çubukta aktif takım merkezdeyken komşu takım (□12) çubuğa değmez (18−6 > 10).
  // Yerleşim Star SB-20R Type G fotoğrafına göre (operatörden bakışla soldan sağa 1…6, sağda çapraz blok 11–14,
  // tornalama takımlarının altında kovan takımları 24…21).
  // yPos: gang plakasında takımın yanal konumu (Y1 ofseti, mm). Arka takımlar: arka ünitede yanal konum.
  // xPos: takım ucunun tornalama ucu hattına göre radyal montaj konumu (mm, − = aşağı). X1 makine ofsetine girer.
  return [
    makeTool({ num: 1, name: 'Kaba Tornalama VCMT 35°', type: 'turn', unit: 'gang', insertCode: 'VCMT 110304', insertShape: 'V', insertSize: 11, noseR: 0.4, vc: 150, feed: 0.08, yPos: 110, insertAngle: 35 }),
    makeTool({ num: 2, name: 'İnce Tornalama VCGT 35°', type: 'turn', unit: 'gang', insertCode: 'VCGT 110302', insertShape: 'V', insertSize: 11, noseR: 0.2, vc: 180, feed: 0.03, yPos: 92, insertAngle: 35 }),
    makeTool({ num: 3, name: 'Kanal 2.0 mm', type: 'groove', unit: 'gang', width: 2, noseR: 0.1, vc: 90, feed: 0.03, yPos: 74 }),
    makeTool({ num: 4, name: 'Diş Kateri 60°', type: 'thread', unit: 'gang', noseR: 0.05, vc: 80, feed: 0, yPos: 56 }),
    makeTool({ num: 5, name: 'Kesme 2.0 mm', type: 'cutoff', unit: 'gang', width: 2, noseR: 0.1, vc: 80, feed: 0.025, yPos: 38 }),
    makeTool({ num: 6, name: 'Yedek Tornalama DCMT 55°', type: 'turn', unit: 'gang', insertCode: 'DCMT 11T302', insertShape: 'D', insertSize: 11, noseR: 0.2, vc: 150, feed: 0.05, yPos: 20 }),
    makeTool({ num: 11, name: 'Tahrikli Matkap Ø5', type: 'ldrill', unit: 'cross', dia: 5, vc: 60, fz: 0.04, flutes: 2, yPos: -20 }),
    makeTool({ num: 12, name: 'Parmak Freze Ø6', type: 'endmill', unit: 'cross', dia: 6, vc: 80, fz: 0.02, flutes: 3, yPos: -36 }),
    makeTool({ num: 13, name: 'Parmak Freze Ø4', type: 'endmill', unit: 'cross', dia: 4, vc: 70, fz: 0.015, flutes: 3, yPos: -52 }),
    makeTool({ num: 14, name: 'Tahrikli Matkap Ø3', type: 'ldrill', unit: 'cross', dia: 3, vc: 50, fz: 0.03, flutes: 2, yPos: -68 }),
    makeTool({ num: 21, name: 'Punta Ø6 90°', type: 'center', unit: 'front', dia: 6, tipAngle: 90, vc: 40, feed: 0.03, xPos: -52, yPos: 38 }),
    makeTool({ num: 22, name: 'Matkap Ø4', type: 'drill', unit: 'front', dia: 4, vc: 50, feed: 0.06, xPos: -52, yPos: 58 }),
    makeTool({ num: 23, name: 'Matkap Ø8', type: 'drill', unit: 'front', dia: 8, vc: 60, feed: 0.08, xPos: -52, yPos: 78 }),
    makeTool({ num: 24, name: 'Kılavuz M5x0.8', type: 'tap', unit: 'front', dia: 5, pitch: 0.8, vc: 8, xPos: -52, yPos: 98 }),
    makeTool({ num: 31, name: 'Arka Punta Ø6', type: 'center', unit: 'rear', dia: 6, tipAngle: 90, vc: 40, feed: 0.03, yPos: 40 }),
    makeTool({ num: 32, name: 'Arka Matkap Ø4', type: 'drill', unit: 'rear', dia: 4, vc: 50, feed: 0.06, yPos: 60 }),
    makeTool({ num: 41, name: 'Arka Matkap Ø6', type: 'drill', unit: 'back', dia: 6, vc: 50, feed: 0.06, yPos: -20 }),
    makeTool({ num: 42, name: 'Arka Pah Kateri', type: 'turn', unit: 'back', noseR: 0.2, vc: 120, feed: 0.03, yPos: 0 }),
    makeTool({ num: 43, name: 'Arka Kılavuz M6', type: 'tap', unit: 'back', dia: 6, pitch: 1.0, vc: 8, yPos: 20 }),
    makeTool({ num: 44, name: 'Arka Tahrikli Freze Ø4', type: 'endmill', unit: 'back', dia: 4, vc: 60, fz: 0.015, flutes: 3, live: true, yPos: -40 }),
  ];
}

export function findTool(tools, id) {
  return tools.find(t => t.id === id) || null;
}
