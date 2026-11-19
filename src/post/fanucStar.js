// FANUC 0i-TF (Star SB-20R G) post-processor.
// IR → G-kod metni. Bütün makineye özel kodlar postProfile.json'dan gelir.

const TR = { 'ç': 'C', 'Ç': 'C', 'ğ': 'G', 'Ğ': 'G', 'ı': 'I', 'İ': 'I', 'ö': 'O', 'Ö': 'O', 'ş': 'S', 'Ş': 'S', 'ü': 'U', 'Ü': 'U', 'Ø': 'D', 'ø': 'D', '°': 'DEG', '×': 'X', '—': '-', '–': '-', '·': '-' };

/** FANUC panelinde yorumlar: büyük harf ASCII, parantez yok */
export function cleanComment(s) {
  let out = '';
  for (const ch of String(s)) out += TR[ch] ?? ch;
  out = out.toUpperCase().replace(/[()]/g, '').replace(/[^A-Z0-9 .,:=+\-*/#%_]/g, '');
  return out.slice(0, 60).trim();
}

/** Sayı formatı: ondalık nokta HER ZAMAN (Fanuc'ta X12 = 0.012 mm olabilir!) */
export function fmt(v, dec = 3) {
  if (!Number.isFinite(v)) throw new Error('Geçersiz sayı: ' + v);
  let s = (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
  if (s.includes('.')) s = s.replace(/0+$/, '');
  if (s === '-0.' ) s = '0.';
  if (/^-?0\.$/.test(s)) s = '0.';
  return s;
}

function fmtInt(v) { return String(Math.round(v)); }

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)(?::(\d+))?\}/g, (_, k, w) => {
    const v = vars[k];
    return w ? String(v).padStart(+w, '0') : String(v);
  });
}

export function waitCode(profile, n) {
  return fillTemplate(profile.waitCode, { n: profile.waitStart + n });
}

/**
 * @param {Prog[]} progs  kanal başına IR (index 0 → $1, 1 → $2)
 * @returns {{text:string, paths:string[][], lineMap:Array<Array<{opId}>>}}
 */
/** Aynı kodla eşdeğer işlevler (her kanal kendi soğutmasını açar/kapar) — bunlar dışında bir M kodu tek işleve aittir */
const SAME_MEANING = [['coolantOn', 'backCoolantOn'], ['coolantOff', 'backCoolantOff']];
/** Post profilindeki çakışan kodlar: aynı M kodu birden çok işleve atanmışsa makine (ve simülasyon) yanlış işlevi çalıştırır */
export function profileConflicts(profile) {
  const by = new Map();
  for (const [k, v] of Object.entries(profile.codes || {})) {
    const c = String(v || '').trim().toUpperCase().replace(/^M0*(\d)/, 'M$1');
    if (!c) continue;
    (by.get(c) || by.set(c, []).get(c)).push(k);
  }
  const out = [];
  for (const [c, ks] of by) {
    if (ks.length < 2) continue;
    if (SAME_MEANING.some(g => ks.every(k => g.includes(k)))) continue;
    out.push({ code: c, keys: ks });
  }
  return out;
}

export function postProcess(progs, profile, meta = {}) {
  const bad = profileConflicts(profile);
  if (bad.length) throw new Error('Post profili: aynı kod birden çok işleve atanmış — ' + bad.map(b => `${b.code} = ${b.keys.join(' / ')}`).join('; ') + '. Ayarlar → Post ve makine bölümünden düzeltin.');
  const paths = [];
  const lineInfo = [];
  const allChecks = [];
  progs.forEach((prog, pi) => {
    const { lines, info, checks } = postPath(prog, profile, meta, pi);
    paths.push(lines);
    lineInfo.push(info);
    allChecks.push(checks);
  });
  let text;
  if (profile.twoPath) {
    text = paths.map((ls, i) => [profile.pathHeader[i], ...ls].join('\n')).join('\n');
  } else {
    text = paths[0].join('\n');
  }
  return { text: '%\n' + text + '\n%\n', paths, lineInfo, checks: allChecks };
}

