// STEP akışı (tarayıcı): OpenCascade WASM yükle, oku, bağla, hayalet model üret.
import * as THREE from 'three';
import occtFactory from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import { readStep } from '../cad/stepImport.js';
import { partFromModel, toPart } from '../cad/featureRecog.js';

let occtP = null;
function getOcct() {
  if (!occtP) {
    occtP = (async () => {
      const res = await fetch(wasmUrl);
      const buf = new Uint8Array(await res.arrayBuffer());
      return occtFactory({ wasmBinary: buf });
    })();
  }
  return occtP;
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

/** file: File veya null (b64 verilir). opts: {flip, axisFaceId} */
export async function importStepFile(file, b64 = null, opts = {}) {
  const bytes = file ? new Uint8Array(await file.arrayBuffer()) : fromB64(b64);
  const occt = await getOcct();
  const model = readStep(occt, bytes);
  const name = file ? file.name.replace(/\.(stp|step)$/i, '') : undefined;
  const res = { model, b64: b64 || toB64(bytes), name };
  return refixture(res, opts);
}

/** Aynı model için bağlamayı yeniden hesapla */
export function refixture(res, opts = {}) {
  const { part } = partFromModel(res.model, { name: res.name, flip: opts.flip, axisFaceId: opts.axisFaceId });
  part.mesh = res.model;
  part.flip = !!opts.flip;
  part.axisFaceId = opts.axisFaceId ?? null;
  return { ...res, part, flip: !!opts.flip, axisFaceId: opts.axisFaceId ?? null };
}

const ghostMat = () => new THREE.MeshStandardMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.16, depthWrite: false, metalness: 0, roughness: 0.6, side: THREE.DoubleSide });

/** Hedef model: parça çerçevesinde (x = −d, y = a, z = b) */
export function ghostFromMesh(part) {
  const { mesh: m, fixture: fx } = part;
  const P = m.positions;
  const pos = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const q = toPart(fx, [P[i], P[i + 1], P[i + 2]]);
    pos[i] = -q[0]; pos[i + 1] = q[1]; pos[i + 2] = q[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  const grp = new THREE.Group();
  const mesh = new THREE.Mesh(g, ghostMat());
  mesh.renderOrder = 3;
  grp.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.45 }));
  grp.add(edges);
  return grp;
}

export function ghostFromProfile(part) {
  const pts = part.profile.map(p => new THREE.Vector2(Math.max(0, p.r), -p.z));
  const g = new THREE.LatheGeometry(pts, 96);
  g.rotateZ(-Math.PI / 2);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, ghostMat()));
  return grp;
}

/** Takım STEP modeli: dosya veya base64 → { b64, positions, indices } */
export async function loadToolModel(file, b64 = null) {
  const bytes = file ? new Uint8Array(await file.arrayBuffer()) : fromB64(b64);
  const occt = await getOcct();
  const model = readStep(occt, bytes, 0.02);
  return { b64: b64 || toB64(bytes), positions: model.positions, indices: model.indices };
}
