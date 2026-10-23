# Phase 5 — Complete Nasal Parameter Set Report

**Project:** VoiceSurg 3D — voice-driven facial-simulation prototype
**Scope of this phase:** give every intended nasal parameter a single documented
definition, an isolated deformation, a UI control, and automated regression tests;
complete the alar (nostril-wing) width parameter that was previously missing.
**Status:** implemented, unit-tested, built, and verified at runtime
**Date:** 2026-10-14

---

## 1. Objective & Boundaries

Turn the five partially-wired controls from earlier phases into a complete,
consistent and independently-controlled set of **six** nasal parameters, while
keeping the Phase 4 geometry, the Phase 2 UI and the Phase 3 speech contract
intact.

**In scope**
- Define all six nasal parameters in one registry (key, region, operation, unit,
  direction, bounds, default, geometry transform, voice/manual availability).
- Implement the missing **alar width** parameter with its own independent
  deformation (the `alarWeight` region existed in Phase 4 but had no driver).
- Remove the frontend-only coupling where a "nostril widening" command was
  mapped onto the bridge-width field.
- Ensure bridge width and alar width are structurally independent in **both**
  directions.
- Group the parameter panel into Bridge / Tip / Alar sections, each control with
  label, live value, unit, slider, reset, changed-state and a short explanation.
- Numeric regression tests plus a runtime (headless-Chrome) verification.

**Explicitly out of scope (preserved)**
- No replacement of the Phase 4 head mesh; the geometry layer is retained.
- No overall UI redesign; the Phase 2 layout, tokens and toolbar are retained.
- No lips / cheeks / chin / jawline simulation.
- No tissue biomechanics, no surgical-outcome prediction.
- No clinical-calibration or clinical-safety claims.
- No database and no external AI provider; no Phase 6 features started.
- No conversational-session features; no new persistence.

---

## 2. The Six Parameters (single source of truth)

Implemented in `frontend/src/lib/params.ts` (`PARAM_DESCRIPTORS`). The geometry
engine, the parameter panel and the command mapping all read from this one
registry, so the UI, the parser contract and the geometry cannot disagree.

| Key | Label | Region (parser) | Operation | Unit | Bounds | Default | Positive direction | Negative direction |
|---|---|---|---|---|---|---|---|---|
| `bridgeHeight` | Nasal bridge height | `nasal_bridge` | `height` | mm | −10 … +10 | 0 | dorsum higher (augmentation) | dorsum lower (reduction) |
| `bridgeWidth` | Nasal bridge width | `nasal_bridge` | `width` | mm | −10 … +10 | 0 | wider bridge sides | narrower bridge sides |
| `tipProjection` | Tip projection | `nasal_tip` | `projection` | mm | −10 … +10 | 0 | tip forward | tip back |
| `tipHeight` | Tip height | `nasal_tip` | `height` | mm | −10 … +10 | 0 | tip up (superior) | tip down (inferior) |
| `tipRotation` | Tip rotation | `nasal_tip` | `rotation` | degrees | −45 … +45 | 0 | rotated up (cranial) | rotated down (caudal) |
| `alarWidth` | Alar width | `nostril_region` | `width` | mm | −10 … +10 | 0 | wider alar wings | narrower alar wings |

Notes:
- **Units.** Lengths are millimetres, rotation is degrees. Millimetres are
  converted to scene units through the single Phase 4 pathway (`mmToScene`,
  `1.40/150 ≈ 0.009333` scene units per mm); degrees go through
  `degreesToRadians`. There is no second scaling path anywhere.
- **Bounds.** These are prototype *interaction* limits (slider/step defaults),
  not validated clinical limits. They are documented in the panel footnote and
  in the report. The backend independently enforces `LENGTH_LIMIT_MM = 10.0`
  and `ANGLE_LIMIT_DEG = 45.0`, which agree with the registry.
- **Defaults / reset.** Every parameter resets to `0` (the immutable baseline).
- **Availability.** All six are reachable from both voice commands and the manual
  panel; the registry records `voice`/`manual` flags per entry.
