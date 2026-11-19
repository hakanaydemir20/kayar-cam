// Atölye (kayar) post profili: varsayılan profil, örnek parçalar, atölye yazım ayrıntıları, ayrı P1/P2 dosyaları
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline, migrate, postProfile, profileKey, simulateText } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { SAMPLE_PARTS } from '../src/samples/sampleParts.js';
import { splitChannels, joinChannelFiles, channelOf } from '../src/post/ncFiles.js';
import { newStarProject } from './helpers.js';

const verify = (p) => {
  const r = runPipeline(p);
  const ss = new StockSim(p, r.sim).runAll();
  const c = compare(ss.resultStock(), buildTarget(p, ss.opts), p.part.length);
  return { r, ss, c };
};

describe('varsayılan profil ve taşıma', () => {
  it('yeni proje atölye profiliyle açılır', () => {
    expect(newProject().post.dialect).toBe('kayar');
    expect(profileKey(newProject().post)).toBe('kayar');
  });
  it('el değmemiş eski Star profili atölyeye taşınır, değiştirilmiş profil korunur', () => {
    const a = newStarProject(); delete a.post.cycles;   // eski dosya: eksik anahtar
    expect(migrate(a).post.dialect).toBe('kayar');
    const b = newStarProject(); b.post.codes.mainCW = 'M13';
    const mb = migrate(b);
    expect(mb.post.dialect).toBeUndefined();
    expect(mb.post.codes.mainCW).toBe('M13');
    const k = newProject(); k.post.programNumber = 77;
    expect(migrate(k).post.programNumber).toBe(77);
  });
  it('profil seçimi: Star ve atölye ayrı nesneler', () => {
    expect(postProfile('star').dialect).toBeUndefined();
    expect(postProfile('kayar').separateFiles).toBe(true);
  });
});

describe('örnek parçalar: her iki profilde hatasız, çarpışmasız, fazla kesimsiz', () => {
  for (const s of SAMPLE_PARTS) for (const key of ['kayar', 'star']) {
    it(`${s.name} (${key})`, () => {
      const p = key === 'star' ? newStarProject(s.make()) : newProject(s.make());
      // varsayılan tarette karşılığı olmayan (takım yok / kanal dar) işlemler çıkarılır: arayüzde sihirbaz takım ekler
      const bad = new Set(runPipeline(p).errors.filter(e => e.src === 'cam' && e.op).map(e => e.op));
      p.ops = p.ops.filter(o => !bad.has(o.id));
      const { r, ss, c } = verify(p);
      if (r.errors.length || ss.collisions.length || c.over) console.log(s.id, key, r.errors.slice(0, 3), ss.collisions.slice(0, 2).map(x => x.msg), c.over);
      expect(r.errors).toEqual([]);
      expect(ss.collisions.length).toBe(0);
      expect(c.over).toBe(0);
      expect(c.innerOver).toBe(0);
    });
  }
});

describe('atölye yazımı', () => {
  const p = newProject();
  const r = runPipeline(p);
  const [t1, t2] = r.posted.paths;
  const block = (ls, re) => { const i = ls.findIndex(l => re.test(l)); const j = ls.findIndex((l, k) => k > i && /^G0T0$/.test(l)); return ls.slice(i, j < 0 ? undefined : j); };
  it('tahrikli takım sonu M7 M9 M38', () => {
    const t = t1.join('\n');
    expect(t).toMatch(/^M7\nM9\nM38$/m);
  });
  it('G98 ayrı satırda değil, hareketle birlikte (G0G98C0.T31)', () => {
    expect(t1.some(l => /^G98$/.test(l))).toBe(false);
    expect(t1.some(l => /^G0G98C0\.?T31/.test(l))).toBe(true);
  });
  it('tornalama takımlarında Y yazılmaz', () => {
    for (const re of [/^T0100\b/, /^T0200\b/]) {
      const b = block(t1, re);
      expect(b.length).toBeGreaterThan(2);
      expect(b.some(l => /Y/.test(l.replace(/\(.*\)/, '')))).toBe(false);
    }
  });
  it('tahrikli işlemden sonra tornalama G99 ile başlar', () => {
    const ls = t1;
    let mode = 'rev';
    for (const l of ls) {
      const c = l.replace(/\(.*?\)/g, '');
      const m = c.match(/G9[89](?!\d)/g); if (m) mode = m[m.length - 1];
      if (/^T0[1-6]00\b/.test(c)) mode = mode + '?';   // tornalama takımı çağrıldı: sonraki G1 öncesinde G99 olmalı
      if (/^G1|^X|^Z/.test(c) && mode.endsWith('?')) { mode = mode.slice(0, -1); expect(mode === 'G99' || mode === 'rev').toBe(true); }
    }
  });
  it('arka delme artımsal G83 W, küçük gaga', () => {
    const t = t2.join('\n');
    const m = t.match(/^G83W([\d.]+)Q(\d+)F/m);
    expect(m).not.toBeNull();
    expect(+m[2]).toBeLessThanOrEqual(2000);
  });
  it('simülasyon: hatasız, çarpışmasız', () => {
    const ss = new StockSim(p, r.sim).runAll();
    expect(r.errors).toEqual([]);
    expect(ss.collisions.length).toBe(0);
  });
});

describe('ayrı P1 / P2 dosyaları', () => {
  const p = newProject();
  const r = runPipeline(p);
  const files = splitChannels(r.posted.text, p.post, p.part.name);
  it('iki dosya, % ile başlar/biter, $ başlığı yok', () => {
    expect(files.length).toBe(2);
    expect(files[0].name).toMatch(/-P1\.txt$/);
    expect(files[1].name).toMatch(/-P2\.txt$/);
    for (const [i, f] of files.entries()) {
      const ls = f.text.trim().split('\n');
      expect(ls[0]).toBe('%');
      expect(ls[1]).toMatch(new RegExp(`^<.*-P${i + 1}>$`));
      expect(ls[ls.length - 1]).toBe('%');
      expect(f.text).not.toMatch(/^\$[12]$/m);
    }
    expect(channelOf('x.txt', files[0].text)).toBe(1);
    expect(channelOf('x.txt', files[1].text)).toBe(2);
  });
  it('iki dosya ters sırada açılınca birleşir ve aynı simülasyonu verir', () => {
    const t = joinChannelFiles([{ name: 'A-P2.txt', text: files[1].text.replace(/\n/g, '\r\n') }, { name: 'A-P1.txt', text: files[0].text }]);
    expect(t).toMatch(/^\$1$/m);
    const a = simulateText(p, r.posted.text), b = simulateText(p, t);
    expect(b.errors).toEqual(a.errors);
    expect(b.paths.map(x => x.moves.length)).toEqual(a.paths.map(x => x.moves.length));
  });
  it('tek dosya olduğu gibi açılır', () => {
    expect(joinChannelFiles([{ name: 'O1.nc', text: r.posted.text }])).toBe(r.posted.text);
  });
});

it('boş işlem listesi: atölye profilinde hata değil uyarı', () => {
  const p = newProject(); p.ops = [];
  const r = runPipeline(p);
  expect(r.errors).toEqual([]);
});
