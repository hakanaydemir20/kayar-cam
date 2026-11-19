# Makine Yapılandırma Şartnamesi — Star SB-20R Type G, Variation 04 (Taslak 1, onay bekliyor)

Kontrol: FANUC 0i-TD · Takım düzeni: **Kartuş tipi 5 milli çapraz delme ünitesi** · İstasyon numaraları: **1, 2, 3, 4, 5, 6, 31, 32, 33, 34, 35**

Değer durumları:
- `KULLANICI` — kullanıcı tarafından bildirildi (2026-11-18)
- `PROGRAM` — atölyenin çalışan programlarından çıkarıldı (tasarım değil, kullanım gözlemi)
- `BİLİNMİYOR` — kaynak yok; değer **girilmeli**. Yazılım bu alanlar boşken ilgili hesabı yapmaz ve kullanıcıyı uyarır.

Hiçbir boyut, mil aralığı, montaj koordinatı veya dönüş yönü tahmin edilmemiştir.

---

## 1. Şema — üst düzey

```jsonc
{
  "schema": "kayar-cam/machine@1",
  "id": "star-sb20r-g-v04",
  "model": "STAR MICRONICS SB-20R TYPE G",
  "variation": "04",                       // KULLANICI
  "control": "FANUC 0i-TD",                // KULLANICI
  "modes": ["guideBush", "nonGuideBush"],  // KULLANICI (ikisi de desteklenir)
  "limits": { ... },                       // §2
  "axes": { ... },                         // §3
  "assemblies": { ... },                   // §4 (montaj ağacı)
  "stations": [ ... ],                     // §4.6
  "dialect": "shop-p1p2"                   // NC lehçesi (ayrı dosya)
}
```

Her sayısal alan şu biçimdedir:
```jsonc
{ "value": 10000, "unit": "rpm", "status": "KULLANICI", "source": "kullanıcı 2026-11-18" }
{ "value": null,  "unit": "mm",  "status": "BİLİNMİYOR", "source": null }
```

---

## 2. Genel sınırlar

| Alan | Değer | Birim | Durum |
|---|---|---|---|
| maxMachiningDia | 20 | mm | KULLANICI |
| mainSpindle.maxRpm | 10 000 | dev/dak | KULLANICI |
| mainSpindle.powerCont | 2,2 | kW | KULLANICI |
| subSpindle.maxRpm | 9 000 | dev/dak | KULLANICI *(eski dosyada 8 000 — düzeltilecek)* |
| subSpindle.powerCont | 0,55 | kW | KULLANICI |
| mainSpindle.powerShortTime | — | kW | BİLİNMİYOR |
| maxPartLength (GB, tek bağlama / ara bağlamalı) | — | mm | BİLİNMİYOR |
| maxPartLength (NGB) | — | mm | BİLİNMİYOR |
| subSpindle.maxGripLength / maxEjectLength | — | mm | BİLİNMİYOR |

## 3. Eksenler (her biri: tip, ebeveyn düğüm, yön, strok, hız, çözünürlük)

| Eksen | Yol | Tip | Bağlı düğüm | Yön (W) | Strok min / max | Hızlı | Durum |
|---|---|---|---|---|---|---|---|
| Z1 | P1 | öteleme | headstock | +x_W | — / — | — | BİLİNMİYOR (eski dosyada 205 mm “katalog”; kaynak doğrulanmalı) |
| X1 | P1 | öteleme (çap programlı) | frontSlide | radyal (−y_W ?) | — / — | — | BİLİNMİYOR |
| Y1 | P1 | öteleme | frontSlideY | — | — / — | — | BİLİNMİYOR |
| C1 | P1 | dönme (Cs) | mainSpindle | ekseni x_W | sınırsız | — | dönüş yönü işareti BİLİNMİYOR |
| X2 | P2 | öteleme | subCarrier | — | — / — | — | BİLİNMİYOR (çap/yarıçap programlama doğrulanmalı) |
| Z2 | P2 | öteleme | subCarrier | −x_W (ana mile doğru ?) | — / — | — | BİLİNMİYOR |
| C2 | P2 | dönme | subSpindle | ekseni x_W | sınırsız | — | BİLİNMİYOR |

