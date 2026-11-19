# swiss_z1 — Kayar otomat Z1 hesabı

Yalnız kayar otomat (Star SB-20R, kılavuz burçlu). Takımlar Z'de sabit (gang plakası yalnız X/Y),
ana mil (ayna) Z1'de gidip gelir ve çubuğu burçtan iter/çeker.

## Koordinat çerçeveleri

```
   ana mil (ayna)        kılavuz burç        kesme düzlemi
   Z1 ile hareket        alnı w=-3.2         w=0 (gang uçları)
 [=====]==================|==========|=======[ön alın]--->  +w (karşı mile doğru)
         çubuk                         ^takım      w = front_world
 parça d:   <--- aynaya doğru +            d (kesilen)      d = 0
```

- dünya `w`: kesme düzlemi 0, burç alnı `bush_face = -3.2` (frames.js `LAYOUT.bushFace`)
- parça `d`: ön alından aynaya doğru; `w = front_world - d`
- makine: `front_world = Z1 + barOffset` (ayna kapalı); ayna açıkken `front_world` sabit
- takım: referans ucu `w = dz` (gang ≈ 0), `X1 = x + dx` (çap)

## Formüller

Matris zinciri (3x3 homojen, (z,x)): `parça→dünya = T(Z1) · T(barOffset) · FLIP`, takım `T(dz,dx)`.

- `Z1 = d + dz − barOffset`  (ters: `d = Z1 − dz + barOffset`)
- desteksiz çıkıntı: `overhang = d + dz − bush_face` (d ile monoton artar)
- kesme noktası ↔ burç: `dz − bush_face` (= 3.2, sabit)
- ayna kapanınca `barOffset = front_world − Z1`; rechuck (aç, ΔZ1, kapa) → `barOffset −= ΔZ1`, parça koordinatı korunur
- kesme (N100): `Z = L + w + #120` (back = ayna tarafı kenar referansı, atölye), front referansta `L + #120`; fark = w

## Çevrim (kayarTemplate.js)

M11 aç → `G0Z-fs T0` → `G125Z-fs` (ayna açık: ön alın dünya −fs'de) → M10 kapa (`barOffset = 0`,
yani program Z = parça koordinatı, ham alın −fs'de) → `G0W-12.` → pasolar → (isteğe bağlı ara rechuck)
→ N100 kesme. `cycle()` zaman sıralı Z1 dizisi + olay listesi döndürür.

## JS uygulamasıyla uyum

- `frames.js toMachine`: `Z = pos.Z + zShift` ↔ burada `zShift = −barOffset`
- `stockSim.js`: `mainFrontWorld(z1) = mainOpen ? frontWorld : z1 + barOffset`, `zeroSet`, `mainChuckOpen/Close` birebir `MachineState`'te
- G131 (P2, ana mil sıfırını karşı mile aktarma) bu modülde yok; yalnız kanal 1.

## Doğrulama / segmentleme

`validate()`: Z1 strok (−20..205), `max_overhang`, burç geri-çekme kuralı (ham/burç çapından ince
işlenmiş kesit burca geri girmemeli: burçtaki d ≥ işlenmiş en derin d).
`segment()`: çıkıntı sınırı aşılırsa `segment` sınırı (destek gerekir), Z1 üst strok aşılırsa `rechuck`.

## Çalıştırma

```
python -m pytest analiz/swiss_z1/tests -q
python -m analiz.swiss_z1.example
```
