# gcode_engine — Kayar (Swiss-type) 2 kanallı G-kod motoru iskeleti

Star SB-20R Type G sınıfı kayar otomat içindir (yalnızca kayar tip).
Python 3, yalnızca standart kütüphane. Makine üzerinde **doğrulanmamıştır**.

- **P1 (ana iş mili):** X1 Y1 Z1 C1 — gang takımlar, radyal döner takımlar, ön matkaplar (T11–T14)
- **P2 (karşı iş mili):** X2 Z2 C2 — arka takım tutucu. **P2'de Y ekseni yoktur**, model bunu reddeder.

## Dosyalar

| Dosya | Görev |
|---|---|
| `model.py` | Ara temsil (IR): `Path`, eksen kümeleri, `Tool`/`ToolUnit`, operasyonlar (`Rapid`, `Feed`, `Arc`, `Cycle`, `Spindle`, `Coolant`, `ToolCall`, `ToolCancel`, `MCode`, `Dwell`, `Raw`, `Label`, `Sync`), `Channel.add()` eksen/takım doğrulaması |
| `sync.py` | Senkron olayları, kod stratejileri (`ShopSyncStrategy`, `NumberedWaitStrategy`), `validate_sync` (kilitlenme tespiti), `timeline` (kanal başına süre ve boşta bekleme) |
| `pickoff.py` | Parça devri (N100), atölye çevrim şablonu, `pickoff_cycle()`, güvenlik doğrulayıcı `check_pickoff` |
| `post.py` | Çıktı: `post_shop` (iki dosya -P1/-P2), `post_star` (tek dosya `$1`/`$2`, M200+n) |
| `example.py` | Örnek parça; `python -m analiz.gcode_engine.example` → `out/` (git'e girmez) |
| `tests/test_engine.py` | `python -m pytest analiz/gcode_engine/tests -q` |

## Senkron mantığı

Senkron noktası = iki kanalın da beklediği adlandırılmış olay (`Sync(event=...)`).
Kural: **iki kanal aynı olayları aynı sırayla yayınlamalı**. Aksi halde bir kanal
sonsuza dek bekler (kilitlenme). `validate_sync` çıktı üretilmeden önce bunu
kontrol eder ve hata verir.

| Olay | Atölye kodu | Star katalog stili |
|---|---|---|
| `cycle_start` | M200 | M200 |
| `spindle_sync` | M82 (devir senkronu da açar) | M201 (+ M77) |
| `part_gripped` | M40 (Z senkronu açar) | M202 |
| `cut_done` | M41 (Z senkronu kapatır) | M203 (+ M78) |

M83 (devir senkronu iptal) **senkron noktası değildir**: gerçek programlarda bazen
tek kanal yazar. Atölye stratejisi sabit sözlük kullanır; bilinmeyen olay hata verir
(`ShopSyncStrategy.mapping`'e eklenmeli). Numaralı strateji her olaya sırayla
M200, M201… verir (gerekirse M300 serisine geçer).

```
      P1 (ana)                           P2 (karşı)
 N99  M11 bar sür G125 M10               G130 T2000
 ──── M200 ═══════ cycle_start ═══════ M200 ────
      ana işlemler (bu parça)            arka işlemler (ÖNCEKİ parça)
                                         T2900 parça atma
 N100 kesme takımı kesme konumuna        N100 G99M4S50, M11
 ──── M82 ════════ spindle_sync ══════ M82 ─────
      bekler                             G131, G0Z-30, M14 M68
                                         G1 Z#530 F1.5 (yakalama), M69
                                         M10 ayna kapat, G4U0.5, M15
 ──── M40 ════════ part_gripped ══════ M40 ─────
      G1 X.. kesme, X-1. (pens KAPALI)   bekler
 ──── M41 ════════ cut_done ══════════ M41 ─────
      M83, takım iptal, M99P99           M68 G0W-20. M69 M83 G28W0. M99
```

## Parça devri (pick-off) adım adım — `pickoff_cycle(params, dialect)`

`pickoff_cycle(params, dialect='shop'|'star')` → `(p1_satırları, p2_satırları, adımlar)`.

1. **Karşı iş mili yaklaşır** (P2): `G131` (ana sıfırını karşıda tanı), `G0Z-30` güvenli
   boşluk, `M14` hava + `M68` zorlama limiti, `G1G99Z#530F1.5` yakalama konumu.
   Yaklaşma ancak **`spindle_sync` sonrasında** yapılır; o noktada P1 kesme takımı
   zaten kesme konumundadır.
2. **Devir (ve faz) senkronu**: atölyede `M82` iki kanalda da. Star stilinde M2xx
   beklemesi + `TransferCodes.spindle_sync_on` (varsayılan M77, doğrulanmamış),
   istenirse `phase_sync` kodu (C açısal faz).
3. **Karşı ayna kapanır**: `M69`, `M10`, `G4U0.5`, `M15` → `part_gripped` (M40).
4. **Ana pens AÇILMAZ** (varsayılan `main_open='next_cycle'`). Gerçek makinede
   parça iki ayna tutarken kesilir; ana pens bir sonraki çevrimin başında (N99:
   `M11`, `G0Z-0.2T0`, `G125Z-0.2`, `M10`) bar sürmek için açılır.
   `main_open='after_cut'` izinlidir; `'after_grip'` (kesmeden önce açmak) **reddedilir**:
   bar sadece kılavuz burçta kalır, kesme titrer, bar çekilebilir, parça eğilir/kopar.
6. **Kesme** (P1): `T0100 M3S#529`, `G0G99X[#531+1.]Z[#530+#528+#120]T1`,
   M82, M40, `G1X..` kes, `X-1.`, → `cut_done` (M41), `M83`.
5. **Karşı geri çekilir**: `M68 G0W-20. M69 M83 G28W0.` — **yalnızca M41'den sonra**
   (önce çekilirse parça yırtılır/koparılır).

`check_pickoff` şunları reddeder: senkron sırası farkı; P1 kesme konumuna gelmeden
yaklaşma; tutmadan kesme; kesme bitmeden geri çekilme; kesme bitmeden ana pens açma.

## Örtüşen çevrim

Atölye gibi: P2, `M200`'den sonra **önceki parçanın** arka işlemlerini yapar ve
`T2900` ile atar; bu sırada P1 yeni parçayı işler. Sonra N100'de devir yapılır.
`timeline(prog).text()` her senkron arası kanal sürelerini ve boşta beklemeyi verir
(kaba tahmin: hızlı ilerleme hızı, F×devir, sabit M/takım değişim süreleri).

## Genişletme

- **Yeni operasyon:** `model.py`'de dataclass ekle, `post.ChannelEmitter.emit` içinde yaz,
  gerekirse `sync._Estimator.time`'a süre ekle.
- **Yeni senkron olayı:** iki kanala da aynı sırada `Sync(event="ad")`; atölye
  lehçesinde `ShopSyncStrategy(mapping={..., "ad": "M2xx"})`.
- **Yeni lehçe:** `SyncStrategy.assign` uygulayan sınıf + yeni `post_*` fonksiyonu.
- **Farklı devir kodları:** `TransferCodes(...)` ile `pickoff_cycle(..., codes=...)`.

## Belirsizlikler (makinede doğrulanmalı)

- Star katalog stili M77/M78 ve faz senkron kodu eski profilden; doğrulanmadı.
- `T0500` takım çağırma biçimi, döngülerden sonra `G80`, `G97` önekleri tahmindir.
- Süre tahmini kabadır (C indeksleme, ivmelenme yok).
