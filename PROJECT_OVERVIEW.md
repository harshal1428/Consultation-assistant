# VoiceSurg 3D — Surgeon Voice-Driven 3D Simulation Platform

## 1. Executive Summary & Objective

**VoiceSurg 3D** is a specialized clinical AI assistant and real-time 3D simulation platform designed for facial plastic and reconstructive surgeons (specifically rhinoplasty consultations).

### Core Objective:
> *"Listen to a surgeon speaking naturally during a patient consultation and convert spoken clinical intent into structured numerical simulation parameters that deform a 3D anatomical face mesh in real time."*

Instead of requiring surgeons to interact with complex CAD gizmos, sliders, or technical 3D modeling interfaces during sterile or client-facing consultations, VoiceSurg 3D provides a hands-free, natural language voice interface backed by rigorous clinical safety constraints and vertex-level anatomical morphing.

---

## 2. Technology Stack

### Frontend Architecture
- **Framework:** React 18 with TypeScript
- **Bundler & Build Tool:** Vite (ESBuild / Rollup)
- **3D Graphics & Rendering Engine:**
  - **Three.js** (WebGL 3D engine)
  - **@react-three/fiber** (Declarative React renderer for Three.js)
  - **@react-three/drei** (Camera controls, HDR environment lighting, procedural grids)
- **Audio & Speech Capture:**
  - **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) for low-latency continuous speech transcription
  - Dynamic audio visualizer animations
- **Styling & Design System:**
  - Modern Clinical Dark UI Design System
  - Glassmorphic panels, CSS tokens, responsive flexbox layout, and high-contrast clinical status indicators

### Backend Architecture
- **Framework:** FastAPI (Python 3.10+)
- **Server:** Uvicorn ASGI Server
- **Data Validation & Schemas:** Pydantic v2
- **AI & NLP Pipeline:**
  - **Google Gemini Generative AI (`google-generativeai`):** Context-aware multi-intent clinical command parsing, anatomical synonym resolution, and follow-up contextual understanding
  - **Deterministic Regex Fallback Engine:** Zero-latency pattern matching engine ensuring offline availability and clinical safety if API keys or networks are offline
- **Environment & Configuration:** `python-dotenv` for local `.env` configuration

---

## 3. System Architecture & End-to-End Flow

```
+-----------------------------------------------------------------------------------+
|                            SURGEON VOICE INTERACTION                              |
|   "Reduce the nasal bridge by 2 millimeters and lift the tip by 1.5 mm"           |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          | (Web Speech API / Microphone)
                                          v
+-----------------------------------------------------------------------------------+
|                              FRONTEND: SPEECH CLIENT                              |
|   - Real-time continuous speech capture                                           |
|   - Transcript visualization & confidence status                                  |
|   - Manual text input fallback option                                             |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          | POST /api/parse-command { text }
                                          v
+-----------------------------------------------------------------------------------+
|                             BACKEND: FASTAPI PIPELINE                             |
|                                                                                   |
|   1. Primary: Gemini LLM Parser (Context-aware prompt, strict JSON response)      |
|   2. Fallback: Deterministic Rule-Based Regex Parser                              |
|   3. Unit Normalization: Convert cm, inches, words -> standardized mm             |
|   4. Anatomical Canonicalization: "dorsum" -> "nasal_bridge", "pronasale" -> "tip"|
|   5. Clinical Safety Range Guard: Clamps excessive values (e.g. > 20 mm, > 45 deg)|
|   6. Ambiguity Detection: Flags relative terms ("slightly") for surgeon review   |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          | Structured JSON Response
                                          v
+-----------------------------------------------------------------------------------+
|                        FRONTEND: CLINICAL CONFIRMATION                            |
|                                                                                   |
|   - Parameter Diff Preview: Previous Value vs. Proposed Value                     |
|   - Clarification Prompts: If ambiguous, surgeon chooses suggested values         |
|   - Explicit Safety Gate: "Confirm All" / "Edit" / "Reject"                       |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          | Surgeon confirms parameters
                                          v
+-----------------------------------------------------------------------------------+
|                  3D REAL-TIME VERTEX DEFORMATION ENGINE (Three.js)                |
|                                                                                   |
|   - Anatomical Face Mesh (Forehead, orbits, dorsum, tip, nostrils, lips, chin)    |
|   - Targeted Gaussian vertex displacement for bridge, tip, and alar width         |
|   - Subnasale pivot angular rotation for nasolabial tip elevation                 |
|   - Real-time Euclidean displacement heatmap (Blue -> Green -> Red)               |
|   - Surgical anatomical landmarks & sagittal profile laser guide                  |
+-----------------------------------------------------------------------------------+
```

