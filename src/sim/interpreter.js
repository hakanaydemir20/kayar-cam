// G-kod yorumlayıcı: modal durum, hareketler, süreler, kanal senkronizasyonu ve hata kontrolü.
// Simülasyon ve doğrulama YALNIZCA bu yorumlanmış hareketleri kullanır.
import { parseProgram, normCode } from './gcodeParser.js';
import { makeFrames } from './frames.js';

const EPS = 1e-6;

function buildMMap(profile) {
  const map = {};
  for (const [k, v] of Object.entries(profile.codes)) map[normCode(v)] = k;
  return map;
}

function spindleKeyFor(sel, profile, ch = 1) {
  const a = profile.spindleAddress;
  // $2'de tahrikli takım adresi arka ünite tahrikini sürer (backLive adresi ayrıca tanımlanmadıysa live ile aynı)
  if (ch === 2) {
    const bl = /^S(\d+)=$/.exec(a.backLive || a.live || '');
    if (bl && +bl[1] === sel) return 'backLive';
  }
  for (const [k, v] of Object.entries(a)) {
    if (k === 'backLive') continue;
    const m = /^S(\d+)=$/.exec(v);
    if (m && +m[1] === sel) return k;
  }
  return null;
}

export function interpret(text, ctx) {
  const { profile, machine, tools } = ctx;
  const frames = ctx.frames || makeFrames({ L: 30, grip: 5 });
  const mmap = buildMMap(profile);
  const parsed = parseProgram(text);
  const errors = [], warnings = [];
  const toolByNum = new Map(tools.map(t => [t.num, t]));
  const waitBase = profile.waitStart;
  const waitRe = new RegExp('^' + profile.waitCode.replace('{n}', '(\\d+)') + '$');

  const result = parsed.paths.map((p, pi) => runPath(p, pi));

  function runPath(path, pi) {
    const ch = pi + 1;
    const moves = [];
    const S = {
      pos: { X: ch === 1 ? profile.safeX : 0, Y: 0, Z: ch === 1 ? -1 : (machine.subHomeZ ?? 200), C: 0 }, // karşı iş mili park konumunda başlar
      motion: 'G0', plane: 'zx', feedMode: 'rev', F: null, wo: ch === 1 ? 'G54' : 'G54',
      css: false, vc: 0, maxRpm: Infinity,
      spindle: { main: { dir: 'stop', rpm: 0 }, sub: { dir: 'stop', rpm: 0 }, live: { dir: 'stop', rpm: 0 }, backLive: { dir: 'stop', rpm: 0 } },
      tool: null, toolCode: null, cAxis: false, subCAxis: false, coolant: false,
      g92Start: null,
      cylR: 0,          // G7.1 silindirik interpolasyon yarıçapı (0 = kapalı)
      extZ: 0,          // G10 P0 Z iş kaydırması ($1): makine Z = program Z + extZ
      polar: false,     // G12.1 polar interpolasyon
      hyp: null,        // polar modda hipotetik konum {x, y} (mm)
    };
    const err = (li, msg) => errors.push({ path: ch, line: li, msg });
    const warn = (li, msg) => warnings.push({ path: ch, line: li, msg });

    const workSpindle = () => (ch === 1 ? 'main' : 'sub');
    const curRpm = (li) => {
      const sp = S.spindle[workSpindle()];
      if (sp.dir === 'stop') return 0;
      if (S.css) {
        const d = Math.max(Math.abs(S.pos.X), 0.5);
        return Math.min(S.maxRpm, (S.vc * 1000) / (Math.PI * d), ch === 1 ? machine.mainSpindle.maxRpm : machine.subSpindle.maxRpm);
      }
      return sp.rpm;
    };
    const feedMmMin = (li, isThread = false) => {
      if (S.F == null || S.F <= 0) { err(li, 'İlerleme (F) tanımsız veya sıfır'); return 100; }
      if (S.feedMode === 'min' && !isThread) return S.F;
      const rpm = curRpm(li);
      if (rpm <= 0) { err(li, 'Devir başına ilerleme var ama iş mili duruyor'); return 100; }
      return S.F * rpm;
    };
    const snapshot = () => ({
      tool: S.tool, toolCode: S.toolCode, wo: S.wo, plane: S.plane,
      main: { ...S.spindle.main }, sub: { ...S.spindle.sub }, live: { ...S.spindle.live }, backLive: { ...S.spindle.backLive },
      coolant: S.coolant, cAxis: S.cAxis, subCAxis: S.subCAxis, cylR: S.cylR, polar: S.polar, extZ: S.extZ,
    });
    const rapidTime = (pa, pb) => {
      const a = toM(pa), b = toM(pb);
      const d = Math.max(Math.abs(b.X - a.X) / (ch === 1 ? 2 : 1), Math.abs(b.Y - a.Y), Math.abs(b.Z - a.Z));
      const c = Math.abs(b.C - a.C) / 360 * 0.15; // C indeksleme ~0.15 s/tur
      return Math.max(d / machine.rapid * 60, c) + 0.02;
    };
    const toM = (pos) => frames.toMachine(ch, pos, { tool: S.tool, wo: S.wo, extZ: S.extZ });
    const pushMove = (m) => { moves.push({ ...m, path: ch, state: snapshot(), mFrom: toM(m.from), mTo: toM(m.to) }); };
    const checkLimits = (li, ppos) => {
      const ax = machine.axes;
      const pos = toM(ppos);
      if (ch === 1) {
        if (pos.Z < ax.Z1.min - EPS || pos.Z > ax.Z1.max + EPS) err(li, `Z1 strok dışı: ${pos.Z.toFixed(3)} (sınır ${ax.Z1.min}..${ax.Z1.max})`);
        if (pos.X < ax.X1.min - EPS || pos.X > ax.X1.max + EPS) err(li, `X1 strok dışı: ${pos.X.toFixed(3)}`);
        if (pos.Y < ax.Y1.min - EPS || pos.Y > ax.Y1.max + EPS) err(li, `Y1 strok dışı: ${pos.Y.toFixed(3)}`);
      } else {
        if (pos.Z < ax.Z2.min - EPS || pos.Z > ax.Z2.max + EPS) err(li, `Z2 strok dışı (makine): ${pos.Z.toFixed(3)}`);
        if (pos.X < ax.X2.min - EPS || pos.X > ax.X2.max + EPS) err(li, `X2 strok dışı (makine): ${pos.X.toFixed(3)}`);
      }
    };
    const requireCutReady = (li) => {
      const t = S.tool;
      if (!t && ch === 2) return; // karşı iş mili transfer hareketi (takımsız)
      if (!t) { err(li, 'Takım çağrılmadan kesme hareketi'); return; }
      if (t.live) {
        const key = t.unit === 'back' ? 'backLive' : 'live';
        if (S.spindle[key].dir === 'stop') err(li, `Tahrikli takım (${t.name}) dönmüyor`);
      } else if (S.spindle[workSpindle()].dir === 'stop' && !(t.type === 'thread' || t.type === 'tap')) {
        err(li, 'İş mili dönmüyor');
      }
    };

    path.lines.forEach((ln, li) => {
      if (ln.empty) return;
      for (const e of ln.errors || []) err(li, e);
      const w = ln.words;
      if (!w.length) return;
      // ön geçiş: takım ve iş koordinatı değişimi (makine yerinde kalır, program koordinatı değişir)
      for (const wd of w) {
        const isWo = wd.a === 'G' && (wd.v === 54 || wd.v === 55 || wd.v === 56);
        if (wd.a !== 'T' && !isWo) continue;
        const mach = toM(S.pos);
        if (isWo) S.wo = 'G' + wd.v;
        else {
          const num = Math.floor(wd.v / 100);
          const t = toolByNum.get(num);
          if (!t) err(li, `Tanımsız takım T${wd.raw}`);
          else if (t.channel !== ch) err(li, `${t.name} ${ch}. kanalda kullanılamaz (takım ${t.channel}. kanalda)`);
          S.tool = t || null; S.toolCode = wd.raw;
        }
        S.pos = frames.fromMachine(ch, mach, { tool: S.tool, wo: S.wo, extZ: S.extZ });
      }
      // G10 P0 Z: iş kaydırması (makine yerinde kalır, program koordinatı değişir)
      if (w.some(wd => wd.a === 'G' && wd.v === 10)) {
        const pw = w.find(wd => wd.a === 'P'), zw = w.find(wd => wd.a === 'Z');
        if (!pw || pw.v !== 0 || !zw) { err(li, 'G10 yalnız "G10 P0 Z…" (iş kaydırması) olarak desteklenir'); return; }
        if (ch !== 1) { err(li, 'İş kaydırması yalnız $1'); return; }
        const mach = toM(S.pos);
        S.extZ = zw.v;
        S.pos = frames.fromMachine(ch, mach, { tool: S.tool, wo: S.wo, extZ: S.extZ });
        pushMove({ kind: 'event', line: li, event: 'workShift', from: { ...S.pos }, to: { ...S.pos }, dur: 0.05 });
        return;
      }
      const target = { ...S.pos };
      let hasAxis = false, motion = null, arcC = {}, dwell = null, cycle = null;
      const mcodes = [];
      const isG = (v) => w.some(wd => wd.a === 'G' && Math.abs(wd.v - v) < 1e-9);
      const cylLine = isG(7.1);
      const hypT = S.polar ? { ...S.hyp } : null;   // polar: hipotetik hedef
      for (const wd of w) {
        switch (wd.a) {
          case 'O': case 'N': break;
          case 'G': {
            const g = normCode('G' + wd.raw.replace(/^0+(?=\d)/, ''));
            const gv = wd.v;
            if ([0, 1, 2, 3, 32, 92].includes(gv)) motion = 'G' + gv;
            else if (gv === 4) dwell = 0;
            else if (Math.abs(gv - 7.1) < 1e-9) { /* C kelimesi yarıçap (aşağıda) */ }
            else if (Math.abs(gv - 12.1) < 1e-9) {
              if (!S.polar) { const rr = S.pos.X / 2, a = (S.pos.C || 0) * Math.PI / 180; S.hyp = { x: rr * Math.cos(a), y: rr * Math.sin(a) }; }
              S.polar = true;
              if (ch === 1 ? !S.cAxis : !S.subCAxis) err(li, 'G12.1 için C ekseni modu açık olmalı');
            }
            else if (Math.abs(gv - 13.1) < 1e-9) { S.polar = false; S.hyp = null; }
            else if (gv === 17) S.plane = 'xy';
            else if (gv === 18) S.plane = 'zx';
            else if (gv === 19) S.plane = 'yz';
            else if (gv === 96) S.css = true;
            else if (gv === 97) S.css = false;
            else if (gv === 98) S.feedMode = 'min';
            else if (gv === 99) S.feedMode = 'rev';
            else if (gv === 50) S._g50 = true;
            else if (gv === 54 || gv === 55 || gv === 56) { /* ön geçişte işlendi */ }
            else if (gv === 83 || gv === 84 || gv === 76) cycle = gv;
            else if (gv === 80) { S.rigid = false; }
            else if ([21, 40].includes(gv)) { /* güvenli varsayılanlar */ }
            else warn(li, 'Simülasyonda desteklenmeyen G kodu: ' + g);
            break;
          }
          case 'C':
            if (cylLine) {
              S.cylR = wd.v;
              if (wd.v > 0 && (ch === 1 ? !S.cAxis : !S.subCAxis)) err(li, 'G7.1 için C ekseni modu açık olmalı');
              break;
            }
            if (S.polar) { hypT.y = wd.v; hasAxis = true; break; }
            target.C = wd.v; hasAxis = true; break;
          case 'X':
            if (S.polar && hypT) { hypT.x = wd.v / 2; hasAxis = true; break; }
            target.X = wd.v; hasAxis = true; break;
          case 'Y': case 'Z':
            target[wd.a] = wd.v; hasAxis = true; break;
          case 'U': if (dwell != null) dwell = wd.v; else { target.X = S.pos.X + wd.v; hasAxis = true; } break;
          case 'W': target.Z = S.pos.Z + wd.v; hasAxis = true; break;
          case 'P': if (dwell != null) dwell = wd.v / 1000; break;
          case 'I': arcC.I = wd.v; break;
          case 'J': arcC.J = wd.v; break;
          case 'K': arcC.K = wd.v; break;
          case 'R': arcC.R = wd.v; break;
          case 'F': S.F = wd.v; break;
          case 'S': {
            let key = wd.sel != null ? spindleKeyFor(wd.sel, profile, ch) : workSpindle();
            if (!key) { err(li, 'Bilinmeyen iş mili seçimi S' + wd.sel); break; }
            if (S._g50) { S.maxRpm = wd.v; S._g50 = false; }
            else if (S.css && (key === 'main' || key === 'sub')) S.vc = wd.v;
            else S.spindle[key].rpm = wd.v;
            S._lastSKey = key;
            break;
          }
          case 'T': break; // ön geçişte işlendi
          case 'Q': break; // çevrim parametresi (aşağıda)
          case 'M': mcodes.push(normCode('M' + wd.v)); break;
          default: warn(li, 'Desteklenmeyen adres: ' + wd.a);
        }
      }

      // M kodları
      for (const mc of mcodes) {
        const wm = waitRe.exec(mc);
        if (wm && +wm[1] >= waitBase && +wm[1] < waitBase + 100 && !mmap[mc]) { pushMove({ kind: 'wait', line: li, n: +wm[1] - waitBase, from: { ...S.pos }, to: { ...S.pos }, dur: 0 }); continue; }
        const key = mmap[mc];
        if (!key) { warn(li, 'Profilde tanımsız M kodu: ' + mc); continue; }
        const set = (sp, dir) => {
          S.spindle[sp].dir = dir;
          if (dir !== 'stop') {
            let rpm = S.css && (sp === 'main' || sp === 'sub') ? curRpm(li) : S.spindle[sp].rpm;
            const lim = sp === 'main' ? machine.mainSpindle.maxRpm : sp === 'sub' ? machine.subSpindle.maxRpm : sp === 'live' ? machine.liveTools.cross.maxRpm : machine.liveTools.back.maxRpm;
            if (!S.css && rpm > lim) err(li, `${sp} devir ${rpm} > makine limiti ${lim}`);
            if (!S.css && !(rpm > 0)) err(li, `${sp} için devir (S) tanımsız`);
            if (S.css && S.maxRpm === Infinity) warn(li, 'G96 için G50 devir limiti tanımlanmamış');
          }
        };
        switch (key) {
          case 'mainCW': set('main', 'cw'); break; case 'mainCCW': set('main', 'ccw'); break; case 'mainStop': set('main', 'stop'); break;
          case 'subCW': set('sub', 'cw'); break; case 'subCCW': set('sub', 'ccw'); break; case 'subStop': set('sub', 'stop'); break;
          case 'liveCW': set('live', 'cw'); break; case 'liveCCW': set('live', 'ccw'); break; case 'liveStop': set('live', 'stop'); break;
          case 'backLiveCW': set('backLive', 'cw'); break; case 'backLiveCCW': set('backLive', 'ccw'); break; case 'backLiveStop': set('backLive', 'stop'); break;
          case 'coolantOn': case 'backCoolantOn': S.coolant = true; break;
          case 'coolantOff': case 'backCoolantOff': S.coolant = false; break;
          case 'mainCAxisOn': S.cAxis = true; break; case 'mainCAxisOff': S.cAxis = false; break;
          case 'rigidTap': S.rigid = true; break;
          case 'subCAxisOn': S.subCAxis = true; break; case 'subCAxisOff': S.subCAxis = false; break;
        }
        pushMove({ kind: 'event', line: li, event: key, from: { ...S.pos }, to: { ...S.pos }, dur: eventTime(key) });
      }

      if (dwell != null) { pushMove({ kind: 'dwell', line: li, from: { ...S.pos }, to: { ...S.pos }, dur: dwell }); return; }
      if (cycle) { runCycle(li, cycle, w); return; }
      if (motion) S.motion = motion;
      if (!hasAxis) return;
      if (S.polar) { polarMove(li, hypT, target); return; }
      if (target.C !== S.pos.C && S.tool && (ch === 1 ? !S.cAxis : !S.subCAxis)) err(li, 'C ekseni modu kapalıyken C hareketi');
      checkLimits(li, target);
      const from = { ...S.pos };

      switch (S.motion) {
        case 'G0':
          pushMove({ kind: 'rapid', line: li, from, to: { ...target }, dur: rapidTime(from, target) });
          break;
        case 'G1': {
          requireCutReady(li);
          const L = dist(from, target, S.cylR);
          const f = feedMmMin(li);
          pushMove({ kind: 'feed', line: li, from, to: { ...target }, feed: f, rpm: curRpm(li), dur: (L / f) * 60 });
          break;
        }
        case 'G2': case 'G3': {
          requireCutReady(li);
          const a = arcGeom(S.plane, from, target, arcC, S.motion === 'G2', li);
          if (!a) break;
          const f = feedMmMin(li);
          pushMove({ kind: 'arc', line: li, from, to: { ...target }, arc: a, feed: f, rpm: curRpm(li), dur: (a.length / f) * 60 });
          break;
        }
        case 'G32': {
          const f = feedMmMin(li, true);
          pushMove({ kind: 'thread', line: li, from, to: { ...target }, feed: f, rpm: curRpm(li), dur: (dist(from, target) / f) * 60 });
          break;
        }
        case 'G92': {
          // tek paso diş çevrimi: X'e hızlı, Z boyunca diş, X geri, Z geri
          const start = S.g92Start && S._inG92 ? S.g92Start : { ...from };
          S.g92Start = start; S._inG92 = true;
          const p1 = { ...start, X: target.X };
          const p2 = { ...p1, Z: target.Z };
          const p3 = { ...p2, X: start.X };
          const f = feedMmMin(li, true);
          if (S.spindle[workSpindle()].dir === 'stop') err(li, 'Diş çekerken iş mili duruyor');
          pushMove({ kind: 'rapid', line: li, from: { ...start }, to: p1, dur: rapidTime(start, p1) });
          pushMove({ kind: 'thread', line: li, from: p1, to: p2, feed: f, rpm: curRpm(li), dur: (dist(p1, p2) / f) * 60 });
          pushMove({ kind: 'rapid', line: li, from: p2, to: p3, dur: rapidTime(p2, p3) });
          pushMove({ kind: 'rapid', line: li, from: p3, to: { ...start }, dur: rapidTime(p3, start) });
          S.pos = { ...start };
          return;
        }
      }
      if (S.motion !== 'G92') S._inG92 = false;
      S.pos = target;
    });

    /** Sabit çevrimler (post'un yazdığı biçim): G83 Z R Q F (R0), G84 Z R F (M29 rijit), G76 iki blok */
    function runCycle(li, code, w) {
      const v = (a) => { const wd = w.find(x => x.a === a); return wd ? wd.v : null; };
      const raw = (a) => { const wd = w.find(x => x.a === a); return wd ? wd.raw : null; };
      const push = (kind, a, b, extra = {}) => {
        const dur = kind === 'rapid' ? rapidTime(a, b) : (dist(a, b) / extra.feed) * 60;
        pushMove({ kind, line: li, from: { ...a }, to: { ...b }, dur, ...extra });
      };
      if (code === 76) {
        if (v('X') == null || v('Z') == null) {
          const pr = String(raw('P') || '').replace(/\..*/, '').padStart(6, '0');
          S.g76 = { m: +pr.slice(0, 2), r: +pr.slice(2, 4), a: +pr.slice(4, 6), dmin: (v('Q') ?? 0) / 1000, d: v('R') ?? 0 };
          return;
        }
        if (!S.g76) { err(li, 'G76 ikinci blok: önce ilk blok (G76 P… Q… R…) gerekli'); return; }
        if (S.spindle[workSpindle()].dir === 'stop') err(li, 'Diş çekerken iş mili duruyor');
        const k = (v('P') ?? 0) / 1000, d1 = (v('Q') ?? 0) / 1000, Xr = v('X'), Zend = v('Z');
        const { m, dmin, d } = S.g76;
        if (!(k > 0) || !(d1 > 0)) { err(li, 'G76: diş yüksekliği (P) ve ilk paso (Q) > 0 olmalı'); return; }
        const start = { ...S.pos };
        if (Xr >= start.X) { err(li, 'G76: yalnız dış diş (X başlangıç noktasından küçük) desteklenir'); return; }
        checkLimits(li, { ...start, X: Xr, Z: Zend });
        const f = feedMmMin(li, true), rpm = curRpm(li);
        const depths = [];
        for (let n = 1, prev = 0; ; n++) {
          let dn = d1 * Math.sqrt(n);
          if (dn - prev < dmin) dn = prev + dmin;
          if (dn >= k - d - 1e-9) { if (k - d > prev + 1e-9) depths.push(k - d); break; }
          depths.push(dn); prev = dn;
        }
        for (let j = 0; j < Math.max(1, m); j++) depths.push(k);
        const Xc = Xr + 2 * k;                      // diş tepe çapı
        for (const dn of depths) {
          const p1 = { ...start, X: Xc - 2 * dn }, p2 = { ...p1, Z: Zend }, p3 = { ...p2, X: start.X };
          push('rapid', start, p1);
          pushMove({ kind: 'thread', line: li, from: p1, to: p2, feed: f, rpm, dur: (dist(p1, p2) / f) * 60 });
          push('rapid', p2, p3); push('rapid', p3, start);
        }
        S.pos = start;
        return;
      }
      // G83 / G84: Z ekseninde (ön/arka eksenel)
      const zb = v('Z'), R = v('R') ?? 0;
      if (zb == null) { err(li, `G${code}: Z (delik dibi) gerekli`); return; }
      const z0 = S.pos.Z, zr = z0 + R, dir = Math.sign(zb - zr) || 1;
      checkLimits(li, { ...S.pos, Z: zb });
      requireCutReady(li);
      const at = (z) => ({ ...S.pos, Z: z });
      if (zr !== z0) push('rapid', at(z0), at(zr));
      if (code === 83) {
        const q = (v('Q') ?? 0) / 1000;
        if (!(q > 0)) { err(li, 'G83: gagalama (Q) > 0 olmalı'); return; }
        const clr = profile.peckClearance ?? 0.2, f = feedMmMin(li), rpm = curRpm(li);
        let z = zr;
        while (dir * (zb - z) > 1e-9) {
          const zn = dir > 0 ? Math.min(zb, z + q) : Math.max(zb, z - q);
          const zs = z === zr ? zr : z - dir * clr;
          if (zs !== zr) push('rapid', at(zr), at(zs));
          push('feed', at(zs), at(zn), { feed: f, rpm });
          push('rapid', at(zn), at(zr));
          z = zn;
        }
      } else {
        if (!S.rigid) { err(li, 'G84 rijit kılavuz için önce M29 S… gerekli'); return; }
        const sp = S.spindle[workSpindle()];
        if (!(sp.rpm > 0)) { err(li, 'M29 için devir (S) tanımsız'); return; }
        if (S.feedMode !== 'rev') warn(li, 'G84: G99 (devir başına) ile F = hatve olmalı');
        const f = (S.F || 0) * sp.rpm;
        push('feed', at(zr), at(zb), { feed: f, rpm: sp.rpm });
        push('feed', at(zb), at(zr), { feed: f, rpm: sp.rpm });
      }
      if (zr !== z0) push('rapid', at(zr), at(z0));
      S.pos = at(z0);
    }

    /** Polar interpolasyon (G12.1): hipotetik (x, y) doğrusu → gerçek X (çap) / C (derece), küçük adımlarla */
    function polarMove(li, hT, target) {
      if (S.motion === 'G2' || S.motion === 'G3') { err(li, 'Polar modda G2/G3 desteklenmiyor'); return; }
      if (S.motion !== 'G0' && S.motion !== 'G1') { err(li, 'Polar modda yalnız G0/G1'); return; }
      const h0 = S.hyp, len = Math.hypot(hT.x - h0.x, hT.y - h0.y, (target.Z ?? S.pos.Z) - S.pos.Z);
      const n = Math.max(1, Math.ceil(Math.hypot(hT.x - h0.x, hT.y - h0.y) / 0.25));
      const feed = S.motion === 'G1' ? feedMmMin(li) : 0;
      if (S.motion === 'G1') requireCutReady(li);
      let prev = { ...S.pos };
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const x = h0.x + (hT.x - h0.x) * t, y = h0.y + (hT.y - h0.y) * t;
        const rho = Math.hypot(x, y);
        if (rho < 0.05) err(li, 'Polar interpolasyon merkezden geçiyor (C hızı sınırsız)');
        let c = Math.atan2(y, x) * 180 / Math.PI;
        while (c - prev.C > 180) c -= 360;
        while (c - prev.C < -180) c += 360;
        const cur = { ...prev, X: 2 * rho, C: c, Z: S.pos.Z + ((target.Z ?? S.pos.Z) - S.pos.Z) * t };
        checkLimits(li, cur);
        const segL = len / n;
        if (S.motion === 'G0') pushMove({ kind: 'rapid', line: li, from: prev, to: { ...cur }, dur: rapidTime(prev, cur) });
        else pushMove({ kind: 'feed', line: li, from: prev, to: { ...cur }, feed, rpm: curRpm(li), dur: (segL / feed) * 60 });
        prev = cur;
      }
      S.pos = prev;
      S.hyp = { x: hT.x, y: hT.y };
    }

    function arcGeom(plane, a, b, c, cw, li) {
      let u0, v0, u1, v1, cu, cv, axU, axV, axW;
      if (plane === 'zx') { axU = 'Z'; axV = 'X'; axW = 'Y'; u0 = a.Z; v0 = a.X / 2; u1 = b.Z; v1 = b.X / 2; cu = u0 + (c.K || 0); cv = v0 + (c.I || 0); }
      else if (plane === 'yz') { axU = 'Y'; axV = 'Z'; axW = 'X'; u0 = a.Y; v0 = a.Z; u1 = b.Y; v1 = b.Z; cu = u0 + (c.J || 0); cv = v0 + (c.K || 0); }
      else { axU = 'X'; axV = 'Y'; axW = 'Z'; u0 = a.X / 2; v0 = a.Y; u1 = b.X / 2; v1 = b.Y; cu = u0 + (c.I || 0); cv = v0 + (c.J || 0); }
      if (c.R != null) { err(li, 'R ile yay desteklenmiyor, I/J/K kullanın'); return null; }
      const r0 = Math.hypot(u0 - cu, v0 - cv), r1 = Math.hypot(u1 - cu, v1 - cv);
      if (Math.abs(r0 - r1) > 0.002) { err(li, `Yay yarıçap tutarsız: başlangıç ${r0.toFixed(4)} bitiş ${r1.toFixed(4)}`); return null; }
      const t0 = Math.atan2(v0 - cv, u0 - cu);
      let t1 = Math.atan2(v1 - cv, u1 - cu);
      let sweep = t1 - t0;
      const same = Math.abs(u0 - u1) < 1e-7 && Math.abs(v0 - v1) < 1e-7;
      if (cw) {
        if (same) sweep = -2 * Math.PI;
        else { while (sweep >= 0) sweep -= 2 * Math.PI; while (sweep < -2 * Math.PI) sweep += 2 * Math.PI; }
      } else {
        if (same) sweep = 2 * Math.PI;
        else { while (sweep <= 0) sweep += 2 * Math.PI; while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI; }
      }
      const dw = (b[axW] ?? 0) - (a[axW] ?? 0);
      const wScale = axW === 'X' ? 0.5 : 1;
      const length = Math.hypot(Math.abs(sweep) * r0, dw * wScale);
      return { plane, cu, cv, r: r0, t0, sweep, axU, axV, axW, length };
    }

    return { header: path.header, lines: path.lines, moves };
  }

  // ---- Kanal senkronizasyonu ----
  schedule(result, errors);
  return { paths: result, errors, warnings };
}

