# Final VoiceSurg Verification

**Date:** 2026-10-31  
**Repo:** `C:\Users\Admin\OneDrive\Desktop\HM\ERI S1` (git repo)  
**Model/Agent:** Big Pickle (opencode)  
**Rules followed:** `AGENTS.md` re-read; `backend/tests/gold/utterances.csv` not modified; no face geometry/topology/reconstruction/MediaPipe changes; no bundled face assets; no paid services/local LLMs/uploads/API keys exposed.

## Completed work (summary)

### Centralized clinical registry
- **Created:** `shared/clinical_parameters.json` (schema 1) — 59 unique parameters, 6 groups.
- **Simulated:** 17 geometry-backed. **Registered but not simulated:** 42.
- **Loaders:** `backend/app/clinical_registry.py`, `frontend/src/lib/clinicalRegistry.ts` with synonym matching (longest/specific first), ambiguity detection, pair resolution.
- **Enforcement:** Clinical key authoritative; `not_simulated` for non-simulated keys; parser service hard-negative prevents LLM substitution; bounds skipped for non-simulated; contradiction grouping includes `clinical_parameter`.

### Parser/validation/contracts
- **Parser:** Clinical-first matching, ambiguity preserved, context/antecedent inheritance of `clinical_parameter`, improved operations (`deproject`, `deflate`, `plump`, `fill`, `advance`, `elevate`, `open`, `deepen`, `lengthen`, `shorten`), nasal length phrases, tip rotation phrases, `"angle"` only triggers rotation with rotate/rotation/rotated/tilt.
- **Validation:** Registry key validation, key/pair consistency, clinical units, `not_simulated` reasons, simulation bounds only for simulated.
- **Contracts:** Added `clinical_parameter`, `face` target, `ratio` unit, `not_simulated` status (backend schemas, frontend types).

### Frontend integration
- **Params:** `frontend/src/lib/params.ts` rewritten around 17 descriptors; removed unsafe aliases (tip definition→tip height, alar flare→alar width, columellar show→cheek projection). `SIMULATED_PARAM_KEYS` limited to 17.
- **UI:** `InstructionCard` shows clinical concept + simulation status chip; `ParameterPanel` discloses measurement status and 17-control restriction; `format.ts`/`statusMeta` updated for `not_simulated`.
- **Live/consultation:** `evaluateLiveInstruction`, proposal flow, context serialization updated for clinical keys/statuses; consultation PDF export added via `buildTextPdf` in `frontend/src/scene/live/logic.ts`; Markdown "Save report" + "Save PDF" in `App.tsx`; report includes illustrative units disclosure and "Registered but not simulated" section.
- **Session logic:** `frontend/src/scene/session/logic.ts` updated for report content/disclosure.

### Research evaluation (separate from gold)
- **Dataset:** `backend/tests/research/clinical_vocabulary_v1.csv` (68 rows, evaluation-only). `backend/tests/research/README.md` documents schema/versioning/no-training/no-leakage.
- **Evaluator:** `backend/app/eval/research.py` with leakage checks, per-group/per-parameter metrics, critical false-application tracking, JSON/Markdown reports, CLI.
- **Tests:** `backend/tests/test_research_eval.py` (6 tests, 38 subtests passing). **Result:** 100% exact/status/key/value/unit, 0 critical false applications, not-simulated recall 100%.

### Gold evaluation (honest update)
- **Regenerated:** `backend/tests/gold/parse_results.json`, `frontend/tests/goldLiveDecisions.test.ts` fixture (`backend/tests/gold/live_decisions.json`).
- **Baseline updated:** `backend/tests/gold/baseline.json` to reflect honesty (alar-base/dorsal-hump now `not_simulated`).
- **Metrics:** 265 rows, 100 direct commands, 165 non-commands. **False-commit:** 0.0000 (0). **Missed-commit:** 0.2900 (29). **Wrong-execution:** 0.1300 (13). **Applied:** 71 (was 74). **Slot accuracy:** 66.99%. **Value MAE:** 0.0649 mm (n=77).
- **Gold tests:** `test_gold_dataset.py`, `test_gold_eval.py`, `test_gold_harness.py`, `test_gold_regression.py` — 31 passed (stale expectation corrected with rationale).
- **Split:** 185 dev / 80 test, seed 20261030. Gold SHA-256: `cb39a1af0cb7e06c89fd1a163d733c07a9ff3cfb49afadd88dc96c3fa4c95abc`.

