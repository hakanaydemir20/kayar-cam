// Bitmiş parça görünümü: makine, takım ve stok gizlenir; yalnız hedef (bitmiş) parça gösterilir.
// Parça üzerinde bir yüzeye tıklanır → yüzey tanınır (silindir/koni, omuz, alın, delik, düzlük/cep…) → uygun işlem eklenir.
import * as THREE from 'three';
import { StockMesh } from '../view3d/stockMesh.js';
import { profileR } from '../sim/stockSim.js';
import { h } from './forms.js';
import { FEATURE_LABELS, featureText } from './forms.js';

const DEG = 180 / Math.PI;
const f2 = (v) => +(+v).toFixed(2);

export class FinishedView {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.group = new THREE.Group();
    this.group.visible = false;
    app.viewer.scene.add(this.group);
    const el = app.viewer.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = this.on && e.button === 0 ? [e.clientX, e.clientY] : null; });
    el.addEventListener('pointerup', (e) => {
      if (!down || !this.on) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved < 5) this.pick(e);
    });
  }

  toggle(force) {
    const on = force ?? !this.on;
    if (on === this.on) { if (on) this.rebuild(); return; }
    this.on = on;
    const app = this.app;
    document.body.classList.toggle('fin-on', on);
    document.getElementById('btnFin')?.setAttribute('aria-pressed', String(on));
    if (on) {
      if (app.view2 === '2d') app.setView2('3d');
      app._finCam = { p: app.viewer.camera.position.clone(), t: app.viewer.controls.target.clone() };
      this.rebuild(true);
      this.banner();
    } else {
      this.closePop();
      this.group.visible = false;
      document.getElementById('finBanner')?.remove();
      if (app.machine) app.machine.root.visible = true;
      app.applyOptions();
      const c = app._finCam;
      if (c) app.viewer.pose(c.p, c.t);
    }
  }

  /** Hedef parçadan ağ (sahne yeniden kurulduğunda da çağrılır) */
  rebuild(frame = false) {
    if (!this.on) return;
    const app = this.app, T = app.target, P = app.project;
    this.clearMesh();
    if (app.machine) app.machine.root.visible = false;
    app.viewer.setFloor(false);
    if (!T) { app.toast('Bitmiş parça modeli oluşturulamadı'); return; }
    const L = P.part.length;
    const i0 = Math.max(0, T.idx(0)), i1 = Math.min(T.nz - 1, T.idx(L));
    this.sm = new StockMesh(T, i0, i1);
    this.sm.setTarget(T);                 // her hücre hedefte → parça rengi
    this.sm.setEdges(true);
    this.group.add(this.sm.mesh);
    this.group.position.set(L / 2, 0, 0);  // parça ortası dünya merkezinde
    this.group.visible = true;
    if (frame) {
      const D = Math.max(L, P.part.maxDia * 2.2, 12) * 2.3;
      app.viewer.pose(new THREE.Vector3(D * 0.55, D * 0.45, D * 0.8), new THREE.Vector3(0, 0, 0));
    }
    if (this.hl) { this.group.add(this.hl); }
  }
  clearMesh() {
    if (this.sm) { this.sm.mesh.removeFromParent(); this.sm.dispose(); this.sm = null; }
  }

  banner() {
    document.getElementById('finBanner')?.remove();
    const b = h('div', { class: 'fin-banner', id: 'finBanner' },
      h('b', {}, 'Bitmiş parça'),
      h('span', {}, 'İşlem eklemek için parçada bir yüzeye tıklayın'),
      h('button', { class: 'btn mini', onclick: () => this.toggle(false) }, 'Simülasyona dön'));
    document.getElementById('centerPanel').append(b);
  }

  // ------------------------------------------------------------ seçim
  pick(e) {
    if (!this.sm) return;
    const v = this.app.viewer, el = v.renderer.domElement, r = el.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), v.camera);
    const hit = ray.intersectObject(this.sm.mesh, false)[0];
    if (!hit) { this.clearHl(); this.closePop(); return; }
    const q = this.sm.mesh.worldToLocal(hit.point.clone());
    const s = this.classify(-q.x, Math.hypot(q.y, q.z), Math.atan2(q.z, q.y));
    this.highlight(s, hit.point);
    this.popup(s, e.clientX - r.left, e.clientY - r.top);
  }

  /** Tıklanan noktanın yüzeyi: d (ön alından), r (yarıçap), th (ızgara açısı) */
  classify(d, r, th) {
    const P = this.app.project, T = this.app.target, L = P.part.length, prof = P.part.profile;
    const c = Math.round(((-th * DEG) % 360 + 360) % 360);
    const tol = Math.max(0.06, T.dz * 1.5);
    const rin = T.rin[T.idx(Math.max(0, Math.min(L, d)))] || 0;
    const rOut = profileR(prof, Math.max(0, Math.min(L, d)));
    const base = { d: f2(d), r: f2(r), c };
    // delik (iç yüzey)
    if (rin > 0 && Math.abs(r - rin) < tol && r < rOut - tol) {
      const feat = P.part.features.find(f => f.type === 'axialHole' && (f.side === 'front' ? d <= f.depth + 0.5 : d >= L - f.depth - 0.5) && Math.abs(f.dia / 2 - rin) < 0.3)
        || P.part.features.find(f => f.type === 'axialHole' && (f.side === 'front' ? d <= f.depth + 0.5 : d >= L - f.depth - 0.5));
      const inner = P.part.features.find(f => (f.type === 'innerGroove' || f.type === 'innerTurn') && d >= f.z0 - 0.1 && d <= f.z1 + 0.1);
      return { ...base, kind: 'hole', feat, inner, dia: f2(2 * rin) };
    }
    // alın yüzleri
    if (d < tol) return { ...base, kind: 'front' };
    if (d > L - tol) return { ...base, kind: 'back' };
    // tornalanmış yüzey: profil segmenti
    if (Math.abs(r - rOut) < tol) {
      for (let k = 0; k < prof.length - 1; k++) {
        const a = prof[k], b = prof[k + 1];
        if (Math.abs(a.z - b.z) < 1e-6 && Math.abs(d - a.z) < tol && r >= Math.min(a.r, b.r) - tol && r <= Math.max(a.r, b.r) + tol)
          return { ...base, kind: 'shoulder', z: f2(a.z), d0: f2(2 * Math.min(a.r, b.r)), d1: f2(2 * Math.max(a.r, b.r)) };
      }
      for (let k = 0; k < prof.length - 1; k++) {
        const a = prof[k], b = prof[k + 1];
        if (b.z - a.z < 1e-6 || d < a.z - 1e-6 || d > b.z + 1e-6) continue;
        const v = a.r + (b.r - a.r) * (d - a.z) / (b.z - a.z);
        if (Math.abs(v - r) > tol) continue;
        const cyl = Math.abs(a.r - b.r) < 1e-4;
        // komşulardan derin silindir = kanal
        const pr = prof[k - 1], nx = prof[k + 2];
        const recess = cyl && pr && nx && pr.r > a.r + 0.05 && nx.r > b.r + 0.05 && Math.abs(pr.z - a.z) < 1e-6 && Math.abs(nx.z - b.z) < 1e-6;
        const thread = P.part.features.find(f => f.type === 'thread' && d >= f.z0 - 0.1 && d <= f.z1 + 0.1);
        return { ...base, kind: cyl ? 'cyl' : 'cone', z0: f2(a.z), z1: f2(b.z), dia: f2(2 * Math.max(a.r, b.r)), dia0: f2(2 * a.r), dia1: f2(2 * b.r), recess, thread };
      }
    }
    // profilin altında: frezelenmiş/delinmiş özellik
    if (r < rOut - tol) {
      const ang = (fc) => { const x = Math.abs(((c - (fc || 0)) % 360 + 540) % 360 - 180); return x; };
      const feat = P.part.features.find(f => {
        if (f.type === 'flat') return d >= f.z0 - 0.2 && d <= f.z1 + 0.2 && ang(f.c) < 80;
        if (f.type === 'pocket') return Math.abs(d - f.z) <= f.dia / 2 + 0.3 && ang(f.c) < 60;
        if (f.type === 'crossHole') return Math.abs(d - f.z) <= f.dia / 2 + 0.3 && (ang(f.c) < 60 || (f.through && ang(f.c + 180) < 60));
        if (f.type === 'polygon' || f.type === 'thread') return d >= f.z0 - 0.2 && d <= f.z1 + 0.2;
        if (f.type === 'odSlot') return d >= Math.min(f.z0, f.z1) - f.width && d <= Math.max(f.z0, f.z1) + f.width;
        if (f.type === 'engrave') return Math.abs(d - f.z) < f.height;
        return false;
      });
      const area = P.ops.find(o => o.type === 'areaMill' && o.enabled && ang(o.params.c) < 80 && (() => { const zs = (o.params.region || []).map(q => +q.z); return d >= Math.min(...zs) - 0.2 && d <= Math.max(...zs) + 0.2; })());
      return { ...base, kind: 'milled', feat, area };
    }
    return { ...base, kind: 'other' };
  }

  // ------------------------------------------------------------ vurgulama
  clearHl() { if (this.hl) { this.hl.removeFromParent(); this.hl.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); this.hl = null; } }
  highlight(s, worldPt) {
    this.clearHl();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff9f1c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    let m;
    if (s.kind === 'cyl' || s.kind === 'cone') {
      const pts = [new THREE.Vector2(s.dia0 / 2 + 0.03, -s.z0), new THREE.Vector2(s.dia1 / 2 + 0.03, -s.z1)];
      const g = new THREE.LatheGeometry(pts, 96); g.rotateZ(-Math.PI / 2);
      m = new THREE.Mesh(g, mat);
    } else if (s.kind === 'shoulder' || s.kind === 'front' || s.kind === 'back') {
      const z = s.kind === 'front' ? 0 : s.kind === 'back' ? this.app.project.part.length : s.z;
      const P = this.app.project, T = this.app.target;
      const ri = s.kind === 'shoulder' ? s.d0 / 2 : (T.rin[T.idx(z)] || 0), ro = s.kind === 'shoulder' ? s.d1 / 2 : profileR(P.part.profile, z);
      const g = new THREE.RingGeometry(ri, ro + 0.03, 96); g.rotateY(Math.PI / 2);
      m = new THREE.Mesh(g, mat); m.position.x = -z + (s.kind === 'back' ? -0.02 : 0.02);
    } else {
      m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.35, this.app.project.part.maxDia * 0.025), 16, 12), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
      m.position.copy(this.sm.mesh.worldToLocal(worldPt.clone()));
    }
    m.renderOrder = 5;
    this.hl = new THREE.Group(); this.hl.add(m);
    this.sm.mesh.add(this.hl);
  }

  // ------------------------------------------------------------ işlem menüsü
  closePop() { document.getElementById('finPop')?.remove(); }
  /** Yüzeye göre önerilen işlemler: [etiket, açıklama, () => ekle] */
  actions(s) {
    const app = this.app, P = app.project, L = P.part.length;
    const A = [];
    const add = (type, preset, label, desc) => A.push({ label, desc, run: () => app.addOp(type, preset) });
    const hasOp = (type, fid) => P.ops.some(o => o.type === type && (!fid || o.params.featureId === fid));
    const zr = (z0, z1) => `Z ${z0}–${z1}`;
    const mill = (z) => {
      const em = P.tools.filter(t => t.type === 'endmill' && t.channel === 1).sort((a, b) => a.dia - b.dia)[0];
      const d = em?.dia || 4, half = Math.max(1.2 * d, 2), w = Math.max(1.3 * d, P.part.maxDia * 0.35);
      const z0 = f2(Math.max(0, z - half)), z1 = f2(Math.min(L, z + half));
      return { toolId: em?.id, params: { c: s.c, region: [{ z: z0, y: -w }, { z: z1, y: -w }, { z: z1, y: w }, { z: z0, y: w }] } };
    };
    switch (s.kind) {
      case 'front':
        add('face', null, 'Alın tornalama', 'Ön alın yüzeyi');
        break;
      case 'back':
        if (!hasOp('cutoff')) add('cutoff', null, 'Kesme', 'Parçayı çubuktan ayır');
        add('backTurn', null, 'Arka alın tornalama', 'Karşı iş milinde arka yüz');
        break;
      case 'cyl': case 'cone': {
        const lbl = s.kind === 'cyl' ? `Ø${s.dia} silindir` : `Konik Ø${s.dia0}→Ø${s.dia1}`;
        add('rough', { params: { zMin: s.z0, zMax: s.z1 } }, 'Kaba tornalama', `${lbl} · ${zr(s.z0, s.z1)}`);
        add('finish', { params: { zMin: s.z0, zMax: s.z1 } }, 'Finiş tornalama', `${lbl} · ${zr(s.z0, s.z1)}`);
        if (s.recess) add('groove', { params: { z0: s.z0, z1: s.z1 } }, 'Kanal açma', `Kanal ${zr(s.z0, s.z1)} · Ø${s.dia}`);
        if (s.thread) add('thread', { params: { featureId: s.thread.id } }, 'Diş çekme', featureText(s.thread));
        add('areaMill', mill(s.d), 'Bölgesel frezeleme', `Bu yüzey · C${s.c}° · Z ${s.d} çevresi`);
        A.push({ label: 'Çapraz delik ekle', desc: `Z ${s.d} · C${s.c}° konumuna`, input: true, run: (dia) => this.addCrossHole(s, dia) });
        break;
      }
      case 'shoulder':
        add('rough', { params: { zMin: Math.max(0, f2(s.z - 1)), zMax: f2(Math.min(L, s.z + 1)) } }, 'Kaba tornalama', `Omuz Z ${s.z} · Ø${s.d0}–Ø${s.d1}`);
        add('finish', { params: { zMin: Math.max(0, f2(s.z - 1)), zMax: f2(Math.min(L, s.z + 1)) } }, 'Finiş tornalama', `Omuz Z ${s.z}`);
        break;
      case 'hole': {
        const f = s.feat;
        if (f && f.side === 'front') {
          add('center', { params: { featureId: f.id } }, 'Punta', featureText(f));
          add('drill', { params: { featureId: f.id } }, 'Delme', featureText(f));
          add('tap', { params: { featureId: f.id } }, 'Kılavuz çekme', featureText(f));
        } else if (f) {
          add('backDrill', { params: { featureId: f.id } }, 'Arka delme', featureText(f));
          add('backTap', { params: { featureId: f.id } }, 'Arka kılavuz', featureText(f));
        }
        if (f?.flat) A.push({ label: 'Düz dipli delik', desc: 'Matkap konik dip bırakır: parmak freze / dalma ya da iç tornalama gerekir', info: true });
        if (s.inner) A.push({ label: s.inner.type === 'innerGroove' ? 'İç kanal' : 'İç tornalama yüzeyi', desc: `Z ${s.inner.z0}–${s.inner.z1} · otomatik işlem yok (iç kanal/iç tornalama takımı gerekir)`, info: true });
        if (!f && !s.inner) A.push({ label: `İç yüzey Ø${s.dia}`, desc: 'Tanınan delik özelliği yok', info: true });
        break;
      }
      case 'milled': {
        const f = s.feat;
        const map = { flat: 'flatMill', pocket: 'pocketMill', crossHole: 'crossDrill', polygon: 'polygonMill', odSlot: 'cylSlot', engrave: 'engrave', thread: 'thread' };
        if (f && map[f.type]) add(map[f.type], { params: { featureId: f.id } }, OPL[map[f.type]] || map[f.type], `${FEATURE_LABELS[f.type] || f.type} ${featureText(f)}`);
        if (s.area) A.push({ label: 'Bölgesel frezeleme işlemi', desc: `${s.area.name} — ayarlarını aç`, run: () => { app.sel = { kind: 'op', id: s.area.id }; app.renderTree(); } });
        if (!f && !s.area) A.push({ label: 'Frezelenmiş yüzey', desc: 'Tanınan özellik yok', info: true });
        add('areaMill', mill(s.d), 'Bölgesel frezeleme (yeni)', `C${s.c}° · Z ${s.d} çevresi`);
        break;
      }
      default:
        A.push({ label: 'Yüzey tanınamadı', desc: 'Başka bir noktaya tıklayın', info: true });
    }
    return A;
  }

  popup(s, x, y) {
    this.closePop();
    const head = {
      front: 'Ön alın', back: 'Arka alın', cyl: `Silindir Ø${s.dia}`, cone: `Konik yüzey Ø${s.dia0}→Ø${s.dia1}`,
      shoulder: `Omuz Z ${s.z}`, hole: `Delik Ø${s.dia}`, milled: 'Frezelenmiş yüzey', other: 'Yüzey',
    }[s.kind];
    const sub = s.kind === 'cyl' || s.kind === 'cone' ? `Z ${s.z0}–${s.z1}` : `Z ${s.d} · C${s.c}°`;
    const box = h('div', { class: 'fin-pop', id: 'finPop', role: 'menu' },
      h('div', { class: 'fp-h' }, h('b', {}, head), h('small', {}, sub), h('button', { class: 'x', title: 'Kapat', onclick: () => { this.closePop(); this.clearHl(); } }, '✕')));
    for (const a of this.actions(s)) {
      if (a.info) { box.append(h('div', { class: 'fp-info' }, h('b', {}, a.label), h('small', {}, a.desc))); continue; }
      if (a.input) {
        const inp = h('input', { type: 'number', step: '0.1', min: '0.5', value: '3', title: 'Delik çapı (mm)' });
        const go = () => { const v = parseFloat(inp.value); if (v > 0) { this.closePop(); a.run(v); } };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
        box.append(h('div', { class: 'fp-act fp-in' }, h('span', {}, h('b', {}, a.label), h('small', {}, a.desc)), h('span', { class: 'fp-num' }, 'Ø', inp, h('button', { class: 'btn mini pri', onclick: go }, 'Ekle'))));
        continue;
      }
      box.append(h('button', { class: 'fp-act', role: 'menuitem', onclick: () => { this.closePop(); a.run(); } }, h('b', {}, '+ ' + a.label), h('small', {}, a.desc)));
    }
    const cp = document.getElementById('centerPanel');
    cp.append(box);
    const W = cp.clientWidth, H = cp.clientHeight, bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(W - bw - 8, x + 14)) + 'px';
    box.style.top = Math.max(52, Math.min(H - bh - 8, y + 10)) + 'px';
  }

  addCrossHole(s, dia) {
    const app = this.app, P = app.project;
    const id = 'u' + Math.random().toString(36).slice(2, 7);
    const f = { id, type: 'crossHole', dia: f2(dia), z: s.d, c: s.c, y: 0, through: true, depthDia: null };
    P.part.features.push(f);
    app.addOp('crossDrill', { params: { featureId: id } });
  }
}

const OPL = { flatMill: 'Düzlük frezeleme', pocketMill: 'Cep frezeleme', crossDrill: 'Çapraz delme', polygonMill: 'Çokgen frezeleme', cylSlot: 'Çap kanalı frezeleme', engrave: 'Gravür', thread: 'Diş çekme' };
