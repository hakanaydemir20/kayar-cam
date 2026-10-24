# Kayar CAM — Star SB-20R Type G (FANUC 0i-TF)

Kayar otomat (Swiss-type) için çevrimdışı çalışan CAM programı. İş akışı Mastercam Torna ve ESPRIT Swiss modüllerine benzer:

1. STEP parça yükleme
2. Bağlama ve sıfır noktası
3. Özellik tanıma ve otomatik işlem planı
4. İki kanallı ($1/$2) senkron program
5. Gerçekçi 3D makine simülasyonu
6. Verify (talaş kaldırma karşılaştırması)
7. FANUC G-kod çıktısı

## Çalıştırma

- **Kullanım:** `dist/index.html` dosyasına çift tıklayın. Kurulum ve internet gerekmez; tek dosyadır, OpenCascade dahildir.
- **Geliştirme:**
  ```
  npm install
  npm run dev        # canlı geliştirme sunucusu
  npm test           # birim + uçtan uca testler (vitest)
  npm run test:ui    # derle + tarayıcıda arayüz testi (Playwright)
  npm run build      # dist/index.html üret
  ```

## İş akışı

| Adım | Nerede | Açıklama |
|---|---|---|
| 1 | Şerit → **STEP Yükle** | `.stp/.step` okunur. En büyük dış silindir torna ekseni olur. Delikler, çapraz delikler ve düzlükler tanınır; onay penceresinden seçilir. |
| 2 | **Bağlama / Sıfır** | Z0 = ön alın merkezi (varsayılan), "Arka alın" ya da sayısal kaydırma seçilebilir. "Eksen Seç" ile 3D'de silindirik yüze tıklanır; "Ön/Arka Çevir" parçayı 180° çevirir. |
| 3 | Sol ağaç → **Stok** | Çubuk çapı (önerilen otomatik gelir), alın payı, G50 devir limiti. |
| 4 | Sol ağaç → **Takımlar** | Takım no/ofset, tip, ünite (Gang, Çapraz tahrikli, Kovan ön/arka, Arka ünite), ölçü, Vc, ilerleme. "STEP Model Yükle" ile üretici 3D modeli bağlanır (görsel). |
| 5 | Şerit → işlem düğmeleri | Alın, Kaba, İnce, Kanal, Diş (G92), Punta, Delme, Kılavuz, Kesme, Çubuk İlerletme, Çapraz Delme, Düzlük, Helikal Cep (G19), Karşı İş Miline Al, Arka Delme/Kılavuz, Parça Atma. |
| 6 | Sağ panel | Seçili işlemin takımı, geometrisi ve parametreleri. Boş bırakılan değerler takımdan alınır. |
| 7 | Alt panel | **NC Kod**: iki kanal yan yana, simülasyonla senkron; satıra tıklayınca o ana gidilir. **Senkronizasyon**: kanal zaman çizelgesi ve bekleme kodları. **Hatalar**. **Verify**. |
| 8 | **NC İndir** | Hata varsa indirme kilitlenir. Çıktı CRLF satır sonlu `O1000.nc` dosyasıdır. |

Kısayollar: **Boşluk** oynat/duraklat, **← →** önceki/sonraki NC satırı, **T** takım yolunu göster/gizle, **E** eksen oklarını göster/gizle.

## 3D görünüm

- **Makine modeli:** Star SB-20R Type G ürün fotoğrafı ve kinematik şemasına göre çizildi.
  - **Kabin:** gri kabin, mavi kule, FANUC panel ve pencereli kapı. Panel ekranında canlı eksen konumları ve çalışan NC satırı görünür.
  - **Takım yerleşimi:** tornalama takımları 1–6, sağda +X1/±Y1 etiketli çapraz tahrikli blok (11–14), tornalama takımlarının altında turuncu hortumlu kovan takımları (21–24).
  - **Karşı taraf:** beyaz karşı iş mili gövdesi ve mavi arka ünite.
- **Kabin:** Tam / Ön kapaklar yok / Gizli.
- **Eksenler:** kırmızı X1, Y1, Z1, C1, X2, Z2, C2 okları ve yanında makine koordinatı.
- **Koordinat paneli:** her kanal için şu sütunlar:
  - **Mutlak:** program koordinatı.
  - **Makine:** eksen konumu.
  - **Kalan:** o satırın bitişine kalan mesafe.
- **Takım yolu:** Tümü / Aktif işlem / Seçili işlem / Gizli. Sol ağaçta her işlemin yanındaki göz düğmesi ile o işlemin yolu tek tek gizlenir.
- **Takımlar:** aktif + saydam / yalnız aktif / tümü.
- **Takım montaj konumu:** takım ayarlarında *Yanal konum (Y1)* ve *Radyal montaj (X1)* değerleri var. Örneğin kovan takımları −48 mm aşağıdadır; gang plakası bu takımları kullanırken o kadar yukarı kalkar. NC programı değişmez, bu değerler yalnız makine koordinatı ve strok kontrolüne girer.

