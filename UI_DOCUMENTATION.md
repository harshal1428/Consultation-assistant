# VoiceSurg 3D: UI Documentation & Specifications

Architecture, visual design language, and interactive requirements for the VoiceSurg 3D
prototype.

> Updated for **Phases 2–7**: a light, clinical "consultation workspace" with multi-instruction
> change sets, a 17-parameter multi-region set (nose, lips, chin, jawline, cheeks), and an
> in-memory simulated-consultation workflow (session lifecycle, transcript, proposal state
> machine, event timeline, scenarios and a truthful summary export). See
> `docs/PHASE_2_UI_REPORT.md` … `docs/PHASE_7_REPORT.md`.

---

## 1. Visual Design Language

- **Theme:** professional, light clinical workspace (white / soft-neutral surfaces).
- **Colour tokens** (defined once in `frontend/src/index.css`, consumed by `App.css`):
  - Backgrounds: `--bg #eef1f5`, `--surface #ffffff`, `--surface-2 #f8fafc`, `--surface-3 #f1f5f9`.
  - Text: `--text #0f172a`, `--text-2 #475569`, `--text-3 #94a3b8`.
  - Accent (primary actions, active state): teal `--accent #0f766e` with `--accent-strong`,
    `--accent-soft`, `--accent-border`.
  - Semantic: `--success #047857`, `--warning #b45309`, `--danger #b91c1c`, `--info #1d4ed8`
    (each with `-soft` / `-border` variants).
- **Typography:** Inter → system-ui stack (`--font-sans`), optimized for legibility of numbers
  and clinical terms.
- **Elevation/radius:** `--shadow-sm`, `--shadow-md`, `--radius 12px`, `--radius-sm 8px`.
- **Motion:** all transitions respect `prefers-reduced-motion` (animations disabled).

---

## 2. Layout Structure

A responsive dashboard built with CSS grid (`minmax(0, 1fr) 404px`): a large 3D workspace on the
left and a scrolling consultation column on the right. It stacks to one column at ≤1180px and
relaxes further at ≤720px.

### A. Header (`.app-header`)
- Product title and subtitle.
- **Session label** (start time) plus two status badges:
  - `Active · temporary` / `Ended · temporary` (the session lives only in browser memory).
  - `Simulation prototype` (standing disclaimer).
- **Session controls:** `New consultation`, `End consultation`, `Reset simulation`
  (New is confirmed when unsaved work exists; End and Reset disable once ended).
- **Backend status** indicator driven by `checkBackendHealth()`.

### B. Left column (`.layout__main`)

**1. Simulation workspace (`.workspace`)**
- `ViewerToolbar`: view modes `Original / Simulated / Compare` (default **Simulated**) and
  toggles `Landmarks / Wireframe / Displacement / Reset view`.
- `FaceViewer`: the `@react-three/fiber` canvas hosting `FaceDeformationViewer`, driven purely by
  the `modelState` prop. With **Landmarks** on, colour-coded markers show the clinical reference
  points (nasal set plus upper/lower lip, menton, cheeks and jawline) joined by a sagittal profile
  line running nasion → rhinion → pronasale → subnasale → upper lip → lower lip → pogonion →
  menton.
- In **Compare** mode, two selectors choose any A/B from `Original (baseline)`,
  `Current working`, and each saved scenario; two panes render them and a **parameter
  differences** table shows value A, value B and Δ.

**2. Change history (`.history`)**
- Ordered list of applied commands with region, parameter, signed value, and a source icon
  (voice/manual); a per-item **Undo**; **Save report** (Markdown summary export) and **Reset**
  (report/Reset disabled while there is no history).

**3. Consultation timeline (`.timeline`)**
- Newest-first list of session events (started/ended, proposal created/confirmed/rejected/
  cancelled, manual edit, undo, reset, scenario saved/renamed/deleted/loaded). Labelled
  explicitly as a process log, **not** a clinical audit trail.

**4. Scenarios (`.scenarios`)**
- Save the current state under a name; rename, delete (guarded by a confirmation dialog), load,
  and mark a **final selected scenario** (used by the export).

### C. Right column (`.layout__side`)

**1. Consultation panel (`.consultation`)**
- `VoiceInput`: microphone toggle, language selector, phase chip, and honest "voice unavailable"
  messaging when the Web Speech API is absent.
- `TranscriptView`: interim/final transcript and the processing indicator.
- Typed-command form (`#typed-command`, submit button) — same parsing path as voice.
- Status banners for microphone and parsing-service errors (dismissible).
- **Change-set review** (conditional) — see §3.
- **Transcript log** (`TranscriptLog`): the running record of original utterances with source,
  outcome chip, and the parser's interpretation kept separate from the original text.

**2. Parameters panel (`.parameters`)**
- Seventeen parameters grouped into **Nose** (bridge height/width, tip projection/height/
  rotation, alar width), **Lips** (upper/lower projection, upper/lower fullness), **Chin**
  (projection, height, width), **Jawline** (width, definition) and **Cheeks** (projection,
  fullness), each a `ParameterControl` with slider, live value, "changed" badge and
  per-parameter reset. The registry (`lib/params.ts`) is the single source of truth, so the
  panel can never disagree with the geometry or the parser mapping.