---

## 4. Key Features & Capabilities

### 1. Natural Language Voice Consultation
- Hands-free microphone capture designed for operating rooms or consultation desks.
- Handles natural conversational variance (e.g., *"Take 2 mm off the bridge"*, *"Lower the bridge two millimeters"*, *"Reduce dorsal height by 0.2 cm"*).
- Instant browser-based transcription with acoustic waveform feedback.

### 2. Clinical Intent & Parameter Extraction
- Extracts structured multidimensional parameters:
  - **Target:** `nasal_bridge`, `nasal_dorsum`, `nasal_tip`, `nostril_region`
  - **Parameter:** `height`, `width`, `projection`, `rotation`
  - **Operation:** `decrease`, `increase`, `raise`, `lower`, `narrow`, `widen`, `rotate`
  - **Value & Unit:** Normalized to standardized millimeters (`mm`) or degrees (`deg`).
- Multi-command parsing capability: processes compound utterances in a single sentence.

### 3. Anatomical Vocabulary & Synonym Resolution
- Built-in clinical thesaurus mapping everyday and medical terminology:
  - Bridge $\leftrightarrow$ Dorsum $\leftrightarrow$ Nasal bridge $\leftrightarrow$ Radix
  - Tip $\leftrightarrow$ Pronasale $\leftrightarrow$ Supratip $\leftrightarrow$ Nasal tip
  - Nostrils $\leftrightarrow$ Alar base $\leftrightarrow$ Alar flares

### 4. Zero-Guesswork Clarification System
- Medical safety principle: **The AI never invents numerical values.**
- When a surgeon issues a relative instruction (e.g., *"Lift the tip slightly"* or *"Make the bridge a little narrower"*):
  - The system flags `requires_confirmation = true`.
  - Prompts the surgeon with clarification choices (e.g., `+1.0 mm`, `+1.5 mm`, `+2.0 mm`) rather than applying hallucinated edits.

### 5. Procedural 3D Face Mesh with Vertex-Level Deformation
- **Anatomical Face Geometry:** High-resolution parametric mesh modeling organic facial contours:
  - Frontal bone & brow ridge
  - Depressed orbital rims
  - Malar cheekbones
  - Nasal pyramid (radix to columella)
  - Philtral columns, vermilion lips, and pogonion (chin).
- **True Vertex Deformation:**
  - Dorsal corridor vertices deform along normal/sagittal vectors using smooth Gaussian falloffs.
  - Tip vertices translate anteriorly/vertically and rotate around the subnasale pivot point.
- **Surgical Inspection Tools:**
  - **Landmark Guides:** Color-coded 3D spheres on key clinical reference points (Rhinion, Pronasale, Subnasale) joined by a sagittal profile curve.
  - **Mesh Shading / Wireframe Toggle:** Switch between photorealistic skin shading and CAD wireframe inspection.
  - **Displacement Heatmap:** Per-vertex color gradient highlighting where tissue changes are focused.

### 6. Safety Constraints & Audit Trail
- **Simulation Range Guards:** Automatically blocks anatomically impossible values (e.g. `> 20 mm` or `> 45°`).
- **Session History & Rollback:** Every executed modification is logged with original voice text, timestamp, and parameter deltas, allowing one-click undo/reset.
- **Previous Consultations (SQLite):** Each consultation is archived to a local SQLite database on the backend machine (auto-saved on end/new and while working), with a **Previous consultations** panel to review the summary and restore the full session. IndexedDB is only an offline cache fallback.

---

## 5. Project Directory Structure

