# Live Simulation Mode (Phase 8 — Objective 3)

## Overview
Two operating modes: **Live Simulation** (instant manipulation-first) and **Consultation** (full instruction→review→confirm workflow). Both share the same canonical `modelState` and `history` array; switching modes never loses or re-derives work.

## Constraints honored
- Consultation workflow (parse, review, apply only valid, confirm, history, scenarios, report) remains fully functional and is the default.
- No provider changes, no rebuild, no clinical claims.
- Parameter registry and transformations unchanged.

## Implementation
### Types
`frontend/src/scene/transformations/types.ts` — added `export type WorkspaceMode = "live" | "consultation"`.

### Header (`frontend/src/components/AppHeader.tsx`)
- New props: `mode: WorkspaceMode`, `onModeChange`.
- Segmented control: "Live Simulation" / "Consultation". `aria-pressed` reflects active mode.
- Mode switch positioned in header; session badges unchanged.

### App (`frontend/src/App.tsx`)
- State: `const [mode, setMode] = useState<WorkspaceMode>("consultation")` (default to preserve existing tests/behavior).
- Layout class `layout--${mode}`.
- **Consultation mode (default):**
  - Main: `SimulationWorkspace`, `ChangeHistory`, `SessionTimeline`, `ScenarioPanel`.
  - Side: `ConsultationPanel`, `ParameterPanel`.
- **Live Simulation mode:**
  - Main: `SimulationWorkspace`, `ChangeHistory`. (Timeline and ScenarioPanel hidden for focus on instant manipulation.)
  - Side: `ParameterPanel`. `ConsultationPanel` is shown only if there is a pending review (`pendingCommands.length>0`) or an error (`speechError`/`apiError`), so no in-progress proposal is lost.
- Tests cover mode switching and review preservation.

## UX notes
- Live mode emphasizes the face + parameter sliders and change log for rapid iteration.
- Consultation mode keeps the full review/reject/confirm surface, scenarios, and report export.
- Reference panel is available in both modes.

## Verification
- App tests include mode switching and preserving an in-progress review in Live mode.
- Live harness `mode_check.mjs` confirms: Consultation default shows input/scenario/timeline; Live hides them but shows workspace/reference/params; switch back restores.
- No console errors.