Programlardan gözlenen kullanım aralıkları (strok **değildir**, yalnız alt sınır bilgisi): Z1 −12,2 … ~200; X1 −11 … 50; Y1 ±21; Z2 G131 çerçevesinde −30 … 200. `PROGRAM`

## 4. Montajlar

Her montaj: `id`, `parent`, `mount` (ebeveyne göre 4×4 dönüşüm veya {pos, rot}), `axis` (hareketliyse), `frame`, `collision` (dış geometri listesi: kutu/silindir/ağ), `visual` (isteğe bağlı GLB parçası).

### 4.1 Ana mil (`mainSpindleAssembly`)
| Alan | Durum |
|---|---|
| Başlık gövdesi dış ölçüleri | BİLİNMİYOR |
| Pens tipi / somun çapı / somun çıkıntısı | BİLİNMİYOR |
| Kılavuz burç: tip (sabit/döner), uzunluk, çıkış yüzü konumu, kesme düzlemine uzaklık | BİLİNMİYOR (yazılımda 3,2 mm varsayımı vardı — kaldırılacak/parametre) |
| GB ↔ NGB geçişinde değişen parçalar | BİLİNMİYOR |
| maxRpm 10 000, 2,2 kW | KULLANICI |

### 4.2 Karşı mil (`subSpindleAssembly`)
| Alan | Durum |
|---|---|
| Taşıyıcı (X2/Z2) gövde dış ölçüleri | BİLİNMİYOR |
| Pens tipi, somun çapı/çıkıntısı, flanş | BİLİNMİYOR (eski dosyada somun Ø30 / 1,5 mm — kaynaksız) |
| Ev konumu (G28W0) | BİLİNMİYOR (yazılımda 200 varsayımı) |
| Parça atma konumu (T2900) | BİLİNMİYOR — programda `G0Z40` (T29 ofsetiyle) `PROGRAM` |
| maxRpm 9 000, 0,55 kW | KULLANICI |

### 4.3 Kartuş tipi 5 milli çapraz delme ünitesi (`crossDrillUnit5`) — Variation 04
Ünite gövdesi bir montajdır; içinde **5 bağımsız mil** vardır (KULLANICI kuralı, 2026-11-18):

- Her mil (31, 32, 33, 34, 35) **kendi** koordinat sistemine, **kendi** dönme eksenine, **kendi** takım merkezine ve **kendi** dönüş yönüne sahiptir.
- Beş milin **aynı eksende, paralel, eşit aralıklı veya ortak bir koordinat sisteminde olduğu varsayılmaz.** Ünite gövdesi yalnız ortak ebeveyndir (`parent`); her milin konumu ve yönü ebeveyne göre ayrı ayrı tanımlanır.
- Yazılım, bir milin alanları boşken o mili hesaba (takım yolu, çarpışma, 3D konum) **almaz** ve eksik alanı bildirir.