- The units are *illustrative* (a 150 mm facial-width reference assumption, not a
  verified calibration); this disclosure is preserved in the viewer and panel.

---

## 3. Command Mapping (removing the bridge↔alar coupling)

`paramKeyFor(target, parameter)` in `lib/params.ts` is explicit and never guesses:

| Target | Parameter | Field |
|---|---|---|
| `nasal_bridge` / `nasal_dorsum` | `height` | `bridgeHeight` |
| `nasal_bridge` / `nasal_dorsum` | `width` | `bridgeWidth` |
| `nasal_tip` | `height` | `tipHeight` |
| `nasal_tip` | `projection` | `tipProjection` |
| `nasal_tip` | `rotation` | `tipRotation` |
| `nostril_region` | `width` | **`alarWidth`** |
| anything else | — | `null` (refused, not applied) |

**Change from Phase 4:** `nostril_region` + `width` previously mapped to
`bridgeWidth`, so saying "widen the nostrils" silently widened the bridge. It now
maps to the dedicated `alarWidth` field. The backend already supported this
(`TARGET_PARAMETER_MAP[nostril_region] = {width}`, with the synonym set
nostrils / nares / naris / alar base / alar / ala / alae in the parser); the fix
was frontend-only, so no backend contract change was needed and the Phase 3
parser/API suite still passes unchanged.

Unsupported combinations (e.g. tip *width*, nostril *height*) resolve to `null`
and are never applied — an unsupported command is refused, not silently no-oped
into a wrong field.

---

## 4. Geometry: the new alar-width deformation

Region weights live in `frontend/src/scene/geometry/regions.ts`. `alarWeight`
(Phase 4) is a bounded, symmetric weight localised to the alar wings:

```
alarWeight = frontMask(z) · bell(y, −0.19, 0.055) · (bell(x, 0.15, 0.06) + bell(x, −0.15, 0.06))
```

`deformPositions` (`deformation.ts`) now drives it:

```ts
// Alar wings: symmetric lateral spread. Midline is untouched (sign 0) and
// the weight is localised, so the bridge and tip do not move.
if (dAlarWidth !== 0 && bx !== 0) {
  const wAlar = alarWeight(bx, by, bz);
  nx += Math.sign(bx) * dAlarWidth * wAlar;
}
```

Properties, all enforced by tests:
- **Baseline-driven.** Positions are recomputed from the immutable baseline plus
  the *full* current state; there is no cumulative drift and no dependence on the
  previous frame.
- **Deterministic.** The same state yields byte-identical positions.
- **Midline preserved.** `Math.sign(0) = 0` keeps `x = 0` fixed, and the weight at
  the midline is ≈ 0.004, so widening is purely lateral.
- **Independent of bridge width.** The bridge-width band (`|x| ≈ 0.075`, `y ≈ 0.2`)
  and the alar band (`|x| ≈ 0.15`, `y ≈ −0.19`) are separated; each parameter
  moves only its own band (verified in both directions).
- **Independent of the tip.** Tip landmarks (nasion, pronasale) do not move when
  the alae widen; the alar landmarks `alare_l` / `alare_r` do move.
- **Finite & bounded.** Non-finite inputs sanitised via `safeNumber`; no NaN/Inf
  reaches the renderer; the heatmap normalises intensity separately from the
  physical millimetre displacement.

Full parameter → transform summary:

| Parameter | Transform |
|---|---|
| `bridgeHeight` | anterior (`+Z`) translation of the dorsum corridor × `bridgeWeight` |
| `bridgeWidth` | lateral (`±X`, `sign(x)`) translation of dorsum sides × `bridgeWidthWeight` |
| `tipProjection` | anterior (`+Z`) translation of the tip × `tipWeight` |
| `tipHeight` | vertical (`±Y`) translation of the tip × `tipWeight` |
| `tipRotation` | rotation of the tip about the documented subnasale pivot, angle scaled by `tipWeight`; positive = cranial |
| `alarWidth` | lateral (`±X`, `sign(x)`) translation of the alar wings × `alarWeight` |

---

## 5. UI

`ParameterPanel.tsx` renders the registry grouped by `PARAM_GROUPS`:

- **Bridge** — Nasal bridge height, Nasal bridge width
- **Tip** — Tip projection, Tip height, Tip rotation
- **Alar region** — Alar width

Each `ParameterControl` shows: label, short explanation (hint), live value with
correct unit (`mm` / `°`), a slider, a per-control reset button (disabled at 0),
and a visible "changed" badge when non-zero. Group headings carry a one-line
description. The panel footnote still states that ranges are prototype
interaction limits and that lengths use an illustrative reference scale.

The **Tip height** control is newly surfaced this phase (previously it was
reachable only by voice).

The **simulation report** (`App.tsx` → "Save report") now lists all six final
parameter values (bridge height/width, tip projection/height/rotation, alar
width) plus the unchanged educational disclaimer.

---

## 6. History, Undo & Reset

Unchanged semantics, now extended to six fields and re-verified:
- Manual slider edits are stored as one absolute-value manual command per
  parameter (replaced in place); voice commands append.
- `modelState = applyAllCommands(history)` recomputes from the baseline every
  time, so a manual edit **persists** when a later voice command is confirmed,
  and undo/reset reproduce the correct prior/full state.
- History labels distinguish a manual absolute adjustment ("Set to +10 mm",
  `sliders` icon) from a voice relative instruction (`mic` icon).
- `Reset`/per-parameter reset restore the documented default (`0`).
- History remains in-memory only this phase (no DB).

---

## 7. Tests

**Automated (numbers, not screenshots).**

- `frontend/tests/params.test.ts` (new) — registry integrity: exactly the six
  keys; unique keys matching their entries; valid units; ordered finite bounds
  with positive step and zero default; every descriptor maps to a parser pair;
  group coverage/order; every descriptor present in `SIMULATED_PARAM_KEYS`.
  Plus `paramKeyFor`: alar vs bridge independence, distinct tip fields, dorsum
  aliasing, and refusal (`null`) of unsupported combinations.
- `frontend/tests/geometry.test.ts` (extended) — alar width moves both alar
  landmarks but not nasion/pronasale; left/right spread is symmetric and
  opposite in sign; midline preserved; alar↔bridge independence in both
  directions; alar band clear of the bridge-width band; existing zero-state,
  determinism, no-drift, pivot-radius, finiteness and heatmap tests retained.
- `frontend/tests/logic.test.ts` (extended) — nostril widening routes to
  `alarWidth` (never `bridgeWidth`); bridge widening does not touch `alarWidth`;
  manual alar edit is absolute; mixed voice+manual history replays
  deterministically; a manual edit survives a later confirmed voice command.
- `frontend/tests/ParameterPanel.test.tsx` (new) — three groups render; a slider
  exists for every parameter; value+unit display (`+5 mm`, `-10 °`); changed
  badge + enabled reset; reset disabled when untouched; `onChange` reports the
  parameter key and value.

**Results**
- Frontend: **67 tests / 7 files pass** (was 40 / 5 → +27).
- Backend: **29 tests pass** (unchanged; parser/validation still agree with the
  registry).
- Production build: `tsc && vite build` clean — `dist/assets/index-*.js`
  ≈ 1,190 kB (gzip ≈ 328 kB); only the pre-existing >500 kB chunk warning.

---

## 8. Runtime Verification (headless Chrome via CDP)

Built preview served on `127.0.0.1:4173`, backend on `127.0.0.1:8000`, headless
Chrome on `9222`. The app reached the backend (3 × `200 OK` on `/api/health` in
the backend log).

- **Layout:** `document.scrollWidth 1425 ≤ innerWidth 1440`; canvas 919 × 574; no
  overflow.
- **Toolbar:** modes `[Original, Simulated, Compare]`; toggles
  `[Landmarks, Wireframe, Displacement, Reset view]`.
- **Panel:** 3 groups with the exact titles/descriptions above; 6 sliders with the
  correct ids, labels and bounds (`alarWidth` −10…10 step 1; `tipRotation`
  −45…45); footnote present.