function eventTime(key) {
  if (/Chuck/.test(key)) return 0.4;
  if (/CW|CCW/.test(key)) return 0.3;
  if (/AxisOn|AxisOff/.test(key)) return 0.3;
  if (key === 'partEject') return 0.5;
  return 0.05;
}

function dist(a, b, cylR = 0) {
  const c = cylR > 0 ? ((b.C - a.C) * Math.PI / 180) * cylR : 0;  // G7.1: yüzey boyunca
  return Math.hypot((b.X - a.X) / 2, b.Y - a.Y, b.Z - a.Z, c);
}

/** Bekleme kodlarına göre iki kanalın zaman çizelgesini hizalar; t0/t1 atar. */
export function schedule(paths, errors) {
  const P = paths.map(p => ({ p, i: 0, t: 0 }));
  let guard = 0;
  while (P.some(s => s.i < s.p.moves.length)) {
    if (++guard > 1e7) { errors.push({ path: 0, line: 0, msg: 'Senkronizasyon döngüsü' }); break; }
    let progressed = false;
    for (const s of P) {
      while (s.i < s.p.moves.length && s.p.moves[s.i].kind !== 'wait') {
        const m = s.p.moves[s.i];
        m.t0 = s.t; s.t += m.dur; m.t1 = s.t; s.i++; progressed = true;
      }
    }
    const waiting = P.filter(s => s.i < s.p.moves.length);
    if (!waiting.length) break;
    if (waiting.length < P.length) {
      for (const s of waiting) {
        const m = s.p.moves[s.i];
        errors.push({ path: m.path, line: m.line, msg: `Bekleme ${m.n} eşleşmedi (diğer kanal bitti)` });
        m.t0 = m.t1 = s.t; s.i++;
      }
      continue;
    }
    const ns = waiting.map(s => s.p.moves[s.i].n);
    if (ns.every(n => n === ns[0])) {
      const T = Math.max(...waiting.map(s => s.t));
      for (const s of waiting) { const m = s.p.moves[s.i]; m.t0 = s.t; m.t1 = T; s.t = T; s.i++; }
    } else {
      // kilitlenme: farklı beklemeler
      const s = waiting[0];
      const m = s.p.moves[s.i];
      errors.push({ path: m.path, line: m.line, msg: `Bekleme kilitlenmesi: kanallar farklı beklemede (${ns.join(' / ')})` });
      for (const w of waiting) { const mm = w.p.moves[w.i]; mm.t0 = mm.t1 = w.t; w.i++; }
    }
    if (!progressed && !waiting.length) break;
  }
  for (const s of P) s.p.totalTime = s.t;
}

/** Yay üzerinde t∈[0,1] noktası */
export function arcPoint(m, t) {
  const a = m.arc;
  const th = a.t0 + a.sweep * t;
  const u = a.cu + a.r * Math.cos(th), v = a.cv + a.r * Math.sin(th);
  const p = { ...m.from };
  const lerpW = (m.from[a.axW] ?? 0) + ((m.to[a.axW] ?? 0) - (m.from[a.axW] ?? 0)) * t;
  if (a.plane === 'zx') { p.Z = u; p.X = v * 2; p.Y = lerpW; }
  else if (a.plane === 'yz') { p.Y = u; p.Z = v; p.X = lerpW; }
  else { p.X = u * 2; p.Y = v; p.Z = lerpW; }
  p.C = m.from.C + (m.to.C - m.from.C) * t;
  return p;
}

export function movePoint(m, t) {
  if (m.kind === 'arc') return arcPoint(m, t);
  const p = {};
  for (const k of ['X', 'Y', 'Z', 'C']) p[k] = m.from[k] + (m.to[k] - m.from[k]) * t;
  return p;
}
