# Phase 3 — Speech-to-Structured-Intent Pipeline Report

**Project:** VoiceSurg 3D — voice-driven facial-simulation prototype
**Scope of this phase:** speech/command understanding, parsing contract, validation,
conversational context, and the frontend integration it requires
**Status:** implemented, tested (automated), built, and verified at runtime
**Date:** 2026-10-13

---

## 1. Objective & Boundaries

Make the voice pipeline produce a strict, validated, multi-instruction result and make the
frontend apply exactly what was understood — with no hidden transformations and no silent
guessing.

**In scope**
- One explicit structured contract for every parsed instruction (`Instruction`).
- A deterministic rules parser with vocabulary, units, negation, contradictions,
  self-correction and context resolution.
- A single validation layer shared by the AI and the fallback path.
- Bounded conversational context for follow-ups ("reduce **it** by 1 mm").
- Remove the accidental `scale = 0.5` so the requested value equals the applied value.
- Multi-instruction change sets in the UI with per-instruction status and clarification.
- Automated tests for both the backend and the frontend.

**Explicitly out of scope (preserved untouched)**
- The 3D deformation engine `frontend/src/components/FaceDeformationViewer.tsx`
  (**unchanged** — confirmed absent from `git status`).
- No new anatomical regions (lips/chin/jaw/cheeks remain unsupported).
- No new AI provider (Gemini stays), no external speech service, no database/vector store.
- No UI redesign: the Phase 2 light-clinical design system, tokens, layout
  (`minmax(0, 1fr) 404px`) and `prefers-reduced-motion` handling are retained.
- Phase 4 was not started.

---

## 2. The Instruction Contract

Defined in `backend/app/schemas.py` and mirrored in `frontend/src/scene/transformations/types.ts`.

| Field | Type | Meaning |
|---|---|---|
| `target` | `TargetRegion \| null` | `nasal_bridge`, `nasal_dorsum`, `nasal_tip`, `nostril_region` |
| `parameter` | `Parameter \| null` | `height`, `width`, `projection`, `rotation` |
| `operation` | `Operation \| null` | `increase`, `decrease`, `rotate`, `narrow`, `widen`, `raise`, `lower` |
| `value` | `number \| null` | Normalized magnitude (non-negative) in `unit` |
| `requested_value` | `number \| null` | Magnitude exactly as spoken, in `requested_unit` |
| `requested_unit` | `Unit \| null` | Unit as spoken (`mm`, `cm`, `degrees`) |
| `unit` | `Unit \| null` | Canonical unit for the parameter (`mm` linear, `degrees` angular) |
| `direction` | `string \| null` | `up` / `down` for rotation |
| `adjusted_value` | `number \| null` | Suggested in-range replacement when out of bounds |
| `confidence` | `number` | 0–1, mapped to Low/Medium/High in the UI |
| `requires_confirmation` | `boolean` | Whether applying needs an explicit confirm |
| `status` | `InstructionStatus` | see below |
| `reason` | `string \| null` | Human-readable explanation of the verdict |
| `original_text` | `string` | The exact clause this instruction came from |
| `parser` | `ParserSource` | `llm` or `rules` |

`InstructionStatus`: `ok`, `needs_clarification`, `unsupported`, `invalid`, `no_change`.
**Only `ok` instructions are ever applied.** Everything else is inert in the UI.

---

## 3. Parsing Pipeline

```
POST /api/parse-command  (text, context[])
        │
        ▼
parser_service.parse_command()
   1. rules = parse_text(text, context)                     ← deterministic, offline
   2. if rules hit a HARD NEGATIVE (negation / unsupported / no_change) → return rules
   3. else try parse_with_llm(text, context)                ← Gemini, raw intent only
   4. build_instruction() validates every LLM item against the SAME contract
   5. LLM unavailable / malformed / empty / all-invalid → return rules
   6. flag_contradictions(_guard_qualitative(llm))
```

- **`app/parser.py`** — the deterministic rules parser. Splits multi-command utterances on
  conjunctions; merges cue-only fragments ("no wait"); detects region synonyms
  (radix/supratip/alar…), operations, direction, units (incl. word-numbers and
  "one and a half"), negation, unsupported regions, qualitative phrases, self-correction and
  pronoun context.
- **`app/llm_parser.py`** — Gemini extraction only. Returns raw dicts; it cannot bypass
  validation. Strict JSON prompt, `temperature=0`, `gemini-2.5-flash`, 15 s timeout.
- **`app/validation.py`** — the single normalization/validation gate for **both** paths
  (enum coercion, target↔parameter compatibility, cm→mm, linear/angular mismatch, missing /
  negative / zero values, range guard).
- **`app/parser_service.py`** — the policy above.

### Why the AI can't do damage
1. Hard negatives are decided by the rules parser *before* the model is consulted.
2. Every model output is coerced through the same `build_instruction()` as the fallback.
3. A qualitative phrase (`"slightly"`, `"a bit"`) with an invented number is stripped back to
   `needs_clarification` (`_guard_qualitative`).
