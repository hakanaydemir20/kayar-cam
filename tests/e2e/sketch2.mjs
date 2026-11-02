// Serbest çizim: çizgi zinciri (kapalı), iç dikdörtgen (düz dipli delik), pah, ölçü, Esc, parça
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.waitForTimeout(2000); await page.keyboard.press('Escape');
await page.click('#btnOpen'); await page.locator('.menu.open .dd button', { hasText: 'Çizim yap' }).click(); await page.waitForTimeout(500);
const S = (z, r) => page.evaluate(([z, r]) => { const sk = window.__lastSketcher; const [x, y] = sk.S(z, r); const b = sk.cv.getBoundingClientRect(); return [b.left + x, b.top + y]; }, [z, r]);
const click = async (z, r) => { const [x, y] = await S(z, r); await page.mouse.move(x, y); await page.mouse.click(x, y); await page.waitForTimeout(60); };
for (const [z, r] of [[0, 0], [0, 4], [12, 4], [12, 6], [30, 6], [30, 0], [0, 0]]) await click(z, r);
const st1 = await page.evaluate(() => [window.__lastSketcher.ents.length, window.__lastSketcher.chain, window.__lastSketcher.errs]);
await page.locator('.sk-tools button', { hasText: 'Dikdörtgen' }).click();
await click(0, 0); await click(8, 2);
await page.locator('.sk-tools button', { hasText: 'Pah' }).click();
await click(0, 4);
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
const open = await page.evaluate(() => document.getElementById('modal').classList.contains('on'));
// ölçü: 30 mm'lik üst çizginin boyunu 25 yap
await page.locator('.sk-tools button', { hasText: 'Ölçü' }).click();
await click(20, 6); await page.waitForTimeout(150);
await page.keyboard.press('Control+A'); await page.keyboard.type('15'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
const res = await page.evaluate(() => { const s = window.__lastSketcher; return { L: s.res?.part?.length, feats: s.res?.part?.features.map(f => `${f.type} ${f.side || ''} Ø${f.dia} ${f.depth ?? (f.z0 + '-' + f.z1)} ${f.flat ? 'düz' : ''}`), errs: s.errs, warn: s.res?.warnings.length }; });
await page.screenshot({ path: out + '/s2_sketch.png' });
await page.click('.sk-panel .btn.pri'); await page.waitForTimeout(800);
for (let k = 0; k < 3; k++) { await page.locator('.wiz-nav .btn.pri').click(); await page.waitForTimeout(400); }
await page.waitForTimeout(1500); await page.evaluate(() => app.action('auto')); await page.waitForTimeout(3500);
console.log('kontur', st1, '| Esc sonrası açık', open, '|', JSON.stringify(res));
console.log('parça', await page.evaluate(() => [app.project.part.source, app.project.part.length, !!app.project.part.inner, app.project.ops.map(o => o.type).join(','), app.result.errors.length, document.getElementById('statusTxt').textContent]));
console.log(errs.length ? errs.join('\n') : 'HATA YOK');
await browser.close();