- Manual slider edits are stored as absolute `source: "manual"` commands.

### D. Footer (`.app-footer`)
- Required small-print disclaimer: simulation/educational use only, not for clinical
  decision-making.

---

## 3. Change-Set Review & Safety UI

When a command is parsed, `ChangeSetReview` renders one `InstructionCard` per instruction:

| Element | Behaviour |
|---|---|
| Status chip | `ok` (Ready to apply) · `needs_clarification` · `unsupported` · `invalid` · `no_change` |
| Fields | Region · Parameter · Action · Proposed change · Parser confidence |
| Requested vs applied | Shows the spoken value (e.g. *requested 0.2 cm*) when it differs from the canonical value |
| Clarification | For out-of-range values: **Accept adjusted** (`adjusted_value`); for a missing amount: quick choices or **Custom value** |
| Editing | Inline **Edit** exposes operation / value / unit **and the region + parameter** so an unrecognised instruction can be resolved; **Remove** drops it |
| Footer | **Reject all**, **Apply only valid (N)** (only when mixed), and **Confirm & simulate (N)** |

**Safety rules**
- Nothing is applied until the user confirms.
- **Only `status === "ok"` instructions are applied**; the rest are inert.
- **A change set is applied in full or not at all:** `Confirm` is **disabled** unless every
  instruction is applicable. When only a subset is valid, an explicitly labelled
  **"Apply only valid (N)"** action appears — partial application is always a conscious choice,
  never silent.
- Saving an edit that supplies a missing region/value promotes a `needs_clarification`/
  `unsupported` instruction to `ok` **only** when the target→field mapping is valid, and never
  changes the magnitude implicitly.
- No silent clamping and no invented numbers — the card always explains the verdict via
  `reason`.

---

## 4. Interactive Requirements & States

- **Hover:** buttons lighten slightly and highlight their border.
- **Disabled:** dimmed, `cursor: not-allowed`, no hover effect (e.g. Confirm with a non-full set,
  Send with empty text, mic while processing, all controls once the consultation is ended).
- **Active/pulsing:** the microphone and the backend-active dot use `@keyframes` pulses.
- **Empty states:** history shows "No changes applied yet"; the transcript/timeline/scenarios
  show their own prompts.
- **Errors:** microphone and parsing failures render as inline `.status-message--error` banners
  inside the consultation panel; they never crash the app.
- **Modal:** destructive actions (`ConfirmDialog`) render an accessible
  `role="dialog"`/`aria-modal` overlay; Escape and the backdrop cancel.

---

## 5. Deterministic State Reversal (Undo)

The model is never stored directly. It is derived:

```typescript
const modelState = applyAllCommands(history);
```

Undo removes the targeted command from `history` (and logs an `undo` event) and the model is
recomputed from the base state — perfect precision without tracking inverse deltas. Manual edits
replace the existing manual entry for that parameter rather than stacking.

---

## 6. Simulated Consultation Workflow (Phase 6)

The consultation *narrative* is modelled separately from the applied state, in
`src/scene/session/`:

```
session : ConsultationSession            history : Command[]
  transcript (original text + outcome)     modelState = applyAllCommands(history)
  proposals  (parse + lifecycle)
  events     (append-only log)
  scenarios  (full state snapshots)
```

- **Lifecycle:** `active` → `ended`; reset clears the applied state but keeps the narrative;
  new consultation (confirmed when unsaved work exists) starts a fresh in-memory session.
- **Proposal state machine** (no unreachable states):
  `processing → needs_clarification | ready | blocked | failed → confirmed | rejected | cancelled`.
- **Transcript** preserves the original utterance and shows the interpretation separately.
- **Timeline** coalesces consecutive manual edits to the same parameter into one entry.
- **Export** (`buildConsultationReport`) is built from real session data and lists every
  non-confirmed proposal only as *unresolved* — never as applied.
- **All state is in-memory and temporary**; it is lost on reload and is not a clinical record.

---

## 7. Multi-Region Parameters (Phase 7)

Beyond the nose, four additional regions are simulated, each deformable from both voice commands
and manual sliders:

| Group | Controls |
|---|---|
| **Lips** | upper-lip projection & fullness, lower-lip projection & fullness |
| **Chin** | projection, height, width |
| **Jawline** | width, jawline definition |
| **Cheeks** | projection & fullness (both sides, symmetric) |

- **Independence:** projection and fullness are distinct operations (projection is an anterior
  translation; fullness is a radial plump), and chin width, jaw width and jawline definition are
  separate bands. Tests assert one region's control does not move another region's landmarks
  beyond a documented tolerance.
- **Parser:** the region words (upper/lower lip, chin, jawline, cheek) are supported; a bare
  **"lip"** is treated as ambiguous and asks for upper vs lower; brow/forehead/eyes/ears/mouth
  remain explicitly **not supported** and are refused.
- **Honesty:** the added regions are smooth geometric deformations of the stylized head — the UI
  makes no clinical-accuracy, tissue or outcome claim.
