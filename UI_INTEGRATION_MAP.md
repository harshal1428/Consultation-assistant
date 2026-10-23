# VoiceSurg 3D: UI Integration & Component Map

Audience: developers who want to redesign, replace, or rebuild the UI on top of the existing
VoiceSurg 3D system logic. This map shows where every interactive element lives, what state it
controls, and the exact interfaces required to integrate a new UI.

> Updated for **Phase 7** (17 parameters across five regions — nose, lips, chin, jawline, cheeks)
> on top of the Phase 6 in-memory consultation session (transcript, proposal state machine,
> event timeline, scenarios + compare, summary export) and the Phase 3 contract. See
> `docs/PHASE_3_REPORT.md` … `docs/PHASE_7_REPORT.md`.

---

## 1. Component Map & Data Flow

```
App (orchestrator, owns all session state)
├─ AppHeader            title · session label/status · backend status · New / End / Reset
├─ SimulationWorkspace  ViewerToolbar + FaceViewer(s) + compare selectors + parameter diff
│   └─ FaceViewer       @react-three/fiber canvas + FaceDeformationViewer  (props: modelState)
├─ ChangeHistory        applied commands · per-item undo · save report · reset
├─ SessionTimeline      newest-first session events
├─ ScenarioPanel        save / rename / delete / load / select · compare feeding
├─ ConsultationPanel    VoiceInput · TranscriptView · typed form · ChangeSetReview · TranscriptLog
│   ├─ ChangeSetReview  list of InstructionCard + summary + Confirm / Apply-valid / Reject
│   │   └─ InstructionCard  status chip · fields · reason · inline edit (incl. region) · clarify · remove
│   └─ TranscriptLog    original utterances + outcome + separate interpretation
├─ ParameterPanel       17 ParameterControls (Nose / Lips / Chin / Jawline / Cheeks) + per-parameter reset
└─ ConfirmDialog        accessible modal for destructive actions
```

`App.tsx` is the single orchestrator. `SimulationWorkspace` owns viewer-only UI state
(view mode, landmarks/wireframe/displacement toggles, A/B compare selection) and never mutates
the model. The consultation *narrative* lives in `ConsultationSession`; the applied model still
lives in `history` (see §2 Step 1).

### Interactive elements

**1. Voice toggle** (`VoiceInput`, inside `ConsultationPanel`)
- Calls `handleToggleListening()` in `App.tsx` (refused once the session is ended).
- Starts/stops `speechService.startListening({ lang, onTranscript, onError, onEnd })`.
- On a final transcript → `parseText(text, "voice")`.

**2. Typed command form** (`ConsultationPanel`)
- `onSubmitText(text)` → `parseText(text, "typed")` (identical downstream path to voice).

**3. Change-set review** (`ChangeSetReview` + `InstructionCard`) — driven by the **active
proposal's** instructions.
- Per instruction: status chip, region/parameter/action/proposed change, parser confidence,
  reason, inline **Edit** (region, parameter, operation, value, unit), **Remove**, and
  clarification choices.
- **Confirm & simulate (N)** → `handleConfirm("all")`: enabled only when *every* instruction is
  applicable; applies them to `history` and resolves the proposal as `confirmed`.
- **Apply only valid (N)** → `handleConfirm("valid")`: applies the valid subset (a deliberate
  choice when the set is mixed).
- **Reject all** → `handleRejectAll()`: resolves the proposal as `rejected`; nothing applied.

**4. Session controls** (`AppHeader`)
- `handleNewConsultation()` (confirmed when unsaved work exists), `handleEndConsultation()`,
  `handleResetSimulation()` (confirmed when changes exist).

**5. Undo** (`ChangeHistory`, one per item) → `handleUndo(index)`: removes that entry, recomputes
the model, and logs an `undo` event.

**6. Save report / Reset** (`ChangeHistory`) → Markdown consultation summary via
`buildConsultationReport` / clears the applied state.

**7. Parameter sliders** (`ParameterControl`, inside `ParameterPanel`)
- `handleManualChange(key, value)` stores an **absolute** value as a single replaceable
  `source: "manual"` command per parameter, and logs a (coalesced) `manual_edit` event.
- All 17 keys (five regions) flow through the same `onChange(key, value)` handler; the panel only
  changes which keys it surfaces (from `PARAM_GROUPS` / `descriptorsForGroup`).

**8. Scenarios & compare**
- `ScenarioPanel`: `createScenario` / `renameScenario` / `deleteScenario` / load
  (`stateToCommands`) / select; `SimulationWorkspace` compares any two resolvable states.

