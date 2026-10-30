# VoiceSurg 3D: Voice-Controlled Surgical Simulation Prototype

**Disclaimer:** *Prototype for simulation and educational purposes only. Not intended for clinical diagnosis, treatment, or surgical decision-making.*

VoiceSurg 3D is a highly interactive, voice-controlled 3D surgical planning simulator. It allows a user (acting as a surgeon) to issue natural language commands such as *"Reduce the bridge by 2 millimeters"* or *"Increase the upper lip projection by 1 mm"*, which the system parses, validates, and applies deterministically to a stylized 3D anatomical model of a face. 

## Features
- **Real-Time Voice Input:** Integrated with browser Web Speech API for seamless microphone capture.
- **Dual AI Parsing Engine:** Uses a hybrid architecture. Gemini (`gemini-2.5-flash`) extracts clinical intent with complex synonyms via a strict system prompt, with a lightning-fast deterministic Regex parser as a fallback for maximum robustness.
- **Multi-Instruction Commands:** One utterance can contain several instructions ("reduce the bridge by 2 mm and raise the tip by 1 mm"); each is parsed, validated, and shown as its own review card.
- **Strict Safety Validations:** Prevents edge cases, rejects ambiguous or negated commands, requests clarification for missing numerical values, and flags out-of-range requests with a suggested adjusted value instead of silently clamping (lengths ±10 mm, angles ±45°).
- **Multi-Region Parameter Set (17 parameters):** bridge height/width, tip projection/height/rotation and alar width, plus upper/lower lip projection & fullness, chin projection/height/width, jaw width & jawline definition, and cheek projection & fullness, grouped into five selectable region sections (Nose / Lips / Chin / Jawline / Cheeks) whose manual sliders appear when the region is chosen; these mirror the same command pipeline. Regions are deformed independently, so one control does not move another region's landmarks.
- **Interactive 3D Engine:** Built with Three.js and React Three Fiber, always recomputed from an immutable baseline (no drift). The head is a procedurally sculpted face (jaw, forehead, nose, lips, chin, brow) with anatomy meshes for eyes, brows and ears.
- **Two Operating Modes:** **Live Simulation** (manipulation-first: face + sliders + change log) and **Consultation** (the full instruction → review → confirm workflow with timeline and scenarios). Switching modes preserves the current work.
- **Reference Portraits:** Compare the 3D face against bundled portraits or a locally uploaded image, side by side. All reference images stay on-device — nothing is uploaded.
- **In-Memory Consultation Workflow:** A live session tracks a transcript, a reviewable proposal state machine, an event timeline, and named scenarios.
- **Patient-wise Previous Consultations in SQLite:** Every consultation is stored against a patient and surgeon in a local SQLite database (`backend/app/data/voicesurg.db`) — explicit archive, automatic save on end/new, and a debounced save while working. New consultations ask for the patient's identity, independent sessions fully reset patient-scoped state, and the **Previous consultations** panel groups past consultations by patient, shows their summary, and restores the full narrative, identity and simulation state. IndexedDB remains an offline cache/fallback. Stored only on this machine — no cloud, no patient photos.
- **Patient-Specific Face Reconstruction:** Upload front, profile and three-quarter photographs and the app fits a shared 3D shape to them with a real pretrained model (MediaPipe Face Landmarker, 478 landmarks, on-device) against a canonical face mesh, transfers the shape onto the simulation head and shows a reviewable 3D preview before you accept it. On accept, the photographs are also projected onto the deformed mesh through the fitted camera poses, so the simulation head carries the patient's own skin, eyes, brows, lips and hair colour. Dark or small photographs are recovered with an auto-levels/upscale retry before detection. Photos never leave the device and are only visible behind the **View / Change Photos** button. See [`docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md`](docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md).
- **Change-Set Review & History:** Apply a parsed command as a full change set (or consciously apply only the valid subset); undo any entry cleanly by recomputing the historical state stack.
- **Compare & Summarize:** Compare the original, the current state, and any saved scenario side by side (with a parameter-difference table) and export a Markdown consultation summary.
- **Typed Fallback:** A typed-command field provides the same parsing path when a microphone is unavailable.
- **Bounded Latency:** The Gemini call runs under a hard wall-clock ceiling and transparently falls back to the deterministic parser, so the UI can never hang on "Processing…".

See [`docs/FINAL_VERIFICATION_REPORT.md`](docs/FINAL_VERIFICATION_REPORT.md) for the end-to-end verification record and [`docs/FINAL_DEMO_SCRIPT.md`](docs/FINAL_DEMO_SCRIPT.md) for a guided demo. The realistic-face, operating-mode and history features are documented in [`docs/REALISTIC_FACE_IMPLEMENTATION.md`](docs/REALISTIC_FACE_IMPLEMENTATION.md), [`docs/LIVE_SIMULATION_MODE.md`](docs/LIVE_SIMULATION_MODE.md) and [`docs/CONSULTATION_HISTORY_STORAGE.md`](docs/CONSULTATION_HISTORY_STORAGE.md). The patient-specific face reconstruction is documented in [`docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md`](docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md).

