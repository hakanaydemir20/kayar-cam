// Ara takım yolu temsili (IR). İşlem üreteçleri bunu doldurur, post bunu G-koda çevirir.
// Koordinatlar: X çap (mm), Y (mm), Z (mm), C (derece).

export class Prog {
  constructor(channel) {
    this.channel = channel;
    this.items = [];
  }
  push(it) { this.items.push(it); return this; }
  comment(text) { return this.push({ k: 'comment', text }); }
  opStart(op) { return this.push({ k: 'op', id: op.id, name: op.name }); }
  opEnd(op) { return this.push({ k: 'opEnd', id: op.id }); }
  tool(tool) { return this.push({ k: 'tool', tool }); }
  workOffset(code) { return this.push({ k: 'wo', code }); }
  /** which: main|sub|live|backLive ; dir: cw|ccw|stop */
  spindle(o) { return this.push({ k: 'spindle', ...o }); }
  feedMode(mode) { return this.push({ k: 'feedMode', mode }); }
  plane(p) { return this.push({ k: 'plane', p }); }
  coolant(on, back = false) { return this.push({ k: 'coolant', on, back }); }
  rapid(pos) { return this.push({ k: 'rapid', pos }); }
  line(pos, F) { return this.push({ k: 'line', pos, F }); }
  /** plane zx: IK (I yarıçap), yz: JK */
  arc(cw, pos, ctr, F) { return this.push({ k: 'arc', cw, pos, ctr, F }); }
  thread92(pos, F) { return this.push({ k: 'g92', pos, F }); }
  thread32(pos, F) { return this.push({ k: 'g32', pos, F }); }
  m(key) { return this.push({ k: 'm', key }); }
  wait(n) { return this.push({ k: 'wait', n }); }
  dwell(sec) { return this.push({ k: 'dwell', sec }); }
  raw(text) { return this.push({ k: 'raw', text }); }
  /** silindirik interpolasyon: r > 0 aç (silindir yarıçapı), 0 kapat */
  cyl(r) { return this.push({ k: 'cyl', r }); }
  /** polar interpolasyon aç/kapa (X çap, C hipotetik mm) */
  polar(on) { return this.push({ k: 'polar', on }); }
  blank() { return this.push({ k: 'blank' }); }
}
