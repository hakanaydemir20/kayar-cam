// Uç–parça temas denetimi: örnek parçalar kaba otomatikle hazırlanır, simülasyon boyunca ekrandaki kesici uç ağının
// (insert mesh) kalan stoğa gömülmesi ölçülür. Gömülme: uç ekranda parçanın içinde ama malzeme kalkmamış.
import { chromium } from 'playwright';
const TOL = +(process.env.TOL || 0.03);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.locator('.scard', { hasText: 'Örnek parçalar' }).click(); await page.waitForTimeout(500);
const n = await page.locator('.smp').count();
let bad = 0;
for (let i = 0; i < n; i++) {
  if (i) { await page.evaluate(() => app.openSamples()); await page.waitForTimeout(400); }
  const name = await page.locator('.smp b').nth(i).innerText();
  await page.locator('.smp').nth(i).click();
  await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(700);
  for (let k = 0; k < 4; k++) { await page.locator('.wiz .btn.pri, .wiz-nav .btn.pri').last().click(); await page.waitForTimeout(500); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { app.closeModal?.(); app.openRough(); }); await page.waitForSelector('.rw-plan'); await page.waitForTimeout(300);
  await page.evaluate(() => { app.verify = null; }); await page.locator('.rw-nav .btn.pri').click();
  await page.waitForFunction(() => app.verify && app.result, null, { timeout: 90000 }); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const THREE = window.THREE, S = app.stockSim, M = app.machine;
    Object.assign(app.cfg, { tools: 'all' }); app.applyOptions();
    const moves = S.moves || S.timeline || [];
    const tEnd = S.totalTime;
    const worst = {}; const w = new THREE.Vector3();
    const N = +(window.__N || 1200);
    for (let k = 0; k <= N; k++) {
      const t = tEnd * k / N;
      S.seek(t); M.update(S, t, 0); M.root.updateMatrixWorld(true);
      const m1 = S.currentMove(1); const tool = m1?.state?.tool || m1?.tool;
      if (!tool || tool.type !== 'turn' || tool.unit !== 'gang' || S.state.attached === 'sub') continue;
      const v = M.tools.get(tool.id); const ins = v?.mesh.children[0]?.children?.[0]; if (!ins?.isMesh) continue;
      const Minv = M.mainHolder.matrixWorld.clone().invert(), pos = ins.geometry.attributes.position, sim = S.stock;
      let pen = 0, at = null;
      const V = [];
      for (let q = 0; q < pos.count; q++) { w.fromBufferAttribute(pos, q).applyMatrix4(ins.matrixWorld).applyMatrix4(Minv); V.push([-w.x, Math.hypot(w.y, w.z)]); }
      // ızgara dilimi (dz) ucun eksenel sınırına denk gelirse yarım dilim sayılmaz: uç sınırından 1 dilim içerisi
      const dLo = Math.min(...V.map(v => v[0])) + sim.dz, dHi = Math.max(...V.map(v => v[0])) - sim.dz;
      for (const [d, rr] of V) {
        const i = sim.idx(d);
        if (i < 0 || i >= sim.nz || d > S.L || d < dLo || d > dHi) continue;
        const g = sim.rowMax[i] - rr;
        if (g > pen) { pen = g; at = { Z: +d.toFixed(2), R: +rr.toFixed(2), stokR: +sim.rowMax[i].toFixed(2) }; }
      }
      const key = tool.name + ' (' + (tool.insertCode || tool.insertShape) + ')';
      if (!worst[key] || pen > worst[key].pen) worst[key] = { pen: +pen.toFixed(3), t: +t.toFixed(2), line: m1.line, at };
    }
    return { tEnd, worst };
  });
  const over = Object.values(r.worst).some(x => x.pen > TOL);
  if (over) bad++;
  console.log(over ? '✗' : '✓', name, 'tEnd', r.tEnd);
  for (const [k, x] of Object.entries(r.worst)) console.log('   ', k, JSON.stringify(x));
}
console.log('SORUNLU', bad, '| sayfa hatası', errs.length ? errs : 'yok');
await browser.close();
