"""Atölyenin gerçek (kanıtlanmış) P1/P2 programlarını modelden geçirir.

Kullanım (kayar-cam klasöründen):
    python analiz/tools/realcheck.py ["<program klasörü>"] [--material c45]
Çıktı: analiz/out/realcheck.md (gitignore'da). Programlar repoya KOPYALANMAZ.

Basit FANUC ayrıştırıcı: #değişkenler, T/M3S, G98/G99, F, G0/G1 X/Z/U/W,
G83/G73 (Z|W, Q µm), G84/G87 atlanır. Matkap çapı yorumdan: "(Q2.4 MAT)" → Ø2.4
(atölye yazımında "Q" = çap işareti). Çubuk Ø = #531 − 1.
Bu programlar makinede çalıştığından model bir işlemi "tehlikeli" sayarsa model fazla
muhafazakârdır (README'deki kalibrasyon notuna bakın).
"""
import math
import os
import re
import sys
from dataclasses import dataclass, field
from typing import List, Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from kayar_model import (analyze_samples, generate_pass, BushSupport, ColletSupport,  # noqa: E402
                         drill_forces, peck_schedule, collet_slip_check, bush_axial_check,
                         it_tolerance)

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "..", "örnek cam dosyaları"))
OUT = os.path.normpath(os.path.join(HERE, "..", "out", "realcheck.md"))

WORD = re.compile(r"([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")
VAR_ASSIGN = re.compile(r"^#(\d+)\s*=\s*(.+)$")
DIA_COMMENT = re.compile(r"Q\s*(\d+(?:\.\d+)?)\s*(?:MAT|HAVSALI|PUNTA|DELIK)", re.I)


@dataclass
class TurnRec:
    tool: str
    dia: float
    ap: float
    f: float
    rpm: float
    length: float
    line: int


@dataclass
class DrillRec:
    tool: str
    D: Optional[float]
    depth: float
    q: Optional[float]
    f: float
    rpm: float
    cycle: str
    line: int


@dataclass
class Program:
    name: str
    bar: Optional[float] = None
    turns: List[TurnRec] = field(default_factory=list)
    drills: List[DrillRec] = field(default_factory=list)
    rpms: set = field(default_factory=set)


def _eval(expr: str, vars_: dict) -> Optional[float]:
    e = re.sub(r"#(\d+)", lambda m: repr(vars_.get(int(m.group(1)), 0.0)), expr)
    e = e.replace("[", "(").replace("]", ")").strip()
    if not re.fullmatch(r"[\d\s.+\-*/()e]+", e):
        return None
    try:
        return float(eval(e, {"__builtins__": {}}))  # yalnız sayı/aritmetik (regex ile süzüldü)
    except Exception:
        return None


