// Atölye dosya biçimi: her kanal ayrı dosya (<AD>-P1.txt / <AD>-P2.txt), "%" ile başlar ve biter, $1/$2 başlığı yok.
// Simülasyon iki kanalı tek metinde ($1/$2) okur: bu modül ikisi arasında çevirir.

const body = (t) => t.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '%').join('\n').replace(/^\n+|\n+$/g, '');

/** Gönderilen ($1/$2'li) metni kanal dosyalarına böl → [{ name, text }] */
export function splitChannels(text, profile, partName = 'PARCA') {
  const heads = profile?.pathHeader || ['$1', '$2'];
  const suf = profile?.fileSuffix || ['-P1', '-P2'];
  const base = String(partName || 'PARCA').replace(/[^\w.-]+/g, '').toUpperCase() || 'PARCA';
  const lines = body(text).split('\n');
  const out = [[], []];
  let ch = -1;
  for (const l of lines) {
    const i = heads.indexOf(l.trim());
    if (i >= 0) { ch = i; continue; }
    if (ch >= 0) out[ch].push(l);
  }
  return out.map((ls, i) => ({ name: base + suf[i] + '.txt', text: '%\n' + ls.join('\n').replace(/^\n+|\n+$/g, '') + '\n%\n' }))
    .filter((f, i) => i === 0 || out[i].some(l => l.trim()));
}

/** Kanal tarafı: içerik "(MAIN TARAFI" / "(SUB TARAFI" ya da dosya adı -P1 / -P2 */
export function channelOf(name, text) {
  if (/\(\s*SUB\s+TARAFI/i.test(text)) return 2;
  if (/\(\s*MAIN\s+TARAFI/i.test(text)) return 1;
  if (/-P2\b|-P2\./i.test(name || '')) return 2;
  if (/-P1\b|-P1\./i.test(name || '')) return 1;
  return 0;
}

/** Birden çok dosya ([{name,text}]) → simülasyon metni. Tek dosya ya da zaten $1/$2 içeren dosya olduğu gibi döner. */
export function joinChannelFiles(files) {
  if (files.length === 1) return files[0].text.replace(/\r/g, '');
  const withHdr = files.find(f => /^\s*\$1\s*$/m.test(f.text));
  if (withHdr) return withHdr.text.replace(/\r/g, '');
  const slot = [null, null];
  const rest = [];
  for (const f of files) { const c = channelOf(f.name, f.text); if (c && !slot[c - 1]) slot[c - 1] = f; else rest.push(f); }
  for (const f of rest) { const i = slot.indexOf(null); if (i < 0) throw new Error('En fazla iki dosya (P1 + P2) açılabilir'); slot[i] = f; }
  return '%\n$1\n' + (slot[0] ? body(slot[0].text) : '') + '\n$2\n' + (slot[1] ? body(slot[1].text) : '') + '\n%\n';
}
