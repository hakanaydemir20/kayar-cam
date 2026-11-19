# Takım kütüphanesi gereksinimi · Hakan

Operatör, **STAR SB-20R Type G Variation 04 / FANUC 0i-TD** üzerinde işlem eklerken uygun takımı hazır kütüphaneden seçebilmeli veya ölçülerinden oluşturup tekrar kullanım için kaydedebilmeli. CAM’de **takım tanımı** kesici geometrisini, **takım montajı** ise kesicinin tutucu, çıkma, istasyon ve ofsetle birlikte kurulumunu ifade eder. [Autodesk takım kütüphanesi](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-TOOL-LIBRARY-OVERVIEW.htm)

**Mevcut durum.** `toolLibrary.js` düz takım kayıtları ve sabit katalog kullanıyor. `insertOutline` uç dış hattını, `insertLowerTable` simülasyon için alt zarfı, `insertEdges` erişim açılarını üretiyor. `toolMeshes.js` bazı döner takım boylarını varsayıyor. `app.js` işlem eklerken ilk tip ve kanal eşleşmesini seçiyor, simültane işlem ayrı sihirbaz açıyor. `settings.js` görünüm tercihlerini saklıyor.

**Atölye kanıtı.** 157 aday NC/metin dosyasının parantez yorumları tarandı. Açık örnekler arasında DCMT11T302 R0,2 tornalama ucu, 1 mm kanal keskisi R0,04, kesme ucu genişliği, Ø2,1/2,5/3,4/4,3 matkap, Ø1/3/6 freze, M2,5/M3/M4/M5 kesici kılavuz, M2,5 ovalama kılavuzu, 2-56 kılavuz ve M2,5/M3/M5 diş frezesi var. Genel freze ve pah yorumlarında uç biçimi **BİLİNMİYOR**. Yorumların kaynak statüsü `PROGRAM`.

## 1. Takım tipi kataloğu

Uzunluklar mm, açılar derece. Boyutlar sonlu ve pozitif, radyüsler sıfır veya pozitif ve profile sığmalı. Ağız sayısı pozitif tam sayı, helis açısı mutlak değerce 0–<90°, konik uç açısı >0–<180°. Makineye bağlı üst sınırlar montaj doğrulamasından gelir.

**İstasyon adayları.** G, T1–T6 gang. Ç, T31–T35 çapraz tahrik. Ö, P1 ön eksenel. A, P2 arka sabit. AT, P2 arka tahrikli. Ö/A/AT fiziksel eşlemeleri **BİLİNMİYOR**. Mevcut `STATIONS` ve `UNIT_NUMS` T35’i ön kolon sayıyor. Doğrulanmış Variation 04 düzeninde T35 beş bağımsız çapraz milden biridir. Bu kayıtlar otomatik montajda kullanılmadan önce doğrulanmış makine düzenine bağlanmalı.

| Takım | Parametreler ve kesici geometri | İstasyon adayı ve `OP_TYPES` |
|---|---|---|
| ISO C/D/V/T/W/R/S | C 80°, D 55°, V 35°, T 60° üçgen, W 80° trigon, R yuvarlak, S 90° kare. Kenar boyu veya çap ve ölçü türü, kalınlık, burun R, boşluk açısı [0,90°), yaklaşma açısı (0,180°), aktif kenar, el, FANUC uç yönü. R tipinde radyüs D/2. | G · `face`, `rough`, `finish` |
| Arka tornalama | ISO uç alanları, arka montaj yönü, uç referansı ve gövde erişimi. | A · `backTurn` |
| Küçük delik kateri | Sap ve kafa kesiti, boyun çapı/boyu, asgari delik çapı, iç kesici kenar, çıkma ve erişim. | G/Ö/A · İç tornalama stratejisi gerekli. |
| Kesme ve kanal | Bıçak genişliği, kalınlığı, çıkması ve kesme derinliği, köşe radyüsleri ≤ genişliğin yarısı, iç/dış/alın, kesme yönü ve referans kenarı. | G · `cutoff`, `groove`. İç ve alın kanalı ayrı erişim desteği ister. |
| İç/dış diş kateri | Profil açısı, adım veya adım aralığı, uç R, el, tam/kısmi profil, diş başlangıç sayısı. İç dişte asgari delik çapı ve boyun. | G/A · `thread` dış diş. İç ve P2 desteği doğrulanmalı. |
| Punta ve matkap | Punta pilot çap/boyu, gövde çapı ve açı. Matkap çap, uç açısı, ağız boyu, uç konisi ve kör delik erişimi. | Ö/A/Ç · `center`, `drill`, `backDrill`, `crossDrill` uygun tipe göre. |
| Kademeli matkap ve rayba | Kademeli matkapta uçtan sıralı çap/boy/geçiş profilleri. Raybada çap, giriş pahı ve boyu, ağız boyu, ön delik ve çalışma payı. | Ö/A/Ç · Delme ailesi aday. Varyanta özel çevrim ve geometri gerekir. |
| Kesici ve ovalama kılavuzu | Nominal çap, adım, profil, yön, giriş diş boyu, etkin boy, sap tahrik biçimi. İnç adımında 25,4/TPI mm. | Ö/A · `tap`, `backTap`. Ç aday. `ltap` tanımlı, çapraz kılavuz işlemi eksik. |
| Diş frezesi | Kesici çap, boyun çap/boyu, profil açısı, adım/aralık, profil boyu, tek/çok profilli, iç/dış. | Ç/AT · Helisel diş freze stratejisi gerekli. |
| Düz, küresel, radyüslü ve pah frezesi | Çap, ağız boyu, ağız sayısı, merkezden dalabilme. Düz R=0, küresel R=D/2, radyüslü 0<R<D/2. Pahta uç çapı ≥0, kafa çapı > uç çapı, açı ve etkin boy. | Ç/AT · `flatMill`, `areaMill`, `pocketMill`, `simMill`, `polygonMill`, `cylSlot`, `backSlot`, `backPolar` uygun profile göre. `crossDrill` dalabilir frezeyle. |
| Kama ve T kanal | Kafa çap/boyu, kesme genişliği, köşe R ve dalabilme. T takımında boyun çapı < kafa çapı, boyun boyu ve giriş zarfı. | Ç/AT · `cylSlot`, `backSlot` aday. T kanal için giriş/çıkış ve alttan kesme yolu gerekir. |
| Poligon | C/Y çokgen için düz freze. Senkron kafa için kesme çapı, uç sayısı/konumu, kafa zarfı, oran ve faz. | Ç · `polygonMill` düz frezeyle. Senkron kafa arayüzü ve post desteği **BİLİNMİYOR**. |
| Gravür | Uç çapı ≥0, açı, uç R ve etkin boy. Kesme genişliği derinlikten türetilir. | Ç · `engrave`. Uç profilini tüketen yol modeli gerekir. |

