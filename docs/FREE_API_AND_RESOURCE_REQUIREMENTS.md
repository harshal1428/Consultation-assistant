# VoiceSurg 3D — Free API and Resource Requirements

**Date:** 2024-10-24  
**Status:** Current as of audit date

---

## Cloud APIs Used

### 1. Google Gemini (Generative AI)
- **Purpose:** Semantic fallback parser for complex/ambiguous voice commands
- **Model:** `gemini-2.5-flash`
- **Free Tier (as of 2024-10):**
  - 1,500 requests/day free
  - 1M tokens/month free (input + output)
  - Rate limit: 60 requests/minute
- **Usage Pattern:** Fallback only (deterministic parser handles ~80% of commands)
- **Cost at Scale:** ~$0.000125 per 1K chars input + $0.000375 per 1K chars output beyond free tier
- **Authentication:** `GEMINI_API_KEY` in backend `.env` (never in frontend)
- **Fallback Behavior:** If unavailable/malformed/timeout → deterministic parser result returned
- **Timeout:** 12s hard wall-clock ceiling (SDK 15s + executor 12s)

### 2. Google MediaPipe (Face Landmarker)
- **Purpose:** 478-point 3D facial landmark detection per photo
- **Model:** `face_landmarker.task` (downloaded from MediaPipe)
- **License:** Apache-2.0
- **Execution:** WASM in browser (WebAssembly) — **fully local, no network**
- **Model Size:** ~10 MB (downloaded at build time to `public/models/`)
- **No API key required** — fully offline after model download
- **Performance:** ~50-100ms per image on desktop, ~200-500ms on mobile

### 3. Browser Web Speech API
- **Purpose:** Speech-to-text (ASR) for Live Simulation mode
- **API:** `SpeechRecognition` / `webkitSpeechRecognition`
- **Execution:** Browser-built-in (Chromium uses network service; Safari/Firefox on-device)
- **No API key required**
- **Limitations:**
  - Chromium: Network service (sends audio to Google) — not offline
  - Safari: On-device (since iOS 14/macOS Big Sur)
  - Firefox: Limited support
  - No punctuation control, no speaker diarization
  - Continuous mode restarts every ~300ms after `onend`
- **No cloud cost** — browser-provided

### 4. Browser WebGPU (Optional)
- **Purpose:** Accelerated deformation engine / differentiable rendering (future)
- **API:** `navigator.gpu`
- **Availability:** Chrome 113+, Edge 113+, Firefox 120+ (behind flag), Safari 26+ (TP)
- **Fallback:** CPU path (JavaScript/WASM) always available
- **No API key**

---

## Local Resources (No Cloud)

| Resource | Location | Size | Purpose |
|----------|----------|------|---------|
| MediaPipe Face Landmarker model | `frontend/public/models/face_landmarker.task` | ~10 MB | 478-point 3D face landmarks |
| Canonical Face Model (OBJ) | `frontend/public/models/canonical_face_model.obj` | ~2 MB | 468-vertex template mesh |
| Realistic Head Model (OBJ) | `frontend/public/models/head/head.obj` | ~5 MB | Realistic head mesh (user-supplied) |
| FLAME model (if used) | Not currently bundled | — | Research-only license |

---

## Resource Requirements (Local Development)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Disk | 2 GB (node_modules + models) | 5 GB |
| CPU | 2 cores | 4+ cores |
| GPU | Integrated (Intel UHD 620+) | Discrete (RTX 3060+) for WebGPU |
| Browser | Chrome 113+, Edge 113+, Firefox 120+, Safari 26+ | Chrome 120+ |
| OS | Windows 10+, macOS 12+, Linux | Any |

---

## Network Requirements

| Direction | Endpoint | Protocol | Purpose |
|-----------|----------|----------|---------|
| Frontend → Backend | `http://localhost:8000/api/*` | HTTP/REST | Parse command, calibration, measurements |
| Frontend → Google Gemini | `generativelanguage.googleapis.com` | HTTPS | LLM parsing fallback (backend proxy) |
| Frontend → MediaPipe CDN | `storage.googleapis.com/mediapipe-models` | HTTPS | Model download (once at build) |
| Browser → Google Speech | Google Speech servers | WebSocket | Web Speech API (Chromium only) |

**No patient data leaves the browser** except:
- Text commands → backend `/api/parse-command` (text only)
- Final mesh/texture → backend `/api/save-consultation` (optional, for persistence)

---

## Free Tier Limits & Mitigations

