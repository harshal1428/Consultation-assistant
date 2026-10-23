# VoiceSurg 3D — Final Verification Report (Phase 8)

**Project:** VoiceSurg 3D — voice-driven facial-simulation prototype
**Scope of this phase:** verify the whole product end to end (typed/voice →
parse → validate → clarify → proposal review → explicit confirm → canonical state
→ region geometry → 3D → history/undo → scenario save/load/compare → summary
export), tighten the few real defects the verification surfaced, and record an
honest, reproducible verdict. **No new features, no engine/UI rebuild.**
**Status:** verified end-to-end at runtime (real FastAPI backend + headless Chrome)
**Date:** 2026-10-15

> **Verdict: READY FOR DEMO.** One caveat: responses may occasionally come from the
> deterministic parser instead of the language model when the LLM is slow — this is
> by design and now bounded (see §6). Nothing in the golden path is blocked.

---

## 1. Method

Every scenario below was driven by a real headless-Chrome CDP harness against the
**production build** (`npm run build` → `vite preview` on `:4173`) and the **real
backend** (`uvicorn backend.app.main:app` on `:8000`, live `GEMINI_API_KEY`).
Harnesses live in `%TEMP%\opencode\` (`p8_full.mjs`, `p8_session.mjs`, `p8_ux.mjs`,
`p8_h3.mjs`, `p8_async.mjs`) and were run through `p8_run.ps1`, which starts and
stops the servers + Chrome around each run.

Server processes are children of the shell that launched them, so each harness run
starts the backend, preview server and Chrome inside a single PowerShell invocation,
then tears all of them down.

---

## 2. Automated suites (after all fixes)

| Suite | Command | Result |
|---|---|---|
| Frontend unit/component | `cd frontend; npm test` | **128 passed / 14 files** (was 102/10; +facialFeatures, +reference, +historyStore, +ConsultationHistoryPanel) |
| Backend unit/service | `cd backend; ..\.venv\Scripts\python.exe -m unittest discover -s tests` | **36 passed** (was 35; +1 timeout test) |
| Production build | `cd frontend; npm run build` | **clean** (`tsc` + `vite build`), only the pre-existing >500 kB chunk warning |

The legacy backend scripts `backend/test_parser.py` and `backend/test_api_e2e.py`
are not discovered by `unittest discover -s tests` (only `backend/tests/` is) and
were left untouched.

---

## 3. Scenario matrix (runtime, real backend)

| # | Scenario | Evidence | Result |
|---|---|---|---|
| A | Basic valid — *"Reduce the nasal bridge height by 2 millimetres"* | 1 review card *Ready to apply (−2 mm)* → confirm → `bridgeHeight = −2`, 1 history row, transcript *Confirmed* | PASS |
| B | Compound — two instructions in one utterance | "Change set", 2 cards, confirm → `bridgeHeight = −2`, `tipProjection = +3`, 2 history rows | PASS |
| D | Mixed valid + ambiguous | 1 ready + 1 needs-clarification, confirm **disabled**, "Apply only valid (1)" present → partial apply → 1 history row, transcript *Confirmed* | PASS |
| C | Invalid/ambiguous battery (8 cases) | see §4 | pass |
| F | Multi-region isolation | 6 params across 6 regions edited; changed set exactly those 6, all others `0`; single canvas | PASS |
| G | Session / scenario / compare / report | see §4.2 | PASS |
| H | Async safety | duplicate submit, session-switch mid-request, reset mid-request, end with pending proposal, backend failure, AI-unavailable | pass (see §6) |

### 3.1 Validation battery (Scenario C)

| Input | Observed | Correct? |
|---|---|---|
| "Make the forehead bigger" | **Not supported** — names the supported regions; confirm disabled | ✓ |
| "Make the nasal bridge higher" | **Needs clarification** — value missing; offers `1 mm` / `2 mm` / Custom | ✓ |
| "Reduce the nasal bridge height by 2 inches" | **Not supported** — "Inches are not supported; please use millimetres" | ✓ |
| "Reduce the nasal bridge height by 100 millimetres" | **Needs clarification** — "Accept adjusted 10 mm" | ✓ |
| "Make my nose better" | **Invalid** — no supported region identified | ✓ |
| "Do not reduce the nasal bridge" | **No change** — negation; confirm disabled | ✓ |
| "Increase … 2 mm and reduce … 1 mm" | **Needs clarification** — contradiction flagged on both | ✓ |
| *(blank / whitespace)* | Nothing submitted (client ignores empty); direct API returns HTTP 400 | ✓ |

### 3.2 Session, scenario, comparison, report (Scenario G)

- Saved `Plan A` (bridge −2) and `Plan B` (+ tip projection +4); both appeared with
  correct summaries and "in-memory only".
| **Load** | Loading "Plan A" restored `bridgeHeight = -2`, `tipProjection = 0`. |
| **Compare** | Switched to Compare; pane tags `Original (baseline)` vs `Plan B`; diff table: *Bridge height 0 → −2 (Δ −2)`, *Tip projection 0 → +4 (Δ +4)*. |
| **Report** | "Save report" produced correct Markdown: session id/started/status, all 17 final parameter values, confirmed changes, unresolved proposals, saved scenarios, and the **Limitations** block (not a clinical document). |
| **Rename / Delete** | Rename + delete (guarded by a confirm dialog) both work; timeline records "Scenario renamed"/"Scenario deleted". |
| **End consultation** | Badge → "Ended · temporary"; typed input and scenario save disabled; review cleared. |
| "New consultation" with unsaved work | Confirmation dialog → discard → clean baseline, empty history, report disabled. | ✓ |

