import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
const url = pathToFileURL(path.resolve('dist/index.html')).href;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
page.on('dialog', d => d.accept());
const log = (...a) => console.log(...a);
await page.goto(url);
await page.waitForTimeout(3000);
const st = () => page.evaluate(() => ({ status: document.getElementById('statusTxt').textContent, errs: app.result.errors.length, ops: app.project.ops.length, t: app.t.toFixed(2), T: app.totalTime.toFixed(1) }));
const next = () => page.locator('.wiz-nav .btn.pri').click();
/** Üst menüden seç: menü adı + öğe metni */
/** Görünüm menüsünden (grafik penceresi) bir anahtarı aç/kapat */
const viewSet = async (k, on) => { await page.click('#mView .gbtn'); await page.waitForTimeout(150); const inp = page.locator(`#quickView .st-row[data-k="${k}"] input`); if ((await inp.isChecked()) !== on) await page.locator(`#quickView .st-row[data-k="${k}"] .sw`).click(); await page.keyboard.press('Escape'); await page.mouse.click(5, 880); await page.waitForTimeout(250); };
const cfg = (k, v) => page.evaluate(([k, v]) => { app.cfg[k] = v; app.setCfg(k); }, [k, v]);
const addOp = async (label) => { await page.click('#btnAddOp'); await page.locator('.opmenu button', { hasText: label }).first().click(); await page.waitForTimeout(1500); };
// 0) ilk açılış: başlangıç ekranı → örnek parça → kurulum sihirbazı (ölçüler, ön yüz, referans, çubuk)
log('başlangıç ekranı', await page.isVisible('.scards'));
await page.getByText('Örnek parçayla dene').click();
await page.waitForTimeout(800);
for (let k = 0; k < 3; k++) { await next(); await page.waitForTimeout(400); }
log('sihirbaz son adım', await page.textContent('.wiz-title'));
await next();
await page.waitForTimeout(2500);
log('sihirbaz sonrası plan (boş olmalı)', await page.evaluate(() => app.project.ops.length));
await page.evaluate(() => app.action('auto')); await page.waitForTimeout(3500);
log('başlangıç', await st(), 'mod', await page.evaluate(() => document.body.className));
// 0b) Basit mod: işlem menüsünden Düzlük Frezeleme ekle, sonra sil
await page.click('#btnAddOp');
await page.locator('.opmenu button', { hasText: 'Düzlük Frezeleme' }).click();
await page.waitForTimeout(1500);
log('menüden işlem', await st(), await page.evaluate(() => app.project.ops.filter(o => o.type === 'flatMill').length));
await page.evaluate(() => { const i = app.project.ops.findLastIndex(o => o.type === 'flatMill'); app.project.ops.splice(i, 1); app.recalc(true); });
await page.waitForTimeout(1500);
// 0c) ray 2: referans noktasını arka alına al → G-kod Z'leri L kadar kayar; sonra ön alına geri
const firstZ = () => page.evaluate(() => app.result.posted.paths[0].find(s => /^G1 X-?[\d.]+ F/.test(s) || /^Y0\. Z/.test(s)));
const z0a = await firstZ();
await page.click('#sbPart'); await page.waitForTimeout(300); await page.locator('.pw-head .btn', { hasText: 'Bağlama' }).click(); await page.waitForTimeout(800);
await page.locator('.wiz-steps li', { hasText: 'Referans' }).click(); await page.waitForTimeout(300);
await page.locator('.choice', { hasText: 'Arka alın merkezi' }).click(); await page.waitForTimeout(300);
await page.locator('.wiz-nav .btn.pri').click(); await page.waitForTimeout(300);
await page.locator('.wiz-nav .btn.pri', { hasText: 'Uygula' }).click(); await page.waitForTimeout(3500);
log('Z0 arka alın', await page.evaluate(() => app.project.zero), await st(), z0a, '→', await firstZ());
await page.click('#sbPart'); await page.waitForTimeout(300); await page.locator('.pw-head .btn', { hasText: 'Bağlama' }).click(); await page.waitForTimeout(800);
await page.locator('.wiz-steps li', { hasText: 'Referans' }).click(); await page.waitForTimeout(300);
await page.locator('.choice', { hasText: 'Ön alın merkezi' }).click(); await page.waitForTimeout(300);
await page.locator('.wiz-steps li', { hasText: 'Çubuk' }).click(); await page.waitForTimeout(300);
await page.locator('.wiz-nav .btn.pri', { hasText: 'Uygula' }).click(); await page.waitForTimeout(3500);
log('Z0 ön alın', await page.evaluate(() => app.project.zero), await st());
// 0d) ray 5: NC çıktısı penceresi
await page.evaluate(() => app.openOutput()); await page.waitForTimeout(400);
log('NC penceresi', await page.textContent('.out .msg'));
await page.keyboard.press('Escape');
// uzman modu
await cfg('expert', true); await page.waitForTimeout(600);
log('uzman modu', await page.evaluate(() => document.body.className));

