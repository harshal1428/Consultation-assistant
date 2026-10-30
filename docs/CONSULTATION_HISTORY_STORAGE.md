# Previous Consultations — SQLite Archive

## Overview
Every consultation can be persisted to a local SQLite database and reopened from the
**Previous consultations** panel. The database is the primary archive; the browser's
IndexedDB is retained only as an offline cache/fallback, so the workflow still works when
the FastAPI process is not running.

Nothing is sent to a cloud service. Photographs are never written to the database — only
the structured session, simulation state and generated summary.

## Storage location
- Default file: `backend/app/data/voicesurg.db`
- Override with the `VOICESURG_DB_PATH` environment variable (used by the test suite).
- The file is ignored by git (`.gitignore`).

## Patient and surgeon identity
Each archived consultation belongs to exactly one patient and one surgeon. The patient name
and surgeon name are required before a record is written; the patient id/MRN is optional.
New consultations collect a fresh patient identity, and the previous-consultations panel
groups records by patient (using the patient id when present, otherwise the patient name).

Opening a record restores its patient/surgeon identity along with the session. Creating or
restoring a consultation clears the previous consultation's photos, reconstruction,
personalization, transcript, live events, proposals, scenarios and pending speech, so work
on one patient cannot leak into another.

## What is stored
One row per consultation session (`id` is the session id, so repeated saves update the same
row instead of creating duplicates):

| Field | Meaning |
| --- | --- |
| `label`, `saved_at`, `started_at`, `ended_at`, `status` | Identity and lifecycle |
| `patient_id`, `patient_name`, `surgeon_name` | Owner of the consultation |
| `change_count`, `scenario_count` | Summary counters |
| `model_state` | Full 17-parameter simulation state (JSON) |
| `summary` | Markdown consultation summary (same generator as the export) |
| `personalization` | Derived morph/skin-tone profile, never the photo file |
| `live_events` | Live Simulation change log |
| `transcript`, `proposals`, `events`, `scenarios` | Full narrative snapshot (JSON) |
| `created_at`, `updated_at` | Database timestamps |

## Backend API (`backend/app/main.py`)
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/consultations` | List all records, newest first |
| `GET` | `/api/consultations/{id}` | Read one record |
| `POST` | `/api/consultations` | Insert or update a record |
| `DELETE` | `/api/consultations/{id}` | Delete one record |
| `DELETE` | `/api/consultations` | Clear the archive |

Storage helpers live in `backend/app/consultation_store.py`; the request/response contract is
`ConsultationRecord` in `backend/app/schemas.py`.

## Frontend integration
- `frontend/src/services/consultationApi.ts` — REST client.
- `frontend/src/lib/consultationRepository.ts` — database-first facade. It:
  1. mirrors database records into the local IndexedDB cache for offline reads,
  2. migrates older browser-only archives into SQLite when the backend is reachable,
  3. falls back to the cache when the database is unavailable.
- `frontend/src/components/PatientContextPanel.tsx` — edits the current patient/surgeon
  identity and shows whether the consultation is ready to archive.
- `frontend/src/components/NewConsultationDialog.tsx` — collects a new patient's identity
  before replacing the workspace.
- `frontend/src/components/ConsultationHistoryPanel.tsx` — groups previous consultations by
  patient, shows the storage chip (`SQLite database` / `Browser fallback`), lets the user
  inspect the Markdown summary, restore, delete one, or clear all.
- `frontend/src/lib/patient.ts` — identity validation, normalization and grouping keys.
- `frontend/src/App.tsx`:
  - explicit **Archive current** (only when patient name and surgeon are set),
  - auto-save when a consultation ends,
  - auto-save before a new consultation discards the current one,
  - debounced auto-save while the session is in use (1.2 s),
  - restore re-opens the full narrative (transcript, proposals, events, scenarios) plus the
    simulation state, patient identity and (when present) derived personalization.

## Tests
- `backend/tests/test_consultations.py` — create/list/read/upsert/delete/clear and real
  SQLite file creation on a temporary database.
- `frontend/tests/consultationApi.test.ts` — request shape, listing, delete, clear, errors.
- `frontend/tests/consultationRepository.test.ts` — database-first reads, offline fallback,
  and reconciliation of newer/missing cached records.
- `frontend/tests/historyStore.test.ts` — offline cache fallback semantics remain unchanged.
- `frontend/tests/ConsultationHistoryPanel.test.tsx` — rendering, patient grouping and actions.
- `frontend/tests/patient.test.ts` — identity validation and patient grouping.
- `frontend/tests/NewConsultationDialog.test.tsx` — required fields and new-patient flow.

## Notes
- This is a local prototype archive, not a clinical record, audit trail, or regulatory
  system of record.
- Deleting the database file removes all locally stored consultations.
