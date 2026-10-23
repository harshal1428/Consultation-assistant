# Live Simulation & Face Correction Report

Status: implemented and verified for objectives 1–6, in the requested order.
Scope: `frontend/` (React + three.js) and, where relevant, the existing backend
parser contract. No external/cloud service is used for the head, the personal
photo, or the change log.

This report is deliberately conservative: it states exactly what was built, how
it was verified, and what remains limited. It does **not** claim photorealism or
clinical accuracy.

---

## 1. Default 3D face — the duplicate nose bulges (Objective 1)

### 1.1 Root cause (confirmed in geometry)

The default head is the procedural mesh sculpted in
`frontend/src/scene/geometry/headShape.ts` (`shapeInto`). The previous nose was
built from **two overlapping gaussian contributions**:

- a "dorsum corridor" bell centred at `y = 0.14` with σ ≈ `0.17`, and
- a wider "tip ball" bell centred at `y = -0.16` with σ ≈ `0.085`.

Because the two bells were summed, the surface height rose toward each centre and
**dipped in between** — a waist at roughly `y ≈ -0.05`. Visually this read as two
separate rounded bulges on the nose rather than one continuous dorsal ridge. The
effect was amplified because landmark marker spheres were drawn **by default**
(`showLandmarks` defaulted to `true`), which added apparent "lumps" on top of the
geometry.

### 1.2 Fix

The nose is now a **single monotonic dorsum**:

- `noseS = clamp((0.30 - dy) / (0.30 + 0.16), 0, 1)` runs from 0 at the nasion to
  1 at the tip;
- a single fade window `noseWindow` turns the ridge on above the nasion and off
  below the subnasale;
- one amplitude that increases toward the tip, `dorsumAmp = 0.05 + 0.20*noseS`,
  with a width that also grows, `dorsumSigma = 0.045 + 0.055*noseS`, drives the
  height: `fz += dorsumAmp * noseWindow * bell(dx, 0, dorsumSigma)`.

Supporting structures were kept low so they blend into the dorsum and do not read
as separate spheres: alar wings (`0.045`, centred at `dy = -0.185`), nostril
recesses (`-0.05`, at `dy = -0.22`), and a columella/sill ridge (`0.018`, at
`dy = -0.245`).

- `frontend/src/components/SimulationWorkspace.tsx`: `showLandmarks` default
  changed `true → false`, so marker spheres no longer sit on the surface by
  default.
- Eyes were also tightened for realism in
  `frontend/src/scene/geometry/facialFeatures.ts` (`EYE.ballRadius 0.088→0.082`,
  `irisRadius 0.042→0.04`, `pupilRadius 0.017→0.016`, `backset 0.062→0.07`) and
  `frontend/src/components/FaceDeformationViewer.tsx` (eyelid caps enlarged and
  the palpebral aperture narrowed so the lids cover more of the eyeball).

### 1.3 Verification of the fix

A new test file `frontend/tests/faceProfile.test.ts` asserts **anatomical profile
invariants** that directly contradict the old defect:

- the midline height from nasion → tip rises **monotonically** (no waist);
- the tip is the most anterior midline point;
- the profile falls off continuously toward the subnasale;
- every transverse nose slice has a **single central maximum** (no double bulge);
- the depth budget stays within bounds; and
- the sculpt is left/right symmetric.

All 6 invariants pass. `frontend/tests/geometry.test.ts` additionally verifies
that all 17 simulated parameters still produce a finite, non-zero, localized
deformation on the reworked sculpt, and that the nose parameters do not move the
chin.

### 1.4 Which model is used as the default, and its licence

The default head remains the **procedurally generated mesh** in
`headShape.ts` / `headMesh.ts`. It is generated at runtime from code in this
repository and carries **no third-party mesh licence** because no external mesh is
bundled.

Why no external scanned head was integrated: the candidate assets that were
investigated each had an unverifiable or restrictive licence for this use, or
would have required re-authoring all region weights for a foreign topology and
scale. `headShape.ts` documents this decision. The only bundled third-party model
is `frontend/public/models/face_landmarker.task` (see §2), which is
**Apache-2.0** and is used *only* for detecting landmarks in an uploaded photo — it
is not the base head geometry.

### 1.5 Honest limitation

This environment cannot display images, so the default face was verified
**numerically** (geometry invariants) and by **browser runtime DOM/pixel checks**,
not by human visual inspection. The geometry-level defect (double bulge) is
removed with certainty; the overall aesthetic realism of a procedural head is
improved but is not a likeness of any real person and is not photorealistic.

