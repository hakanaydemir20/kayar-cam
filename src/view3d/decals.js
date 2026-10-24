// Tuval (canvas) dokuları: takım numarası şeritleri, eksen etiketleri, kapı yazısı, panel ekranı.
import * as THREE from 'three';

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Düz yüzey üzerine yapıştırılan etiket (düzlem, +z normal) */
export function decalPlane(w, h, tex, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: !!opts.transparent, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  return p;
}

/** Takım numarası şeridi: nums soldan sağa (ekranda) */
export function numberStrip(nums, wPx = 64 * nums.length, hPx = 64, opts = {}) {
  return canvasTex(wPx, hPx, (g, w, h) => {
    g.fillStyle = opts.bg || '#d9dce0'; g.fillRect(0, 0, w, h);
    g.fillStyle = opts.fg || '#1d2a6b';
    g.font = `bold ${Math.round(h * 0.62)}px Arial`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const step = w / nums.length;
    nums.forEach((n, i) => {
      const x = step * (i + 0.5);
      if (opts.circleFirst && i === 0) { g.beginPath(); g.arc(x, h / 2, h * 0.36, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = g.fillStyle; g.stroke(); }
      g.fillText(String(n), x, h / 2 + 2);
    });
  });
}

/** Çapraz blok etiketi: +X1 / −Y1 ✚ +Y1 / −X1 ve takım numaraları (Star makinesindeki gibi) */
export function crossBlockTex(nums) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e3e5e8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d2232a'; g.strokeStyle = '#d2232a';
    const cx = 92, cy = 70;
    g.lineWidth = 9;
    g.beginPath(); g.moveTo(cx - 34, cy); g.lineTo(cx + 34, cy); g.moveTo(cx, cy - 34); g.lineTo(cx, cy + 34); g.stroke();
    const tri = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -9); g.lineTo(-6, 9); g.closePath(); g.fill(); g.restore(); };
    tri(cx + 40, cy, 0); tri(cx - 40, cy, Math.PI); tri(cx, cy - 40, -Math.PI / 2); tri(cx, cy + 40, Math.PI / 2);
    g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('+X1', cx, cy - 60); g.fillText('−X1', cx, cy + 60);
    g.textAlign = 'right'; g.fillText('−Y1', cx - 50, cy);
    g.textAlign = 'left'; g.fillText('+Y1', cx + 50, cy);
    g.fillStyle = '#d2232a'; g.font = 'bold 26px Arial'; g.textAlign = 'center';
    nums.forEach((n, i) => g.fillText(String(n), 212, 36 + i * 58));
  });
}

/** Ekrana dönük sabit boyutlu etiket (sprite). update(text) ile yeniden çizilir. */
export function labelSprite(opts = {}) {
  const W = 256, H = 96;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false, transparent: true, sizeAttenuation: false }); // kabin/gövde arkasında kalan etiket gizlenir
  const s = new THREE.Sprite(m);
  s.renderOrder = 20;
  const px = opts.px || 0.032; // sizeAttenuation=false: görünüm yüksekliğinin ~%4'ü
  s.scale.set(px * W / H, px, 1);
  s.center.set(opts.cx ?? 0, opts.cy ?? 0.5);
  let last = null;
  s.userData.update = (name, value) => {
    const key = name + '|' + value;
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, W, H);
    // daire içinde eksen adı (Star kataloğundaki gibi)
    g.fillStyle = '#ffffff'; g.strokeStyle = '#111'; g.lineWidth = 5;
    g.beginPath(); g.arc(H / 2, H / 2, H / 2 - 5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = `bold ${name.length > 2 ? 30 : 38}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, H / 2, H / 2 + 2);
    if (value != null && value !== '') {
      g.fillStyle = 'rgba(12,14,18,.82)';
      const x0 = H - 2;
      g.beginPath(); g.roundRect(x0, 18, W - x0 - 4, H - 36, 10); g.fill();
      g.fillStyle = opts.valueColor || '#ffd166'; g.font = 'bold 34px Consolas, monospace'; g.textAlign = 'right';
      g.fillText(value, W - 14, H / 2 + 2);
    }
    tex.needsUpdate = true;
  };
  s.userData.update(opts.name || '', opts.value ?? '');
  return s;
}
