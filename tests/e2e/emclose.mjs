import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
await page.goto('http://localhost:5173/'); await page.waitForTimeout(3000);
const png = await page.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { createToolMesh } = await import('/src/view3d/toolMeshes.js');
  const { makeTool } = await import('/src/tools/toolLibrary.js');
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(900, 700);
  const s = new THREE.Scene(); s.background = new THREE.Color(0xdde3ea);
  s.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 2.5); dl.position.set(40, 60, 80); s.add(dl);
  [6, 4, 2].forEach((d, i) => { const g = createToolMesh(makeTool({ type: 'endmill', unit: 'gang', dia: d, flutes: 3 })); g.position.x = (i - 1) * 16; s.add(g); });
  const c = new THREE.PerspectiveCamera(30, 900 / 700, 1, 1000); c.position.set(0, 25, 110); c.lookAt(0, 25, 0);
  r.render(s, c); return r.domElement.toDataURL('image/png');
});
(await import('fs')).writeFileSync(out + '/emclose.png', Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
