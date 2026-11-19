// Program koordinatı ↔ makine ekseni dönüşümleri (simülasyon modeli).
// Dünya: x = eksenel (karşı iş miline doğru +), y = yukarı, z = operatöre doğru.
// Kanal 1: kesme düzlemi x=0 (gang takım uçları), parça ön alnı x = Z1.
// Kanal 2: G54 transfer çerçevesi (Z2 = karşı iş mili alın konumu, X2 = yanal),
//          G55 arka işleme çerçevesi (Z = arka alından derinlik, X = takım çapı konumu).

export const LAYOUT = {
  bushFace: -3.2,     // kılavuz burç alnı (dünya x)
  backToolX: 130,     // arka ünite takım uçları (dünya x), +x yönüne bakar
  backLat: 0,         // arka ünite yanal referansı (dünya z): takımın yPos'u karşı iş milinin X2 konumudur
};

const gangTool = (t) => t && (t.unit === 'gang' || t.unit === 'cross' || t.unit === 'front') ? t : null;

export function makeFrames({ L, grip, zShift = 0, subHome = 200 }) {
  let p = L - grip; // karşı iş milinden dışarı taşan parça boyu
  return {
    get projection() { return p; },
    /** gerçek programda $2 #530 (parça yakalama) = karşı milin parçayı ön alından tuttuğu boy → taşan boy L − #530 */
    setGrip(v) { if (Number.isFinite(v) && v > 0 && v < L) p = L - v; },
    /** G131 (ana mil sıfırı karşı mile): ana milin kesme konumu (parça ön alnı dünya x) */
    pickRef: null,
    toMachine(ch, pos, st) {
      if (ch === 1) {
        const g = gangTool(st.tool);
        return { X: pos.X - 2 * (g ? g.xPos || 0 : 0), Y: pos.Y - (g ? g.yPos : 0), Z: pos.Z + zShift + (st.extZ || 0), C: pos.C };
      }
      if (st.wo === 'G55') {
        const lat = LAYOUT.backLat + (st.tool ? st.tool.yPos : 0);
        return { X: lat - pos.X / 2, Y: 0, Z: LAYOUT.backToolX - pos.Z + p, C: pos.C };
      }
      if (st.wo === 'G131') return { X: pos.X, Y: 0, Z: (this.pickRef ?? L + 2) - pos.Z, C: pos.C };
      if (st.wo === 'T29') return { X: pos.X, Y: 0, Z: subHome - pos.Z, C: pos.C };   // parça atma: Z = evden ana mile doğru mesafe
      return { X: pos.X, Y: 0, Z: pos.Z, C: pos.C };
    },
    fromMachine(ch, m, st) {
      if (ch === 1) {
        const g = gangTool(st.tool);
        return { X: m.X + 2 * (g ? g.xPos || 0 : 0), Y: m.Y + (g ? g.yPos : 0), Z: m.Z - zShift - (st.extZ || 0), C: m.C };
      }
      if (st.wo === 'G55') {
        const lat = LAYOUT.backLat + (st.tool ? st.tool.yPos : 0);
        return { X: 2 * (lat - m.X), Y: 0, Z: LAYOUT.backToolX + p - m.Z, C: m.C };
      }
      if (st.wo === 'G131') return { X: m.X, Y: 0, Z: (this.pickRef ?? L + 2) - m.Z, C: m.C };
      if (st.wo === 'T29') return { X: m.X, Y: 0, Z: subHome - m.Z, C: m.C };
      return { X: m.X, Y: 0, Z: m.Z, C: m.C };
    },
  };
}
