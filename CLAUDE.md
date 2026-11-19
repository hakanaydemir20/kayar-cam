# Kayar CAM

CAM for ONE machine: **STAR SB-20R Type G, Variation 04** (cartridge-type 5-spindle cross drilling unit), **FANUC 0i-TD**, Swiss-type sliding headstock, guide bush (GB) and non-guide-bush (NGB) modes. Swiss-type ONLY — never generalize. Vite + Three.js single-file app (`dist/index.html`) + Python analysis (`analiz/`). UI text Turkish, plain language. Reply to the user in Turkish.

## Phase / approval state
- Current phase: **audit & specification**. Approved deliverables so far are documents only. Do NOT implement corrections, refactors or new CAM features until the user approves (see docs below). Wait for approval after each stage.
- Never invent machine dimensions, strokes, tool positions, spindle centres/axes/rotation directions, M-codes or FANUC extensions. Unknown → configurable value marked `BİLİNMİYOR`; ask the user.
- Verified specs (user): max dia 20 mm; main 10 000 rpm 2.2 kW; sub 9 000 rpm 0.55 kW; FANUC 0i-TD; stations 1–6 and 31–35 (five INDEPENDENT spindles, each own axis/frame/tool centre/rotation/max rpm/tool/collision; never assume common axis or equal spacing). Everything in `src/machine/sb20r-g.json` and `STATIONS` is unverified (file still says 0i-TF, sub 8000, cross 4 spindles, T35 = front column — known wrong, fix only after approval).

## Key documents
- `docs/MIMARI.md` — architecture (7 layers, contracts, coordinate system, kinematic tree, roadmap M0–M7).
- `docs/makine-yapilandirma.md` — machine configuration spec/schema (KULLANICI / PROGRAM / BİLİNMİYOR).
- `docs/variation04-takim-yerlesimi.md` — Var.04 tooling layout (reference image still missing; put in `makine çizimi/`).
- `docs/MUHENDISLIK_DOGRULAMA_RAPORU.md` + `docs/denetim/*.md` — Task 03 engineering audit (30 prioritized findings, 3 CRITICAL).
- `docs/MUHENDISLIK_ON_DENETIMI.md`, `docs/HAKAN_CAM_DANISMANI.md`, `docs/SELCUK_DOGRULAMA.md` — Codex QA documents.

## Architecture rule
Toolpath computation (part coords) / machine kinematics (machine JSON, frames, stations, bodies) / NC generation (dialect writer+reader) / simulation stay independent. Machine numbers belong in machine JSON, not generators; post never computes geometry. Current code violates this in places (listed in MIMARI.md §6) — refactor only with approval.