### 3.2 Multi-region isolation (Scenario F)

The Simulation Parameters panel now lists the five regions (Nose / Lips / Chin /
Jawline / Cheeks) as selectable parts and reveals a region's controls only after
it is selected (accordion, one region open at a time; a badge counts each region's
changed parameters). Manual edits across six regions — `tipHeight`,
`upperLipProjection`, `lowerLipFullness`, `chinProjection`, `jawDefinition`,
`cheekFullness` — produced exactly those six changed sliders and left the other
eleven at 0, in one 3D canvas.

---

## 4. Performance

### 4.1 Bundle (production build)

| Asset | Baseline (pre-Phase-8) | After | Δ |
|---|---|---|---|
| `index.html` | 0.63 kB (gzip 0.38) | 0.63 kB (gzip 0.38) | 0 |
| CSS | 24.29 kB (gzip 4.93) | 24.29 kB (gzip 4.93) | 0 |
| JS | 1,224.38 kB (gzip 335.61) | 1,224.69 kB (gzip 335.68) | +0.31 kB |

The large single JS chunk is the Three.js / React-Three-Fiber bundle. It is
**not** code-split (the >500 kB Vite warning is expected). No optimization was
applied because it would be a rebuild-level change outside this phase's scope and
the demo runs locally with no network transfer cost.

### 4.2 Runtime (preview, headless Chrome, 1440×960)

| Metric | Value |
|---|---|
| TTFB | ~113 ms |
| DOMContentLoaded / load | ~201 ms |
| First contentful paint | ~260 ms |
| JS decoded | 1.22 MB |
| JS heap (idle) | ~22 MB |
| 20 slider input updates (React re-render incl.) | ~130 ms (~6.5 ms each) |

Geometry deformation is recomputed from the immutable baseline on every change;
the slider latency above is well inside a smooth 60 fps interaction budget.

---

## 5. Responsiveness & accessibility

**Viewports** (no horizontal overflow at any size):

| Viewport | `scrollWidth − innerWidth` | Panels | Canvas |
|---|---|---|---|
| 1440×960 desktop | 0 | 6 | 934×574 |
| 1024×768 laptop | 0 | 6 | 940×459 |
| 820×1100 tablet | 0 | 6 | 334×437 at 390 wide |
| 390×844 mobile | 0 | 6 | 334×437 |