/** Atölye (kayar) yazımında takımın programdaki numarası: ön delme kolonu T35-k → T1k */
export function kayarToolNum(t) { return t.unit === 'front' && t.num === 35 ? 10 + (t.offset || 1) : t.num; }

function postPath(prog, P, meta, pi) {
  const K = P.dialect === 'kayar';
  const C = K && pi === 1 ? { ...P.codes, ...(P.codes2 || {}) } : P.codes;
  let kTool = null, kPend = null, kClamp = false;   // kayar: aktif takım, uygulanacak ofset, C kilidi
  let kFeed = '';     // kayar: G98/G99 tek satırda yazılmaz, sonraki hareket satırına eklenir (G0G98C0T31)
  let kCool = false;  // kayar: soğutma açık mı (tahrikli takım sonunda M7 M9 M38)
  const dec = P.decimals ?? 3;
  const lines = [];
  const info = [];
  const checks = [];           // öz-kontrol: amaçlanan konum ↔ satır
  let intent = {};
  let curOp = null;
  let n = 0;
  const st = { motion: null, F: null, plane: null, feedMode: null, pos: {}, wo: null };
  let skipping = null;        // kapalı işlem: { st, intent } — bölge sonunda modal durum geri yüklenir
  const emit = (s, keepBlank = false) => {
    if (!s && !keepBlank) return;
    if (K && s && !s.startsWith('(')) { const i = s.indexOf('('); const code = i >= 0 ? s.slice(0, i) : s; s = code.replace(/\s+/g, '') + (i >= 0 ? s.slice(i) : ''); }
    if (K && kFeed && s && /^[GXZYCUWIK]/.test(s) && !/^G0T0|^G28|^G4[A-Z]/.test(s)) { s = /^G[0-3](?!\d)/.test(s) ? s.replace(/^(G[0-3])/, '$1' + kFeed) : kFeed + s; kFeed = ''; }
    if (P.lineNumbers && s && !s.startsWith('(') && !s.startsWith('O')) { n += P.lineStep; s = 'N' + n + ' ' + s; }
    if (skipping && s) s = (P.blockSkip || '/') + s;
    lines.push(s);
    info.push({ opId: curOp });
  };
  const axisWords = (pos, force = false) => {
    let w = '';
    for (const a of ['X', 'Y', 'Z', 'C']) {
      if (pos[a] == null) continue;
      // iş parçası sıfır kaydırması (yalnızca $1 Z): program Z = iç Z − zShift
      const raw = a === 'Z' && prog.channel === 1 && meta.zShift ? +pos[a] - meta.zShift : +pos[a];
      if (a === 'Y' && prog.channel === 2) {
        if (Math.abs(pos[a]) > 1e-9) throw new Error('2. kanalda Y ekseni yok');
        continue;
      }
      const v = raw;
      // atölye yazımı: tornalama/arka takımlarda Y yazılmaz (Y0 iken); yalnız çapraz/ön takımlar ya da Y≠0
      if (K && a === 'Y' && Math.abs(v) < 1e-9 && (st.pos.Y == null || Math.abs(st.pos.Y) < 1e-9) && !(kTool && (kTool.unit === 'cross' || kTool.unit === 'front'))) { st.pos.Y = 0; continue; }
      if (!force && st.pos[a] != null && Math.abs(st.pos[a] - v) < 0.5 * 10 ** -dec) continue;
      w += ' ' + a + fmt(v, dec);
      st.pos[a] = v;
    }
    return w;
  };
  const feedWord = (F) => {
    if (F == null) return '';
    const d = st.feedMode === 'rev' ? 4 : 1;
    const f = fmt(F, d);
    if (st.F === f) return '';
    st.F = f;
    return ' F' + f;
  };
  const motion = (g) => { if (st.motion === g) return ''; st.motion = g; return g + ' '; };
  const feedWordForce = (F) => { const d = st.feedMode === 'rev' ? 4 : 1; const f = fmt(F, d); st.F = f; return ' F' + f; };
  const note = (pos) => {
    if (st.polar) return; // polar modda program X/C hipotetiktir (öz-kontrol yorumlayıcının dönüşümüyle ayrıca yapılır)
    for (const a of ['X', 'Y', 'Z', 'C']) if (pos[a] != null && !(a === 'Y' && prog.channel === 2)) intent[a] = a === 'Z' && prog.channel === 1 && meta.zShift ? +pos[a] - meta.zShift : +pos[a];
    if (lines.length && !skipping) checks.push({ line: lines.length - 1, pos: { ...intent } });
  };

  if (K) {
    emit('<' + cleanComment(meta.partName || 'PARCA').replace(/\s+/g, '') + (P.fileSuffix ? P.fileSuffix[pi] : '-P' + (pi + 1)) + '>');
    if (pi === 0 && meta.date) emit('(' + cleanComment('KAYAR CAM ' + meta.date) + ')');
    st.plane = 'zx'; st.feedMode = 'rev';
  }
  const progNo = String(P.programNumber).padStart(4, '0');
  if (!K) emit('O' + progNo + ' (' + cleanComment((meta.partName || 'PARCA') + (pi ? ' ARKA' : ' ON')) + ')');
  if (pi === 0 && !K) {
    emit('(' + cleanComment('KAYAR CAM - ' + P.name) + ')');
    if (meta.date) emit('(' + cleanComment('TARIH ' + meta.date) + ')');
    if (meta.stock) emit('(' + cleanComment(meta.stock) + ')');
    if (!P.verified) emit('(' + cleanComment('POST DOGRULANMADI - KURU CALISTIRIN') + ')');
  }
  if (!K) { emit('G18 G21 G40 G80 G97 G99'); st.plane = 'zx'; }
  const homeOut = () => { emit('G0T0'); emit(pi === 0 ? 'G28U0' : 'G28W0.'); st.pos = {}; st.motion = 'G0'; intent = {}; };
  const closeTool = () => {
    if (!(K && kTool)) return;
    if (kClamp) { emit(C.cUnclamp); kClamp = false; }
    // ön delme kolonu (T11–T13): atölyedeki gibi G0Z-5 ile alından uzaklaş, sonra ofset iptali
    if (kTool.unit === 'front' && pi === 0 && (st.pos.Z == null || st.pos.Z > -5)) { st.motion = null; emit('G0Z-5.'); }
    homeOut(); kTool = null; kPend = null;
  };
  // kesme/kanal takımı ayna tarafı kenar referanslı (zRef 'back'): program Z = IR Z (ön kenar) + genişlik
  const bz = (it) => (K && kTool && kTool.zRef === 'back' && it.pos?.Z != null) ? { ...it, pos: { ...it.pos, Z: +it.pos.Z + (kTool.width || 2) } } : it;
  const offWord = () => { if (!kPend) return ''; const w = 'T' + kPend; kPend = null; return w; };
  const cMove = (pos) => K && pos.C != null && (st.pos.C == null || Math.abs(st.pos.C - pos.C) > 1e-9);

  for (let it of prog.items) {
    switch (it.k) {
      case 'op': curOp = it.id; emit(''); emit('(' + cleanComment(it.name) + ')'); break;
      case 'opEnd': break;
      case 'comment': emit('(' + cleanComment(it.text) + ')'); break;
      case 'blank': break;
      case 'skip':
        if (K && kFeed) { emit(kFeed); kFeed = ''; }   // bekleyen G98/G99 blok atlamalı satıra kalmasın
        if (it.on) skipping = { st: { ...st, pos: { ...st.pos } }, intent: { ...intent } };
        else if (skipping) { Object.assign(st, skipping.st); intent = skipping.intent; skipping = null; }
        break;
      case 'raw':
        if (K && /^(N100|\(BURAYA KADAR\))/.test(it.text)) closeTool();
        emit(it.text);
        if (K) {
          st.pos = {}; st.motion = null; st.F = null; intent = {};
          // şablon satırındaki G98/G99 ilerleme kipini değiştirir: sonraki işlem doğru kipi yeniden yazar
          const fm = it.text.replace(/\(.*?\)/g, '').match(/G9[89](?!\d)/g);
          if (fm) { st.feedMode = fm[fm.length - 1] === 'G98' ? 'min' : 'rev'; kFeed = ''; }
          if (/M9(?!\d)/.test(it.text)) kCool = false;
        }
        break;
      case 'wo': if (K) break; if (st.wo !== it.code) { emit(it.code); st.wo = it.code; st.pos = {}; st.motion = null; intent = {}; } break; // koordinat değişti: eksenler yeniden yazılmalı
      case 'tool': {
        const t = it.tool;
        if (K) {
          closeTool();
          const n = kayarToolNum(t);
          emit('T' + String(n).padStart(2, '0') + '00 (' + cleanComment(t.name) + ')');
          kTool = t; kPend = n;
          st.motion = null; st.pos = {}; intent = {}; st.F = null;
          break;
        }
        emit(fillTemplate(P.toolCall, { tool: t.num, offset: t.offset }) + ' (' + cleanComment(t.name) + ')');
        st.motion = null; st.pos = {}; intent = {}; st.F = null; // yeni takımda F her zaman yazılır
        break;
      }
      case 'spindle': {
        const map = {
          main: [C.mainCW, C.mainCCW, C.mainStop, P.spindleAddress.main],
          sub: [C.subCW, C.subCCW, C.subStop, P.spindleAddress.sub],
          live: [C.liveCW, C.liveCCW, C.liveStop, P.spindleAddress.live],
          backLive: [C.backLiveCW, C.backLiveCCW, C.backLiveStop, P.spindleAddress.backLive || P.spindleAddress.live],
        }[it.which];
        // zaten duran iş mili için tekrar durdurma kodu yazılmaz (kanal başında durum bilinmez: ilk durdurma yazılır)
        if (K) {
          // atölye yazımı: M3S2500 / M36S3500 / M56S4000 — sabit devir (G96 yerine çubuk çapında karşılığı)
          if (it.dir === 'stop') {
            if (st.spin?.[it.which] !== 'stop') {
              const live = it.which === 'live' || it.which === 'backLive';
              if (kClamp && live) { emit(C.cUnclamp); kClamp = false; }
              if (live && kCool) { emit(C.coolantOff); kCool = false; }   // atölye: M7 M9 M38
              emit(map[2]);
            }
            (st.spin ||= {})[it.which] = 'stop'; break;
          }
          if (!map[0]) throw new Error('Post profilinde iş mili kodu tanımsız: ' + it.which);
          (st.spin ||= {})[it.which] = it.dir;
          let rpm = it.rpm;
          if (it.css) rpm = Math.min(it.maxRpm || Infinity, (it.css * 1000) / (Math.PI * Math.max(0.5, meta.barDia || 10)));
          emit((it.dir === 'ccw' && map[1] ? map[1] : map[0]) + 'S' + fmtInt(rpm));
          break;
        }
        if (it.dir === 'stop') { if (st.spin?.[it.which] !== 'stop') emit(map[2]); (st.spin ||= {})[it.which] = 'stop'; break; }
        (st.spin ||= {})[it.which] = it.dir;
        const m = it.dir === 'ccw' ? map[1] : map[0];
        if (it.css) {
          if (it.maxRpm) emit(P.maxRpm + ' ' + map[3] + fmtInt(it.maxRpm));
          emit(P.css + ' ' + map[3] + fmtInt(it.css) + ' ' + m);
        } else {
          emit(P.rpm + ' ' + map[3] + fmtInt(it.rpm) + ' ' + m);
        }
        break;
      }
      case 'feedMode': {
        const code = it.mode === 'rev' ? P.feedPerRev : P.feedPerMin;
        if (st.feedMode !== it.mode) { if (K && !skipping) kFeed = code; else emit(code); st.feedMode = it.mode; st.F = null; }
        break;
      }
      case 'plane': if (st.plane !== it.p) { emit(P.plane[it.p]); st.plane = it.p; } break;
      case 'coolant':
        if (K) { if (!it.on && !kCool) break; kCool = !!it.on; }
        emit(it.on ? (it.back ? C.backCoolantOn : C.coolantOn) : (it.back ? C.backCoolantOff : C.coolantOff)); break;
      case 'rapid': {
        it = bz(it);
        // ön delme kolonu: atölyedeki gibi önce Z ile alın önüne gel (G0Z-5.T12), sonra X/Y — Z bilinmezken X hareketi parçaya çarpar
        if (K && kPend && kTool?.unit === 'front' && pi === 0 && it.pos.Z == null) {
          const p0 = { X: 0, Z: -5 + (meta.zShift || 0) };   // X0 aynı blokta: ofset X evdeyken uygulanırsa kolon X1 strokunu aşar
          const zw = axisWords(p0, true);
          st.motion = null; emit(motion('G0') + zw.trim() + offWord()); note(p0);
        }
        // ön delme kolonu eksende çalışır (atölye programlarında X yazılmaz): X≠0 güvenli çap hareketi atlanır — kolon ofsetiyle X1 strok dışına çıkar
        if (K && kTool?.unit === 'front' && pi === 0 && it.pos.X != null && Math.abs(it.pos.X) > 1e-9) {
          const { X, ...rest } = it.pos; it = { ...it, pos: rest };
          if (!Object.keys(rest).length) break;
        }
        const idx = cMove(it.pos);
        if (idx && kClamp) { emit(C.cUnclamp); kClamp = false; }
        const w = axisWords(it.pos);
        const tw = K ? offWord() : '';
        if (w || tw) { if (tw) st.motion = null; emit(motion('G0') + w.trim() + tw); }
        note(it.pos);
        // indeksleme: C konumlandıktan sonra kilitle (M6) — kesme sabit C'de yapılır
        if (idx && C.cClamp && (st.spin?.live === 'cw' || st.spin?.live === 'ccw' || st.spin?.backLive === 'cw' || st.spin?.backLive === 'ccw')) { emit(C.cClamp); kClamp = true; }
        break;
      }
      case 'line': {
        it = bz(it);
        if (cMove(it.pos) && kClamp) { emit(C.cUnclamp); kClamp = false; }   // simültane C hareketi: kilit açık
        if (K && kPend) { emit(motion('G0') + offWord()); }
        const w = axisWords(it.pos);
        if (!w) break;
        if (it.F == null && st.F == null) throw new Error('G1 için ilerleme (F) tanımsız');
        emit(motion('G1') + w.trim() + feedWord(it.F));
        note(it.pos);
        break;
      }
      case 'arc': {
        it = bz(it);
        const g = it.cw ? 'G2' : 'G3';
        st.motion = null;
        const w = axisWords(it.pos, true);
        let c = '';
        for (const a of ['I', 'J', 'K']) if (it.ctr[a] != null) c += ' ' + a + fmt(it.ctr[a], dec);
        emit(motion(g) + w.trim() + c + feedWord(it.F));
        st.motion = g;
        note(it.pos);
        break;
      }
      case 'g92': {
        st.motion = null;
        const start = { ...st.pos };
        const w = ' X' + fmt(it.pos.X, dec) + ' Z' + fmt(it.pos.Z - (prog.channel === 1 && meta.zShift ? meta.zShift : 0), dec);
        st.F = null;
        emit('G92' + w + ' F' + fmt(it.F, 4));
        st.pos = start; // çevrim başlangıç noktasına döner
        st.motion = 'G92';
        st.F = fmt(it.F, 4);
        break;
      }
      case 'g32': {
        st.motion = null; st.F = null;
        const w = axisWords(it.pos, true);
        emit('G32' + w + ' F' + fmt(it.F, 4));
        st.F = fmt(it.F, 4);
        st.motion = 'G32';
        break;
      }
      case 'm': {
        if (K && /CAxis(On|Off)$/.test(it.key)) break;   // atölye makinesi: C komutu C eksenine kendisi geçer
        const code = C[it.key];
        if (!code) throw new Error('Post profilinde M kodu tanımsız: ' + it.key);
        emit(code);
        break;
      }
      case 'wait': emit(waitCode(P, it.n) + ' (BEKLE ' + it.n + ')'); break;
      case 'shift': {
        emit((P.workShift || 'G10 P0 Z{z}').replace('{z}', fmt(it.z, dec)));
        delete st.pos.Z; delete intent.Z; // program Z'nin anlamı değişti
        break;
      }
      case 'rigid': {
        const addr = { main: P.spindleAddress.main, sub: P.spindleAddress.sub }[it.which] || '';
        emit((C.rigidTap || 'M29') + ' ' + addr + fmtInt(it.rpm));
        break;
      }
      case 'cycle': {
        const um = (v) => String(Math.round(v * 1000));   // P/Q: en küçük birim (µm), ondalık noktasız
        const zz = (v) => fmt(v - (prog.channel === 1 && meta.zShift ? meta.zShift : 0), dec);
        if (it.kind === 'g83') {
          if (K && pi === 1 && st.pos.Z != null) emit('G83W' + fmt(+it.Z - st.pos.Z, dec) + 'Q' + um(it.Q) + feedWordForce(it.F));   // atölye: arka delme artımsal
          else if (K && !it.R) emit('G83Z' + zz(it.Z) + 'Q' + um(it.Q) + feedWordForce(it.F));
          else emit('G83 Z' + zz(it.Z) + ' R' + fmt(it.R, dec) + ' Q' + um(it.Q) + feedWordForce(it.F));
        } else if (it.kind === 'g84') {
          emit('G84 Z' + zz(it.Z) + ' R' + fmt(it.R, dec) + ' F' + fmt(it.F, 4));
          st.F = null;
        } else if (it.kind === 'g76') {
          const pmra = String(it.m).padStart(2, '0') + '00' + String(it.a).padStart(2, '0');
          emit('G76 P' + pmra + ' Q' + um(it.dmin) + ' R' + fmt(it.allow, dec));
          emit('G76 X' + fmt(it.X, dec) + ' Z' + zz(it.Z) + ' R0. P' + um(it.height) + ' Q' + um(it.d1) + ' F' + fmt(it.F, 4));
          st.F = null;
        } else throw new Error('Bilinmeyen çevrim: ' + it.kind);
        emit('G80');
        st.motion = null;
        break;
      }
      case 'cyl': {
        const tpl = it.r > 0 ? (P.cylOn || 'G7.1 C{r}') : (P.cylOff || 'G7.1 C0.');
        emit(tpl.replace('{r}', fmt(it.r, dec)));
        st.motion = null;
        break;
      }
      case 'polar': {
        emit(it.on ? (P.polarOn || 'G12.1') : (P.polarOff || 'G13.1'));
        st.polar = !!it.on;
        delete st.pos.X; delete st.pos.C; delete intent.X; delete intent.C; // X/C anlamı değişti: yeniden yazılır
        st.motion = null;
        break;
      }
      case 'dwell': emit('G4 U' + fmt(it.sec, 3)); break;
      default: throw new Error('Bilinmeyen IR: ' + it.k);
    }
  }
  return { lines, info, checks };
}
