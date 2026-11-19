// Boundary segments of a STEP face's triangulation. Internal triangle edges are excluded.
export function faceBoundary(mesh, id) {
  const face = mesh.faces?.[id];
  if (!face) return [];
  const edges = new Map();
  for (let t = face.tri0; t <= face.tri1; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[3 * t + k], b = mesh.indices[3 * t + (k + 1) % 3];
      const vertices = a < b ? [a, b] : [b, a];
      const key = vertices.join(':');
      if (edges.has(key)) edges.get(key).count++;
      else edges.set(key, { key, vertices, count: 1 });
    }
  }
  return [...edges.values()].filter(edge => edge.count === 1);
}

export function backMillType(feature) {
  if (feature?.side !== 'back') return null;
  if (feature.type === 'faceSlot') return 'backSlot';
  if (feature.type === 'facePolygon') return 'backPolar';
  return null;
}

export function simMillTools(tools, channel, feature) {
  return tools.filter(t => {
    if (t.channel !== channel || t.type !== 'endmill' || !Number.isFinite(t.dia) || t.dia <= 0) return false;
    if (channel === 1) return t.unit === 'cross' && t.live !== false;
    if (channel !== 2 || t.unit !== 'back' || !t.live) return false;
    return feature?.type !== 'faceSlot' || Math.abs(t.dia - feature.width) < 1e-6;
  });
}
