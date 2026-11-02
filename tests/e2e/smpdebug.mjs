// Örnek parça hata ayıklama: node smpdebug.mjs <out> <index>
import { chromium } from 'playwright';
const out = process.argv[2] || '.', idx = +(process.argv[3] || 1);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.locator('.scard', { hasText: 'Örnek parçalar' }).click(); await page.waitForTimeout(400);
await page.locator('.smp').nth(idx).click();
await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(700);
for (let k = 0; k < 4; k++) { await page.locator('.wiz .btn.pri, .wiz-nav .btn.pri').last().click(); await page.waitForTimeout(500); }
await page.waitForTimeout(1500);
await page.evaluate(() => { app.closeModal?.(); app.openRough(); }); await page.waitForSelector('.rw-plan');
await page.evaluate(() => { app.verify = null; }); await page.locator('.rw-nav .btn.pri').click();
await page.waitForFunction(() => app.verify && app.result, null, { timeout: 90000 });
console.log(await page.evaluate(() => {
  const P = app.project, st = app.verify.c.status, S = app.verify.ss.resultStock(), T = app.target, rows = {};
  const res = [`L ${P.part.length} bar ${P.stock.barDia} cutW ${app.result.built.ctx.cutW}`, 'OPS ' + P.ops.map(o => `${o.type}[${P.tools.find(t => t.id === o.toolId)?.num ?? '-'}]`).join(' ')];
  res.push('ÇARPIŞMA ' + JSON.stringify(app.verify.ss.collisions.slice(0, 3).map(c => ({ m: c.msg, line: c.line, path: c.path, op: P.ops.find(o => o.id === app.result.posted.lineInfo[(c.path || 1) - 1]?.[c.line]?.opId)?.name }))));
  if (st) { for (let k = 0; k < st.length; k++) if (st[k] === 1) { const i = Math.floor(k / S.nth), j = k % S.nth, d = S.dAt(i).toFixed(2); rows[d] = rows[d] || { n: 0, j0: j, s: S.r[k].toFixed(3), t: T.r[k].toFixed(3), rin: S.rin[i].toFixed(2), trin: T.rin[i].toFixed(2) }; rows[d].n++; }
    const ks = Object.keys(rows); res.push('FAZLA ' + ks.length + ' satır: ' + ks.filter((_, i) => i % Math.max(1, Math.floor(ks.length / 10)) === 0).map(k => k + JSON.stringify(rows[k])).join(' ')); }
  return res.join('\n');
}));
if (process.argv[4] === 'bisect') {
  const n = await page.evaluate(() => app.project.ops.length);
  for (let i = 0; i < n; i++) {
    await page.evaluate((i) => { app.project.ops.forEach((o, k) => { o.enabled = k !== i; }); app.verify = null; app.recalc(true); }, i);
    await page.waitForFunction(() => app.verify && app.result, null, { timeout: 90000 });
    console.log('kapalı', i, await page.evaluate((i) => app.project.ops[i].name + ' → fazla ' + app.verify.c.over + ' çarpışma ' + app.verify.ss.collisions.length, i));
  }
}
await browser.close();
