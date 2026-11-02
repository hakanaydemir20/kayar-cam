# Kayar CAM — Star SB-20R Type G (FANUC 0i-TF)

**▶ [Programı tarayıcıda aç](https://hakanaydemir20.github.io/kayar-cam/)** — kurulum gerekmez. Programı internetsiz kullanmak için o sayfayı tarayıcıda *Farklı kaydet* ile tek dosya olarak kaydedebilirsiniz.

[![Test ve yayın](https://github.com/hakanaydemir20/kayar-cam/actions/workflows/pages.yml/badge.svg)](https://github.com/hakanaydemir20/kayar-cam/actions/workflows/pages.yml)

> Post-processor makinedeki örnek programla henüz doğrulanmadı. Üretilen her programı makinede önce kuru çalıştırma / tek blok modunda deneyin.

Kayar otomat (Swiss-type) için çevrimdışı çalışan bir CAM programıdır. İş akışı Mastercam Torna ve ESPRIT Swiss modüllerine benzer:

1. STEP / OBJ parça yükleme
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

## Ekran düzeni

| Bölge | İçerik |
|---|---|
| **Üst çubuk** | **Aç ▾** (yeni parça, 3D parça aç: STEP/OBJ, çizim yap, G kodu ile simülasyon, boş G-kod programı, kayıtlı proje) · **Kaydet** · ortada durum · **İşlem ekle** · **NC kodu** (kontrol özeti + indir) · **⚙ Ayarlar** · **?** yardım turu. |
| **Sol: kartlar** | **Parça kartı** (boy, çap, Z0, çubuk, özellikler; *Bağlama* düğmesi) · **Takımlar** kartı · **$1 Ana iş mili** ve **$2 Karşı iş mili** işlem kartları. Bir karta tıklayınca ayarları kartın içinde açılır. Kartlar sürüklenerek sıralanır, anahtarla açılıp kapanır, ◉ ile takım yolu gizlenir. |
| **Orta: grafik** | **3D** (makine iç yapısı açık, dış kaporta kapalı; *Görünüm ▾* menüsünden değişir) veya **2D** XZ kesit (stok, hedef profil, takım yolları, gerçek kesici uç silueti). Kısayol `2` / `3`. Altta oynatma çubuğu. |
| **Sağ: G-kod** | Oynayan satır vurgulanır. Kod elle yazılır, kopyalanır, yapıştırılır; yazdıkça hareket çizilir, **Enter / Insert (EOB)** satırı oynatır. Sekmeler: Uyarılar, Zamanlama, Kontrol (Verify). |

### Öne çıkanlar

- **Kaba otomatik** (sol menü): seçilen malzeme ve takıma göre değerler önerilir.
  - Girilenler: malzeme, takım, en fazla paso, ilerleme, Vc ve G50 devir sınırı, finiş payları.
  - Ekranda: devir, ilerleme hızı, talaş hacmi ve teorik Ra.
  - **Erişim analizi:** elmasın uç açısıyla erişemediği bölgeler profilde kırmızı gösterilir. Taretteki takımlar "erişir / erişemez" diye listelenir; ikinci takım kalan bölgeleri işler (kaba işlem Z aralığı) ya da kanal takımı önerilir.
- **Senkron alma** ($1 ile $2 listeleri arasında): kesmeden önce karşı iş mili ana mil eksenine hizalanır ve aynı devirde senkronlanır.
  - Tutma boyu ya da parça sıfırına göre yanaşma Z'si sorulur; hızlı yaklaşma boşluğu, yaklaşma ilerlemesi ve pens beklemesi de ayarlanır.
  - Sonuç "Karşı iş miline al" işlemi olarak eklenir.
- **Takımlar** (üst çubuk):
  - **Kartlar:** T01, T02… kare kartlar; kapakta takımın 3D görseli, önden bakışla.
  - **Ayrıntı:** karta girince Genel, Kesici uç (elmas), Ölçüler, Kesme değerleri, Montaj ve 3D model bölümleri.
  - **Katalog:** "+ Yeni takım" ile her kategoriden (dış tornalama tutucuları SVJCR/SDJCR/SCLCR/STGCR/MWLNR/SRDCN, kanal, kesme, diş, tahrikli freze/matkap/kılavuz, kovan matkap/punta/kılavuz, karşı mil) en az 5 tip.
  - **Elmaslar:** her uç tipinden 5 yaygın ISO elmas; katere uyan elmaslar tıklanarak takılır.
  - **Talaş kırıcı:** F / M / R / W.
- **Kesici uç seçim kuralları** (Sandvik Coromant):
  - Köşe açısı: dayanım ile erişim arasındaki denge.
  - Paso: kesme kenarı boyunun uç tipine göre bir oranı (V 1/4, D 1/2, C 2/3).
  - Burun radyüsü: rε ≤ ap; ilerleme f ≤ 0.5·rε ve geometri aralığı içinde.
  - Pozitif / negatif uç ayrımı.
  - Teorik yüzey: Ra ≈ f²/(32·rε); silici uçta yaklaşık yarısı.
- **Kater modelleri:** talaş kırıcılı, vida delikli uç ve oturma yatağı, pahlı tutucu başı.
  - Pozitif uç: Torx vida.
  - Negatif uç: kol pimi ve üst pabuç.
  - Yuvarlak uç: dar boyunlu tutucu.
- **İşlem başına iş mili:** sabit kesme hızı (G96 + G50 sınırı) ya da sabit devir (G97).
- **Çizim yap** (SolidWorks benzeri serbest çizim): döner parçanın kesiti eksenin üstüne çizilir (Z sağa, yukarı yarıçap). Kapalı konturların çift-tek dolgusu eksen etrafında döndürülür; içteki kapalı konturlar boşluktur.

- **Araçlar:** Seç (noktayı sürükle, birleşik noktalar birlikte taşınır), Çizgi (zincir; başlangıca tıklayınca kapanır), Dikdörtgen, 3 noktalı Yay, Radyüs, Pah, Ölçü (çizgi boyu / nokta Z–Ø), Sil.
- **Yakalama:** uç nokta, orta nokta, orijin, eksen, ızgara; diğer noktalarla yatay/dikey hiza kılavuzları. Shift basılıyken serbest.
- **İç geometri otomatik sınıflanır:**
  - alından başlayan, içe doğru daralan kademeler → matkap deliği (punta + matkap);
  - düz dipli delik → uyarı (parmak freze / dalma / iç tornalama);
  - içe doğru genişleyen bölge → iç kanal / segman kanalı;
  - konik iç yüzey → iç tornalama.
  İç kanal ve iç tornalama için otomatik işlem eklenmez; uyarı verilir. Hedef modele iç profil birebir girer.
- **Denetim:** açık uçlar kırmızı nokta; kopuk parça, kapalı iç boşluk ve eksen altı çizim hatası, ilgili Z bölgesi kırmızı gösterilerek.
- Esc pencereyi kapatmaz; ölçü yazısına tıklayınca değer yerinde değişir; Ø20 (makine) sınırı denetlenir.

**Finiş otomatik:**
- **Takım:** varsayılan, en küçük burun radyüslü takım.
- **Hedef yüzey:** Ra 0.4–6.3 µm seçilir; ilerleme f = √(Ra·32·rε) ile hesaplanır.
- **Değerler:** Vc malzemeden, G50 sınırı ve kontur toleransı pencereden.
- **Kontroller:** teorik Ra hedefe göre denetlenir; erişim analizi yapılır, bölgeye erişen başka bir takım önerilir.

**Kaba otomatik — sıralı plan ve taret:**
- **Sıra:** 1) alın tornalama (her zaman ilk), 2) ana kaba, 3) ana takımın erişemediği bölgeler için sırayla ek tornalama takımları (önce taretteki), 4) tornalama ucunun erişemediği köşeler için kanal takımıyla dalma, 5) tanınan geometriler: diş → punta → delme → çapraz delme → düzlük / çokgen / cep / çap kanalı / yazı, 6) karşı iş mili: parça alma, arka delme / arka alın, parça atma, 7) kesme yoksa kesme ve çubuk ilerletme.
- **Adım listesi:** bütün adımlar varsayılan açık; kutusu kaldırılan adım oluşturulmaz ve takımı takılmaz. Delme/frezeleme işlemleri finişten sonra, kesmeden önce yer alır.
- **Takım seçimi:** önce o özellik için seçilmiş uygun takım, sonra taretteki uygun takım (matkap çapı = delik çapı, freze ≤ düzlük boyu, freze < cep çapı …), yoksa malzemeye göre kesme değerli hazır takım. Arka tarafta istasyon doluysa bu programda kullanılmayan bir takımın yerine takılır (planda yazar).
- **Derin delik:** matkabın önden erişimi (ağız boyu ve ön kovan bloğu) yetmiyorsa boydan delik önden erişilebilen kadar, kalanı arkadan (0.3 mm bindirmeyle) delinir; elle girilen derin delikte açıklayıcı hata verilir.
- **Ana takım:** parçaya erişen en güçlü kenarlı uç önerilir (yuvarlak uç ve rε > 0.8 hariç); listeden taretteki ya da katalogdaki (tarete takılacak) bir takım seçilebilir.
- **Taret:** tarette olmayan takımların yuvası (T no, Y1) planda gösterilir; tek onayla hepsi takılır ve işlemler kendi takımlarıyla (T kodu, otomatik takım değişimi) oluşturulur.
- **Alın finiş payı:** pencerede seçilir (en çok 0.3 mm); bırakılan payı finiş konturu alır.
- **Denetim:** `tests/e2e/roughcheck.mjs` beş parça (spin-tite STEP dahil) × bütün ana takım seçeneklerinde hata, çarpışma, fazla kesim olmadığını, ilk işlemin alın olduğunu ve erişilemeyen bölgelerde malzeme kalmadığını ölçer.

