# Kayar CAM — Star SB-20R Type G (FANUC 0i-TF)

**▶ [Programı tarayıcıda aç](https://hakanaydemir20.github.io/kayar-cam/)** — kurulum gerekmez. Programı internetsiz kullanmak için o sayfayı tarayıcıda *Farklı kaydet* ile tek dosya olarak kaydedebilirsiniz.

[![Test ve yayın](https://github.com/hakanaydemir20/kayar-cam/actions/workflows/pages.yml/badge.svg)](https://github.com/hakanaydemir20/kayar-cam/actions/workflows/pages.yml)

> Post-processor makinedeki örnek programla henüz doğrulanmadı. Üretilen her programı makinede önce kuru çalıştırma / tek blok modunda deneyin.

Kayar otomat (Swiss-type) için çevrimdışı çalışan bir CAM programıdır. İş akışı Mastercam Torna ve ESPRIT Swiss modüllerine benzer:

1. STEP parça yükleme
2. Bağlama ve sıfır noktası
3. Özellik tanıma ve otomatik işlem planı
4. İki kanallı ($1/$2) senkron program
5. Gerçekçi 3D makine simülasyonu
6. Tam makine çarpışma kontrolü
7. Verify (talaş kaldırma karşılaştırması)
8. FANUC G-kod çıktısı
9. Kurulum föyü

## Çalıştırma

- **Kullanım:** `dist/index.html` dosyasına çift tıklayın. Kurulum ve internet gerekmez; tek dosyadır ve OpenCascade içindedir.
- **Geliştirme:**
  ```
  npm install
  npm run dev        # canlı geliştirme sunucusu
  npm test           # birim + uçtan uca testler + rastgele parça taraması (vitest)
  FUZZ_N=200 npm test  # taramayı genişlet (varsayılan 30 + 30 parça)
  npm run test:ui    # derle + tarayıcıda arayüz testi (Playwright)
  npm run build      # dist/index.html üret
  ```

## İş akışı

Üstteki ray beş durağı sırayla gösterir. Her durak kendi durumunu taşır: mavi = hazır, kırmızı = sorun var (tıklayınca sorunun yerine gider), turuncu = kontrol sürüyor.

| Durak | Ne yapılır |
|---|---|
| **1 Parça** | İlk açılışta ya da **Yeni** ile başlangıç ekranı gelir: *3D model aç* (STEP), *Ölçülerden çiz* (çap/boy/pah/radyüs satırları), *Örnek parçayla dene*, *Kayıtlı projeyi aç*. |
| **2 Bağlama ve sıfır** | Kurulum penceresi parçayı 3D gösterir. **Torna ekseni** (STEP): otomatik ya da silindirik yüze tıklayarak. **Ön yüz**: yeşil halka ön, turuncu halka arka (kesme) tarafıdır; *Ön ve arkayı değiştir* düğmesiyle ya da modelin ucuna tıklayarak çevrilir. **Referans noktası (Z0 X0)**: ön alın merkezi (önerilen), arka alın merkezi, *modelden seç* (düz alın yüzüne ya da profil köşesine yapışır) veya ön alından mm değeri. X0 her zaman torna eksenidir. **Çubuk**: önerilen standart çap, alın payı, tanınan özelliklerin seçimi. |
| **3 İşlemler** | Özelliklerden otomatik işlem planı kurulur. Sol paneldeki **+ İşlem ekle** gruplu menüden yeni işlem ekler; sağ panelde parametreler. Sürükle-bırak ile sıra değişir. |
| **4 Simülasyon** | Makine modelinde oynatma, NC satırıyla senkron; Verify ve çarpışma sonuçları. |
| **5 NC kod** | Özet (program no, satır sayısı, çevrim süresi), kontrol sonucu ve **NC kodunu indir**. Hata, çarpışma ya da fazla kesim varsa indirme kilitlidir. Kurulum föyü buradan da açılır. |

**Basit / Uzman modu** (sağ üst): Basit modda şerit, ek görünüm açıları, takım listesi ve makine ayrıntıları gizlenir; Uzman modda Mastercam benzeri işlem şeridi, bütün görünüm seçenekleri ve Z0 için sayısal alan açılır. Seçim tarayıcıda hatırlanır.

Ayrıntılı paneller:

| Yer | Açıklama |
|---|---|
| Sol ağaç → **Çubuk** | Çubuk çapı, alın payı, G50 devir limiti, kılavuz burç segment boyu, çubuk boyu ve kalan uç. Çubuk başına parça, malzeme verimi ve saatte parça burada görünür. |
| Sol ağaç → **Takımlar** | Takım no/ofset, tip, ünite, ölçü, Vc, ilerleme, yanal (Y1) ve radyal (X1) montaj konumu. "STEP Model Yükle" ile üretici 3D modeli bağlanır (yalnız görsel). |
| Alt panel | **NC Kod:** iki kanal yan yana ve simülasyonla senkron; bir satıra tıklayınca o ana gidilir. **Senkronizasyon:** zaman çizelgesi, örtüşen çevrim, sürükle-bırak. **Hatalar** ve **Verify** sekmeleri. |
| **Kurulum Föyü** | Takım listesi, işlem sırası ve süreleri, sıfır noktası, çubuk akışı, profil çizimi ve uyarılar. Yazdırılabilir veya HTML olarak indirilebilir. |

### İşlemler

| Grup | İşlemler |
|---|---|
| Torna ($1) | Alın, Kaba (Z'ye paralel / profile paralel / alın), İnce, Kanal, Diş (G92 veya G76), Punta, Delme (açık gagalama veya G83), Kılavuz (yüzer G32 veya rijit M29+G84), Kesme, Çubuk İlerletme, Ara Bağlama |
| Frezeleme (C/Y) | Çapraz Delme, Düzlük, Çokgen, Çap Kanalı (G7.1), Yazı/Gravür (G7.1), Helikal Cep (G19) |
| Karşı iş mili ($2) | Karşı Mile Al, Arka Tornalama, Arka Delme, Arka Kılavuz, Arka Alın Kanalı (C2), Arka Alın Çokgeni (G12.1), Parça Atma |

Kısayollar:

| Tuş | İşlev |
|---|---|
| **Boşluk** | Oynat / duraklat |
| **← →** | Önceki / sonraki NC satırı |
| **T** | Takım yolunu göster / gizle |
| **E** | Eksen oklarını göster / gizle |

## Frezeleme ve arka işlemler

- **Çokgen (çapta):** Her kenar bir düzlük olarak işlenir. C ile indekslenir, çapraz tahrikli frezeyle Y yönünde zikzak yapılır. Her pasoda iki uç tam süpürülür, böylece kenar uçlarında tarak izi kalmaz.
- **Çap kanalı ve yazı (G7.1):** Silindirik interpolasyonda Z ve C (derece) birlikte hareket eder; ilerleme yüzey boyunca hesaplanır.
  - Yazı tipi tek çizgilidir: A–Z, 0–9 ve `- . / +` karakterleri.
  - Türkçe harfler ASCII karşılığına çevrilir.
- **Arka tornalama:** Profil arka alından aynalanır; ön tornalamadaki uç radyüsü ve arka açı hesabı aynen kullanılır.
  - Kesme işleminde arka alın payı bırakılabilir; arka tornalama bu payı alır.
  - Arka tornalamada en büyük derinlik, pens somunu arka takım uçlarına 1 mm'den fazla yaklaşmayacak şekilde sınırlanır.
  - Arka delme, kılavuz ve alın frezesinde sınır gövde geometrisinden hesaplanır: karşı iş mili (somun, burun, flanş) arka ünitedeki komşu takım ve tutuculara 0.5 mm'den fazla yaklaşmaz (çarpışma kontrolüyle aynı kural).
- **Karşı mil pens somunu:** çıkıntı 1.5 mm ve Ø30 varsayılandır (`machine.subSpindle.nutProtrusion`, `nutDia`; tahmini). Kısa parçalarda tutma boyu otomatik kısaltılır: somun alnı kesme düzleminden en az 0.5 mm önde kalır.
- **Diş:** G92/G76 her pasoda X'e hızlı daldığı için başlangıç noktasında uç (60°, ±3 mm) boşta olmalıdır. Önde büyük omuz varsa giriş boyu kısaltılır; sığmıyorsa ya da diş silindirin ortasından başlıyorsa açıklayıcı hata verilir (diş önüne pah, boşaltma kanalı ya da parça önü gerekir). Diş sonuna büyük omuz dayanıyorsa boşaltma kanalı istenir.
- **Arka alın kanalı (C2):** X2 tek eksen olduğu için kanal merkezden geçer ve kanal genişliği takım çapına eşittir.
- **Arka alın konturu (G12.1):** Polar interpolasyonda X çap, C hipotetik eksen (mm) olarak yazılır. Simülasyon bunları gerçek X2/C2 hareketine çevirir.
- **Ön alında polar frezeleme yok:** SB-20R Type G'nin ön kovan takımları tahrikli değildir.
- **Pinch (iki takımla aynı anda) tornalama yok:** Bu makinede ana iş miline ikinci bir takım tezgâhı yoktur. Paralel çalışma, örtüşen çevrimle sağlanır.

## Senkronizasyon, segmentasyon, uzun parça

- **Örtüşen çevrim** (Senkronizasyon sekmesi):
  - $2 önce önceki çevrimde aldığı parçanın arka işlemlerini yapar ve parçayı atar, sonra yeni parçayı alır. Böylece arka işlemler $1'in ön işlemleriyle paralel yürür.
  - Simülasyonda karşı iş mili çevrim başında önceki parçayı tutar. Verify bitmiş parçayı kontrol eder.
  - İlk çevrimde karşı iş mili boştur; ilk parça arka işlemsiz çıkar.
- **Zaman çizelgesi:** Bir bloğu sürükleyip başka bir bloğun üstüne bırakarak işlem sırasını değiştirebilirsiniz.
- **Kılavuz burç segmentasyonu:** *Stok → segment boyu* girilirse kaba ve ince tornalama bölge bölge yapılır. Kanal, diş ve çapraz işlemler kendi bölgesinden hemen sonra gelir. Böylece işlenmiş ince bölüm burçtan desteksiz uzamaz.
- **Ara bağlama (uzun parça):** Z1 strokundan (205 mm) uzun parçalar için kullanılır.
  - Karşı iş mili parçanın ucunu tutar, ana pens açılır, başlık *geri çekme* kadar geri gider, pens kapanır.
  - Program Z'si parça koordinatında kalır. İş kaydırması `G10 P0 Z…` ile yapılır ve çevrim sonunda sıfırlanır.
- **Sabit çevrimler** (Post ayarlarında, varsayılan olarak kapalı):
  - G83 gagalamalı delme (`R0.`, Q µm cinsinden)
  - M29 + G84 rijit kılavuz
  - G76 diş (iki blok)
  - Simülasyon bu çevrimleri post'un yazdığı biçimle açar.
  - **G71/G70 bilinçli olarak yok.** Bu çevrimlerin hareketi kontrol parametrelerine bağlıdır (5132/5133, tip I/II). Simülasyon makinenin yapacağını garanti edemez, bu yüzden kaba tornalama açık pasolarla yazılır.

## 3D görünüm

- **Makine modeli:** Star SB-20R Type G ürün fotoğrafı ve kinematik şemasına göre çizildi.
  - Kabin: gri kabin, mavi kule, FANUC paneli (ekranda canlı eksen konumları), pencereli kapı.
  - Gang takımları: tornalama takımları 1–6, sağda +X1/±Y1 etiketli çapraz tahrikli blok (11–14), tornalama takımlarının altında turuncu hortumlu kovan takımları (21–24).
  - İnce konik kılavuz burç ucu.
  - Beyaz karşı iş mili gövdesi ve mavi arka ünite.
  - Ünite gövdeleri çarpışma kontrolüyle aynı kaynaktan üretilir (`src/sim/bodies.js`).
- **Görünüm seçenekleri:**

  | Seçenek | Değerler |
  |---|---|
  | Kabin | Tam / Ön kapaklar yok / Gizli |
  | Eksenler | Kırmızı X1, Y1, Z1, C1, X2, Z2, C2 okları ve yanlarında makine koordinatı |
  | Takım yolu | Tümü / Aktif işlem / Seçili işlem / Gizli. Ağaçta her işlemin yanındaki göz düğmesi o işlemin yolunu gizler. |
  | Takımlar | Aktif + saydam / Yalnız aktif / Tümü. Kovan bloğu, kovan takımı kullanılmıyorken saydam görünür. |

- **Koordinat paneli:** Her eksen için Mutlak (program), Makine ve Kalan (satır sonuna kalan mesafe) değerlerini gösterir.

## Koordinat ve program yapısı

- **Eksenler:**
  - X çap olarak programlanır.
  - Z0 parça ön alnıdır; Z+ başlığa doğrudur (kayar başlık parçayı dışarı iter).
  - Y gang plakasının yanal eksenidir; C derece cinsindendir.
- **Kanallar:** $1 ana iş mili + gang tool post (X1/Y1/Z1/C1). $2 karşı iş mili (X2/Z2/C2).
  - G54 aktarma çerçevesidir.
  - G55 arka işleme çerçevesidir; Z arka alından derinliktir.
- **Takım montaj konumu (Y1 yanal, X1 radyal):** Örneğin kovan takımları 52 mm aşağıdadır; gang plakası bu takımları kullanırken o kadar yukarı kalkar. NC programı değişmez; bu değerler yalnız makine koordinatına ve strok kontrolüne girer.
- **Kanal senkronu:** Bekleme kodları M201'den başlayarak sırayla dağıtılır.
  - Ara bağlama: her biri için 3 kod.
  - Parça alma: karşı mil yaklaşabilir / parça tutuldu / kesme bitti.
  - Başlangıç kodu Post ayarlarından değiştirilebilir.
- **Yaklaşma sırası:** Her zaman önce güvenli X, sonra Y/Z, en son X. Ön eksenel takımlardan önce parça Z-1'e çekilir.
- **Karşı mil bekleme konumu:** Karşı iş mili, ön kovan takımlarının erişiminin dışında bekler.
- **Çubuk ilerletme:** Kesme takımı durdurucu olur; pens açılır, başlık `Z−(kesme genişliği + alın payı)` konumuna gider, pens kapanır. Böylece bir sonraki parçada alın payı kalır.
- **Program başı:** `G18 G21 G40 G80 G97 G99`. Her takım değişiminden sonraki ilk kesme satırında F her zaman yazılır.
- **Parça sayacı:** M kodu Post ayarlarında tanımlanırsa program sonunda yazılır.

## Hata önleme katmanları

1. **CAM kontrolleri:** takım/özellik uyumu, kapasiteler, kanal/takım genişliği, Z1 stroku, arka işlem derinliği.
2. **G-kod yorumlayıcı:** Çıkan NC metni yeniden okunur ve şunlar kontrol edilir:
   - strok ve devir limitleri
   - eksik F/S
   - dönmeyen iş mili veya tahrikli takım
   - yanlış kanaldaki takım
   - yay yarıçap tutarlılığı
   - C ekseni modu
   - bekleme kilitlenmesi
3. **Post öz-kontrolü:** CAM'in amaçladığı her konum, yorumlanan konumla karşılaştırılır.
4. **Talaş simülasyonu:** G0 ile malzemeye temas, iş mili dururken tornalama, eksenel takım gövdesinin parçaya değmesi.
5. **Tam makine çarpışma kontrolü:** Her iki kanalın eşzamanlı konumunda yaklaşık 1 mm aralıklarla yapılır. Aktif takımın yalnız kesici bölgesi parçaya değebilir. Kontrol edilen çiftler:
   - takım, tutucu ve ünite gövdeleri ↔ parça ve çubuk
   - gang ↔ burç, karşı iş mili, arka ünite
   - karşı iş mili ↔ ana parça
   - karşı iş milindeki parça ↔ arka ünite
6. **Verify:** Simülasyon sonundaki stok, hedef parçayla hücre hücre karşılaştırılır. Fazla kesim kırmızı, kalan malzeme mavi gösterilir.
7. **Rastgele parça taraması (test):** Her test çalıştırmasında rastgele profiller ve özellik karışımları (delik, çapraz/kör delik, düzlük, diş, cep, çokgen, çap kanalı, yazı, arka alın işlemleri, G83, örtüşen çevrim, segmentasyon) üretilir. Her biri için CAM hatası, çarpışma ve fazla kesim olmamalı, Verify tam olmalıdır.

## Makineden doğrulanması gerekenler (önemli)

Program, bu maddeler doğrulanana kadar **"POST DOĞRULANMADI"** uyarısı verir.

- **M kodları:** iş mili, karşı iş mili, tahrikli takım, C ekseni, pens, senkron, bekleme, parça atma, rijit kılavuz. Makinenizdeki çalışan bir programla ya da paneldeki M kodu ekranıyla karşılaştırıp **Post / Makine** ayarlarından düzeltin.
- **Çevrim ve kaydırma biçimleri:** G7.1 (`C` = yarıçap), G12.1/G13.1, `G10 P0 Z` iş kaydırması, G83/G84/G76.
- **Eksen strokları:** X1, Y1, X2, Z2 tahminidir; yalnız Z1 = 205 mm katalogdan alındı.
- **Takım yerleşimi ve ünite ölçüleri:** Takım numaraları ve yanal/radyal konumlar varsayılan değerlerdir: gang adımı 18 mm, kovan takımları 52 mm aşağıda, arka ünite takımları 20 mm aralıklı. Ünite ölçüleri (`bodies.js`) tahminidir; çarpışma kontrolü bunlara göre çalışır.
- **İlk deneme:** Her yeni programı makinede önce **kuru çalıştırma / tek blok** ile ve düşük hızlı ilerleme oranında deneyin.

## Bilinen sınırlar

- Simülasyon tek parça çevrimini gösterir. Örtüşen çevrimde önceki parça ayrıca modellenir.
- Çarpışma gövdeleri basitleştirilmiş katılardır (kutu ve silindir). Üreticinin STEP takım modelleri yalnız görseldir.
- Stok modeli bir yükseklik haritasıdır (0.05 mm × 3°). Alında dış yüzeye ulaşmayan iç boşluklar gösterilmez.
- G76'nın kanattan besleme kaydırması simülasyonda radyal kabul edilir; fark yalnız diş ağzının önündeki boşluktadır.
- Diş, STEP dosyasında modellenmediği için elle eklenir.

## Klasör yapısı

```
src/machine   makine tanımı (sb20r-g.json)
src/post      FANUC/Star post-processor + M kodu profili
src/ops       işlem üreteçleri, iki kanallı program kurucu (senkron, segmentasyon, örtüşen çevrim)
src/geom      profil örnekleme, uç radyüsü telafisi, yay uydurma, tek çizgili yazı tipi
src/cad       STEP okuma (OpenCascade WASM), bağlama, özellik tanıma
src/tools     takım kütüphanesi, kesme verisi, takım geometrisi (3D model ve çarpışmada ortak)
src/sim       G-kod yorumlayıcı, kanal senkronu, stok simülasyonu, çarpışma gövdeleri ve kontrolü, Verify
src/view3d    3D makine, kabin, takım modelleri, stok ağı, takım yolu
src/ui        arayüz, kurulum sihirbazı (ön yüz / referans), kurulum föyü
tests         birim ve uçtan uca testler (+ STEP örnek parçalar)
```