**Maintained documentation:** the in-depth handbook for the current working tree starts at [`docs/README.md`](docs/README.md) — architecture, geometry and reconstruction, user guide, developer guide and reference. Older reports above are retained as historical records.

## Architecture & Tech Stack

### Frontend
- **Framework:** React + TypeScript (Vite)
- **3D Graphics:** Three.js, React Three Fiber, `@react-three/drei`
- **Styling:** Vanilla CSS with design tokens (`frontend/src/index.css`) — light clinical workspace
- **Speech Capture:** Native Browser Web Speech API

### Backend
- **Framework:** Python + FastAPI
- **LLM Integration:** Google GenAI API (`gemini-2.5-flash`)
- **Data Validation:** Pydantic (Strict Schema Enforcement)
- **Consultation Archive:** Local SQLite (`sqlite3`, file at `backend/app/data/voicesurg.db`)
- **Environment:** Dedicated `.venv`

---

## Setup Instructions

### Prerequisites
- Node.js (v18+)
- Python (3.10+)

### 1. Environment Variables
In the root directory, open the `.env` file and set your Gemini API key (Required for LLM extraction, though the app will securely fallback to regex if this is missing).
```env
GEMINI_API_KEY="your_api_key_here"
```
The face-reconstruction pipeline does **not** use Gemini or any cloud service — the landmark model, the canonical face mesh and the wasm runtime are bundled in `frontend/public/` and everything runs in the browser.

### 2. Run the Backend (FastAPI)
The backend requires the existing Python virtual environment (`.venv`) at the root level. Open a terminal in the repository root:
```powershell
# From the root directory:
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```
*Note: Ensure it runs on Port 8000.* Check it with `Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing` → `{"status":"ok"}`.

### 3. Run the Frontend (React + Vite)
```powershell
# Open a new terminal, from the root directory:
cd frontend
npm install   # If dependencies aren't installed
npm run dev
```
*The app will automatically launch locally on `http://localhost:5173`.* Open it in Chrome or Edge (the Web Speech API and the MediaPipe face model work best there).

### 4. Production build (optional)
```powershell
cd frontend
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

### 5. Run the tests
```powershell
# Backend
cd backend
..\.venv\Scripts\python.exe -m unittest discover -s tests

# Frontend
cd frontend
npm run fixtures          # regenerate the synthetic test photographs
npm test                  # 28 files / 244 tests
npx tsc --noEmit          # type check
npm run build             # production build

# Real-browser runtime check (starts its own headless Chrome)
npm run build
npm run preview -- --host 127.0.0.1 --port 4173   # keep this running
node scripts/browser-check.mjs http://127.0.0.1:4173/ tests\fixtures
```

Full details, including how to use the photo workflow, are in [`docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md`](docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md) §11.

---

## Example Commands to Try

* "Reduce the bridge by 2 millimeters"
* "Increase tip projection by 1 millimeter"
* "Narrow the bridge by 1 mm"
* "Raise the tip by 2 millimeters"
* "Rotate the tip upward by 5 degrees"
* "Narrow the nostrils by 1 mm"  *(alar width)*
* "Increase the upper lip projection by 1 mm"
* "Add fullness to the lower lip by 1 mm"
* "Reduce the chin projection by 2 mm"
* "Increase jawline definition by 1 mm"
* "Increase cheek fullness by 1 mm"
* "Reduce the bridge by 2 mm and raise the tip by 1 mm"  *(multi-instruction)*

*Safety Test:* Try saying *"Make my nose better"* to see the parser reject non-clinical commands. Try saying *"Raise the tip"* to see the UI safely ask for the missing measurement parameter.

## Known Limitations
- The 3D model is currently a stylized geometric representation, not a true DICOM / patient mesh. With photographs it is reshaped and textured with the patient's own face, but the cranium, ears, hair and neck keep procedural geometry.
- The patient skin texture is a projection of the photographs through the fitted camera poses, so it carries their baked lighting, is limited by their resolution, and fills unseen areas (scalp, back of the head) with sampled skin/hair colours rather than reconstructed detail.
- The five supported regions are smooth geometric deformations of that stylized surface (for example, lip "fullness" is a radial plump and chin height scales about a fixed pivot) — not soft-tissue or osteotomy models.
- Parameter units are illustrative (a 150 mm facial-width reference); bounds are prototype interaction limits, not clinical guidance.
- The working consultation is edited **in memory**, but it is auto-saved to the local SQLite archive and can be restored from **Previous consultations**. The archive is a prototype convenience store, not a clinical record, audit trail, nor a prediction of outcomes.
- The SQLite file lives on the same machine as the backend. It contains structured session data and summaries only, never uploaded photographs; protect it like any other local patient-data file.
- Web Speech API support depends on your specific browser (Chrome / Edge recommended; some Firefox versions require enabling it manually).
- The bundled face detector only recognises faces turned at most about 50° towards the camera, so a true 90° profile photograph is reported as "No face detected"; the reconstruction then runs with fewer views and states the reduced accuracy. Low-exposure or small photographs are retried with auto-levels and upscaling, so darkness alone is usually not a reason to reject a photo.
- This is a localized MVP designed strictly for simulation demos without external database persistence.
