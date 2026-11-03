# Kayar CAM

Swiss-type CAM for Star SB-20R Type G (FANUC 0i-TF, 2 paths $1/$2). Vite + Three.js, single-file `dist/index.html`. UI text is Turkish, plain language for non-experts.

## Commands
- Dev: `npx vite --port 5173 --strictPort`
- Unit: `npx vitest run` · Build: `npx vite build`
- E2E (dev server running): `node tests/e2e/roughcheck.mjs`, `node tests/e2e/samplesall.mjs`; `uitest.mjs` uses `dist/` (build first)
- Run all of these before calling work done. Push only when the user asks (Pages deploy gated by tests).

## Rules
- Simulation interprets the **posted G-code text**, never the IR. X is diameter-programmed.
- Post (`src/post/postProfile.json`) is `verified: false` until real Star sample programs arrive. `profileConflicts()` rejects one M code mapped to two functions.
- Tool layout = machine drawing `makine çizimi/SB20R_TypeG_machining_zone.glb`: gang T01–06, cross T31–34, T35 front column 3 levels (T3501–03), back T21–24 (`STATIONS`). Never create stations beyond these (`slotFor`, `fitStations`).
- Insert geometry has one source: `insertOutline` → 3D mesh, 2D, sim cut (`insertLowerTable`), generator reach (`insertEdges`). Origin = FANUC imaginary tip (nose centre − rn). Holder κr: `HOLDER_KAPPA`.
- 3D view defaults: machine body, cabin, tools, holders off.
- No automatic plan until the user runs the rough/finish wizard; rough-auto must produce no errors, collisions or overcut.
- Deliberately absent: G71/G70, pinch turning, live front sleeves.
- Tool vendor 3D models are not redistributed; tools are parametric (user may attach STEP).

## Open
- T35 back-facing drills (gang tool + sub-spindle kinematics).
