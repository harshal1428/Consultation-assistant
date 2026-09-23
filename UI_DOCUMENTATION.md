# VoiceSurg 3D: UI Documentation & Specifications

This document outlines the detailed user interface (UI) architecture, visual design language, and interactive requirements for the VoiceSurg 3D prototype.

## 1. Visual Design Language
* **Theme:** Professional Medical-AI Dashboard (Dark Mode).
* **Color Palette:**
  * **Backgrounds:** Deep slate / Midnight blue (`#080a0f`, `#0f172a`).
  * **Text:** High-contrast off-whites and muted grays (`#f8fafc`, `#94a3b8`) to reduce eye strain.
  * **Accents:** Clinical blue (`#38bdf8`) for primary actions, Emerald green (`#10b981`) for successes, and Amber/Red (`#f59e0b`, `#ef4444`) for warnings and critical states.
* **Typography:** Modern, clean sans-serif (Inter, -apple-system, system-ui) optimized for legibility of numerical values and clinical terms.
* **Effects:** Glassmorphism (`backdrop-filter: blur(10px)`) applied to the header and footer to give a premium, layered aesthetic.

---

## 2. Layout Structure

The application is built on a responsive, full-screen dashboard layout comprising four main sections:

### A. Top Header (`.top-bar`)
* **Brand Identity:** Logo icon alongside the title **"VoiceSurg 3D"** and the subtitle **"Voice-Controlled Surgical Simulation"**.
* **Workflow Indicator:** A clear visual map of the process: `VOICE → INTENT → PARAMETERS → CONFIRM → SIMULATE`.
* **System Health Indicators:** Three distinct glowing dots (`.status-item`) displaying real-time system readiness:
  1. Speech: Ready (turns red if microphone access is denied).
  2. Parser: Ready (turns red if backend API is unreachable).
  3. 3D Engine: Ready.
* **Global Status:** A pulsing green dot indicating "Simulation Active".

### B. Main Viewport (`.viewport-section`)
* **Placement:** Occupies the primary left/center region of the screen (flex-grow).
* **Styling:** Inset shadows and a subtle gradient background (`#0f172a` to `#0b1120`) to create a "stage" for the 3D model.
* **Content:** Houses the React Three Fiber (`@react-three/drei`) canvas displaying the manipulatable 3D anatomical model.

### C. Right Sidebar (`.sidebar`)
A scrollable, fixed-width (`380px`) command center containing three core panels:

**1. Voice Input Panel**
* Displays the current transcription state.
* Shows a localized loading indicator ("Processing intent...") when awaiting API response.
* Renders clear, red error banners if speech recognition fails.

**2. Demo Mode Panel**
* Provides 5 hardcoded example buttons to ensure demo continuity without a microphone.
* Clicking a button mimics the exact behavior of voice input, routing the text through the API parser.

**3. AI Interpretation Panel (Conditional)**
* *Only appears when a command is actively pending confirmation.*
* Breaks down the structured JSON response into highly readable rows: Target, Parameter, Change, and Confidence.
* **Safety UI:** If the Change value is missing (`null`), it renders a high-visibility yellow warning (`⚠️ Additional measurement required`) and strictly disables the "Apply Change" button.
* Includes side-by-side **Apply Change** (Primary/Blue) and **Cancel** (Secondary/Ghost) buttons.

**4. Command History Panel**
* A reverse-chronological list of all applied transformations.
* Displays the targeted region and the exact numerical delta (e.g., `+2 mm`).
* Features a discrete SVG "Undo" button on every row, allowing surgical state reversal.

### D. Sticky Footer (`.bottom-bar`)
* **Primary Action:** A large, gradient-styled **"🎤 Start Listening"** button. When active, it pulses red with a CSS keyframe animation (`pulse-mic`) and changes text to "Listening...".
* **Secondary Action:** A "Reset Simulation" button to completely clear the model state and history array.
* **Disclaimer:** A required, small-print legal disclaimer stating the application is for educational/simulation purposes only.

---

## 3. Interactive Requirements & States

### Button States
* **Hover:** All buttons must have slight background lightening and border highlights on hover to indicate interactivity.
* **Disabled:** Buttons (specifically "Apply Change" during missing parameters, or "Start Listening" when already listening) must dim to a muted gray (`#64748b`), change cursor to `not-allowed`, and disable hover effects.
* **Active/Pulsing:** Critical active states (Microphone listening, Server active dot) utilize `@keyframes` pulsing to clearly communicate ongoing background processes.

### Fallback & Error Handling
* **Empty States:** The history panel displays "No commands applied yet" when empty. The voice panel displays "Ready for voice command" initially.
* **API Errors:** Network failures or HTTP 422 Unprocessable Entity errors are caught and rendered as inline red alert boxes (`.error-message`) directly inside the sidebar, preventing global application crashes.

### Deterministic State Reversal (Undo Logic)
* The UI requires that clicking an "Undo" button on any history item cleanly removes that command from the React state array and instantly recalculates the visual 3D model properties starting from the base `initialModelState`, ensuring perfect mathematical precision without tracking complex inverse deltas.