**Tutucu ve ortak geometri.** Kater için sap kesiti/boyu ve kafa, vida, kelepçe zarfı kaydedilir. Döner ve eksenel takım için sap çap/boyu, boyun kademeleri, pens/kovan arayüzü, sıkma çap aralığı, asgari kavrama ve tutucu çap/boy segmentleri kaydedilir. Toplam boy, tutucu yüzünden çıkma ve ölçüm düzleminden uca mesafe ayrı alanlardır. Aynı takım çerçevesindeki kesici ve pasif geometri, canlı 2B, 3B mesh, talaş kaldırma ve çarpışmayı besler. Tornalama geometrisi mevcut üç işlevi kullanır. Özel takımlar ölçülü kesit/devir profili veya yerel STEP ile tanımlanabilir. Kesici bölgeleri ve takım çerçevesi belirtilmemiş özel takım taslak olarak saklanır. [Autodesk takım montajı ve ölçüm düzlemi](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-TL-MILL-HOLDER-GAUGE-LINE.htm)

## 2. Doğrulama

- Ana mil **10.000**, karşı mil **9.000 dev/dk**. T31–T35 için ayrı azami devir, eksen, merkez, dönüş yönü ve çarpışma zarfı **BİLİNMİYOR**. Aktif mil, takım ve tutucu limitlerinin en düşüğü geçerli. Sabit devir ve CSS tavanı kontrol edilmeli. Gerekli makine verisi eksikse taslak ve önizleme açılabilir, üretim NC’si bloke edilir.
- Kılavuz aynı eksende ve doğru bağlamada uygun çap ve derinlikte ön delik ister. Kesici ve ovalama kılavuzu için ön delik tabloları ayrı tutulur. Kör delikte giriş dişi, dip payı ve geri dönüş kontrol edilir. Adım, yön, ilerleme modu ve senkron çevrim birlikte doğrulanır.
- Sap pens aralığına sığmalı, kavrama kullanılabilir sap içinde asgari boyu karşılamalı. Çıkma toplam boydan küçük ve erişim hedef derinliğe yeterli olmalı. Yaklaşma, kesme ve çekilmede tutucu ve komşu takımların GB/NGB bağlaması, kovan, pens ve parçaya açıklığı kontrol edilir.

## 3. Veri modeli ve göç

- Kütüphane şablonunda kimlik, revizyon, ad, mevcut `type`, yeni `variant`, `geometry`, `holder`, isteğe bağlı kesme verisi ve alan bazlı kaynak tutulur. Hazır şablonlarda makine konumu ve T/ofset boş bırakılır.
- `project.tools` şablonun ölçü kopyasını ve montajı taşır. `id` ve `ops[].toolId` korunur. `type`, `unit`, `num`, `offset`, `channel`, `live`, `dia`, `length`, `noseR`, `width`, `pitch`, `tipAngle`, uç alanları ve konum alanları mevcut tüketicilere uyumlu biçimde sunulur. Fiziksel istasyon kimliği, takım numarası ve FANUC ofseti ayrı saklanır.
- `loadProject` içinde tekrarlanabilir v1→v2 göçü yap. Eski ölçüler, kimlikler, ofsetler ve uyum davranışı korunur. Varsayılan boy ve konumlar doğrulanmış veri statüsü almaz. Eski T35 ön kolon kaydı mevcut bağlamıyla açılır ve üretim doğrulaması için elle eşlenir. Projeyi açmak için yerel kütüphane gerekmez. Şablon revizyonu açık işlemle mevcut montaja uygulanır.

