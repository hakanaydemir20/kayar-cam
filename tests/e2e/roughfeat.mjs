// Kaba otomatik: tanınan geometriler (delik, diş, düzlük, çokgen, arka delik) plana girer, kapatılan adım oluşturulmaz,
// onayla → hatasız, çarpışmasız, fazla kesimsiz program
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
const wait = () => page.waitForFunction(() => app.verify && app.result, null, { timeout: 60000 });
const state = () => page.evaluate(() => ({ ops: app.project.ops.map(o => o.type + (o.toolId ? '' : '!')).join(' '), err: app.result.errors.map(e => e.msg), col: app.verify?.ss.collisions.length, over: app.verify?.c.over }));
async function run(label, setup, offKeys = []) {
  await page.evaluate(setup); await page.waitForTimeout(1500);
  await page.evaluate(() => { app.closeModal?.(); app.openRough(); });
  await page.waitForSelector('.rw-plan'); await page.waitForTimeout(400);
  const steps = await page.evaluate(() => app._rough.plan.steps.map(s => `${s.key}${s.virt ? '*' : ''}`));
  console.log(label, 'PLAN', steps.join(' | '));
  console.log(label, 'UYARI', JSON.stringify(await page.evaluate(() => app._rough.plan.warn)));
  for (const k of offKeys) await page.locator('.rw-plan label.rw-trow').nth(steps.findIndex(s => s.startsWith(k))).click();
  if (offKeys.length) console.log(label, 'KAPALI', await page.evaluate(() => [...app._rough.off].join(',')), await page.locator('.rw-nav .btn.pri').innerText());
  await page.screenshot({ path: `${out}/rf-${label}.png` });
  await page.evaluate(() => { app.verify = null; }); await page.locator('.rw-nav .btn.pri').click();
  await wait(); await page.waitForTimeout(500);
  console.log(label, 'SONUÇ', JSON.stringify(await state()));
}
await run('ornek', () => { app.closeModal?.(); app.project = app.project; });
await run('ornek-kapali', () => {}, ['crossDrill', 'backDrill']);
// spin-tite STEP
await page.evaluate(() => app.closeModal?.());
await page.locator('[data-act=new]').first().click().catch(() => {}); await page.waitForTimeout(500);
await page.locator('.scard', { hasText: 'Örnek parçalar' }).click(); await page.waitForTimeout(300); await page.locator('.smp', { hasText: 'Spin-tite' }).click();
await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(800);
for (let k = 0; k < 4; k++) { await page.locator('.wiz .btn.pri, .wiz-nav .btn.pri').last().click(); await page.waitForTimeout(600); }
await page.waitForTimeout(2000);
await run('spintite', () => {});
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
