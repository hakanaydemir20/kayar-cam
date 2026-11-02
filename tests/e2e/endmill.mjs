// Parmak freze modeli (OBJ) + "yalnız takımlar" görünümü
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(3000);
await page.keyboard.press('Escape'); await page.evaluate(() => app.closeModal?.());
const thumbs = await page.evaluate(async () => { const { toolThumb } = await import('/src/view3d/toolThumbs.js'); return app.project.tools.filter(t => t.type === 'endmill').map(t => ({ n: t.name, src: toolThumb(t) })); });
for (const [i, t] of thumbs.entries()) { const b = Buffer.from(t.src.split(',')[1], 'base64'); (await import('fs')).writeFileSync(`${out}/em${i}.png`, b); console.log(i, t.n); }
await page.evaluate(() => { app.cfg.bareTools = true; app.cfg.tools = 'all'; app.cfg.body = false; app.applyOptions(); });
await page.waitForTimeout(800);
// çapraz ünitenin yakın planı
await page.evaluate(() => { const m = app.machine; const t = app.project.tools.find(x => x.type === 'endmill'); const v = m.tools.get(t.id).holder; const THREE = v.position.constructor; const p = new THREE(); v.getWorldPosition(p); app.viewer.pose(p.clone().add(new THREE(90, 60, 120)), p, true); });
await page.waitForTimeout(1200);
await page.screenshot({ path: out + '/bare.png' });
await page.evaluate(() => { app.cfg.bareTools = false; app.applyOptions(); }); await page.waitForTimeout(800);
await page.screenshot({ path: out + '/holders.png' });
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