## 4. İşlem ekleme

1. **Hazır kütüphaneden seç** takılı uygun takımları, ardından hazır ve kullanıcı şablonlarını gösterir. Filtre işlem, varyant, kanal, yön, tahrik, çap/erişim ve istasyon uygunluğunu kullanır. Uygunsuzluğun nedeni görünür.
2. **Yeni takım oluştur (parametrik)** ilgili aileden açılır. Canlı ölçekli önizlemede kesici, tutucu, uç referansı, ölçüm düzlemi ve çıkma görünür. Operatör **Bu işlemde kullan** veya **Kütüphaneye kaydet ve kullan** seçer.
3. Takılı takım tekrar kullanılabilir. Yeni montajda istasyon, yön, tutucu ve FANUC T/ofseti doğrulanır. Dolu istasyonda değiştirme için açık onay alınır ve etkilenen işlemler gösterilir. İptal kısmi kayıt bırakmaz.
4. Simültane sihirbaz aynı takım seçimini kullanır. Yüzey, parça sıfırı, bağlama, yaklaşma/çekilme ve finiş payı işlemde kalır. `pickoff`, `eject`, `rechuck` ve `midRechuck` takım seçimi açmaz.

## 5. Başlangıç hazır kütüphane

- C/D/V/T/W/S için örnek 6–11 mm kenar, R0,2/0,4. R uç Ø6/8, arka V R0,2, küçük delik kateri Ø3 sap.
- Kesme 1,2/1,5/2 mm, kanal 1/1,5/2 mm, iç/dış 60° diş 0,5/0,7/0,8/1 mm adım.
- Punta Ø3/4, matkap Ø2,1/2,5/3,4/4,3/6, kademeli Ø2,5→4, rayba Ø3/4/6.
- Kesici M2,5/M3/M4/M5 ve 2-56, ovalama M2,5. Diş frezesi M2,5/M3/M5 şablonu. Kesici çap ve boyun operatörden.
- Düz freze Ø1/2/3/4/6, küresel Ø2/4, radyüslü Ø4 R0,5, 90° pah Ø4, kama Ø3, T kafa Ø5×1, poligon için düz Ø4/6, 60° gravür.

Bunlar üretici modeli içermeyen genel şablon ölçüleridir. Tutucu, istasyon, çıkma ve kesme verisi kurulumda girilir.

## 6. Kabul testleri

- Her aile oluşturulur ve tekrar açılır. Aynı montaj iki seçim yolundan da aynı takım yolunu verir. Uyumsuz işlem, dolu istasyon, eksik konum ve T35 çakışması kontrollü biçimde durdurulur. İptal proje durumunu korur.
- ISO uç dış hatları, kademeli matkap ve küresel/T kafa kesitleri analitik ölçüyle karşılaştırılır. Çıkma değişince önizleme, mesh ve çarpışma birlikte değişir. Uç sığarken tutucu değdiğinde çarpışma görülür.
- Dar iç delik, dalmaya uygun olmayan freze, eksik T kanal girişi ve yanlış kılavuz ön deliği reddedilir.
- Post edilmiş NC’de kanal, T/ofset, G98/G99, kılavuz senkronu, çekilme ve devir sınırı doğrulanır. Tam sınır ve +1 dev/dk sınanır. Aynı NC yorumlanarak uç hareketi ve kaldırılan stok karşılaştırılır.
- Bağımsız STEP kesitlerinde tornalama, kademeli delik ve radyüslü frezede fazla kesim ve kalan talaş önceden belirlenmiş toleransla ölçülür.
- V1 dosyası açılır, kaydedilir ve tekrar açılır. Kimlik, ofset, işlem bağlantısı ve eski uyum davranışı korunur. Kütüphane revizyonu mevcut montajı kendiliğinden güncellemez.

## 7. Açık sorular

1. Ön/arka sabit ve arka tahrikli montajların fiziksel yuva kimlikleri, FANUC T/ofset eşlemeleri ve tutucu ölçüleri nedir?
2. T31–T35’in her biri için devir, eksen/merkez, dönüş yönü ve tutucu arayüzü nedir?
3. Atölyedeki punta biçimi, sap/pens aralıkları ve kesici/ovalama ön delik tabloları paylaşılabilir mi?
4. Diş frezesi, iç tornalama, T kanal ve senkron poligondan hangileri ilk uygulamaya girmeli? Senkron poligon kafası takılı mı?
5. Kütüphane cihazda mı kalacak, atölye paylaşımı için içe/dışa aktarma gerekli mi?

