import { chromium } from 'playwright';
import fs from 'fs';
const S = 'C:/Users/gameb/AppData/Local/Temp/claude/C--Users-gameb-OneDrive-Masa-st--AI-projeler-CNC-CAM/5015d3d9-f11b-4049-a720-dbe7185cc046/scratchpad';
const glb = fs.readFileSync(S + '/m.glb').toString('base64');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto('http://localhost:5173/'); await page.waitForTimeout(2500);
const views = await page.evaluate(async (b64) => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  const g = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(1200, 800);
  const s = new THREE.Scene(); s.background = new THREE.Color(0xdde3ea); s.add(g.scene);
  s.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.5)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(1, 2, 1.5); s.add(dl);
  const out = [];
  for (const [p, t] of [[[1.6, 0.9, 1.3], [0.2, 0, 0]], [[0, 0.05, 2.2], [0.2, 0, 0]], [[0.25, 1.9, 0.01], [0.25, 0, 0]], [[-0.9, 0.4, 0.2], [0.2, 0, 0]]]) {
    const c = new THREE.PerspectiveCamera(35, 1.5, 0.01, 20); c.position.set(...p); c.lookAt(...t); r.render(s, c); out.push(r.domElement.toDataURL('image/png'));
  }
  return out;
}, glb);
views.forEach((v, i) => fs.writeFileSync(`${S}/glb${i}.png`, Buffer.from(v.split(',')[1], 'base64')));
await browser.close();
