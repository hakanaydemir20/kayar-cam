// G-kod editörü: renkli metin katmanı + saydam textarea (kopyala / yapıştır / geri al tarayıcıdan),
// satır numaraları, $1/$2 aktif satır işaretleri. Yazarken canlı önizleme, Enter / Insert (EOB) ile satırı oynatma.

/** Editör satırı ↔ (kanal, kanal içi satır) eşlemesi — gcodeParser.parseProgram ile birebir aynı sayım */
export function lineMap(text) {
  const raw = text.replace(/\r/g, '').split('\n');
  const fwd = new Array(raw.length).fill(null), rev = [];
  let pi = -1, li = 0;
  raw.forEach((src, k) => {
    const t = src.trim();
    if (t === '%' || t === '') { if (pi >= 0) { fwd[k] = { pi, li }; (rev[pi] ||= [])[li] = k; li++; } return; }
    if (/^\$\d+$/.test(t)) { pi++; li = 0; return; }
    if (pi < 0) { pi = 0; li = 0; }
    fwd[k] = { pi, li }; (rev[pi] ||= [])[li] = k; li++;
  });
  return { fwd, rev };
}

export class GcodeEditor {
  /** opts: { colorize(src) → html, onEdit(text), onEob(editorLine), onLine(editorLine) } */
  constructor(container, opts) {
    this.o = opts;
    this.el = document.createElement('div');
    this.el.className = 'ged';
    this.el.innerHTML = '<div class="ged-gut" aria-hidden="true"></div><div class="ged-wrap"><pre class="ged-hl" aria-hidden="true"></pre><div class="ged-cur c1"></div><div class="ged-cur c2"></div><textarea class="ged-ta" spellcheck="false" autocomplete="off" autocapitalize="characters" wrap="off" aria-label="G-kod"></textarea></div>';
    container.append(this.el);
    this.gut = this.el.querySelector('.ged-gut');
    this.hl = this.el.querySelector('.ged-hl');
    this.ta = this.el.querySelector('.ged-ta');
    this.cur = { 1: this.el.querySelector('.ged-cur.c1'), 2: this.el.querySelector('.ged-cur.c2') };
    this.errLines = new Set();
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('input', () => {
      this.paint();
      clearTimeout(this._t);
      this._t = setTimeout(() => this.o.onEdit?.(this.ta.value), 260);
    });
    this.ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); return; }
      if (e.key === 'Insert') { e.preventDefault(); this.eob(this.caretLine()); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        const ln = this.caretLine();
        setTimeout(() => this.eob(ln), 0);   // yeni satır eklendikten sonra
      }
    });
    this.ta.addEventListener('click', () => this.o.onLine?.(this.caretLine()));
    this.ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown') this.o.onLine?.(this.caretLine()); });
  }
  eob(ln) {
    clearTimeout(this._t);
    this.o.onEob?.(ln, this.ta.value);
  }
  get value() { return this.ta.value; }
  setText(text) {
    if (text === this.ta.value) return;
    const st = this.ta.scrollTop;
    this.ta.value = text;
    this.paint();
    this.ta.scrollTop = st; this.syncScroll();
  }
  setErrors(lines) { this.errLines = new Set(lines); this.paint(); }
  caretLine() { return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length - 1; }
  lineH() { return this._lh || (this._lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 18); }
  paint() {
    const lines = this.ta.value.split('\n');
    const plain = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const col = this.colorOn === false ? plain : (this.o.colorize || plain);
    this.hl.innerHTML = lines.map((s, i) => `<div class="${this.errLines.has(i) ? 'gl err' : 'gl'}">${col(s) || ' '}</div>`).join('');
    let g = '';
    for (let i = 1; i <= lines.length; i++) g += `<div${this.errLines.has(i - 1) ? ' class="err"' : ''}>${i}</div>`;
    this.gut.innerHTML = g;
    this.syncScroll();
  }
  syncScroll() {
    const y = this.ta.scrollTop, x = this.ta.scrollLeft;
    this.hl.style.transform = `translate(${-x}px,${-y}px)`;
    this.gut.style.transform = `translateY(${-y}px)`;
    for (const c of [1, 2]) if (this._curLine?.[c] != null) this.cur[c].style.transform = `translateY(${this._curLine[c] * this.lineH() - y}px)`;
  }
  /** Aktif satırlar (editör satır no; null = yok). follow: görünür alana kaydır */
  setCurrent(l1, l2, follow = true) {
    this._curLine = { 1: l1, 2: l2 };
    for (const [c, l] of [[1, l1], [2, l2]]) this.cur[c].style.display = l == null ? 'none' : 'block';
    if (follow && document.activeElement !== this.ta) {
      const l = l1 ?? l2;
      if (l != null) {
        const top = l * this.lineH(), H = this.ta.clientHeight;
        if (top < this.ta.scrollTop + 10 || top > this.ta.scrollTop + H - 30) this.ta.scrollTop = top - H / 3;
      }
    }
    this.syncScroll();
  }
  focusLine(ln) {
    const lines = this.ta.value.split('\n');
    let p = 0; for (let i = 0; i < ln && i < lines.length; i++) p += lines[i].length + 1;
    this.ta.focus(); this.ta.setSelectionRange(p, p + (lines[ln]?.length || 0));
    const H = this.ta.clientHeight; this.ta.scrollTop = ln * this.lineH() - H / 3;
  }
}
