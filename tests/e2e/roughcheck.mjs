// Kaba otomatik denetimi (yerel sunucu): farklı parçalarda her ana takım × ikinci takım seçeneği uygulanır;
// her sonuçta CAM/NC hatası, çarpışma ve fazla kesim olmamalı. Taret önerisi onaylanınca da aynı denetim.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
await page.goto('http://localhost:5173/'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(2500);
await page.keyboard.press('Escape');

const parts = {
  'örnek pim': () => window.__mk.example(),
  'kademeli burç (çizim)': () => window.__mk.sketchEx(),
  'derin boyunlu mil (çizim)': () => window.__mk.neck(),
  'koni + radyüs (çizim)': () => window.__mk.cone(),
  'spin-tite insert (STEP)': () => window.__mk.spin,
};
await page.evaluate(async () => {
  window.__ps = await import('/src/sim/stockSim.js');
  const P0 = await import('/src/part/part.js'), S = await import('/src/part/section.js');
  const L = (a, b) => ({ type: 'line', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
  const poly = (...p) => p.map((q, i) => L(q, p[(i + 1) % p.length]));
  const txt = (await import('/src/samples/spin-tite-insert.step?raw')).default;
  const { importStepFile } = await import('/src/ui/stepFlow.js');
  const spin = (await importStepFile(new File([txt], 'Spin-tite insert.step'))).part;
  window.__mk = {
    spin,
    example: () => P0.examplePart(),
    sketchEx: () => { const e = [...poly([0, 0], [0, 4], [10, 4], [10, 6], [28, 6], [28, 0]), ...poly([0, 0], [0, 2], [12, 2], [12, 2.6], [13.2, 2.6], [13.2, 2], [18, 2], [18, 0])]; S.cornerOp(e, { x: 0, y: 4 }, 'ch', 0.5); return S.sectionToPart(e, 'burç').part; },
    neck: () => S.sectionToPart(poly([0, 0], [0, 5], [6, 5], [6, 3], [14, 3], [14, 6.5], [24, 6.5], [24, 0]), 'boyun').part,
    cone: () => { const e = poly([0, 0], [0, 3], [5, 3], [12, 6], [20, 6], [20, 4], [26, 4], [26, 0]); S.cornerOp(e, { x: 20, y: 6 }, 'rad', 1); return S.sectionToPart(e, 'koni').part; },
  };
});
const results = [];
for (const [name, fn] of Object.entries(parts)) {
  // yeni proje: parça + varsayılan taret, işlem listesi boş
  await page.evaluate(async (src) => {
    const { newProject } = await import('/src/project.js');
    const part = new Function('return (' + src + ')()')();
    const P = newProject(part); P.ops = []; app.project = P; app.sel = { kind: 'none' }; app.recalc();
  }, fn.toString());
  await page.waitForTimeout(800);
  // ana takım seçenekleri: taretteki tornalama takımları + katalog (tarete takılacak)
  const choices = await page.evaluate(() => { app.project.ops = []; app.recalc(); app.openRough(); const s = [...document.querySelectorAll('.rw-form select')][1]; const v = [...s.options].map(o => o.value); app.closeModal(); return v; });
  for (const ch of choices) {
    const r = await page.evaluate(async (ch) => {
      // her deneme temiz taretle: önceki denemede takılan takımlar sökülür
      app.project.tools = app.__tools0 ? JSON.parse(app.__tools0) : app.project.tools; app.__tools0 ||= JSON.stringify(app.project.tools);
      app.project.ops = []; app.recalc();
      app.openRough();
      const s = [...document.querySelectorAll('.rw-form select')][1]; s.value = ch; s.dispatchEvent(new Event('change'));
      const st = app._rough, plan = st.plan;
      const steps = plan.steps.map(x => `${x.kind}:T${x.tool.num}${x.virt ? '+' : ''}`).join(' ');
      const t1 = (await import('/src/tools/toolLibrary.js'));
      app.applyRough(st);
      await new Promise(res => { const w = () => (app.verify ? res() : setTimeout(w, 50)); w(); });
      const v = app.verify, ops = app.project.ops;
      const zones = app.roughZones(app.project.tools.find(t => t.id === ops.find(o => o.type === 'rough').toolId));
      return { main: ch.startsWith('cat:') ? ch : app.project.tools.find(t => t.id === ch)?.num, steps, firstOp: ops[0]?.type, warn: plan.warn.length,
        err: app.result.errors.map(e => e.msg), col: v.ss.collisions.map(c => c.msg), over: v.c.over,
        zoneLeft: (() => { const { profileR } = window.__ps; const S = v.ss.resultStock(); let m = 0; for (const z of zones) for (let i = S.idx(z.z0 + 0.1); i <= S.idx(z.z1 - 0.1); i++) { const d = S.dAt(i), pr = app.project.part.profile; const tg = Math.max(profileR(pr, d - 0.06), profileR(pr, d), profileR(pr, d + 0.06)); m = Math.max(m, S.rowMax[i] - tg); } return +m.toFixed(3); })() };
    }, ch);
    results.push({ part: name, ...r });
  }
  await page.evaluate(() => { delete app.__tools0; });
}
let bad = 0;
for (const r of results) {
  const ok = !(r.err?.length) && !(r.col?.length || r.col > 0) && !(r.over > 0) && r.firstOp === 'face';
  if (!ok) bad++;
  console.log(ok ? '✓' : '✗', JSON.stringify(r));
}
console.log(`\n${results.length} durum, ${bad} sorunlu`);
console.log(errs.length ? errs.join('\n') : 'SAYFA HATASI YOK');
await browser.close();
