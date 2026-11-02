// Makine görünümü: çizimle karşılaştırma için birkaç açıdan (takımlar, tutucular açık)
import { chromium } from 'playwright';
const out = process.argv[2] || '.', ngb = process.argv[3] === 'ngb';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.keyboard.press('Escape'); await page.evaluate(() => app.closeModal?.());
await page.evaluate((ngb) => { if (ngb) { app.project.machine.guideBush = false; app.recalc(); } Object.assign(app.cfg, { tools: 'all', holders: true, body: true, cabin: false, axes: true, dro: false, code: false }); app.applyOptions(); }, ngb);
await page.waitForTimeout(2500);
const views = [[[260, 230, 330], [60, 20, -10]], [[60, 40, 420], [60, 0, 0]], [[-180, 150, 200], [40, 0, 0]], [[320, 60, -40], [100, 0, 40]]];
for (const [i, [p, t]] of views.entries()) {
  await page.evaluate(([p, t]) => { const V = app.viewer, T = V.camera.position.constructor; app.viewer.pose(new T(...p), new T(...t), true); }, [p, t]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/mv${ngb ? 'n' : ''}${i}.png`, clip: { x: 320, y: 96, width: 880, height: 730 } });
}
console.log(await page.evaluate(() => ({ err: app.result.errors.map(e => e.msg).slice(0, 3), col: app.verify?.ss.collisions.length, over: app.verify?.c.over })));
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