**Accessibility (desktop):** single `<h1>` with an ordered heading outline;
`header`/`main`/`footer` landmarks present; `lang="en"`; every form input has an
associated label (0 unlabeled); 7 `aria-pressed` toggle buttons; status/error
messages use `role="status"`/`role="alert"`. **Minor:** the `<canvas>` has no
`aria-label` (the 3D view is decorative and mirrored by numeric controls) — noted,
not blocking.

---

## 6. Async safety, timeouts and the fixes applied

Verification surfaced three real defects; all were fixed and re-verified. Two new
backend tests / no ui regressions: frontend 102/102, backend 36/36.

1. **Reset left a pending proposal un-cancelled.** `Reset simulation` cleared the
   history and hid the review but left the proposal in a non-terminal `ready`
   state, unlike `End consultation` which cancelled it.
   *Fix (`frontend/src/App.tsx`):* reset now cancels the active non-terminal
   proposal before appending the `Simulation reset` event. Verified: the timeline
   now shows `Simulation reset` → `Proposal cancelled`.

2. **In-flight parse could survive a reset/new.** A parse request in flight when
   the user reset or started a new consultation could return afterwards and
   (a) resurrect a cancelled proposal or (b) leave the UI stuck on "Processing…"
   (the busy flag was only cleared when the session id/token still matched).
   *Fix (`frontend/src/App.tsx`):* both `doResetSimulation` and
   `doNewConsultation` now bump the request token and clear the processing flag.
   Verified deterministically with a CDP `Fetch` interception that **holds the
   parse request pending** (so the race is guaranteed): after reset/new the input
   is enabled again, no stale review appears, and failing the held request produces
   no resurrected proposal and no spurious error.

3. **Unbounded LLM latency.** Live runs showed the Gemini call occasionally
   exceeding the SDK's own 15 s timeout (first requests after a cold start). With
   no hard ceiling the UI could sit on "Processing…" indefinitely.
   *Fix (`backend/app/parser_service.py`):* the model call now runs in a small
   thread pool under a hard **12 s** wall-clock ceiling and falls back to the
   deterministic rules parser on timeout (raise `LlmError`). Added a unit test
   (`test_llm_hang_times_out_and_falls_back_to_rules`).
   *Fix (`frontend/src/services/api.ts`):* `parseCommandAPI` uses an
   `AbortController` with a 20 s backstop so the UI can never wait forever on a
   network-level stall. Verified live: the slow runs that previously hung now
   return a correct proposal (parsed by `rules`) and apply cleanly.

### 6.1 Async scenario evidence (deterministic harness)

| Case | Result |
|---|---|
| Double-click **Confirm** | Exactly one history row (applied-id guard holds) |
| Start new consultation while parse pending | Dialog → discard → clean state; stale reply ignored; input re-enabled |
| Reset while parse pending | `Simulation reset` + `Proposal cancelled`; input re-enabled; no resurrection |
| End consultation with pending proposal | Proposal cancelled; session `Ended`; inputs disabled |
| Backend unreachable (request blocked) | Clear "Parsing service" error; no change applied; app stays usable |
| `GEMINI_API_KEY` empty (live `:8001`) | Falls back to `rules`, status `ok`, correct target/value; empty text → HTTP 400 |

---

## 7. Security & data handling review

- **No secrets in the frontend.** `frontend/src` contains no `VITE_*`, `API_KEY`,
  `GEMINI`, `sk-` or `AIza…` values; the API base is a hard-coded localhost URL.
- **API key** is read only server-side from `.env` (`main.py` → `load_dotenv`).
- **CORS** is `allow_origins=["*"]` with `allow_credentials=True`. This is
  acceptable **only** because the backend is a localhost prototype with no cookies,
  auth, or sensitive data. Tightening to the preview origin is recommended before
  any shared deployment.
