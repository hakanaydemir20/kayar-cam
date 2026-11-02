// Delik görüntüsü: örnek pim simülasyon sonu, ön/çapraz/arka delik yakın plan
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(3000);
await page.keyboard.press('Escape'); await page.evaluate(() => app.closeModal?.());
await page.waitForFunction(() => app.verify, null, { timeout: 60000 });
// bitmiş parça görünümü (yalnız simülasyon sonu stok değil, hedef) ve simülasyon sonu stok
await page.evaluate(() => { app.t = app.totalTime; app.stockSim.seek(app.t); app.machine.update(app.stockSim, app.t, 0); Object.assign(app.cfg, { body: false, tools: 'active', ghost: false }); app.applyOptions(); });
await page.waitForTimeout(500);
const P = (p, t, n) => page.evaluate(([p, t]) => { const T = app.viewer.camera.position.constructor; app.viewer.pose(new T(...p), new T(...t), true); }, [p, t]).then(() => page.waitForTimeout(600)).then(() => page.screenshot({ path: `${out}/${n}.png`, clip: { x: 320, y: 96, width: 880, height: 730 } }));
// parça karşı iş milinde (kesildi): konumunu bul
const c = await page.evaluate(() => { const m = app.machine.partMesh.mesh; const b = new (app.viewer.camera.position.constructor)(); m.getWorldPosition(b); return [b.x, b.y, b.z]; });
console.log('parça', c);
await P([c[0] - 30, c[1] + 25, c[2] + 40], [c[0] + 10, c[1], c[2]], 'hole0');
await P([c[0] + 25, c[1] + 40, c[2] + 10], [c[0] + 25, c[1], c[2]], 'hole1');
await page.click('#btnFin'); await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/hole2.png`, clip: { x: 320, y: 96, width: 880, height: 730 } });
await browser.close();