## Koordinat ve program yapısı

- **X:** çap programlama. **Z0:** parça ön alnı; Z+ başlığa doğru (kayar başlık parçayı dışarı iter). **Y:** gang yanal. **C:** derece.
- **$1:** ana iş mili + gang tool post (X1/Y1/Z1/C1). **$2:** karşı iş mili (X2/Z2).
  - **G54** = transfer çerçevesi.
  - **G55** = arka işleme çerçevesi; Z arka alından derinliktir.
- **Kanal senkronu:**
  - **M201:** karşı iş mili yaklaşabilir.
  - **M202:** parça tutuldu.
  - **M203:** kesme bitti.
  - Kodlar Post ayarlarından değiştirilir.
- **Yaklaşma sırası** her zaman önce güvenli X, sonra Z/Y, en son X'tir. Ön eksenel takımlardan önce parça Z-1'e çekilir.
- **Kesme sonrası çubuk ilerletme:** kesme takımı durdurucu olur; pens açılır, başlık geri gelir, pens kapanır.
  - Başlık `Z−(kesme genişliği + alın payı)` konumuna gider. Böylece bir sonraki parçada alın payı kalır ve kesme izi alınır.
- **Program başı:** `G18 G21 G40 G80 G97 G99`.
- **İlerleme:** her takım değişiminden sonraki ilk kesme satırında F değeri her zaman yazılır.

## Hata önleme katmanları

1. **CAM kontrolleri:** takım/özellik uyumu, kapasiteler (Ø7 çapraz delme, Ø12 ön delme vb.), kanal/takım genişliği.
2. **G-kod yorumlayıcı:** çıkan NC metni yeniden okunur.
   - strok limitleri
   - devir limitleri
   - eksik F/S
   - dönmeyen iş mili veya tahrikli takım
   - yanlış kanaldaki takım
   - yay yarıçap tutarlılığı
   - bekleme kilitlenmesi
3. **Post öz-kontrolü:** CAM'in amaçladığı her konum, yorumlanan makine konumuyla karşılaştırılır.
4. **Talaş simülasyonu:**
   - G0 ile malzemeye temas
   - iş mili dururken tornalama
   - eksenel takım gövdesinin parçaya değmesi
5. **Verify:** simülasyon sonu stok, hedef parçayla hücre hücre karşılaştırılır. Fazla kesim kırmızı, kalan malzeme mavi gösterilir.

## Makineden doğrulanması gerekenler (önemli)

Program bu maddeler doğrulanana kadar **"POST DOĞRULANMADI"** uyarısı verir.

- **M kodları:** iş mili ve karşı iş mili, tahrikli takım, C ekseni, pens, senkron, bekleme, parça atma. Star bunları yayınlamıyor. Makinenizdeki çalışan bir programla veya panelde `PROG → COMM → M-CODE` ekranıyla karşılaştırıp **Post / Makine** ayarlarından düzeltin, sonra "Doğrulandı" kutusunu işaretleyin.
- **Eksen strokları:** X1, Y1, X2, Z2 strokları tahminidir; yalnız Z1 = 205 mm katalogdan alındı. Doğru değerleri girin.
- **Takım konumları:** takım numaraları ve gang plakasındaki yanal konumlar (Y1) makinenizdeki takım yerleşimine göre düzenlenmelidir.
- **İlk deneme:** her yeni programı makinede önce **kuru çalıştırma / tek blok** ve düşük rapid override ile deneyin.

## Bilinen sınırlar

- Simülasyon tek parça çevrimini gösterir.
- Çarpışma kontrolü kesici bölge ve eksenel takım gövdesi içindir; tutucu ve makine gövdesi arası tam katı model çarpışması yoktur.
- G71/G76 çevrimleri yerine açık pasolar ve G92 kullanılır. Bunlar parametreden bağımsız olduğu için daha güvenlidir.
- Polar (G12.1) ve silindirik (G7.1) interpolasyon yoktur.
- Diş, STEP'te modellenmediği için elle eklenir.

## Klasör yapısı

```
src/machine   makine tanımı (sb20r-g.json)
src/post      FANUC/Star post-processor + M kodu profili
src/ops       işlem üreteçleri, iki kanallı program kurucu
src/geom      profil örnekleme, uç radyüsü telafisi, yay uydurma
src/cad       STEP okuma (OpenCascade WASM), bağlama, özellik tanıma
src/sim       G-kod ayrıştırıcı/yorumlayıcı, kanal senkronu, stok simülasyonu, Verify
src/view3d    3D makine, takım modelleri, stok ağı, takım yolu
src/ui        arayüz
tests         birim ve uçtan uca testler (+ STEP örnek parçalar)
```
