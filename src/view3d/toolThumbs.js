// Takım kartı kapak görseli: takımın 3D modeli (ucu ön planda) tek bir ekran dışı çizicide PNG'ye çizilir, önbelleğe alınır.
import * as THREE from 'three';
import { createToolMesh } from './toolMeshes.js';

let R = null, scene = null, cam = null;
const cache = new Map();   // v2: önden görünüm
const SIZE = 220;

function setup() {
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setPixelRatio(1); R.setSize(SIZE, SIZE); R.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  cam = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
  const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(0.4, 0.6, 1); cam.add(key); scene.add(cam);
}

const keyOf = (t) => JSON.stringify([t.type, t.unit, t.dia, t.width, t.noseR, t.insertShape, t.insertSize, t.tipAngle, t.flutes, t.pitch, t.length, t.live, !!t.model]);

/** dataURL (PNG) — takım değişmedikçe önbellekten */
export function toolThumb(t) {
  const k = keyOf(t);
  if (cache.has(k)) return cache.get(k);
  try {
    if (!R) setup();
    const g = createToolMesh(t);
    // takımın kesen ucu altta (y=0), gövde +y: yalnız uç bölgesi çerçevelenir
    const lm = new THREE.LineBasicMaterial({ color: 0x141a21, transparent: true, opacity: 0.8 });
    g.traverse(o => { if (o.isMesh && !o.material.transparent) o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), lm)); });
    scene.add(g);
    const bb = new THREE.Box3().setFromObject(g);
    const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 8);
    const y0 = bb.min.y, y1 = Math.min(bb.max.y, y0 + Math.max(42, span * 2.6));   // uç + tutucu başı + sapın başı
    const c = new THREE.Vector3((bb.min.x + bb.max.x) / 2, (y0 + y1) / 2, (bb.min.z + bb.max.z) / 2);
    const H = Math.max(y1 - y0, span) * 1.08;
    const dist = H / (2 * Math.tan((cam.fov * Math.PI / 180) / 2)) * 1.15;
    // tam önden (operatör tarafı, +z): kater ve elmasın yüzü görünür, uç aşağıda; hafif açı derinlik verir
    cam.position.set(c.x + dist * 0.12, c.y + dist * 0.08, c.z + dist);
    cam.lookAt(c);
    R.render(scene, cam);
    const url = R.domElement.toDataURL('image/png');
    scene.remove(g);
    g.traverse(o => { o.geometry?.dispose?.(); });
    cache.set(k, url);
    return url;
  } catch (e) {
    console.warn('takım görseli', e);
    return '';
  }
}
