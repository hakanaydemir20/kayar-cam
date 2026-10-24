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
export function postProcess(progs, profile, meta = {}) {
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

function postPath(prog, P, meta, pi) {
  const C = P.codes;
  const dec = P.decimals ?? 3;
  const lines = [];
  const info = [];
  const checks = [];           // öz-kontrol: amaçlanan konum ↔ satır
  let intent = {};
  let curOp = null;
  let n = 0;
  const st = { motion: null, F: null, plane: null, feedMode: null, pos: {}, wo: null };
  const emit = (s, keepBlank = false) => {
    if (!s && !keepBlank) return;
    if (P.lineNumbers && s && !s.startsWith('(') && !s.startsWith('O')) { n += P.lineStep; s = 'N' + n + ' ' + s; }
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
  const note = (pos) => {
    if (st.polar) return; // polar modda program X/C hipotetiktir (öz-kontrol yorumlayıcının dönüşümüyle ayrıca yapılır)
    for (const a of ['X', 'Y', 'Z', 'C']) if (pos[a] != null && !(a === 'Y' && prog.channel === 2)) intent[a] = a === 'Z' && prog.channel === 1 && meta.zShift ? +pos[a] - meta.zShift : +pos[a];
    if (lines.length) checks.push({ line: lines.length - 1, pos: { ...intent } });
  };

  const progNo = String(P.programNumber).padStart(4, '0');
  emit('O' + progNo + ' (' + cleanComment((meta.partName || 'PARCA') + (pi ? ' ARKA' : ' ON')) + ')');
  if (pi === 0) {
    emit('(' + cleanComment('KAYAR CAM - ' + P.name) + ')');
    if (meta.date) emit('(' + cleanComment('TARIH ' + meta.date) + ')');
    if (meta.stock) emit('(' + cleanComment(meta.stock) + ')');
    if (!P.verified) emit('(' + cleanComment('POST DOGRULANMADI - KURU CALISTIRIN') + ')');
  }
  emit('G18 G21 G40 G80 G97 G99');
  st.plane = 'zx';

  for (const it of prog.items) {
    switch (it.k) {
      case 'op': curOp = it.id; emit(''); emit('(' + cleanComment(it.name) + ')'); break;
      case 'opEnd': break;
      case 'comment': emit('(' + cleanComment(it.text) + ')'); break;
      case 'blank': break;
      case 'raw': emit(it.text); break;
      case 'wo': if (st.wo !== it.code) { emit(it.code); st.wo = it.code; st.pos = {}; st.motion = null; intent = {}; } break; // koordinat değişti: eksenler yeniden yazılmalı
      case 'tool': {
        const t = it.tool;
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
        if (it.dir === 'stop') { emit(map[2]); break; }
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
        if (st.feedMode !== it.mode) { emit(code); st.feedMode = it.mode; st.F = null; }
        break;
      }
      case 'plane': if (st.plane !== it.p) { emit(P.plane[it.p]); st.plane = it.p; } break;
      case 'coolant': emit(it.on ? (it.back ? C.backCoolantOn : C.coolantOn) : (it.back ? C.backCoolantOff : C.coolantOff)); break;
      case 'rapid': { const w = axisWords(it.pos); if (w) emit((motion('G0') + w.trim())); note(it.pos); break; }
      case 'line': {
        const w = axisWords(it.pos);
        if (!w) break;
        if (it.F == null && st.F == null) throw new Error('G1 için ilerleme (F) tanımsız');
        emit(motion('G1') + w.trim() + feedWord(it.F));
        note(it.pos);
        break;
      }
      case 'arc': {
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
        const code = C[it.key];
        if (!code) throw new Error('Post profilinde M kodu tanımsız: ' + it.key);
        emit(code);
        break;
      }
      case 'wait': emit(waitCode(P, it.n) + ' (BEKLE ' + it.n + ')'); break;
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
