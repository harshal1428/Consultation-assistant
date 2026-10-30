# Server-based voice input

VoiceSurg has two voice paths:

| Mode | Flag | Path |
| --- | --- | --- |
| `server` (default) | `VITE_VOICE_MODE=server` | Microphone → AudioWorklet → `/ws/voice` → local VAD + ASR → text → existing parse endpoint |
| `legacy` | `VITE_VOICE_MODE=legacy` | Browser Web Speech API (previous behaviour) |

The server path is local and free/open-source. Audio is held in memory for the
current utterance and is **not** written to disk by the normal pipeline. No model
weights are committed. CI uses a fake ASR backend and never downloads models.

## Behaviour in Live mode

`VITE_VOICE_AUTOAPPLY=false` is the default. A voice transcript is sent to the
existing `/api/parse-command` endpoint with `"source": "voice"`, and the result
opens the normal proposal review instead of auto-applying. This is the safe
default for Live simulation.

Set `VITE_VOICE_AUTOAPPLY=true` only for a supervised demo where immediate live
application is intended. Typed live instructions keep their existing
auto-apply behaviour.

The browser never decides geometry. It sends the final text to the single parse
pathway; commitment/live logic remains in the TypeScript live module.

## Frontend controls

- **Start live simulation** opens a continuous microphone stream and sends
  `open_mic`.
- **Hold to talk** uses `ptt_start` / `ptt_end` and works without continuous
  mode. Releasing the pointer sends the buffered audio.
- **Mute microphone** releases the local microphone and sends `mute`; unmute
  sends `unmute`. Press Start again to resume continuous capture.
- The panel shows the cleaned transcript, raw ASR text, lexicon corrections,
  low-confidence numbers, VAD backend and latency.
- Discarded audio (hallucination/no-speech guards) is shown as ignored, never
  forwarded to the parser.

AudioWorklet is the primary capture path (`frontend/src/audio/pcm-worklet.js`).
Browsers without it use `ScriptProcessorNode` as a compatibility fallback. Both
paths convert to mono 16 kHz signed 16-bit PCM in 20 ms chunks.

## Backend pipeline

`backend/app/voice/` contains:

| Module | Responsibility |
| --- | --- |
| `ws.py` | `/ws/voice` session, states, PTT/continuous controls, ASR orchestration |
| `config.py` | Environment defaults |
| `vad.py` | Streaming Silero ONNX wrapper, deterministic energy fallback, segmentation |
| `normalize.py` | Spoken numbers/units → canonical numeric form |
| `correct.py` | Conservative domain lexicon correction and hotwords |
| `hallucination.py` | Empty/stock/repetition/no-speech/compression guards |
| `asr/fake_backend.py` | Deterministic CI/test backend |
| `asr/faster_whisper_backend.py` | Lazy local faster-whisper backend |
| `dev.py` | `DEV_TOOLS=1` gold recorder endpoints |
| `asr_eval.py` | Local WER/CER evaluation on recorded clips |

Protocol (JSON text controls, binary PCM16 frames):

```text
client → server: ptt_start, ptt_end, open_mic, close_mic, mute, unmute, ping
server → client: state {idle|listening|processing|muted},
                 utterance_final, utterance_discarded, error, pong
```

The backend applies the normaliser and lexicon before returning
`utterance_final`. `low_confidence_numbers` is advisory; commitment gating is a
later milestone.

## Configuration

Backend defaults (see `.env.example`):

```text
ASR_BACKEND=faster-whisper
ASR_FW_MODEL=small.en
ASR_DEVICE=auto                 # CPU when CUDA is unavailable
ASR_COMPUTE_TYPE=auto           # int8 on CPU, float16 on CUDA
ASR_LANGUAGE=en
ASR_BEAM_SIZE=5
VAD_END_SILENCE_MS=700
VAD_PRE_ROLL_MS=300
MAX_SEGMENT_S=25
VAD_THRESHOLD=0.5
SILERO_VAD_ONNX=                # empty → energy VAD fallback
ASR_HOTWORDS=                   # empty → built-in lexicon hotwords
ASR_LOW_NUMBER_CONFIDENCE=0.62
DEV_TOOLS=0
```

Frontend defaults (see `frontend/.env.example`):

```text
VITE_VOICE_MODE=server
VITE_VOICE_AUTOAPPLY=false
VITE_API_BASE=http://127.0.0.1:8000
VITE_DEV_TOOLS=false
```

### Real local ASR

```powershell
# from the repository root
.\.venv\Scripts\python.exe -m pip install -r requirements-voice.txt
# optional local Silero VAD model
$env:SILERO_VAD_ONNX = "C:\models\silero_vad.onnx"

# backend (model loads lazily on the first utterance)
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# frontend
cd frontend
npm run dev
```

The faster-whisper model is downloaded on first use into the normal Hugging Face
cache, not the repository. Without CUDA, `auto` resolves to CPU/int8. Model
weights are not bundled, committed, or downloaded by tests/CI.

### Fake ASR (tests and offline development)

```powershell
$env:ASR_BACKEND = "fake"
$env:FAKE_ASR_TEXT = "raise the bridge by two point five millimeters"
```

The fake backend still runs VAD, normalisation, correction and guards.

## Hotwords

`backend/app/voice/lexicon/nasal_terms.json` is the editable domain lexicon. If
`ASR_HOTWORDS` is empty, the backend derives hotwords from it automatically.
`faster-whisper` `hotwords=` is used when supported; older releases fall back to
`initial_prompt="Nasal terms: …"`, which is weaker. Hotword support for the
installed faster-whisper version is **not verified in this environment**.

## Silero VAD and licensing

Silero VAD is MIT-licensed. `onnxruntime` is already a core dependency; the
optional ONNX model file is **not** included. Set `SILERO_VAD_ONNX` to a locally
downloaded model. If it is missing or fails to load, the deterministic energy VAD
runs and the UI reports `energy-fallback`. The wrapper accepts common v4 (`h`/`c`)
and v5 (`state`) ONNX exports, but the exact input format of a downloaded export
has **not been verified here**.

The downloaded model size and the installed faster-whisper/CTranslate2 footprint
depend on the wheel and model variant; they were not measured in this
environment. Plan on hundreds of MB for a real model and keep it outside git.

## Development gold recorder

Enable both flags:

```powershell
# backend
$env:DEV_TOOLS = "1"
# frontend/.env.local
VITE_DEV_TOOLS=true
```

The Live panel then shows **Gold voice recorder**. It loads the deterministic
gold split from `/api/dev/gold-utterances?split=test`, records a selected
utterance, converts it to WAV in the browser and posts it to
`/api/dev/save-clip`. Clips and `manifest.csv` are written to the gitignored
`backend/tests/audio_local/` directory. Do not enable this in production.

Evaluate recorded clips:

```powershell
cd backend
..\.venv\Scripts\python.exe -m app.voice.asr_eval
# machine-readable
..\.venv\Scripts\python.exe -m app.voice.asr_eval --json
```

A manifest row may carry a `hypothesis` column for offline comparison without
running a model.

## Tests

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest -q

cd ..\frontend
npx vitest run
```

The voice tests use the fake backend and mocked `getUserMedia`/WebSocket; they
do not require a microphone, a model, or network access.

## Known limitations

- Real faster-whisper, real Silero ONNX and real microphone latency are not
  verified on this machine.
- Browser decode of `MediaRecorder` output (used only by the dev recorder)
  depends on the browser codec support.
- The ASR evaluation tooling is for local clips; it has no committed audio and
  no CI model run.
- Voice auto-apply is off by default. The later commitment gate still owns
  final semantic safety.
