# Variation 04 — Takım Yerleşimi Belgesi (Taslak 0, referans görsel bekleniyor)

Makine: STAR MICRONICS SB-20R TYPE G · **Variation 04** · Kartuş tipi 5 milli çapraz delme ünitesi
Yetkili kaynak: **Variation 04 referans görseli** (kullanıcı) — *henüz dosya olarak alınmadı*; görsel `kayar-cam/makine çizimi/` klasörüne konduğunda bu belge görselden doldurulacak.

Kurallar:
- Başka SB-20R varyasyonları kullanılmaz.
- İstasyon numaraları görseldeki gibidir: **1, 2, 3, 4, 5, 6, 31, 32, 33, 34, 35**.
- Ölçü, mil merkez aralığı, montaj koordinatı, dönüş yönü **uydurulmaz**; bilinmeyenler `BİLİNMİYOR` parametresidir (`docs/makine-yapilandirma.md`).
- 31–35: beş **bağımsız** mil; her birinin kendi dönme ekseni, koordinat sistemi, takım merkezi, dönüş yönü, maks. devri, takım tanımı ve çarpışma geometrisi vardır. Ortak eksen/çerçeve varsayılmaz.

## 1. Montajlar

| Montaj | İçerik | İstasyonlar | Görselden okunacak | Durum |
|---|---|---|---|---|
| Ana mil | başlık, mil, pens/somun, kılavuz burç (GB/NGB) | — | burç tutucu konumu | BİLİNMİYOR |
| Karşı mil | taşıyıcı (X2/Z2), mil, pens/somun | — | — | BİLİNMİYOR |
| Kartuş tipi 5 milli çapraz ünite | gövde + 5 mil | 31, 32, 33, 34, 35 | milin sırası/yerleşimi, yönleri | numaralar KULLANICI, diğerleri BİLİNMİYOR |
| Tornalama grubu | sabit takımlar | 1, 2, 3, 4, 5, 6 | sıra ve gruplama | numaralar KULLANICI |
| Alt takım grubu | ? | ? | içerik, numaralar | BİLİNMİYOR |
| Ön delme ünitesi | eksenel takımlar | ? (programlarda T11–T14) | numaralar, sayısı | BİLİNMİYOR |
| Arka takım ünitesi | sabit/tahrikli | ? (programlarda T21–T24) | numaralar, tahrik | BİLİNMİYOR |
| Takım tutucular | her istasyon için değiştirilebilir montaj | tümü | tutucu tipleri | BİLİNMİYOR |

## 2. İstasyon tablosu

| No | Montaj | Tip | Tahrikli | Program çağrısı (atölye) | Konum / eksen / yön |
|---|---|---|---|---|---|
| 1 | Tornalama grubu | ? | hayır | `T0100` → `G0…T1` (programlarda kesme kalemi) | BİLİNMİYOR |
| 2 | Tornalama grubu | ? | hayır | `T0200` → `T2` (tornalama) | BİLİNMİYOR |
| 3 | Tornalama grubu | ? | hayır | `T0300` → `T3` (diş/kanal) | BİLİNMİYOR |
| 4 | Tornalama grubu | ? | hayır | programlarda görülmedi | BİLİNMİYOR |
| 5 | Tornalama grubu | ? | hayır | programlarda görülmedi | BİLİNMİYOR |
| 6 | Tornalama grubu | ? | hayır | `T0600` → `T6` | BİLİNMİYOR |
| 31 | 5 milli çapraz ünite | mil 1/5 | evet | `T3100` → `G0G98C…T31`, `M36S…`, `M6/M7`, `M38` | BİLİNMİYOR |
| 32 | 5 milli çapraz ünite | mil 2/5 | evet | `T3200` → `T32` | BİLİNMİYOR |
| 33 | 5 milli çapraz ünite | mil 3/5 | evet | programlarda görülmedi | BİLİNMİYOR |
| 34 | 5 milli çapraz ünite | mil 4/5 | evet | programlarda görülmedi | BİLİNMİYOR |
| 35 | 5 milli çapraz ünite | mil 5/5 | evet | programlarda görülmedi | BİLİNMİYOR |

“Program çağrısı” sütunu yalnız atölyenin çalışan programlarındaki kullanımı gösterir; istasyonun fiziksel tipini belirlemez.

## 3. Mevcut yazılımla farklar (düzeltilecek, onaydan sonra)
- Yazılımda T35 “3 katlı ön delme kolonu” olarak modellenmiş → **yanlış**; T35 çapraz ünitenin 5. mili.
- Yazılımda çapraz ünite 4 mil (T31–T34), mil konumları eşit aralıklı ve paralel varsayılmış (`STATIONS.cross`) → kaldırılacak; her mil ayrı tanımlanacak.
- Ön delme takımları T11–T14 olarak programda yazılıyor; görselde karşılığı doğrulanacak.

## 4. Görsel geldiğinde yapılacaklar (onay sonrası)
1. Görseldeki istasyon sırası/gruplaması bu tabloya işlenir (yalnız görselde açıkça görünen bilgi).
2. Görselde ölçü yoksa konumlar BİLİNMİYOR kalır; 3D görünümde istasyonlar “yer tutucu” olarak, ölçüsüz şematik dizilimde gösterilir.
3. Eksik ölçüler için kullanıcıya liste sunulur.