| API | Free Limit | Mitigation |
|-----|------------|------------|
| Gemini | 1,500 req/day, 1M tokens/mo | Deterministic parser handles ~80% of commands; Gemini only for complex/ambiguous |
| MediaPipe | Unlimited (local) | Fully local WASM — no limits |
| Web Speech API | Unlimited (browser-provided) | No quota |
| WebGPU | Hardware-dependent | CPU fallback always available |

**Estimated Gemini Usage:** ~200-500 requests/day in typical clinical use (well within 1,500/day free tier).

---

## No Paid APIs Required

| Feature | Implementation | Cost |
|---------|---------------|------|
| Speech-to-Text | Browser Web Speech API | $0 |
| LLM Parsing Fallback | Gemini (free tier) | $0 within limits |
| Face Landmarks | MediaPipe (local WASM) | $0 |
| 3D Reconstruction | MediaPipe canonical model + bundle adjustment | $0 |
| 3D Rendering | Three.js + WebGL/WebGPU | $0 |
| Storage | IndexedDB (browser) | $0 |

---

## Environment Variables

### Backend (`.env` in `backend/`)
```bash
GEMINI_API_KEY=your_gemini_api_key_here
# Optional:
# GEMINI_MODEL=gemini-2.5-flash
# LLM_TIMEOUT_MS=15000
```

### Frontend
No API keys in frontend. All cloud calls proxied through backend.

---

## Deployment Resource Estimates

### Development (Local)
- Frontend: `npm run dev` → Vite dev server (port 5173)
- Backend: `uvicorn app.main:app --reload` (port 8000)
- Concurrent users: 1 (developer)

### Demo/Staging (Single User)
- 1 vCPU, 2 GB RAM
- 5 GB disk
- ~$5-10/month on any cloud VM

### Production (Multi-user)
- 2+ vCPU, 4+ GB RAM
- Redis for session scaling (optional)
- CDN for model assets
- ~$50-100/month depending on traffic

---

## Licensing Compliance

| Asset | License | Commercial Use | Status |
|-------|---------|----------------|--------|
| MediaPipe Face Landmarker | Apache-2.0 | ✅ Yes | Compliant |
| MediaPipe Canonical Face Model | Apache-2.0 | ✅ Yes | Compliant |
| Three.js | MIT | ✅ Yes | Compliant |
| React Three Fiber | MIT | ✅ Yes | Compliant |
| React | MIT | ✅ Yes | Compliant |
| Tailwind CSS | MIT | ✅ Yes | Compliant |
| Vite | MIT | ✅ Yes | Compliant |
| FastAPI | MIT | ✅ Yes | Compliant |
| Pydantic | MIT | ✅ Yes | Compliant |
| Google GenAI SDK | Apache-2.0 | ✅ Yes | Compliant |
| **FLAME Model** | **Research-only** | ❌ **No** | **NOT USED** (would need license) |
| BFM / Basel Face Model | Research-only | ❌ No | NOT USED |
| Custom PCA Model | Proprietary | ✅ If licensed | **RECOMMENDED PATH** |

**Recommendation:** Build a custom PCA model from a licensed 3D scan dataset (e.g., 3dMD, 3D-SCAN) or obtain FLAME commercial license from MPI-IS.

---

## Security & Privacy

| Aspect | Implementation |
|--------|----------------|
| Patient photos | Never leave browser (IndexedDB only) |
| Landmarks | Computed in-browser (MediaPipe WASM) |
| Text commands | Sent to backend for parsing only |
| Final mesh/texture | Optional save to backend (explicit user action) |
| API keys | Backend `.env` only, never in frontend bundle |
| HTTPS | Required for production (Web Speech API requires secure context) |
| CORS | Configured for localhost dev; restrict in production |

---

## Monitoring & Observability

| Metric | Source |
|--------|--------|
| Parse latency (P50/P95) | Backend logs |
| Gemini fallback rate | Backend logs |
| ASR error rate | Frontend error boundary |
| Reconstruction quality score | `multiViewReconstruction.ts` quality metrics |
| Deformation frame time | `deformation.ts` (debug builds) |

---

## Emergency Fallbacks

| Failure Mode | Fallback |
|--------------|----------|
| Gemini unavailable | Deterministic parser only |
| Web Speech API unavailable | Typed command field |
| WebGPU unavailable | CPU deformation path |
| MediaPipe model fails to load | Error message + retry button |
| Backend down | Offline mode (localStorage only) |

---

## Contact & Support

- **Technical Lead:** [Project Lead]
- **API Issues:** Google Cloud Console → Gemini API
- **MediaPipe Issues:** GitHub `google/mediapipe`
- **Three.js Issues:** GitHub `pmndrs/react-three-fiber`