### Voice pipeline
- **Existing:** Server voice (AudioWorklet→WS→VAD/ASR→parse), review-first Live gating, fake ASR for CI, hallucination guards, same hook for consultation/Live. Committed in prior milestones (`c77cc5c`, `d0d6bf8`, `6310729`).
- **Verified:** Config/env, WS/VAD/ASR structure, CI uses `ASR_BACKEND=fake`.

### Tests added/updated
- **Backend:** `backend/tests/test_clinical_registry.py` (20 tests + 8 subtests), `backend/tests/test_research_eval.py` (6 tests + 38 subtests), updated `backend/tests/test_parser_service.py`, `backend/tests/test_gold_harness.py`.
- **Frontend:** `frontend/tests/params.test.ts` rewritten (17 tests), added PDF export test in `frontend/tests/App.test.tsx` (Save PDF button, blob type application/pdf, PDF header, disclosure text).

## New/updated parameters (registry)
**New clinical keys (examples):** `dorsal_hump_reduction`, `nasal_length`, `nasofrontal_angle`, `nasolabial_angle`, `columellar_show`, `columellar_lobular_angle`, `tip_definition`, `supratip_break`, `alar_flare`, `alar_base_width`, `nostril_shape`, `nostril_width`, `nostril_symmetry`, `alar_asymmetry`, `dorsal_deviation`, `septal_deviation`, `dorsal_asymmetry`, `dorsal_contour`, `upper_lip_height`, `lower_lpe_height?` see full list in `shared/clinical_parameters.json`.  
**Simulated set reduced/clarified:** only 17 geometry-backed; all others registered/reviewable but not simulated.

## Registered-but-not-simulated parameters
All 42 non-simulated keys in `shared/clinical_parameters.json` (groups: nose/lips/chin/jawline/cheeks/face). Notable: dorsal hump reduction, nasal length, angles (nasofrontal/nasolabial/mentolabial/gonial/columellar-lobular), columellar show, tip definition, supratip break, alar flare/base, deviations/asymmetries, contours, facial proportions/symmetry. UI shows "Registered only — not simulated" / chip warning; reports list them as not applied.

## Parser/voice changes
- Clinical-first parsing with key authority and ambiguity lists preserved.
- Operations expanded; rotation requires rotate/rotation/rotated/tilt (not just "angle").
- Nasal length phrases (`lengthen the nose`, `shorten the nose`), tip rotation (`rotate the nasal tip`).
- `deproject`/`deprojection` added.
- Ambiguous cases preserved for review: lips (bare), rotation direction, contradictory actions, "reduce dorsal asymmetry" (dorsal_deviation vs dorsal_asymmetry), equal clinical matches.
- Voice: review-first, same parse path, hard-negative for registered-only.

## Dialogue/proposal changes
- InstructionCard shows clinical concept row with status chip and limitations tooltip.
- Editing clears `clinical_parameter` when region/parameter changed manually.
- `not_simulated` appears in status with warning tone; proposals can include registered-only instructions for review.
- Consultation report discloses illustrative scene units and lists registered-but-not-simulated concepts.
- PDF export added (honest disclosure included).

## Files changed (key)
**New:** `shared/clinical_parameters.json`, `backend/app/clinical_registry.py`, `backend/app/eval/research.py`, `backend/tests/test_clinical_registry.py`, `backend/tests/test_research_eval.py`, `backend/tests/research/*` (csv, readme, reports), `frontend/src/lib/clinicalRegistry.ts`, docs: `CLINICAL_PARAMETER_REGISTRY.md`, `CLINICAL_VOCABULARY.md`, `VOICE_PIPELINE_VERIFICATION.md`, `RESEARCH_EVALUATION_REPORT.md`, `FINAL_VOICESURG_VERIFICATION.md`.  
**Modified (major):** `backend/app/parser.py`, `backend/app/parser_service.py`, `backend/app/validation.py`, `backend/app/schemas.py`, `backend/app/llm_parser.py`, `frontend/src/lib/params.ts`, `frontend/src/lib/format.ts`, `frontend/src/components/InstructionCard.tsx`, `frontend/src/components/ParameterPanel.tsx`, `frontend/src/scene/live/logic.ts`, `frontend/src/scene/session/logic.ts`, `frontend/src/App.tsx`, `frontend/src/scene/transformations/types.ts`, gold files/baseline/fixtures/tests.

