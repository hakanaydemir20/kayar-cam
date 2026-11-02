// Örnek parça kütüphanesi: her parça listeden seçilir, sihirbaz → kaba otomatik (tüm adımlar) → hatasız, çarpışmasız, fazla kesimsiz
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.locator('.scard', { hasText: 'Örnek parçalar' }).click(); await page.waitForTimeout(500);
await page.screenshot({ path: out + '/samples.png' });
const n = await page.locator('.smp').count();
console.log('KART', n, (await page.locator('.smp b').allInnerTexts()).join(' | '));
let bad = 0;
for (let i = 0; i < n; i++) {
  if (i) { await page.evaluate(() => app.openSamples()); await page.waitForTimeout(400); }
  const name = await page.locator('.smp b').nth(i).innerText();
  await page.locator('.smp').nth(i).click();
  await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(700);
  for (let k = 0; k < 4; k++) { await page.locator('.wiz .btn.pri, .wiz-nav .btn.pri').last().click(); await page.waitForTimeout(500); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { app.closeModal?.(); app.openRough(); }); await page.waitForSelector('.rw-plan'); await page.waitForTimeout(300);
  const plan = await page.evaluate(() => ({ s: app._rough.plan.steps.map(s => s.key.split(':')[0] + (s.virt ? '*' : '')).join(' '), w: app._rough.plan.warn }));
  if (i === 1) await page.screenshot({ path: out + '/plan-' + i + '.png' });
  await page.evaluate(() => { app.verify = null; }); await page.locator('.rw-nav .btn.pri').click();
  await page.waitForFunction(() => app.verify && app.result, null, { timeout: 90000 }); await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ ops: app.project.ops.length, err: app.result.errors.map(e => e.msg), warn: app.result.warnings.map(w => w.msg).slice(0, 4), col: app.verify.ss.collisions.map(c => c.msg).slice(0, 3), over: app.verify.c.over, under: +(app.verify.c.under / app.verify.c.cells * 100).toFixed(2), bar: document.getElementById('barTxt').textContent,
    // takımlar yalnız makinenin gerçek istasyonlarında (gang 6, çapraz 4, T35 3 kat, arka 4)
    offSt: (() => { const T = app.project.tools; const c = (u) => T.filter(t => u.includes(t.unit)).length;
      return [c(['gang']) > 6 && 'gang ' + c(['gang']), c(['cross']) > 4 && 'cross ' + c(['cross']), c(['front']) > 3 && 'front ' + c(['front']), c(['back', 'rear']) > 4 && 'back ' + c(['back', 'rear'])].filter(Boolean); })() }));
  const ok = !r.err.length && !r.col.length && !r.over && !r.offSt.length;
  if (!ok) bad++;
  console.log(ok ? '✓' : '✗', name, '| plan:', plan.s, plan.w.length ? '| uyarı: ' + plan.w.join(' ; ') : '');
  console.log('   ', JSON.stringify(r));
  await page.screenshot({ path: `${out}/smp-${i}.png` });
}
console.log('SORUNLU', bad);
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
