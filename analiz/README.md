# kayar_model — Kayar otomat kesme analizi (Python)

Star SB-20R Type G tipi **kayar otomat** (kayar fener + kılavuz burç) için kesme kuvveti,
sapma, yüzey pürüzlülüğü ve çap hatası tahmini. Yalnız kayar otomat modellenir.

**Birimler:** mm, mm/dev, m/dak, dev/dak, N, MPa (N/mm²), s; Ra/Rz µm.

## Modüller
| Dosya | İçerik |
|---|---|
| `materials.py` | Uygulamadaki `MATERIALS` tablosu + Kienzle sabitleri (kc1.1, mc), itme oranı, E |
| `kinematics.py` | n = 1000·vc/(π·D), vf = f·n; `generate_pass()` zaman örneklenmiş paso |
| `forces.py` | Kienzle kuvvet modeli, uç radyüsü düzeltmesi, talaş açısı/aşınma çarpanları |
| `bush.py` | Takılabilir destek: `BushSupport` (kılavuz burç), `ColletSupport` (alt fener pensi) |
| `surface.py` | Ra/Rz, titreşim payı, ISO 286 IT toleransı |
| `analysis.py` | `analyze_pass()`, `analyze_samples()` |
| `paths.py` | İki kanal: `MainPath` ($1) ve `SubPath` ($2), `run_paths()`; `DrillOp(peck=, cycle=, q=, retract=)` |
| `chips.py` | Talaş formu (talaş kırıcı penceresi), LFV osilasyonu, kesintili ilerleme, G-kodu |
| `drilling.py` | Matkap itme/moment, G83/G73 gaga planı, Q önerisi, pens kayma kontrolü, kılavuz momenti, G-kodu |

## Kinematik
Takım Z'de sabittir; Z1 ekseni çubuğu burçtan dışarı iter. Kesme burç alnının ~0–3 mm önündedir
(uygulamada burç alnı x = −3.2 mm). L_o = burç alnından kesme noktasına mesafe; paso boyunca
`overhang_start → overhang_end` doğrusal değişir. Klasik kayar tornalamada L_o neredeyse sabittir;
büyüyen L_o, burçtan uzakta kesme veya geri çekilerek yapılan işlemleri temsil eder.

## Kuvvetler (Kienzle)
Fc = kc1.1 · b · h^(1−mc) · K_γ · K_VB,  h = f·sin κ,  b = ap/sin κ

- κ, **eşdeğer yaklaşma açısıdır** (Colwell kirişi): ap küçükken (ap < rn) yalnız uç radyüsü çalışır,
  κ düşer → h küçülür, radyal kuvvet payı artar.
- İtme kuvveti Ft = oran·Fc; Ff = Ft·sin κ, Fp = |Ft·cos κ| (en az 0.10·Fc).
- K_γ = 1 − 0.015·(γ − 6°), K_VB = 1 + VB.
- Sabitler **yaklaşıktır** (König/Klocke, Sandvik, VDI 3323 tipik değerleri); ±%20 sapabilir.

| Malzeme | kc1.1 | mc | E (GPa) |
|---|---|---|---|
| Otomat çeliği | 1350 | 0.20 | 210 |
| C45 | 1600 | 0.25 | 210 |
| 42CrMo4 | 1800 | 0.26 | 210 |
| Paslanmaz | 2000 | 0.21 | 193 |
| Pirinç | 780 | 0.18 | 100 |
| Alüminyum | 700 | 0.25 | 70 |
| Titanyum | 1400 | 0.23 | 114 |
| POM | 200 | 0.20 | 3 |

## Destek ve sapma
**Kılavuz burç (Path 1):** δ = Fp·L_o³/(3EI) + Fp/k_burç + c·(1 + 2·L_o/L_burç), I = πD⁴/64.
Son terim, çubuğun c boşluğu içinde burç boyunca eğilmesidir. Tipik c: döner burç 0.005,
sabit burç 0.010, h9 çubukta 0.020 mm. Çap hatası = 2·δ.

**Pens (Path 2):** burç yok; çıkıntı = parça boyu − kavrama boyu g.
δ = Fp·L³/(3EI) + Fp/k + 12·Fp·L²/(k·g²) (pens içinde dönme). Kısa g → daha fazla sapma.

## Yüzey
Ra_kin = f²/(32·rn), Rz_kin = f²/(8·rn). **Varsayım:** kuvvet ±%10 dalgalanır ve burçta bar
boşluğun %30'u kadar gezinir; tepe-tepe titreşim Δ için Ra_vib = Δ/π, Rz_vib = Δ.
Ra = √(Ra_kin² + Ra_vib²), Rz = Rz_kin + Δ. Δ = 2·fluct·(δ_eğilme+δ_temas) + 0.1·c·(1+2L/L_burç):
boşluk payı statik ofsettir (bar bir yana yaslı), kuvvet dalgalanmasıyla ölçeklenmez. Tolerans: IT derecesi (`it_grade`) veya `tolerance` (mm).

