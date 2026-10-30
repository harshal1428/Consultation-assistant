# Milestones 1 and 3: gold evaluation and server voice

**Date:** 2026-10-31
**Scope:** validated gold-set evaluation (Milestone 1) and local server-based
voice input (Milestone 3). No deformation, reconstruction, registry or parser
logic was changed.

## Verdict

- **Milestone 1:** implemented, deterministic and reproducible. The live
  false-commit baseline is `0.0000` on all 165 non-command rows.
- **Milestone 3:** implemented with a fake ASR path in tests/CI and a lazy
  faster-whisper path for real local use. Server voice defaults to review before
  apply.
- **Unverified:** a real faster-whisper model, a real Silero ONNX export and real
  microphone latency were not run on this machine. CI uses the fake ASR backend
  and never installs or downloads a speech model.

## Milestone 1: measuring stick

### Dataset and split

| Item | Value |
| --- | --- |
| Source | `backend/tests/gold/utterances.csv` (read-only) |
| SHA-256 | `cb39a1af0cb7e06c89fd1a163d733c07a9ff3cfb49afadd88dc96c3fa4c95abc` |
| Rows | 265 |
| Labels | command 99, `command;width` 1, ignored 74, proposal 59, confirm 8, question 7, reject 7, undo 5, view 5 |
| Commands | 100 |
| Non-command rows | 165 |
| Split | 185 dev / 80 test, seed `20261030`, conversations never cross splits |
| Duplicates | 6 exact duplicates across different conversations; validator warnings, not failures |

Documented repairs: three rows (`sess129:1`, `sess197:1`, `sess248:1`) have
comma shifts. They are repaired in memory by `backend/app/eval/gold_io.py`; the
CSV is never edited, reformatted, re-saved or "fixed".

### Decision source

`would_apply_in_live` comes from the real TypeScript
`frontend/src/scene/live/logic.ts::evaluateLiveInstruction`, exported through
Vitest into `backend/tests/gold/live_decisions.json`. The Python harness reads
that fixture and does **not** reimplement the decision. Parse fixtures are
produced by the real current parse adapter; the LLM path is mocked offline so
runs are deterministic and network-free.

`false_commit_rate` = non-direct-command gold rows that would apply in Live mode
/ all non-direct-command rows.

### Baseline

| Split | Rows | Commands | Non-command | False commits | False-commit rate | Missed | Wrong execution | Applied commands | Slot accuracy | Value MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Overall | 265 | 100 | 165 | 0 | 0.0000 | 0.2600 | 0.1300 | 74 | 68.63% | 0.1013 mm |
| Dev | 185 | 70 | 115 | 0 | 0.0000 | 0.3000 | 0.1429 | 49 | 65.71% | 0.0849 mm |
| Test | 80 | 30 | 50 | 0 | 0.0000 | 0.1667 | 0.1000 | 25 | 75.00% | 0.1346 mm |

Confusion matrix (gold label → system label):

```text
command   → command 74, ignored 26
confirm   → confirm 8
ignored   → ignored 72, confirm 2
proposal  → ignored 54, question 5
question  → question 7
reject    → reject 7
undo      → undo 5
view      → view 5
```

Top failure groups:

- Missed direct commands (26): `sess15:1`, `sess104:1`, `sess106:1`,
  `sess107:1`, `sess108:1`, `sess109:1`, `sess110:1`, `sess123:1`,
  `sess140:1`, `sess143:1`, `sess157:1`, `sess166:1`, `sess167:1`,
  `sess216:1`, `sess219:1`–`sess225:1`, `sess242:1`, `sess246:1`,
  `sess248:1`–`sess250:1`.
- Wrong executions (13): `sess11:1`, `sess59:1`, `sess60:1`,
  `sess101:1`–`sess103:1`, `sess212:1`–`sess214:1`, `sess241:1`,
  `sess243:1`–`sess245:1`.
- No non-command row was applied, so the current commit gate has no measured
  false commits on this set. The strict xfail
  `test_false_commit_rate_is_zero` records that the future speech-act/commitment
  gate has not landed yet.

The committed ratchet baseline is `backend/tests/gold/baseline.json`; generated
`latest.json`/`latest.md` stay gitignored. A regression test fails if metrics get
worse than the baseline. To regenerate fixtures intentionally:

```powershell
cd backend
..\.venv\Scripts\python.exe -m app.eval.cli --export
cd ..\frontend
npx vitest run tests/goldLiveDecisions.test.ts
cd ..\backend
..\.venv\Scripts\python.exe -m app.eval.cli --check
..\.venv\Scripts\python.exe -m app.eval.cli --write-report
```

CI verifies the committed live-decision fixture and runs the live/voice tests
with `ASR_BACKEND=fake`; it never downloads or runs a speech model.

## Milestone 3: server voice

### Path

```text
microphone → AudioWorklet (16 kHz PCM16, 20 ms chunks)
           → /ws/voice
           → streaming VAD + faster-whisper
           → normalisation + lexicon correction + hallucination guards
           → existing /api/parse-command with source="voice"
```

- `VITE_VOICE_MODE=server` is the default; `legacy`/`browser` selects the old
  Web Speech API path.
- `VITE_VOICE_AUTOAPPLY=false` is the default. Live voice opens the normal
  proposal review. Typed live commands keep auto-applying.
- The panel provides continuous capture, hold-to-talk, mute/unmute, raw vs
  cleaned transcript, corrections, low-confidence number hints, VAD backend and
  latency.
- Discarded audio is shown as ignored and is never forwarded to the parser.
- The browser never applies geometry; the existing parser and live decision path
  remain authoritative.

### Backend defaults