- **Every parameter produces a visible change** in Simulated mode and a correct
  history entry, then resets to 0:

  | Parameter set | History label | Nose-crop mean Δ |
  |---|---|---|
  | bridgeHeight +8 mm | `Nasal Bridge · Height · Set to +8 mm` | 1.18 |
  | bridgeWidth +8 mm | `Nasal Bridge · Width · Set to +8 mm` | 0.97 |
  | tipProjection +10 mm | `Nasal Tip · Projection · Set to +10 mm` | 0.46 |
  | tipHeight +10 mm | `Nasal Tip · Height · Set to +10 mm` | 1.52 |
  | tipRotation +30° | `Nasal Tip · Rotation · Set to +30°` | 1.14 |
  | alarWidth +10 mm | `Nostril Region · Width · Set to +10 mm` | 0.77 |

- **Alar isolation at runtime** (band-crop max pixel Δ):

  | Setting | Bridge band | Alar band |
  |---|---|---|
  | alarWidth +10 mm | 1.1 (noise) | **65.0** |
  | bridgeWidth +10 mm | 3.7 | 15.7 (projection overlap) |

  Alar widening leaves the bridge band at noise level while strongly changing the
  alar band; strict separation is also proven numerically by the geometry tests.
- **Reset:** after resetting all controls, every slider reads `0` and history is
  empty (empty state shown). The reset screenshot differs from the baseline only
  by the viewer's subtle idle bob (reset mean Δ 0.95 vs idle-noise mean Δ 1.00) —
  i.e. reset returns to the baseline within animation noise.
- **Views:** Original / Simulated / Compare all render non-blank and distinct
  (region std 27.20 / 27.04 / 27.73).
- **Report:** the saved report contains `Alar width: 10 mm`,
  `Tip height: -4 mm` and the "Not intended for clinical" disclaimer.
- **Console:** no application JavaScript errors. (Two transient
  `ERR_CONNECTION_REFUSED` log lines for `/api/health` occurred at startup and a
  `Not allowed to load local resource` line came from the test harness's mock of
  `URL.createObjectURL`; neither is an application fault.)

---

## 9. Files Changed / Added

| File | Change |
|---|---|
| `frontend/src/lib/params.ts` | registry rewritten: 6 descriptors, `PARAM_GROUPS`, semantics, `paramKeyFor` alar remap |
| `frontend/src/scene/transformations/types.ts` | `ModelState.alarWidth`, `initialModelState`, `ParamKey` + `SIMULATED_PARAM_KEYS` add `alarWidth` and `tipHeight` |
| `frontend/src/scene/transformations/logic.ts` | `resetModel` includes `alarWidth` |
| `frontend/src/scene/geometry/deformation.ts` | alar-width lateral deformation |
| `frontend/src/scene/geometry/regions.ts` | `alarWeight` doc updated to its driving parameter |
| `frontend/src/components/ParameterPanel.tsx` | grouped Bridge / Tip / Alar layout |
| `frontend/src/components/ParameterControl.tsx` | unchanged (already generic over a descriptor) |
| `frontend/src/App.css` | `.param-group*` styles |
| `frontend/src/App.tsx` | report lists all six parameters |
| `frontend/tests/params.test.ts` | new |
| `frontend/tests/ParameterPanel.test.tsx` | new |
| `frontend/tests/geometry.test.ts`, `frontend/tests/logic.test.ts` | extended |

No backend files were modified this phase.

---

## 10. Known Limitations (honest)

- **Nostril apertures are not modelled.** The mesh is a smooth head surface; the
  alar operation moves the wing surface laterally. It does not open or reshape an
  actual nostril opening, because the topology has no aperture to do so
  correctly. `alarWidth` therefore represents *alar wing spread*, not a change to
  a nostril hole.
- **Units are illustrative**, based on a 150 mm facial-width reference, not a
  verified patient calibration.
- **Bounds are prototype interaction limits**, not clinical limits.
- **Single-mesh, region-weighted** deformation with smooth blends at boundaries;
  it is an illustrative simulator, not a biomechanical model.
- No lips/cheeks/chin/jawline; no outcome prediction; no clinical claims.
