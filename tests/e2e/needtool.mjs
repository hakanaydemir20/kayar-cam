// Örnek STEP: eksik matkap hatasındaki "tak" düğmesi takımı ekler, işleme atar, hata kalkar
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.locator('.scard', { hasText: 'Örnek parçalar' }).click(); await page.waitForTimeout(300); await page.locator('.smp', { hasText: 'Spin-tite' }).click();
await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(800);
for (let k = 0; k < 4; k++) { await page.locator('.wiz .btn.pri, .wiz-nav .btn.pri').last().click(); await page.waitForTimeout(600); }
await page.waitForTimeout(1500);
await page.evaluate(() => app.action('auto')); await page.waitForTimeout(5000);
const st = () => page.evaluate(() => ({ err: app.result.errors.map(e => e.msg), over: app.verify?.c.over, col: app.verify?.ss.collisions.length }));
console.log('ÖNCE', JSON.stringify(await st()));
await page.click('[data-rt=msgs]'); await page.waitForTimeout(300);
const btn = page.locator('.msg-fix');
console.log('DÜĞME', await btn.count(), await btn.first().innerText().catch(() => '-'));
await page.screenshot({ path: out + '/n1.png' });
await btn.first().click(); await page.waitForTimeout(5000);
console.log('SONRA', JSON.stringify(await st()));
console.log('TAKIM', await page.evaluate(() => { const t = app.project.tools[app.project.tools.length - 1]; return `T${t.num} ${t.name} ${t.unit} y${t.yPos}`; }));
await page.screenshot({ path: out + '/n2.png' });
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