```text
ASR_BACKEND=faster-whisper
ASR_FW_MODEL=small.en
ASR_DEVICE=auto
ASR_COMPUTE_TYPE=auto
ASR_LANGUAGE=en
ASR_BEAM_SIZE=5
VAD_END_SILENCE_MS=700
VAD_PRE_ROLL_MS=300
MAX_SEGMENT_S=25
VAD_THRESHOLD=0.5
ASR_HOTWORDS=            # empty → built-in lexicon hotwords
ASR_LOW_NUMBER_CONFIDENCE=0.62
SILERO_VAD_ONNX=         # empty → deterministic energy VAD
DEV_TOOLS=0
```

`auto` resolves to CPU/int8 when CUDA is unavailable (this machine has no CUDA,
Python 3.10.11). Model weights load lazily into the normal Hugging Face cache and
are never committed. `requirements-voice.txt` is optional; core tests use the
fake backend.

### Development recorder and ASR evaluation

Set `DEV_TOOLS=1` on the backend and `VITE_DEV_TOOLS=true` in
`frontend/.env.local`. The Live panel then exposes **Gold voice recorder**:
select a deterministic gold row, record, convert to WAV in the browser and save.
Clips and `manifest.csv` go to gitignored `backend/tests/audio_local/`. Evaluate
with:

```powershell
cd backend
..\.venv\Scripts\python.exe -m app.voice.asr_eval
..\.venv\Scripts\python.exe -m app.voice.asr_eval --json
```

### Licensing and install footprint

- Silero VAD is MIT-licensed; `onnxruntime` is already in the core requirements.
  The ONNX model file is not included and must be downloaded separately.
- faster-whisper, CTranslate2 and Whisper weights are open-source; no weights are
  bundled.
- Exact downloaded model and installed-wheel sizes were **not measured** here.
  Expect hundreds of MB for a real model; keep caches outside git.
- The wrapper accepts common Silero v4/v5 ONNX exports, but the exact input
  format of a downloaded file has not been verified on this machine.

### Hotwords

When `ASR_HOTWORDS` is empty, hotwords are derived from the domain lexicon
(`backend/app/voice/lexicon/nasal_terms.json`). faster-whisper's `hotwords=`
argument is used when available; older releases fall back to `initial_prompt`.
Support for the installed faster-whisper version is not verified.

## Files added or changed

Milestone 1 (committed in `4728823`):

- `backend/app/eval/` — gold IO, current-system adapter, metrics, report, CLI.
- `backend/tests/gold/` — validator, README, split, parse/live fixtures, baseline.
- `backend/tests/test_gold_*` — validator, harness, ratchet, strict xfail.
- `frontend/tests/goldLiveDecisions.test.ts` — real TS live-decision bridge.
- `scripts/run-gold-eval.ps1`, `.github/workflows/ci.yml`.

Milestone 3 backend (committed in `c77cc5c`):

- `backend/app/voice/` — config, VAD, normalisation, correction, hallucination
  guards, WebSocket session, fake ASR, faster-whisper adapter, dev endpoints,
  ASR evaluation CLI.
- `backend/tests/test_voice_*` and `requirements-voice.txt`.

Milestone 3 frontend (this change set):

- `frontend/src/hooks/useServerVoice.ts` — WebSocket, PTT, mute, AudioWorklet /
  ScriptProcessor fallback, dedupe, transcript state.
- `frontend/src/audio/pcm-worklet.js` — PCM16 capture processor.
- `frontend/src/lib/voiceConfig.ts`, `frontend/src/services/api.ts`.
- `frontend/src/components/LiveSimulationPanel.tsx`, `frontend/src/App.tsx`,
  `frontend/src/App.css` — server controls, review gating, transcript display.
- `frontend/src/components/VoiceGoldRecorder.tsx`, `frontend/src/lib/wav.ts` —
  development recorder.
- Frontend tests: `useVoiceCapture`, `voiceServer`, `voiceLiveReview`, `wav`.
- `.env.example`, `frontend/.env.example`, `docs/VOICE.md`, CI voice test list.

## Verification

| Check | Result |
| --- | --- |
| Backend `pytest -q` | **136 passed, 1 xfailed, 118 subtests passed** |
| Frontend full `npx vitest run` | **35 files / 272 tests: 269 passed, 3 pre-existing failures** in `params.test.ts`/`geometry.test.ts` (`alarFlare`/`alarWidth`, descriptor `manual`, `dorsalHumpReduction`); no new failures |
| CI voice/live subset | **7 files, 45 tests passed** |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean; pre-existing >500 kB chunk warning |

The three frontend failures predate this work (recorded in `docs/AUDIT.md`) and
belong to the geometry/registry area intentionally excluded from these
milestones. Existing tests were not edited to make them pass.

Commands:

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest -q

cd ..\frontend
npx tsc --noEmit
npx vitest run
npm run build
```

## Assumptions and risks

- Gold labels are treated as the reference truth. The three comma-shift repairs
  are documented in code; duplicate utterances across conversations are warnings.
- The baseline assumes the exported parse/live fixtures are current; CI checks
  that the live-decision fixture matches the committed gold text.
- `false_commit_rate=0` means *no measured false commit on this gold set*, not
  proof that the current system is safe. The commitment gate remains a later
  milestone and the strict xfail is expected to XPASS when it lands.
- Real ASR quality, real hotword support, Silero input compatibility, browser
  `MediaRecorder` decode and end-to-end latency remain unverified without a real
  model/microphone run on a CPU-only machine.
- Voice auto-apply is intentionally off by default. It must only be enabled in a
  supervised simulation until the commitment gate is implemented.
- No model weights, audio files, secrets or face/head geometry were committed.