---

## 2. Photo personalization — does the photo really change geometry? (Objective 2)

Yes. An uploaded photo is processed **entirely on the device**:

1. `frontend/src/services/faceLandmarker.ts` lazily imports
   `@mediapipe/tasks-vision` (bundled locally under `frontend/public/mediapipe/`
   with the model at `frontend/public/models/face_landmarker.task`) and returns
   the 478-point Face Mesh landmark set.
2. `frontend/src/services/faceReconstruction.ts` measures the face and maps it to
   bounded morph coefficients (`profileToMorph`).
3. `frontend/src/hooks/useFacePersonalization.ts` stores the derived
   `{ morph, skinTone, profile, photoName }`; the photo file itself is never
   uploaded and the preview object URL is revoked on removal/unmount.

### 2.1 Genuine 3D influence (this iteration)

The MediaPipe Face Mesh is a trained **3D** surface regressor: each landmark
carries an estimated depth `z`, not just `x/y`. `faceReconstruction.ts` now
consumes that depth:

- `measureProfile` computes `noseProjectionDepth = (z(bridge) − z(tip)) / zSpread`,
  normalised by the landmark depth spread (scale-invariant), with a guarded
  fallback to the typical value when depth is flat/missing;
- `profileToMorph` maps the deviation from `TYPICAL_PROFILE.noseProjectionDepth`
  onto the `noseTip` morph coefficient.

So a photo whose recovered depth shows a **projecting nose** now drives a more
projected 3D tip, in addition to the existing transverse proportion terms
(face width/height, eye spacing, nose/mouth/jaw ratios). This is a real
geometry change driven by the photo, not a skin-tone-only effect.

Honest limit: a single frontal photo yields a **bounded** depth estimate, so the
depth-derived term is conservative. This is a proportion fit, not a
photogrammetric face scan.

### 2.2 Remove Photo

`frontend/src/components/PhotoPanel.tsx` provides a **Remove photo** button wired
to `useFacePersonalization.remove`, which:

- clears the active personalization (morph → neutral, skin tone → default),
- revokes the preview object URL, and
- leaves the consultation session and any applied changes intact.

Removing a photo tied to a **saved** consultation is an explicit, separate action
(the archived record stores only the derived `{morph, skinTone, profile,
photoName}` — never the image bytes), so deleting a photo never silently mutates
saved history.

---

## 3. Continuous Live Simulation (Objective 3)

Live Simulation mode now hosts a continuous voice loop, not a slider-first view.

- **Start**: a single **Start live simulation** button opens a continuous
  recognition session (`SpeechService` now supports `continuous: true`).
- **Continuous processing**: every **finalized utterance** is emitted exactly once
  via a new `onFinalSegment` callback and immediately parsed + applied. A
  **1-second duplicate guard** ensures the same utterance cannot trigger two
  parser/geometry requests.
- **Auto-restart**: browsers close recognition sessions on their own, so after
  `onEnd` the loop restarts automatically (300 ms) while live mode remains active.
- **Stop**: **Stop live simulation** ends recognition only. It never ends, clears
  or deletes the consultation, the applied history, or the change log. Leaving
  Live mode also stops listening.
- **Typed fallback**: a typed field in the panel feeds the *same* live handler
  (source `typed`) for browsers without speech or when the mic is unusable.
- **Error handling**: permission denial / missing microphone / unsupported
  browser stop the loop with a typed, retryable error instead of retrying forever.
- **Stale-response guard**: a token is bumped on new consultation / reset / end,
  so an in-flight parse can never resurrect a cleared state.

### 3.1 Which instructions auto-apply vs. need clarification

`evaluateLiveInstruction` (`frontend/src/scene/live/logic.ts`) auto-applies an
instruction **only when all** of the following hold:

- the parser reports it as `ok`;
- it is **not** out of range (no `adjusted_value`);
- its `(target, parameter)` pair maps to a real model field in the parameter
  registry (`paramKeyFor`); and
- its magnitude resolves to a **non-zero** change.

Anything else is **recorded with an explicit status and reason** instead of being
applied or silently clamped: `needs_clarification`, `unsupported`, `out_of_range`,
`no_change`, or `not_applied`. Out-of-range requests are reported as
**"Out of range · not applied"** with the suggested in-range value.

