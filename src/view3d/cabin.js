// Star SB-20R Type G dış kabini (ürün fotoğrafına göre): solda açık gri kabin, ortada mavi kule ve
// FANUC 0i-TF paneli, sağda pencereli sürgülü kapı ("SB-20R type G"), en sağda parça çıkış ünitesi,
// altta siyah kaide. Ölçüler yaklaşık: 2070 mm boy, ~1750 mm yükseklik; iş mili ekseni zeminden ~1050 mm.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat } from './materials.js';
import { canvasTex, decalPlane } from './decals.js';

export const FLOOR_Y = -1050;

function slab(x0, x1, y0, y1, z0, z1, m, parent, r = 4) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  const b = new THREE.Mesh(g, typeof m === 'string' ? mat(m) : m);
  b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  b.receiveShadow = false; b.castShadow = false;
  parent.add(b);
  return b;
}
function stick(parent, w, h, tex, x, y, z, rotY = 0) {
  const p = decalPlane(w, h, tex, { transparent: true });
  p.position.set(x, y, z); p.rotation.y = rotY;
  parent.add(p);
  return p;
}

const warnTex = () => canvasTex(128, 112, (g, w, h) => {
  g.fillStyle = '#f5c400'; g.strokeStyle = '#111'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w - 8, h - 8); g.lineTo(8, h - 8); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#111'; g.font = 'bold 60px Arial'; g.textAlign = 'center'; g.fillText('!', w / 2, h - 22);
});
const labelTex = (lines, bg = '#f2f2f2', fg = '#222') => canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8a000'; g.fillRect(0, 0, w, 26);
  g.fillStyle = '#111'; g.font = 'bold 18px Arial'; g.fillText('⚠ WARNING', 10, 19);
  g.fillStyle = fg; g.font = '15px Arial';
  lines.forEach((l, i) => g.fillText(l, 10, 50 + i * 20));
});

