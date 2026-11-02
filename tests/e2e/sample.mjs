// Örnek STEP parça (Spin-tite insert): başlangıç kartı → sihirbaz → otomatik plan → doğrulama → bitmiş parça
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.locator('.scard', { hasText: 'Örnek parçalar' }).click(); await page.waitForTimeout(300); await page.locator('.smp', { hasText: 'Spin-tite' }).click();
await page.waitForSelector('.wiz-steps', { timeout: 30000 }); await page.waitForTimeout(800);
await page.screenshot({ path: out + '/s1.png' });
const next = () => page.locator('.wiz .btn.pri, .wiz-nav .btn.pri').last().click();
for (let k = 0; k < 4; k++) { await next(); await page.waitForTimeout(600); }
await page.waitForTimeout(1500);
const a = await page.evaluate(() => ({ part: app.project.part.name, bar: app.project.stock.barDia, mat: app.project.stock.material, ops: app.project.ops.length, feats: app.project.part.features.map(f => f.type) }));
console.log('SİHİRBAZ', JSON.stringify(a));
await page.evaluate(() => app.action('auto')); await page.waitForTimeout(5000);
const b = await page.evaluate(() => ({ ops: app.project.ops.map(o => o.type), err: app.result.errors.map(e => e.msg), warn: (app.result.warnings || []).map(e => e.msg || e), col: app.verify?.ss.collisions.length, over: app.verify?.c.over, under: app.verify?.c.under, status: document.getElementById('status')?.innerText }));
console.log('PLAN', JSON.stringify(b, null, 1));
console.log('FAZLA KESİM', await page.evaluate(() => { const st = app.verify.c.status, S = app.verify.ss.resultStock(), T = app.target, rows = {}; if (!st) return 'yok';
  for (let k = 0; k < st.length; k++) if (st[k] === 1) { const i = Math.floor(k / S.nth), d = S.dAt(i).toFixed(1); rows[d] = rows[d] || { n: 0, s: S.r[k].toFixed(2), t: T.r[k].toFixed(2), rin: S.rin[i].toFixed(2), trin: T.rin[i].toFixed(2) }; rows[d].n++; }
  const ks = Object.keys(rows); return ks.length + ' satır: ' + ks.filter((_, i) => i % Math.max(1, Math.floor(ks.length / 12)) === 0).map(k => k + JSON.stringify(rows[k])).join(' ');
}));
await page.screenshot({ path: out + '/s2.png' });
await page.click('#btnFin'); await page.waitForTimeout(900);
const cls = await page.evaluate(() => { const f = app.fin; return [f.classify(4, 6.0, 0).kind + ':' + JSON.stringify(f.classify(4, 6.0, 0).feat?.type), f.classify(4, 4.766, 1).kind, f.classify(12, 5.417, 1).kind, f.classify(0.6, 8.768, 1).kind, f.classify(8.288, 6, 0).kind]; });
console.log('SINIF', cls.join(' | '));
await page.screenshot({ path: out + '/s3.png' });
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
