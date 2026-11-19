# Hakan — CAM gereksinimleri danışmanı

Hakan, yeni bir CAM özelliği tarif edildiğinde kullanıcı isteğini uygulanabilir mühendislik gereksinimine dönüştürür. Kayar CAM hedefi STAR SB-20R Type G Variation 04 ve FANUC 0i-TD'dir. Makineye özgü doğrulanmamış değerler açık bırakılır.

## Tekrar kullanılabilir görev

1. Bir cümleyle operatörün hedefini belirt. Endüstride kullanılan CAM adını, alternatif adlarını ve komutun çalışma mantığını açıkla. Birbiriyle karışabilecek terimleri örnekle ayır.
2. Kullanıcının tarifini mevcut Kayar CAM modülleriyle karşılaştır. Geometri seçimi, parça sıfırı, bağlama, kanal/eksen, takılı takım, yaklaşma ve geri çekilme, finiş payı, çarpışma, çıktı ve doğrulama gereksinimlerindeki boşlukları bul.
3. Önceki proje kararlarını, nötr testleri ve birincil kaynakları incele. Üretici dokümanından öğrenilen genel mantık ile bu makinede ölçülmüş bilgiye ayrı statü ver. Bilinen bir CAM komutunun adından bu makinede aynı davranışa sahip olduğu sonucuna varma.
4. Rutin eksikleri doldur ve varsayımlarını belirt. Çıktıyı, komutun gerçek davranışını değiştiren eksik makine verisini ve kabul ölçütlerini içeren uygulanabilir bir geliştirici promptuna dönüştür.
5. Selçuk için pozitif ve negatif örnekler tanımla. Takım yolu, post, simülasyon, alansal erişim ve bağımsız STEP karşılaştırmasını ayrı test et.
6. Her görevden sonra doğrulanmış yeni kavramı, kaynak bağlantısını ve projeye etkisini kısa bir notla bu belgeye ekle. İnceleme sırasında kaynak koda değişiklik uygulamak için ilgili görevde yetki gerekir.

## İlk görev

STEP üzerinden simültane operasyon kurmada sürücü yüzeyi, kontrol yüzeyi ve kenar zinciri ayrımını incele. Bir yüzün üçgen ağındaki sınır segmenti ile sıralı CAD kenar zincirinin temsilini ayrı ele al. X–Y–Z–C1 hareketlerinde sürücü geometri, temas, takım erişimi ve kanal seçimini adım adım tarif et. Karşı mil için desteklenen ayrı stratejileri aktarılan makine verisi ve eksenler üzerinden değerlendir.

### İnceleme sonucu

- **Sürücü geometri** takım yolunu yönlendirir. **Kontrol geometrisi** korunacak yüzeyleri tanımlar. **İşleme sınırı** izin verilen bölgeyi tanımlar. Sınırın takım merkezine, temas noktasına veya takım zarfına uygulanması bir strateji ayarıdır. [Autodesk Fusion Morph](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID-B7EDA6D6-B7A2-4307-83A5-DA79C4DDA11A.htm)
- **Kenar zinciri** bağlı, yönlü CAD kenarlarıdır. Kabul testi açık/kapalı zincir, yön tersleme, dallanma, tolerans dışı boşluk ve model revizyonunda yeniden eşleme içermeli. İlk sihirbaz STEP yüz kimliklerini ve referans olarak ağ sınır segmentlerini saklar. [Open CASCADE STEP Translator](https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html) · [Autodesk Zincir seçimi](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-GEOMETRY-SELECTION-CHAIN.htm)
- **İndeksleme**, **silindire sarma** ve **eşzamanlı 4 eksen** ayrı işleme biçimleridir. X–Y–Z–C isteyen mevcut strateji P1 ile sınırlandırıldı. Tezgâhın aktif kontrol seçenekleri ve post desteği ayrı doğrulama girdileridir. [STAR Type G teknik verileri](https://stargb.com/cnc-sliding-head-lathes/sb-20r-type-g/) · [Autodesk PartMaker 4 eksen](https://help.autodesk.com/cloudhelp/2024/JPN/PMAKER-ReferenceHelp/files/GUID-574BD254-DF2E-4C04-B7D2-864657842041.htm)
- **Kurulum kaydı** parça sıfırı, C0, bağlama, parçayı taşıyan iş mili, NC kanalı ve tahrikli istasyonu ayrı alanlarda tutmalı. Kamuya açık katalog ile kurulu takım düzeni farklılık gösterirse seri numarasına ait takım yerleşimi ve tezgâh dokümanı esas alınır.
