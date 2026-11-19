// Atölye şablonu (örnek cam dosyaları: ~95 çalışan P1/P2 çifti). Post profili dialect 'kayar' iken
// programın iskeleti birebir bu şablondur: P1 makro başlığı + N99 çevrim başı (çubuk dayama, G125 Z sıfırı),
// işlemler, N100 kesme bloğu (M82/M40 senkronlu), M99P99 dönüş. P2: G130 arka işlemler (önceki parça),
// T2900 parça atma, N100 G131 yakalama, M99.
const f3 = (v) => { const s = (Math.round(v * 1000) / 1000).toString(); return s.includes('.') ? s : s + '.'; };
const g = (v) => (Math.round(v * 1000) / 1000).toString();

/** P1 başlığı: makro değişkenleri ve çevrim başı (çubuk dayama → Z sıfırı) */
export function p1Head(prog, { barDia, L, cutRpm, cutW, cutFeed, faceStock }) {
  const fs = Math.max(0.05, faceStock || 0.2);
  for (const t of [
    '(MAIN TARAFI BASLANGIC)',
    `#531=${g(barDia + 1)}(MALZEME CAPI +1MM)`,
    `#530=${g(L)}(PARCA BOYU)`,
    `#529=${Math.round(cutRpm)}(KESME DEVRI)`,
    '#524=-0.5(X- INECEGI MESAFE)',
    `#528=${g(cutW)}(KESME UC GENISLIGI)`,
    '#525=15(GUVENLIK MESAFESI)',
    `#522=${g(cutFeed)}(KESME ILERLEMESI)`,
    '#2601=[-205.+[#530+#528+#525]]',
    'G28U0(X REFERANS)',
    'T200',
    'M98P9012(BASLANGIC KESME PRG)',
    'N99',
    'G97G80G40M9(IPTALLER)',
    'G99(G98 IPTALI)',
    'M38(CANLI TAKIM DURDURMA)',
    'M3S50',
    'G18(XZ DUZLEMI)',
    'M62(TORK ACMA ITME)',
    'M11(AYNA ACMA)',
    'G4X0.5(BEKLEME)',
    `G0Z-${g(fs)}T0(G125 ILE AYNI OLCK)`,
    `G125Z-${g(fs)}(Z SIFIR ALMA)`,
    'G4X0.5',
    'M10(AYNA KAPAMA)',
    'M63(TORK KAPATMA)',
    'G4U0.3',
    'G0W-12.',
    'M5',
    'M27(PARCA KONTROL)',
    'G0X50.',
    'M200(BEKLEME)',
    'M20(ONE CYCLE)',
    '/M25(YAG ACMA)',
    `#120=${g(fs > 0.1 ? 0.1 : fs)}(PARCA BOYU)`,
  ]) prog.raw(t);
}

/** P1 kesme bloğu (N100): karşı iş mili varsa M82/M40 ile senkron kesme */
export function p1Cut(prog, { tool, cutX0, endX, feed, pick, backStock }) {
  const T = String(tool.num).padStart(1, '0');
  prog.raw('N100(BURADA-BITIR)');
  prog.raw(`T${tool.num}00(C/OFF)`);
  prog.raw('/M25');
  prog.raw('M3S#529');
  prog.raw(`G0G99X[#531+1.]Z[#530+#528+#120${backStock > 0 ? '+' + g(backStock) : ''}]T${T}`);
  if (pick) { prog.raw('M82(SPINDELLER SENKRON DONUS)'); prog.raw('M40(Z EKSENLERI SENKRON CALISMA)'); }
  prog.raw(`G1X${f3(cutX0)}F${g(2 * feed)}`);
  prog.raw(`X${f3(endX)}F${g(feed)}`);
  if (pick) { prog.raw('M41(Z SENKRON CALISMA IPTALI)'); prog.raw('M83(SPINDEL SENK DONUS IPTALI)'); }
  prog.raw('M80(CUBUK KNTRL BARFEEDER)');
  prog.raw('/M98P7000(CUBUK DEGISIMI)');
  prog.raw('M81(CUBUK KNTRL IPTAL BARFEEDER)');
  prog.raw('M99P99(P99 GORDUGUNDE N99 A ATLAR)');
  prog.raw('(MAIN TARAFI BITIS)');
}

/** P2 başlığı: G130 arka işleme çerçevesi; #530 = parça yakalama boyu (karşı mil parçayı ön alından bu kadar tutar) */
export function p2Head(prog, { grip }) {
  for (const t of [
    '(SUB TARAFI BASLANGIC)',
    `#530=${g(grip)}(PARCA YAKALAMA)`,
    'G130(YAKALAMA Z SIFIR IPTALI)',
    'G99M5',
    'G0T0',
    'G40',
    'G28W0.',
    'T2000',
    'M200',
    'M20(ONE CYCLE)',
    '/M25',
  ]) prog.raw(t);
}

/** P2 parça atma (T2900): pens kapa-aç ile sarsma, hava */
export function p2Eject(prog, { blow = 0.5 } = {}) {
  prog.raw('(BURAYA KADAR)');
  for (const t of ['T2900(PARCA-ATMA)', 'G0Z40', 'M5', 'M10', 'M14', 'M11', `G4X${g(blow)}`, 'M10', 'M11', `G4X${g(blow)}`, 'M15', 'G28W0', 'M5']) prog.raw(t);
}

/** P2 parça yakalama (N100, G131: ana mil sıfırı karşı mile) */
export function p2Pick(prog, { feed = 1.5 } = {}) {
  for (const t of [
    'N100',
    'G0G98',
    'T2000',
    'G28W0.',
    'G99M4S50',
    'M11',
    'G4U0.4',
    'M82',
    'G131(MAIN SIFIRI SUBTA TANIMA)',
    'G0Z-30(GUVENLI YAKLASMA)',
    'M14(HAVA UFLEME ACMA)',
    'M68(ZORLAMA LIMITI ACMA)',
    `G1G99Z#530F${g(feed)}`,
    'M69(ZORLAMA LIMITI KAPAMA)',
    'M10(AYNA KAPATMA)',
    'G4U0.5',
    'M15(HAVA UFLEME IPTAL)',
    'M40(Z EKSENLERI SENKRON CALISMA)',
    'M41(Z SENKRON CALISMA IPTALI)',
    'M68(ZORLAMA LIMITI ACMA)',
    'G0G99W-20.',
    'M69(ZORLAMA LIMITI KAPAMA)',
    'M83(SPINDEL SENK DONUS IPTALI)',
    'G0',
    'G28W0.',
    'M99',
  ]) prog.raw(t);
}
