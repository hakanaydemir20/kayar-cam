// Frezeleme deseni seçici: tıklanan kart seçili görünür, parametre ve takım yolu değişir
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.evaluate(() => { app.closeModal?.(); const op = app.project.ops.find(o => o.type === 'flatMill'); app.sel = { kind: 'op', id: op.id }; app.renderTree(); });
await page.waitForTimeout(800);
const labels = await page.locator('.mp-card b').allInnerTexts();
console.log('KARTLAR', labels.length, labels.join(' | '));
for (let i = 0; i < labels.length; i++) {
  await page.locator('.mp-card').nth(i).click(); await page.waitForTimeout(1500);
  const s = await page.evaluate(() => { const op = app.project.ops.find(o => o.type === 'flatMill'); const on = [...document.querySelectorAll('.mp-card')].map((c, k) => c.classList.contains('on') ? k : -1).filter(k => k >= 0);
    const mv = app.result.sim.paths[0].moves.filter(m => m.kind === 'feed' && app.result.posted.lineInfo[0][m.line]?.opId === op.id);
    return { pat: op.params.pattern, on, n: mv.length, cards: document.querySelectorAll('.mp-card').length, err: app.result.errors.map(e => e.msg) }; });
  console.log(i, labels[i], JSON.stringify(s));
}
await page.screenshot({ path: out + '/mp.png' });
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
