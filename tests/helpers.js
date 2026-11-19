// Test yardımcıları: varsayılan post profili atölye (kayar); Star yazımına özgü testler Star profiliyle kurulur.
import { newProject, autoOperations, postProfile } from '../src/project.js';

/** Star SB-20R (katalog) profilli proje */
export function newStarProject(...a) {
  const p = newProject(...a);
  p.post = postProfile('star');
  p.ops = autoOperations(p);
  return p;
}
/** Profil anahtarına göre proje: 'star' | 'kayar' */
export const projectFor = (key, ...a) => (key === 'star' ? newStarProject(...a) : newProject(...a));
