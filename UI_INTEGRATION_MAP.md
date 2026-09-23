# VoiceSurg 3D: UI Integration & Component Map

This document is designed for developers who want to redesign, replace, or build a entirely new UI on top of the existing VoiceSurg 3D system logic. It maps out where every interactive element currently lives, what state it controls, and the exact API interfaces required to integrate a new UI.

---

## 1. Button Map & Data Flow

### A. Global Footer Actions
**1. Start Listening Button** (`🎤 Start Listening`)
- **Location:** Sticky Footer (`.bottom-bar`)
- **Triggered Function:** `handleStartListening()`
- **Connections:** 
  - Triggers `speechService.startListening()` from `src/services/speech.ts`.
  - **State Changes:** Sets `isListening` to `true`, clears `transcript`, `speechError`, and `apiError`.
  - **Callback Flow:** When speech ends, the audio is converted to text via browser Web Speech API -> text is passed to `parseCommandAPI(text)` -> returns `ParsedCommand` -> sets `pendingCommand` state.

**2. Reset Simulation Button** (`Reset Simulation`)
- **Location:** Sticky Footer (`.bottom-bar`)
- **Triggered Function:** `handleReset()`
- **Connections:**
  - Calls `resetModel()` from `src/scene/transformations/logic.ts`.
  - **State Changes:** Clears `history` array, sets `modelState` to `initialModelState`, clears all transcripts and errors.

### B. Demo Mode Panel
**3. Example Command Buttons** (e.g., `Reduce bridge by 2 mm`)
- **Location:** Right Sidebar (`.demo-panel`)
- **Triggered Function:** `handleExampleCommand(text)`
- **Connections:** 
  - Directly bypasses the microphone and submits hardcoded text strings to `parseCommandAPI(text)`.
  - Identical data flow to the Microphone button after text is acquired.

### C. AI Interpretation Panel (Confirmation)
**4. Apply Change Button**
- **Location:** Right Sidebar (`.clinical-panel`) -> Appears only when `pendingCommand` exists.
- **Triggered Function:** `handleApplyCommand()`
- **Connections:**
  - Pushes the `pendingCommand` into the `history` array.
  - Passes the entire updated history array to `applyAllCommands(history)` in `logic.ts` to deterministically recalculate the 3D model properties.
  - **State Changes:** Updates `modelState`, clears `pendingCommand`.
- **Validation:** Disabled if `pendingCommand.value === null` (Missing numerical measurement).

**5. Cancel Button**
- **Location:** Right Sidebar (`.clinical-panel`) next to Apply.
- **Triggered Function:** `handleCancelCommand()`
- **Connections:** Simply clears the `pendingCommand` state, dismissing the confirmation panel.

### D. Command History
**6. Undo Button (Per Item)**
- **Location:** Right Sidebar (`.history-panel`) -> Rendered iteratively for each item in the `history` array.
- **Triggered Function:** `handleUndo(index)`
- **Connections:**
  - Splices the specific command out of the `history` array.
  - Re-runs `applyAllCommands(newHistory)` on the remaining array to rebuild the 3D model state from scratch.

---

## 2. Integration Guide: Building a New UI

If you want to completely trash the current HTML/CSS and build a new user interface (e.g., using Tailwind, Material-UI, or a completely different layout), you do **not** need to touch the backend or the core 3D math. 

Here is exactly what you need to preserve/connect to make your new UI plug-and-play:

### Step 1: Preserve the Core State (React `useState`)
Your new root component (e.g., `App.tsx`) must maintain these 5 core states to function:
```typescript
const [modelState, setModelState] = useState<ModelState>(initialModelState);
const [history, setHistory] = useState<Command[]>([]);
const [isListening, setIsListening] = useState(false);
const [transcript, setTranscript] = useState("");
const [pendingCommand, setPendingCommand] = useState<Command | null>(null);
```

### Step 2: Use the Isolated Services
Do not write your own fetch calls or microphone logic. Simply import the existing services:
- **API Call:** `import { parseCommandAPI } from './services/api';`
  - *Usage:* `const jsonResult = await parseCommandAPI("text string");`
- **Speech Capture:** `import { speechService } from './services/speech';`
  - *Usage:* `speechService.startListening({ onTranscript: (text) => { ... } })`

### Step 3: Use the Transformation Logic
Do not attempt to manually mutate the 3D model. Use the deterministic functions inside `src/scene/transformations/logic.ts`:
- **Applying State:** Pass your array of commands to `applyAllCommands(historyArray)`. It will return the new mathematical limits for the nose.
- **Updating Viewport:** Pass the resulting state to the `<Viewport modelState={modelState} />` component. The 3D geometry engine inside the Viewport will automatically morph based on those props.

### Architecture Summary for UI Developers:
The system is built on **Unidirectional Data Flow**:
1. Your New UI captures Text (Voice or typing).
2. You pass text to `parseCommandAPI()`.
3. You present the returned `ParsedCommand` JSON to the user in whatever visual way you want.
4. When the user confirms, you push it to an array.
5. You pass that array to `applyAllCommands()`.
6. You pass the output to the `<Viewport>`.

By following this exact unidirectional pipeline, your custom UI will seamlessly integrate with the highly robust Python backend and Three.js engine.
