// İşlem üreteçleri için ortak bağlam ve geometri hazırlığı.
import { sampleProfile, turnableEnvelope } from '../geom/sampled.js';
import { insertEdges } from '../tools/toolLibrary.js';

export const DZ = 0.001; // profil örnekleme adımı (mm)

export function buildContext(project) {
  const { part, stock, tools, machine } = project;
  const L = part.length;
  const cutoff = tools.find(t => t.type === 'cutoff');
  const w = cutoff ? cutoff.width : 2;
  const barR = stock.barDia / 2;
  // gerçek profil: z<0 → 0 (ön boşluk), z∈[L, L+0.6w] son çap uzatılır (kesme bölgesi), sonra çubuk
  const pts = part.profile.filter(p => !(p.z >= L - 1e-9 && p.r === 0));
  const last = pts[pts.length - 1];
  const ext = [...pts, { z: L + 0.6 * w, r: last.r }, { z: L + 0.6 * w, r: barR }, { z: L + w + 2, r: barR }];
  const z0 = -2, z1 = L + w + 2;
  const real = sampleProfile(ext, z0, z1, DZ, 0);
  for (let i = 0; i < real.n; i++) if (real.zAt(i) < 0) real.r[i] = 0;
  return {
    project, part, stock, tools, machine, L, barR, cutW: w, real,
    zEnd: L + 0.5 * w,
    envelopeFor(tool) {
      // arka kenar serbest açısı ve ana kenarın öne eğimi ucun gerçek geometrisinden (insertEdges = çizim = kesme modeli);
      // arka kenarla parça arasında en az 2° boşluk bırakılır (sürtme olmaz)
      const E = tool.type === 'turn' && (tool.insertShape || tool.insertAngle) ? insertEdges(tool) : { back: 180 - 93 - (tool.insertAngle || 35), front: 0 };
      const back = tool.backAngle ?? (E.round ? 89 : Math.max(1, E.back - 2));
      return turnableEnvelope(real, back, E.round ? 0 : E.front);
    },
    /** z konumundaki parça yarıçapı (bitmiş) */
    rAt(z) { return real.at(z); },
    safeX: stock.barDia + 2,
    grip: 6,          // karşı iş milinde tutma boyu (buildProgram ayarlar)
    backStock: 0,     // kesmede arka alın payı (buildProgram ayarlar)
    /** Arka (G55) çerçevede profil: z' = L − z (arka alından derinlik). z' < 0 boşluk. */
    backProfile() {
      const pts = part.profile.map(p => ({ z: L - p.z, r: p.r })).reverse();
      const b = sampleProfile(pts, -2, L + 2, DZ, 0);
      for (let i = 0; i < b.n; i++) if (b.zAt(i) < 0 || b.zAt(i) > L) b.r[i] = 0;
      return b;
    },
  };
}
