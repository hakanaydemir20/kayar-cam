// Örnek parça kütüphanesi: kayar otomatta tipik 5 parça (profil tablosu + özellikler) ve STEP örneği.
// Z ön alından (0) arkaya; satırlar: {dia, len, endDia?, ch?, rad?} — ch/rad satırın başındaki dış köşe.
import { makePart, profileFromTable, examplePart } from '../part/part.js';

const part = (name, rows, features) => makePart({ name, profile: profileFromTable(rows), features: features.map((f, i) => ({ id: 's' + (i + 1), ...f })), rows });

export const SAMPLE_PARTS = [
  {
    id: 'pin', name: 'Örnek Pim', desc: 'Dış çap, M10 diş, ön delik, çapraz delik, düzlük, arka delik',
    tags: ['Diş', 'Çapraz delik', 'Düzlük', 'Arka işleme'], make: examplePart,
  },
  {
    id: 'fitting', name: 'Hidrolik Rakor', desc: 'M12×1.5 diş, diş boşaltma kanalı, 14 anahtar altıgen, boydan Ø6 delik',
    tags: ['Diş', 'Altıgen', 'Boydan delik'],
    make: () => part('Hidrolik Rakor', [
      { dia: 12, len: 12, ch: 0.8 },
      { dia: 10.2, len: 2 },
      { dia: 16, len: 10, ch: 0.5 },
      { dia: 13, len: 4, ch: 0.5 },
    ], [
      { type: 'thread', z0: 0, z1: 11, dia: 12, pitch: 1.5 },
      { type: 'axialHole', side: 'front', dia: 6, depth: 28, through: true },
      { type: 'polygon', n: 6, af: 14, z0: 14.5, z1: 23.5, c: 0 },
    ]),
  },
  {
    id: 'contact', name: 'Kontak Pimi', desc: 'Ø5 çubuktan ince pim: kanal, Ø1 kontrol deliği, arkadan Ø1.5 krimp deliği',
    tags: ['Küçük çap', 'Kanal', 'Çapraz delik', 'Arka delik'],
    make: () => part('Kontak Pimi', [
      { dia: 2, len: 3, ch: 0.2 },
      { dia: 3, len: 6, ch: 0.2 },
      { dia: 2.2, len: 1.2 },
      { dia: 3, len: 2 },
      { dia: 5, len: 5.8, ch: 0.3 },
    ], [
      { type: 'crossHole', dia: 1, z: 15.5, c: 0, through: true },
      { type: 'axialHole', side: 'back', dia: 1.5, depth: 4 },
    ]),
  },
  {
    id: 'shaft', name: 'Anahtar Ağızlı Mil', desc: 'M8 diş, iki karşılıklı düzlük (anahtar ağzı 9), Ø4 çapraz delik, ön punta deliği',
    tags: ['Diş', 'İki düzlük', 'Çapraz delik'],
    make: () => part('Anahtar Ağızlı Mil', [
      { dia: 8, len: 12, ch: 0.5 },
      { dia: 6.8, len: 1.5 },
      { dia: 12, len: 14, ch: 0.3 },
      { dia: 10, len: 12.5, ch: 0.5 },
    ], [
      { type: 'thread', z0: 0, z1: 11, dia: 8, pitch: 1.25 },
      { type: 'flat', c: 0, depth: 1.5, z0: 15, z1: 25 },
      { type: 'flat', c: 180, depth: 1.5, z0: 15, z1: 25 },
      { type: 'crossHole', dia: 4, z: 34, c: 90, through: true },
      { type: 'axialHole', side: 'front', dia: 2.5, depth: 6 },
    ]),
  },
  {
    id: 'bushing', name: 'Flanşlı Burç', desc: 'Ø18 flanş, segman kanalı, boydan Ø8 delik, Ø3 yağlama deliği',
    tags: ['Flanş', 'Segman kanalı', 'Boydan delik', 'Çapraz delik'],
    make: () => part('Flanşlı Burç', [
      { dia: 18, len: 3, ch: 0.5 },
      { dia: 14, len: 4 },
      { dia: 12.5, len: 1.5 },
      { dia: 14, len: 11.5, ch: 0.5 },
    ], [
      { type: 'axialHole', side: 'front', dia: 8, depth: 20, through: true },
      { type: 'crossHole', dia: 3, z: 14, c: 0, through: true },
    ]),
  },
  {
    id: 'screw', name: 'Ayar Vidası', desc: 'Konik uç, M10×1 diş, 13 anahtar altıgen baş, arkada Ø4 delik',
    tags: ['Konik uç', 'Diş', 'Altıgen', 'Arka delik'],
    make: () => part('Ayar Vidası', [
      { dia: 4, endDia: 10, len: 3 },
      { dia: 10, len: 17 },
      { dia: 8.4, len: 1.5 },
      { dia: 15, len: 8.5, ch: 0.5 },
    ], [
      { type: 'thread', z0: 3, z1: 19, dia: 10, pitch: 1 },
      { type: 'polygon', n: 6, af: 13, z0: 22, z1: 29.5, c: 0 },
      { type: 'axialHole', side: 'back', dia: 4, depth: 6 },
    ]),
  },
];