Her mil için ayrı kayıt (şema):
```jsonc
"crossDrillUnit5": {
  "parent": "frontSlideY",
  "mount":  { "pos": [null,null,null], "rot": [null,null,null], "status": "BİLİNMİYOR" },  // ünite gövdesi
  "collision": [ /* gövde dış geometrisi — BİLİNMİYOR */ ],
  "spindles": {
    "31": {
      "frame": {                                    // milin kendi koordinat sistemi (ebeveyn: ünite gövdesi)
        "origin":       [null,null,null],           // takım merkezi / mil burnu referans noktası
        "rotationAxis": [null,null,null],           // birim vektör — milin kendi ekseni
        "refDir":       [null,null,null],           // eksene dik referans yön (takım tutucunun açısal yönü)
        "status": "BİLİNMİYOR"
      },
      "toolCenter":        { "value": [null,null,null], "status": "BİLİNMİYOR" }, // takım ucu merkezi (gauge noktası)
      "rotationDirection": { "value": null, "enum": ["CW","CCW"], "viewFrom": "spindle-nose", "command": "M36", "status": "BİLİNMİYOR" },
      "maxRpm":            { "value": null, "unit": "rpm", "status": "BİLİNMİYOR" },
      "cartridge":         { "type": null, "collet": null, "status": "BİLİNMİYOR" },
      "collision":         [ /* kartuş + pens + somun dış geometrisi — BİLİNMİYOR */ ],
      "tool":              { "ref": null }          // kullanıcı ayarı
    },
    "32": { /* aynı alanlar, bağımsız değerler */ },
    "33": { /* … */ },
    "34": { /* … */ },
    "35": { /* … */ }
  }
}
```

| Alan (her mil için AYRI değer) | 31 | 32 | 33 | 34 | 35 | Durum |
|---|---|---|---|---|---|---|
| Mil koordinat sistemi (orijin) | — | — | — | — | — | BİLİNMİYOR |
| Dönme ekseni (birim vektör) | — | — | — | — | — | BİLİNMİYOR |
| Takım merkezi | — | — | — | — | — | BİLİNMİYOR |
| Dönüş yönü (M36 ile CW/CCW) | — | — | — | — | — | BİLİNMİYOR |
| maxRpm | — | — | — | — | — | BİLİNMİYOR |
| Kartuş / pens tipi | — | — | — | — | — | BİLİNMİYOR |
| Çarpışma geometrisi | — | — | — | — | — | BİLİNMİYOR |
| Takım tanımı | kullanıcı | kullanıcı | kullanıcı | kullanıcı | kullanıcı | ayar |

Not: Program ofseti (T31…T35) ile milin fiziksel takım merkezi arasındaki ilişki makinedeki takım ofset tablosundan gelir; yazılım ofset değerini mil geometrisinden **türetmez**, ayrı bir alan olarak tutar (`offsetRef`, BİLİNMİYOR).

Programlarda gözlenen: `T3100`/`T3200` + `M36 S…` (tahrik aç), `M38` (dur), `M6/M7` (C kilit/aç). T33–T35 programlarda geçmiyor. `PROGRAM`

### 4.4 Tornalama takım grubu (gang, istasyon 1–6)
| Alan | Durum |
|---|---|
| İstasyon sayısı 6, numaralar 1–6 | KULLANICI |
| Sap ölçüsü (□10 / □12 ?) | BİLİNMİYOR |
| İstasyonların Y konumları / aralığı | BİLİNMİYOR |
| Takım ucu yükseklik ve X referansı | BİLİNMİYOR |
| Kullanım (programlardan): T01 kesme, T02 tornalama, T03 diş/kanal, T06 | PROGRAM |

### 4.5 Alt takım grubu (`lowerToolingGroup`) ve ön delme ünitesi (`frontDrillingUnit`)
| Alan | Durum |
|---|---|
| Alt takım grubunun içeriği, istasyon sayısı, numaraları | BİLİNMİYOR — görsel bekleniyor |
| Ön delme ünitesi istasyon sayısı / numaraları | BİLİNMİYOR — programlarda **T11–T14** (`G0X0Y0T12`) kullanılıyor `PROGRAM`; görselde nasıl numaralandığı doğrulanmalı |
| Ön delme maks. matkap/kılavuz çapı | BİLİNMİYOR |
| Konumları (Y, X) | BİLİNMİYOR |

### 4.6 Arka takım ünitesi (`rearToolPost`)
| Alan | Durum |
|---|---|
| İstasyon sayısı / numaraları | BİLİNMİYOR — programlarda **T21–T24** `PROGRAM` |
| Sabit / tahrikli istasyonlar | BİLİNMİYOR — programlarda `M56 S…`/`M58` ile tahrikli kullanım var `PROGRAM` |
| Montaj yeri (sabit gövde mi, taşıyıcı mı) | BİLİNMİYOR |
| Konumlar, maks. devir | BİLİNMİYOR |