---

## 4. Recording every change + CSV / JSON / PDF downloads (Objective 4)

Every handled instruction — applied or not — is appended to an append-only live
change log (`LiveEvent`). Each entry records:

- timestamp (`at`), `source` (`live_voice` / `typed` / `manual`), the exact
  original utterance;
- target region, parameter, and the **resolved parameter key** (plus the intended
  key for range rejections);
- requested value + unit **and** the normalised value + unit;
- execution status, the **before/after** model values and the resulting change;
- the clarification/error/range reason; and parser confidence.

Exports are produced client-side from that log by
`frontend/src/scene/live/logic.ts`:

- **CSV** — full header + one row per event, RFC-style quoting/escaping.
- **JSON** — `{ exportedAt, count, events[] }`.
- **PDF** — a real PDF 1.4 file written without any dependency (Helvetica, A4,
  multi-page, with a correctly computed xref table). Verified structurally in
  `frontend/tests/live.test.ts` (byte offsets match the xref entries; ASCII-only
  so offsets equal UTF-8 byte positions).

The panel surfaces the log newest-first with a status chip per entry and a
running `N applied` count, and the applied changes also appear in the existing
change history (so undo/reset/report continue to work).

---

## 5. Persistence without regression (Objective 5)

- Applied live changes flow through the existing `Command[]` history, so the
  canonical model state is unchanged in shape and the existing archive restores
  it via `stateToCommands`.
- `ArchivedConsultation` gained an optional `liveEvents?: LiveEvent[]`; archiving
  captures the current live log and restoring repopulates it. Old records without
  the field still load (`?? []`).
- Photo personalization continues to archive/restore via the optional
  `personalization` field. Both modes share the single canonical model state, so
  switching modes never loses work.

---

## 6. Tests, browser runtime, and build (Objective 6)

Run from `frontend/`:

- **Unit/component tests**: `npx vitest run` → **22 files / 203 tests passed**
  (baseline before this work: 18 files / 157 tests). New coverage:
  - `tests/faceProfile.test.ts` — nose midline anatomical invariants;
  - `tests/live.test.ts` — auto-apply policy, rejections, CSV/JSON/PDF;
  - `tests/LiveSimulationPanel.test.tsx` — panel states and exports;
  - `tests/speech.test.ts` — continuous mode + `onFinalSegment`;
  - additions to `tests/faceReconstruction.test.ts` (depth term) and
    `tests/App.test.tsx` (live workspace integration), and
    `tests/geometry.test.ts` (all-parameter deform on the new sculpt).
- **Typecheck**: `npx tsc --noEmit` → clean.
- **Production build**: `npm run build` → succeeds (Vite).
- **Browser runtime (headless Chrome via CDP)**, harness
  `%TEMP%\opencode\live_check.mjs`:
  - Live mode shows the **Live simulation** panel with a Start control and an
    empty log;
  - a typed instruction **"increase the chin projection by 3 millimetres"**
    auto-applied: log row `Applied … 0 → 3 mm`, panel `1 applied`, change count
    `1`;
  - **"reduce the nasal bridge height by 100 millimetres"** was logged as
    `Out of range · not applied` with `0 applied` and no model change;
  - **no console errors, no page exceptions**, and `/api/parse-command` returned
    **200**.

---

## 7. Order of work (Objective 7)

Work proceeded in the requested order: (1) default face + duplicate-bulge
geometry fix; (2) photo personalization + Remove Photo, extended to genuine 3D
depth; (3) continuous Live Simulation; (4) recording + CSV/JSON/PDF; (5)
persistence; (6) tests + browser runtime + build; (7) this report.

---

## 8. Remaining limitations (honest)

- The default head is a **stylized procedural model**, not a photorealistic or
  scanned likeness; it is not a real person.
- The default face was verified **numerically/at runtime**, not by human visual
  inspection (this environment cannot display images).
- Photo reconstruction is a **single-image proportion + bounded depth fit**, not a
  photogrammetric face model; it does not recover true depth with clinical
  fidelity.
- Browser specifics apply to live mode: speech recognition is a **network**
  service in Chromium, the "is listening" state is inferred from events, and the
  supported language list varies by browser. Typed input is the guaranteed path.
- Units and ranges are **illustrative prototype values**, not medically approved
  limits.
- This is a simulation/education prototype: not a diagnostic, surgical-planning,
  or clinical record-keeping tool.
