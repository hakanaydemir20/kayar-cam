// STEP okuma (OpenCascade WASM — occt-import-js). Tarayıcıda ve Node'da çalışır.
let occtPromise = null;

/** wasmBinary (Uint8Array) verilirse ağ erişimi gerekmez */
export function loadOcct(factory, wasmBinary) {
  if (!occtPromise) occtPromise = factory(wasmBinary ? { wasmBinary } : {});
  return occtPromise;
}

/**
 * STEP içeriğini tek bir üçgen ağına çevirir; her üçgen için brep yüz kimliği tutulur.
 * @returns {{positions: Float32Array, normals: Float32Array, indices: Uint32Array, faceOf: Int32Array, faces: Array<{tri0:number, tri1:number}>, name: string}}
 */
export function readStep(occt, bytes, deflection = 0.004) {
  const res = occt.ReadStepFile(bytes, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: deflection,
    angularDeflection: 0.1,
  });
  if (!res || !res.success) throw new Error('STEP dosyası okunamadı');
  if (!res.meshes.length) throw new Error('STEP dosyasında katı model bulunamadı');
  let nv = 0, nt = 0;
  for (const m of res.meshes) { nv += m.attributes.position.array.length / 3; nt += m.index.array.length / 3; }
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), indices = new Uint32Array(nt * 3), faceOf = new Int32Array(nt);
  const faces = [];
  let vo = 0, to = 0;
  for (const m of res.meshes) {
    const P = m.attributes.position.array, N = m.attributes.normal ? m.attributes.normal.array : null, I = m.index.array;
    positions.set(P, vo * 3);
    if (N) normals.set(N, vo * 3);
    for (let k = 0; k < I.length; k++) indices[to * 3 + k] = I[k] + vo;
    const brep = m.brep_faces && m.brep_faces.length ? m.brep_faces : [{ first: 0, last: I.length / 3 - 1 }];
    for (const f of brep) {
      const fid = faces.length;
      faces.push({ tri0: to + f.first, tri1: to + f.last });
      for (let t = f.first; t <= f.last; t++) faceOf[to + t] = fid;
    }
    vo += P.length / 3; to += I.length / 3;
  }
  if (!res.meshes[0].attributes.normal) computeNormals(positions, indices, normals);
  return { positions, normals, indices, faceOf, faces, name: res.root?.name || res.meshes[0].name || 'STEP' };
}

function computeNormals(P, I, N) {
  N.fill(0);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
}
