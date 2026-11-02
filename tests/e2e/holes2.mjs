// Delik görüntüsü yakın plan: bitmiş parça görünümünde çapraz delik (Z29) ve ön delik; simülasyonda kesmeden hemen önce
import { chromium } from 'playwright';
const out = process.argv[2] || '.', tag = process.argv[3] || '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(3000);
await page.keyboard.press('Escape'); await page.evaluate(() => app.closeModal?.());
await page.waitForFunction(() => app.verify, null, { timeout: 60000 });
const shot = (n) => page.screenshot({ path: `${out}/${n}${tag}.png`, clip: { x: 320, y: 96, width: 880, height: 730 } });
// simülasyon: kesme işleminin başı (parça bitmiş, henüz ana iş milinde)
await page.evaluate(() => { const ot = app.opTimes[app.project.ops.find(o => o.type === 'cutoff').id]; app.t = ot.t0; app.stockSim.seek(app.t); app.machine.update(app.stockSim, app.t, 0); Object.assign(app.cfg, { body: false, tools: 'active', ghost: false, holders: false }); app.applyOptions(); app.machine.update(app.stockSim, app.t, 0); });
await page.waitForTimeout(400);
const c = await page.evaluate(() => { const m = app.machine.partMesh.mesh; const V = app.viewer.camera.position.constructor; const b = new V(); m.getWorldPosition(b); return [b.x, b.y, b.z]; });
// parça yerel x = −d: çapraz delik d = 29 → dünya x = c − 29; delik C0 → yukarı (y)
const pose = (p, t) => page.evaluate(([p, t]) => { const T = app.viewer.camera.position.constructor; app.viewer.pose(new T(...p), new T(...t), true); }, [p, t]).then(() => page.waitForTimeout(700));
await pose([c[0] - 29 + 8, c[1] + 26, c[2] + 10], [c[0] - 29, c[1] + 5, c[2]]); await shot('hx');
await pose([c[0] + 22, c[1] + 8, c[2] + 10], [c[0], c[1], c[2]]); await shot('hf');
await browser.close();
