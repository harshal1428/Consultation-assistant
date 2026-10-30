# VoiceSurg 3D — System Architecture

> **Prototype for simulation and educational purposes only.** VoiceSurg 3D is not a
> medical device, not a diagnostic tool and not a surgical planning system.
> See [§10](#10-data-privacy-and-security) and
> [`../README.md#known-limitations`](../README.md#known-limitations).

This document describes how VoiceSurg 3D is put together: what runs where, which
module owns which responsibility, how a spoken sentence becomes a changed vertex
on a 3D head, and which trade-offs were made deliberately. It is written against
the working tree of 2026-10-25 (last commit `ad4be75` plus the in-progress
clinical-parameter extension). Where older phase reports disagree with the code,
this document follows the code.

Related documents:

- [Geometry and reconstruction](GEOMETRY_AND_RECONSTRUCTION.md) — the mathematics.
- [User guide](USER_GUIDE.md) — the product surface.
- [Developer guide](DEVELOPER_GUIDE.md) — how to change and test it.
- [Reference](REFERENCE.md) — exact fields, enums, bounds and parameter tables.

---

## 1. System context

VoiceSurg 3D is a **local-first, two-process web application**. A clinician speaks
or types a surgical instruction ("raise the nasal tip by 2 millimetres"); the system
converts it into a validated numeric change, applies it to a parametric 3D head,
and lets the clinician review, compare and archive the result.

```text
                    ┌────────────────────────────────────────────┐
                    │              Clinician browser             │
                    │                                            │
  microphone ──────▶│  Web Speech API ──▶ React UI ──▶ Three.js  │
  keyboard   ──────▶│                        │           │       │
  photo files ─────▶│                        │           ▼       │
                    │                        │      head mesh    │
                    │                        │      + textures   │
                    │                        ▼                   │
                    │                 local HTTP call            │
                    └────────────────────┬───────────────────────┘
                                         │ POST /api/parse-command
                                         ▼
                    ┌────────────────────────────────────────────┐
                    │        FastAPI backend (127.0.0.1:8000)    │
                    │  deterministic parser → optional LLM →     │
                    │  canonical schema → validation verdicts    │
                    └────────────────────┬───────────────────────┘
                                         │ only when rules are inconclusive
                                         ▼
                    ┌────────────────────────────────────────────┐
                    │        Google Gemini (gemini-2.5-flash)    │
                    │        receives command text only          │
                    └────────────────────────────────────────────┘
```

Four properties follow from this shape and recur throughout the document:

1. **The browser is the system of record for the simulation.** Geometry, history,
   scenarios, archives and photographs all live in the tab (or its IndexedDB).
   The backend is stateless.
2. **The backend is a language-to-schema service, not a simulation service.** It
   never sees the mesh, the parameter values or the patient photographs.
3. **The LLM is optional and fenced.** A deterministic parser handles the common
   vocabulary; the LLM is consulted only when the rules produce nothing usable,
   and its output must pass the same validation as the rules path.
4. **Every instruction carries an explicit status.** The frontend never infers
   whether a change is safe; it reads `status`, `reason` and `adjusted_value`.

### 1.1 Actors

| Actor | Interacts with | Goal |
| --- | --- | --- |
| Clinician / demonstrator | Browser UI, microphone, keyboard, photo files | Explore a proposed change and explain it to a patient |
| Patient (observer) | Screen only | Understand the proposed change |
| Developer / researcher | Repository, test suites, browser harness | Extend, verify, document |
| Gemini API | Backend HTTP client | Interpret free-form language when rules fail |

### 1.2 Scope boundaries

In scope: single-user simulation, command interpretation, parametric deformation,
multi-photo reconstruction, on-device archive, scenario comparison, report export.

Out of scope (and not merely unimplemented): multi-user collaboration, server-side
patient records, authentication, clinical measurement calibration, surgical
planning, implant selection, outcome prediction, regulatory submission.

---

## 2. Runtime topology

### 2.1 Processes and ports

| Process | Default address | Started by | Lifetime |
| --- | --- | --- | --- |
| FastAPI backend | `http://127.0.0.1:8000` | `uvicorn backend.app.main:app` | Developer-managed |
| Vite dev server | `http://localhost:5173` | `npm run dev` in `frontend/` | Developer-managed |
| Static preview | `http://127.0.0.1:4173` | `npm run preview` (after `npm run build`) | Developer-managed |
| Browser tab | n/a | User | Per session |

The frontend talks to the backend through `VITE_API_BASE_URL` (default
`http://127.0.0.1:8000`), resolved once in `frontend/src/services/api.ts`.
There is no server-side rendering, no API gateway and no database.

### 2.2 Build and serve pipeline

```text
frontend/src/**  ──tsc -b──▶  type-check
        │
        ├──vite build──▶ frontend/dist/  ──▶ any static host / npm run preview
        │
        └──vitest──▶ jsdom unit/component tests

backend/app/**  ──uvicorn──▶ ASGI app (no build step)
```

The frontend build is fully static; the only runtime dependency on the network is
the `POST /api/parse-command` call. The default realistic head mesh is compiled
into the bundle as a generated TypeScript module, so there is no asset fetch at
startup.

### 2.3 Trust boundaries

```text
┌─ Browser (trusted for this prototype) ──────────────────────────┐
│  speech recognition · photos · mesh · IndexedDB cache · API     │
└───────────────┬─────────────────────────────────────────────────┘
                │  HTTP/JSON: command text, context, consultation snapshots
┌───────────────▼─────────────────────────────────────────────────┐
│  Backend                                                        │
│  Pydantic enums · rules · optional LLM call · validation        │
│  Local SQLite consultation archive (no photos)                  │
└───────────────┬─────────────────────────────────────────────────┘
                │  command text only (no identifiers, no images)
┌───────────────▼─────────────────────────────────────────────────┐
│  Gemini API (third party)                                       │
└─────────────────────────────────────────────────────────────────┘
```

The backend applies **no authentication** and CORS is `allow_origins=["*"]`. That is
acceptable only because it binds to loopback in the intended workflow and holds no
patient data. See [§10](#10-data-privacy-and-security) for the deployment rule this
implies.

---

## 3. Repository and component map

```text
.
├── backend/
│   ├── app/
│   │   ├── main.py             FastAPI app, routes, CORS, .env loading
│   │   ├── schemas.py          Pydantic contract: enums + Instruction/ParseResponse
│   │   ├── parser.py           deterministic lexicon, negation, context, contradictions
│   │   ├── validation.py       bounds, target↔parameter matrix, status verdicts
│   │   ├── llm_parser.py       Gemini adapter (JSON mode, timeouts, parsing)
│   │   └── parser_service.py   orchestration: rules → LLM → fallback → validate
│   └── tests/                  test_api.py, test_parser.py, test_parser_service.py
├── frontend/
│   ├── src/
│   │   ├── App.tsx             top-level state, flows, guards, archive wiring
│   │   ├── components/         presentation and panels (24 components)
│   │   ├── hooks/              useLiveSimulation, useFacePersonalization, useMultiViewPhotos
│   │   ├── lib/                params registry, photo validation, storage, formatting
│   │   ├── scene/
│   │   │   ├── geometry/       head mesh, regions, deformation, morphs, textures
│   │   │   ├── session/        proposals, transcript, scenarios, report model
│   │   │   ├── live/           live-event evaluation rules
│   │   │   └── transformations/ command ↔ model-state logic
│   │   └── services/           HTTP API, speech, MediaPipe, multi-view fitting, textures
│   ├── scripts/                build-head-asset.mjs, fixtures, browser-check
│   └── tests/                  25 Vitest files
├── docs/                       this handbook + historical reports
├── scripts/                    browser-check helper
└── requirements.txt            backend Python dependencies (partial; see Developer guide)
```

### 3.1 Backend components

| Module | Owns | Must not own |
| --- | --- | --- |
| `main.py` | HTTP surface, status codes, CORS, `.env` loading | Parsing logic, validation rules |
| `schemas.py` | The only cross-boundary representation; enums; field constraints | Business rules |
| `parser.py` | Lexicon, number/unit extraction, negation, context resolution, contradiction flags | Calling the network |
| `validation.py` | Canonical bounds, target↔parameter support, status verdicts, unit normalisation | Language understanding |
| `llm_parser.py` | Prompting Gemini, JSON coercion, timeout handling | Deciding whether a value is clinically acceptable |
| `parser_service.py` | Ordering, fallback, budget, deduplication, final response assembly | HTTP concerns |

The dependency direction is strictly inward: `main → parser_service → {parser,
llm_parser} → validation → schemas`. `validation.py` imports `schemas.py`; nothing
imports `main.py`.

### 3.2 Frontend components

| Layer | Modules | Responsibility |
| --- | --- | --- |
| Shell | `App.tsx`, `main.tsx`, `App.css`, `index.css` | State ownership, mode switching, dialogs, notices, CSS tokens |
| Panels | `SimulationWorkspace`, `ConsultationPanel`, `LiveSimulationPanel`, `ParameterPanel`, `ScenarioPanel`, `MultiViewPhotoManager`, `ReconstructionPanel` | Feature surfaces |
| Review | `InstructionCard`, `ChangeSetReview`, `ChangeHistory`, `SessionTimeline`, `TranscriptLog`, `TranscriptView`, `StatusMessage`, `ConfirmDialog` | Proposal review and audit trail |
| Viewer | `FaceViewer`, `FaceDeformationViewer`, `ViewerToolbar`, `ReconstructionPreview3D` | Three.js scene, orbit controls, heatmap, overlays |
| Domain logic | `scene/transformations`, `scene/session`, `scene/live` | Pure, testable state transitions |
| Geometry | `scene/geometry/*` | Mesh construction, region weights, deformation, morphs, textures |
| Services | `services/*` | HTTP, speech, MediaPipe, reconstruction, texture projection |
| Hooks | `hooks/*` | Async lifecycles with cancellation/version tokens |
| Storage | `lib/consultationRepository.ts`, `lib/historyStore.ts`, `services/consultationApi.ts` | SQLite archive first, IndexedDB cache/fallback, REST client |

`App.tsx` is deliberately the only component that owns simulation state. Panels
receive values and callbacks; they do not reach into each other. This keeps the
data flow auditable and makes the pure modules independently testable.

### 3.3 What is pure and what is effectful

| Pure (unit-tested without DOM) | Effectful |
| --- | --- |
| `parser.py`, `validation.py`, `llm_parser.parse_payload` | `llm_parser.request_llm`, `main.py` routes |
| `transformations/logic.ts`, `session/logic.ts`, `live/logic.ts` | `App.tsx` request orchestration |
| `geometry/*` (except texture canvas creation) | `FaceViewer` WebGL, `speech.ts`, `faceLandmarker.ts` |
| `lib/params.ts`, `lib/format.ts`, `lib/multiViewPhoto.ts` validation | `historyStore.ts` (IndexedDB), `consultationApi.ts` (SQLite REST) |
| `multiViewFitting.ts` (linear algebra) | `multiViewReconstruction.ts` (canvas, MediaPipe) |

---

## 4. End-to-end flows

### 4.1 Consultation: voice or typed instruction → reviewed change

```text
Clinician speaks / types
        │
        ▼
speech.ts (Web Speech API, final transcript only)   [voice]
        │
        ▼
App.parseText(text, source)
        ├─ guard: session must be active
        ├─ supersede any open proposal (mark "cancelled")
        ├─ create transcript entry + proposal
        ├─ context = last 4 applied commands
        │
        ▼
POST /api/parse-command { text, context }
        │
        ▼
parser_service.parse_command
        ├─ deterministic parser
        ├─ hard negative?  ──yes──▶ return immediately
        ├─ LLM (≤12 s) ──fail──▶ deterministic fallback
        ├─ qualitative guard, contradictions
        └─ validate every instruction
        │
        ▼
{ instructions[], text }
        │
        ▼
makeVoiceCommands → InstructionCard list
        │
        ├─ clinician edits a value (handlePatch)
        ├─ clinician confirms all / valid only (handleConfirm)
        └─ clinician rejects (handleRejectAll)
        │
        ▼
history: Command[]  ──applyAllCommands──▶  ModelState
        │
        ▼
deformPositions(basePositions, state) ──▶ new BufferGeometry
```

Important invariants:

- A **new utterance cancels** the previous un-reviewed proposal; it never silently
  replaces it.
- Only instructions with `status === "ok"` are applicable. `needs_clarification`,
  `unsupported`, `invalid` and `no_change` are shown with their reason but cannot
  be applied.
- An LLM instruction that carries `adjusted_value` (out-of-range request) is also
  treated as not directly applicable in live mode; in consultation the clinician
  can edit the value before confirming.
- `appliedRef` prevents the same proposal being applied twice by a double click.
- In-flight responses are discarded when the session id or request token changes
  (`reqRef`, `seqRef`).

### 4.2 Live simulation: utterance → auto-apply → log

Live mode is the same parser and the same `Command[]` model, but without the review
step:

```text
live microphone ──▶ useLiveSimulation ──▶ runLiveInstruction(text)
                                              │
                                              ▼
                                        parse-command
                                              │
                            for each instruction:
                            evaluateLiveInstruction(instruction, state)
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     │ applied                                         │ not_applied
                     ▼                                                 ▼
              append Command to history                       record reason
              recompute state                                  (status, no mutation)
                     │
                     ▼
              liveEvents[] + session event "live_command"
```

`evaluateLiveInstruction` applies only when **all** of the following hold:

1. `status === "ok"`;
2. there is no `adjusted_value` (the clinician's exact request is in range);
3. `paramKeyFor(target, parameter)` resolves to a real parameter key;
4. the resulting value differs from the current value (a non-zero delta).

Failures are not errors: they become `not_applied` log rows with a human-readable
reason. A network failure also becomes a log row rather than a panel-level error, so
the live session is never interrupted by a banner.

Leaving live mode stops the microphone but does **not** end the consultation or
discard history. Both modes share one `history` and one `modelState`, so a clinician
can move between exploratory live changes and a reviewed consultation.

### 4.3 Photo personalization (single photo)

```text
file picker ──▶ validatePhotoFile (type, ≤12 MB)
            ──▶ decode in tab (object URL + canvas) ──▶ ≤768 px working copy
            ──▶ detectFaceLandmarks (MediaPipe Face Landmarker, 478 points)
            ──▶ faceReconstruction.estimateFaceMorph(landmarks)
            ──▶ FaceMorph (bounded identity coefficients)
            ──▶ personalizedHead / personalizedHeadBuilder
            ──▶ new head geometry (+ optional skin texture)
```

If detection fails, the pipeline retries at increased contrast (1.0 → 1.6 → 2.2)
with auto-levels and upscaling; if it still fails, the photo is rejected with a
specific message. The photo never leaves the tab.

### 4.4 Multi-view reconstruction

```text
3 required views (front, left profile, right profile)
+ 0–3 optional views
        │
        ▼
per-view validation + landmark detection (≥100 landmarks)
        │
        ▼
validateMultiViewSet (required views, pose sanity, duplicates)
        │
        ▼
multiViewReconstruction
        ├─ canonical face model (468 vertices, 898 triangles, cm, +Z anterior)
        ├─ per-view similarity transform (Horn/Umeyama)
        ├─ mirror heuristic
        ├─ bundle fit: data term + Laplacian smoothness + identity prior
        └─ shape transfer onto the render head via 12 anchors
        │
        ▼
preview (ReconstructionPreview3D) ──▶ Apply / Cancel
        │
        ▼
personalizedModel + projection texture (default 1024×1024)
```

Reconstruction is deliberately **preview-then-apply**: nothing changes the working
head until the clinician accepts the preview. The `version` token from
`useMultiViewPhotos` invalidates in-flight work if photos change.

### 4.5 Scenarios, comparison and report

A scenario is a named snapshot of `ModelState` (plus the commands that produced it).
Saving, loading, renaming and deleting are local operations. Loading a scenario
rewrites history to the scenario's command list, so the model state is always
reconstructible from `initialModelState`. Report export serialises the session
summary (transcript, applied changes, scenarios, quality notes) to a downloadable
file; it is generated in the browser.

### 4.6 Archive

The primary archive is a local SQLite database written by the FastAPI process
(`backend/app/consultation_store.py`, default file
`backend/app/data/voicesurg.db`). The REST endpoints are list/read/upsert/delete.
The frontend facade (`lib/consultationRepository.ts`) is database-first and:

1. mirrors database records into IndexedDB (`voicesurg-history`, version 1) as
   an offline cache,
2. migrates older browser-only records to SQLite when the backend is reachable,
3. falls back to the IndexedDB/in-memory store when the backend is offline.

`App.tsx` writes on explicit archive, on end, before a new consultation, and on a
1.2-second debounced snapshot while working. Restoring a record rehydrates the
model state plus transcript, proposals, events and scenarios; photographs are
never archived. See [CONSULTATION_HISTORY_STORAGE.md](CONSULTATION_HISTORY_STORAGE.md).

---

## 5. Data contracts

### 5.1 The instruction contract

The single most important interface in the system is `Instruction`
(`backend/app/schemas.py`), mirrored in TypeScript by `Command`
(`frontend/src/scene/transformations/types.ts`).

| Field | Type | Meaning |
| --- | --- | --- |
| `target` | enum or null | Anatomical region |
| `parameter` | enum or null | `height`, `width`, `projection`, `rotation`, `fullness`, `definition` |
| `operation` | enum or null | `increase`, `decrease`, `rotate`, `narrow`, `widen`, `raise`, `lower` |
| `value` | float or null | Non-negative canonical magnitude |
| `requested_value` | float or null | What the user actually said |
| `requested_unit` | enum or null | `mm`, `cm`, `degrees` |
| `unit` | enum or null | Canonical unit after normalisation |
| `direction` | string or null | Rotation direction (`left`, `right`, `up`, `down`, …) |
| `adjusted_value` | float or null | In-range suggestion; **never applied silently** |
| `confidence` | 0.0–1.0 | Parser confidence |
| `requires_confirmation` | bool | Always true for voice |
| `status` | enum | `ok`, `needs_clarification`, `unsupported`, `invalid`, `no_change` |
| `reason` | string or null | Human-readable explanation of a non-`ok` status |
| `original_text` | string | Source phrase |
| `parser` | enum | `rules` or `llm` |

Two design choices are worth calling out:

- **Sign lives in `operation`, not `value`.** `value` is always non-negative. A
  negative number in a sentence is normalised into `decrease` where the parser can
  do so safely, and rejected otherwise. This prevents double-negation bugs.
- **Corrections are suggestions.** `adjusted_value` exists so the UI can offer a
  safe alternative without the backend clamping a clinical request behind the
  user's back.

### 5.2 The command and model-state contract

```ts
interface Command {
  id: string;
  target: TargetRegion;
  parameter: Parameter | null;
  operation: Operation | null;
  value: number;
  unit: Unit;
  source: "voice" | "manual";
  paramKey: ParamKey;
  ...
}

type ModelState = Record<ParamKey, number>;
```

`applyCommand(state, command)` is the only writer. For a `manual` command the value
is **absolute** (the slider position); for a voice command the delta is applied in
the direction implied by `operation`. `applyAllCommands(history)` folds the entire
history over `initialModelState` (all zeros). Consequences:

- The model state is a pure function of history; there is no hidden mutation.
- Undo is `history.slice(0, -1)` and replay.
- Restoring a scenario or archive must preserve the exact command list, not just the
  final numbers, or a replay can diverge.

The `paramKey` is resolved with `paramKeyFor(target, parameter)`. This is the seam
where the 32-entry parameter registry meets the 6-value schema enum, and it is
currently the weakest link in the contract — see
[Developer guide §10](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt).

### 5.3 HTTP contract

| Route | Method | Request | Success | Failure |
| --- | --- | --- | --- | --- |
| `/health` | GET | — | `200 {"status":"ok"}` | — |
| `/api/health` | GET | — | `200 {"status":"ok"}` | — |
| `/api/parse-command` | POST | `{text, context?}` | `200 {instructions[], text}` | `400` empty text, `422` no instructions |
| `/api/consultations` | GET | — | `200 [ConsultationRecord]` | — |
| `/api/consultations/{id}` | GET | — | `200 ConsultationRecord` | `404` unknown |
| `/api/consultations` | POST | `ConsultationRecord` | `201 ConsultationRecord` | `422` invalid body |
| `/api/consultations/{id}` | DELETE | — | `204` | `404` unknown |
| `/api/consultations` | DELETE | — | `204` (clear all) | — |

The full field-by-field contract, including every enum value and validation rule,
is in [Reference §2–4](REFERENCE.md#2-http-api).

### 5.4 Storage contracts

| Store | Key | Value | Lifetime |
| --- | --- | --- | --- |
| React state (`App`) | n/a | session, history, scenarios, notices, mode | Tab |
| SQLite `backend/app/data/voicesurg.db` | consultation id | archived consultation record | Until cleared |
| IndexedDB `voicesurg-history` v1 | consultation id | offline cache/mirror of the archive | Until cleared |
| In-memory fallback | consultation id | same shape | Tab |
| `localStorage` | n/a | not used | n/a |

Photographs, landmarks, reconstructed meshes and textures are **memory-only** and
never persisted, by design.

---

## 6. Backend design

### 6.1 Request lifecycle

`POST /api/parse-command` performs, in order:

1. Strip `request.text`. Empty → `400 "Command text cannot be empty"`.
2. Truncate `context` to the last **4** items. Context is used only for follow-up
   resolution ("make it two millimetres more") and is never persisted.
3. Run `parse_command(text, context)`.
4. If the result has no instructions → `422 "Could not extract any instruction from
   the command"`.
5. Serialise the validated `ParseResponse`.

There is no authentication, no rate limiting and no request logging of command text
beyond standard uvicorn access logs. The service is stateless: two identical
requests produce identical responses (modulo LLM nondeterminism).

### 6.2 The rules-first strategy

`parser_service.parse_command` implements a deterministic-first cascade:

```text
text
 │
 ├─ parser.parse(text, context)
 │     ├─ lexicon match, numbers, units, negation, context
 │     └─ hard negative?  (negation | unsupported | no_change)
 │            └── yes ──▶ return rules result immediately
 │
 ├─ no usable rules instruction?
 │     └── LLM path (gemini-2.5-flash, ≤12 s, JSON mode)
 │            ├─ LlmError / malformed / empty / all-invalid ──▶ rules fallback
 │            └─ validate each instruction with the same build_instruction
 │
 ├─ qualitative guard (strip invented magnitudes)
 ├─ flag_contradictions (rules + LLM alike)
 └─ ParseResponse
```

Why rules first:

- **Latency and availability.** The common commands ("raise the tip 2 mm") are
  answered in microseconds and work with no API key and no network.
- **Determinism.** Tests can assert exact outcomes.
- **Safety.** A rule-level refusal (negation, unsupported target) short-circuits the
  LLM entirely, so a model cannot "helpfully" override an explicit refusal.

Why an LLM at all: free-form phrasing, synonyms and compound sentences exceed what a
hand-written lexicon can cover. The LLM is treated as an **untrusted translator**,
not an authority: its output is coerced into the same Pydantic enums and validated
by the same rules.

### 6.3 Validation as the safety kernel

`validation.py` is the one place that decides whether a number may influence the
simulation. Its policy:

| Rule | Behaviour |
| --- | --- |
| Length bound | `LENGTH_LIMIT_MM = 10.0`; beyond → `needs_clarification` + `adjusted_value` |
| Angle bound | `ANGLE_LIMIT_DEG = 45.0`; beyond → `needs_clarification` + `adjusted_value` |
| Unit normalisation | `cm` ×10 → `mm`; inches rejected as `invalid` |
| Unit/parameter match | length parameter with `degrees` (or vice versa) → `invalid` |
| Negative value | `invalid`; sign must come from `operation` |
| Zero magnitude | `no_change` |
| Missing direction | `needs_clarification` (rotation only) |
| Unsupported target/parameter | `unsupported` |
| Qualitative request ("more defined") | `needs_clarification`, no invented number |
| Contradictory instructions | flagged with a reason, both retained for review |

Crucially, out-of-range values are **not clamped**. A clinician who says "reduce the
bridge by 20 mm" gets a clarification request and a suggested 10 mm, not a silent
10 mm change. That is a safety property, and the frontend is built around it.

### 6.4 The target × parameter matrix

The backend understands 14 target regions and 6 parameters, but only **9 regions**
are currently wired into `TARGET_PARAMETER_MAP`:

```text
nasal_bridge · nasal_dorsum · nasal_tip · nostril_region
upper_lip · lower_lip · chin · jawline · cheek
```

`nasal_base`, `columella`, `septal_region`, `left_side` and `right_side` exist in the
enum and in LLM synonyms but are absent from the map, so every instruction naming
them is returned as `unsupported`. This is a deliberate-looking but undocumented
gap; it is recorded in [Reference §5](REFERENCE.md#5-parameter-catalogue) and the
[Developer guide](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt).

### 6.5 LLM adapter

- Model: `gemini-2.5-flash` (configurable through the adapter).
- Output: JSON, coerced field by field into the Pydantic schema.
- Budget: `LLM_CALL_TIMEOUT_S = 12` at the service layer, with the SDK request
  timeout at 15 s. The service bound always wins; a late LLM response is discarded.
- Concurrency: a bounded thread pool (8 workers) runs the blocking SDK call off the
  event loop, so a single slow request cannot stall the server.
- Failure policy: any `LlmError`, malformed payload, empty instruction list or
  all-invalid result falls back to the deterministic result. The user never sees a
  500 because the model misbehaved.
- Qualitative guard: if the source utterance contains no number, any numeric value
  the model invents is stripped, and the instruction becomes
  `needs_clarification`.

The prompt receives the command text and the bounded context; it does not receive
photographs, the mesh, patient identity or prior transcripts.

### 6.6 Deterministic parser

`parser.py` is a lexicon and a small grammar:

- Multi-word synonyms are matched longest-first (`nasal tip` before `tip`).
- Units include `mm`, `millimetre(s)`, `cm`, `centimetre(s)`, `degree(s)`, `°`.
- Negation is detected before instruction construction, so "do not raise the tip"
  produces a refusal rather than a positive change.
- Context fills in an omitted target or parameter from the last applied command, but
  only for a bounded window and only when unambiguous.
- Contradiction detection compares instructions within one utterance
  (e.g. "raise the tip 2 mm and lower the tip 1 mm") and flags rather than merges.
- A hard negative (explicit negation, unsupported region, explicit "no change")
  returns immediately, skipping the LLM.

The grammar and synonym tables are enumerated in
[Reference §6](REFERENCE.md#6-parser-grammar-and-synonyms).

### 6.7 Why the backend does not own the simulation

Three reasons:

1. **Privacy.** Photographs and reconstructed geometry never leave the device, so
   there is nothing sensitive to protect server-side.
2. **Latency.** A slider drag must update 25k vertices at 60 fps; a round trip would
   make the UI unusable.
3. **Deployability.** The frontend is a static bundle that can be hosted anywhere;
   the backend can be omitted (with reduced language coverage) without breaking the
   core simulation.

---

## 7. Frontend design

### 7.1 State model

`App.tsx` owns a small number of authoritative state atoms:

| State | Type | Role |
| --- | --- | --- |
| `session` | `Session` | Consultation lifecycle, transcript, proposals, events, scenarios |
| `history` | `Command[]` | The complete applied change log |
| `modelState` | `ModelState` (derived) | `applyAllCommands(history)` |
| `mode` | `consultation \| live` | Surface selection |
| `activeProposalId` | string or null | Proposal under review |
| `archived` | `ArchivedConsultation[]` | Archive listing |
| `photos` / reconstruction | hook-owned | Photo and reconstruction lifecycle |
| `personalizedModel` / texture | object / canvas | Applied identity and skin |

Everything else is derived with `useMemo` (`modelState`, `activeProposal`,
scenario summaries). There is no global store, no context provider and no reducer
library; the flow is explicit props and callbacks. For a prototype of this size that
is a feature: the entire data flow fits on two screens.

### 7.2 Command pipeline in the frontend

```text
ParseResponse.instructions
        │
        ▼
makeVoiceCommands(instructions, seq)      // map to Command, attach paramKey
        │
        ├─ consultation: InstructionCard list → edit → confirm
        └─ live: evaluateLiveInstruction → auto-apply or log
        │
        ▼
applyCommand / applyAllCommands            // pure
        │
        ▼
ModelState → deformPositions → BufferGeometry
```

`makeVoiceCommands` is where the frontend decides which backend instructions it can
represent. An instruction whose `paramKeyFor` lookup fails is still displayed (with
its reason), but cannot be applied.

### 7.3 Rendering and the viewer

`FaceViewer` owns the Three.js scene: renderer, camera, orbit controls, lights, the
head mesh and the deformation heatmap. React never re-creates the scene on every
render; a `useEffect` updates geometry attributes when `modelState` changes.

Performance strategy:

- The base mesh positions are computed once and cached; deformation is a pure
  function of `(basePositions, modelState)`.
- Only position attributes are rewritten; indices, UVs and normals are recomputed
  only when needed (smooth normals are recalculated after deformation).
- The sculpted head is a `192×128` sphere (~25k vertices); the default realistic
  head is a bundled mesh. Both are small enough for CPU deformation per frame.
- The heatmap colours are computed from displacement magnitude and normalised to
  the current maximum, so it remains readable for small changes.

`ReconstructionPreview3D` is a separate viewer for the reconstructed preview so the
working head is untouched until "Apply".

### 7.4 Async lifecycle and guards

Every asynchronous path has an explicit cancellation story:

| Path | Guard |
| --- | --- |
| Parse request | `reqRef` token + session id + session status |
| Live parse | `liveTokenRef` token |
| Photo detection | `useFacePersonalization` version token |
| Multi-view work | `useMultiViewPhotos.version` |
| Texture generation | `skinTextureRequest` ref |
| Proposal double-submit | `appliedRef` set |
| Health probe | `active` flag + interval cleanup |

This matters because the user can reset the consultation, switch mode or replace a
photo while a request is in flight. Without the guards a stale response would
resurrect deleted state — a class of bug the phase reports document repeatedly.

### 7.5 Layout and responsiveness

```text
┌──────────────────────────────────────────────────────────────┐
│ AppHeader: brand · mode switch · backend status · language   │
├───────────────────────────────┬──────────────────────────────┤
│                               │                              │
│   SimulationWorkspace         │   Side panel (404 px)        │
│   · viewer / heatmap          │   · consultation or live     │
│   · toolbar                   │   · proposal review          │
│   · status / notices          │   · parameters / scenarios   │
│                               │                              │
└───────────────────────────────┴──────────────────────────────┘
```

The grid is `minmax(0, 1fr) 404px` with breakpoints at **1180 px** (narrower side
panel) and **720 px** (single column). Design tokens live only in
`frontend/src/index.css` (accent `#0f766e`); `App.css` consumes them. Panels do not
hard-code colours.

### 7.6 Accessibility posture

- `ConfirmDialog` has `role="dialog"`, `aria-modal`, labelled title, focus on open
  and Escape to close.
- Buttons carry visible labels or `aria-label`; status messages use
  `role="status"`.
- The photo and reconstruction overlays are visually modal but **lack** dialog
  semantics and a focus trap — a known gap recorded in the
  [Developer guide](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt).
- Keyboard-only operation is possible for the main flow; the 3D canvas is not
  keyboard-navigable beyond the toolbar controls.

---

## 8. Resilience and failure handling

| Failure | Detection | User-visible behaviour | Recovery |
| --- | --- | --- | --- |
| Backend offline | 4 s health probe every 15 s | Header status shows offline | Start backend; probe recovers automatically |
| Parse timeout | 20 s `AbortController` in `api.ts` | Proposal marked failed with message | Retry the utterance |
| Empty text | `400` | Inline error | Type something |
| No instructions | `422` | Proposal failed; transcript marked error | Rephrase |
| LLM error / malformed | Service-level catch | Rules fallback; user sees no error | None needed |
| LLM timeout | 12 s bound | Rules fallback | None needed |
| Speech unsupported | Feature detection in `speech.ts` | Typed input remains available | Use keyboard |
| Speech denied | `onError` | Specific microphone message | Grant permission |
| Face not detected | Retries, then error | Actionable photo guidance | Retake photo |
| Insufficient views | `validateMultiViewSet` | Missing-view list | Add the required views |
| IndexedDB unavailable | Open failure | In-memory archive for the tab | Export/report before closing |
| Stale async work | Version/token guards | Discarded silently | None needed |
| Out-of-range request | Validation | `needs_clarification` + suggestion | Confirm suggested value or rephrase |

The general principle: **degrade to a still-useful state, never to a broken one.**
The deterministic parser, typed input, manual sliders and the procedural head all
work with no network, no microphone, no camera and no API key.

---

## 9. Deployment and operations

### 9.1 Local development

```powershell
# backend
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# frontend
cd frontend
npm install
npm run dev
```

The backend loads `../../.env` relative to `backend/app/main.py`, which resolves to
the repository root `.env`. The only supported variable is `GEMINI_API_KEY`; if it
is absent the LLM path is skipped and the rules parser serves every request.

### 9.2 Static deployment

`npm run build` emits `frontend/dist/`. Serve it from any static host and set
`VITE_API_BASE_URL` at build time to a reachable backend. Because the backend has no
authentication and wildcard CORS, it must not be exposed to an untrusted network.
For a pure demo, deploy the frontend alone and accept rules-only parsing.

### 9.3 Operational checks

| Check | Command / action | Expected |
| --- | --- | --- |
| Backend alive | `curl http://127.0.0.1:8000/health` | `{"status":"ok"}` |
| Backend tests | `..\.venv\Scripts\python.exe -m unittest discover -s tests` (from `backend/`) | 36 passing |
| Frontend tests | `npm test` (from `frontend/`) | 234 tests across 25 files |
| Type check | `npx tsc --noEmit` | clean |
| Browser smoke | `node scripts/browser-check.mjs http://127.0.0.1:4173/ tests\fixtures` | no console errors |
| Asset rebuild | `npm run fixtures` | fixture photos regenerated |

### 9.4 Capacity and limits

The app is single-user by construction. The backend can serve concurrent requests
but holds no session; the frontend assumes one tab owns one consultation. Running
two tabs against the same IndexedDB is possible and each tab sees its own archive
view refreshed on load, not live.

---

## 10. Data privacy and security

### 10.1 What leaves the device

| Data | Leaves? | Destination | Notes |
| --- | --- | --- | --- |
| Command text | Yes, when the LLM path runs | Gemini API | No identifiers are added |
| Last 4 context items | Yes, with the command | Gemini API | Target/parameter/operation/value only |
| Photographs | **No** | — | Decoded in-tab; never uploaded |
| Landmarks / meshes / textures | **No** | — | Memory only |
| Consultation archive | **No** | Local SQLite on the backend machine, mirrored to IndexedDB | Not synced to a cloud service |
| API key | Stored in `.env` | Backend only | Never sent to the browser |

The frontend does not send photographs to the backend at any point. The backend does
not log request bodies by default, but reverse proxies in front of it might; do not
deploy it behind one that does.

### 10.2 Threat model (prototype-level)

| Threat | Current posture | Residual risk |
| --- | --- | --- |
| Network eavesdropping | Loopback HTTP in dev | Use TLS if ever exposed |
| Unauthorised backend use | None (no auth) | Bind to loopback; do not expose |
| Cross-site requests | Wildcard CORS | Acceptable only on loopback |
| Patient photo leakage | Never uploaded; no persistence | Browser extensions / screen capture out of scope |
| API key leakage | `.env` gitignored; server-side only | Rotate if committed accidentally |
| Malicious command text | Enums + validation; no eval; no shell | Low |
| LLM prompt injection | Output coerced to enums and validated | Cannot inject geometry or code |
| Archive tampering | Same-origin IndexedDB | No integrity guarantees |

### 10.3 Non-negotiable rules for deployment

1. **Never expose the backend publicly as-is.** Add authentication, TLS, restrictive
   CORS and request-size limits first.
2. **Never add photo upload** without a DPIA, encryption at rest, retention policy and
   explicit consent flow. The current architecture is designed so this is a conscious
   decision, not an accident.
3. **Never log command text or context** in production without a retention policy;
   free-text descriptions can contain identifying information.
4. **Treat the archive as patient-adjacent data.** It lives on the clinician's
   device and should be cleared according to local policy.

### 10.4 Clinical safety posture

The system is a communication aid. It does not measure, diagnose, recommend or
predict. Numeric bounds are illustrative simulation limits, not clinical limits. The
`adjusted_value` mechanism exists so the software never silently overrides a
clinician's stated intent, and the `unsupported` status exists so the software never
pretends to model a region it cannot. Both are safety behaviours, not UX polish. See
[User guide §8](USER_GUIDE.md#8-privacy-and-data-handling) for the operator-facing
version.

---

## 11. Design decisions and trade-offs

| Decision | Rationale | Cost |
| --- | --- | --- |
| Deterministic parser before LLM | Availability, latency, testability, safety | Lexicon needs maintenance |
| LLM output validated as untrusted | Prevents invented anatomy or values | Some valid phrasings are rejected |
| No silent clamping | Honest about limits; clinician stays in control | Extra clarification step |
| Stateless backend | Privacy, simple deployment | No shared history or multi-device sync |
| Client-side geometry | 60 fps interaction; photos stay local | CPU-bound on low-end devices |
| Full history replay | Undo, scenarios, auditability | Every command must remain replayable |
| 6 schema parameters vs 32 registry entries | Small stable contract | Mapping seam is lossy (see gaps) |
| Bundled head asset | No network asset fetch; realistic default | Licence provenance unverified |
| IndexedDB archive with memory fallback | Works in private mode | Archive is device-local only |
| Preview-then-apply reconstruction | Protects the working state | One extra confirmation |

### 11.1 Known architectural tensions

- **Schema richness vs registry richness.** The backend speaks six parameters; the
  UI exposes 32. The mapping through `paramKeyFor` is where the two views diverge,
  and several added clinical parameters currently alias onto core fields.
- **Realism vs determinism.** The realistic head is a fixed asset; identity morphs
  and reconstruction personalise it, but there is no anatomical solver. The
  geometry is plausible, not predictive.
- **Local-first vs auditability.** The archive is convenient but device-bound and
  unencrypted. A clinical product would need a different storage story.

These tensions are documented rather than hidden; see the
[Developer guide §10](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt) for the
concrete defect list and the [Reference §5.1](REFERENCE.md#51-implementation-status)
for per-parameter status.

---

## 12. Where to go next

| If you want to… | Read |
| --- | --- |
| Understand the deformation maths | [Geometry and reconstruction](GEOMETRY_AND_RECONSTRUCTION.md) |
| Use the product | [User guide](USER_GUIDE.md) |
| Change the code | [Developer guide](DEVELOPER_GUIDE.md) |
| Look up a field, bound or enum | [Reference](REFERENCE.md) |
| See historical phase claims | [Documentation index](README.md#existing-project-documents) |
