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
await page.waitForTimeout(3500);
const st = () => page.evaluate(() => ({ status: document.getElementById('statusTxt').textContent, errs: app.result.errors.length, ops: app.project.ops.length, t: app.t.toFixed(2), T: app.totalTime.toFixed(1) }));
log('başlangıç', await st());

// 1) oynatma: 25x hızda 2 sn
await page.selectOption('#speed', '25');
await page.click('#playBtn');
await page.waitForTimeout(2000);
log('oynatma', await st());
await page.click('#playBtn');
// 2) NC satırına tıkla
await page.click('#nc1 .nl[data-l="60"]');
await page.waitForTimeout(300);
log('satır 60 tıklandı', await st());
// 3) işlem ekle: Kanal (ikinci kopya) → hata beklenmez
await page.click('#rbTurn button:nth-child(4)');
await page.waitForTimeout(1500);
log('kanal eklendi', await st());
// 4) seçili işlemde paso derinliğini değiştir (kaba)
await page.evaluate(() => { const op = app.project.ops.find(o => o.type === 'rough'); app.sel = { kind: 'op', id: op.id }; app.renderProps(); });
const inp = page.locator('#props input[type=number]').first();
await inp.fill('0.7'); await inp.dispatchEvent('change');
await page.waitForTimeout(1500);
log('kaba ap=0.7', await st(), await page.evaluate(() => app.project.ops.find(o => o.type === 'rough').params.ap));
// 5) profil tablosu: ilk satır çapını 6 → 5
await page.evaluate(() => { app.sel = { kind: 'part' }; app.renderProps(); });
const c1 = page.locator('#props table.pt input').first();
await c1.fill('5'); await c1.dispatchEvent('change');
await page.waitForTimeout(1500);
log('profil Ø5', await st(), await page.evaluate(() => app.project.part.rows[0].dia));
// 6) stok çapı seç
await page.evaluate(() => { app.sel = { kind: 'stock' }; app.renderProps(); });
await page.locator('#props select').first().selectOption('16');
await page.waitForTimeout(1500);
log('stok Ø16', await st(), await page.evaluate(() => [app.project.stock.barDia, typeof app.project.stock.barDia]));
// 7) sekmeler
for (const bt of ['sync', 'msgs', 'verify', 'nc']) { await page.click(`[data-bt="${bt}"]`); await page.waitForTimeout(200); }
// 8) NC indir
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('[data-act="download"]')]);
if (dl) { const p = await dl.path(); const txt = fs.readFileSync(p, 'utf8'); log('NC indirildi', dl.suggestedFilename(), txt.split('\n').length, 'satır'); }
else log('NC indirilmedi (hata kilidi?)', await page.textContent('#toast'));
// 9) proje kaydet + aç
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('[data-act="save"]')]);
const pp = await dl2.path();
fs.mkdirSync('test-results', { recursive: true }); fs.copyFileSync(pp, 'test-results/test.kcam');
await page.setInputFiles('#fileProj', 'test-results/test.kcam');
await page.waitForTimeout(2500);
log('proje açıldı', await st());
// 10) post ayarları penceresi
await page.click('[data-act="postcfg"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/ui_post.png' });
await page.getByText('Uygula ve Yeniden Hesapla').click();
await page.waitForTimeout(1500);
// 11) Verify renkleri
await page.check('#optVerify');
await page.waitForTimeout(800);
await page.click('[data-view="iso"]');
await page.waitForTimeout(400);
await page.screenshot({ path: 'test-results/ui_verify.png' });
await page.uncheck('#optVerify');
// 12) senkronizasyon ekranı
await page.click('[data-bt="sync"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/ui_sync.png' });
// 13) örtüşen çevrim aç/kapa
await page.click('.syncbar input');
await page.waitForTimeout(4000);
log('örtüşen çevrim', await st(), await page.evaluate(() => [app.project.sync?.overlap, app.stockSim.overlap, app.verify?.ss.collisions.length]));
await page.click('.syncbar input');
await page.waitForTimeout(3000);
// 14) yeni işlemler: çokgen + yazı özelliği ekle, otomatik plan
await page.evaluate(() => { app.sel = { kind: 'part' }; app.renderProps(); });
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
await page.click('[data-act="sheet"]');
await page.waitForTimeout(800);
log('föy açık', await page.evaluate(() => !!document.querySelector('iframe.sheet')));
await page.click('#mclose');
// 17) görünüm seçenekleri
for (const [id, v] of [['optCabin', 'full'], ['optPath', 'op'], ['optPath', 'none'], ['optCabin', 'none'], ['optPath', 'all']]) { await page.selectOption('#' + id, v); await page.waitForTimeout(200); }
await page.keyboard.press('KeyE'); await page.keyboard.press('KeyE');
await page.click('[data-view="machine"]'); await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/ui_machine.png' });
log('SON', await st());
log('HATALAR', errs.length ? errs.join('\n') : 'yok');
await browser.close();
