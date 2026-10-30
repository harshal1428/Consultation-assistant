# VoiceSurg 3D — Developer Guide

> **Prototype for simulation and educational purposes only.** This guide explains
> how to build, test, extend and operate the code. It does not imply clinical
> validation. See [Architecture §10](ARCHITECTURE.md#10-data-privacy-and-security).

Audience: a developer who is new to the repository and needs to run it, change it
or review it. Read [Architecture](ARCHITECTURE.md) first if you want the conceptual
picture; this document is the practical companion.

---

## 1. What you are working on

A two-process application:

| Process | Stack | Entry point |
| --- | --- | --- |
| Backend | Python 3, FastAPI, Pydantic, optional `google-genai` | `backend/app/main.py` |
| Frontend | React 19, TypeScript 6, Vite 8, Three.js | `frontend/src/main.tsx`, `App.tsx` |

The backend turns language into a validated JSON instruction. The frontend owns
the simulation: geometry, history, scenarios, photos and storage. There is no
database, no authentication and no server-side session.

---

## 2. Setup and daily workflow

### 2.1 Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Python | 3.10+ | No pinned version file; the code uses modern typing syntax. |
| Node.js | 20+ | Vite 8 requires a current LTS. |
| npm | Bundled with Node | `package-lock.json` is the source of truth. |
| Chrome or Edge | Current | Best Web Speech and WebGL behaviour. |

### 2.2 First-time setup

```powershell
# From the repository root
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip

# Backend dependencies
.\.venv\Scripts\python.exe -m pip install fastapi uvicorn pydantic python-dotenv google-genai

# Optional: the root requirements.txt only lists three packages
# (fastapi, uvicorn, pydantic). google-genai and python-dotenv are imported by
# the app but missing from that file.
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Frontend dependencies
cd frontend
npm install
```

### 2.3 Environment variables

Create `.env` in the repository root:

```dotenv
GEMINI_API_KEY=your-key-here
```

- `.env` is gitignored and must never be committed.
- `backend/app/main.py` loads `../../.env` relative to itself, i.e. the root.
- Without a key, the LLM path is skipped and the deterministic parser serves
  every request. The app remains fully usable.
- `backend/.env` also exists in some checkouts; it is gitignored too. Keep one
  authoritative file to avoid confusion.

### 2.4 Run

```powershell
# Terminal 1 — backend
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open `http://localhost:5173`. The frontend resolves the API base from
`VITE_API_BASE_URL` (default `http://127.0.0.1:8000`) in
`frontend/src/services/api.ts`.

### 2.5 Daily loop

```text
edit → tsc --noEmit → npm test (frontend) / unittest (backend) → manual check
```

The repository has no lint or format step; keep the existing style and let the
TypeScript compiler catch unused symbols and fallthrough.

### 2.6 If something does not start

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ModuleNotFoundError: google.genai` | Dependency not installed | `pip install google-genai` |
| `ModuleNotFoundError: dotenv` | Dependency not installed | `pip install python-dotenv` |
| Backend starts but commands fail | Wrong port / base URL | Check `VITE_API_BASE_URL` and the uvicorn port |
| Frontend cannot reach API | CORS or backend down | Backend allows `*`; check it is running |
| `npm test` worker timeout | CPU contention on the geometry suite | Re-run; config already caps workers at 2 |
| MediaPipe fails to load | `/models` or `/mediapipe` assets missing | Check `frontend/public/` |

---

## 3. Repository map

```text
backend/
  app/
    main.py            routes, CORS, .env
    schemas.py         enums + Pydantic models (the API contract)
    parser.py          deterministic lexicon, negation, context, contradictions
    validation.py      bounds, target/parameter map, verdicts
    llm_parser.py      Gemini adapter
    parser_service.py  cascade + timeout + fallback
    consultation_store.py  SQLite archive (list/get/upsert/delete)
  tests/               test_api.py, test_parser.py, test_parser_service.py,
                       test_consultations.py

frontend/
  src/
    App.tsx            orchestration and all top-level state
    components/        24 presentation components
    hooks/             3 async controllers with version/token guards
    lib/               params registry, formatting, photo rules, archive facade
    services/          API, speech, MediaPipe, fitting, reconstruction, texture,
                       SQLite consultation REST client
    scene/
      geometry/        head, regions, deformation, morphs, textures
      session/         proposals, transcript, scenarios, report
      live/            live event evaluation + exports
      transformations/ command/model-state logic
  tests/               25 Vitest files
  scripts/             head asset build, fixtures, browser check
  public/models/       MediaPipe task + canonical OBJ
  public/mediapipe/    WASM runtime

docs/                  this handbook + historical reports
scripts/               browser-check helper
```

### 3.1 Where to make a change

| Change | Files |
| --- | --- |
| New parser synonym | `backend/app/parser.py` (+ tests) |
| New validation rule | `backend/app/validation.py` (+ tests + Reference) |
| New API field | `backend/app/schemas.py` → `frontend/src/scene/transformations/types.ts` → `makeVoiceCommands` |
| New parameter | `frontend/src/lib/params.ts` → `types.ts` → `deformation.ts` → `ParameterPanel` tests |
| New region | `regions.ts` → `deformation.ts` → `params.ts` (target map/labels) |
| New UI panel | `components/`, wire in `App.tsx`, add a component test |
| New storage field | `backend/app/consultation_store.py` + `schemas.py` + `frontend/src/lib/historyStore.ts` (+ migration) |

---

## 4. Commands

### 4.1 Backend

```powershell
# from backend/
..\.venv\Scripts\python.exe -m unittest discover -s tests
..\.venv\Scripts\python.exe -m unittest tests.test_parser -v

# ad-hoc API check
curl -X POST http://127.0.0.1:8000/api/parse-command `
  -H "Content-Type: application/json" `
  -d "{\"text\":\"raise the tip by 2 mm\"}"
```

### 4.2 Frontend

```powershell
cd frontend
npm run dev            # dev server
npm run build          # tsc + vite build
npm run preview        # serve dist/ on 4173
npm test               # vitest run
npx tsc --noEmit       # type check only
npm run fixtures       # regenerate photo fixtures
npm run browser-check  # manual smoke harness (needs a running server)
```

### 4.3 Browser check

```powershell
cd frontend
npm run build
npm run preview
# in another terminal
node scripts/browser-check.mjs http://127.0.0.1:4173/ tests\fixtures
```

The harness loads the app, drives the main flows with fixture images and reports
console errors. It is a smoke test, not a replacement for the unit suites.

---

## 5. Testing

### 5.1 Frontend inventory

**25 files, 234 tests.** Vitest + jsdom, `maxWorkers: 2`, 30 s test/hook timeouts,
setup in `tests/setup.ts`.

| File | Tests | Focus |
| --- | --- | --- |
| `api.test.ts` | 4 | HTTP client, timeouts, error mapping |
| `App.test.tsx` | 11 | End-to-end consultation flow |
| `ChangeSetReview.test.tsx` | 5 | Confirm/valid/reject behaviour |
| `ConsultationHistoryPanel.test.tsx` | 5 | Archive rendering and actions |
| `consultationApi.test.ts` | 5 | SQLite archive REST client, errors |
| `consultationRepository.test.ts` | 3 | Database-first load, offline fallback, cache reconciliation |
| `ViewerToolbar.test.tsx` | 2 | Heatmap control visibility and toggle state |
| `faceMorph.test.ts` | 11 | Identity coefficients and clamping |
| `faceProfile.test.ts` | 6 | Anthropometric ratios |
| `faceReconstruction.test.ts` | 11 | Single-photo landmark → morph |
| `faceTexture.test.ts` | 10 | Texture sampler |
| `facialFeatures.test.ts` | 6 | Eyes/brows/ears meshes |
| `format.test.ts` | 4 | Status labels, signed display |
| `geometry.test.ts` | 38 | Mesh, regions, deformation, independence |
| `historyStore.test.ts` | 5 | IndexedDB + fallback |
| `live.test.ts` | 17 | Live evaluation rules |
| `LiveSimulationPanel.test.tsx` | 9 | Live UI and log |
| `logic.test.ts` | 11 | Transformations (apply/replay/undo) |
| `multiViewFitting.test.ts` | 6 | Horn/Umeyama, mirror, bundle fit |
| `multiViewPhotoFlow.test.tsx` | 9 | Upload → detect → reconstruct |
| `multiViewReconstruction.test.ts` | 10 | Quality metrics, validation |
| `ParameterPanel.test.tsx` | 8 | Groups, sliders, reset |
| `params.test.ts` | 11 | Registry, bounds, mapping |
| `photo.test.ts` | 4 | File validation |
| `session.test.ts` | 15 | Proposals, events, scenarios, report |
| `sessionComponents.test.tsx` | 7 | Timeline/transcript components |
| `speech.test.ts` | 6 | Web Speech wrapper |
| `useFacePersonalization.test.tsx` | 5 | Async personalisation lifecycle |

Static count of `it(`/`test(` in these files is 234. A live run can report fewer
executed tests if a worker fails to start (for example a Vitest worker-start
timeout on `App.test.tsx`); that is an environment failure, not an assertion
failure. Re-run before investigating.

### 5.2 Backend inventory

Backend suite with `unittest`; no pytest dependency required.

| File | Tests | Focus |
| --- | --- | --- |
| `test_api.py` | 5 | Routes, status codes, CORS |
| `test_parser.py` | 25 | Lexicon, units, negation, context, contradictions |
| `test_parser_service.py` | 6 | Cascade, fallback, qualitative guard, timeout |
| `test_consultations.py` | 7 | SQLite create/list/read/upsert/delete/clear |

Run from `backend/` so the relative imports resolve:

```powershell
cd backend
..\.venv\Scripts\python.exe -m unittest discover -s tests
```

### 5.3 What the suites guarantee

| Guarantee | Where |
| --- | --- |
| Deformation is drift-free and reset-exact | `geometry.test.ts` |
| Regions are independent within documented overlaps | `geometry.test.ts` |
| Out-of-range values are not clamped | `test_parser.py` |
| Negation cannot become a positive action | `test_parser.py`, `test_parser_service.py` |
| LLM failure falls back to rules | `test_parser_service.py` |
| Qualitative phrases acquire no invented number | `test_parser_service.py` |
| Only `ok` instructions apply | `logic.test.ts`, `live.test.ts` |
| Duplicate confirms cannot double-apply | `App.test.tsx` |
| Stale async results are discarded | `App.test.tsx`, `useFacePersonalization.test.tsx` |
| Photos never leave the device | `multiViewPhotoFlow.test.tsx`, `faceTexture.test.ts` |
| Archive persists to SQLite and falls back when it is unavailable | `test_consultations.py`, `consultationApi.test.ts`, `historyStore.test.ts` |

### 5.4 Gaps in test coverage

- No visual regression or screenshot comparison.
- No accessibility assertions beyond basic roles.
- No real MediaPipe/WASM execution in CI; the detector is mocked.
- No browser matrix; jsdom does not exercise WebGL.
- No load/performance test.
- No Python static typing or linting.

---

## 6. Build and release

### 6.1 Production build

```powershell
cd frontend
npm run build
```

Output: `frontend/dist/`. The build also type-checks (`tsc` runs first). Serve the
directory with any static host; no server-side rendering is required.

Set `VITE_API_BASE_URL` at build time if the backend is not on
`http://127.0.0.1:8000`.

### 6.2 Backend deployment

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

For anything other than loopback, add authentication, TLS, restrictive CORS and
request-size limits first. The defaults are deliberately permissive for local use.

### 6.3 Assets

| Asset | Location | Licence |
| --- | --- | --- |
| Face Landmarker task | `frontend/public/models/face_landmarker.task` | Apache-2.0 (MediaPipe) |
| Canonical face model | `frontend/public/models/canonical_face_model.obj` | Apache-2.0 (MediaPipe) |
| MediaPipe WASM | `frontend/public/mediapipe/` | Apache-2.0 |
| Realistic head | `headAssetData.generated.ts` | **Unverified** — supplied by the project owner |
| Sculpted head | generated in code | Project code |

Regenerate the head buffers with:

```powershell
cd frontend
node scripts/build-head-asset.mjs path\to\head.obj
```

Before redistributing the bundled head, verify its licence. This is an open item,
not an assumption.

---

## 7. Architecture orientation for contributors

If you only remember five things:

1. **`App.tsx` owns state.** Panels are controlled; they do not fetch or mutate
   shared state.
2. **`history: Command[]` is the source of truth.** `modelState` is derived by
   replaying it over all zeros. Undo, scenarios and archive restore all depend on
   commands remaining replayable.
3. **The backend validates; it does not simulate.** All geometric meaning lives in
   the frontend.
4. **Every instruction has a status.** Do not apply anything that is not `ok`, and
   never clamp an out-of-range value silently.
5. **Async work needs a guard.** Tokens/versions are how stale results are
   discarded; adding an async path without one will resurrect deleted state.

### 7.1 The two contracts

```text
Backend Instruction  ──makeVoiceCommands──▶  frontend Command
  target/parameter/operation/value/unit       + id, source, paramKey, createdAt
  status/reason/adjusted_value                status preserved for display
```

`paramKeyFor(target, parameter)` is the join. It is the most fragile part of the
system; see [§10](#10-known-gaps-and-technical-debt).

### 7.2 State flow

```text
ParseResponse
  → makeVoiceCommands
  → proposal (consultation) or evaluateLiveInstruction (live)
  → Command[]
  → applyAllCommands(history)
  → ModelState
  → deformPositions(base, state, frame)
  → BufferGeometry → FaceViewer
```

---

## 8. Extension recipes

### 8.1 Add a parameter end to end

This is the full path. Skipping a step produces exactly the class of bug listed in
[§10](#10-known-gaps-and-technical-debt).

1. **Type** — add the key to `ModelState`, `ParamKey` and (if adjustable)
   `SIMULATED_PARAM_KEYS` in `frontend/src/scene/transformations/types.ts`. Add it
   to `initialModelState` with `0`.
2. **Registry** — add a `ParamDescriptor` in `frontend/src/lib/params.ts`:
   `key`, `label`, `shortLabel`, `group`, `target`, `parameter`, `unit`, `min`,
   `max`, `step`, `default`, `supported`, `manual`, `hint`.
3. **Geometry** — consume the state field in `deformPositions`
   (`frontend/src/scene/geometry/deformation.ts`). Add a region weight in
   `regions.ts` if the influence is new. Convert lengths with `mmToScene` and
   angles with `degreesToRadians`; never invent another scale.
4. **Backend mapping** — if voice can address it, ensure the target and parameter
   are in `TARGET_PARAMETER_MAP` (`backend/app/validation.py`) and that
   `paramKeyFor` resolves them. If it is manual-only, mark `manual: true` and
   document that voice cannot reach it.
5. **Command application** — confirm `applyCommand` handles the key. Manual
   commands are absolute; voice commands are signed deltas.
6. **UI** — the panel picks up the descriptor automatically if `manual` and in
   `SIMULATED_PARAM_KEYS`. Check the group is one of the five existing regions or
   add a new group.
7. **Tests** — add a geometry assertion (the field moves the expected vertices and
   only those), a params assertion (bounds/mapping), and a command/replay
   assertion.
8. **Docs** — update [Reference §5](REFERENCE.md#5-parameter-catalogue) and the
   implementation-status table. If it is wired, remove it from the "registered but
   not wired" list.

**Pitfall:** two descriptors for the same `(target, parameter)` are ambiguous.
`paramKeyFor` returns the first match, so the second parameter's slider will write
the first field. Give each new parameter a unique pair, or change `paramKeyFor` to
key on the parameter registry rather than the pair.

### 8.2 Add a region

1. Add the enum value in `backend/app/schemas.py` and the label/synonyms in
   `backend/app/parser.py`.
2. Add it to `TARGET_PARAMETER_MAP` in `validation.py` with its allowed
   parameters.
3. Add a `TargetRegion` union member and `REGION_OPTIONS` entry in
   `frontend/src/lib/params.ts`.
4. Add weights and a `FaceRegionFrame` block in `regions.ts`, plus the
   displacement in `deformation.ts`.
5. Add landmarks if the region should be inspectable
   (`frontend/src/scene/geometry/landmarks.ts`).
6. Extend both region frames (`DEFAULT_REGION_FRAME` and `HEAD_REGION_FRAME`),
   not just one.
7. Add geometry independence tests and a parser synonym test.

### 8.3 Add a deformation operation

1. Decide whether it is a translation, a weighted rotation or a radial scale.
2. Compute the weight from **baseline** coordinates only.
3. Apply it inside the vertex loop in `deformPositions`; do not mutate `base`.
4. Keep the region's block independent so other regions cannot move.
5. Update the heatmap automatically (it is derived from displacement).
6. Add a test that isolates the region and checks neighbouring vertices.

### 8.4 Add parser vocabulary

1. Add the synonym to the appropriate table in `backend/app/parser.py`. Multi-word
   entries must be matched longest-first, which the existing matcher does.
2. If it is an operation word, map it to `increase`/`decrease`/`narrow`/`widen`/
   `rotate`/`raise`/`lower`.
3. If it is a unit, add it to the unit table and to `validation.py` normalisation.
4. Add a positive test, a negation test and a context test.
5. Do **not** teach the parser a clinical judgement ("better", "natural"). Those
   are qualitative and must stay `needs_clarification`.

### 8.5 Add an API field

1. Add it to `Instruction` in `backend/app/schemas.py` with a default.
2. Populate it in `build_instruction`.
3. Mirror it in `frontend/src/scene/transformations/types.ts` and map it in
   `makeVoiceCommands`.
4. Decide whether it is display-only or affects application. If it affects
   application, update `isApplicable`/`applicableInstructions`.
5. Update [Reference §3](REFERENCE.md#3-schemas) and add tests on both sides.

### 8.6 Change a bound

1. Change `LENGTH_LIMIT_MM` or `ANGLE_LIMIT_DEG` in `validation.py` (backend) and
   the descriptor `min`/`max` in `params.ts` (frontend). They are separate and must
   agree.
2. Update the validation matrix in [Reference §4](REFERENCE.md#4-validation-rules).
3. Add a boundary test exactly at the limit and one just beyond it.

---

## 9. Conventions and invariants

### 9.1 Code style

- **British spelling** in prose and comments (`colour`, `behaviour`), matching the
  existing code.
- **ASCII diagrams** in docs and comments; no Unicode box drawing in source.
- **Pure logic separate from effects.** If it can be a function over typed arrays
  or plain objects, put it in `logic.ts`/`geometry/` and test it without a DOM.
- **Typed arrays** for per-vertex data; avoid allocating inside the vertex loop.
- **No new global state.** `App.tsx` is the only owner.
- **No silent fallbacks that change meaning.** A fallback may preserve
  availability; it may not turn an invalid request into a valid one.

### 9.2 Safety invariants

| Invariant | Consequence if broken |
| --- | --- |
| Only `status === "ok"` applies | Unvalidated or out-of-range change reaches the patient view |
| Out-of-range is never clamped | Clinician's stated intent is silently altered |
| Sign comes from `operation`, not `value` | Double negation and direction bugs |
| Qualitative requests get no invented number | Fabricated clinical magnitude |
| Photos never uploaded | Privacy breach |
| LLM output passes `build_instruction` | Prompt injection into geometry |
| `base` is immutable | Drift, non-reproducible reset, broken undo |

### 9.3 Geometry invariants

See [Geometry §1.3](GEOMETRY_AND_RECONSTRUCTION.md#13-invariants). In short:
immutable baseline, state-not-deltas, baseline-evaluated weights, one length
pathway.

### 9.4 Naming

| Concept | Name |
| --- | --- |
| Backend instruction | `Instruction` |
| Frontend applied change | `Command` |
| Full parameter values | `ModelState` |
| Single parameter | `ParamKey` |
| Pending voice result | `Proposal` |
| Saved snapshot | `Scenario` |
| Archived consultation | `ArchivedConsultation` |
| Live log row | `LiveEvent` |

Do not use "command" for a backend `Instruction` or "instruction" for a frontend
`Command`; the distinction is what keeps the contracts clear.

---

## 10. Known gaps and technical debt

This is the honest list as of 2026-10-25. Each item is a real behaviour, not a
suspicion.

### 10.1 Parameter aliasing (highest impact)

The registry has **32** entries, but the backend schema has only six parameters.
`paramKeyFor(target, parameter)` resolves a command by pair, so multiple registry
entries share a pair. As a result, **11 added clinical parameters alias onto core
fields**:

| Added parameter | Currently writes |
| --- | --- |
| `radixHeight` | `bridgeHeight` |
| `nasofrontalAngle` | `cheekProjection` |
| `nasolabialAngle` | `cheekProjection` |
| `columellarShow` | `cheekProjection` |
| `columellarLobularAngle` | `cheekProjection` |
| `supratipBreak` | `tipHeight` |
| `tipDefinition` | `tipHeight` |
| `alarFlare` | `alarWidth` |
| `alarBaseWidth` | `alarWidth` |
| `dorsalHumpReduction` | no independent geometry (registered) |
| `nasalLength` | no independent geometry (registered) |

Effects: the added slider writes the core field and its own field stays 0, so the
slider snaps back; scenarios and archive restore can disagree with what was shown.
`paramKeyFor` also contains unreachable duplicate branches (around lines
901–928) and an early `tipDefinition` branch (around line 854) that returns
`tipHeight` before the intended branch.

**Fix direction:** make the resolution key unique (for example pass the
`ParamKey` through the command rather than re-deriving it from the pair), then
give each parameter a distinct backend parameter or mark it manual-only.

### 10.2 Registered but not geometry-wired

`deformPositions` reads **17** fields. The other 11 manual parameters are visible
but inert:

`dorsalHumpReduction`, `radixHeight`, `nasofrontalAngle`, `nasolabialAngle`,
`columellarShow`, `columellarLobularAngle`, `supratipBreak`, `tipDefinition`,
`alarFlare`, `alarBaseWidth`, `nasalLength`.

Four more are explicitly `supported: false`: `nostrilShape`, `nostrilSymmetry`,
`dorsalSeptalDeviation`, `leftRightAsymmetry`.

### 10.3 Descriptor defaults vs zero state

Several added descriptors declare non-zero `default` values
(`nasofrontalAngle` 130, `nasolabialAngle` 95, `columellarShow` 3,
`columellarLobularAngle` 45, `nasalLength` 50) while `initialModelState` is all
zeros and the panel never applies defaults. `nasalLength` even has `min: 30` with
an initial value of 0, which is outside its own range. Either defaults should be
applied at session start or the descriptors should default to 0; today the UI can
show a value that the model does not hold.

### 10.4 Backend regions absent from the target map

`TARGET_PARAMETER_MAP` covers nine regions. `nasal_base`, `columella`,
`septal_region`, `left_side` and `right_side` exist in the enum and in LLM
synonyms but are absent from the map, so every instruction naming them returns
`unsupported`. Either add them or remove them from the vocabulary so the model
does not suggest a capability the validator refuses.

### 10.5 Tooling

| Gap | Impact |
| --- | --- |
| No CI | Regressions are found manually. |
| No linter/formatter | Style drift; unused code survives beyond `tsc`. |
| No Python version pin | "Works on my machine" setups. |
| `tsconfig.include` is `["src"]` | Tests are not type-checked by `tsc --noEmit`. |
| `strict` not enabled | Nullability and implicit-any risk. |
| `requirements.txt` incomplete | Missing `google-genai`, `python-dotenv`. |
| No `pyproject.toml`/lock | Backend installs are not reproducible. |

### 10.6 UI and accessibility

- The workspace chip says **"Procedural prototype mesh"** even when the default
  realistic head is shown; only the reconstructed case is labelled correctly.
- The photo manager and reconstruction overlay lack `role="dialog"`,
  `aria-modal` and a focus trap. `ConfirmDialog` is implemented correctly and can
  serve as the pattern.
- `SIMULATED_PARAM_KEYS` has 32 entries while the panel shows 28; the discrepancy
  is intentional (`manual` filter) but easy to misread.
- Quality card bands are 80/60/40, while the reconstruction warning threshold is
  0.5; a score of 45 % is "Fair" visually but still below the warning threshold.

### 10.7 Documentation and assets

- The bundled realistic head's licence is unverified. Check before redistribution.
- `patientSkinTexture.ts` documents a 1024×512 default; the sampler defaults to
  1024×1024.
- Root `README.md` still describes 17 parameters and a procedural head; the
  handbook supersedes it.
- Several phase reports describe earlier behaviour (for example the duplicate nose
  bulge fix) that no longer matches the current geometry.

### 10.8 Uncommitted working-tree state

At the time of writing, the tree contains modified
`backend/app/{llm_parser,parser,schemas}.py`,
`frontend/src/lib/params.ts`, `frontend/src/scene/transformations/types.ts` and
`frontend/tests/params.test.ts`, plus untracked documents in `docs/`. Treat the
parameter extension as in progress: the docs describe what the code does now, not
what the extension intends to do.

---

## 11. Release and demo checklist

### 11.1 Before a demo

- [ ] Backend running and `/health` returns `{"status":"ok"}`.
- [ ] Header shows **Parsing service: online**.
- [ ] `GEMINI_API_KEY` present (or accept rules-only parsing).
- [ ] Chrome/Edge microphone permission granted.
- [ ] `npm test` and backend `unittest` pass, or the known environment failure is
      understood.
- [ ] `npm run build` succeeds.
- [ ] Fixture photos available if demonstrating reconstruction.
- [ ] A known-good command list rehearsed.
- [ ] Archive cleared of any previous patient data.
- [ ] Screen locked / notifications off.

### 11.2 Before a release

- [ ] Full test suites green.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` clean and `dist/` smoke-tested.
- [ ] Browser check against `npm run preview`.
- [ ] No secrets in the diff (`git diff --cached`).
- [ ] `docs/` updated for any behaviour change (see the maintenance map in
      [`README.md`](README.md#maintaining-this-documentation)).
- [ ] Head asset licence resolved.
- [ ] Privacy statement still accurate: no photo upload, no server storage.
- [ ] Limitations in [User guide §10](USER_GUIDE.md#10-limitations) still true.

### 11.3 After a schema change

- [ ] Backend and frontend tests updated on both sides.
- [ ] [Reference §3–4](REFERENCE.md#3-schemas) updated.
- [ ] Any archived record migration considered. The current store has version 1
      and no migration path; adding fields is safe, renaming is not.

---

## 12. Documentation maintenance

The `docs/` set is part of the codebase. When you change behaviour, update the
mapped document in the same change set. The map is in
[`docs/README.md`](README.md#maintaining-this-documentation). Quick rules:

| Change | Update |
| --- | --- |
| API/schema/status | Reference + Architecture |
| Parser/validation/safety | Architecture §6 + Reference §4 |
| Parameter/bounds/mapping | Reference §5 + this guide §8 |
| Geometry/reconstruction | Geometry and reconstruction |
| UI/workflow/labels | User guide + Architecture §7 |
| Tests/scripts/tooling | This guide §5 |
| New limitation | This guide §10 + User guide §10 |

Keep the status vocabulary consistent: **core**, **registered**, **unsupported**.
If a parameter becomes geometry-wired, move it from "registered" to "core" in
[Reference §5.1](REFERENCE.md#51-implementation-status) and in
[§10.2](#102-registered-but-not-geometry-wired) here.
