# VoiceSurg quick audit (2026-10-30)

This audit records the machine, commands, and code paths that Milestones 1 and 3
must integrate with. It was produced by reading the repository and running the
existing suites, not by assuming file names or APIs.

## Machine

| Item | Value |
| --- | --- |
| OS | Microsoft Windows 11 Home Single Language, version 10.0.26200 |
| Python | 3.10.11 (`.venv` at the repository root; the brief says 3.11, so this is a discrepancy) |
| Node / npm | Node v22.15.0 / npm 11.5.2 |
| CPU | 11th Gen Intel(R) Core(TM) i3-1115G4 @ 3.00 GHz, 2 cores / 4 logical processors |
| RAM | 7.75 GB |
| GPU | Intel(R) UHD Graphics (1 GB reported adapter memory; shared memory architecture) |
| CUDA | No `nvidia-smi`; there is no NVIDIA GPU. CUDA/faster-whisper GPU execution is unverified. |
| Free disk on C: | 48.14 GB |

## Existing test commands and baseline result

Backend (from `backend/`):

```powershell
..\.venv\Scripts\python.exe -m pytest -q
```

Before new work, `unittest discover` ran 54 tests. The only failure was
`test_normalizer.py::test_fuzzy_correction_colonel_to_columella`, caused by the
optional `rapidfuzz` dependency not being installed. After installing
`rapidfuzz`, that pre-existing test passes. `pytest` was also not installed; it
was added to the local virtual environment for the new pytest-based tests.

Frontend (from `frontend/`):

```powershell
npx vitest run
```

Baseline: 30 test files, 253 tests, 3 pre-existing failures unrelated to this
session:

- `tests/geometry.test.ts`: `dorsalHumpReduction` produces zero displacement.
- `tests/params.test.ts`: descriptor mapping expects `alarFlare` to map to
  `alarWidth`, and `manual` is false for some descriptors.

The new work must not add failures. The pre-existing failures are left untouched
because they belong to the geometry/registry area, which this milestone must not
change.

## Where voice input lives today

- `frontend/src/services/speech.ts` wraps the browser Web Speech API
  (`SpeechRecognition` / `webkitSpeechRecognition`). It is a browser/network
  service, not an offline model.
- `frontend/src/hooks/useLiveSimulation.ts` drives that wrapper in continuous
  mode for Live Simulation mode.
- `frontend/src/components/VoiceInput.tsx` and
  `frontend/src/components/LiveSimulationPanel.tsx` are the current voice UI.
- A final transcript reaches `frontend/src/services/api.ts::parseCommandAPI`,
  which posts `{ text, context }` to `POST /api/parse-command`.
- The response is a `ParseResponse` (`instructions`, `text`) and becomes
  `Command` objects in the frontend. Existing commands are always created with
  `source: "voice"` by `makeVoiceCommands` in `frontend/src/App.tsx`.

## Backend parse entry point

- HTTP route: `backend/app/main.py::parse_command_endpoint`, `POST
  /api/parse-command`.
- Request schema: `backend/app/schemas.py::CommandRequest`
  (`text: str`, `context: Optional[List[ContextItem]]`).
- Response schema: `ParseResponse` (`instructions: List[Instruction]`,
  `text: str`).
- The route trims text, rejects empty text with HTTP 400, calls
  `parser_service.parse_command(text, context)`, and returns 422 only if no
  instruction was produced.
- `backend/app/parser_service.py::parse_command` always computes the
  deterministic rules result first, returns hard negatives immediately, then
  optionally calls Gemini through `parse_with_llm`, validates with
  `build_instruction`, and falls back to rules on any LLM error.
- `backend/app/parser.py::parse_text` and `backend/app/validation.py` hold the
  lexicon, hard-negative checks, unit normalization, and range checks.

The gold harness forces the LLM path offline with
`unittest.mock.patch.object(parser_service, "parse_with_llm", side_effect=LlmError)`
so evaluation is deterministic and never uses a network or API key.

## Live auto-apply decision

The single source of truth is the TypeScript function
`evaluateLiveInstruction` in `frontend/src/scene/live/logic.ts`. It checks, in
order:

1. `instruction.status === "unsupported"` -> not applied.
2. `adjusted_value` is present -> `out_of_range`, not applied.
3. `status === "needs_clarification"` -> not applied.
4. `status === "invalid"` -> not applied.
5. `status === "no_change"` -> not applied.
6. `instruction.value === null` -> `no_change`, not applied.
7. `paramKeyFor(target, parameter)` returns no model field -> `unsupported`,
   not applied.
8. Applying the command leaves the state unchanged -> `no_change`, not applied.
9. Otherwise -> `applied`.

Milestone 1 does not re-implement this list in Python. The backend exports real
parse results for every gold row; a Vitest test runs the real
`evaluateLiveInstruction` over that fixture and writes
`backend/tests/gold/live_decisions.json`. The Python report merges that file in.
The mapping registry is `frontend/src/lib/params.ts::PARAM_DESCRIPTORS` and
`paramKeyFor`; the deformation engine applies signed magnitudes in
`frontend/src/scene/transformations/logic.ts`.

## Registry and nasal vocabulary

- Frontend registry: `frontend/src/lib/params.ts` (`PARAM_DESCRIPTORS`,
  `PARAM_GROUPS`, `paramKeyFor`). It is the single source of truth for supported
  target/parameter mappings, units, and bounds.
- Backend schema enums: `backend/app/schemas.py` (`TargetRegion`, `Parameter`,
  `Operation`, `Unit`).
- Backend support map: `backend/app/validation.py::TARGET_PARAMETER_MAP`.
- Existing nasal lexicon: `backend/app/data/lexicon.json` (`nasal_terms`,
  `side_words`, `vague_magnitude_words`, hedge/reject/confirm phrases,
  hotwords).
- Parser synonyms: `backend/app/parser.py::TARGET_SYNONYMS`.

Milestone 3's editable voice lexicon lives at
`backend/app/voice/lexicon/nasal_terms.json` and merges the existing registry
terms at load time.

## Risks recorded up front

- The brief says Python 3.11, but the checked-in environment is Python 3.10.11.
- The development machine has no CUDA GPU. `ASR_DEVICE=auto` will select CPU and
  `int8`; the CUDA `float16` path cannot be verified here.
- The frontend registry has three known pre-existing failing tests, so a fully
  green frontend suite is not possible without changing out-of-scope code.
- The gold CSV contains minor schema irregularities (compound labels such as
  `command;width`, and shifted `side`/`note` values in a few rows). They are
  documented and treated structurally rather than edited.