```
ERI S1/
│
├── backend/                               # Python FastAPI Backend
│   ├── app/
│   │   ├── main.py                        # FastAPI entry point, CORS, routes
│   │   ├── schemas.py                     # Pydantic data models
│   │   ├── parser.py                      # Rule-based fallback regex parser
│   │   ├── llm_parser.py                  # Gemini LLM contextual parser
│   │   └── __init__.py
│   └── tests/                             # Unit tests for clinical parsers
│
├── frontend/                              # React 18 + Vite Frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── FaceDeformationViewer.tsx   # Three.js custom face vertex deformation engine
│   │   │   ├── Viewport.tsx               # 3D Canvas, lighting, orbit controls, toolbar
│   │   │   ├── NoseModel.tsx              # Component model reference
│   │   │   ├── AudioVisualizer.tsx        # Voice waveform visualizer
│   │   │   └── SimulationControls.tsx     # Surgical parameter panel
│   │   ├── scene/
│   │   │   └── transformations/
│   │   │       ├── types.ts               # ModelState, Command, TargetRegion interfaces
│   │   │       └── logic.ts               # State mutation logic & diff calculator
│   │   ├── services/
│   │   │   ├── api.ts                     # Backend REST API client
│   │   │   └── speech.ts                  # Web Speech API voice capture service
│   │   ├── App.tsx                        # Main Surgeon Consultation Workspace
│   │   ├── App.css                        # Clinical styling and layout
│   │   ├── index.css                      # Global design system tokens
│   │   └── main.tsx                       # React application entry point
│   ├── index.html                         # App root document
│   ├── package.json                       # Dependencies (Three.js, React Three Fiber, Vite)
│   └── tsconfig.json                      # TypeScript configuration
│
├── .venv/                                 # Python virtual environment
├── requirements.txt                       # Backend Python dependencies
├── UI_DOCUMENTATION.md                    # Detailed UI architectural notes
└── README.md                              # Project documentation
```

---

## 6. How to Set Up and Run the Platform

### Prerequisites
- **Node.js:** v18+ and `npm`
- **Python:** v3.10+
- **Microphone Access:** Google Chrome or Edge recommended for Web Speech API support.

---

### Step 1: Configure Backend Environment
Create or verify the `.env` file in the project root:
```bash
GEMINI_API_KEY=your_google_gemini_api_key_here
```
*(Note: If no API key is provided, the platform automatically runs using the deterministic rule-based parser).*

---

### Step 2: Start the Backend Server (Terminal 1)

Open PowerShell or Command Prompt at the project root:

```powershell
# 1. Navigate to project root
cd "c:\Users\Admin\OneDrive\Desktop\HM\ERI S1"

# 2. Activate virtual environment
.\.venv\Scripts\activate

# 3. Start the FastAPI server on port 8000
uvicorn backend.app.main:app --reload --port 8000
```
- **Backend API URL:** `http://127.0.0.1:8000`
- **Interactive Swagger Documentation:** `http://127.0.0.1:8000/docs`

---

### Step 3: Start the Frontend Application (Terminal 2)

Open a second terminal window:

```powershell
# 1. Navigate to frontend directory
cd "c:\Users\Admin\OneDrive\Desktop\HM\ERI S1\frontend"

# 2. Start Vite development server
npm run dev
```
- **Application URL:** Open `http://localhost:5173` in your browser.

---

## 7. Example Test Commands

| Utterance | Target | Operation | Extracted Value | Behavior |
| :--- | :--- | :--- | :--- | :--- |
| *"Reduce the bridge by 2 millimeters"* | `nasal_bridge` | `decrease` | `-2.0 mm` | Directly extracted, ready for confirmation |
| *"Lower the dorsum 0.2 cm"* | `nasal_bridge` | `decrease` | `-2.0 mm` | Unit normalized from cm to mm |
| *"Narrow the bridge by 1 mm"* | `nasal_bridge` | `narrow` | `-1.0 mm` | Lateral dorsal narrowing applied |
| *"Lift the tip by 1.5 millimeters"* | `nasal_tip` | `raise` | `+1.5 mm` | Cephalic tip elevation & rotation |
| *"Lift the tip slightly"* | `nasal_tip` | `raise` | `None` | ⚠️ Clarification triggered: displays prompt for mm |
| *"Reduce bridge by 100 mm"* | `nasal_bridge` | `decrease` | `Clamped / Error`| ⚠️ Safety guard triggered: exceeds anatomical limit |