## Talaş boyu kontrolü (`chips.py`)
**Doğal talaş formu** `chip_form(malzeme, f, ap, kırıcı)`: kırıcılar (`sharp`, `F`, `M`, `R`) f/ap
uygulama pencereleridir. Skor = (h/h_kır)·min(1.5, ap/ap_min)^0.3·(1−0.7·süneklik)/0.5, h = f·sin κ,
h_kır = f_min·sin κ. Skor ≥ 1 → kısa/kırık, ≥ 0.6 spiral, aksi sürekli. Süneklik indeksi (otomat çeliği
0.25, pirinç 0.15 … paslanmaz 0.9, POM 1.0) **yaklaşıktır**; otomat çeliği/pirinç her zaman kırılır kabul edilir.

**LFV osilasyonu** `oscillate(f, n, A, R, boy, D)`: z(θ) = f·θ/2π + A·sin(R·θ). Yüzey hafızası
S(φ) = önceki tüm devirlerde aynı açıdaki en ileri z; anlık eksenel talaş kalınlığı h = max(0, z − S).
h = 0 → hava kesmesi → talaş kırılır. Analitik koşul (tek devir hafızası):
**f − 2A·|sin(πR)| < 0**, yani yarım-tamsayı R'de A > f/2, tamsayı R'de asla. Talaş boyu = kesintisiz
segmentin yay boyu / λ (λ = 2 sıkışma oranı, varsayım). `apply_oscillation(samples, …)` mevcut
`PassSamples`'ı ince örnekler (devir başına 72 nokta); `f` = anlık h, `cutting` = h > 0. LFV'de ilerleme
sabit olduğundan ek süre 0 kabul edilir.

**Kesintili ilerleme** `interrupted_feed(boy, N, f, n, D, retract, dwell_rev)`: her N mm'de dur,
Z'de r kadar G0 geri, G1 ile dön. Talaş boyu = π·D·(N/f)/λ. Kesinti başına ek süre
= dwell·60/n + r/G0 + r/(f·n)·60 + 0.02 s. `interrupted_samples()` bu boşlukları `PassSamples`'a ekler.
`gcode_interrupted_turning()` artımsal `G1W-N` / `G0W r` / `G1W-r` satırları üretir.

**Kuvvet/burç etkisi** `oscillation_effect(...)`: osilasyonlu örnekler `analyze_samples`'a verilir.
**Varsayım:** etkin kuvvet dalgalanması fluct = max(0.1, ptp(Fp)/(2·Fp_max)); hava kesmesi varsa ≥ 0.5
(çubuk burç boşluğunda her osilasyonda boşalıp yüklenir → titreşim pp = 2·fluct·δ_max + burç gezinmesi).
Yüzey izi yine devir başına f'dir (son geçiş belirler); Ra = √(Ra_kin² + (pp/π)²). Çap hatasına pp/2 eklenir.
Sonuç: osilasyon talaşı kırar fakat Ra ve çap hatasını büyütür.

## Delme (`drilling.py`)
- Ağız başına Kienzle (118° matkap, κ = 59°): h = (f/2)·sin κ, b = (D/2)/sin κ, Fc1 = kc1.1·b·h^(1−mc).
- Moment M = Fc1·D/2. İtme = 2·oran·Fc1·sin κ + keski ağzı F_ch = 1.5·kc1.1·(r·D)·(f/2)^(1−mc);
  r = 0.06 göbeği inceltilmiş karbür (varsayılan, `point="thinned"`), 0.18 klasik HSS (`"conventional"`).
- Gagalama gerekliliği: L/D > sınır (otomat 4, pirinç 5, C45/42CrMo4 3, paslanmaz 2.5, Ti 2).
  Önerilen Q = D·k_malz·c(L/D) (c: 1 / 0.7 / 0.5; L/D ≤5 / ≤8 / >8). `recommend_cycle`: sığda G73, derinde G83.
- `peck_schedule(derinlik, q, f, n, 'g83'|'g73', retract=d, clearance, decay)`: G83 her gagada R
  noktasına tam geri; G73 yalnız d kadar. Azalan gaga q_i = max(q_min, q·decay^i). Süre = G1 yolu/(f·n)
  + G0 yolu/24000 mm/dak + 0.03 s/gaga.
- **Eksenel yük:** Path 1'de matkap sabit, çubuk Z1 ile itilir → itme ana fener pensine gider (burç
  radyal destektir). Path 2'de Z2 parçayı matkaba sürer → itme parçayı pense iter.
  `collet_slip_check`: tutma = μ·F_sıkma·min(1, g/10), moment tutma = tutma·D/2; itme·2 > tutma → kayma
  uyarısı (μ = 0.15, F_sıkma 6 kN alt / 12 kN ana — **varsayım**, makineye göre ölçülmeli).