**Bitmiş parça görünümü** (grafik araç çubuğu “◆ Bitmiş parça”, kısayol F): makine, takım ve stok gizlenir, yalnız hedef parça görünür. Bir yüzeye tıklanınca yüzey tanınır (silindir/koni, omuz, alın, delik, düzlük/cep/çokgen) ve uygun işlemler menüden eklenir: o Z aralığında kaba/finiş, kanal, diş, punta/delme/kılavuz, bölgesel frezeleme, verilen çapta çapraz delik.

**Frezeleme deseni** (düzlük, çokgen, bölgesel frezeleme): işlem penceresinde görselli kartlarla seçilir — zikzak Z / Y, tek yön Z / Y, dıştan içe spiral. Spiral bölgesel frezelemede yalnız dışbükey bölgede kullanılır.

**Örnek parçalar:** “Yeni parça → Örnek parçalar” kesit önizlemeli listeyi açar: Örnek Pim, Hidrolik Rakor (M12 diş, altıgen, boydan delik), Kontak Pimi (Ø5, Ø1 çapraz, arka krimp deliği), Anahtar Ağızlı Mil (iki düzlük), Flanşlı Burç (segman kanalı), Ayar Vidası (konik uç, altıgen baş, arka delik) ve Spin-tite insert STEP (`src/samples/`). `tests/e2e/samplesall.mjs` her birini kaba otomatik (bütün adımlar) ile hatasız, çarpışmasız, fazla kesimsiz doğrular.

