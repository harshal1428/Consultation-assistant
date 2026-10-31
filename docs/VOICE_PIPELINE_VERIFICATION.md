# Voice Pipeline Verification

**Voice paths:** `server` (default, AudioWorklet → WebSocket `/ws/voice`) and `legacy` (Web Speech API).  
**Live behavior:** `VITE_VOICE_AUTOAPPLY=false` by default; voice transcripts go through `parse-command` with `source: "voice"` and open review-first.  
**CI:** `ASR_BACKEND=fake`, no speech models downloaded/run.  
**Privacy:** Audio held in memory for current utterance, not written to disk by normal pipeline; no model weights committed; API keys never exposed client-side.

## Architecture

| Component | Location | Role |
| --- | --- | --- |
| AudioWorklet capture | `frontend/src/worklets/pcm-worklet.ts`, `frontend/src/hooks/useVoiceCapture.ts` | Resamples/captures PCM16 mono @ 16kHz. |
| WebSocket voice | `frontend/src/services/voiceSocket.ts`, `backend/app/voice/ws.py` | Streams frames, receives segments. |
| VAD | `backend/app/voice/vad.py` | Deterministic energy VAD (fallback). Silero ONNX optional via `SILERO_VAD_ONNX`. |
| ASR | `backend/app/voice/asr/*` | `faster-whisper` backend (optional). `fake` backend for tests/CI. |
| Normalization | `backend/app/voice/normalize.py` | Text normalization for voice. |
| Parsing | `backend/app/parser_service.py`, `backend/app/parser.py` | Rules-first, clinical registry, validation, LLM fallback (Gemini) with hard negatives. |
| Live integration | `frontend/src/scene/live/logic.ts`, `frontend/src/App.tsx` | Review-first gating, commitment logic. Same hook for consultation/Live. |

## Configuration (env)

**Backend:**
- `ASR_BACKEND` = `faster-whisper` (default) or `fake` (CI)
- `ASR_FW_MODEL` = `small.en` (default)
- `ASR_DEVICE` = `auto`, `ASR_COMPUTE_TYPE` = `auto`
- `ASR_LANGUAGE` = `en`, `ASR_BEAM_SIZE` = `5`
- `ASR_HOTWORDS` = optional additions to lexicon
- `VAD_END_SILENCE_MS` = `700`, `VAD_PRE_ROLL_MS` = `300`, `MAX_SEGMENT_S` = `25`, `VAD_THRESHOLD` = `0.5`
- `SILERO_VAD_ONNX` = path to Silero ONNX (optional; empty → energy VAD)
- `DEV_TOOLS` = gold recorder endpoints (dev only)

**Frontend:**
- `VITE_VOICE_MODE` = `server` (default) or `legacy`
- `VITE_VOICE_AUTOAPPLY` = `false` (default) or `true`

## Verification performed (this session)

### Tests run
**Backend (full):** `python -m pytest -q` (from `backend/`)  
Result: **164 passed, 1 xfailed, 1 warning, 164 subtests passed** (28.07s)

**Backend voice subset:** `pytest -q tests/test_voice_asr_eval.py tests/test_voice_dev.py tests/test_voice_hallucination.py tests/test_voice_normalize.py tests/test_voice_vad.py tests/test_voice_ws.py`  
Result: **52 passed, 1 warning, 118 subtests passed** (3.77s)

**Frontend (full):** `npx vitest run` (from `frontend/`)  
Result: **35 test files passed, 280 tests passed** (93.72s)

**Frontend CI voice subset:** `npx vitest run tests/goldLiveDecisions.test.ts tests/live.test.ts tests/LiveSimulationPanel.test.tsx tests/useVoiceCapture.test.tsx tests/voiceServer.test.tsx tests/voiceLiveReview.test.tsx tests/wav.test.ts`  
Result: **7 test files passed, 46 tests passed** (43.11s)

**TypeScript:** `npx tsc --noEmit` — passed  
**Build:** `npm run build` — passed (vite build succeeded)

### Key behaviors verified
- Voice transcripts parsed via `parseText(text, "voice")` path.
- Live review-first gating (auto-apply only if `VITE_VOICE_AUTOAPPLY=true`).
- Hallucination guards in voice pipeline (tested).
- Fake ASR used in tests; no model downloads.
- Registry/honesty: registered-only concepts return `not_simulated`, never aliased to simulated.
- Ambiguity preserved for review (clinical concepts, lips, rotation direction, contradictions).
- Consultation uses same `useServerVoice` hook in server mode.
- PDF/Markdown reports include illustrative units disclosure and registered-but-not-simulated list.

## Real-voice verification (not performed / blocked)

The following could **not** be verified in this environment:
- **Real ASR inference**: `faster_whisper` package not installed in current venv. Optional deps in `requirements-voice.txt` not installed.
- **Model weights**: No local ASR/VAD model files present. First run would download weights (not committed).
- **Silero VAD ONNX**: `SILERO_VAD_ONNX` not configured; using deterministic energy VAD fallback.
- **Microphone/hardware**: No physical microphone or browser microphone E2E available in headless environment.
- **Latency/decoding**: MediaRecorder/Opus decoding and real-time latency not measured.
- **Hotword behavior**: Not tested with real models.
- **Network**: No external services used; fully offline-capable with fake ASR.

### How to verify with real models (local, free/open-source)
1. Install optional deps: `pip install -r requirements-voice.txt` (backend)
2. Configure `.env`: set `ASR_BACKEND=faster-whisper`, choose model (`small.en` etc.), optionally set `SILERO_VAD_ONNX` to downloaded Silero ONNX
3. Start backend/frontend with `VITE_VOICE_MODE=server`, `VITE_VOICE_AUTOAPPLY=false`
4. Use microphone in browser; test with gold-like phrases and registered-only phrases
5. Verify: review cards show correct `clinical_parameter`, `not_simulated` for non-simulated concepts, no silent mesh application
6. Check logs for ASR/VAD; ensure no audio written to disk

**Note:** Model weights are downloaded on first use and must not be committed.

## CI voice subset
GitHub Actions (`.github/workflows/ci.yml`):
- Backend: installs `requirements.txt -r requirements-dev.txt`, runs `pytest -q` with `ASR_BACKEND=fake`
- Frontend: sets `VITE_VOICE_MODE=server`, `VITE_VOICE_AUTOAPPLY=false`, runs gold fixture check, then voice/live subset tests, then build

## Known limitations
- Real ASR quality/latency unverified in this run.
- Some accents/noise conditions not tested.
- Hotword tuning may be needed for clinical terms.
- Energy VAD may segment differently than Silero in noisy environments.
- Browser compatibility for AudioWorklet/MediaRecorder varies.
- No calibration between illustrative mm and clinical measurements.
