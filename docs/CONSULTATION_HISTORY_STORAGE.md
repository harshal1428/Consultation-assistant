# Consultation History Storage (Phase 8 — Objective 4)

## Overview
Persistent, on-device storage of consultation records via IndexedDB. Archived consultations survive a page reload and can be restored/deleted. Nothing is uploaded or sent to any external service.

## Constraints honored
- Local-only (IndexedDB). No network writes, no cloud, no AI provider involvement.
- Never claim clinical/audit-trail guarantees beyond the in-memory narrative; stored as a convenience archive.
- Graceful degradation if IndexedDB unavailable (falls back to in-memory Map).

## Implementation
### Store (`frontend/src/lib/historyStore.ts`)
Exports:
- `ArchivedConsultation` interface: `{ id, label, savedAt, startedAt, status, changeCount, scenarioCount, modelState: ModelState, summary: string }`
- `saveArchivedConsultation(record)` — put; falls back to memory on IDB failure.
- `listArchivedConsultations()` — getAll, sorted desc by `savedAt`; fallback.
- `deleteArchivedConsultation(id)` — delete; fallback.
- `clearArchivedConsultations()` — clear; fallback.
- `resetArchivedConsultationsMemory()` — test utility.

DB: `voicesurg-history` (version 1), store `consultations`, keyPath `id`. Uses standard IDB APIs.

### Panel (`frontend/src/components/ConsultationHistoryPanel.tsx`)
- Header "Saved consultations" with "On this device" chip and privacy note.
- "Archive current" button (disabled if `canArchive` false, e.g. nothing to save).
- List of archived items: label, timestamp, change/scenario counts, "Restore" and "Delete".
- "Clear all" when non-empty.
- All actions purely client-side; restores set `history = stateToCommands(modelState)` and append a `consultation_restored` timeline event.

### App integration (`frontend/src/App.tsx`)
- Loads archived list on mount (`useEffect` + `listArchivedConsultations`).
- `handleArchiveConsultation()` builds record from `session`, `history`, `modelState`, `finalScenarioId`; calls `saveArchivedConsultation`, refreshes list, appends `consultation_archived` event, sets notice.
- `handleRestoreArchived(id)` finds record, resets history to its `modelState`, clears selected scenario, appends restored event, sets notice.
- `handleDeleteArchived`/`handleClearArchived` update store and refresh.
- Panel rendered in Consultation mode (main column) after ScenarioPanel.

### Types/Timeline (`frontend/src/scene/session/types.ts`, `frontend/src/components/SessionTimeline.tsx`)
Added event types `consultation_archived` and `consultation_restored` (both render with appropriate icons).

## Tests
- `frontend/tests/historyStore.test.ts` — save/list/sort/overwrite/delete/clear, memory fallback path.
- `frontend/tests/ConsultationHistoryPanel.test.tsx` — rendering, disabled/enabled states, callbacks.

## Verification
- E2E `archive_check.mjs` (via `p8_run.ps1`): set manual parameter → archive → reload (page) → item persists in IndexedDB; restore sets history count; delete clears; no external requests; no console errors.
- FE 128/128 pass. BE 36/36 pass.

## Privacy
IndexedDB storage is local to the browser origin. The bundled reference images remain in `public/reference/` and are never uploaded. Nothing in the archived record is sent to a backend/provider.
