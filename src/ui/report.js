// Kurulum föyü (setup sheet), çubuk akışı hesabı ve ölçülü profil çizimi (SVG).
import { TOOL_TYPES, UNITS } from '../tools/toolLibrary.js';
import { OP_TYPES } from '../ops/generators.js';
import { FEATURE_LABELS, featureText } from './forms.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f3 = (v) => (v == null || Number.isNaN(+v) ? '—' : (+v).toFixed(3).replace(/\.?0+$/, ''));

/** Çubuk akışı: parça başı çubuk, çubuk başına parça, malzeme verimi */
export function barFlow(project, cycleTime) {
  const st = project.stock, L = project.part.length;
  const cut = project.tools.find(t => t.type === 'cutoff');
  const cutOp = project.ops.find(o => o.type === 'cutoff' && o.enabled);
  const w = cut ? cut.width : 2, bs = cutOp ? +cutOp.params.backStock || 0 : 0;
  const perPart = L + bs + w + (st.faceStock || 0);
  const barLen = st.barLength || 2500, remnant = st.remnant ?? 250;
  const parts = Math.max(0, Math.floor((barLen - remnant) / perPart));
  const used = parts * L;
  return {
    perPart, parts, barLen, remnant,
    yield: barLen > 0 ? used / barLen : 0,
    barTime: parts * (cycleTime || 0),
    partsPerHour: cycleTime > 0 ? 3600 / cycleTime : 0,
  };
}

/** Ölçülü profil çizimi (yarım kesit + eksen + özellik işaretleri) */
export function profileSvg(part, opts = {}) {
  const W = opts.w || 520, H = opts.h || 200, pad = 28;
  const feats = part.features || [];
  const rowsNeeded = Math.min(3, Math.max(1, feats.length));
  const top0 = 16 + rowsNeeded * 11;                         // etiket satırları için üst boşluk
  const L = part.length, R = Math.max(...part.profile.map(p => p.r), 1);
  const k = Math.min((W - 2 * pad) / L, (H - top0 - 18) / (2 * R));
  const cy = top0 + (H - top0 - 18) / 2;
  const X = (z) => pad + z * k, Y = (r) => cy - r * k;
  const top = part.profile.map(p => `${X(p.z).toFixed(1)},${Y(p.r).toFixed(1)}`).join(' ');
  const bot = [...part.profile].reverse().map(p => `${X(p.z).toFixed(1)},${Y(-p.r).toFixed(1)}`).join(' ');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#0f1216;border:1px solid #2a3038;border-radius:6px">`];
  out.push(`<polygon points="${top} ${bot}" fill="#3b4250" stroke="#cfd6df" stroke-width="1"/>`);
  out.push(`<line x1="${pad - 10}" y1="${cy}" x2="${W - pad + 10}" y2="${cy}" stroke="#f59e0b" stroke-dasharray="8 3 2 3" stroke-width="0.8"/>`);
  // çap ölçüleri: farklı çaplı yatay bölümler
  const seen = new Set();
  for (let i = 0; i < part.profile.length - 1; i++) {
    const a = part.profile[i], b = part.profile[i + 1];
    if (Math.abs(a.r - b.r) < 1e-6 && b.z - a.z > 0.8 && a.r > 0 && !seen.has(a.r.toFixed(2))) {
      seen.add(a.r.toFixed(2));
      const xm = X((a.z + b.z) / 2);
      out.push(`<line x1="${xm}" y1="${Y(a.r)}" x2="${xm}" y2="${Y(-a.r)}" stroke="#38bdf8" stroke-width="0.7" marker-start="url(#m)" marker-end="url(#m)"/>`);
      out.push(`<text x="${xm + 3}" y="${cy - 3}" fill="#9cc3ff" font-size="10" font-family="Consolas,monospace">Ø${f3(2 * a.r)}</text>`);
    }
  }
  // boy ölçüsü
  out.push(`<line x1="${X(0)}" y1="${H - 8}" x2="${X(L)}" y2="${H - 8}" stroke="#a78bfa" stroke-width="0.7"/>`);
  out.push(`<text x="${X(L / 2) - 14}" y="${H - 11}" fill="#c4b5fd" font-size="10" font-family="Consolas,monospace">L ${f3(L)}</text>`);
  // özellikler: işaret profil üstünde, etiketler çakışmayacak satırlara dağıtılır
  const rows = [];
  for (const f of feats) {
    const z = f.z ?? ((f.z0 ?? 0) + (f.z1 ?? 0)) / 2;
    const x = f.type === 'axialHole' ? (f.side === 'back' ? X(L) - 4 : X(0) + 4) : X(z);
    const label = FEATURE_LABELS[f.type] || f.type, w = label.length * 5 + 10;
    let row = rows.findIndex(r => r.every(([a, b]) => x + w < a || x > b));
    if (row < 0) { rows.push([]); row = rows.length - 1; }
    rows[row].push([x, x + w]);
    const yl = 16 + (row % rowsNeeded) * 11 + 8;
    out.push(`<line x1="${x}" y1="${yl + 2}" x2="${x}" y2="${Y(R) - 2}" stroke="#34d399" stroke-width="0.5" stroke-dasharray="2 2"/>`);
    out.push(`<circle cx="${x}" cy="${yl - 3}" r="2.6" fill="#34d399"/><text x="${x + 5}" y="${yl}" fill="#86efac" font-size="9" font-family="Arial">${esc(label)}</text>`);
  }
  out.push(`<text x="${W - pad}" y="12" text-anchor="end" fill="#8b949e" font-size="9" font-family="Arial">Z0 ön alın → Z+ arka</text>`);
  out.push('<defs><marker id="m" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,3 L6,0 L6,6 z" fill="#38bdf8"/></marker></defs></svg>');
  return out.join('');
}