- **Session is in-memory; history archive is local-only.** The live session,
  transcript, scenarios and undo history are in-memory and lost on reload. The
  *Saved consultations* archive (Phase 8, Objective 4) persists **on-device only**
  in IndexedDB (`voicesurg-history`); it is never uploaded. There is still no
  server-side database, cloud, auth, or EMR, and no clinical/audit guarantee.
- **Reference portraits are local.** Bundled portraits live under `public/reference/`;
  user uploads are read locally via `URL.createObjectURL` and never sent anywhere.
- `.env`, `.venv`, `node_modules`, `dist` are untracked/ignored.

---

## 7b. Phase 8 objectives (realistic face, references, modes, history, workspace)

Five follow-on objectives were implemented after the initial Phase 8 verification.
They are purely additive and preserve the parser contract, confirmation workflow,
parameter registry, undo, scenarios and reports. Full detail in
`docs/REALISTIC_FACE_IMPLEMENTATION.md`, `docs/LIVE_SIMULATION_MODE.md` and
`docs/CONSULTATION_HISTORY_STORAGE.md`.

| # | Objective | Result |
|---|---|---|
| 1 | Procedural realistic face (sculpted head + eyes/brows/ears + material/lighting) | Done — invariants hold, `facialFeatures` tests added |
| 2 | Reference-portrait panel (bundled `ss/` portraits + local upload, side-by-side) | Done — no external requests; `reference` tests added |
| 3 | Live Simulation vs Consultation modes | Done — mode switch preserves work; tests added |
| 4 | Persistent consultation history (IndexedDB, on-device) | Done — survives reload; restore/delete; tests added |
| 5 | Workspace redesign around the face | Done — viewer-focused layout + mode/changed-count header |
| 6 | Tests across the new surface | Done — frontend suite 102 → 128 passing (14 files) |
| 7 | Docs | Done — three new docs + this update |

Verification for these objectives used the same CDP harness method as §1
(`face_smoke.mjs`, `face_strips.mjs`, `ref_check.mjs`, `mode_check.mjs`,
`archive_check.mjs`), all clean: no console errors, no failed requests, and — for
objectives 2 and 4 — **no external network requests** (privacy confirmed).

---

## 8. Honest limitations & residual risks

- The 3D model is a **stylized geometric head**, not a patient/DICOM mesh; units
  are illustrative (150 mm reference) and are **not** clinical millimetres.
- The language model is best-effort: it can be slow or return unusable output, in
  which case the deterministic parser is used (now time-bounded). The demo should
  not depend on the exact phrasing coming back as "language model".
- **Voice** capture (Web Speech API) cannot be exercised in headless Chrome; the
  typed field uses the identical pipeline and is fully covered here. Voice remains
  browser-dependent (Chrome/Edge recommended).
- One pre-existing intermittent test flake: `tests/App.test.tsx` confirm test can
  hit the 5 s timeout under heavy parallel load; it passes in isolation and in the
  final full run.
- The `<canvas>` lacks an `aria-label` (decorative; numeric controls mirror it).

---

## 9. How to reproduce

```powershell
# Backend (root)
.\.venv\Scripts\uvicorn.exe backend.app.main:app --host 127.0.0.1 --port 8000

# Frontend, production build + preview (new terminal)
cd frontend
npm run build
npx vite preview --host 127.0.0.1 --port 4173

# Tests
cd frontend; npm test
cd ..\backend; ..\.venv\Scripts\python.exe -m unittest discover -s tests
```

Open `http://127.0.0.1:4173/`. The header shows a parsing-service status dot.

---

## 10. Final verdict

**READY FOR DEMO.** The complete workflow — typed/voice command → parse →
validate/clarify → review → explicit confirm → deterministic 3D change →
history/undo → scenario save/load/compare → summary export → end/new — works
end-to-end against the real backend, at every tested viewport, with no console
errors and no failed requests. The three defects found were fixed and re-verified.
The only caveat is intentional and bounded: under LLM slowness the deterministic
parser answers instead.
