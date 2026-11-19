import * as THREE from 'three';
import { h, field, featureText } from './forms.js';
import { PartPreview } from '../view3d/partPreview.js';
import { toPart } from '../cad/featureRecog.js';
import { defaultParams, GEN, pickGrip } from '../ops/generators.js';
import { buildContext } from '../ops/context.js';
import { surfaceCloud, selRegion } from '../ops/simMill.js';
import { backMillType, faceBoundary, simMillTools } from '../ops/simMillSetup.js';
import { Prog } from '../toolpath/ir.js';
import { toolNo } from '../tools/toolLibrary.js';

const stages = ['Geometri', 'İş mili', 'Takım', 'Analiz ve ayarlar'];
const patterns = [['parallelZ', 'Z boyunca paralel'], ['circC', 'C boyunca çevresel'], ['spiral', 'Sarmal'], ['contour', 'Yüzey sınırı']];

export function openSimMillWizard(app) {
  const project = app.project, part = project.part;
  const mesh = part.mesh;
  const hasStep = part.meshFmt === 'step' && mesh?.faces && part.fixture;
  const params = defaultParams('simMill');
  const rearParams = { ...defaultParams('backPolar'), featureId: null };
  const rearFeatures = part.features.filter(backMillType);
  const faces = new Set(), edges = new Map(), boundaries = new Map();
  let stage = 0, channel = 1, toolId = null, picking = 'face', preview, down, analysis = null, closed = false;
  const rearFeature = () => rearFeatures.find(f => f.id === rearParams.featureId);
  const tools = () => simMillTools(project.tools, channel, rearFeature());
  const tool = () => tools().find(t => t.id === toolId);
  const header = h('nav', { class: 'opwizard-head', 'aria-label': 'İşlem oluşturma adımları' });
  const view = h('div', { class: 'opwizard-preview' });
  const side = h('div', { class: 'opwizard-side' });
  const body = h('div', { class: 'opwizard' }, header, h('div', { class: 'opwizard-grid' }, view, side));
  const selection = new THREE.Group();
  const disposeSelection = () => {
    for (const node of [...selection.children]) {
      node.geometry.dispose(); node.material.dispose(); selection.remove(node);
    }
  };

  function highlight() {
    if (!preview || !hasStep) return;
    disposeSelection();
    const position = preview.mesh.geometry.getAttribute('position');
    const indices = [];
    for (const id of faces) {
      const { tri0, tri1 } = mesh.faces[id];
      for (let i = tri0 * 3; i < (tri1 + 1) * 3; i++) indices.push(mesh.indices[i]);
    }
    if (indices.length) {
      const geometry = new THREE.BufferGeometry().setAttribute('position', position);
      geometry.setIndex(indices);
      selection.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0xf59e0b, opacity: 0.52, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
      })));
    }
    if (edges.size) {
      const points = [...edges.values()].flatMap(edge => edge.vertices.map(i => new THREE.Vector3().fromBufferAttribute(position, i)));
      selection.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false })));
    }
  }

  function pick(ev) {
    if (stage !== 0 || !hasStep || !down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return;
    const hit = preview.pick(ev);
    const id = hit && mesh.faceOf[hit.faceIndex];
    if (id == null) return;
    if (picking === 'face') {
      if (faces.has(id)) faces.delete(id); else faces.add(id);
    } else {
      if (!boundaries.has(id)) boundaries.set(id, faceBoundary(mesh, id));
      const attribute = preview.mesh.geometry.getAttribute('position');
      const rect = preview.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(ev.clientX - rect.left, ev.clientY - rect.top);
      const screen = i => {
        const p = new THREE.Vector3().fromBufferAttribute(attribute, i).project(preview.camera);
        return new THREE.Vector2((p.x + 1) * rect.width / 2, (1 - p.y) * rect.height / 2);
      };
      let nearest = null, best = 10;
      for (const edge of boundaries.get(id)) {
        const [a, b] = edge.vertices.map(screen);
        const d = b.sub(a);
        const u = THREE.MathUtils.clamp(mouse.clone().sub(a).dot(d) / (d.lengthSq() || 1), 0, 1);
        const distance = a.addScaledVector(d, u).distanceTo(mouse);
        if (distance < best) { nearest = edge; best = distance; }
      }
      if (!nearest) { app.toast('Bir yüzey sınırına daha yakın tıklayın.'); return; }
      if (edges.has(nearest.key)) edges.delete(nearest.key); else edges.set(nearest.key, nearest);
    }
    analysis = null;
    highlight(); render();
  }

  function analyze(recommend = false) {
    if (!tool()) return;
    if (channel === 2) {
      try {
        const f = rearFeature(), type = backMillType(f);
        if (!type) throw new Error('Tanımlı arka alın özelliğini seçin.');
        const cut = project.ops.find(o => o.enabled && o.type === 'cutoff');
        const pick = project.ops.find(o => o.enabled && o.type === 'pickoff');
        if (!cut || !pick) throw new Error('Path 2 için Kesme ve Senkron alma etkin olmalı.');
        if (!Number.isFinite(rearParams.stepDown) || rearParams.stepDown <= 0
          || (type === 'backPolar' && (!Number.isFinite(rearParams.stepOver) || rearParams.stepOver <= 0 || rearParams.stepOver > 1)))
          throw new Error('Paso pozitif, radyal adım 0–1 × D aralığında olmalı.');
        const ctx = buildContext(project);
        ctx.backStock = Math.max(0, Number(cut.params.backStock) || 0);
        ctx.grip = pickGrip(pick.params.grip, ctx.L, ctx.backStock, ctx.machine);
        if (ctx.grip < 2) throw new Error('Karşı mil için yeterli kavrama alanı bulunamadı.');
        const codes = { ...project.post.codes, ...project.post.codes2 };
        if (!codes.backLiveCW || !codes.backLiveStop) throw new Error('Postta arka canlı takım için başlatma ve durdurma komutları eksik.');
        if (type === 'backPolar' && (!project.post.polarOn || !project.post.polarOff))
          throw new Error('Postta polar interpolasyon komutları eksik.');
        const prog = new Prog(2);
        GEN[type](prog, ctx, { name: 'Arka alın ön analizi', params: rearParams }, tool());
        const moves = prog.items.filter(item => item.k === 'line').length;
        if (!moves) throw new Error('Arka alın için kesme hareketi oluşmadı.');
        analysis = { note: type === 'backPolar' ? 'X2–C2 polar alın konturu.' : 'C2 indeksli arka alın kanalı.',
          range: `Arka Z derinliği ${f.depth} mm`, moves };
      } catch (error) { analysis = { error: error.message }; }
      return;
    }
    if (!faces.size) return;
    params.faceIds = [...faces];
    try {
      const cloud = surfaceCloud(mesh, q => toPart(part.fixture, q), params.faceIds, 0.3, 8000);
      const region = selRegion(cloud);
      if (!region) throw new Error('Seçimden işlenebilir C/Z bölgesi elde edilemedi.');
      if (recommend) params.strategy = region.full ? 'circC' : 'parallelZ';
      if (!Number.isFinite(params.ap) || params.ap <= 0 || !Number.isFinite(params.stepover) || params.stepover <= 0 || params.stepover > 1)
        throw new Error('Kat derinliği pozitif, yanal adım 0–1 × D aralığında olmalı.');
      for (const key of ['stockLeave', 'approach', 'finishAllow']) {
        if (!Number.isFinite(params[key]) || params[key] < 0) throw new Error('Pay ve yaklaşma değerleri sıfır veya pozitif olmalı.');
      }
      if (params.feed != null && (!Number.isFinite(params.feed) || params.feed <= 0)) throw new Error('İlerleme pozitif olmalı veya takımın değeri için boş bırakılmalı.');
      const prog = new Prog(1);
      GEN.simMill(prog, buildContext(project), { name: 'Simültane ön analiz', params }, tool());
      const moves = prog.items.filter(item => item.k === 'line').length;
      if (!moves) throw new Error('Bu seçim için kesme hareketi oluşmadı.');
      analysis = { note: (region.full ? 'Tam çevre için C boyunca tarama önerilir.' : 'Yerel yüzeyler için Z boyunca tarama önerilir.'), moves,
        range: `Z ${region.z0.toFixed(2)}–${region.z1.toFixed(2)} mm` };
    } catch (error) { analysis = { error: error.message }; }
  }

  function render() {
    if (closed) return;
    header.replaceChildren(...stages.map((name, i) => {
      const button = h('button', { class: 'btn mini' + (i === stage ? ' pri' : ''), disabled: i > stage, onclick: () => { stage = i; render(); } }, name);
      if (i === stage) button.setAttribute('aria-current', 'step');
      return button;
    }));
    side.replaceChildren(h('h4', {}, stages[stage]));
    if (stage === 0) {
      side.append(h('div', { class: 'btnrow' },
        ...['face', 'edge'].map(mode => h('button', { class: 'btn' + (picking === mode ? ' pri' : ''), disabled: !hasStep, onclick: () => { picking = mode; render(); } }, mode === 'face' ? 'Yüzey seç' : 'Kenar seç')),
        h('button', { class: 'btn', onclick: () => { faces.clear(); edges.clear(); highlight(); render(); } }, 'Temizle')),
      h('p', { class: 'hint', 'aria-live': 'polite' }, hasStep ? `${faces.size} yüzey, ${edges.size} kenar seçili` : 'Yüzey seçimi için STEP parça açın.'),
      h('p', { class: 'hint' }, 'Yüzeye tıklayın, tekrar tıklayarak çıkarın. Kenarlar görsel referanstır. Üretim alanını seçili yüzeyler belirler.'));
      if (hasStep) {
        const list = h('select', { 'aria-label': 'STEP yüzey kimliği' }, h('option', { value: '' }, 'Yüzey kimliğiyle seç'),
          ...mesh.faces.map((_, id) => h('option', { value: id }, `Yüzey #${id}${faces.has(id) ? ' · seçili' : ''}`)));
        list.addEventListener('change', () => {
          if (list.value === '') return;
          const id = Number(list.value);
          if (faces.has(id)) faces.delete(id); else faces.add(id);
          analysis = null;
          highlight(); render();
        });
        side.append(list);
      }
    } else if (stage === 1) {
      const choose = value => {
        if (channel !== value) { channel = value; toolId = null; analysis = null; }
        render();
      };
      side.append(h('div', { class: 'btnrow' },
        h('button', { class: 'btn' + (channel === 1 ? ' pri' : ''), 'aria-pressed': String(channel === 1), onclick: () => choose(1) }, 'Path 1 · Ana iş mili'),
        h('button', { class: 'btn' + (channel === 2 ? ' pri' : ''), 'aria-pressed': String(channel === 2), onclick: () => choose(2) }, 'Path 2 · Karşı iş mili')),
      h('p', { class: 'hint' }, channel === 1 ? 'X–Y–Z–C1 yüzey frezeleme. Kütüphanedeki takılı çapraz canlı frezeler kullanılır.'
        : 'X2–Z2–C2 arka işleme. Takım adımında arka alın kanalı veya polar kontur özelliğini seçin.'));
    } else if (stage === 2) {
      if (channel === 2) {
        const features = h('select', { 'aria-label': 'Arka alın özelliği' }, h('option', { value: '' }, 'Arka alın özelliği seçin'),
          ...rearFeatures.map(f => h('option', { value: f.id }, featureText(f))));
        features.value = rearParams.featureId || '';
        features.addEventListener('change', () => { rearParams.featureId = features.value || null; toolId = null; analysis = null; render(); });
        side.append(features);
        if (!rearFeatures.length) side.append(
          h('p', { class: 'hint' }, 'Parça özelliklerinde arka alın kanalı veya arka alın çokgeni tanımlayın. STEP yüz seçimi bu ölçüleri otomatik çıkarmıyor.'),
          h('button', { class: 'btn mini', onclick: () => app.openPart() }, 'Parça özelliklerini aç'));
      }
      const select = h('select', { 'aria-label': 'Takılı parmak freze' },
        h('option', { value: '' }, 'Takım seçin'),
        ...tools().map(t => h('option', { value: t.id }, `${toolNo(t)} · ${t.name} · Ø${t.dia}`)));
      select.value = toolId || '';
      select.addEventListener('change', () => { toolId = select.value; analysis = null; render(); });
      side.append(select, h('p', { class: 'hint' }, tools().length ? 'Seçilen mildeki uygun takılı frezeler listelenir.' : 'Takımlar penceresinde seçilen mil için uygun bir canlı parmak freze tanımlayın.'));
      if (!tools().length) side.append(h('button', { class: 'btn mini', onclick: () => app.openTools() }, 'Takımları aç'));
    } else {
      const fields = h('div', { class: 'fg' });
      const change = () => { analysis = null; render(); };
      if (channel === 2) {
        fields.append(field(rearParams, 'stepDown', 'Paso derinliği', 'mm', 'num', change));
        if (backMillType(rearFeature()) === 'backPolar') fields.append(field(rearParams, 'stepOver', 'Radyal adım', '×D', 'num', change));
      } else {
      fields.append(field(params, 'strategy', 'Strateji', '', 'select:strategy', change, { items: patterns, full: true }));
      for (const [key, label, unit] of [['ap', 'Kat derinliği', 'mm'], ['stepover', 'Yanal adım', '×D'], ['stockLeave', 'Yüzeyde kalan pay', 'mm'], ['finishAllow', 'Finiş payı', 'mm'], ['approach', 'Yaklaşma boşluğu', 'mm'], ['feed', 'İlerleme (boş = takım)', 'mm/dak']])
        fields.append(field(params, key, label, unit, 'num', change));
      fields.append(field(params, 'finishPass', 'Finiş pasosu', '', 'bool', change));
      }
      side.append(h('p', {}, `Path ${channel} · ${toolNo(tool())} · ${channel === 1 ? faces.size + ' yüzey' : featureText(rearFeature())}`), fields,
        h('button', { class: 'btn', onclick: () => { analyze(); render(); } }, 'Ayarları analiz et'));
      if (analysis?.error) side.append(h('p', { class: 'msg e', role: 'alert' }, analysis.error));
      else if (analysis) side.append(h('p', { class: 'hint', role: 'status' }, `${analysis.note} ${analysis.range} · ${analysis.moves} ilerleme bloğu. Çarpışma ve stok kontrolü işlem oluşturulduktan sonra yapılır.`));
    }
    const enabled = stage === 0 ? true
      : stage === 1 ? channel === 1 ? faces.size > 0 : true
        : stage === 2 ? !!tool() && (channel === 1 || !!rearFeature()) : !!analysis && !analysis.error;
    side.append(h('div', { class: 'btnrow opwizard-actions' },
      h('button', { class: 'btn', onclick: () => { if (stage === 0) app.closeModal(); else { stage--; render(); } } }, stage ? 'Geri' : 'Vazgeç'),
      h('button', { class: 'btn pri', disabled: !enabled, onclick: () => {
        if (app.project !== project) { app.closeModal(); return; }
        if (stage < 3) { stage++; if (stage === 3) analyze(true); render(); return; }
        analyze();
        if (analysis?.error || !tool()) { render(); return; }
        app.closeModal();
        if (channel === 2) app.addOp(backMillType(rearFeature()), { toolId, params: { ...rearParams } });
        else app.addOp('simMill', { toolId, params: { ...params, faceIds: [...faces], edgeRefs: [...edges.keys()] } });
      } }, stage < 3 ? 'İleri' : 'İşlemi oluştur')));
  }

  render();
  app.openModal('Simültane frezeleme', body, { wide: true, cls: 'opwizard', onClose: () => {
    closed = true;
    disposeSelection();
    if (preview) {
      preview.controls.dispose();
      for (const root of [preview.root, preview.overlay]) root.traverse(node => {
        node.geometry?.dispose(); node.material?.map?.dispose(); node.material?.dispose();
      });
      preview.dispose();
    }
  } });
  try {
    preview = new PartPreview(view);
    preview.setPart(part, project.zero?.zShift || 0);
    preview.overlay.visible = false;
    preview.root.add(selection);
    const canvas = preview.renderer.domElement;
    canvas.addEventListener('pointerdown', ev => { down = ev.button === 0 ? [ev.clientX, ev.clientY] : null; });
    canvas.addEventListener('pointerup', ev => { pick(ev); down = null; });
  } catch { view.append(h('p', { class: 'hint' }, '3D önizleme açılamadı.')); }
}
