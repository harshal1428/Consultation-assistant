# Phase 7 — Multi-Region Facial Simulation Report

**Project:** VoiceSurg 3D — voice-driven facial-simulation prototype
**Scope of this phase:** extend the nose-only simulation to four additional regions
— **lips, chin, jawline and cheeks** — through one central multi-region parameter
registry, deterministic region-isolated geometry deformation, matching
parser/backend support, matching UI groups and landmarks, and numeric tests that
prove the regions stay independent.
**Status:** implemented, unit-tested, built, and verified end-to-end at runtime
(real backend parser + headless Chrome)
**Date:** 2026-10-14

---

## 1. Objective & Boundaries

Grow the simulated parameter set from six nasal controls to a **17-parameter,
five-region** set **without** rebuilding the engine or the UI.

**In scope**
- Five new target regions: `upper_lip`, `lower_lip`, `chin`, `jawline`, `cheek`.
- Eleven new parameters (lips ×4, chin ×3, jawline ×2, cheeks ×2) plus the
  existing six nasal parameters, defined in one registry.
- Deterministic, region-isolated deformation with explicit, bounded weights.
- Backend parser / validation / Gemini-prompt support for the new regions.
- UI region groups (`Nose / Lips / Chin / Jawline / Cheeks`) and new landmarks.
- Numeric tests proving region isolation and independence.

**Explicitly preserved (out of scope)**
- The volumetric head mesh is **not** replaced (`createHeadGeometry` untouched).
- No tissue biomechanics, no outcome prediction, no clinical-accuracy claim.
- No database, cloud, auth, or EMR.
- The Gemini provider and the deterministic rules parser are **not** replaced.
- No further full UI redesign; the Phase 2 layout is extended.
- Phase 8 is **not** started.

---

## 2. The 17 Parameters (single source of truth)

`frontend/src/lib/params.ts` remains the one registry the panel, the geometry and
the command mapping all read from. Every entry now also declares its `default`,
the parser `operations` it accepts, the geometry `deformation` (weight function)
it drives, and explicit `supported`/`voice`/`manual` flags.

| Key | Label | Region | Parameter | Unit | Default | Drives |
|---|---|---|---|---|---|---|
| `bridgeHeight` | Nasal bridge height | `nasal_bridge` | `height` | mm | 0 | `bridgeWeight` |
| `bridgeWidth` | Nasal bridge width | `nasal_bridge` | `width` | mm | 0 | `bridgeWidthWeight` |
| `tipProjection` | Tip projection | `nasal_tip` | `projection` | mm | 0 | `tipWeight` |
| `tipHeight` | Tip height | `nasal_tip` | `height` | mm | 0 | `tipWeight` |
| `tipRotation` | Tip rotation | `nasal_tip` | `rotation` | degrees | 0 | `tipWeight` |
| `alarWidth` | Alar width | `nostril_region` | `width` | mm | 0 | `alarWeight` |
| `upperLipProjection` | Upper-lip projection | `upper_lip` | `projection` | mm | 0 | `upperLipWeight` |
| `upperLipFullness` | Upper-lip fullness | `upper_lip` | `fullness` | mm | 0 | `upperLipWeight` |
| `lowerLipProjection` | Lower-lip projection | `lower_lip` | `projection` | mm | 0 | `lowerLipWeight` |
| `lowerLipFullness` | Lower-lip fullness | `lower_lip` | `fullness` | mm | 0 | `lowerLipWeight` |
| `chinProjection` | Chin projection | `chin` | `projection` | mm | 0 | `chinProjectionWeight` |
| `chinHeight` | Chin height | `chin` | `height` | mm | 0 | `chinHeightWeight` |
| `chinWidth` | Chin width | `chin` | `width` | mm | 0 | `chinWidthWeight` |
| `jawWidth` | Jaw width | `jawline` | `width` | mm | 0 | `jawWidthWeight` |
| `jawDefinition` | Jawline definition | `jawline` | `definition` | mm | 0 | `jawDefinitionWeight` |
| `cheekProjection` | Cheek projection | `cheek` | `projection` | mm | 0 | `cheekProjectionWeight` |
| `cheekFullness` | Cheek fullness | `cheek` | `fullness` | mm | 0 | `cheekFullnessWeight` |

Bounds are unchanged prototype interaction limits (lengths −10 … +10 step 1,
angles −45 … +45 step 1). Units remain **illustrative** (a 150 mm facial-width
reference); they are not clinical millimetres.

### Field independence (deliberately distinct controls)
- **lip projection vs lip fullness** — projection is a pure anterior translation;
  fullness is a smooth radial expansion about the lip centre, so the two are
  structurally different operations on the same region.
- **chin width vs jaw width** — chin width is localised near the midline
  (`|x| ≈ 0.12`); jaw width is a broad lower-lateral band (`|x| ≈ 0.42`).
- **jaw width vs jawline definition** — width inflates the broad jaw mass
  (`|x| ≈ 0.42`, `y ≈ −0.5`); definition sharpens a narrower, more-lateral border
  band (`|x| ≈ 0.5`, `y ≈ −0.47`).