**Kapalı işlem → blok atlama:** işlem listesinde kapatılan işlem G-koddan silinmez; satırları “/” ile yazılır (FANUC BLOCK SKIP açıkken okunmaz). Modal durum kapalı bölgeden etkilenmez; simülasyon ve doğrulama bu satırları atlar. İşaret Post Ayarları’ndan değiştirilebilir. Parça alma, kesme, atma, çubuk ilerletme ve ara bağlama bekleme kodu içerdiği için kapatılınca yazılmaz.

**Bir boydan çıkan adet** (üst çubuk): (ham boy − tutma payı) / (parça boyu + alın payı + kesme kateri genişliği + arka alın payı). Varsayılan 3000 mm boy, 200 mm tutma payı; menüden değiştirilir, projeyle kaydedilir. Bir boyun süresi de gösterilir.

**Makine yerleşimi** (`makine çizimi/SB20R_TypeG_machining_zone.glb` sırasıyla, gerçek tutucu ölçüleriyle — `STATIONS`, `src/tools/toolLibrary.js`):
- Gang plakası yanal (Y1) sırası: T01…T06 tornalama (18 mm adım) → T31…T34 çapraz tahrikli (30 mm adım) → T35 ön delme kolonu.
- T35 kolonu: 3 kat alt alta (X1 yönünde), G-kodda T3501 / T3502 / T3503 (takım 35, ofset = kat), ekranda T35-1/2/3.
- Arka ünite T21…T24: karşı iş mili ekseni yüksekliğinde yan yana (yanal 70 / 100 / 130 / 160 mm, X2 ile seçilir). Çizimde eksenin altında; karşı iş milinin Y ekseni olmadığı için eksen yüksekliğine alındı.
- İstasyon doluysa kaba otomatik ve “matkap tak” düğmesi bu programda kullanılmayan takımın yerine takar; strok dışına yuva açılmaz.
- Kılavuz burçlu / burçsuz (N.G.B.) çalışma Post ve Makine Ayarları’ndan seçilir. Burçsuzda burç ünitesi yoktur; ana iş mili pens somunu parçanın arkasında Z1 ile hareket eder ve çarpışma kontrolüne girer; parça boyu en çok çap × 2.5 (≤ 50 mm), ara bağlama kullanılamaz.
- Tahmini stroklar yeni yerleşime göre: X1 −10…200, X2 −20…185 (makineden doğrulanmalı). Eski projeler açılırken takımlar istasyonlara taşınır (T numaraları korunur).
- Çizimdeki T35’in karşı iş miline bakan (arka) matkap yuvaları henüz modellenmedi: gang üzerindeki takımla karşı iş milinde delme ayrı bir kinematik gerektirir.