def parse_text(text: str, name: str = "prog") -> Program:
    pr = Program(name)
    vars_ = {}
    tool, rpm, per_rev, F = "", 0.0, True, 0.0
    X = Z = None
    motion = 0
    last_dia = None      # son okunan "(QØ MAT)" yorumu
    tool_dia = None      # aktif takımın matkap çapı
    cut_hist = []        # (z_min, z_max, çap) işlenmiş bölgeler
    for ln, raw in enumerate(text.splitlines(), 1):
        line = raw.strip().lstrip("/").upper()
        for c in re.findall(r"\(([^)]*)\)", line):
            m = DIA_COMMENT.search(c)
            if m:
                last_dia = float(m.group(1))
        code = re.sub(r"\([^)]*\)", "", line).strip()
        m = VAR_ASSIGN.match(code)
        if m:
            v = _eval(m.group(2), vars_)
            if v is not None:
                vars_[int(m.group(1))] = v
                if int(m.group(1)) == 531:
                    pr.bar = v - 1.0
            continue
        if not code or code[0] in "%<O":
            continue
        code = re.sub(r"#(\d+)", lambda m: repr(vars_.get(int(m.group(1)), 0.0)), code)
        code = code.replace("[", "").replace("]", "")
        words, gs, ms = {}, [], []
        for k, v in WORD.findall(code):
            if k == "G":
                gs.append(int(float(v)))
            elif k == "M":
                ms.append(int(float(v)))
            else:
                words.setdefault(k, float(v))
        if "T" in words and words["T"] >= 100:
            tool = f"T{int(words['T']) // 100:02d}"
            tool_dia, last_dia = last_dia, None
        for g in gs:
            if g in (0, 1, 2, 3):
                motion = g
            elif g == 98:
                per_rev = False
            elif g == 99:
                per_rev = True
        if "S" in words and any(mm in (3, 4, 36, 37) for mm in ms):
            rpm = words["S"]
            if rpm > 100:
                pr.rpms.add(rpm)
        if "F" in words:
            F = words["F"]
        fpr = F if per_rev else (F / rpm if rpm else 0.0)
        cyc = next((g for g in gs if g in (83, 73, 84, 87)), None)
        if cyc in (83, 73):
            if "W" in words:
                depth = abs(words["W"])
            elif "Z" in words:
                depth = abs(words["Z"] - (Z if Z is not None else 0.0))
            else:
                depth = 0.0
            q = words.get("Q")
            pr.drills.append(DrillRec(tool, tool_dia, depth, q / 1000.0 if q else None,
                                      fpr, rpm, f"G{cyc}", ln))
            continue
        if cyc in (84, 87) or 80 in gs:
            continue
        nx = words.get("X", X)
        if "U" in words and X is not None:
            nx = X + words["U"]
        nz = words.get("Z", Z)
        if "W" in words and Z is not None:
            nz = Z + words["W"]
        if (motion == 1 and None not in (nx, X, Z, nz) and abs(nx - X) < 1e-6
                and abs(nz - Z) > 0.2 and per_rev and 0 < fpr < 0.2 and pr.bar
                and not tool.startswith("T3")  # T31–T35: canlı/freze takımları
                and 0 < nx < pr.bar and tool and rpm > 100):
            # Önceki pasolarla örtüşen bölgede stok = en küçük önceki çap (kademeli pasolar)
            z_lo, z_hi = min(Z, nz), max(Z, nz)
            prev = [dd for (a, b_, dd) in cut_hist if a < z_hi - 1e-6 and b_ > z_lo + 1e-6 and dd > nx]
            stock = min(prev) if prev else pr.bar
            cut_hist.append((z_lo, z_hi, nx))
            if stock - nx > 1e-6:
                pr.turns.append(TurnRec(tool, nx, (stock - nx) / 2.0, fpr, rpm, abs(nz - Z), ln))
        X, Z = nx, nz
    return pr


def parse(path: str) -> Program:
    with open(path, encoding="latin-1", errors="replace") as fh:
        return parse_text(fh.read(), os.path.basename(path))


def is_p2(name: str) -> bool:
    return "P2" in name.upper() or "P22" in name.upper()