## Code map (JS, `src/`)
- `ops/generators.js` — all CAM ops (GEN.*): face, rough (z/profile/face), finish, groove, thread (G92/G76), center, drill (G83), tap (G84+M29), crossDrill, flatMill, areaMill, pocketMill (G19), polygonMill, cylSlot/engrave (G7.1), backTurn/backDrill/backTap/backSlot/backPolar (G12.1), cutoff, pickoff, eject, rechuck, midRechuck. `ops/simMill.js` — simultaneous 4-axis X-Y-Z-C (exact triangle drop-cutter; missing height = air, never 0). `ops/program.js` — two-channel builder (waits, overlap, segmentation; `K` branch = shop template). `ops/kayarTemplate.js` — shop P1/P2 skeleton. `ops/context.js` — profile envelope, limits.
- `toolpath/ir.js` — IR. `post/fanucStar.js` — post (Star + shop `kayar` dialect via `K`), `post/postProfileKayar.json` (DEFAULT for new projects; codes from real programs), `post/postProfile.json` (Star catalog, codes UNVERIFIED and conflicting with this machine — do not use for this machine), `post/ncFiles.js` — split/join P1/P2 files.
- `sim/interpreter.js` — G-code interpreter (both dialects; shop: macros #n/[ ], T0200+Tn offset motion incl. Y, G28, G125 zero set, G130/G131/T29 frames, M82/M40/M41 sync waits, G87, G83/G84 W, M29 S Q, H, M6/M7, C-implies-C-axis, R arcs, auto tools from comments, T11–T13 ↔ front column). `sim/gcodeParser.js` (macro expansion). `sim/frames.js` (part↔machine; setGrip from P2 #530; pickRef per M82). `sim/stockSim.js` (z×θ grid material removal, overlap cycle, zeroSet, blade zRef). `sim/collision.js`, `sim/bodies.js`.
- `tools/toolLibrary.js` — tools, `STATIONS`, insert geometry single source (`insertOutline` → mesh/2D/sim `insertLowerTable`/reach `insertEdges`; origin = FANUC imaginary tip). `machine/sb20r-g.json`. `view3d/`, `ui/` (app.js, settings: tools default `'active'`).
- Simulation interprets the **posted G-code text**, never the IR. X diameter-programmed. C sign: tool at C cuts part angle θ = −C.

## Shop dialect facts (observed in ~95 real P1/P2 pairs, private folder `../örnek cam dosyaları/` — never copy into repo)
Separate -P1/-P2 files; P1: macro header #531/#530/#529/#528/#120, `M98P9012`, `N99` loop, M11 / `G0Z-fsT0` / `G125Z-fs` / M10, `M200`, ops, `N100` cutoff `G0G99X[#531+1.]Z[#530+#528+#120]T1` (blade ref = chuck-side edge), `M82 M40 … M41 M83`, `M99P99`. P2: `#530` = grip length, `G130`, `T2000`, `M200`, back ops (previous part), `T2900` eject, `N100` `G131` pick, `M99`. Live: `M36S`/`M38`, C index with `M7`…`M6`, back live `M56`/`M58`, `G0G98C…T3n`. Sync points: M200, M82, M40, M41 (M83 not). Observed ≠ verified spec.

## Python (`analiz/`, pytest)
`kayar_model` (Kienzle forces, bush/collet deflection, Ra, chips/LFV, peck drilling, two-path streams; 47 tests) · `gcode_engine` (two-channel engine, sync strategies, pickoff_cycle with safety validator; 14) · `swiss_z1` (Z1 offset matrices, overhang, segmentation, stroke-safe rechuck; 10) · `cs_contour` (G7.1/G12.1/Y-axis transforms, keyway wall correction, method choice; 12) · `tools/realcheck.py` (runs real programs through the model; output `analiz/out/`, gitignored). Machine constants still duplicated there (to be unified with machine JSON after approval).

## Commands
- Dev: `npx vite --port 5173 --strictPort` (machine is low on memory; start only when asked)
- Unit: `npx vitest run` (339 pass) · Build: `npx vite build`
- Real programs: `node tests/realprograms.mjs [-v]` (80/80 pairs error-free; reads private folder)
- E2E (dev server running): `node tests/e2e/roughcheck.mjs`, `node tests/e2e/samplesall.mjs`; `uitest.mjs` uses `dist/`
- Python: `python -m pytest analiz -q`
- Run the relevant checks before calling work done. Commit/push only when the user asks.

## Other rules
- 3D view defaults: body, cabin, holders off; tools = working tool only.
- No automatic plan until the user runs the rough/finish wizard.
- Manual G-code project starts empty; ▶ re-parses editor text.
- Deliberately absent: G71/G70, pinch turning, live front sleeves. Vendor tool 3D models not redistributed.

## Claude ⇄ Codex handoff
Codex continues when the Claude limit is hit (and vice versa). Codex reads `AGENTS.md` → this file. Read `docs/DEVAM.md` at start; update it at the end of every task (done, changed files, test results, next step).

## Independent QA
- Before developing a new CAM feature, ask Hakan to complete the engineering requirements using docs/HAKAN_CAM_DANISMANI.md.
- After each development change, invoke Selçuk using docs/SELCUK_DOGRULAMA.md. Record test results, NC-to-simulation consistency, simulated stock-to-STEP geometry, and the proposed strategy or correction prompt before closing the change.

## Göreve göre kod haritası

- Göreve başlamadan önce `docs/VOLKAN_KOD_HARITASI.md` içinden ilgili akışı seç. Volkan varsa görev için dar bir okuma ve test listesi iste. Ajanlara görev, kabul ölçütü ve ilgili dosyaları ver. Aramayı yalnız eksik bir bağımlılık bulunduğunda genişlet.
