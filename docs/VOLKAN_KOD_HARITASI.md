# Volkan · Kod haritası

Volkan, geliştirme ve test görevleri için ilk okunacak kodu, ilgili testleri ve katman sınırlarını seçer. Yollar depo köküne göredir. Proje kuralları ve çalışma durumu için `AGENTS.md`, `CLAUDE.md` ve `docs/DEVAM.md` geçerlidir.

## İçindekiler

| Görev | İlk giriş | Gerekirse izle | Hedef test |
|---|---|---|---|
| Proje akışı ve .kcam | `src/project.js` (`runPipeline`, `saveProject`, `loadProject`) | `migrate` → `fitStations`, arayüz için `src/ui/app.js` | `pipeline`, `ngb` |
| STEP / OBJ ve parça geometrisi | `src/cad/stepImport.js` veya `src/cad/objImport.js` | `featureRecog.js` → `src/ui/stepFlow.js` → `src/part/` | `step`, `obj`, `step_pipeline` |
| Otomatik plan ve takım yolu | `src/ops/featurePlan.js` veya değiştirilmek istenen üreteç için `src/ops/generators.js` | `backPlan.js`, `context.js`, `src/toolpath/ir.js` | `strategy`, `roughrange`, `backplan`, `milling` |
| Simültane freze / STEP kurulum | `src/ops/simMill.js` veya `src/ops/simMillSetup.js` | `src/ui/simMillWizard.js`, `featureRecog.js`, post ve yorumlayıcı | `simmill`, `simmill_flat`, `simmill-setup` |
| Takım geometrisi, kütüphane ve istasyon | `src/tools/toolLibrary.js` (`makeTool`, `STATIONS`) → `toolGeom.js` | `src/ui/app.js` (`addToolFrom`), `src/project.js` (`fitStations`), `src/view3d/toolMeshes.js`, `src/sim/bodies.js` | `stations`, `insert`, `insertcontact` |
| P1/P2, senkronizasyon, post ve NC dışa aktarma | `src/ops/program.js` → `src/post/fanucStar.js` (`postProcess`) | `src/ops/kayarTemplate.js`, `src/post/postProfileKayar.json`, `src/post/ncFiles.js` (`splitChannels`, `joinChannelFiles`) → `src/sim/interpreter.js` | `kayar`, `kayar-dialect`, `overlap`, `release`; ayrıca `node tests/realprograms.mjs` |
| NC yorumlama ve elle kod | `src/project.js` (`simulateText`) → `src/sim/interpreter.js` | `gcodeParser.js`, `frames.js`, `src/ui/gcodeEditor.js` | `interpreter`, `cycles`, `blockskip`, `channel-view` |
| Kinematik, çarpışma ve Verify | `src/sim/frames.js`, `collision.js` veya `stockSim.js` | `bodies.js`, `pose.js`, `src/machine/sb20r-g.json`, `src/ui/finishedView.js`; fiziksel yerleşim için `docs/variation04-takim-yerlesimi.md` | `collision`, `clearance`, `stock`, `finished-compare` |
| Kullanıcı akışı ve görüntüleme | `src/main.js` → `src/ui/app.js` | `src/ui/forms.js`, ilgili sihirbaz, `src/view3d/scene.js` ve ilgili mesh dosyası | `npm run test:ui` |
| Python analizleri | `analiz/kayar_model/` veya `analiz/cs_contour/`, `analiz/swiss_z1/`, `analiz/gcode_engine/` | JS entegrasyonu için `src/ops/analysisAdvice.js` | `python -m pytest analiz/<modül>/tests -q`; kayar_model testleri `analiz/tests` altında |

Tabloda kısaltılan JS test adlarını `npx vitest run tests/<ad>.test.js` biçiminde çalıştır. Birden fazla ilgili dosya seçilebilir. Depo kurallarındaki teslim kontrolleri ayrıca geçerlidir. Post değişimlerinde dışa aktarılan NC'yi tekrar yorumlat ve P1/P2 akışını doğrula. Makine verisi için proje belgelerindeki doğrulama statülerini esas al.

## Düşük token ile çalışma

1. Görevi bir tablo satırına bağla. Mevcut değişikliği anlamak için `git status --short` ve `git diff --stat` kullan, ardından `git diff -- <ilgili-yol>` ile daralt. Yeni dosyaları durum çıktısından kontrol et.
2. Önce giriş sembolünü ve test başlıklarını `rg -n` ile bul. Yalnız ilgili fonksiyon ve yakın çevresini oku. Bağımlılığa ancak veri sözleşmesi, hata izi veya test kapsamı gerektiriyorsa geç.
3. `node_modules`, `dist`, test çıktıları ve arşiv NC dosyalarını genel aramalara ekleme. Büyük test çıktısından komut, sonuç, ilk hata ve konumu aktar. İhtiyaç halinde hedefli testi `-t` ile daralt.
4. Geliştirme veya QA ajanına şu kısa formatı ver. **Görev | Giriş: yol:sembol | İzlenecek en fazla birkaç bağımlılık | Test komutu | Kritik sözleşme veya belirsizlik**. Yolları, sembolleri ve testleri güncel çalışma ağacından doğrula. Ayrı görevde önceki uzun konuşma yerine bu bağlamı aktar.
5. Dosya taşınırsa, bir giriş sembolü veya test değişirse ya da yeni alan eklenirse ilgili satırı güncelle. Ayrıntının asıl kaynağına işaret et. Her teslimde yalnız etkilenen satırların doğrulanması yeterli.

**Örnek görev paketi** · Sarmal bitiş hareketi | `src/ops/simMill.js:strategyPaths` | NC etkisinde `fanucStar.js` → `interpreter.js` | `npx vitest run tests/simmill_flat.test.js -t 'sarmal bitiş'` | Son tur Z sabitken örneklenir. Sembolü `rg -n -C 6 'strategyPaths|strategy === .spiral.' src/ops/simMill.js` ile aç.