- **upper lip vs lower lip** — two separate masses at `y = −0.36` and `y = −0.44`.

`paramKeyFor(target, parameter)` maps each supported pair to exactly one field and
returns `null` for anything else — it never guesses.

---

## 3. Geometry: New Region Weights & Deformation

Weights live in `frontend/src/scene/geometry/regions.ts`; all are evaluated from
the **immutable baseline** and stay bounded `0..1`. Each is a product of a front
mask and Gaussian `bell()` factors:

```
upperLipWeight        = frontMask · bell(x, 0, 0.13)      · bell(y, −0.36, 0.03)
lowerLipWeight        = frontMask · bell(x, 0, 0.14)      · bell(y, −0.44, 0.036)
chinProjectionWeight  = frontMask · bell(x, 0, 0.13)      · bell(y, −0.57, 0.075)
chinHeightWeight      = frontMask · bell(x, 0, 0.15)      · bell(y, −0.56, 0.085)
chinWidthWeight       = frontMask · bell(|x|, 0.12, 0.075) · bell(y, −0.56, 0.075)
jawWidthWeight        = frontMask · bell(|x|, 0.42, 0.17)  · bell(y, −0.5, 0.17)
jawDefinitionWeight   = frontMask · bell(|x|, 0.5, 0.13)   · bell(y, −0.47, 0.13)
cheekProjectionWeight = frontMask · bell(|x|, 0.4, 0.14)   · bell(y, −0.05, 0.12)
cheekFullnessWeight   = frontMask · bell(|x|, 0.43, 0.13)  · bell(y, −0.08, 0.12)
```

Deformation (`deformation.ts`) still recomputes every vertex from the baseline plus
the **full** current state, so reset/replay never drift.

| Parameter | Displacement applied (per vertex, weighted) |
|---|---|
| `upperLipProjection` | `+Z · dUpperLipProjection · wUpperLip` |
| `upperLipFullness` | radial `(Y,Z)` about `UPPER_LIP_CENTER` (smooth plump) |
| `lowerLipProjection` | `+Z · dLowerLipProjection · wLowerLip` |
| `lowerLipFullness` | radial `(Y,Z)` about `LOWER_LIP_CENTER` |
| `chinProjection` | `+Z · dChinProjection · wChinProjection` |
| `chinHeight` | `+Y · dChinHeight · wChinHeight · (y − CHIN_HEIGHT_PIVOT)` — positive **lengthens the chin downward** about the chin-top pivot `−0.5` |
| `chinWidth` | `sign(x) · dChinWidth · wChinWidth` |
| `jawWidth` | `sign(x) · dJawWidth · wJawWidth` |
| `jawDefinition` | `sign(x) · dJawDefinition · wJawDefinition` plus a small anterior component |
| `cheekProjection` | `+Z · dCheekProjection · wCheekProjection` (both sides) |
| `cheekFullness` | `sign(x) · dCheekFullness · wCheekFullness` plus a small anterior component (both sides) |

All lengths pass through the single `mmToScene` pathway; angles (only
`tipRotation`) through `degreesToRadians`. No other scaling exists.

### Region-isolation tolerances (asserted in tests)
The bands were chosen so one region's control does not move another's landmarks
beyond a documented small tolerance (`mmToScene(value) · 0.05` for adjacent
bands, `1e-3` scene units for structurally separated bands). Examples proven:
- upper-lip projection moves the **upper-lip** landmark but leaves the nose tip
  (`pronasale`) untouched and does not move the lower lip beyond tolerance;
- chin projection leaves the lips untouched;
- jaw width leaves the chin midline (`menton`) untouched; chin width leaves the jaw
  landmark untouched;
- cheek projection leaves the nose untouched; cheek fullness is symmetric about
  the midline (`left dx = −right dx`).

---

## 4. Backend: Parser, Validation & Prompt

- **`schemas.py`** — `TargetRegion` gains `upper_lip`, `lower_lip`, `chin`,
  `jawline`, `cheek`; `Parameter` gains `fullness`, `definition`.
- **`validation.py`** — `TARGET_PARAMETER_MAP` extended
  (`upper_lip/lower_lip → {projection, fullness}`, `chin → {projection, height,
  width}`, `jawline → {width, definition}`, `cheek → {projection, fullness}`);
  `fullness`/`definition` added to `LENGTH_PARAMETERS` (mm, ±10).
- **`parser.py`** — `TARGET_SYNONYMS` gains upper/lower lip, jawline, chin, cheeks;
  `UNSUPPORTED_REGION_TOKENS` drops the newly supported words (brow, forehead,
  eyes, ears, mouth remain unsupported); `PARAM_FULLNESS` and `PARAM_DEFINITION`
  regexes added; region-appropriate defaults (lips/chin/cheeks → `projection`,
  jawline → `width`).
- **Lip-verb fix** — *"lower lip"* contains the verb *"lower"*, which previously
  read as a downward operation. A `LIP_QUALIFIER` pass neutralises
  `upper/top/lower/bottom lip` before verb, direction and contradiction detection,
  so **"Add fullness to the lower lip"** parses as an increase on the lower lip.
