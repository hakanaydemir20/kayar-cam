import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:5173/'); await page.waitForTimeout(2500);
const r = await page.evaluate(async () => {
  const txt = (await import('/src/samples/spin-tite-insert.step?raw')).default;
  const { importStepFile } = await import('/src/ui/stepFlow.js');
  const res = await importStepFile(new File([txt], 'spin tite insert.step'));
  const p = res.part;
  return { name: p.name, L: p.length, maxDia: p.maxDia, profile: p.profile.map(q => `${q.z.toFixed(2)}:${q.r.toFixed(2)}`).join(' '), feats: p.features.map(f => f.type + ' ' + JSON.stringify(f)), inner: !!p.inner };
});
console.log(JSON.stringify(r, null, 1));
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
