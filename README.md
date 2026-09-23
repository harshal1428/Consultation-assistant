# VoiceSurg 3D: Voice-Controlled Surgical Simulation Prototype

**Disclaimer:** *Prototype for simulation and educational purposes only. Not intended for clinical diagnosis, treatment, or surgical decision-making.*

VoiceSurg 3D is a highly interactive, voice-controlled 3D surgical planning simulator. It allows a user (acting as a surgeon) to issue natural language commands such as *"Reduce the bridge by 2 millimeters"*, which the system parses, validates, and applies deterministically to a stylized 3D anatomical model of a nose. 

## Features
- **Real-Time Voice Input:** Integrated with browser Web Speech API for seamless microphone capture.
- **Dual AI Parsing Engine:** Uses a hybrid architecture. Gemini (`gemini-2.5-flash`) extracts clinical intent with complex synonyms via a strict system prompt, with a lightning-fast deterministic Regex parser as a fallback for maximum robustness.
- **Strict Safety Validations:** Prevents edge cases, rejects ambiguous commands, requests clarification for missing numerical values, and physically clamps unsafe extreme transformations (e.g. >20mm). 
- **Interactive 3D Engine:** Built with Three.js and React Three Fiber.
- **Command History:** Undo actions cleanly by recomputing the historical state stack. 
- **Offline / Demo Mode:** Fully functioning fallback buttons if you lack microphone permissions during a live demonstration.

## Architecture & Tech Stack

### Frontend
- **Framework:** React + TypeScript (Vite)
- **3D Graphics:** Three.js, React Three Fiber, `@react-three/drei`
- **Styling:** Vanilla CSS (Dark Mode / Medical Glassmorphism UI)
- **Speech Capture:** Native Browser Web Speech API

### Backend
- **Framework:** Python + FastAPI
- **LLM Integration:** Google GenAI API (`gemini-2.5-flash`)
- **Data Validation:** Pydantic (Strict Schema Enforcement)
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

### 2. Run the Backend (FastAPI)
The backend requires the existing Python virtual environment (`.venv`) at the root level.
```powershell
# From the root directory:
.\.venv\Scripts\uvicorn.exe backend.app.main:app --reload --port 8000
```
*Note: Ensure it runs on Port 8000.*

### 3. Run the Frontend (React + Vite)
```powershell
# Open a new terminal, from the root directory:
cd frontend
npm install   # If dependencies aren't installed
npm run dev
```
*The app will automatically launch locally on `http://localhost:5173`.*

---

## Example Commands to Try

* "Reduce the bridge by 2 millimeters"
* "Increase tip projection by 1 millimeter"
* "Narrow the bridge by 1 mm"
* "Raise the tip by 2 millimeters"
* "Rotate the tip upward by 5 degrees"

*Safety Test:* Try saying *"Make my nose better"* to see the parser reject non-clinical commands. Try saying *"Raise the tip"* to see the UI safely ask for the missing measurement parameter.

## Known Limitations
- The 3D model is currently a stylized geometric representation, not a true DICOM / patient mesh.
- Web Speech API support depends on your specific browser (Chrome / Edge recommended; some Firefox versions require enabling it manually).
- This is a localized MVP designed strictly for simulation demos without external database persistence.
