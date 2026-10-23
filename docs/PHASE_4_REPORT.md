# Phase 4 — 3D Facial Geometry Foundation Report

**Project:** VoiceSurg 3D — voice-driven facial-simulation prototype
**Scope of this phase:** replace the flat relief with a genuine volumetric head, add a
documented coordinate/scale system, and rebuild the deformation layer around an immutable
baseline with structurally separated nasal regions
**Status:** implemented, unit-tested, built, and verified at runtime
**Date:** 2026-10-13

---

## 1. Objective & Boundaries

Give the prototype a credible, reusable 3D head/face geometry foundation that the existing
voice pipeline and Phase 2 UI can drive, without exaggerating anatomical claims and without
rebuilding the application.

**In scope**
- Replace the `PlaneGeometry` facial relief with a genuinely three-dimensional head mesh.
- A documented coordinate system, origin, orientation and unit/scale convention.
- One explicit, central geometry scale pathway (no duplicated or hidden scaling).
- An immutable baseline + parameter-to-displacement engine that cannot drift.
- Structurally separated nasal regions (bridge/dorsum, tip, alar/nostril).
- Landmarks and displacement visualisation derived from the real geometry difference.
- Automated geometry/scale/deformation tests and a runtime rendering check.

**Explicitly out of scope (preserved)**
- No rebuild from scratch; the Phase 2 UI, layout, tokens and toolbar are retained.
- No UI redesign in the Phase 4 review sense; only the viewer integration points changed.
- No clinical/patient-specific calibration claims; no validated measurements.
- No Phase 5 feature set (no lips/chin/jawline/cheek simulation, no biomechanics).
- No runtime asset fetching from a cloud model service.

---

## 2. Decision: Generated Volumetric Head (not an imported asset)

The task prefers a properly licensed asset when topology and license fit. Existing candidates
were evaluated at runtime:

| Candidate | Reachable | Outcome |
|---|---|---|
| `threejs.org/examples/models/gltf/facecap.glb` | 200 (333 kB) | license/attribution not verifiable offline |
| `threejs.org/examples/models/gltf/LeePerrySmith/LeePerrySmith.glb` | 200 (405 kB) | license/attribution not verifiable offline |
| `threejs.org/examples/models/gltf/Nefertiti/Nefertiti.glb` | 200 (1.2 MB) | not a human face |
| `raw.githubusercontent.com` (repo sources / license files) | connection timeout | could not retrieve authoritative license text |

Because the licensing terms of the available models could not be *authoritatively verified*, and
the task explicitly forbids shipping assets with unclear terms, we implemented the sanctioned
fallback: a **generated, closed, volumetric parametric head**. This also avoids a large binary
asset, an external loader dependency, and runtime load failures. The choice and its limits are
recorded here and in the code.

---

## 3. Coordinate System, Units & Scale

Documented in `frontend/src/scene/geometry/headShape.ts` and `config.ts`.

- **X:** left (−) / right (+) across the face, mirrored about `X = 0`.
- **Y:** inferior (−) / superior (+).
- **Z:** posterior (−) / anterior (+). The face points toward **+Z**.
- **Origin:** centre of the head ellipsoid (the mesh is centred on the origin; the viewer
  re-centres for framing).
- **Units:** scene units (SU). The ellipsoid semiaxes are `rx = 0.70`, `ry = 0.92`, `rz = 0.86`
  (`HEAD_SHAPE` / `HEAD_BOUNDS`).

### Scale (single pathway)

`GEOMETRY_SCALE.sceneUnitsPerMm = (2 * rx) / 150 = 1.40 / 150 ≈ 0.009333 SU/mm`.

- The *only* length conversion is `mmToScene(mm)`; there is no other length factor anywhere in
  the viewer or the engine. The previous scattered `0.08` factors were removed.
- Angles use `degreesToRadians` and are never multiplied by a length scale.
- **Assumed reference (illustrative):** the facial width (2·rx) represents an adult facial width
  of 150 mm. The generated head has no verified physical dimensions, so this is labelled an
  *illustrative reference scale* — a visualisation aid, **not** a clinical calibration. The
  workspace note states this in the UI.

For context, the previous engine used `0.08 SU/mm`, which made a 10 mm change ≈ 0.8 SU — roughly
57 % of the head width. The corrected scale makes a 10 mm change ≈ 0.093 SU, i.e. anatomically
proportioned rather than caricatured.

---

## 4. Architecture

New geometry layer under `frontend/src/scene/geometry/`:

| Module | Responsibility |
|---|---|
| `config.ts` | coordinate/scale constants, `mmToScene`, `degreesToRadians`, `safeNumber` |
| `headShape.ts` | analytic head ellipsoid + feature sculpting; `HEAD_SHAPE`, `HEAD_BOUNDS`, `shapeInto`, `surfacePoint` |
| `headMesh.ts` | `createHeadGeometry()` — builds the closed baseline mesh (remapped sphere) |
| `regions.ts` | `bridgeWeight`, `bridgeWidthWeight`, `tipWeight`, `alarWeight` (baseline-evaluated, 0–1) |
| `deformation.ts` | `deformPositions(base, state)` — baseline-driven positions, displacement, heat colours |
| `landmarks.ts` | landmark definitions, nearest-vertex resolution, deformed landmark positions |
| `index.ts` | re-exports |

`FaceDeformationViewer.tsx` was rewritten to consume this layer: it holds the immutable baseline,
derives deformed geometry from it on every state change, resolves landmarks against the deformed
positions, and renders the mesh, optional wireframe, landmarks and sagittal guide.

The Phase 3 command pipeline is untouched: `modelState` is still produced by
`applyAllCommands(history)`; the geometry layer simply consumes the validated canonical values.

---

## 5. Mesh: Generation & Quality

`createHeadGeometry()` starts from a `THREE.SphereGeometry(1, 192, 128)` and remaps **every
direction** to `shapeInto(dx, dy, dz)` — an ellipsoid point plus anterior facial-feature offsets
gated by a smooth front mask.

- **Closed & volumetric:** it is a remapped sphere, so the surface is closed (no holes) and has a
  crown, back of head, jaw, cheeks, brow, eye sockets, nose (bridge, tip, alar wings), philtrum,
  lips and chin. It is not a thickened plane.
- **Resolution:** 193 × 129 = **24,897 vertices** (~49k triangles); enough for smooth local nasal
  deformation, light for an interactive scene.
- **Features fade to zero at the silhouette** (smooth front mask), so there is no tearing and no
  self-intersection at the edges.
- **Depth check (numeric):** mesh Z-extent > 1.4 SU, min Z < −0.5 SU (back of head present), and
  max Z > `rz` (the nose projects beyond the ellipsoid) — see tests.
- **Normals:** `computeVertexNormals()` after remapping; the outward-normal ratio is asserted
  > 90 % in tests (measured ≫ 99 %). The material uses `THREE.FrontSide` on the closed surface.

---

## 6. Region Separation & Deformation Semantics

Weights are always evaluated from the **immutable baseline**, never from already-deformed
geometry, so deformation is drift-free.

- **Bridge/dorsum** — midline band centred at `y ≈ 0.17`, `x` σ 0.085.
- **Bridge width** — lateral band peaking at `|x| ≈ 0.075`, `y ≈ 0.20`, deliberately **above** the
  alar band.
- **Tip** — apex centred at `(0, −0.16)`.
- **Alar/nostril** — wings at `(±0.15, −0.19)`; reserved for a future explicitly-requested alar
  operation and **not driven by any current parameter**.

Parameter mapping (`ModelState`, unchanged contract):

| Parameter | Effect | Pathway |
|---|---|---|
| `bridgeHeight` | anterior/posterior translation of the dorsum (Z) | `mmToScene` |
| `bridgeWidth` | lateral translation of the dorsum sides (X) | `mmToScene` |
| `tipHeight` | superior/inferior tip translation (Y) | `mmToScene` |
| `tipProjection` | anterior tip translation (Z) | `mmToScene` |
| `tipRotation` | weighted rotation about the **subnasale pivot**, positive = cranial (tip up) | `degreesToRadians` |

**Key fixes vs the old engine**
- The old alar deformation reused the bridge-width delta (coupling). Now bridge width cannot widen
  the nostrils; the alar region has its own weight and no driving parameter.
- Tip deformation is localised so it does not move the bridge landmark (verified numerically).
- Rotation uses a documented pivot (`TIP_ROTATION_PIVOT`, the subnasale) and preserves the pivot
  radius exactly.
- Positions are recomputed from baseline + the full state, so reset reproduces the baseline and
  repeated application never accumulates drift.

---

## 7. Landmarks & Displacement Visualisation

- **Landmarks** (`nasion`, `rhinion`, `pronasale`, `subnasale`, `alare_l/r`, `pogonion`) are
  authored as facial coordinates and resolved to the **nearest actual mesh vertex**; markers and
  the sagittal guide therefore follow the deformed geometry instead of hard-coded z-offsets.
- **Displacement heatmap** colours are computed from the real per-vertex baseline-vs-simulated
  distance and normalised by the **maximum displacement in the current state**, so the colour
  encodes *relative* intensity and is independent of physical units. This is distinct from the
  physical displacement magnitude.

---

## 8. Integration & UI Preservation