**Takım modelleri:** parmak frezeler `3d çizimler/parmak_freze_3F_D6.obj` modelinden (sadeleştirilmiş, `src/view3d/endmillModelData.js`); diğer çaplarda ağız bölgesi çapla ölçeklenir, toplam boy 50 mm. Çarpışma geometrisi aynı ölçüleri kullanır. Görünüm menüsündeki “Yalnız takımlar (uç ve kater)” tutma bloklarını, pens somununu, kovanı ve tahrikli iş mili gövdesini gizler.

**Eksik matkap:** “takım seçilmedi — tarette Ø… matkap yok” uyarısındaki düğme matkabı uygun üniteye takar ve işleme atar.

**Bölgesel frezeleme (C/Y):**
- **Hareket:** C1 konumlanır, Y1–Z1 düzleminde parmak frezeyle serbest çokgen bölge katlar halinde taranır; dışbükey bölgede kenar pasosu yapılır.
- **Bölge editörü:**
  - köşe sürükle, kenara çift tıkla = köşe ekle, sağ tık = köşe sil;
  - nokta tablosu;
  - hazır bölgeler: dikdörtgen, tanınan özellikten (düzlük, cep, çokgen), anahtar ağzı (iki karşılıklı yüz).
- **Hedef model:** bölge hedef geometriye dahildir, Kontrol fazla kesim göstermez.

**Takım kartları:** kapakta teknik çizim üslubunda (gri dolgu, koyu kontur) takım görseli. Tornalama tutucusu uç tipine göre çizilir:

| Tutucu | Uç |
|---|---|
| Kol sıkmalı | negatif |
| Vidalı | pozitif |
| 45° kare | S |
| Dar boyunlu | yuvarlak |

Kanal, kesme, diş, matkap, freze ve kılavuz da aynı üsluptadır. Ayrıntıda 3D model de görünür.

**Kesici uç (elmas) tipi:** tornalama takımında ISO şekli seçilir (C 80°, D 55°, V 35°, K 55° paralelkenar, T 60° üçgen, W 80° trigon, S 90° kare, R yuvarlak) ya da ISO kodu yazılır.

- Örnek kodlar: `VCMT 110304`, `DCGT 11T302`, `CNMG 120408`.
- Koddan şekil, kenar boyu, burun radyüsü ve serbest açı okunur.
- Uç açısı kaba tornalamada geri açı sınırına girer.
- 3D ve 2D'de uç gerçek şekliyle çizilir.

