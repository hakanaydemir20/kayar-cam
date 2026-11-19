const numericKeys = {
  rough: ['ap', 'feed', 'vc'],
  finish: ['feed', 'vc'],
};

// Öneriler mevcut CAM sınırlarını aşamaz. Kullanıcı girdileri önceliklidir.
export function acceptAdvice(mode, baseline, response) {
  const settings = {};
  for (const key of numericKeys[mode] || []) {
    const value = response?.settings?.[key], limit = baseline[key];
    if (Number.isFinite(value) && Number.isFinite(limit) && value >= Math.min(limit, key === 'vc' ? 1 : 0.001) && value <= limit) settings[key] = value;
  }
  const strategy = response?.settings?.strategy;
  if (mode === 'rough' && ['z', 'profile', 'face'].includes(strategy)) settings.strategy = strategy;
  return { settings, notes: Array.isArray(response?.notes) ? response.notes.filter(n => typeof n === 'string').slice(0, 5).map(n => n.slice(0, 500)) : [] };
}
import { toPart } from '../cad/featureRecog.js';

export function summarizeFaces(part, ids) {
  const mesh = part.mesh;
  if (!mesh?.faces || !part.fixture) return [];
  return ids.flatMap(id => {
    const face = mesh.faces[id];
    if (!face) return [];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const count = face.tri1 - face.tri0 + 1;
    const step = Math.max(1, Math.ceil(count / 250));
    for (let t = face.tri0; t <= face.tri1; t += step) {
      for (let k = 0; k < 3; k++) {
        const i = 3 * mesh.indices[3 * t + k];
        const point = toPart(part.fixture, mesh.positions.subarray(i, i + 3));
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], point[a]);
          max[a] = Math.max(max[a], point[a]);
        }
      }
    }
    return [{ id, triangles: count, sampled: step > 1, min, max }];
  });
}

