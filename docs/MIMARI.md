# Kayar CAM — Teknik Mimari Belgesi (Taslak 1, onay bekliyor)

Makine: **STAR MICRONICS SB-20R TYPE G — Variation 04** (kartuş tipi 5 milli çapraz delme ünitesi)
Kontrol: **FANUC 0i-TD**
Kapsam: Yalnız bu makine. Genel amaçlı CAM değildir.

> Bu belge **öneri**dir. Onay verilmeden bir sonraki aşamaya (uygulama) geçilmez.
> Kaynağı olmayan hiçbir ölçü, strok, takım konumu ya da M kodu yazılmamıştır; bunlar
> `docs/makine-yapilandirma.md` içinde **BİLİNMİYOR** olarak listelenir.

---

## 1. Mevcut depo — inceleme özeti

| Klasör | İçerik | Durum |
|---|---|---|
| `src/ops/` | Takım yolu üreteçleri (alın, kaba/ince tornalama, kanal, diş, delme, frezeleme, simültane 4 eksen, karşı mil işlemleri), işlem sırası (`program.js`), atölye şablonu (`kayarTemplate.js`) | Çalışıyor; makine ve lehçe bilgisiyle iç içe (bkz. §6) |
| `src/toolpath/ir.js` | Ara takım yolu temsili (IR) | Var; FANUC çerçeve adları (G54/G55) içeriyor |
| `src/post/` | FANUC post (`fanucStar.js`), iki profil: Star katalog (`postProfile.json`, **M kodları doğrulanmamış**) ve atölye (`postProfileKayar.json`, ~95 gerçek program çiftinden) | İki lehçe tek dosyada |
| `src/sim/` | G-kod yorumlayıcı (gerçek programların 80/80'i hatasız), koordinat çerçeveleri, malzeme kaldırma (ızgara), çarpışma, makine gövdeleri | Çalışıyor; makine ölçüleri kod içinde sabit |
| `src/machine/sb20r-g.json` | Makine verisi (strok, devir, istasyon sayıları) | Kısmi; çoğu değer “tahmini”; **Variation 04 ile çelişkili** (çapraz ünite 4 mil, kontrol 0i-TF) |
| `src/tools/toolLibrary.js` | Takım kütüphanesi, `STATIONS` (istasyon konumları) | İstasyon konumları makine çiziminden tahmin; **Variation 04'e göre yanlış** (T35 = ön delme kolonu kabul edilmiş) |
| `src/view3d/` | 3D görünüm (GLB makine çizimi + parametrik takımlar) | Montaj hiyerarşisi yok; GLB tek parça |
| `src/ui/` | Arayüz | — |
| `analiz/` (Python) | Kesme kuvveti / burç / talaş / gagalama modeli, iki kanallı G-kod motoru, Z1 koordinat hesabı, C ekseni kontur dönüşümleri | Testli; makine sabitleri dosyalara dağılmış |
| `makine çizimi/SB20R_TypeG_machining_zone.glb` | Çalışma bölgesi 3D çizimi | Hangi varyasyona ait olduğu **doğrulanmalı** |
| `../örnek cam dosyaları/` (repoda değil) | Atölyenin çalışan P1/P2 programları + STEP | Lehçenin tek doğrulanmış kaynağı |

**Sonuç:** Çalışan bir çekirdek var (yorumlayıcı, malzeme kaldırma, post), ancak (1) makine verisi koda dağılmış, (2) takım yolu üreteçleri makine geometrisine ve lehçeye bağlı, (3) makine montaj/kinematik hiyerarşisi yok, (4) istasyon yerleşimi Variation 04'e uymuyor.

---

## 2. Hedef mimari — katmanlar

Kural: **Takım yolu, makine kinematiği, simülasyon ve NC üretimi ayrı modüllerdir.** Makine geometrisi değişince CAM algoritması değişmez; lehçe değişince takım yolu değişmez.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 0. VERİ        machine/*.json (makine yapılandırması, şema doğrulamalı) │
│                tooling/*.json (takım + tutucu montajları)             │
│                dialect/*.json (NC lehçesi: kodlar, şablonlar)         │
├──────────────────────────────────────────────────────────────────────┤
│ 1. GEOMETRİ    parça (STEP/profil), stok, takım/tutucu katı modelleri │
│                — makineden bağımsız                                    │
├──────────────────────────────────────────────────────────────────────┤
│ 2. CAM         işlem → takım yolu (PARÇA koordinatında)               │
│                girdi: parça, takım, CamLimits (sayılar)               │
│                çıktı: ToolpathIR (anlamsal; G/M kodu yok)             │
├──────────────────────────────────────────────────────────────────────┤
│ 3. KİNEMATİK   MachineModel: montaj ağacı, eksenler, çerçeveler        │
│                parça ↔ makine dönüşümü, strok/devir kontrolleri,      │
│                kılavuz burçlu / burçsuz mod                            │
├──────────────────────────────────────────────────────────────────────┤
│ 4. SİMÜLASYON  NC okuyucu (lehçe) → hareket zaman çizelgesi (2 kanal) │
│                malzeme kaldırma · çarpışma (gerçek dış geometri)      │
├──────────────────────────────────────────────────────────────────────┤
│ 5. NC ÜRETİMİ  Dialect yazıcı: IR → P1/P2 metni (FANUC 0i-TD)          │
│                (atölye lehçesi doğrulanmış; diğerleri işaretli)        │
├──────────────────────────────────────────────────────────────────────┤
│ 6. ARAYÜZ      3D görünüm (montaj ağacından), editör, raporlar         │
└──────────────────────────────────────────────────────────────────────┘
```

Bağımlılık yönü yalnız **aşağıdan yukarıya**: CAM, simülasyonu ve post'u import etmez; post geometri hesaplamaz; simülasyon CAM üreteçlerini import etmez (bugün ediyor — §6).

### 2.1 Katmanlar arası sözleşmeler

| Sözleşme | Üreten → Tüketen | İçerik |
|---|---|---|
| `MachineConfig` | veri → herkes | Şemaya uyan JSON (bkz. yapılandırma belgesi) |
| `CamLimits` | kinematik → CAM | Yalnız sayılar ve fonksiyonlar: en büyük devir, güvenli çaplar, erişim derinlikleri, karşı mil tutma sınırları. CAM gövde/çarpışma dosyası import etmez |
| `ToolpathIR` | CAM → NC / kinematik | Parça koordinatı; çerçeve adları anlamsal (`main`, `backWork`, `pickoff`, `eject`); döngüler anlamsal (`peckDrill`, `rigidTap`, `thread`); senkron olayları adlı (`cycleStart`, `spindleSync`, `partGripped`, `cutDone`) |
| `Dialect` (yazıcı + okuyucu çifti) | NC ↔ simülasyon | Aynı JSON'dan beslenir: IR→metin ve metin→hareket. Bir lehçenin kodu yalnız bir yerde tanımlıdır |
| `MotionTimeline` | simülasyon → görünüm | Her kanal için zamanlı makine eksen değerleri + olaylar |

### 2.2 Python analiz paketi

`analiz/` aynı `machine/*.json` dosyasını okur (`machine_def.py`); kodda sabit devir/strok kalmaz. Paket CAM'e girdi verir (kuvvet, sapma, talaş, gagalama önerileri) ama CAM'e bağımlı değildir.

---

## 3. Makine koordinat sistemi

### 3.1 Dünya (makine) çerçevesi `W`
- **Orijin:** Ana iş mili ekseni ile kılavuz burç çıkış yüzeyinin kesiştiği nokta. *(Burçsuz modda: ana pens alnı referansı — bkz. §3.4.)*
- **+x_W:** Ana iş mili ekseni boyunca, ana milden **karşı mile doğru**.
- **+y_W:** Yukarı.
- **+z_W:** Operatöre doğru (sağ el kuralı).

> Bugünkü yazılımda kesme düzlemi x=0, burç yüzü x=−3,2 mm kabul edilmiş. Bu 3,2 mm **doğrulanmamış** bir değerdir; yeni yapıda burç yüzü orijin olur ve kesme düzlemi uzaklığı bir parametredir.

### 3.2 Program (NC) eksenleri — FANUC 0i-TD, iki yol
| Yol | Eksen | Anlamı | İşaret / birim |
|---|---|---|---|
| P1 | Z1 | Kayar başlık (ana mil) eksenel konumu; program Z = parçanın kesme düzlemindeki koordinatı | + = parça içine (malzeme dışarı itilir) |
| P1 | X1 | Ön takım kızağı radyal | **çap** değeri |
| P1 | Y1 | Ön takım kızağı yanal (takım seçimi + Y ile frezeleme) | mm |
| P1 | C1 | Ana mil açısı (Cs kontur) | derece |
| P2 | Z2 | Karşı mil taşıyıcısı eksenel | mm |
| P2 | X2 | Karşı mil taşıyıcısı yanal | mm (programlarda çap/yarıçap yorumu **doğrulanmalı**) |
| P2 | C2 | Karşı mil açısı | derece |

### 3.3 Parça çerçeveleri
- `P_main`: parça ön alnı orijin, +z parça boyunca (aynaya doğru), x çap. Takım yolları bu çerçevede üretilir.
- `P_sub`: karşı milde tutulan parça; arka alın orijin, +z parçanın içine (arka işleme derinliği).
- Dönüşüm `P_main → W`: `x_W = Z1_ref − z_part` (kesme düzleminde program Z = parça koordinatı; G125 ile sıfır alma sonrası).
- C işareti: takım C açısındayken parçanın θ = −C açısını keser (bugünkü simülasyonla aynı; makinede **doğrulanmalı**).

### 3.4 Çalışma modları
| Mod | Parça desteği | Kinematik farkı |
|---|---|---|
| Kılavuz burçlu (GB) | Burç radyal destek; başlık Z1 malzemeyi burçtan iter | Kesme noktası burca yakın sabit; parça boyu Z1 stroku ve ara bağlama ile sınırlı |
| Burçsuz (NGB) | Malzeme ana pensten çıkıntılı | Kesme noktası pens alnına göre; çıkıntı sınırı (katalog: çap × 2,5, en çok 50 mm — **kaynak doğrulanmalı**) |

Mod, makine yapılandırmasında bir anahtardır; kinematik zincirde burç düğümü etkin/pasif olur. Her iki mod da korunur.

---

## 4. Kinematik hiyerarşi (montaj ağacı)

Her düğümün kendi koordinat sistemi (`frame`) ve ebeveyne göre dönüşümü vardır. Hareketli düğümler bir eksene bağlıdır. Ölçüler `makine-yapilandirma.md`'deki parametrelerdir.

```
W  (dünya / makine tabanı)
├── bed                                   (sabit, çarpışma gövdesi)
├── guideBushHolder  [mod=GB]             (sabit)
│   └── guideBush                         (burç; NGB'de pasif)
├── headstock        ← Z1 (öteleme +x_W)
│   └── mainSpindle  ← C1 (dönme, ekseni x_W)
│       └── mainCollet / nut              (çarpışma)
│           └── bar / part_main           (malzeme kaldırma gövdesi)
├── frontSlide       ← X1 (radyal) 
│   └── frontSlideY  ← Y1 (yanal)
│       ├── gangTurningGroup              (İstasyon 1–6, sabit takımlar)
│       │   └── station[1..6] → toolholderAssembly → tool
│       ├── crossDrillUnit_5sp  (KARTUŞ TİPİ, Variation 04)
│       │   ├── unitBody                  (çarpışma)
│       │   ├── spindle31 ← frame31 (kendi ekseni, takım merkezi, dönüş yönü)
│       │   ├── spindle32 ← frame32
│       │   ├── spindle33 ← frame33
│       │   ├── spindle34 ← frame34
│       │   └── spindle35 ← frame35   (beşi ortak eksende / ortak çerçevede VARSAYILMAZ)
│       │       └── collet → toolholderAssembly → tool
│       ├── frontDrillingUnit             (ön delme, eksenel takımlar)
│       │   └── station[?] → toolholder → tool     (numaralar BİLİNMİYOR)
│       └── lowerToolingGroup             (alt takım grubu — içerik BİLİNMİYOR)
└── subCarrier       ← Z2 (eksenel), X2 (yanal)
    ├── subSpindle   ← C2
    │   └── subCollet / nut → part_sub
    └── (arka takım ünitesi sabit gövdede ise W'ye bağlanır — BİLİNMİYOR)
rearToolPost                              (arka çalışma istasyonları; montaj yeri BİLİNMİYOR)
    └── station[?] → toolholder → tool (sabit / tahrikli)
```

Kurallar:
- **Takım tutucu montajı** (tutucu + pens/kovan + takım) bağımsız ve değiştirilebilir bir alt ağaçtır; istasyona `mount` çerçevesiyle bağlanır.
- **Her tahrikli mil** (çapraz ünitenin 5 mili dahil) kendi `rotationAxis`, `frame`, `maxRpm`, `tool`, `collision` alanlarına sahiptir.
- Çarpışma yalnız **dış geometriden** yapılır: takım, tutucu, pens/somun, mil burnu, kızak ve ünite gövdeleri. İç rulman vb. modellenmez.
- 3D görünüm bu ağaçtan üretilir; GLB yalnız referans/görsel kabuk olarak kullanılabilir.

---

## 5. NC lehçesi ilkeleri (kural 3)

- **Doğrulanmış kaynak:** Atölyenin çalışan P1/P2 programları. Buradan çıkan kodlar (`M3/M4/M5`, `M36/M38`, `M56/M58`, `M6/M7`, `M10/M11`, `M82/M83`, `M40/M41`, `M200`, `G125`, `G130/G131`, `G83/G84/G87`, `M29`, `H`, `T0200`+`T2` …) kullanılabilir.
- **Doğrulanmamış:** Star katalog profilindeki kodlar (ör. `M53`, `M77/M78`, `M18/M17`, `M20` = karşı ayna). Bu kodlar **kullanılmayacak**; Star FANUC 0i-TD programlama kılavuzu gelirse doğrulanacak.
- Faz (C açısal) senkronu, karşı ayna kodları, arka ünite kodları için kılavuz/örnek program gereklidir.
- Bilinmeyen bir işlev için kod uydurulmaz; post hata verir ve eksik kodu ister.

---

## 6. Bugünkü katman ihlalleri (denetim özeti)

| İhlal | Örnek | Hedef |
|---|---|---|
| CAM makine gövdelerini/çarpışmayı import ediyor | `ops/generators.js` → `sim/bodies`, `sim/collision`, `LAYOUT` (karşı mil park, tutma boyu, arka erişim) | `CamLimits` |
| Devir/strok sınırları üreteçlerde | `generators.js`, `program.js` | kinematik katmanı |
| CAM lehçeye bağlı | gagalama katsayısı `dialect==='kayar'`, `post.cycles`, IR'da `G54/G55` | anlamsal IR |
| Post geometri hesaplıyor | kesme takımı Z + genişlik, CSS→devir, T35-k→T1k | kinematik / takım verisi |
| Makine sayıları kodda | `frames.js` LAYOUT, `bodies.js` (yüzlerce mm), `STATIONS`, şablonda `205`, `G0X50.` | `machine/*.json` |
| Yorumlayıcıda atölye anlamları sabit | T20/T29, G130/G131 çerçeveleri, `subHomeZ ?? 200` | lehçe okuyucu + makine JSON |
| Ters bağımlılık | `stockSim.js` → `ops/generators`, `ops/simMill` | `geom/` ortak modül |
| Python'da sabitler | 10000/8000 rpm, `z1_max=205`, Y ±20 (JSON'da ±150 “tahmini”) | ortak JSON |

---

## 7. Yol haritası (her kilometre taşı onaya tabidir)

| # | Kilometre taşı | Çıktı | Kabul ölçütü |
|---|---|---|---|
| **M0** | Mimari + makine yapılandırma şartnamesi + Variation 04 takım yerleşimi | Bu belgeler | **Kullanıcı onayı** |
| M1 | Makine verisinin tek kaynağa taşınması | `machine/sb20r-g-v04.json` + JSON şeması + doğrulayıcı; BİLİNMİYOR alanlar işaretli | Şema testi; mevcut testler değişmeden geçer |
| M2 | Kinematik çekirdek | Montaj ağacı, çerçeve dönüşümleri, GB/NGB modu, strok/devir kontrolleri (`MachineModel`) | Gerçek programların 80/80'i aynı sonuçla yorumlanır |
| M3 | Montajlar ve 3D | Ana mil, karşı mil, 5 milli çapraz ünite, alt takım grubu, ön delme ünitesi, tutucular — ayrı parametrik montajlar | Ölçüsü bilinmeyen parça “yer tutucu” renginde gösterilir |
| M4 | Katman ayrımı (refactor) | `CamLimits`, anlamsal IR, lehçe yazıcı/okuyucu çifti | Post çıktısı ve testler bit bit aynı |
| M5 | Çarpışma | Gerçek dış geometriyle (montaj ağacından) | Bilinen çarpışma senaryoları testleri |
| M6 | CAM işlemleri (Variation 04) | Çapraz 5 mil kullanan delme/kılavuz/frezeleme, ön delme ünitesi | Örnek parçalar hatasız |
| M7 | Doğrulama | Atölye programları ↔ üretilen program karşılaştırması (STEP eşleşmeli parçalar) | Kuru çalıştırma onayı (makinede) |

---

## 8. Açık sorular (cevaplanmadan ilgili adım başlamaz)
Ayrıntılı liste: `docs/makine-yapilandirma.md` §5. Öncelikliler:
1. Variation 04 referans görseli (takım yerleşimi) — **dosya bekleniyor**.
2. Ön delme ünitesi ve arka takım istasyonlarının numaraları (programlarda T11–T14 ve T21–T24 görülüyor; Variation 04 görselinde nasıl?).
3. Eksen strokları (X1, Y1, Z1, X2, Z2) ve hızlı hareket hızları — makine kılavuzu / parametre ekranı.
4. 5 milli çapraz ünitenin mil aralıkları, pens tipi, en yüksek devir, dönüş yönleri.
5. FANUC 0i-TD için Star M kodu listesi (programlama kılavuzu) — özellikle faz senkronu ve karşı ayna.
6. Makine çizimi GLB'nin hangi varyasyona ait olduğu.