İlk açılışta ya da **Yeni** ile başlangıç ekranı gelir: *3D parça aç*, *Çizim yap*, *G kodu ile simülasyon*, *Örnek parçayla dene*, *Kayıtlı projeyi aç*. Parça açılınca kurulum penceresi gelir:

- **Torna ekseni:** otomatik ya da silindirik yüze tıklayarak.
- **Ön yüz:** yeşil halka ön, turuncu halka arka (kesme) tarafıdır; *Ön ve arkayı değiştir* ile çevrilir.
- **Referans noktası (Z0 X0):** ön alın merkezi, arka alın merkezi, modelden seç veya mm değeri.
- **Çubuk ve özellikler:** önerilen standart çap ve tanınan özelliklerin seçimi.

**OBJ:** B-rep yüzü olmadığı için üçgen ağı yüzlere ayrılır: önce düzlemsel parçalar, sonra bir silindir modeline (eksen, merkez, yarıçap) uyan komşu parçalar birleştirilir. Birim mm kabul edilir. Test parçalarında STEP ile aynı boy, çap ve özellikler çıkar (`tests/obj.test.js`).

**Elle yazılan kod:** Simülasyon, çarpışma ve Verify aynen çalışır. Verify karşılaştırması o anki parçaya göre yapılır; başka bir parçanın programı açıldıysa "fazla kesim" uyarısı beklenir. İşlem listesinde bir değişiklik yapılırsa kod CAM çıktısıyla yenilenir.

**Uzman seçenekleri** (*Ayarlar → Arayüz*): makine kartı ve ek parametreler açılır.

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

CAM grafiği gibi mat gölgelendirme (parlama ve yansıma yok), gri-mavi geçişli arka plan ve kamera yönünden aydınlatma kullanılır. Varsayılan olarak makinenin iç yapısı görünür, dış kaporta gizlidir.

- **Makine modeli** (*Görünüm → Makine iç yapısı / Dış kaporta*): Star SB-20R Type G ürün fotoğrafı ve kinematik şemasına göre çizildi.
  - Kabin: gri kabin, mavi kule, FANUC paneli (ekranda canlı eksen konumları), pencereli kapı.
  - Gang takımları: tornalama takımları 1–6, sağda +X1/±Y1 etiketli çapraz tahrikli blok (11–14), tornalama takımlarının altında turuncu hortumlu kovan takımları (21–24).
  - İnce konik kılavuz burç ucu.
  - Beyaz karşı iş mili gövdesi ve mavi arka ünite.
  - Ünite gövdeleri çarpışma kontrolüyle aynı kaynaktan üretilir (`src/sim/bodies.js`).
- **Görünüm seçenekleri:**

  | Seçenek | Değerler |
  |---|---|
  | Makine iç yapısı | Burç sütunu, kayar başlık, kızaklar, ünite gövdeleri (varsayılan açık) |
  | Dış kaporta | Kabin sacı ve kapılar (varsayılan kapalı) |
  | Eksenler | Kırmızı X1, Y1, Z1, C1, X2, Z2, C2 okları ve yanlarında makine koordinatı |
  | Takım yolu | Tümü / Aktif işlem / Seçili işlem / Gizli. Ağaçta her işlemin yanındaki göz düğmesi o işlemin yolunu gizler. |
  | Takımlar | Yalnız aktif (varsayılan) / Aktif + saydam / Tümü. Kovan bloğu, kovan takımı kullanılmıyorken saydam görünür. |

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
src/cad       STEP (OpenCascade WASM) ve OBJ okuma, bağlama, özellik tanıma
src/tools     takım kütüphanesi, kesme verisi, takım geometrisi (3D model ve çarpışmada ortak)
src/sim       G-kod yorumlayıcı, kanal senkronu, stok simülasyonu, çarpışma gövdeleri ve kontrolü, Verify
src/view3d    3D makine, kabin, takım modelleri, stok ağı, takım yolu
src/ui        arayüz, kurulum sihirbazı (ön yüz / referans), kurulum föyü
tests         birim ve uçtan uca testler (+ STEP örnek parçalar)
```