## Exact tests run
- **Backend full:** `..\.venv\Scripts\python.exe -m pytest -q` → 164 passed, 1 xfailed, 164 subtests (28.07s)
- **Backend voice:** 52 passed, 118 subtests (3.77s)
- **Backend focused:** registry/research/parser/service/gold → all passing (59 passed, 46 subtests in focused run; full suite includes others)
- **Frontend full:** `npx vitest run` → 35 files, 280 tests passed (93.72s)
- **Frontend CI subset:** 7 files, 46 tests passed (43.11s)
- **Frontend specific:** `params.test.ts` 17 passed, `session.test.ts`, `App.test.tsx` 14 passed, `ChangeSetReview.test.tsx`, `live.test.ts` 68 passed total in focused run
- **TypeScript:** `npx tsc --noEmit` passed
- **Build:** `npm run build` passed
- **Gold harness/eval/regression/dataset:** all passed (31 tests)

## Gold comparison (before → after)
| Metric | Before (implied) | After | Notes |
| --- | --- | --- | --- |
| Applied command rows | 74 | 71 | Honest: alar-base/dorsal-hump now `not_simulated` |
| False-commit rate | 0.0000 | 0.0000 | Preserved |
| Missed-commit rate | ~0.2600? | 0.2900 (29) | Increased due to honesty (no silent application) |
| Wrong-execution rate | ~0.1300? | 0.1300 (13) | Similar |
| Slot accuracy | ~67.5%? | 66.99% | Slight change |
| Value MAE | ~0.0650 | 0.0649 mm (n=77) | Similar |

**Gold baseline:** 265 rows, 100 direct commands, 165 non-commands. New baseline ratcheted to honest results.

## Real-voice verification
**Status:** **Not fully verified in this environment.**  
**Details:** `faster_whisper` not installed; no model weights/Silero ONNX configured; no microphone/hardware E2E. Tests use fake ASR. Energy VAD fallback used. See `docs/VOICE_PIPELINE_VERIFICATION.md` for verification steps and limitations.

## Limitations
- **No geometry drivers:** 42 registered concepts have no verified drivers; must remain `not_simulated`. Angles/proportions/contours/asymmetries/deviations often need clarification or new geometry.
- **Illustrative units:** mm/angles/ratios not calibrated to clinical measurements.
- **Research set small:** v1 is targeted (68 rows), not a clinical validation corpus.
- **Real ASR untested:** Quality/latency/noise/mic not measured; needs local model setup.
- **Legacy alias removal:** Could affect older phrasings; review flow handles via clarification.
- **Browser E2E:** No browser-check run against live server in this session (preview failed due to vite args; Chrome present).
- **No bundled assets/geometry changes:** Enforced throughout.

## Geometry-dependent deferred work
- **Hump/length:** Independent dorsal hump reduction and nasal length drivers.
- **Angles:** Nasofrontal, nasolabial, mentolabial, gonial, columellar-lobular angle drivers.
- **Columellar show:** Independent driver (must not alias cheek projection).
- **Deviations/asymmetries:** Laterality/complex geometry for dorsal/septal/alar/chin/jaw/cheek asymmetries.
- **Contours/definitions:** Tip definition, supratip break, dorsal/jawline/midface contour drivers.
- **Proportions:** Calibrated facial thirds/fifths/width/height/symmetry drivers.
- **Alar base/flare:** Independent drivers separate from alar width.
- **Calibrated measurements:** Replace illustrative mm with calibrated clinical measurements.

## Final state
- All required docs created: `CLINICAL_PARAMETER_REGISTRY.md`, `CLINICAL_VOCABULARY.md`, `VOICE_PIPELINE_VERIFICATION.md`, `RESEARCH_EVALUATION_REPORT.md`, `FINAL_VOICESURG_VERIFICATION.md`.
- Full backend and frontend tests passing. TypeScript and build passing. Gold updated honestly. Research evaluation passing with 0 false applications.
- No `backend/tests/gold/utterances.csv` changes. No geometry/topology/reconstruction/MediaPipe changes. No bundled face assets. Working tree has uncommitted changes (as before). No commits/pushes performed.
