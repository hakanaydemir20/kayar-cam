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
  for (const src of rawLines) {
    const t = src.trim();
    if (t === '%' || t === '') { if (cur) cur.lines.push({ src, words: [], comment: '', empty: true }); continue; }
    if (/^\$\d+$/.test(t)) { ensure(t); continue; }
    if (!cur) ensure('$1');
    cur.lines.push(parseLine(src));
  }
  return { paths };
}

export function parseLine(src) {
  let comment = '';
  let s = src.replace(/\(([^)]*)\)/g, (_, c) => { comment += (comment ? ' ' : '') + c; return ' '; });
  const semi = s.indexOf(';');
  if (semi >= 0) { comment += s.slice(semi + 1); s = s.slice(0, semi); }
  s = s.toUpperCase();
  const words = [];
  const errors = [];
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
  return { src, words, comment: comment.trim(), errors };
}