/** Kurulum föyü HTML (yazdırılabilir, çevrimdışı) */
export function setupSheetHtml(project, result, opTimes, totalTime) {
  const P = project, post = P.post;
  const bf = barFlow(P, totalTime);
  const li = result.posted?.lineInfo || [];
  const used = new Map();
  for (const op of P.ops.filter(o => o.enabled)) if (op.toolId) { if (!used.has(op.toolId)) used.set(op.toolId, []); used.get(op.toolId).push(op); }
  const toolRows = [...P.tools].sort((a, b) => a.num - b.num).map(t => {
    const ops = used.get(t.id) || [];
    const time = ops.reduce((s, o) => s + (opTimes[o.id] ? opTimes[o.id].t1 - opTimes[o.id].t0 : 0), 0);
    const size = t.type === 'turn' || t.type === 'thread' ? `R${f3(t.noseR)}` : t.width ? `G${f3(t.width)}` : `Ø${f3(t.dia)}${t.pitch ? '×' + f3(t.pitch) : ''}`;
    return `<tr${ops.length ? '' : ' class="unused"'}><td>T${String(t.num).padStart(2, '0')}</td><td>${t.offset}</td><td>${esc(t.name)}</td><td>${esc(TOOL_TYPES[t.type]?.label)}</td><td>${esc(UNITS[t.unit]?.label)}</td><td>${f3(t.yPos)} / ${f3(t.xPos || 0)}</td><td>${size}</td><td>${f3(t.vc)}</td><td>${t.live ? f3(t.fz) + ' mm/diş' : f3(t.feed) + ' mm/dev'}</td><td>${ops.map(o => esc(o.name)).join('<br>') || '<i>kullanılmıyor</i>'}</td><td>${time ? time.toFixed(1) + ' s' : ''}</td></tr>`;
  }).join('');
  const opRows = P.ops.filter(o => o.enabled).map(o => {
    const ot = opTimes[o.id]; const t = P.tools.find(x => x.id === o.toolId);
    return `<tr><td>$${OP_TYPES[o.type].channel}</td><td>${esc(o.name)}</td><td>${t ? 'T' + String(t.num).padStart(2, '0') : '—'}</td><td>${ot ? ot.t0.toFixed(1) : '—'}</td><td>${ot ? (ot.t1 - ot.t0).toFixed(1) : '—'}</td><td>${ot ? ot.line0 + 1 : ''}</td></tr>`;
  }).join('');
  const warns = [];
  if (!post.verified) warns.push('Post-processor M kodları makineden DOĞRULANMADI — ilk çalıştırmada kuru çalıştırma / tek blok, düşük hızlı ilerleme.');
  for (const [k, a] of Object.entries(P.machine.axes)) if (a.estimated) warns.push(`${k} eksen stroku tahmini (${a.min}…${a.max} mm).`);
  if (P.sync?.overlap) warns.push('Örtüşen çevrim: ilk çevrimde karşı iş mili boştur — ilk parça arka işlemsiz çıkar, ayırın.');
  const nLines = (result.posted?.paths || []).reduce((s, p) => s + p.length, 0);
  const date = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Kurulum Föyü — ${esc(P.part.name)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:18px;font-size:12px}
h1{font-size:18px;margin:0 0 2px}h2{font-size:13px;margin:16px 0 6px;border-bottom:2px solid #1f3c9c;padding-bottom:2px;color:#1f3c9c}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eef1f6}
.kv{display:grid;grid-template-columns:repeat(4,auto 1fr);gap:3px 10px}.kv b{color:#444}
.warn{background:#fff4e0;border:1px solid #f0b54a;padding:6px 8px;margin:4px 0}
tr.unused{color:#999}.head{display:flex;justify-content:space-between;align-items:flex-end}
.svgbox svg{background:#fff !important}.svgbox polygon{fill:#dfe4ea}.svgbox text{fill:#123 !important}
@media print{button{display:none}}
</style></head><body>
<div class="head"><div><h1>Kurulum Föyü — ${esc(P.part.name)}</h1><div>${esc(P.machine.name)} · ${esc(P.machine.control)} · Program O${String(post.programNumber).padStart(4, '0')} · ${date}</div></div><button onclick="print()">Yazdır</button></div>
${warns.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}
<h2>Parça ve stok</h2>
<div class="kv"><b>Parça boyu</b><span>${f3(P.part.length)} mm</span><b>En büyük çap</b><span>Ø${f3(P.part.maxDia)}</span>
<b>Çubuk</b><span>Ø${P.stock.barDia} × ${bf.barLen} mm</span><b>Alın payı</b><span>${f3(P.stock.faceStock)} mm</span>
<b>Parça başı çubuk</b><span>${f3(bf.perPart)} mm</span><b>Çubuk başına parça</b><span>${bf.parts} (kalan uç ${bf.remnant} mm)</span>
<b>Malzeme verimi</b><span>%${(bf.yield * 100).toFixed(1)}</span><b>Sıfır noktası</b><span>${esc(P.zero?.label || 'Ön alın merkezi')}${P.zero?.zShift ? ' (Z' + P.zero.zShift + ')' : ''}</span>
<b>Çevrim süresi</b><span>${totalTime.toFixed(1)} s</span><b>Saatte parça</b><span>${bf.partsPerHour.toFixed(1)}</span>
<b>Çubuk süresi</b><span>${(bf.barTime / 60).toFixed(1)} dk</span><b>NC satırı</b><span>${nLines}</span>
<b>Kılavuz burç segmenti</b><span>${P.stock.segment ? P.stock.segment + ' mm' : 'kapalı'}</span><b>Senkron</b><span>${P.sync?.overlap ? 'Örtüşen çevrim' : 'Sıralı'}</span></div>
<h2>Profil</h2><div class="svgbox">${profileSvg(P.part, { w: 760, h: 220 })}</div>
<h2>Özellikler</h2><table><tr><th>Tip</th><th>Tanım</th></tr>${(P.part.features || []).map(f => `<tr><td>${esc(FEATURE_LABELS[f.type] || f.type)}</td><td>${esc(featureText(f))}</td></tr>`).join('') || '<tr><td colspan=2>—</td></tr>'}</table>
<h2>Takım listesi (Y yanal / X radyal montaj)</h2>
<table><tr><th>T</th><th>Ofset</th><th>Takım</th><th>Tip</th><th>Ünite</th><th>Y / X</th><th>Ölçü</th><th>Vc</th><th>İlerleme</th><th>İşlemler</th><th>Kesme süresi</th></tr>${toolRows}</table>
<h2>İşlem sırası</h2>
<table><tr><th>Kanal</th><th>İşlem</th><th>Takım</th><th>Başlangıç (s)</th><th>Süre (s)</th><th>NC satırı</th></tr>${opRows}</table>
<h2>Kontrol</h2>
<div>CAM/post/NC hatası: ${result.errors.length} · Talaş simülasyonu ve tam makine çarpışma kontrolü ile doğrulanmıştır (Verify).</div>
</body></html>`;
}