- Kılavuz momenti (basit): M ≈ P·kc1.1·D²/8 [N·mm].
- G-kodu: `gcode_peck_front(12, ...)` → `T1200 / M3S.. / G0X0Y0T12 / G99G1Z-0.5F0.5 / Z0F0.04 /
  G83Z..Q<µm>F.. / G80 / G0Z-5 / G0T0`; `gcode_peck_back(22, ...)` → `T2200 / T22 / G99G0Z-5 / G1Z0F.. /
  G83W..Q<µm>F.. / G80 / G0Z-5 / G28W0. / G0T0`.

`DrillOp(..., peck=True, cycle='g73', q=0.8)` her iki yolda çalışır; akışa gaga/geri çekme örnekleri
ve kayma uyarıları eklenir.

## Doğrulama ve kalibrasyon (`tests/test_validation.py`, `tools/realcheck.py`)
| Büyüklük | Model | Referans | Fark |
|---|---|---|---|
| kc1.1 (C45 / 42CrMo4 / paslanmaz / Ti / pirinç / Al) | 1600/1800/2000/1400/780/700 | Sandvik kc1 ≈ 1600/1950/2000/1400/700/650 | ≤ %12 |
| Tornalama gücü C45 vc200 ap3 f0.3 | 6.48 kW | Sandvik Pc formülü 6.49 kW | %0 (aynı formül) |
| Ff/Fc, Fp/Fc (κ95, ap2, rn0.4) | 0.49 / 0.10 (alt sınır) | König: 0.3–0.5 / 0.1–0.35 | aralıkta |
| Ra kin. f0.2 rn0.8 | 1.56 µm | f²/(32rn) ders kitabı, Sandvik ≈1.6 | %0 |
| Matkap momenti C45 Ø10 f0.2 vc80 | 7.4 N·m | Sandvik Mc 7.4 N·m | %0 |
| Matkap itmesi (aynı) | 1.52 kN (inceltilmiş) | Sandvik Ff ≈ 0.5·kc·D/2·f·sinκ = 1.27 kN | +%20 (önce +%60 → düzeltildi) |
| Burç boşluğu | 0.005–0.020 mm | Star/Tsugami ayar önerileri 0.005–0.01 (taşlanmış çubuk) | aralıkta |

**Kalibrasyon (gerçek atölye programları, `python analiz/tools/realcheck.py [--material c45]` → `analiz/out/realcheck.md`):**
- `ap_max` uyarısı fazla muhafazakârdı (atölye ap 2–6 mm @ f 0.02 kullanıyor; 194/490 işlem bayraklanıyordu).
  Artık talaş kesiti ap·f > 2·ap_max·f_rough (`SWISS_AREA_FACTOR`) ise uyarır.
- Burç gezinme payı `noise_frac` 0.3 → 0.1 ve titreşimde boşluk payı kuvvetle ölçeklenmez: f 0.02'de Ra 1.9 → 0.4 µm
  (kayar otomat finişinde tipik 0.2–0.8 µm).
- Matkap keski ağzı: inceltilmiş uç varsayılan (yukarıdaki tablo).
- Sonuç (C45 varsayımı): 245 tornalama + 91 delme işleminden 2 bayrak — ikisi de f 0.15 kaba paso Ra > 3.2 µm
  (kinematik olarak doğru; kaba pasoda Ra sınırı geçerli değil). Delmelerde pens kayması yok (itme ≤ ~200 N).
  Atölyenin gaga Q değerleri (0.05–0.2·D) modelin önerisinden (≈D) çok daha küçüktür; model daha cesur Q önerir.
- Senkron: eşi olmayan veya sırası farklı senkron kodları `Stream.warnings`'e yazılır.

## Kullanım
```python
from kayar_model import analyze_pass, run_paths, TurnOp, DrillOp, SyncOp
r = analyze_pass("c45", bar_dia=10, ap=1.0, f=0.1, vc=150, rn=0.4, kappa_deg=95,
                 bush_clearance=0.01, overhang_start=1, overhang_end=3, it_grade=7)
print(r.forces.Fc.max(), r.dia_error_max, r.ra_max, r.warnings)

res = run_paths([TurnOp("c45", 10, 1.0, 0.1, 150), SyncOp("M82")],
                [DrillOp("c45", 3, 5, 0.05, 50), SyncOp("M82")], shared_dt=0.01)
```
İki yol `ThreadPoolExecutor` ile bağımsız hesaplanır; aynı koddaki `SyncOp`'lar (M82/M40/M41 gibi)
eşlenir, erken gelen yol bekletilir. `shared_dt` ile iki akış ortak zaman eksenine örneklenir.

## Testler
`kayar-cam` klasöründen: `python -m pytest analiz/tests -q`