---

## 2. Integration Guide: Building a New UI

You do **not** need to touch the backend, the 3D math, or the session model internals — reuse the
pure logic and re-render as you wish.

### Step 1: Core state (React `useState` in your root component)

The applied model is never stored directly — it is **derived** from the applied history. The
consultation narrative is a separate, fully in-memory session object:

```typescript
import { useMemo, useState } from "react";
import { applyAllCommands } from "./scene/transformations/logic";
import type { Command } from "./scene/transformations/types";
import { createSession } from "./scene/session";
import type { ConsultationSession } from "./scene/session";

const [history, setHistory] = useState<Command[]>([]);            // applied state (source of truth)
const [session, setSession] = useState<ConsultationSession>(() => createSession()); // narrative
const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
const [editingIndex, setEditingIndex] = useState<number | null>(null);
const [isListening, setIsListening] = useState(false);
const [isProcessing, setIsProcessing] = useState(false);

const modelState = useMemo(() => applyAllCommands(history), [history]);
const activeProposal = session.proposals.find((p) => p.id === activeProposalId) ?? null;
const pendingCommands = activeProposal?.instructions ?? [];
```

`session.ts` is entirely pure: `buildTranscriptEntry`, `buildProposal`, `appendProposal`,
`updateProposal`, `refreshProposalStatus`, `resolveProposal`, `appendEvent`, `createScenario`,
`endSession`, `stateToCommands`, `paramDiff`, `buildConsultationReport`, …

> Async safety: capture the session id (and a request token) before `await`; drop the result if
> the session changed or ended. Guard against double-applying a change set.

### Step 2: Isolated services

- **API:** `import { parseCommandAPI, checkBackendHealth } from "./services/api";`
  - `const { instructions, text } = await parseCommandAPI(text, context);`
  - `context` is an array of `ContextItem` (the last few applied instructions) used only to
    resolve references such as "it"/"that". Send at most the last 4.
- **Speech:** `import { speechService } from "./services/speech";`
  - `speechService.startListening({ onTranscript: (t) => { ... } })`; `speechService.isSupported`.

### Step 3: Transformation logic (never mutate the model by hand)

From `src/scene/transformations/logic.ts`:
- `applyAllCommands(commands)` → `ModelState` derived from the whole history.
- `applyCommand(state, command)` → next `ModelState` for a single command.
- `createManualCommand(key, value)` → an absolute-value manual command.
- `isManualFor(cmd, key)`, `signedMagnitude(cmd)`, `resetModel()`.

Parameter registry (`src/lib/params.ts`): `PARAM_DESCRIPTORS`, `PARAM_GROUPS`, `descriptorFor`,
`paramKeyFor`, `REGION_OPTIONS`, `parametersForRegion`.

### Step 4: Render the 3D view

Pass the derived state straight to the viewer:

```tsx
<FaceViewer modelState={modelState} />
```

The deformation engine (`FaceDeformationViewer.tsx`) morphs automatically from props.

### Architecture summary (unidirectional)

1. UI captures text (voice or typed) → `parseText`.
2. `parseCommandAPI(text, context)` → `ParseResponse { instructions, text }`.
3. Record a transcript entry and a proposal; present the `Command[]` to the user.
4. On confirm, push only `status === "ok"` instructions into `history` and resolve the proposal.
5. `applyAllCommands(history)` computes the model state.
6. Pass it to `<FaceViewer modelState={...} />`.

---

## 3. The `Command` object

`Command extends Instruction` and adds UI/session fields:

```typescript
interface Command extends Instruction {
  id: string;
  source: "voice" | "manual";
  createdAt: number;
}
```

`Instruction` fields: `target, parameter, operation, value, requested_value, requested_unit,
unit, direction, adjusted_value, confidence, requires_confirmation, status, reason,
original_text, parser`. Statuses: `ok | needs_clarification | unsupported | invalid | no_change`.

**Only `status === "ok"` instructions may be applied.** `api.ts` validates the response shape;
`logic.ts` refuses to apply anything that is not `ok`. In the UI, a change set is applied in full
or via the explicit "Apply only valid" action — never silently partially.

---

## 4. What must stay intact

- `src/components/FaceDeformationViewer.tsx` — the 3D engine (do not modify).
- The backend contract in `backend/app/schemas.py` — the single representation that may cross
  the API boundary.
- Deterministic derivation (`modelState = applyAllCommands(history)`) — undo/replace stay exact
  without tracking inverse deltas.
- The session model is **in-memory only** — no database, auth, or EMR may be implied.