4. Anything unusable falls back to the deterministic result.

---

## 4. Safety & Honesty Semantics

- **No silent clamping.** A value beyond the supported simulation range (lengths ±10 mm,
  angles ±45°) yields `needs_clarification` **plus** `adjusted_value`; the UI offers
  "Accept adjusted". Nothing is quietly truncated.
- **No invented numbers.** Qualitative amounts require an explicit measurement.
- **Negation is respected.** "Do not reduce the bridge" → `no_change`, never a reduction.
- **Unsupported input is named.** Other regions ("chin") and units ("inch") are reported as
  `unsupported` with a reason.
- **Requested vs applied are both shown.** `0.2 cm` displays as *requested 0.2 cm* while the
  applied/canonical value is `2 mm`.
- **Value semantics fixed.** The Phase 2 `scale = 0.5` multiplier is removed: the spoken
  magnitude is applied directly, so the proposed value, the applied change and the history
  entry all agree (`frontend/src/scene/transformations/logic.ts`).
- **Bounded context.** The frontend sends the last 4 applied instructions; the server also
  truncates to 4. Context is used only to resolve references ("it", "that") and is never
  persisted.

---

## 5. Frontend Integration

- `Command extends Instruction` with `id`, `source` (`voice`/`manual`) and `createdAt`.
- `App.tsx` now holds `pendingCommands: Command[]` (a change set) instead of a single
  `pendingCommand`; confirm applies **only** `ok` instructions, removes the rest, and speaks
  confirmations for each applied change when enabled.
- New components: `ChangeSetReview.tsx` (list + summary + "Confirm & simulate (N)"),
  `InstructionCard.tsx` (per-instruction status chip, region/parameter/action/proposed change,
  parser confidence, reason, inline edit, clarify choices, remove). `IntentReview.tsx` removed.
- `logic.ts` handles `narrow`/`widen` (width semantics) and `raise`/`lower`/`rotate` explicitly;
  manual slider edits remain absolute values.
- `api.ts` posts `{ text, context }` and validates the response shape; `speech.ts` was rewritten
  with session-token guards, interim results, no overlapping recognition instances, and honest
  error mapping.
- Styling reuses the Phase 2 tokens/classes (new `.instruction-card*`, `.chip--ok|warning|error|info|neutral`, `.intent-review__footer` etc. added in `App.css`).

---

## 6. Files Created / Modified / Removed

### Created
- `backend/app/validation.py`, `backend/app/parser_service.py`
- `backend/tests/__init__.py`, `backend/tests/test_parser.py`,
  `backend/tests/test_parser_service.py`, `backend/tests/test_api.py`
- `frontend/src/components/ChangeSetReview.tsx`, `frontend/src/components/InstructionCard.tsx`
- `frontend/vitest.config.ts`, `frontend/tests/setup.ts`, `frontend/tests/logic.test.ts`,
  `frontend/tests/format.test.ts`, `frontend/tests/api.test.ts`,
  `frontend/tests/ChangeSetReview.test.tsx`

### Modified
- `backend/app/schemas.py`, `backend/app/parser.py`, `backend/app/llm_parser.py`,
  `backend/app/main.py`, `backend/test_parser.py`, `backend/test_api_e2e.py`
- `frontend/src/scene/transformations/types.ts`, `frontend/src/scene/transformations/logic.ts`,
  `frontend/src/lib/format.ts`, `frontend/src/lib/params.ts`, `frontend/src/services/api.ts`,
  `frontend/src/services/speech.ts`, `frontend/src/components/ConsultationPanel.tsx`,
  `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/package.json`

### Removed
- `frontend/src/components/IntentReview.tsx`

### Untouched (verified)
- `frontend/src/components/FaceDeformationViewer.tsx` (not in `git status`).

---

## 7. Dependencies & Tooling

- **Backend:** none added. Tests use the stdlib `unittest` + FastAPI's `TestClient`
  (already available via `httpx`).
- **Frontend:** new dev-only dependencies for testing:
  `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`.
  No runtime dependency changed. A separate `vitest.config.ts` and `frontend/tests/` keep the
  `tsc` build (`include: ["src"]`) unaffected.

---

## 8. Verification

### Static
| Check | Command | Result |
|---|---|---|
| Typecheck + production build | `npm run build` (`tsc && vite build`) | **PASS** |
| Build output | — | `dist/index.html 0.63 kB`, `dist/assets/index-DSkzQ7-G.css 17.30 kB`, `dist/assets/index-BoEjEfc_.js 1,186.55 kB` (gzip 326.59 kB) |
| Offline parser smoke | `python test_parser.py` (cwd `backend/`) | **PASS** |

Only warning: Vite chunk > 500 kB (`three`-heavy bundle — unchanged, expected).

### Automated tests

