// G-kod metnini kanallara (path) ve bloklara ayırır.

/** "M03" → "M3", "G00" → "G0" */
export function normCode(c) {
  const m = /^([A-Z])(-?\d+(?:\.\d+)?)$/.exec(c);
  if (!m) return c;
  return m[1] + String(parseFloat(m[2]));
}

/**
 * @returns {{paths: Array<{header:string, lines:Array<{n:number, src:string, words:Array<{a:string,v:number,sel?:number}>, comment:string}>}>}}
 */
export function parseProgram(text) {
  const rawLines = text.replace(/\r/g, '').split('\n');
  const paths = [];
  let cur = null;
  const ensure = (h) => { cur = { header: h, lines: [] }; paths.push(cur); };
  let vars = {};
  for (const src of rawLines) {
    const t = src.trim();
    if (t === '%' || t === '' || /^<[^>]*>$/.test(t)) { if (cur) cur.lines.push({ src, words: [], comment: '', empty: true }); continue; }
    if (/^\$\d+$/.test(t)) { ensure(t); vars = {}; continue; }
    if (!cur) ensure('$1');
    // makro: #n = ifade (değişken ataması) ve [ ] ifadeleri / #n başvuruları
    if (!/^\s*\//.test(src) && src.includes('#')) {
      const r = expandMacros(src, vars);
      if (r.assign) { cur.lines.push({ src, words: [], comment: r.comment, empty: true, assign: r.assign }); continue; }
      const ln = parseLine(r.text); ln.src = src; if (r.error) (ln.errors ||= []).push(r.error);
      cur.lines.push(ln); continue;
    }
    cur.lines.push(parseLine(src));
  }
  for (const p of paths) p.vars = p.vars || {};
  return { paths };
}

export function parseLine(src) {
  // blok atlama (/ ile başlayan satır): BLOCK SKIP açıkken makine okumaz — simülasyon da atlar
  if (/^\s*\//.test(src)) return { src, words: [], comment: '', errors: [], skip: true };
  let comment = '';
  let s = src.replace(/\(([^)]*)\)/g, (_, c) => { comment += (comment ? ' ' : '') + c; return ' '; });
  const semi = s.indexOf(';');
  if (semi >= 0) { comment += s.slice(semi + 1); s = s.slice(0, semi); }
  s = s.toUpperCase();
  const words = [];
  const errors = [];
  const warnings = [];
  // sık yazım hatası: G/M ardından O harfi (GO → G0)
  if (/(^|[^A-Z])([GM])O(?=[A-Z\s]|$)/.test(s)) { s = s.replace(/(^|[^A-Z])([GM])O(?=[A-Z\s]|$)/g, '$1$20'); warnings.push('Yazım hatası: "O" harfi sıfır (0) olarak okundu — programı düzeltin'); }
  const re = /([A-Z])\s*(\d+\s*=)?\s*([+-]?(?:\d+\.?\d*|\.\d+))/g;
  let m, last = 0;
  while ((m = re.exec(s))) {
    const gap = s.slice(last, m.index).trim();
    if (gap) errors.push('Tanınmayan: ' + gap);
    last = re.lastIndex;
    const w = { a: m[1], v: parseFloat(m[3]), raw: m[3] };
    if (m[2]) w.sel = parseInt(m[2]);
    words.push(w);
  }
  const tail = s.slice(last).trim();
  if (tail) errors.push('Tanınmayan: ' + tail);
  return { src, words, comment: comment.trim(), errors, warnings };
}

/** FANUC makro B (alt küme): #n = ifade, [ifade], #n başvurusu. + − × ÷ ve parantez. */
export function evalExpr(e, vars) {
  const x = e.replace(/#(\d+)/g, (_, n) => { const v = vars[n]; if (v == null) throw new Error('#' + n + ' tanımsız'); return '(' + v + ')'; }).replace(/\[/g, '(').replace(/\]/g, ')');
  if (!/^[\d.+\-*/() ]+$/.test(x)) throw new Error('Desteklenmeyen makro ifadesi: ' + e);
  const v = Function('return (' + x + ')')();
  if (!Number.isFinite(v)) throw new Error('Makro sonucu geçersiz: ' + e);
  return v;
}
export function expandMacros(src, vars) {
  let comment = '';
  const code = src.replace(/\(([^)]*)\)/g, (_, c) => { comment += (comment ? ' ' : '') + c; return ' '; }).trim();
  const a = /^#(\d+)\s*=\s*(.+)$/.exec(code);
  try {
    if (a) { vars[a[1]] = evalExpr(a[2].trim(), vars); return { assign: { n: +a[1], v: vars[a[1]] }, comment }; }
    let t = code;
    for (let k = 0; k < 20 && /\[[^\[\]]*\]/.test(t); k++) t = t.replace(/\[([^\[\]]*)\]/g, (_, e) => fmtNum(evalExpr(e, vars)));
    t = t.replace(/#(\d+)/g, (_, n) => { if (vars[n] == null) throw new Error('#' + n + ' tanımsız'); return fmtNum(vars[n]); });
    return { text: t + (comment ? ' (' + comment + ')' : '') };
  } catch (e) { return { text: code.replace(/\[[^\]]*\]|#\d+/g, ''), error: e.message }; }
}
const fmtNum = (v) => { const s = (Math.round(v * 1e6) / 1e6).toString(); return s.includes('.') || s.includes('e') ? s : s + '.'; };
