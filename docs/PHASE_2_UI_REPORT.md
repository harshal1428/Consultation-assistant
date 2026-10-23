# Phase 2 — Frontend UI/UX Redesign Report

**Project:** VoiceSurg 3D — voice-driven facial-simulation prototype
**Scope of this phase:** frontend UI/UX redesign only
**Status:** implemented, built, and verified at runtime
**Date:** 2026-10-13

---

## 1. Objective & Boundaries

Redesign the existing single-screen VoiceSurg 3D frontend into a clear, professional
clinical "consultation workspace" while keeping every existing integration and behaviour
intact.

**In scope**
- Visual design system, layout, typography, colour, spacing.
- Component structure and information architecture.
- Empty / loading / error / clarification states and UX honesty.
- Accessibility of new markup (labels, aria, keyboard).

**Explicitly out of scope (preserved untouched)**
- Backend parsing logic (`backend/app/parser.py`, `llm_parser.py`, `main.py`, `schemas.py`).
- The 3D deformation engine: `frontend/src/components/FaceDeformationViewer.tsx`
  (**unchanged** — confirmed absent from `git status`).
- API contracts (`POST /api/parse-command`, `GET /api/health`).
- No new runtime dependencies were added; all icons are inline SVG in `Icon.tsx`.

---

## 2. Design Direction

- **Light clinical theme:** white / soft-neutral surfaces, subtle borders, restrained
  teal accent (`--accent: #0f766e`) used for primary actions and active state.
- **Design tokens** centralised in `frontend/src/index.css` (colour, radius, shadow,
  spacing, type). `App.css` consumes tokens only.
- **Layout:** CSS grid `minmax(0, 1fr) 404px` — large 3D workspace on the left, a
  scrolling consultation/parameter column on the right; stacks to one column at ≤1180px
  and further relaxes at ≤720px.
- Respects `prefers-reduced-motion` (animations disabled).
- Honest labelling: the app never invents clinical numbers or probabilities.

---

## 3. Information Architecture

```
AppHeader            product title, phase chip, backend status, help
SimulationWorkspace  ViewerToolbar + FaceViewer (3D canvas) + before/after state
ConsultationPanel    VoiceInput · TranscriptView · typed-command form · IntentReview
ParameterPanel       ParameterControl per parameter (bridge/dorsum/tip) + session reset
ChangeHistory        ordered applied changes, undo, save-report, reset
```

`App.tsx` is the single orchestrator; `SimulationWorkspace` owns viewer-only UI state
(view mode, landmarks/wireframe/displacement toggles).

---

## 4. State Model

- `history: Command[]` is the **single source of truth**; the rendered model state is
  `modelState = applyAllCommands(history)`.
- **Voice commands** keep the pre-existing relative behaviour (`scale = 0.5`) — unchanged.
- **Manual slider edits** are stored as absolute `Command`s (`source: "manual"`, one
  replaceable entry per parameter) so they survive confirm/undo like any other change.
- `pendingCommand` holds the parsed instruction awaiting confirmation.

---

## 5. UX Honesty & Safety Features Added

- **Clamp warning:** detects when the backend silently limits an out-of-range value
  (e.g. 100 mm → 20 mm, 90° → 45°) from `original_text` and tells the user the value was
  adjusted (`detectClampWarning`).
- **Region clarification:** an explicit "Region not recognised" state when parsing
  cannot map an instruction to a supported region.
- **Qualitative confidence only** ("Low / Medium / High · parser estimate") — no fabricated
  percentages.
- **Disabled controls explain themselves** when voice/backend is unavailable.

---

## 6. Files Created / Modified / Removed

### Created
- `src/index.css`
- `src/lib/params.ts`, `src/lib/format.ts`
- `src/components/`: `Icon.tsx`, `StatusMessage.tsx`, `AppHeader.tsx`, `ViewerToolbar.tsx`,
  `FaceViewer.tsx`, `SimulationWorkspace.tsx`, `VoiceInput.tsx`, `TranscriptView.tsx`,
  `IntentReview.tsx`, `ConsultationPanel.tsx`, `ParameterControl.tsx`,
  `ParameterPanel.tsx`, `ChangeHistory.tsx`

