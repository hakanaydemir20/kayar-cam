import * as THREE from 'three';

const M = {};
export function mat(name) {
  if (M[name]) return M[name];
  const P = {
    steel:     { color: 0x9aa1aa, metalness: 0.9, roughness: 0.32 },
    darkSteel: { color: 0x4b5058, metalness: 0.85, roughness: 0.4 },
    blackOx:   { color: 0x23262b, metalness: 0.7, roughness: 0.45 },
    carbide:   { color: 0x3a3c41, metalness: 0.75, roughness: 0.38 },
    tin:       { color: 0xcfa53a, metalness: 0.9, roughness: 0.28 },
    tialn:     { color: 0x5a4e6e, metalness: 0.85, roughness: 0.3 },
    hss:       { color: 0xc3c8cf, metalness: 1.0, roughness: 0.22 },
    chrome:    { color: 0xdfe3e8, metalness: 1.0, roughness: 0.12 },
    casting:   { color: 0xb9bfc6, metalness: 0.2, roughness: 0.7 },
    castDark:  { color: 0x3b4048, metalness: 0.3, roughness: 0.6 },
    accent:    { color: 0x1d5fa8, metalness: 0.3, roughness: 0.45 },
    rubber:    { color: 0x16181b, metalness: 0.0, roughness: 0.9 },
    coolant:   { color: 0x2c64b0, metalness: 0.2, roughness: 0.45 },
    stock:     { color: 0xc9cdd3, metalness: 0.95, roughness: 0.26 },
    stockCut:  { color: 0xe6e9ed, metalness: 1.0, roughness: 0.15 },
    glass:     { color: 0x9fc6e6, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.12 },
    // Star SB-20R Type G boya renkleri (ürün fotoğrafından)
    paint:     { color: 0xd3d7dc, metalness: 0.05, roughness: 0.55 },   // iç döküm açık gri
    paintMid:  { color: 0x9aa0a8, metalness: 0.1, roughness: 0.5 },
    white:     { color: 0xeef0f2, metalness: 0.05, roughness: 0.42 },   // karşı iş mili gövdesi
    starBlue:  { color: 0x1f3c9c, metalness: 0.15, roughness: 0.42 },   // Star mavisi
    navy:      { color: 0x2a3550, metalness: 0.2, roughness: 0.4 },
    cabinet:   { color: 0xe4e6e9, metalness: 0.05, roughness: 0.5 },    // dış kabin
    door:      { color: 0x8a9099, metalness: 0.2, roughness: 0.45 },
    doorDark:  { color: 0x4a4f57, metalness: 0.2, roughness: 0.5 },
    plinth:    { color: 0x1c1e22, metalness: 0.2, roughness: 0.7 },
    panel:     { color: 0x2b2e33, metalness: 0.3, roughness: 0.5 },
    locline:   { color: 0xff7417, metalness: 0.0, roughness: 0.45 },   // turuncu boğumlu soğutma hortumu
    locBlue:   { color: 0x2f7fd6, metalness: 0.0, roughness: 0.45 },
    arrow:     { color: 0xe01e2a, metalness: 0.0, roughness: 0.5, emissive: 0x5a0508 },
    tinted:    { color: 0x2c3a4a, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false },
  }[name];
  // CAM grafiği (Mastercam benzeri): parlama ve yansıma yok, mat gölgelendirme
  const matte = { ...P, metalness: 0, roughness: Math.max(P.roughness, 0.9) };   // SolidWorks gibi: yansımasız, parlamasız
  M[name] = new THREE.MeshStandardMaterial({ ...matte, side: P.transparent ? THREE.DoubleSide : THREE.FrontSide });
  return M[name];
}
