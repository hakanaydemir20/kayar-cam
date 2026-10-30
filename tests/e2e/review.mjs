// Genel görünüm denetimi: küçük ekranda ana ekran ve pencereler; ekran dışına taşan / kesilen öğeleri raporla
import { chromium } from 'playwright';
const out = process.argv[2] || '.', W = +(process.argv[3] || 1366), H = +(process.argv[4] || 768);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2000);
await page.getByText('Örnek parçayla dene').click(); await page.waitForTimeout(800);
for (let k = 0; k < 4; k++) { await page.locator('.wiz-nav .btn.pri').click(); await page.waitForTimeout(400); }
await page.waitForTimeout(1200); await page.evaluate(() => app.action('auto')); await page.waitForTimeout(3000);
const clipped = () => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('button, .chip, .spill, .pill, .rt')) {
    const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.dd') && !el.closest('.menu.open')) continue;
    const t = (el.textContent || el.title || '').trim().slice(0, 30);
    if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1) bad.push('ekran dışı: ' + t);
    else if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') bad.push('kırpılmış: ' + t);
    else if (r.height > 46 && el.matches('.tbtn,.lbtn,.gtool>button,.rt')) bad.push('iki satıra kırılmış: ' + t);
  }
  return [...new Set(bad)];
});
console.log('ana ekran', W + 'x' + H, await clipped());
await page.screenshot({ path: out + `/r_main_${W}.png` });
await page.locator('.card.op').nth(1).click(); await page.waitForTimeout(400);
await page.screenshot({ path: out + `/r_fly_${W}.png` });
console.log('mini pencere', await page.evaluate(() => { const r = document.getElementById('flyout').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight]; }));
await page.keyboard.press('Escape');
for (const [btn, name] of [['#btnRough', 'kaba'], ['#btnSync', 'senkron'], ['#btnTools', 'takımlar'], ['#btnSettings', 'ayarlar'], ['#btnOutput', 'nc']]) {
  await page.click(btn); await page.waitForTimeout(500);
  const r = await page.evaluate(() => { const b = document.querySelector('.modal.on .mbox'); if (!b) return null; const q = b.getBoundingClientRect(); const body = b.querySelector('.mbody'); return [Math.round(q.width), Math.round(q.height), body.scrollHeight > body.clientHeight + 2 ? 'kaydırmalı' : 'sığıyor']; });
  console.log(name, r, await clipped());
  await page.screenshot({ path: out + `/r_${name}_${W}.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
}
console.log(errs.length ? errs.join('\n') : 'HATA YOK');
await browser.close();
