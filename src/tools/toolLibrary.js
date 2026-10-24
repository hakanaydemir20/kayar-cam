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
    makeTool({ num: 1, name: 'Kaba Tornalama VCMT 35°', type: 'turn', unit: 'gang', noseR: 0.4, vc: 150, feed: 0.08, yPos: 110, insertAngle: 35 }),
    makeTool({ num: 2, name: 'İnce Tornalama VCGT 35°', type: 'turn', unit: 'gang', noseR: 0.2, vc: 180, feed: 0.03, yPos: 92, insertAngle: 35 }),
    makeTool({ num: 3, name: 'Kanal 2.0 mm', type: 'groove', unit: 'gang', width: 2, noseR: 0.1, vc: 90, feed: 0.03, yPos: 74 }),
    makeTool({ num: 4, name: 'Diş Kateri 60°', type: 'thread', unit: 'gang', noseR: 0.05, vc: 80, feed: 0, yPos: 56 }),
    makeTool({ num: 5, name: 'Kesme 2.0 mm', type: 'cutoff', unit: 'gang', width: 2, noseR: 0.1, vc: 80, feed: 0.025, yPos: 38 }),
    makeTool({ num: 6, name: 'Yedek Tornalama', type: 'turn', unit: 'gang', noseR: 0.2, vc: 150, feed: 0.05, yPos: 20 }),
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
