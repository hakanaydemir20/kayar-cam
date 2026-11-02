// Bitmiş parça görünümü: aç, yüzeylere tıkla, menüden işlem ekle
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.keyboard.press('Escape');
await page.evaluate(async () => { const { newProject } = await import('/src/project.js'); const P0 = await import('/src/part/part.js'); const P = newProject(P0.examplePart()); P.ops = []; app.project = P; app.sel = { kind: 'none' }; app.recalc(); });
await page.waitForTimeout(800);
await page.click('#btnFin'); await page.waitForTimeout(900);
await page.screenshot({ path: out + '/fin1.png' });
// yüzey sınıflandırma: doğrudan classify ile her bölgeyi dene
const cls = await page.evaluate(() => { const L = app.project.part.length; const f = app.fin; const pr = app.project.part.profile; const res = [];
  res.push(f.classify(0, 2, 0).kind);
  for (let k = 0; k < pr.length - 1; k++) { const a = pr[k], b = pr[k + 1]; if (b.z - a.z > 0.2) { const d = (a.z + b.z) / 2; const s = f.classify(d, a.r + (b.r - a.r) * 0.5, 1.0); res.push(s.kind + ' ' + (s.z0 ?? '') + '-' + (s.z1 ?? '') + ' Ø' + (s.dia ?? '')); } }
  res.push(JSON.stringify(app.project.part.features.map(x => x.type)));
  return res; });
console.log(cls.join('\n'));
// gerçek tıklama: ekran ortası
const vp = await page.$('#viewport'); const bb = await vp.boundingBox();
let popped = null;
for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.5], [0.55, 0.48], [0.4, 0.52], [0.6, 0.5]]) {
  await page.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy); await page.waitForTimeout(300);
  popped = await page.evaluate(() => document.getElementById('finPop')?.innerText.replace(/\n/g, ' | '));
  if (popped) break;
}
console.log('POPUP:', popped);
await page.screenshot({ path: out + '/fin2.png' });
const n0 = await page.evaluate(() => app.project.ops.length);
const btn = await page.$('#finPop .fp-act');
if (btn) { await btn.click(); await page.waitForTimeout(1500); }
const r = await page.evaluate(() => ({ ops: app.project.ops.map(o => o.type + JSON.stringify({ zMin: o.params.zMin, zMax: o.params.zMax, f: o.params.featureId })), err: app.result.errors.map(e => e.msg), fin: app.fin.on, mVis: app.machine.root.visible }));
console.log('ÖNCE', n0, 'SONRA', JSON.stringify(r));
await page.screenshot({ path: out + '/fin3.png' });
await page.keyboard.press('KeyF'); await page.waitForTimeout(700);
console.log('kapalı:', await page.evaluate(() => ({ fin: app.fin.on, mVis: app.machine.root.visible })));
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