### 4.7 Takım tutucu montajı (`toolholderAssembly`) — değiştirilebilir
```jsonc
{
  "id": "th-er16-collet-01",
  "type": "turning|sleeve|collet|cartridge|boring",
  "mount": { "station": 32, "pos": [null,null,null], "rot": [null,null,null] },  // BİLİNMİYOR
  "gaugeLength": { "value": null, "status": "BİLİNMİYOR" },
  "collision": [ { "shape": "cylinder", "d": null, "l": null } ],
  "tool": { "ref": "tool-id" }
}
```

### 4.8 İstasyon listesi (Variation 04 — numaralar KULLANICI, diğer her şey BİLİNMİYOR)
| No | Grup | Tahrikli | Ofset biçimi (programdan) |
|---|---|---|---|
| 1–6 | Tornalama grubu | hayır | `T0n00` + `G0…Tn` |
| 31–35 | 5 milli çapraz ünite | evet | `T3n00` + `G0G98C…T3n` |
| ? | Ön delme ünitesi | ? | `T1n00` + `G0X0Y0T1n` (programlarda 11–14) |
| ? | Alt takım grubu | ? | BİLİNMİYOR |
| ? | Arka takım ünitesi | ? | `T2n00` + `T2n` (programlarda 21–24) |
| 20 / 29 | Karşı mil tabanı / parça atma (sanal takım no) | — | `PROGRAM` |

## 5. Eksik veri listesi (öncelik sırasıyla)
1. **Variation 04 referans görseli** — dosya bekleniyor (`kayar-cam/makine çizimi/`).
2. Eksen strokları ve hızlı hareket hızları (Z1, X1, Y1, X2, Z2) — kılavuz veya makine parametreleri.
3. 5 milli çapraz ünite: mil aralıkları, montaj koordinatları, dönüş yönleri, maks. devir, kartuş/pens tipi, dış ölçüler.
4. Ön delme ünitesi ve alt takım grubu: istasyon numaraları ve konumları (T11–T14 doğrulaması).
5. Arka takım ünitesi: istasyon sayısı, tahrikli olanlar, konumlar.
6. Ana/karşı mil pens ve somun dış ölçüleri; kılavuz burç tipi, uzunluğu, çıkış yüzü konumu.
7. Karşı mil ev konumu ve parça atma konumu.
8. Star FANUC 0i-TD M kodu listesi (programlama kılavuzu) — faz senkronu, karşı ayna, arka ünite kodları.
9. C1/C2 dönüş yönü işareti (C+ hangi yöne).
10. X2 programlamasının çap mı yarıçap mı olduğu.
11. `makine çizimi/SB20R_TypeG_machining_zone.glb` dosyasının Variation 04'e ait olup olmadığı.

## 6. Mevcut dosyadan (src/machine/sb20r-g.json) taşınırken düzeltilecekler
- `control`: "FANUC 0i-TF Plus" → **"FANUC 0i-TD"**.
- `subSpindle.maxRpm`: 8000 → **9000**.
- `liveTools.cross.count`: 4 → **5** (kartuş tipi); `collet: "ER16"` → BİLİNMİYOR (kaynak yok).
- `estimated: true` strokları → `status: BİLİNMİYOR` (değerler yalnız eski varsayım olarak arşivlenir).
- `STATIONS` (toolLibrary.js) ve `LAYOUT` (frames.js) içindeki konumlar → BİLİNMİYOR (yazılım bu değerleri yalnız “varsayılan görsel yerleşim” olarak gösterebilir, açıkça işaretli).
- T35'in “ön delme kolonu” yorumu kaldırılır: **T35 = çapraz ünitenin 5. mili**.