- **A bare "lip" is ambiguous** → `needs_clarification` asking upper vs lower; it is
  never guessed.
- **`llm_parser.py`** — the Gemini system instruction lists the new targets,
  parameters, synonyms, the fullness/definition mapping, and the
  "bare lip ⇒ target null" rule. No new provider or operation was added.

---

## 5. UI

- **`ParameterPanel`** now renders five region groups — **Nose, Lips, Chin,
  Jawline, Cheeks** — with a subtitle stating it covers all supported regions.
  Each group is generated from `PARAM_GROUPS` + `descriptorsForGroup`, so the
  panel can never disagree with the registry.
- **`FaceDeformationViewer`** renders markers for the new landmarks
  (`upper_lip`, `lower_lip`, `menton`, `cheek_l/r`, `jaw_l/r`) and the sagittal
  profile line now runs nasion → rhinion → pronasale → subnasale → **upper lip →
  lower lip → pogonion → menton**.
- The panel is a plain list of sliders; no clinical recommendations are shown, and
  the existing illustrative-scale footnote is retained.

---

## 6. Files

**Changed — registry & state**
- `frontend/src/lib/params.ts` — 17 descriptors, 5 groups, extended
  `ParamDescriptor` (`default`, `operations`, `deformation`, `supported`, `voice`,
  `manual`), extended `REGION_OPTIONS` and `paramKeyFor`.
- `frontend/src/scene/transformations/types.ts` — 17-field `ModelState` +
  `initialModelState`, extended `TargetRegion`/`Parameter`/`ParamKey`, refreshed
  `SIMULATED_PARAM_KEYS`.
- `frontend/src/scene/transformations/logic.ts` — `resetModel` returns
  `{ ...initialModelState }`.

**Changed — geometry**
- `frontend/src/scene/geometry/headShape.ts` — strengthened lip masses and chin.
- `frontend/src/scene/geometry/regions.ts` — nine new weight functions.
- `frontend/src/scene/geometry/deformation.ts` — all 17 parameters applied from
  the baseline; new `UPPER_LIP_CENTER`, `LOWER_LIP_CENTER`, `CHIN_HEIGHT_PIVOT`.
- `frontend/src/scene/geometry/landmarks.ts` — seven new landmarks (14 total).

**Changed — UI**
- `frontend/src/components/ParameterPanel.tsx`, `FaceDeformationViewer.tsx`.

**Changed — backend**
- `backend/app/schemas.py`, `validation.py`, `parser.py`, `llm_parser.py`.

**Tests**
- `frontend/tests/params.test.ts`, `geometry.test.ts`, `session.test.ts`,
  `ParameterPanel.test.tsx` (updated/extended).
- `backend/tests/test_parser.py` (unsupported region changed to *forehead*; new
  lip/chin/jawline/cheek coverage).

---

## 7. Verification

**Frontend unit/component tests — 102 passing / 10 files.**
`geometry.test.ts` adds a *multi-region deformation* suite (lip independence,
fullness behaviour, chin projection/height, chin-vs-jaw width independence,
jaw definition, cheek symmetry and nose isolation) and checks every new weight is
finite and bounded `0..1`. `params.test.ts` asserts the exact 17-key set, the five
ordered groups, and each descriptor's target/parameter mapping.

**Backend — 35 tests passing** (rules parser + orchestration; new region coverage).

**Build —** `tsc && vite build` clean (only the pre-existing >500 kB chunk warning).

**Runtime end-to-end (headless Chrome, real backend on :8000, preview on :4173)**
- Parameter panel renders **17 sliders** in the five groups
  (Nose/Lips/Chin/Jawline/Cheeks), correct ids and values.
- Manual edits to `chinHeight`, `jawWidth`, `jawDefinition`, `cheekFullness` each
  register as the correct history row (`Chin · Height · Set to +6 mm`, etc.).
- Voice/typed command **"Increase the upper lip projection by 2 mm"** parsed by the
  language model → review card *Region Upper Lip · Parameter Projection · +2 mm ·
  Ready to apply* → **Confirm & simulate** → applied (`upperLipProjection = 2`),
  history row *Upper Lip · Projection · +2 mm*, review closed.
- **Unsupported region still refused:** *"Make the forehead bigger"* →
  *Not supported* with the updated supported-region list; confirm disabled.
- **No console errors and no failed requests.**

---

## 8. Honest Limitations

- The model is a **stylized geometric head**, not a patient/DICOM mesh; the new
  regions are smooth Gaussian deformations of an ellipsoid-derived surface.
- Units/bounds are **illustrative** interaction limits, not validated clinical
  ranges, and are not a prediction of surgical outcome.
- Lip **fullness** is a documented geometric stand-in (a smooth radial plump about
  the lip centre), not a soft-tissue or volume model.
- Chin height scales the chin about a fixed pivot (a simple, stable stand-in), not
  an osteotomy or an occlusal change.
- The 3D view is visual/numeric only; the heatmap shows relative displacement
  intensity, not physical units.

## 9. Not Started

Phase 8 was not started, per scope.