export function buildCabin() {
  const G = new THREE.Group(); G.name = 'cabin';
  const body = new THREE.Group(); G.add(body);       // her zaman (iç görünümde de) görünen gövde
  const front = new THREE.Group(); G.add(front);     // operatör tarafı: kapı, panel, ön kapaklar
  const F = FLOOR_Y;
  // ---- kaide ----
  slab(-1250, 790, F, F + 90, -470, 330, 'plinth', body, 6);
  for (const x of [-1180, -560, 120, 720]) for (const z of [-430, 290]) slab(x - 22, x + 22, F, F + 14, z - 22, z + 22, 'darkSteel', body, 3);
  // ---- sol kabin (başlık / elektrik) ----
  slab(-1250, -430, F + 90, 260, -480, 340, 'cabinet', body, 8);
  slab(-1250, -430, F + 90, 260, 340, 380, 'cabinet', front, 6);                     // ön kapak
  slab(-1180, -470, F + 140, F + 150, 380, 384, 'paintMid', front, 2);              // alt menfez çizgileri
  for (let k = 0; k < 6; k++) slab(-1120, -940, -520 + k * 16, -512 + k * 16, 380, 383, 'paintMid', front, 1);
  stick(front, 44, 38, warnTex(), -700, -200, 384.5);
  slab(-905, -895, -760, 160, 380, 383, 'paintMid', front, 1);                      // kapak ayrımı
  // ---- mavi kule + panel ----
  slab(-430, -70, F + 90, -320, -480, 340, 'cabinet', body, 6);
  slab(-430, -70, F + 90, -320, 340, 360, 'cabinet', front, 4);
  stick(front, 120, 60, labelTex(['Kapı açıkken çalıştırmayın', 'Do not operate with', 'door open']), -250, -420, 360.5);
  slab(-430, -70, -320, 720, -480, 300, 'starBlue', body, 10);
  slab(-430, -70, -320, 720, 300, 330, 'starBlue', front, 8);
  const logo = canvasTex(256, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.font = 'italic bold 78px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('star', w / 2 - 10, h / 2 + 4);
  });
  stick(front, 150, 56, logo, -250, 640, 330.6);
  for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(new THREE.CircleGeometry(5, 16), mat('white')); d.position.set(-275 + k * 25, 585, 330.6); front.add(d); }
  for (let k = 0; k < 2; k++) { const d = new THREE.Mesh(new THREE.CircleGeometry(5, 16), mat('white')); d.position.set(-262 + k * 25, 563, 330.6); front.add(d); }
  stick(front, 90, 46, labelTex(['Star Micronics', 'SB-20R type G']), -150, 120, 330.6);
  // FANUC 0i-TF paneli (sol önde, hafif eğik)
  const pan = new THREE.Group(); front.add(pan);
  pan.position.set(-500, 300, 380); pan.rotation.x = -0.06;
  slab(-160, 160, -190, 190, -40, 0, 'panel', pan, 8);
  slab(-150, 150, -180, 180, -2, 2, 'doorDark', pan, 4);
  const sc = document.createElement('canvas'); sc.width = 512; sc.height = 384;
  const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(196, 147), new THREE.MeshBasicMaterial({ map: stex, toneMapped: false }));
  screen.position.set(-28, 75, 2.5); pan.add(screen);
  const keys = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2c2f34'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      g.fillStyle = r < 1 ? '#5c6470' : (c > 3 ? '#e1e3e6' : '#cfd3d8');
      g.fillRect(10 + c * 41, 10 + r * 41, 34, 32);
    }
  });
  stick(pan, 96, 96, keys, 112, 75, 2.6);
  const keys2 = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#2c2f34'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 12; c++) { g.fillStyle = c % 4 === 0 ? '#e9ecef' : '#bfc4ca'; g.fillRect(8 + c * 42, 10 + r * 58, 34, 46); }
  });
  stick(pan, 290, 72, keys2, 0, -60, 2.6);
  const estop = new THREE.Mesh(new THREE.CylinderGeometry(17, 19, 16, 32), new THREE.MeshStandardMaterial({ color: 0xd11a1a, roughness: 0.4 }));
  estop.rotation.x = Math.PI / 2; estop.position.set(110, -150, 10); pan.add(estop);
  const ering = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 4, 32), new THREE.MeshStandardMaterial({ color: 0xf0c400, roughness: 0.5 }));
  ering.rotation.x = Math.PI / 2; ering.position.set(110, -150, 2); pan.add(ering);
  for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 6, 20), mat(k === 0 ? 'starBlue' : 'white')); b.rotation.x = Math.PI / 2; b.position.set(-130 + k * 34, -150, 4); pan.add(b); }
  slab(-40, 40, -260, -190, -40, -10, 'panel', pan, 4); // kol bağlantısı
  // ---- işleme bölmesi (kapı arkası) ----
  slab(-70, 590, -330, 470, -480, -450, 'paint', body, 4);                     // iç arka duvar
  slab(-70, 590, 440, 470, -480, 340, 'cabinet', body, 6);                     // tavan
  slab(560, 590, -330, 470, -480, 340, 'cabinet', body, 4);                    // sağ iç duvar
  slab(-70, 590, -360, -330, -480, 340, 'paintMid', body, 3);                  // talaş teknesi
  slab(-70, 590, F + 90, -360, -480, 330, 'doorDark', body, 6);                // alt gövde
  slab(-70, 590, F + 90, -360, 330, 360, 'doorDark', front, 4);
  slab(-70, 590, 440, 470, 340, 380, 'cabinet', front, 6);                     // ön üst kayıt
  slab(-70, -30, -360, 440, 340, 380, 'cabinet', front, 4);                    // sol dikme
  slab(520, 590, -360, 440, 340, 380, 'cabinet', front, 4);                    // sağ dikme
  // sürgülü kapı: koyu gri çerçeve + füme cam + "SB-20R type G" yazısı
  const door = new THREE.Group(); front.add(door);
  const dz0 = 384, dz1 = 400;
  slab(-40, 430, -350, -170, dz0, dz1, 'door', door, 4);                       // kapı alt dolu kısmı
  slab(-40, 430, 330, 420, dz0, dz1, 'door', door, 4);                         // üst kayıt
  slab(-40, -10, -170, 330, dz0, dz1, 'door', door, 3);
  slab(400, 430, -170, 330, dz0, dz1, 'door', door, 3);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(410, 500), mat('tinted'));
  glass.position.set(195, 80, 392); glass.renderOrder = 5; door.add(glass);
  const name = canvasTex(512, 96, (g, w, h) => {
    g.fillStyle = '#2b2f36'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f4f6'; g.font = 'italic bold 60px Arial'; g.textBaseline = 'middle';
    g.fillText('SB-20R', 20, h / 2 + 3);
    g.font = 'italic 40px Arial'; g.fillText('type G', 300, h / 2 + 8);
  });
  stick(door, 220, 42, name, 120, -215, dz1 + 0.6);
  slab(300, 410, -300, -280, dz1, dz1 + 8, 'chrome', door, 3);                // kapı kolu
  stick(door, 34, 30, warnTex(), 30, -290, dz1 + 0.6);
  // kapının sağındaki sabit kapak
  slab(430, 520, -360, 440, 350, 380, 'door', front, 4);
  // ---- sağ uç: parça çıkış / konveyör ----
  slab(590, 790, F + 90, 300, -480, 300, 'cabinet', body, 8);
  slab(590, 790, F + 90, 300, 300, 330, 'cabinet', front, 6);
  slab(610, 770, -230, -80, 330, 430, 'plinth', front, 6);                     // parça kutusu
  slab(620, 760, -90, -70, 330, 440, 'chrome', front, 2);
  slab(600, 780, 300, 320, -480, 300, 'paintMid', body, 3);
  stick(front, 40, 34, warnTex(), 690, 120, 330.6);

  // ---- panel ekranı ----
  const g = sc.getContext('2d');
  let last = '';
  const draw = (rows) => {
    const key = JSON.stringify(rows);
    if (key === last) return;
    last = key;
    g.fillStyle = '#0b1a3a'; g.fillRect(0, 0, 512, 384);
    g.fillStyle = '#1e3a8a'; g.fillRect(0, 0, 512, 34);
    g.fillStyle = '#ffffff'; g.font = 'bold 20px Consolas, monospace';
    g.fillText('POSITION (ABSOLUTE)   O1000', 10, 24);
    g.font = 'bold 30px Consolas, monospace';
    rows.axes.forEach((r, i) => {
      const y = 76 + i * 38;
      g.fillStyle = '#9cc3ff'; g.fillText(r[0].padEnd(3), 18, y);
      g.fillStyle = '#ffffff'; g.fillText(r[1].padStart(10), 90, y);
      g.fillStyle = '#ffd166'; g.font = 'bold 22px Consolas, monospace'; g.fillText(r[2] || '', 330, y); g.font = 'bold 30px Consolas, monospace';
    });
    g.fillStyle = '#1e3a8a'; g.fillRect(0, 344, 512, 40);
    g.fillStyle = '#e7edf7'; g.font = '19px Consolas, monospace';
    g.fillText((rows.foot || '').slice(0, 44), 10, 370);
    stex.needsUpdate = true;
  };
  draw({ axes: [], foot: '' });
  return { group: G, body, front, drawScreen: draw };
}
