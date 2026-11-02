// Makine iç yapısı: kullanıcının makine çizimi (src/assets/machine/sb20r_g_zone.glb, “makine çizimi/” klasöründen).
// Çizimin ünite ölçekleri birbirini tutmadığı için (gang adımı 70 mm, çapraz/arka tutucular gerçek boyutta) her ünite
// kendi ölçeğiyle, simülasyonun kinematik çerçevesine (takım ucu orijinde, eksenler machineMesh/frames ile aynı) yerleştirilir.
// Çizimdeki örnek takımlar gizlenir; takımlar takım listesinden çizilir, her tutucu kendi takımının konumuna kopyalanır.
// Çizim çerçevesi (metre): x yanal (Y1), y yukarı (X1), z eksenel (karşı iş miline doğru). Dünya: x eksenel, y yukarı, z yanal.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import glbUrl from '../assets/machine/sb20r_g_zone.glb?url';
import { rotaryProfile, FRONT_BLOCK_X } from '../tools/toolGeom.js';
import { LAYOUT } from '../sim/frames.js';

let SRC = null, pending = null;
const listeners = new Set();
/** Yüklüyse çizim sahnesi (yoksa null; yüklenince onMachineGlb dinleyicileri çağrılır) */
export function machineGlb() {
  if (!SRC && !pending) {
    pending = fetch(glbUrl).then(r => r.arrayBuffer()).then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej)))
      .then(g => { SRC = prepare(g.scene); for (const f of listeners) f(); })
      .catch(e => { console.warn('makine çizimi yüklenemedi', e); });
  }
  return SRC;
}
export function onMachineGlb(f) { listeners.add(f); return () => listeners.delete(f); }

// çizim → dünya dönüşü: (x, y, z) → (z, y, −x)
const ROT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
const toW = (v) => new THREE.Vector3(v.z, v.y, -v.x);   // çizim (m) → dünya yönü (birim aynı)

/** Sahneyi hazırla: makine düğümünün dönüşünü kaldır (çizim yerel çerçevesi), mat malzemeler, ad dizini */
function prepare(scene) {
  const machine = scene.getObjectByName('machine');
  machine.matrix.identity(); machine.matrix.decompose(machine.position, machine.quaternion, machine.scale);
  machine.updateMatrixWorld(true);
  const mats = new Map();
  machine.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!mats.has(m)) {
      // CAM grafiği gibi: yansımasız mat malzeme, aynı renk
      mats.set(m, new THREE.MeshStandardMaterial({ color: m.color.clone(), metalness: 0, roughness: 0.88, transparent: m.transparent, opacity: m.opacity }));
    }
    o.material = mats.get(m);
    o.castShadow = true; o.receiveShadow = true;
  });
  return machine;
}
const byName = (name) => SRC.getObjectByName(name);
/** Düğümün çizim yerel çerçevesindeki kutusu (m) */
const boxOf = (o) => new THREE.Box3().setFromObject(o);

/**
 * Düğümü kopyala ve yerleştir: çizimdeki A noktası (m) dünyada P noktasına (mm) gelir, ölçek k (çizim mm → dünya mm).
 * hide: gizlenecek alt düğüm adları için düzenli ifade (çizimdeki örnek takımlar).
 */
function place(node, k, A, P, hide = null) {
  const outer = new THREE.Group();
  const inner = new THREE.Group(); inner.quaternion.copy(ROT); outer.add(inner);
  const c = node.clone(true);
  // düğümün çizim yerel dönüşümü (makine düğümüne göre): üst düğümler kimlik, kendi matrisi korunur
  c.matrix.copy(node.matrixWorld); c.matrix.decompose(c.position, c.quaternion, c.scale);
  inner.add(c);
  if (hide) c.traverse(o => { if (hide.test(o.name)) o.visible = false; });
  outer.scale.setScalar(k * 1000);
  outer.position.copy(P).sub(toW(A).multiplyScalar(k * 1000));
  outer.userData.glb = true;
  return outer;
}
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

const TOOL_MESH = /(_insert|_turning_shank|_drill|_endmill)$/;