### Modified
- `index.html` (title + meta description)
- `src/main.tsx` (imports `index.css`)
- `src/App.tsx`, `src/App.css` (full rewrite)
- `src/scene/transformations/types.ts`, `src/scene/transformations/logic.ts`
- `src/services/api.ts`, `src/services/speech.ts`

### Removed (dead Vite template)
- `src/components/Viewport.tsx`, `src/components/NoseModel.tsx`
- `src/main.ts`, `src/counter.ts`, `src/style.css`
- `src/assets/hero.png`, `src/assets/typescript.svg`, `src/assets/vite.svg`

---

## 7. Dependencies

**None added.** `package.json` is unchanged. Icons are inline SVG; `FaceViewer` uses the
already-present `@react-three/fiber` / `@react-three/drei` / `three`.

---

## 8. Verification

### Static
| Check | Command | Result |
|---|---|---|
| Typecheck + production build | `npm run build` (`tsc && vite build`) | **PASS** |
| Build output | — | `dist/index.html 0.63 kB`, `dist/assets/index-xr6QMUEL.css 15.65 kB`, `dist/assets/index-DZYRIOFA.js 1,183.85 kB` (gzip 325.75 kB) |
| Backend parser script | `python test_parser.py` (cwd `backend/`) | **PASS** — all sample commands parsed |

Only warning: Vite chunk > 500 kB (`three`-heavy bundle). Expected; not addressed in this
phase to avoid changing code structure.

### Runtime (headless Chrome + CDP, real backend on :8000, preview on :4173)

**Layout metrics**
| Viewport | Horizontal overflow | Canvas | WebGL context | Panels | Unlabelled controls |
|---|---|---|---|---|---|
| 1440 × 960 | none | present (919 × 574) | true | all 5 | 0 |
| 820 × 1100 | none | present (721 × 658) | true | all 5 | 0 |

**Voice/typed command flow** (`"Reduce the bridge by 2 millimetres"`)
- Backend `POST /api/parse-command` → `200 application/json`.
- Phase chip → "Awaiting confirmation"; `IntentReview` rendered with:
  Region **Nasal Bridge**, Parameter **Height**, Action **decrease**, Proposed change **−2 mm**,
  confidence **High (parser estimate)**, actions `Confirm & simulate / Edit / Reject`.
- After **Confirm**: parameter `height` = `-1 mm` (voice `scale 0.5` → preserved relative
  behaviour), history shows 1 entry `Nasal Bridge · Height · -2 mm`, review dismissed.

**Manual edit flow**
- Setting the bridge slider to `-5` → label `-5 mm`, "changed" badge shown, history entry
  with `source--manual` = `Nasal Bridge · Height · Set to -5 mm`.
  (Absolute value stored directly — confirmed distinct from voice relative scaling.)

**Toolbar**
- View modes `Original / Simulated / Compare` present and toggle; default is **Simulated**.
- Toggles `Landmarks / Wireframe / Displacement / Reset view` work (landmarks default on).

---

## 9. Known Limitations & Incomplete Functionality

- **Browser voice input untested here.** `SpeechRecognition` cannot run in headless Chrome;
  the microphone path is implemented (`services/speech.ts`) but only the typed-command path
  was exercised. It must be checked manually in a real browser (Chrome/Edge, secure context).
- **Backend LLM path used during verification.** The backend always tries Gemini first when
  a key is present. The deterministic fallback parser was validated directly via
  `test_parser.py`; the HTTP route was validated returning `200`. A fully offline HTTP run
  requires removing/blanking the key before process start.
- **Value semantics unchanged.** Voice deltas are applied at `scale 0.5` (existing behaviour),
  so a spoken "−2 mm" moves the slider by 1 mm while history records the instruction (−2 mm).
  This is intentional preservation of prior behaviour; it may read as an inconsistency and is
  a candidate for a future product decision (not changed here).
- **"mm" is uncalibrated** in the engine and is presented as simulation units, not verified
  clinical measurements.
- **Save report** is implemented client-side; no persistence/export verification against a
  backend was performed (feature is in-memory/session only).
- **Bundle size** warning (three.js) remains.
- **No automated test suite exists** for the frontend; verification was manual/programmatic.

---

## 10. How to Run

```powershell
# backend
.\.venv\Scripts\uvicorn.exe backend.app.main:app --port 8000

# frontend (dev)
cd frontend; npm run dev

# frontend (production preview)
cd frontend; npm run build; npm run preview -- --port 4173 --strictPort
```
