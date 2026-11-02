// Kaba otomatik (taret önerisi) + Finiş otomatik
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2000);
await page.getByText('Örnek parçayla dene').click(); await page.waitForTimeout(800);
for (let k = 0; k < 4; k++) { await page.locator('.wiz-nav .btn.pri').click(); await page.waitForTimeout(400); }
await page.waitForTimeout(1500);
await page.click('#btnRough'); await page.waitForTimeout(600);
const adv = await page.evaluate(() => [...document.querySelectorAll('.rw-plan .rw-trow')].map(r => r.innerText.replace(/\n/g, ' | ')));
await page.screenshot({ path: out + '/w1_rough.png' });
const t1 = await page.evaluate(() => { const t = app.project.tools.find(x => x.id === app._rough.t1); return t && [t.num, t.name, t.yPos]; });
await page.locator('.rw-nav .btn.pri').click(); await page.waitForTimeout(3000);
await page.click('#btnFinish'); await page.waitForTimeout(600);
await page.screenshot({ path: out + '/w2_finish.png' });
await page.locator('.rw-form select').nth(2).selectOption('0.8'); await page.waitForTimeout(300);
await page.locator('.rw-nav .btn.pri').click(); await page.waitForTimeout(3500);
console.log('öneri', JSON.stringify(adv), '| ana', t1);
console.log('işlemler', await page.evaluate(() => [app.project.ops.map(o => o.type + ':' + (app.project.tools.find(t => t.id === o.toolId)?.num ?? '')).join(','), app.project.ops.find(o => o.type === 'finish')?.params.feed, app.result.errors.length, app.verify?.ss.collisions.length, document.getElementById('statusTxt').textContent]));
console.log(errs.length ? errs.join('\n') : 'HATA YOK');
await browser.close();
