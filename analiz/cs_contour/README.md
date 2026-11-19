# cs_contour — C ekseni (Cs kontur) frezeleme matematiği

Yalnız kayar otomat (Star SB-20R Type G, FANUC 0i-TF). Çapraz canlı takımlar (ER11/ER16,
X1 üzerinde radyal, Y1 stroku ≈ ±20 mm) ve ön/arka eksenel canlı takımlar; ana iş mili C1,
X1/Z1/Y1 ile birlikte. Post doğrulanmadı (`verified: false`) — çıktılar taslaktır.

Dosyalar: `transforms.py` (dönüşümler), `gcode.py` (parçacıklar), `selection.py`
(`choose_method`), `tests/test_cs.py`. Çalıştırma (kayar-cam içinden):
`python -m pytest analiz/cs_contour/tests -q`

## İşaret kuralları (JS uygulamasıyla aynı)

- X **çap**, Z eksenel, C derece, Y çapraz takımın merkezden kaçıklığı.
- **C = −θ**: C açısındaki takım, parçanın θ = −C açısındaki noktasını keser
  (`stockSim.js`, `simMill.js`). `part_*` fonksiyonları θ, makine fonksiyonları C alır.
- Polar hipotetik düzlem `interpreter.js` `polarMove` ile aynı: x = X/2, y = programdaki C (mm),
  C° = atan2(y, x) (makine çerçevesi). Parça çerçevesi için `part_face_to_machine` (y işareti ters).
- C sürekli tutulur: ardışık |ΔC| ≤ 180 (`unwrap_deg`); helis/turda 360'ı aşar.

## 1. Silindirik interpolasyon (G7.1 / G107) — çap yüzeyinde

Radyal çapraz takım; kama kanalı, helis/kam kanalı, gravür. Silindir açılır:

```
        θ                               u = r·θ  (mm)
   .-""""-.          açılım       +---------------------+
  /   r    \        ------->      |   kanal (Z, u)      |  Z
  \        /                      +---------------------+
   '-....-'                        0                2πr
```

`G7.1 C{r}` … `G7.1 C0`. Program (Z, C) ile; C referans yarıçapta yay boyu C_mm = r·θ,
kontrol C° = C_mm / r · 180/π'ye çevirir. X kanal derinliğinde sabit. G41/G42 açılmış
düzlemde. Kanal genişliği = takım çapı (ya da ofset pasoları). JS `GEN.cylSlot` aynı yapıdadır.
Helis: z = z0 + lead·θ/2π, helis açısı tan β = 2πR/lead.

### Kanal yan duvarı — neden “paralel” değil?

Takım ekseni radyal. Genişlik w > takım çapı 2rt ise ofset pasosu G7.1'de **C döndürerek**
(φ açısı) yapılır; takımın yan yüzü de döner:

```
   ideal kama:  |   |      C-ofset ile:  \   /     y(ρ) = √(ρ² − rt²)·sin φ + rt·cos φ
                |   |                     \ /       φ = (w/2 − rt)/R   (G7.1 telafisi)
                |___|                      ‾
```

Sapma e(ρ) = y(ρ) − w/2 dibe doğru negatif (kanal daralır). Örnek R=6, w=4, d=2, rt=1.5:
G7.1 telafisinde yüzeyde −0.022, dipte −0.197 mm; yüzeyde tam (exact) φ ile dipte −0.183 mm.
Gerçek kamada kabul edilemez.

**Y-ofset düzeltmesi** (`keyway_y_offsets`): C kilitli (M6), takım Y = ±(w/2 − rt) kayar →
duvar y = ±w/2, ρ'dan bağımsız, **tam paralel**; taban x = R − d düz düzlem.
Koşul |Y| + rt ≤ Y stroku.

## 2. Polar koordinat interpolasyonu (G12.1 / G112, iptal G13.1 / G113) — alın yüzeyinde

Eksenel (ön/arka) takım; alın düzlüğü, altıgen, alın kanalı. Kartezyen (x, y) →

```
  X = 2·√(x² + y²)     C = atan2(y, x)      (ters: x = X/2·cos C, y = X/2·sin C)
```

- **Tekillik**: merkez (ρ→0) civarında C hızı ω = F/ρ_min sınırsız büyür. `polar_c_speed`
  en yakın noktayı ve izinli ilerlemeyi verir: F_izin = ω_max·2π·ρ_min.
- **Sıklaştırma** (`densify_polar`): G12.1 kullanılmazsa (X, C doğrusal enterpolasyon)
  doğru bir spirale dönüşür; parçalar sapma ≤ kiriş toleransı ve |ΔC| ≤ 30° olacak şekilde
  ikiye bölünür. Merkezden geçen parça hata verir.
- JS `GEN.backPolar` (arka çokgen) bu kuralları kullanır.

## 3. Y ekseni yöntemi (atölyenin gerçek programları)

C indekslenir ve kilitlenir (`G0C..` + `M6`, çözme `M7`), takım `T3100` / `G0X..Z..T31`,
`M36S2800` canlı takım, `M38` durdurma. Y-Z düzleminde yay: `G19` + `G2Y..Z..J..K0`
(O112233B stili). Tam tur frezeleme: C serbest, artımsal `H365F1500` (OFREZE stili).
Düz tabanlar ve duvarlar tam; tekillik yok. Sınır: Y stroku ≈ ±20 mm.

## 4. Çapraz delikler

`cross_hole_machine`: C = −θ, Y kaçıklığı varsa giriş x_e = √(R² − Y²), X_dip = 2(x_e − derinlik).
Düzlükte delik (`hole_on_flat`): giriş X = 2·düzlük mesafesi (Y ne olursa olsun).
Genel ters dönüşüm: `machine_to_part_point` / `part_point_to_machine`
(ρ² = (X/2)² + Y², −C = atan2(yp, xp) − atan2(Y, X/2)).

## 5. İlerleme (F)

- **G98, G7.1 kapalı, Z+C birlikte**: FANUC dereceyi mm sayar,
  süre = √(ΔZ² + ΔC°²)/F. Yüzeyde f için
  `F = f · √(ΔZ² + ΔC°²) / √(ΔZ² + (r·ΔC·π/180)²)` (`feed_g98_cz`). Yalnız C: F = f·180/(πr).
- **G7.1 içinde** F = referans yarıçap yüzey hızı; kanal dibinde (r_cut) f için
  F ≈ f·r_ref/r_cut (`feed_g71`).

## 6. Hangi yöntem? (`choose_method`)

| Özellik | Yöntem | Neden |
|---|---|---|
| Helis / gravür | silindirik G7.1 | Z ve C sürekli birlikte |
| Kama, w = takım çapı | indeks (C kilitli) | tek paso, duvarlar paralel, rijit |
| Kama, w > takım çapı | Y ekseni | duvar paralelliği; G7.1 C-ofseti duvarı eğer |
| Kama, Y stroku yetmez | G7.1 + G41/G42 | duvar sapması raporlanır |
| Çapraz delik / düzlük | indeks + Y | tam düz, kısa çevrim |
| Alın çokgeni | polar G12.1 | tek kontur, tek kurulum |
| Alın konturu merkezden geçer | Y ekseni (C kilitli) | polar tekillik |
| Alın, Y stroku aşılır | polar G12.1 | strok |