**Backend** — `python -m unittest discover -s tests -v` (cwd `backend/`, venv):
**29 tests, all PASS.** Covers multi-command, negation, keep-unchanged, cm→mm (+preserved
requested value), out-of-range (no clamp → `adjusted_value`), unsupported region, unsupported
unit, missing value, qualitative-no-invention, rotation direction required, linear/angular
mismatch, contradiction flagging, self-correction supersede, pronoun context, narrow→width,
gibberish→invalid, word-numbers, LLM fallback policy (4 cases with Gemini mocked), and the
HTTP contract (`/api/health`, empty→400, valid→200, multi→2 instructions, invalid→200 not 500).

**Frontend** — `npm test` (`vitest run`):
**18 tests across 4 files, all PASS.** Covers apply-directly (no scaling), sign-by-operation,
narrow/widen, rotation direction, non-`ok` inert, manual absolute values; format/status/
applicability/requested-vs-applied; API body/context bounding and error mapping; and
`ChangeSetReview` rendering, confirm enable/disable, confirm click and per-index removal.

### End-to-end (live backend on :8000)
`python test_api_e2e.py` — real Gemini used where available, deterministic fallback otherwise:

| Command | Result |
|---|---|
| Reduce the bridge by 2 millimeters | `ok` bridge/height decrease 2 mm (`llm`) |
| Lower the bridge by 3 mm | `ok` bridge/height lower 3 mm (`llm`) |
| Make the bridge narrower by 1 millimeter | `ok` bridge/width narrow 1 mm (`llm`) |
| Rotate the tip upward by 5 degrees | `ok` tip/rotation rotate up 5° (`llm`) |
| Make the dorsum lower by 2 mm | `ok` dorsum/height lower 2 mm (`rules`) |
| Lift the tip slightly | `needs_clarification`, value `None`, no invented number |
| Make my nose better | `invalid` |
| Reduce the bridge by 100 millimeters | `needs_clarification`, `adjusted_value 10` |
| Reduce the bridge by 2 mm and raise the tip by 1 mm | **2** `ok` instructions |
| Do not reduce the bridge | `no_change` |

### Runtime (headless Chrome + CDP, preview build on :4173, backend on :8000)
- No horizontal overflow; 3D canvas present.
- Typed `"Reduce the bridge by 2 mm and raise the tip by 1 mm"` → `POST /api/parse-command` **200**
  → change set with **2 cards**, both "Ready to apply", values **−2 mm** / **+1 mm**,
  button **"Confirm & simulate (2)"**, phase "Awaiting confirmation".
- Confirm → bridge-height control **−2 mm**, **2** history entries
  (`Nasal Bridge · Height · −2 mm`, `Nasal Tip · Height · +1 mm`), review dismissed.
- Typed `"Do not reduce the bridge"` → 1 card **"No change"**, confirm **disabled**.

---

## 9. Known Limitations & Incomplete Functionality

- **Browser microphone untested here.** `SpeechRecognition` cannot run in headless Chrome, so
  only the typed path was exercised end-to-end; the voice path (`services/speech.ts`) must be
  checked manually in a real browser (secure context). This mirrors Phase 2.
- **Live end-to-end used the real Gemini path.** The deterministic fallback was validated
  directly (`test_parser.py`, `tests/test_parser.py`) and the policy was unit-tested with the
  LLM mocked (`tests/test_parser_service.py`); a fully offline HTTP run was not reproduced
  (blanking the key via the environment is unreliable on this Windows host).
- **`tip + height` has no slider.** It maps to the engine's `tipHeight` field and is applied and
  recorded in history, but `ParameterPanel` only surfaces four parameters, so it is not visible
  as a slider (the viewer reflects it). This is an existing engine/UI surface gap, not a parser
  issue.
- **`nostril_region + width`** (alar width) is driven by the existing `bridgeWidth` field as an
  approximation — the engine has no separate alar control.
- **`mm` is uncalibrated** and presented as simulation units, not verified clinical measurements.
- **Range limits (±10 mm / ±45°)** are simulation guard-rails, not clinical limits, and live in
  validation, not the engine.
- **Bundle-size warning** (three.js) remains.
- **Pre-existing docs updated:** `UI_INTEGRATION_MAP.md` and `UI_DOCUMENTATION.md` were rewritten
  to the current multi-instruction contract and light-clinical UI (they previously described the
  old single-command dark dashboard).

---

## 10. How to Run

```powershell
# backend tests (from backend/)
& ..\.venv\Scripts\python.exe -m unittest discover -s tests -v

# offline parser smoke (from backend/)
& ..\.venv\Scripts\python.exe test_parser.py

# frontend tests (from frontend/)
npm test

# frontend build
npm run build

# full stack
.\.venv\Scripts\uvicorn.exe backend.app.main:app --port 8000
cd frontend; npm run dev        # or: npm run build; npm run preview -- --port 4173 --strictPort
```