- Viewer toolbar (Original / Simulated / Compare), Landmarks / Wireframe / Displacement toggles,
  and camera controls are unchanged and functional.
- Compare mode still renders two canvases (baseline vs simulated) with consistent lighting.
- Camera and grid were retuned for the new scale (`FaceViewer.tsx`: camera `[1.7, 0.45, 2.9]`,
  distance 1.1–6, grid lowered to `y = −1.05`).
- The consultation panel, change review, parameter sliders, undo/history and reset are untouched.
- The workspace note was updated to state the illustrative reference scale honestly.

---

## 9. Automated Tests

`frontend/tests/geometry.test.ts` — 22 tests (the full frontend suite is now **40 tests / 5
files**, all passing). Coverage:

- **Mesh:** dense finite mesh, genuine depth/crown/back-of-head, outward normals, documented
  bounds.
- **Scale & coordinates:** reference `150 mm → 1.40 SU`, angle vs length separation, exactly one
  length scale applied to a tip displacement, non-finite (NaN/Inf) guarding.
- **Deformation:** zero state reproduces baseline, determinism, reset/replay without drift,
  bridge width does not move the alar vertex, bridge width does move the dorsum sides, tip
  projection does not move the bridge, tip rotation preserves the pivot radius and lifts the tip,
  existing command pathway propagates, heatmap normalisation bounded.
- **Region weights:** finite and bounded across the mesh, bridge-width band clear of the alar
  band, tip band clear of the bridge landmark.
- **Landmarks:** documented set, valid vertex indices, follows the geometry.

```
frontend:  Test Files  5 passed (5)   Tests  40 passed (40)
backend:   Ran 29 tests  OK
```

### Commands
```
frontend>  npm test        # vitest run  -> 40 passed
frontend>  npm run build   # tsc && vite build -> OK
backend>   & "..\.venv\Scripts\python.exe" -m unittest discover -s tests -v
```

---

## 10. Build & Runtime Verification

**Production build** (`npm run build`): `tsc` passes; bundle `dist/assets/index-*.js` ≈ 1,188 kB
(gzip ≈ 327 kB) — only the pre-existing >500 kB chunk-size warning.

**Runtime (headless Chrome via CDP, preview build on `:4173`, backend on `:8000`):**

- Single view: 1 canvas, 919 × 574; no page overflow (`scrollWidth − innerWidth = −15`).
- Toolbar present: modes `[Original, Simulated, Compare]`, toggles `[Landmarks, Wireframe,
  Displacement, Reset view]`.
- Three camera views all render non-blank head content and are materially different
  (region grey-level std: front 26.6, side 37.3, three-quarter 39.3; pairwise mean abs diff 15.2 /
  14.8 / 8.1) — consistent with a volumetric model.
- Manual parameter pipeline (no backend dependency): setting Tip projection to +10 mm produced a
  history entry (`Nasal Tip | Projection · Set to +10 mm`) and a display of `+10 mm`; the
  Simulated view differs from Original over the nose/face region (region max grey change 102,
  1.9 % of sampled pixels changed). Tip rotation adds a further change.
- **Reset:** returning sliders to 0 reproduced the baseline render (mean diff 0.0155, 0.03 % of
  pixels — breathing-animation edge noise only).
- No application JavaScript errors; only a dependency deprecation warning
  (`THREE.Clock` from `@react-three/fiber`).
- Backend health probe returned **200**.

Screenshots were captured to `%TEMP%\opencode\p4_{front,side,threequarter,orig,sim,rot,reset}.png`.

---

## 11. Honest Limitations

- The head is a **generated stylised prototype**, not a patient scan or a topological human head
  dataset; it is symmetric and simplified.
- The scale is an **illustrative reference** (150 mm facial width assumption); there are no
  verified dimensions and no clinical calibration.
- Deformation is a **visual weighting approximation**, not a tissue or biomechanical model; region
  weights are heuristic.
- The alar region is structurally present but has **no driving parameter yet** (Phase 5 scope).
- Only five nasal parameters are simulated; other facial regions are static.
- The mesh material/lighting are cosmetic and do not imply measurement accuracy.

---

## 12. Files Changed / Added

**Added**
- `frontend/src/scene/geometry/{config,headShape,headMesh,regions,deformation,landmarks,index}.ts`
- `frontend/tests/geometry.test.ts`
- `docs/PHASE_4_REPORT.md`

**Changed**
- `frontend/src/components/FaceDeformationViewer.tsx` (new geometry layer, volumetric mesh)
- `frontend/src/components/FaceViewer.tsx` (camera/grid retuned for the new scale)
- `frontend/src/components/SimulationWorkspace.tsx` (honest scale note)

The Phase 3 backend, parser, validation, consultation UI, styles and history logic are unchanged.