// 1) oynatma: 25x hızda 2 sn
await page.selectOption('#speed', '25');
await page.click('#playBtn');
await page.waitForTimeout(2000);
log('oynatma', await st());
await page.click('#playBtn');
// 2) G-kod editöründe satıra git (satır 60)
await page.evaluate(() => app.gotoEditorLine(60));
await page.waitForTimeout(300);
log('satır 60', await st(), await page.evaluate(() => app.editor._curLine));
// 3) işlem ekle: Kanal (ikinci kopya) → hata beklenmez
await addOp('Kanal');
await page.waitForTimeout(1500);
log('kanal eklendi', await st());
// 4) seçili işlemde paso derinliğini değiştir (kaba)
await page.evaluate(() => { const op = app.project.ops.find(o => o.type === 'rough'); app.sel = { kind: 'op', id: op.id }; app.renderTree(); });
const inp = page.locator('.flyout .fly-body input[type=number]').first();
await inp.fill('0.7'); await inp.dispatchEvent('change');
await page.waitForTimeout(1500);
log('kaba ap=0.7', await st(), await page.evaluate(() => app.project.ops.find(o => o.type === 'rough').params.ap));
// 5) profil tablosu: ilk satır çapını 6 → 5
await page.click('#sbPart'); await page.waitForTimeout(300);
const c1 = page.locator('.pw-body table.pt input').first();
await c1.fill('5'); await c1.dispatchEvent('change');
await page.waitForTimeout(1500);
log('profil Ø5', await st(), await page.evaluate(() => app.project.part.rows[0].dia));
// 6) stok çapı seç
await page.locator('.pw-tabs button', { hasText: 'Çubuk' }).click(); await page.waitForTimeout(200);
await page.locator('.pw-body select').first().selectOption('16');
await page.waitForTimeout(1500);
log('stok Ø16', await st(), await page.evaluate(() => [app.project.stock.barDia, typeof app.project.stock.barDia]));
await page.keyboard.press('Escape');
// takım yolu düğmesi: topluca gizle / göster
await page.click('#btnPaths'); const pOff = await page.evaluate(() => [app.cfg.path, [...app.pathByOp.values()].flat().some(g => g.visible)]);
await page.click('#btnPaths'); const pOn = await page.evaluate(() => [app.cfg.path, [...app.pathByOp.values()].flat().some(g => g.visible)]);
await page.click('.ops-group .geye'); const gHid = await page.evaluate(() => app.project.ops.filter(o => o.hidePath).length);
await page.click('.ops-group .geye');
log('takım yolu düğmesi', pOff, pOn, 'grup gizlendi', gHid, 'sonra', await page.evaluate(() => app.project.ops.filter(o => o.hidePath).length));
// 7) sekmeler
for (const bt of ['sync', 'msgs', 'verify', 'code']) { await page.click(`[data-rt="${bt}"]`); await page.waitForTimeout(200); }
// 8) NC indir
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), (async () => { await page.click('#btnOutput'); await page.waitForTimeout(300); await page.locator('.mbody .btn.pri', { hasText: 'NC kodunu indir' }).click(); })()]);
await page.keyboard.press('Escape');
if (dl) { const p = await dl.path(); const txt = fs.readFileSync(p, 'utf8'); log('NC indirildi', dl.suggestedFilename(), txt.split('\n').length, 'satır'); }
else log('NC indirilmedi (hata kilidi?)', await page.textContent('#toast'));
// 9) proje kaydet + aç
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('.topbar [data-act="save"]')]);
const pp = await dl2.path();
fs.mkdirSync('test-results', { recursive: true }); fs.copyFileSync(pp, 'test-results/test.kcam');
await page.setInputFiles('#fileProj', 'test-results/test.kcam');
await page.waitForTimeout(2500);
log('proje açıldı', await st());
// 10) post ayarları penceresi
await page.click('#btnSettings'); await page.waitForTimeout(300);
await page.locator('.st-nav button', { hasText: 'Post ve makine' }).click();
await page.locator('.st-extra .btn.pri').click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/ui_post.png' });
await page.getByText('Uygula ve Yeniden Hesapla').click();
await page.waitForTimeout(1500);
// 11) Verify renkleri
await viewSet('verify', true);
await page.waitForTimeout(800);
await page.click('[data-view="iso"]');
await page.waitForTimeout(400);
await page.screenshot({ path: 'test-results/ui_verify.png' });
await viewSet('verify', false);
// 12) senkronizasyon ekranı
await page.click('[data-rt="sync"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/ui_sync.png' });
// 13) örtüşen çevrim aç/kapa
await page.click('.syncbar input');
await page.waitForTimeout(4000);
log('örtüşen çevrim', await st(), await page.evaluate(() => [app.project.sync?.overlap, app.stockSim.overlap, app.verify?.ss.collisions.length]));
await page.click('.syncbar input');
await page.waitForTimeout(3000);
// 14) yeni işlemler: çokgen + yazı özelliği ekle, otomatik plan
await page.evaluate(() => { app.sel = { kind: 'part' }; app.renderTree(); });
await page.evaluate(() => { app.addFeature('polygon'); });
await page.waitForTimeout(1500);
await page.evaluate(() => { app.action('auto'); });
await page.waitForTimeout(3500);
log('çokgen + otomatik plan', await st(), await page.evaluate(() => [app.project.ops.map(o => o.type).filter(t => t === 'polygonMill').length, app.result.errors.map(e => e.msg), app.verify?.ss.collisions.slice(0, 3).map(c => c.msg), app.project.part.features.at(-1)]));
// 15) segmentasyon
await page.evaluate(() => { app.project.stock.segment = 15; app.recalc(true); });
await page.waitForTimeout(3500);
log('segment 15', await st());
// 16) kurulum föyü
await page.evaluate(() => app.openSetupSheet());
await page.waitForTimeout(800);
log('föy açık', await page.evaluate(() => !!document.querySelector('iframe.sheet')));
await page.click('#mclose');
// 17) görünüm seçenekleri
await viewSet('cabin', true);
await page.click('[data-view="all"]'); await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/ui_body.png' });
await viewSet('cabin', false); await viewSet('body', false); await viewSet('body', true);
for (const v of ['op', 'none', 'all']) await cfg('path', v);
await page.keyboard.press('KeyE'); await page.keyboard.press('KeyE');
await page.click('[data-view="all"]'); await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/ui_machine.png' });
// 18) ölçülerden yeni parça: satır ekle, ön/arka çevir, oluştur (Basit mod)
await cfg('expert', false);
await page.evaluate(() => app.newTablePart()); await page.waitForTimeout(600);
await page.getByText('+ Satır ekle').click(); await page.waitForTimeout(300);
const dimRows = await page.evaluate(() => document.querySelectorAll('.wiz table.pt tr').length - 1);
await next(); await page.waitForTimeout(400);
await page.getByText('Ön ve arkayı değiştir').click(); await page.waitForTimeout(400);
for (let k = 0; k < 2; k++) { await next(); await page.waitForTimeout(400); }
await next(); await page.waitForTimeout(1500); await page.evaluate(() => app.action('auto')); await page.waitForTimeout(3000);
log('ölçülerden parça', dimRows, await page.evaluate(() => app.project.part.rows.map(r => r.dia).join('/')), await st());
// 19) STEP: dosya → sihirbaz (eksen otomatik, çevir, referansı modelden seç) → plan
await page.setInputFiles('#fileStep', 'tests/fixtures/kanalli_mil.step');
await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(600);
const stepTitle = await page.textContent('.wiz-title');
await next(); await page.waitForTimeout(400);
await page.getByText('Ön ve arkayı değiştir').click(); await page.waitForTimeout(800);
await next(); await page.waitForTimeout(400);
await page.locator('.choice', { hasText: 'Modelden seç' }).click(); await page.waitForTimeout(200);
const vb = await page.locator('.wiz-view canvas').boundingBox();
await page.mouse.click(vb.x + vb.width * 0.5, vb.y + vb.height * 0.52); await page.waitForTimeout(400);
const picked = await page.textContent('.wiz-facts');
await next(); await page.waitForTimeout(400);
await next(); await page.waitForTimeout(1500); await page.evaluate(() => app.action('auto')); await page.waitForTimeout(4000);
log('STEP sihirbazı', stepTitle, '|', picked, '|', await page.evaluate(() => [app.project.part.source, app.project.part.flip, app.project.zero]), await st());
// 20) OBJ: aynı parça üçgen ağı olarak → sihirbaz → plan
await page.setInputFiles('#fileStep', 'tests/fixtures/kanalli_mil.obj');
await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(600);
for (let k = 0; k < 4; k++) { await next(); await page.waitForTimeout(400); }
await page.waitForTimeout(1500); await page.evaluate(() => app.action('auto')); await page.waitForTimeout(3000);
log('OBJ', await page.evaluate(() => [app.project.part.meshFmt, app.project.part.length.toFixed(3), app.project.part.maxDia.toFixed(3), app.project.part.features.map(f => f.type).join(',')]), await st());
// 21) 2D grafik penceresi
await page.click('.gtool [data-view2="2d"]'); await page.waitForTimeout(300);
await page.click('[data-pl="end"]'); await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/ui_2d.png' });
log('2D', await page.evaluate(() => [app.view2, app.plot.visible, app.plot.paths.length]));
await page.click('.gtool [data-view2="3d"]');
// 22) Aç menüsü → boş G-kod programı, satır yaz + Enter (EOB) → o satır oynar
await page.click('#btnOpen'); await page.waitForTimeout(200);
await page.locator('.menu.open .dd button', { hasText: 'Boş G-kod' }).click(); await page.waitForTimeout(400);
await page.locator('.modal.on .btn.pri').click(); await page.waitForTimeout(2000);
await page.locator('.ged-ta').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('G1 Z6. F0.08');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const eob = await page.evaluate(() => ({ manual: app.manual != null, playing: app.playing, until: app.playUntil, T: app.totalTime }));
await page.waitForTimeout(2500);
log('EOB', eob, await page.evaluate(() => [app.t.toFixed(3), app.totalTime.toFixed(3), app.machine.pose1.p.Z.toFixed(3), app.result.errors.length]));
// 23) G-kod dosyası aç (indirilen NC) → simülasyon
if (dl) {
  fs.copyFileSync(await dl.path(), 'test-results/test.nc');
  await page.setInputFiles('#fileNc', 'test-results/test.nc'); await page.waitForTimeout(3500);
  log('NC dosyası', await page.evaluate(() => [app.manual?.split('\n').length, app.result.errors.length, app.totalTime.toFixed(1), document.getElementById('codeMode').textContent]), await st());
}
// 24) CAM koduna dön
await page.click('#gReset'); await page.waitForTimeout(3000);
log('CAM koduna dönüş', await page.evaluate(() => [app.manual, document.getElementById('codeMode').textContent]), await st());
// 25) ayarlar penceresi: kategori, arama, yazı boyutu
await page.click('#btnSettings'); await page.waitForTimeout(300);
for (const c of ['Simülasyon', 'G-kod editörü', 'Arayüz', 'Kısayollar', 'Görünüm']) { await page.locator('.st-nav button', { hasText: c }).click(); await page.waitForTimeout(120); }
await page.fill('.st-q', 'kaporta'); await page.waitForTimeout(200);
const found = await page.locator('.st-body .st-row').count();
await page.fill('.st-q', '');
await page.locator('.st-nav button', { hasText: 'Arayüz' }).click();
await page.selectOption('.st-row[data-k="uiScale"] select', '112'); await page.waitForTimeout(200);
const fsz = await page.evaluate(() => document.documentElement.style.fontSize);
await page.selectOption('.st-row[data-k="uiScale"] select', '100');
await page.keyboard.press('Escape');
log('ayarlar', found, fsz);
// 26) yardım turu: baştan sona
await page.click('#btnHelp'); await page.waitForTimeout(300);
let steps = 1; while (await page.locator('.tour-tip').count()) { await page.click('.tt-next'); steps++; await page.waitForTimeout(60); if (steps > 30) break; }
log('yardım turu adım', steps - 1);
// 27) kesici uç kodu
await page.click('#btnTools'); await page.waitForTimeout(300);
log('takım kartları', await page.locator('.tw-grid .tcard:not(.add)').count(), 'görselli', await page.evaluate(() => [...document.querySelectorAll('.tcard img')].filter(i => i.src.startsWith('data:image/png')).length));
await page.locator('.tcard', { hasText: 'T01' }).first().click(); await page.waitForTimeout(200);
const ic = page.locator('.tw-detail input[type=text]').nth(1);
await ic.fill('CNMG 120408'); await ic.dispatchEvent('change'); await page.waitForTimeout(1500);
// katalogdan tahrikli freze ekle
await page.click('.tw-bar .btn'); await page.waitForTimeout(200);
await page.locator('.tcard.add').click(); await page.waitForTimeout(300);
await page.locator('.tw-cat .tcard', { hasText: 'Parmak freze Ø4' }).click(); await page.waitForTimeout(1200);
const newT = await page.evaluate(() => { const t = app.project.tools.find(x => x.name === 'Parmak Freze Ø4' && x.num !== 13); return t && [t.num, t.unit, t.live, t.type]; });
await page.keyboard.press('Escape');
log('katalogdan takım', newT);
log('uç kodu', await page.evaluate(() => { const t = app.project.tools.find(x => x.insertCode === 'CNMG 120408'); return t && [t.insertShape, t.insertAngle, t.insertSize, t.noseR]; }), await st());
// 28) çizim yap: 2D çiz → pah → parça
await page.click('#btnOpen'); await page.locator('.menu.open .dd button', { hasText: 'Çizim yap' }).click(); await page.waitForTimeout(600);
const SK = (z, r) => page.evaluate(([z, r]) => { const sk = window.__lastSketcher; const [x, y] = sk.S(z, r); const b = sk.cv.getBoundingClientRect(); return [b.left + x, b.top + y]; }, [z, r]);
for (const [z, r] of [[0, 4], [10, 4], [10, 6], [25, 6], [25, 3], [30, 3]]) { const [x, y] = await SK(z, r); await page.mouse.click(x, y); await page.waitForTimeout(60); }
await page.keyboard.press('Enter');
await page.locator('.sk-tools button', { hasText: 'Pah' }).click();
{ const [x, y] = await SK(10, 6); await page.mouse.click(x, y); }
await page.click('.sk-panel .btn.pri'); await page.waitForTimeout(800);
for (let k = 0; k < 3; k++) { await next(); await page.waitForTimeout(400); }
await page.waitForTimeout(1500); await page.evaluate(() => app.action('auto')); await page.waitForTimeout(3000);
log('çizim parçası', await page.evaluate(() => [app.project.part.source, app.project.part.length, app.project.part.maxDia, app.project.part.sketch.length]), await st());
// 29) kaba tornalama penceresi: malzeme, takım, öneri, erişim analizi, ikinci takım
await page.click('#btnNew'); await page.waitForTimeout(300); await page.getByText('Örnek parçayla dene').click(); await page.waitForTimeout(800);
for (let k = 0; k < 4; k++) { await next(); await page.waitForTimeout(400); }
await page.waitForTimeout(1500);
await page.click('#btnRough'); await page.waitForTimeout(500);
await page.locator('.rw-form select').first().selectOption('ss'); await page.waitForTimeout(300);
const rw = await page.evaluate(() => ({ ap: app._rough.ap, feed: app._rough.feed, vc: app._rough.vc, zones: document.querySelectorAll('.rw-zones div').length, t2: app._rough.t2 }));
await page.screenshot({ path: 'test-results/ui_rough.png' });
await page.locator('.rw-nav .btn.pri').click(); await page.waitForTimeout(3500);
log('kaba penceresi', rw, await page.evaluate(() => app.project.ops.filter(o => o.type === 'rough').map(o => [o.name, o.params.ap, o.params.zMin ?? '-', o.params.zMax ?? '-'])), await st());
// 30) malzeme menüsü (üst çubuk)
await page.click('#btnMat'); await page.waitForTimeout(150);
await page.locator('#matList button', { hasText: 'Alüminyum' }).click(); await page.waitForTimeout(1500);
log('malzeme', await page.evaluate(() => [app.project.stock.material, document.getElementById('matTxt').textContent]));
// 31) ön görünüm animasyonu
await page.click('[data-view="front"]'); await page.waitForTimeout(100);
const midAnim = await page.evaluate(() => !!app.viewer.anim);
await page.waitForTimeout(800);
log('görünüm geçişi animasyonlu', midAnim, 'bitti', await page.evaluate(() => !app.viewer.anim));
log('SON', await st());
log('HATALAR', errs.length ? errs.join('\n') : 'yok');
await browser.close();