def check(pr: Program, material: str, tol_grade: int = 9, ra_limit: float = 3.2,
          rn: float = 0.2):
    """Her işlem için (tür, takım, parametre, model, uyarılar, satır) ve bayrak listesi."""
    rows, flags = [], []
    sub = is_p2(pr.name)
    for t in pr.turns:
        if sub:
            sup, ov = ColletSupport(grip=8.0), (5.0, 5.0)
        else:
            sup, ov = BushSupport(clearance=0.010), (1.0, 2.0)
        vc = math.pi * pr.bar * t.rpm / 1000.0
        s = generate_pass(0, -t.length, t.f, t.rpm, *ov, samples=20)
        tol = it_tolerance(pr.bar, tol_grade)
        r = analyze_samples(s, material, pr.bar, t.ap, rn, 95, sup, vc,
                            tolerance=tol, ra_limit=ra_limit)
        hard = [w for w in r.warnings if "Çap hatası" in w or w.startswith("Ra ") or "sınırını" in w]
        rows.append(("tornalama", t.tool, f"Ø{t.dia:g} ap={t.ap:.2f} f={t.f:g} S={t.rpm:g}",
                     f"Fc={r.forces.Fc.max():.0f}N Fp={r.forces.Fp.max():.0f}N "
                     f"2δ={r.dia_error_max*1000:.1f}µm Ra={r.ra_max:.2f}µm", hard, t.line))
        if hard:
            flags.append((pr.name, t.line, hard))
    for d in pr.drills:
        if not d.D or d.f <= 0 or d.depth <= 0:
            rows.append(("delme", d.tool, f"Ø{d.D} L={d.depth:g} Q={d.q}", "çap/F/derinlik okunamadı",
                         [], d.line))
            continue
        F = drill_forces(material, d.D, d.f, math.pi * d.D * d.rpm / 1000.0)
        q = d.q if d.q and d.q < d.depth else d.depth
        sch = peck_schedule(d.depth, q, d.f, max(d.rpm, 1.0), "g83")
        bar = pr.bar or 2 * d.D
        ck = (collet_slip_check(F.thrust, F.torque, bar, 8.0) if sub
              else bush_axial_check(F.thrust, F.torque, bar))
        rows.append(("delme", d.tool,
                     f"Ø{d.D:g} L={d.depth:g} (L/D={d.depth / d.D:.1f}) Q={q:g} ({q / d.D:.2f}D) "
                     f"f={d.f:g} S={d.rpm:g}",
                     f"itme={F.thrust:.0f}N M={F.torque / 1000:.2f}Nm gaga={sch.count} "
                     f"t={sch.total_time:.1f}s", ck.warnings, d.line))
        if ck.warnings:
            flags.append((pr.name, d.line, ck.warnings))
    return rows, flags


def main(argv):
    a = list(argv)
    material = "c45"
    if "--material" in a:
        i = a.index("--material")
        material = a[i + 1]
        del a[i:i + 2]
    folder = a[0] if a else DEFAULT_DIR
    files = sorted(f for f in os.listdir(folder)
                   if re.search(r"P\d", f.upper())
                   and not f.upper().endswith((".STEP", ".STP", ".PDF", ".JPG", ".SLDPRT")))
    body, allflags = [], []
    n_turn = n_drill = 0
    for fn in files:
        pr = parse(os.path.join(folder, fn))
        if not pr.turns and not pr.drills:
            continue
        rows, flags = check(pr, material)
        n_turn += len(pr.turns)
        n_drill += len(pr.drills)
        allflags += flags
        body.append(f"\n## {fn}  (çubuk Ø{pr.bar}, devirler {sorted(pr.rpms)})\n")
        body.append("| işlem | takım | parametre | model | uyarı | satır |\n|---|---|---|---|---|---|")
        for kind, tool, par, res, w, line in rows:
            body.append(f"| {kind} | {tool} | {par} | {res} | {'; '.join(w) or '-'} | {line} |")
    head = [f"# Gerçek program kontrolü (malzeme varsayımı: {material}, tolerans IT9, Ra ≤ 3.2 µm, rn 0.2)",
            "",
            "Programlar makinede kanıtlanmıştır → bayraklanan işlem modelin fazla muhafazakâr olduğunu gösterir.",
            "ap = (stok − X)/2; stok = aynı Z aralığında önceki en küçük çap, yoksa çubuk.",
            "",
            f"**Özet:** {len(files)} dosya tarandı; {n_turn} tornalama + {n_drill} delme işlemi; "
            f"bayraklı {len(allflags)}."]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(head + body) + "\n")
    print(f"{n_turn} tornalama + {n_drill} delme, {len(allflags)} bayrak -> {OUT}")
    for name, line, w in allflags[:40]:
        print(f"  {name}:{line}: {w[0]}")
    return n_turn + n_drill, len(allflags)


if __name__ == "__main__":
    main(sys.argv[1:])