/** Makine iç yapısı ünitelerini kur. Dönen gruplar machineMesh tarafından ilgili eksen gruplarına eklenir. */
export function buildGlbMachine(P, { ngb }) {
  if (!SRC) return null;
  const out = { gang: [], head: [], headRot: [], sub: [], subRot: [], x2: [], fixed: [], back: [], stations: [] };
  const tools = P.tools;
  // ---- gang (X1/Y1): gang plakası, numara şeridi ve taşıyıcı çizimdeki ölçekte (adım 70 → 18 mm)
  const kG = 18 / 70;
  const h1 = boxOf(byName('T01_holder'));
  // T01 tutucusunun alt orta noktası → T01 bağlama bloğunun altı (y 38), yanal T01 konumu
  const turn = tools.filter(t => t.unit === 'gang').sort((a, b) => b.yPos - a.yPos);
  const zT01 = turn[0]?.yPos ?? 110;
  const aG = v3((h1.min.x + h1.max.x) / 2, h1.min.y, (h1.min.z + h1.max.z) / 2);
  const carrier = place(byName('MAIN_TOOL_CARRIER'), kG, aG, v3(8.5, 38, zT01), /^station_T0\d$/);
  out.gang.push(carrier);
  const asm = place(byName('X1_Y1_TOOL_ASSEMBLY'), kG, aG, v3(8.5, 38, zT01), /^(cross_drill_T3\d|milling_unit_T3\d|front_drill_unit_T35)$/);
  out.gang.push(asm);
  // tornalama tutucuları: her gang takımına çizimdeki T01 tutucusu (sap ve uç gizli)
  const st1 = byName('station_T01');
  for (const t of tools.filter(t => t.unit === 'gang')) {
    const s = place(st1, kG, aG, v3(8.5, 38 + (t.xPos || 0), t.yPos), TOOL_MESH);
    s.userData.holder = true; out.gang.push(s); out.stations.push(s);
  }
  // çapraz tahrikli: matkap için T31, freze için T33 gövdesi; gövdenin altı takımın tahrikli iş mili üstüne (y 52)
  for (const t of tools.filter(t => t.unit === 'cross')) {
    const src = byName(t.type === 'endmill' ? 'milling_unit_T33' : 'cross_drill_T31');
    const body = boxOf(src.children.find(o => /_body$/.test(o.name)));
    const a = v3((body.min.x + body.max.x) / 2, body.min.y, (body.min.z + body.max.z) / 2);
    const s = place(src, 1, a, v3(0, 52 + (t.xPos || 0), t.yPos), /(_drill|_endmill|_spindle)$/);
    s.userData.holder = true; out.gang.push(s); out.stations.push(s);
  }
  // ön delme kolonu T35: kat adımı 50 → 25 mm (ölçek 0.5); 1. katın ön burcu → kolon bloğu önü (x = FRONT_BLOCK_X)
  const front = tools.filter(t => t.unit === 'front');
  if (front.length) {
    const b1 = boxOf(byName('T35-1_front_boss'));
    const top = Math.max(...front.map(t => t.xPos || 0));
    const a = v3((b1.min.x + b1.max.x) / 2, (b1.min.y + b1.max.y) / 2, b1.min.z);
    for (const zc of [...new Set(front.map(t => t.yPos))]) {
      const s = place(byName('front_drill_unit_T35'), 0.5, a, v3(FRONT_BLOCK_X, top, zc), /_drill$/);
      s.userData.holder = true; out.gang.push(s); out.stations.push(s);
    }
  }
  // ---- ana iş mili (Z1 başlığı, C1): pens ölçeği somun Ø112 → Ø31; pens alnı başlık yerel x = 0
  const kM = 15.3 / 56;
  const col = boxOf(byName('collet'));
  const aM = v3(0, 0, col.max.z);
  out.head.push(place(byName('spindle_support_wall'), kM, aM, v3(0, 0, 0)));
  out.head.push(place(byName('spindle_housing_square'), kM, aM, v3(0, 0, 0)));
  out.headRot.push(place(byName('C1_rotor'), kM, aM, v3(0, 0, 0), /^workpiece_bar$/));
  // ---- karşı iş mili (X2/Z2, C2): somun Ø110 → Ø30; pens alnı karşı iş mili yerel x = 0
  const kS = 15 / 55;
  const sc = boxOf(byName('sub_collet'));
  const aS = v3(0, 0, sc.min.z);
  const subNode = byName('SUB_SPINDLE_C2');
  out.sub.push(place(subNode, kS, aS, v3(0, 0, 0), /^C2_rotor$/));
  out.subRot.push(place(byName('C2_rotor'), kS, aS, v3(0, 0, 0)));
  // X2/Z2 kızağı: taban ve X2 rayları sabit (çizimdeki konumunda), X2 sürgüsü yalnız X2 ile yanal hareket eder
  // referans: çizimdeki kesme düzlemi (uç merkezi z = 8 mm) dünyada x = 0
  const aC = v3(0, 0, 0.008);
  const car = byName('X2_Z2_CARRIAGE');
  out.fixed.push(place(car, kS, aC, v3(0, 0, 0), /^X2_slide$/));
  out.x2.push(place(byName('X2_slide'), kS, aC, v3(0, 0, 0)));
  // ---- arka ünite (sabit): tutucu adımı 55 → 30 mm (ölçek 0.55); blok ve plaka T21'e, tutucular her arka takıma
  const back = tools.filter(t => t.unit === 'back' || t.unit === 'rear').sort((a, b) => a.yPos - b.yPos);
  if (back.length) {
    const kR = 0.55;
    const nut = boxOf(byName('T21_ER_collet_nut'));
    const aR = v3((nut.min.x + nut.max.x) / 2, (nut.min.y + nut.max.y) / 2, nut.max.z);
    // takımın arka ucu (somun önü): döner takımda profil boyu, tornalama katerinde sap boyu
    const tail = (t) => (t.type === 'turn' ? 95 : rotaryProfile(t).length);
    const t0 = back[0];
    const plate = place(byName('REAR_TOOL_ASSEMBLY'), kR, aR, v3(LAYOUT.backToolX - tail(t0), 0, LAYOUT.backLat + t0.yPos), /^(rear_holder_T2\d|rear_mount_block)$/);   // montaj bloğu çizimde eksenin altında: tutucular eksen yüksekliğine alınınca gang bölgesine taşar
    out.back.push(plate);
    const h0 = byName('rear_holder_T21');
    for (const t of back) {
      const s = place(h0, kR, aR, v3(LAYOUT.backToolX - tail(t), 0, LAYOUT.backLat + t.yPos), /(_drill|_ER_collet_nut)$/);
      s.userData.holder = true; out.back.push(s); out.stations.push(s);
    }
  }
  return out;
}
