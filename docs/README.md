# VoiceSurg 3D — Documentation

> **Prototype for simulation and educational purposes only.** VoiceSurg 3D is not a
> medical device, not a diagnostic tool, not an electronic medical record, and not a
> surgical planning system. See [Limitations](USER_GUIDE.md#10-limitations) and
> [`../README.md#known-limitations`](../README.md#known-limitations).

This directory is the documentation hub for the VoiceSurg 3D project: a voice-driven,
browser-based 3D facial-simulation prototype for facial plastic and reconstructive
surgery consultations.

The documentation set below was written against the **working tree** of
2026-10-25 (last committed revision `ad4be75`, plus the in-progress clinical
parameter extension). Where the code and older phase reports disagree, this set
documents the code and calls out the difference.

---

## Start here

| If you are… | Read, in order |
| --- | --- |
| **New to the project** | [Project architecture](ARCHITECTURE.md) → [User guide](USER_GUIDE.md) → [Developer guide](DEVELOPER_GUIDE.md) |
| **A developer joining the codebase** | [Developer guide](DEVELOPER_GUIDE.md) → [Architecture](ARCHITECTURE.md) → [Reference](REFERENCE.md) |
| **Reviewing the 3D science** | [Geometry & reconstruction](GEOMETRY_AND_RECONSTRUCTION.md) → [Reference: parameters](REFERENCE.md#5-parameter-catalogue) |
| **Demoing the prototype** | [User guide](USER_GUIDE.md) → [`FINAL_DEMO_SCRIPT.md`](FINAL_DEMO_SCRIPT.md) |
| **Assessing safety/privacy** | [Architecture §10](ARCHITECTURE.md#10-data-privacy-and-security) → [User guide §8](USER_GUIDE.md#8-privacy-and-data-handling) → [`FREE_API_AND_RESOURCE_REQUIREMENTS.md`](FREE_API_AND_RESOURCE_REQUIREMENTS.md) |
| **Auditing completeness** | [Known gaps](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt) → [`IMPLEMENTATION_AUDIT_REPORT.md`](IMPLEMENTATION_AUDIT_REPORT.md) |

### 60-second quick start

```powershell
# Terminal 1 — backend (from the repository root)
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev        # http://localhost:5173 (Chrome or Edge recommended)
```

The backend has a deterministic offline parser, so the app still works without a
`GEMINI_API_KEY`; the LLM path is an enhancement, not a dependency. Full setup,
environment variables and test commands are in the
[Developer guide](DEVELOPER_GUIDE.md#2-setup-and-daily-workflow).

---

## Handbook (authoritative)

These five documents are the current, maintained description of the system.

| Document | What it covers | Best for |
| --- | --- | --- |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System context, runtime topology, component responsibilities, end-to-end flows, backend parsing/validation design, frontend state model, data contracts, resilience, deployment, design decisions. | Understanding *how the system works end to end*. |
| **[GEOMETRY_AND_RECONSTRUCTION.md](GEOMETRY_AND_RECONSTRUCTION.md)** | Coordinate system and scale, head meshes, region masks, deformation equations, landmarks, heatmap, MediaPipe landmark detection, multi-view bundle-adjustment fit, quality metrics, shape transfer, photo texture projection. | Understanding *the 3D math and the reconstruction pipeline*. |
| **[USER_GUIDE.md](USER_GUIDE.md)** | Operating modes, consultation and live workflows, status vocabulary, parameter panel, scenarios/compare/report, photo workflow, archive, accessibility, troubleshooting, privacy. | Learning *how to use the product* and *what each UI state means*. |
| **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** | Repository map, setup, commands, testing strategy, build and browser check, extension recipes (parameters, regions, geometry), conventions, invariants, known gaps, release checklist. | *Changing or operating the code*. |
| **[REFERENCE.md](REFERENCE.md)** | HTTP API contract, schemas, status semantics, validation matrix, parser grammar and synonyms, target × parameter capability matrix, all 32 parameters with bounds and implementation status, storage schemas, glossary. | *Looking up an exact value, field or rule*. |

Suggested reading order for a full pass:
**ARCHITECTURE → GEOMETRY_AND_RECONSTRUCTION → USER_GUIDE → DEVELOPER_GUIDE → REFERENCE**.

---

## Existing project documents

These documents are retained as historical / phase-specific records. They are
useful context but are **not** fully up to date with the current tree; the handbook
above supersedes them where they conflict.

### Product and UI

| Document | Purpose |
| --- | --- |
| [`../README.md`](../README.md) | Product overview, headline features, setup, example commands, known limitations. |
| [`../PROJECT_OVERVIEW.md`](../PROJECT_OVERVIEW.md) | Original objective, technology stack and end-to-end architecture narrative. |
| [`../UI_DOCUMENTATION.md`](../UI_DOCUMENTATION.md) | UI design language, layout and interactive specifications (Phase 2/6/7 era). |
| [`../UI_INTEGRATION_MAP.md`](../UI_INTEGRATION_MAP.md) | Component/data-flow map and integration contracts for rebuilding the UI. |
| [`FINAL_DEMO_SCRIPT.md`](FINAL_DEMO_SCRIPT.md) | ~8-minute guided demonstration script with pre-flight checks. |

### Phase and implementation reports

| Document | Purpose |
| --- | --- |
| [`PHASE_2_UI_REPORT.md`](PHASE_2_UI_REPORT.md) | Frontend redesign into the clinical consultation workspace. |
| [`PHASE_3_REPORT.md`](PHASE_3_REPORT.md) | Speech → structured-intent contract, validation, deterministic parser, context, multi-instruction UI. |
| [`PHASE_4_REPORT.md`](PHASE_4_REPORT.md) | Volumetric head geometry, coordinate/scale system, immutable-baseline deformation engine. |
| [`PHASE_5_REPORT.md`](PHASE_5_REPORT.md) | Complete nasal parameter set including independent alar width. |
| [`PHASE_6_REPORT.md`](PHASE_6_REPORT.md) | Consultation workflow: session lifecycle, proposals, transcript, timeline, scenarios, summary export. |
| [`PHASE_7_REPORT.md`](PHASE_7_REPORT.md) | 17-parameter, five-region simulation (nose/lips/chin/jawline/cheeks) and independence tests. |
| [`REALISTIC_FACE_IMPLEMENTATION.md`](REALISTIC_FACE_IMPLEMENTATION.md) | Procedural face re-sculpt and anatomy meshes without external assets. |
| [`FACE_RECONSTRUCTION_CORRECTION_REPORT.md`](FACE_RECONSTRUCTION_CORRECTION_REPORT.md) | Identity morph, MediaPipe landmark fitting, photo panel, gallery removal. |
| [`MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md`](MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md) | Multi-photo reconstruction, camera fitting, texture projection, preview/apply, privacy, limitations. |
| [`LIVE_SIMULATION_MODE.md`](LIVE_SIMULATION_MODE.md) | Live Simulation vs Consultation modes sharing one model state and history. |
| [`LIVE_SIMULATION_AND_FACE_CORRECTION_REPORT.md`](LIVE_SIMULATION_AND_FACE_CORRECTION_REPORT.md) | Live-mode and face-geometry corrections (including the duplicate-nose-bulge fix). |
| [`CONSULTATION_HISTORY_STORAGE.md`](CONSULTATION_HISTORY_STORAGE.md) | On-device IndexedDB consultation archive. |

### Verification, audit and resourcing

| Document | Purpose |
| --- | --- |
| [`MILESTONES_1_3_REPORT.md`](MILESTONES_1_3_REPORT.md) | Gold-set baseline, live false-commit measurements, server-voice implementation, verification and risks. |
| [`VOICE.md`](VOICE.md) | Server voice setup, controls, configuration, VAD/hotwords, dev recorder and ASR evaluation. |
| [`FINAL_VERIFICATION_REPORT.md`](FINAL_VERIFICATION_REPORT.md) | Phase 8 end-to-end verification record and demo-readiness verdict. |
| [`IMPLEMENTATION_AUDIT_PLAN.md`](IMPLEMENTATION_AUDIT_PLAN.md) | Audit plan and requirement baseline. |
| [`IMPLEMENTATION_AUDIT_REPORT.md`](IMPLEMENTATION_AUDIT_REPORT.md) | 126-requirement PASS/PARTIAL/FAIL matrix and gap analysis. |
| [`IMPLEMENTATION_TEST_RESULTS.md`](IMPLEMENTATION_TEST_RESULTS.md) | Recorded test results (234 frontend, 36 backend at the time of writing). |
| [`FREE_API_AND_RESOURCE_REQUIREMENTS.md`](FREE_API_AND_RESOURCE_REQUIREMENTS.md) | External API usage, free tiers, licences (Gemini, MediaPipe, Web Speech) and bundled resources. |

---

## Documentation conventions

- **Language:** British spelling in prose (`colour`, `behaviour`), matching the code
  comments. Identifiers and enum values are quoted verbatim (`nasal_bridge`,
  `needs_clarification`).
- **Status vocabulary:** parameters and features are labelled **core** (wired end to
  end), **registered** (declared and visible but not yet driving geometry), or
  **unsupported** (explicitly inert). See
  [Reference §5.1](REFERENCE.md#51-implementation-status).
- **Units:** `mm` and `degrees` are *illustrative simulation units* based on an assumed
  150 mm facial width, not clinically calibrated measurements.
- **Source references:** file paths are relative to the repository root unless stated
  otherwise. Inline `code` is used for exact identifiers.
- **Diagrams:** ASCII diagrams are intentionally dependency-free so they render in any
  Markdown viewer.

## Maintaining this documentation

When a change touches any of the following, update the mapped document in the same
change set:

| Change | Update |
| --- | --- |
| API route, request/response schema, status enum | [REFERENCE.md](REFERENCE.md) + [ARCHITECTURE.md](ARCHITECTURE.md) |
| Parser vocabulary, validation rule, safety policy | [ARCHITECTURE.md](ARCHITECTURE.md#6-backend-design) + [REFERENCE.md](REFERENCE.md#4-validation-rules) |
| Parameter registry, bounds, mapping | [REFERENCE.md](REFERENCE.md#5-parameter-catalogue) + [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md#8-extension-recipes) |
| Geometry, weights, mesh, reconstruction | [GEOMETRY_AND_RECONSTRUCTION.md](GEOMETRY_AND_RECONSTRUCTION.md) |
| UI workflow, component, status label | [USER_GUIDE.md](USER_GUIDE.md) + [ARCHITECTURE.md](ARCHITECTURE.md#7-frontend-design) |
| Test counts, scripts, tooling | [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md#5-testing) |
| New limitation or deliberate non-goal | [DEVELOPER_GUIDE.md §10](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt) + [`../README.md`](../README.md) |
