# VoiceSurg 3D — Reference

> **Prototype for simulation and educational purposes only.** VoiceSurg 3D is not a
> medical device, not a diagnostic tool, not an electronic medical record and not a
> surgical planning system. Bounds and units in this document are illustrative
> simulation limits, not clinical measurements. See
> [Architecture §10](ARCHITECTURE.md#10-data-privacy-and-security) and
> [`../README.md#known-limitations`](../README.md#known-limitations).

This is the lookup document for VoiceSurg 3D. It records the exact HTTP contract,
the TypeScript and Python schemas, every validation verdict, the full parameter
registry, the parser lexicon, the storage records and the vocabulary used across the
other handbooks. It is intentionally exhaustive and repetitive: when you need to
know *which* string, *which* bound or *which* field is authoritative, this is the
page to check.

It describes the working tree of 2026-10-25 (last commit `ad4be75` plus the
in-progress clinical-parameter extension). Where an older phase report disagrees
with the code, this document follows the code and says so.

Related documents:

- [Architecture](ARCHITECTURE.md) — how the pieces fit together.
- [Geometry and reconstruction](GEOMETRY_AND_RECONSTRUCTION.md) — what the numbers do to the mesh.
- [User guide](USER_GUIDE.md) — what a clinician sees.
- [Developer guide](DEVELOPER_GUIDE.md) — how to change and test the system.

---

## Contents

1. [Conventions and sources of truth](#1-conventions-and-sources-of-truth)
2. [HTTP API](#2-http-api)
3. [Schemas](#3-schemas)
4. [Validation rules](#4-validation-rules)
5. [Parameter catalogue](#5-parameter-catalogue)
   - [5.1 Implementation status](#51-implementation-status)
6. [Parser grammar and synonyms](#6-parser-grammar-and-synonyms)
7. [Target × parameter capability matrix](#7-target--parameter-capability-matrix)
8. [Command mapping and state semantics](#8-command-mapping-and-state-semantics)
9. [Storage schemas](#9-storage-schemas)
10. [Glossary](#10-glossary)
11. [Symbol and file index](#11-symbol-and-file-index)

---

## 1. Conventions and sources of truth

### 1.1 Notation

| Notation | Meaning |
| --- | --- |
| `—` | Not applicable, or not present in this build. |
| `null` | An explicit JSON `null`, distinct from a missing key. |
| **core** | Parameter is declared, manually adjustable, and read by the geometry engine. |
| **registered** | Parameter is declared and appears in the panel, but the geometry engine does not read it. |
| **unsupported** | Parameter is declared with `supported: false`; it is inert by design. |
| `mm` / `degrees` | Illustrative simulation units. Angles are converted with `Math.PI / 180`; lengths with the scene scale described in [Geometry §1](GEOMETRY_AND_RECONSTRUCTION.md#1-coordinate-system-scale-and-invariants). |
| ≤ / ≥ | Inclusive bounds. |

Enumerations are quoted exactly as they appear on the wire (`snake_case`, lower
case). Prose uses British spelling; identifiers are never re-spelled.

### 1.2 Files that define the contract

| Concern | Authoritative file |
| --- | --- |
| HTTP routes, CORS, status codes | `backend/app/main.py` |
| Pydantic request/response models and enums | `backend/app/schemas.py` |
| Bounds, unit rules, target/parameter allow-list, verdicts | `backend/app/validation.py` |
| Deterministic lexicon, segmentation, negation, context, contradictions | `backend/app/parser.py` |
| Rules → optional LLM → validation orchestration | `backend/app/parser_service.py` |
| Gemini prompt and raw-output extraction | `backend/app/llm_parser.py` |
| Frontend wire types and model state | `frontend/src/scene/transformations/types.ts` |
| Parameter registry, groups, `paramKeyFor` | `frontend/src/lib/params.ts` |
| Command application, manual commands, replay | `frontend/src/scene/transformations/logic.ts` |
| Live-mode gating and change log | `frontend/src/scene/live/logic.ts`, `frontend/src/scene/live/types.ts` |
| Consultation session, proposals, scenarios, report | `frontend/src/scene/session/types.ts`, `frontend/src/scene/session/logic.ts` |
| On-device archive | `frontend/src/lib/historyStore.ts` |
| Client API timeouts and error text | `frontend/src/services/api.ts` |
| Status labels used in the UI | `frontend/src/lib/format.ts` |

When the backend contract changes, change `schemas.py` **and**
`frontend/src/scene/transformations/types.ts` together, then update this page and
[Developer guide §8](DEVELOPER_GUIDE.md#8-extension-recipes).

---

## 2. HTTP API

### 2.1 Runtime facts

| Property | Value |
| --- | --- |
| Framework | FastAPI, served by Uvicorn |
| Default bind | `127.0.0.1:8000` (the frontend hard-codes `http://127.0.0.1:8000`) |
| State | Stateless. No database, no session, no authentication, no request log persisted. |
| CORS | `allow_origins=["*"]`, `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]` |
| Request body limit | None configured at the application layer. |
| Rate limiting | None. |
| Authentication | None. Do not expose the process beyond loopback. |

Because the server is stateless, restarting it never loses simulation work: the
browser owns the model state, command history, scenarios and archive.

### 2.2 Routes

| Method | Path | Request | Success response | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | — | `200 {"status": "ok"}` | Liveness alias. |
| `GET` | `/api/health` | — | `200 {"status": "ok"}` | Liveness probe used by the header indicator. |
| `POST` | `/api/parse-command` | [`CommandRequest`](#31-commandrequest) | `200` [`ParseResponse`](#35-parseresponse) | Parse text into validated instructions. |
| `GET` | `/docs` | — | Swagger UI | Framework-provided interactive documentation. |
| `GET` | `/openapi.json` | — | OpenAPI 3 document | Framework-provided machine schema. |

There are no other application routes. Both health routes return the same body and
have no response model, so they perform no validation beyond routing.

### 2.3 `POST /api/parse-command`

Request:

```http
POST /api/parse-command HTTP/1.1
Host: 127.0.0.1:8000
Content-Type: application/json

{
  "text": "Reduce the nasal bridge by 2 mm and raise the tip by 1 mm",
  "context": [
    {
      "target": "nasal_tip",
      "parameter": "height",
      "operation": "increase",
      "value": 1,
      "unit": "mm"
    }
  ]
}
```

Both keys are read as Pydantic fields. `text` is required by type; `context` is
optional. The handler strips `text`; a blank or whitespace-only string is rejected
before parsing:

```json
{
  "instructions": [
    {
      "target": "nasal_bridge",
      "parameter": "height",
      "operation": "decrease",
      "value": 2.0,
      "requested_value": 2.0,
      "requested_unit": "mm",
      "unit": "mm",
      "direction": null,
      "adjusted_value": null,
      "confidence": 0.95,
      "requires_confirmation": true,
      "status": "ok",
      "reason": null,
      "original_text": "Reduce the nasal bridge by 2 mm",
      "parser": "rules"
    },
    {
      "target": "nasal_tip",
      "parameter": "height",
      "operation": "raise",
      "value": 1.0,
      "requested_value": 1.0,
      "requested_unit": "mm",
      "unit": "mm",
      "direction": "up",
      "adjusted_value": null,
      "confidence": 0.95,
      "requires_confirmation": true,
      "status": "ok",
      "reason": null,
      "original_text": "raise the tip by 1 mm",
      "parser": "rules"
    }
  ],
  "text": "Reduce the nasal bridge by 2 mm and raise the tip by 1 mm"
}
```

`parser` is `"rules"` when the deterministic path answered, `"llm"` when Gemini
produced the accepted result. The array order matches spoken order, except that a
self-correction replaces the clause it supersedes.

### 2.4 Error responses

| Status | Condition | Body `detail` |
| --- | --- | --- |
| `400` | `text` is empty after `strip()` | `"Command text cannot be empty"` |
| `422` | Request body fails FastAPI validation, e.g. missing `text`, wrong JSON type, invalid `context` member | FastAPI array of validation objects |
| `422` | The parser produced no instructions at all (defensive; not observed for non-empty text) | `"Could not extract any instruction from the command"` |
| `500` | Unhandled server exception | FastAPI default error body |
| — | Network failure, DNS failure or client abort | No response; the frontend synthesises a message |

The two `422` shapes are different: the explicit HTTP exception sends a string,
FastAPI body validation sends an array. The client surfaces `detail` verbatim when
present, so the UI may display the stringified array in the rare body-validation
case.

### 2.5 Client-side behaviour

| Behaviour | Value | Source |
| --- | --- | --- |
| Parse request timeout | 20 s, then `AbortController.abort()` | `frontend/src/services/api.ts` |
| Timeout message | `"The parsing service took too long to respond. Please try again."` | same |
| Connection message | `"Could not reach the parsing service. Check that the backend is running on port 8000."` | same |
| Unexpected payload message | `"Parsing service returned an unexpected response shape."` | same |
| Response shape check | Object with an `instructions` array | same |
| Context sent | Last 4 items (`context.slice(-4)`) | same |
| Health probe timeout | 4 s | same |
| Health poll interval | 15 s | `frontend/src/App.tsx` |
| API base | Hard-coded `http://127.0.0.1:8000`; no environment override | same |

### 2.6 Invariants

1. Every instruction that carries an applicable numeric value has passed **the
   same** `build_instruction` path, whether it came from rules or from Gemini.
   Parser-level hard negatives (negation, unsupported region or unit, bare lip,
   missing rotation direction, single-clause contradiction) are constructed
   directly with an explicit non-applicable status; cross-clause contradictions
   are validated results whose status is later rewritten by `flag_contradictions`.
2. The backend never returns a numeric value it invented; a missing or qualitative
   amount becomes `null` plus a clarification status.
3. The backend never applies, clamps or stores anything. `adjusted_value` is a
   *suggestion*; the frontend decides whether to accept it.
4. `context` is never persisted and never echoed back.
5. The response `text` is the stripped request text, not the concatenated
   `original_text` values.

---

## 3. Schemas

### 3.1 `CommandRequest`

Python: `backend/app/schemas.py` · TypeScript: `frontend/src/scene/transformations/types.ts`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `text` | `string` | Yes | — | Free-form spoken or typed instruction. Trimmed by the handler. |
| `context` | `ContextItem[]` | No | `null` | At most the last four applied instructions; the server truncates with `[-4:]`. |

### 3.2 `ContextItem`

| Field | Type | Nullable | Notes |
| --- | --- | --- | --- |
| `target` | `TargetRegion` | Yes | Region of a previously applied instruction. |
| `parameter` | `Parameter` | Yes | Parameter of that instruction. |
| `operation` | `Operation` | Yes | Operation of that instruction. |
| `value` | `number` | Yes | Normalised magnitude, in `unit`. |
| `unit` | `Unit` | Yes | Canonical unit of `value`. |

Context is used only to resolve pronouns (`it`, `that`, `this`, `those`, `these`)
and self-corrections. It is not used to replay state.

### 3.3 `Instruction`

| Field | Type | Nullable | Constraints | Meaning |
| --- | --- | --- | --- | --- |
| `target` | `TargetRegion` | Yes | Enum below | Anatomical region, or `null` when not identified. |
| `parameter` | `Parameter` | Yes | Enum below | Geometric parameter, or `null`. |
| `operation` | `Operation` | Yes | Enum below | Signed action, or `null`. |
| `value` | `number` | Yes | Non-negative | Normalised magnitude in `unit`. `null` when no usable amount exists. |
| `requested_value` | `number` | Yes | Any float | Magnitude exactly as requested, in `requested_unit`, before conversion or adjustment. |
| `requested_unit` | `Unit` | Yes | Enum below | Unit as requested. May be `cm`. |
| `unit` | `Unit` | Yes | `mm` or `degrees` | Canonical unit for the parameter. |
| `direction` | `string` | Yes | `"up"` / `"down"` | Only meaningful for `rotate`; the parser also emits it for raise/lower phrases. |
| `adjusted_value` | `number` | Yes | Non-negative | Suggested in-range replacement when `value` exceeds the limit. Never applied silently. |
| `confidence` | `number` | No | 0.0–1.0 inclusive | Parser confidence; not a calibrated probability. |
| `requires_confirmation` | `boolean` | No | Default `true` | Advisory only. The frontend gates on `status`, not on this flag. |
| `status` | `InstructionStatus` | No | Enum below | Validation verdict; the only authority on applicability. |
| `reason` | `string` | Yes | — | Human-readable explanation for non-`ok` verdicts, or a context/correction note for `ok`. |
| `original_text` | `string` | No | — | Clause that produced this instruction. For LLM output, defaults to the whole request. |
| `parser` | `ParserSource` | No | `rules` / `llm` | Which path produced the accepted result. |

#### Field population rules

- `value` and `requested_value` diverge only for unit conversion (`cm` → `mm`) or
  when the raw LLM output supplied both separately.
- `requested_unit` remains whatever was spoken; `unit` is always canonical after
  validation.
- `adjusted_value` is set **only** for the over-limit case. It is not a clamp and
  does not accompany `ok`.
- On a hard negative or ambiguity produced directly by the rules parser,
  `requires_confirmation` is `false`; on validation-derived verdicts it is usually
  `true`. Treat the flag as display metadata.
- `direction` is `"up"` or `"down"`, never `"upward"` or `"cephalic"`; synonym
  normalisation happens in the parser.

### 3.4 Enumerations

#### `TargetRegion` — 14 values

| Value | In backend map? | Descriptor target? | Re-target option? |
| --- | --- | --- | --- |
| `nasal_bridge` | Yes | Yes | Yes |
| `nasal_dorsum` | Yes | No | Yes |
| `nasal_tip` | Yes | Yes | Yes |
| `nostril_region` | Yes | Yes | Yes |
| `upper_lip` | Yes | Yes | Yes |
| `lower_lip` | Yes | Yes | Yes |
| `chin` | Yes | Yes | Yes |
| `jawline` | Yes | Yes | Yes |
| `cheek` | Yes | Yes | Yes |
| `nasal_base` | No | No | Yes |
| `columella` | No | No | Yes |
| `septal_region` | No | No | Yes |
| `left_side` | No | No | Yes |
| `right_side` | No | No | Yes |

The first nine appear in `TARGET_PARAMETER_MAP`. Eight regions are used as
descriptor `target` values; `nasal_dorsum` shares the bridge fields but has no
descriptor of its own. All 14 appear in `REGION_OPTIONS`, the frontend's re-target
list, even though the last five have no supported parameters.

#### `Parameter` — 6 values

`height`, `width`, `projection`, `rotation`, `fullness`, `definition`.

#### `Operation` — 7 values

| Value | Sign in `applyCommand` | Notes |
| --- | --- | --- |
| `increase` | `+` | Generic augmentation. |
| `decrease` | `−` | Generic reduction. |
| `widen` | `+` | Width-specific increase. |
| `narrow` | `−` | Width-specific decrease. |
| `raise` | `+` | Vertical increase. Python enum member is `raise_`, serialised as `"raise"`. |
| `lower` | `−` | Vertical decrease. |
| `rotate` | `+` unless `direction == "down"` | Direction is mandatory for a valid rotation. |

#### `Unit` — 3 values

| Value | Role |
| --- | --- |
| `mm` | Canonical length unit. |
| `cm` | Input only; normalised to `mm` by multiplying by 10. |
| `degrees` | Canonical angle unit, used for `rotation`. |

`inch` is intentionally **not** an enum value. The rules parser detects it and
returns an `unsupported` instruction before validation.

#### `InstructionStatus` — 5 values

| Status | UI label (`lib/format.ts`) | Can apply? | Meaning |
| --- | --- | --- | --- |
| `ok` | "Ready to apply" | Yes, subject to mapping | Valid, in range, fully specified. |
| `needs_clarification` | "Needs clarification" | No | Ambiguous, incomplete, qualitative, contradictory, missing direction, or over-range. |
| `unsupported` | "Not supported" | No | Region, pair or unit is outside the prototype's capability. |
| `invalid` | "Invalid" | No | Structurally impossible or malformed request (unknown enum, negative value, unit/parameter mismatch, no region). |
| `no_change` | "No change" | No | Explicit negation, "keep unchanged", or a zero magnitude. |

`ok` is necessary but not sufficient for a visible change: the instruction must
also resolve to a model field, and — in Live mode — carry no `adjusted_value` and
produce a non-zero delta.

#### `ParserSource` — 2 values

`rules`, `llm`.

### 3.5 `ParseResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `instructions` | `Instruction[]` | Ordered; may contain a mixture of statuses. |
| `text` | `string` | Stripped request text. |

### 3.6 `Command`

`Command` extends `Instruction` with local execution metadata. It exists only in
the browser; it is never sent to the backend.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | e.g. `manual-bridgeHeight-1729860000000-3`. |
| `source` | `"voice"` / `"manual"` | `manual` means an absolute slider edit, not a parsed delta. |
| `createdAt` | `number` | Epoch milliseconds. |

### 3.7 `ModelState`

All 32 fields exist simultaneously. Initial values are **all zero**, including
parameters whose registry descriptor declares a non-zero default.

| Field | Unit | Geometry-wired | Registry status |
| --- | --- | --- | --- |
| `bridgeHeight` | mm | Yes | core |
| `bridgeWidth` | mm | Yes | core |
| `tipHeight` | mm | Yes | core |
| `tipProjection` | mm | Yes | core |
| `tipRotation` | degrees | Yes | core |
| `alarWidth` | mm | Yes | core |
| `upperLipProjection` | mm | Yes | core |
| `upperLipFullness` | mm | Yes | core |
| `lowerLipProjection` | mm | Yes | core |
| `lowerLipFullness` | mm | Yes | core |
| `chinProjection` | mm | Yes | core |
| `chinHeight` | mm | Yes | core |
| `chinWidth` | mm | Yes | core |
| `jawWidth` | mm | Yes | core |
| `jawDefinition` | mm | Yes | core |
| `cheekProjection` | mm | Yes | core |
| `cheekFullness` | mm | Yes | core |
| `dorsalHumpReduction` | mm | No | registered |
| `radixHeight` | mm | No | registered |
| `nasofrontalAngle` | degrees | No | registered |
| `nasolabialAngle` | degrees | No | registered |
| `columellarShow` | mm | No | registered |
| `columellarLobularAngle` | degrees | No | registered |
| `supratipBreak` | mm | No | registered |
| `tipDefinition` | mm | No | registered |
| `alarFlare` | mm | No | registered |
| `alarBaseWidth` | mm | No | registered |
| `nostrilShape` | mm | No | unsupported |
| `nostrilSymmetry` | mm | No | unsupported |
| `dorsalSeptalDeviation` | mm | No | unsupported |
| `leftRightAsymmetry` | mm | No | unsupported |
| `nasalLength` | mm | No | registered |

`initialModelState` in `frontend/src/scene/transformations/types.ts` is the single
source of initial values. Replay always starts from this object, so the *order* of
commands is the only thing that determines current state — there are no hidden
baselines.

### 3.8 `ParamDescriptor`

The registry is `Record<ParamKey, ParamDescriptor>` in `frontend/src/lib/params.ts`.

| Field | Type | Purpose |
| --- | --- | --- |
| `key` | `ParamKey` | Model field and React key. |
| `label` | `string` | Full UI label. |
| `shortLabel` | `string` | Compact label for tables and reports. |
| `unit` | `"mm"` / `"degrees"` | Display and slider unit. |
| `target` | `TargetRegion` | Region sent in commands. |
| `parameter` | `Parameter` | Parameter name sent in commands. |
| `group` | `ParamGroup` | `nose`, `lips`, `chin`, `jawline`, `cheeks`. |
| `min` | `number` | Slider minimum. |
| `max` | `number` | Slider maximum. |
| `step` | `number` | Slider step. Always `1` today. |
| `default` | `number` | Declared reset value. **Not** the initial model state. |
| `hint` | `string` | Helper text under the slider. |
| `positive` | `string` | Meaning of a positive value. |
| `negative` | `string` | Meaning of a negative value. |
| `operations` | `Operation[]` | Operations the UI advertises. Not enforced by the backend. |
| `deformation` | `string` | Named weight function the descriptor *claims* to drive. |
| `supported` | `boolean` | `false` for the four inert parameters. |
| `voice` | `boolean` | Whether a parsed command can target the pair. `true` for all 32. |
| `manual` | `boolean` | Whether the panel exposes a slider. `true` for 28. |

`ParamGroup` metadata (`PARAM_GROUPS`) supplies the group label and description:

| Group | Label | Description |
| --- | --- | --- |
| `nose` | Nose | "Bridge depth/width, tip projection/height/rotation and alar spread" |
| `lips` | Lips | "Upper- and lower-lip projection and fullness" |
| `chin` | Chin | "Chin projection, height and width" |
| `jawline` | Jawline | "Lower-jaw width and mandibular contour definition" |
| `cheeks` | Cheeks | "Malar projection and fullness (both sides, symmetric)" |

The panel renders a group only when at least one descriptor passes
`d.manual && SIMULATED_PARAM_KEYS.includes(d.key)`. That yields 28 visible
controls across five groups.

### 3.9 Consultation schemas

These live in `frontend/src/scene/session/types.ts` and are held in React memory
only. They are lost on reload unless the derived archive record is saved.

#### `TranscriptEntry`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | `transcript-…`. |
| `createdAt` | `number` | Epoch ms. |
| `source` | `"voice"` / `"typed"` | Input channel. |
| `text` | `string` | Original recognised or typed text; edits never overwrite it. |
| `status` | `"processing"` / `"parsed"` / `"error"` | Parse lifecycle. |
| `proposalId` | `string` / `null` | Link to the proposal. |
| `outcome` | `"pending"` / `"confirmed"` / `"rejected"` / `"cancelled"` / `"failed"` / `null` | Final handling. |
| `error` | `string` / `null` | Parse error text. |

#### `Proposal`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | `proposal-…`. |
| `createdAt` | `number` | Epoch ms. |
| `transcriptId` | `string` | Originating entry. |
| `originalText` | `string` | Utterance, preserved. |
| `source` | `"voice"` / `"typed"` | Input channel. |
| `status` | `ProposalStatus` | `processing`, `needs_clarification`, `ready`, `blocked`, `failed`, `confirmed`, `rejected`, `cancelled`. |
| `instructions` | `Command[]` | Parsed and editable instructions. |
| `error` | `string` / `null` | Backend error, when `failed`. |
| `resolvedAt` | `number` / `null` | Set on terminal outcome. |
| `appliedCommandCount` | `number` | How many instructions were applied. |
| `appliedAll` | `boolean` | Whether the whole batch was applied. |

Terminal statuses are `confirmed`, `rejected`, `cancelled`. `processing`,
`needs_clarification`, `ready` and `blocked` are non-terminal. `failed` is an end
state in practice but is not in `TERMINAL_PROPOSAL_STATUSES`, so
`isTerminalProposal("failed")` returns `false`; do not rely on that predicate to
mean "no further outcome is possible".
`deriveProposalStatus` returns `needs_clarification` if any instruction needs it,
otherwise `ready` if at least one instruction is applicable, otherwise `blocked`.

#### `Scenario`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | `scenario-…`. |
| `name` | `string` | Clinician-provided, editable. |
| `createdAt` | `number` | Epoch ms. |
| `state` | `ModelState` | Full absolute snapshot, never a delta. |
| `commandIds` | `string[]` | Applied commands in effect when saved. |
| `notes` | `string` | Free text; included in reports. |

#### `SessionEvent`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | `event-…`. |
| `at` | `number` | Epoch ms. |
| `type` | `SessionEventType` | See list below. |
| `label` | `string` | Short human label. |
| `detail` | `string` / `null` | Extra context. |
| `proposalId` | `string` / `null` | Related proposal, if any. |
| `commandIds` | `string[]` | Related applied commands. |
| `scenarioId` | `string` / `null` | Related scenario, if any. |

`SessionEventType` values: `session_started`, `session_ended`,
`proposal_created`, `proposal_confirmed`, `proposal_rejected`,
`proposal_cancelled`, `manual_edit`, `live_command`, `undo`, `reset`,
`scenario_saved`, `scenario_renamed`, `scenario_deleted`, `scenario_loaded`,
`consultation_archived`, `consultation_restored`.

#### `ConsultationSession`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | `session-…`. |
| `startedAt` | `number` | Epoch ms. |
| `endedAt` | `number` / `null` | `null` while active. |
| `status` | `"active"` / `"ended"` | Session lifecycle. |
| `transcript` | `TranscriptEntry[]` | Append-only utterances. |
| `proposals` | `Proposal[]` | One per parse attempt. |
| `events` | `SessionEvent[]` | Immutable audit trail. |
| `scenarios` | `Scenario[]` | Saved alternatives. |

### 3.10 `LiveEvent`

`frontend/src/scene/live/types.ts`. One entry per handled instruction, including
rejected ones.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | `live-…`. |
| `at` | `number` | Epoch ms. |
| `source` | `"live_voice"` / `"typed"` / `"manual"` | Input channel. |
| `utterance` | `string` | Original instruction or `Manual adjustment · <label>`. |
| `target` | `TargetRegion` / `null` | Parsed region. |
| `parameter` | `Parameter` / `null` | Parsed parameter. |
| `paramKey` | `ParamKey` / `null` | Resolved model field, when one exists. |
| `requestedValue` | `number` / `null` | Value as requested. |
| `requestedUnit` | `Unit` / `null` | Unit as requested. |
| `normalizedValue` | `number` / `null` | Value after validation. |
| `normalizedUnit` | `Unit` / `null` | Canonical unit. |
| `status` | `LiveExecutionStatus` | See below. |
| `before` | `number` / `null` | Model value before, for applied changes. |
| `after` | `number` / `null` | Model value after, for applied changes. |
| `reason` | `string` / `null` | Why it was not applied. |
| `confidence` | `number` / `null` | Parser confidence at capture. |

`LiveExecutionStatus`: `applied`, `needs_clarification`, `unsupported`,
`out_of_range`, `no_change`, `not_applied`. Only `applied` mutates the model.

### 3.11 Archive record

`frontend/src/lib/historyStore.ts`.

#### `ArchivedConsultation`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | IndexedDB key. |
| `label` | `string` | Display label. |
| `savedAt` | `number` | Epoch ms; list order is descending. |
| `startedAt` | `number` | Session start. |
| `status` | `string` | Session status at save time (`active` / `ended`). |
| `changeCount` | `number` | Number of applied changes. |
| `scenarioCount` | `number` | Number of saved scenarios. |
| `modelState` | `ModelState` | Full parameter snapshot. |
| `summary` | `string` | Markdown report text. |
| `personalization` | `ArchivedPersonalization \| null` | Optional; absent on pre-photo records. |
| `liveEvents` | `LiveEvent[]` | Optional change log. |

#### `ArchivedPersonalization`

| Field | Type | Notes |
| --- | --- | --- |
| `morph` | `FaceMorph` | Derived identity coefficients. |
| `skinTone` | `string` | Sampled colour. |
| `profile` | `FaceProfile` | Reconstructed proportions. |
| `photoName` | `string` | File name only. |

No image bytes, no object URL and no base64 data are stored. See
[Architecture §10](ARCHITECTURE.md#10-data-privacy-and-security).

### 3.12 Report and export schemas

`buildConsultationReport` returns a Markdown `string` with this order:

1. `# VoiceSurg 3D - Consultation Summary`
2. Prototype/storage disclaimer and session metadata (`id`, start, end, status).
3. `## Final working parameters` — all 32 fields, labelled, in
   `SIMULATED_PARAM_KEYS` order.
4. `## Original instructions (transcript)` — channel and outcome per entry.
5. `## Confirmed parameter changes` — applied `Command[]`.
6. `## Rejected / unresolved proposals` — every proposal whose status is not
   `confirmed`, including those still awaiting review.
7. `## Saved scenarios` — names, save times and notes, plus the final selected
   scenario.
8. `## Validation warnings` — one bullet per non-`ok` instruction with a reason,
   or `None.`
9. `## Limitations` — the prototype, record-keeping and clinical-validity
   disclaimers.

`buildLiveCsv` writes an RFC-4180-style CSV with CRLF row endings and this header:

```text
id,timestamp,iso,source,utterance,target,parameter,parameter_key,
requested_value,requested_unit,normalized_value,normalized_unit,
execution_status,before,after,actual_change,reason,confidence
```

`buildLiveJson` writes:

```json
{
  "exportedAt": "2026-10-25T12:00:00.000Z",
  "count": 3,
  "events": []
}
```

`buildLivePdf` emits a minimal PDF 1.4 document (Helvetica, A4, 58 lines per page,
hand-computed xref) with no third-party dependency. Non-ASCII characters are
transliterated or replaced with `?`.

### 3.13 Schema invariants

1. Every enum sent by the backend is one of the values listed above; the frontend
   mirrors them exactly.
2. `Command` is the only type that adds local metadata; it is never serialised to
   the backend.
3. `ModelState` has 32 keys and always has all 32; no key is optional.
4. A `Scenario.state` is a full snapshot, not a delta, so restoring it is
   order-independent.
5. `Instruction.value` is never negative. Direction is carried by `operation` and,
   for rotations, `direction`.
6. `adjusted_value` never appears together with `status: "ok"`.
7. `LiveEvent.before` and `after` are populated only for `applied` events; the
   other statuses explain themselves through `reason`.
8. Archive records are additive: unknown future fields are ignored by older
   readers, and `personalization` is optional.
9. `parser` describes the path that produced the *accepted* instruction set, not
   whether the LLM was attempted.
10. The report never labels an unresolved proposal as confirmed.

---

## 4. Validation rules

### 4.1 Where validation happens

```text
raw intent (rules dict or Gemini dict)
        │
        ▼
build_instruction(raw, original_text, parser, missing_reason)
        │
        ├─ 1. enum coercion
        ├─ 2. structural completeness
        ├─ 3. region/parameter compatibility
        ├─ 4. operation presence
        ├─ 5. unit normalisation and unit/parameter match
        ├─ 6. value presence, sign and zero
        ├─ 7. magnitude limit (no clamping)
        └─ 8. accept as ok
        │
        ▼
flag_contradictions()  (both paths)
        │
        ▼
ParseResponse
```

`build_instruction` never raises. Malformed input becomes `invalid` with a reason,
or a non-applicable status, rather than an invented command.

### 4.2 Bounds

| Category | Parameters | Limit | Unit |
| --- | --- | --- | --- |
| Length | `height`, `width`, `projection`, `fullness`, `definition` | `10.0` | `mm` |
| Angle | `rotation` | `45.0` | `degrees` |

`LENGTH_LIMIT_MM` and `ANGLE_LIMIT_DEG` are global per category. They do **not**
consult the frontend registry's per-parameter `min`/`max`. Consequences:

- `nasalLength` is a `height`, so a voice request is limited to 10 mm even though
  its slider spans 30–70.
- `nasofrontalAngle` is a `rotation`, so a voice request would be limited to 45°
  even though its slider spans 115–150 — but the pair is rejected earlier as
  `unsupported` (see §7), so the limit is never reached.
- Voice values are always non-negative; a negative field value comes only from a
  `decrease`/`lower`/`narrow` operation (or `rotate` downward). Registry minimums
  such as `radixHeight` −5 are not checked by voice. See §5.1 for parameters whose
  voice pair writes a different field.
- Manual slider commands bypass `build_instruction` entirely and are **not**
  range-checked against either limit. A slider can therefore write values that a
  spoken command could not.

### 4.3 Decision order

The first matching row wins. Rows are evaluated in this order.

| # | Condition | Status | Key fields |
| --- | --- | --- | --- |
| 1 | `target`/`parameter`/`operation`/`unit`/`requested_unit` is not a known enum value | `invalid` | All behavioural fields null; `reason` names the bad enum. |
| 2 | `target` is null | `invalid` | `reason`: "No supported anatomical region was identified in this phrase." |
| 3 | `operation` and `parameter` are both null | `invalid` | "No supported operation or parameter was identified in this phrase." |
| 4 | `parameter` is null but target exists | `invalid` | Echoes `target` and `operation`. |
| 5 | `parameter` is not in `TARGET_PARAMETER_MAP[target]` | `unsupported` | Keeps `target`, `parameter`, `operation`; `value` null; reason lists allowed parameters; `requires_confirmation: true`. |
| 6 | `operation` is null | `needs_clarification` | Echoes target/parameter; reason "No direction was given (for example: increase or decrease)." |
| 7 | `unit` is null | — | Defaults to the canonical unit; continues. |
| 8 | `unit` is `cm` | — | `value` multiplied by 10 and rounded to 4 dp; `unit` becomes `mm`; `requested_value`/`requested_unit` preserved. |
| 9 | Angular parameter with `unit: "mm"` | `invalid` | "A linear unit (mm) cannot be applied to an angular parameter; use degrees." |
| 10 | Length parameter with `unit: "degrees"` | `invalid` | "An angular unit (degrees) cannot be applied to a linear parameter; use mm." |
| 11 | `value` is null | `needs_clarification` | Uses `missing_reason` when supplied, else "A measurement is required; no numeric value was provided." |
| 12 | `value < 0` | `invalid` | "A negative measurement was given; state the direction with a positive value." |
| 13 | `value == 0` | `no_change` | `value: 0.0`; "A zero change produces no modification." |
| 14 | `value` exceeds the category limit | `needs_clarification` | `value` preserved, `adjusted_value` = limit; "Requested N unit exceeds the supported simulation range of L unit; accept the adjusted proposal or enter a smaller value." |
| 15 | Otherwise | `ok` | `value` as normalised; `adjusted_value: null`; `reason: null` unless a context/correction note was supplied. |

Notes:

- Row 4 means a phrase such as "increase the bridge" (no width/height) is
  `invalid`, not a guess.
- Row 5 is how the backend rejects `nasal_tip`/`definition`,
  `cheek`/`rotation`, and every pair on the five non-mapped regions.
- Row 6 covers "Set the bridge width to 2 mm" — a magnitude without a direction.
- Rows 7–8 apply before the mismatch checks, so `0.2 cm` on a rotation is treated
  as `2 mm` and then rejected by row 9.
- Row 14 deliberately does **not** clamp. The clinician must accept
  `adjusted_value` in the review card, which rewrites `value` and clears the
  adjustment locally.

### 4.4 Unit handling

| Input | Parsed `value` | `requested_value` | `requested_unit` | `unit` | Verdict |
| --- | --- | --- | --- | --- | --- |
| `2 mm` on a length | 2.0 | 2.0 | `mm` | `mm` | `ok` |
| `0.2 cm` on a length | 2.0 | 0.2 | `cm` | `mm` | `ok` |
| `2` with no unit on a length | 2.0 | 2.0 | `mm` | `mm` | `ok` |
| `1 inch` | `null` | `null` | `null` | `null` | `unsupported` (parser-level) |
| `5 degrees` on `rotation` | 5.0 | 5.0 | `degrees` | `degrees` | `ok` if direction present |
| `5 mm` on `rotation` | `null` | 5.0 | `mm` | `degrees` | `invalid` |
| `5 degrees` on a length | `null` | 5.0 | `degrees` | `mm` | `invalid` |

The rules parser normalises unit spelling before validation: `millimetre`,
`millimeter`, `millimetres`, `millimeters`, `mm` → `mm`; `centimetre`,
`centimeter`, `centimetres`, `centimeters`, `cm` → `cm`; `degree`, `degrees`,
`deg`, `°` → `degrees`. A unit token is only attached when it appears within the
first three characters after the number (allowing `5mm` and `5 mm`).

### 4.5 Post-validation passes

#### Contradiction flagging

`flag_contradictions` groups `ok` instructions by `(target, parameter)`, computes
the sign of each (`_sign`), and if both `+1` and `−1` occur, rewrites **all**
instructions in the group to:

- `status: "needs_clarification"`
- `reason: "Contradictory instructions were given for the same parameter. Please state a single direction."`
- `confidence: min(confidence, 0.3)`

It runs on both the rules path (inside `parse_text`) and the accepted LLM path.
It ignores `unsupported`, `invalid`, `no_change` and `needs_clarification`
instructions.

#### Qualitative guard (LLM only)

If an `ok` LLM instruction has a value and its `original_text` contains any
qualitative token, the guard rewrites it to `needs_clarification`, sets `value`
to null, and lowers confidence to at most 0.5. Tokens:

```text
slightly, a bit, a little, a touch, somewhat, minimally, minimal,
subtle, subtly, just a, slight
```

The rules path implements the equivalent rule earlier: if no number is present
and a qualitative token is, it sets a missing-measurement reason. A difference
remains: `"increase 2 mm slightly"` passes the rules path as `ok` (a number is
present) but would be stripped by the LLM guard. Treat "slightly + explicit
number" as ambiguous rather than reliable.

#### Hard negatives

`parser_service.parse_command` returns the rules result immediately — without
calling Gemini — when either:

- the whole text matches the negation prefix or the "keep unchanged" pattern; or
- any rules instruction is `unsupported` or `no_change`.

This is the mechanism that prevents a language model from converting "do not
reduce the bridge" or "reduce the forehead" into a positive action.

### 4.6 Frontend application gates

| Path | Required conditions |
| --- | --- |
| Consultation apply | `status === "ok"`, `value !== null`, `target !== null`, and `paramKeyFor(target, parameter) !== null`. `isApplicable` in `lib/format.ts` encodes the first three. |
| Live auto-apply | All of the above, **plus** `adjusted_value == null`, a resolved `paramKey`, and `applyCommand(...)[key] !== state[key]` (non-zero delta). |
| Manual slider | No status gate; `createManualCommand` synthesises `status: "ok"` and writes an absolute value. Mapping is still required. |

An instruction with `status: "ok"` but no mapping is not applied. This is the last
line of defence for capability drift between backend and registry.

### 4.7 Known validation divergences

| Divergence | Effect |
| --- | --- |
| Backend limits are global (10 mm / 45°), registry bounds are per-parameter | Voice and manual paths accept different ranges. |
| Backend rejects `cheek`/`rotation`, but the registry exposes three angle sliders on `cheek` | Nasofrontal, nasolabial and columellar-lobular angles cannot be voiced. |
| Backend rejects `nasal_tip`/`definition`, but the registry exposes `tipDefinition` | "Tip definition" voice commands are unsupported. |
| Backend rejects `nostril_region`/`definition`, and the registry marks `nostrilShape`/`nostrilSymmetry` unsupported | Synonyms such as "nostril shape" are parsed as nostril `width`, not as the inert fields. |
| Registry `operations` is UI metadata only | "Increase dorsal hump reduction" is accepted although the slider advertises reduction only. |
| Manual commands bypass validation | A slider can write values beyond 10 mm / 45°, including 115–150 into a millimetre field. See [§5.1](#51-implementation-status). |

---

## 5. Parameter catalogue

### 5.1 Implementation status

This is the most important table in the handbook. The registry declares **32**
parameters, but the geometry engine reads only **17** fields. "Supported" in the
UI therefore does not always mean "changes the mesh".

| Status | Count | `supported` | `manual` | `voice` | Read by `deformPositions` |
| --- | --- | --- | --- | --- | --- |
| **core** | 17 | `true` | `true` | `true` | Yes |
| **registered** | 11 | `true` | `true` | `true` | No |
| **unsupported** | 4 | `false` | `false` | `true` | No |
| **Total** | **32** | 28 `true` | 28 `true` | 32 `true` | 17 |

What each label means in practice:

- **core** — a voice instruction or slider edit resolves to a field that
  `deformPositions` reads. The visible mesh changes.
- **registered** — the slider is rendered and the descriptor claims a deformation
  function, but `ModelField` values for this key are never read. The slider
  appears to move, then snaps back on the next render because its displayed value
  comes from a field that stays at zero. Voice commands for the seven whose pair
  passes validation are accepted under a *colliding* `(target, parameter)` pair
  and silently adjust the neighbouring core field instead; the other four are
  rejected as `unsupported`. Either way, no registered field is written. They are
  documented as **not geometry-wired**, not as working features.
- **unsupported** — `supported: false` and `manual: false`. No slider. Voice
  phrases that sound like these concepts are usually re-interpreted as a supported
  pair (for example "nostril shape" → alar width) or rejected. The enum fields
  exist, but nothing writes them.

#### The aliasing defect

`applyCommand` resolves **both** voice and manual commands through
`paramKeyFor(target, parameter)`. `ModelState` has a separate field for each of
the 32 parameters, but each of the 11 registered descriptors reuses a
`(target, parameter)` pair that a core descriptor already owns, and that pair
resolves to the core field. The registered parameter's own field is never
written:

| Registered parameter | Wire pair | `paramKeyFor` result | Consequence |
| --- | --- | --- | --- |
| `dorsalHumpReduction` | `nasal_bridge` / `height` | `bridgeHeight` | Slider writes bridge height; hump field stays 0. |
| `radixHeight` | `nasal_bridge` / `height` | `bridgeHeight` | Slider writes bridge height; radix field stays 0. |
| `nasofrontalAngle` | `cheek` / `rotation` | `cheekProjection` | Slider writes 115–150 into a millimetre projection field. |
| `nasolabialAngle` | `cheek` / `rotation` | `cheekProjection` | Same; 80–120 written as millimetres. |
| `columellarShow` | `cheek` / `projection` | `cheekProjection` | Slider writes 0–6 mm into cheek projection. |
| `columellarLobularAngle` | `cheek` / `rotation` | `cheekProjection` | 30–70 written as millimetres. |
| `supratipBreak` | `nasal_tip` / `height` | `tipHeight` | Slider writes tip height. |
| `tipDefinition` | `nasal_tip` / `definition` | `tipHeight` (early branch) | Slider writes tip height; the later exact branch is unreachable. |
| `alarFlare` | `nostril_region` / `width` | `alarWidth` | Slider writes alar width. |
| `alarBaseWidth` | `nostril_region` / `width` | `alarWidth` | Slider writes alar width. |
| `nasalLength` | `nasal_bridge` / `height` | `bridgeHeight` | Slider writes 30–70 into a ±10 mm field. |

Two consequences deserve emphasis:

1. **Sliders snap back.** The slider's `value` prop is read from
   `modelState[descriptor.key]`; that field is never written, so it remains 0.
   The core field *does* change, which can move the mesh in a way the label does
   not describe.
2. **Angle and length can be conflated.** Dragging `nasofrontalAngle` to 130
   writes `cheekProjection = 130` (interpreted as 130 mm), and
   `nasolabialAngle` to 95 writes `cheekProjection = 95`. The geometry has no
   clamp, so this can produce extreme distortion. Treat these controls as
   hazardous in the current build, not merely cosmetic.

The same collision explains why voice commands for registered parameters can
appear to work: "increase nasal length by 3 mm" produces `ok`, maps to
`bridgeHeight`, and visibly raises the bridge — not the nose length.

#### Unreachable `paramKeyFor` branches

`paramKeyFor` contains later branches that can never execute because an earlier
branch already returned:

| Later branch | Shadowed by | Notes |
| --- | --- | --- |
| `nasal_tip` / `definition` → `tipDefinition` | earlier `nasal_tip` / `definition` → `tipHeight` | The intended distinct field is never reached. |
| `nasal_bridge` / `height` → `bridgeHeight` | first bridge branch | Duplicate. |
| `nasal_tip` / `height` → `tipHeight` | first tip branch | Duplicate. |
| `nostril_region` / `width` → `alarWidth` | first nostril branch | Duplicate. |
| `cheek` / `rotation` → `cheekProjection` | first cheek branch | Duplicate. |
| `cheek` / `projection` → `cheekProjection` | first cheek branch | Duplicate. |
| `jawline` / `definition` → `leftRightAsymmetry` | first jawline branch | Duplicate; the asymmetry field is unreachable. |

The `nasal_base`, `columella`, `septal_region`, `left_side` and `right_side`
branches are reachable *within the function*, but no validated backend instruction
can carry those targets, so they are unreachable in the running system.

#### Registry defaults that disagree with the model

`initialModelState` is all zero, while five descriptors declare a non-zero
`default`:

| Parameter | Descriptor default | Initial state | Slider minimum |
| --- | --- | --- | --- |
| `nasofrontalAngle` | 130 | 0 | 115 |
| `nasolabialAngle` | 95 | 0 | 80 |
| `columellarShow` | 3 | 0 | 0 |
| `columellarLobularAngle` | 45 | 0 | 30 |
| `nasalLength` | 50 | 0 | 30 |

A reset writes zero, not these defaults, and the descriptors' `default` field is
not used to seed the model. Several sliders therefore start below their declared
minimum, which browsers may render clamped while React state remains 0.

### 5.2 Core parameters (17, geometry-wired)

| # | Key | Label | Unit | Target / parameter | Bounds (min…max, step) | Default | Geometry weight |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `bridgeHeight` | Nasal bridge height | mm | `nasal_bridge` / `height` | −10…10, 1 | 0 | `bridgeWeight` |
| 2 | `bridgeWidth` | Nasal bridge width | mm | `nasal_bridge` / `width` | −10…10, 1 | 0 | `bridgeWidthWeight` |
| 3 | `tipProjection` | Tip projection | mm | `nasal_tip` / `projection` | −10…10, 1 | 0 | `tipWeight` |
| 4 | `tipHeight` | Tip height | mm | `nasal_tip` / `height` | −10…10, 1 | 0 | `tipWeight` |
| 5 | `tipRotation` | Tip rotation | degrees | `nasal_tip` / `rotation` | −45…45, 1 | 0 | `tipWeight` |
| 6 | `alarWidth` | Alar width | mm | `nostril_region` / `width` | −10…10, 1 | 0 | `alarWeight` |
| 7 | `upperLipProjection` | Upper-lip projection | mm | `upper_lip` / `projection` | −10…10, 1 | 0 | `upperLipWeight` |
| 8 | `upperLipFullness` | Upper-lip fullness | mm | `upper_lip` / `fullness` | −10…10, 1 | 0 | `upperLipWeight` |
| 9 | `lowerLipProjection` | Lower-lip projection | mm | `lower_lip` / `projection` | −10…10, 1 | 0 | `lowerLipWeight` |
| 10 | `lowerLipFullness` | Lower-lip fullness | mm | `lower_lip` / `fullness` | −10…10, 1 | 0 | `lowerLipWeight` |
| 11 | `chinProjection` | Chin projection | mm | `chin` / `projection` | −10…10, 1 | 0 | `chinProjectionWeight` |
| 12 | `chinHeight` | Chin height | mm | `chin` / `height` | −10…10, 1 | 0 | `chinHeightWeight` |
| 13 | `chinWidth` | Chin width | mm | `chin` / `width` | −10…10, 1 | 0 | `chinWidthWeight` |
| 14 | `jawWidth` | Jaw width | mm | `jawline` / `width` | −10…10, 1 | 0 | `jawWidthWeight` |
| 15 | `jawDefinition` | Jawline definition | mm | `jawline` / `definition` | −10…10, 1 | 0 | `jawDefinitionWeight` |
| 16 | `cheekProjection` | Cheek projection | mm | `cheek` / `projection` | −10…10, 1 | 0 | `cheekProjectionWeight` |
| 17 | `cheekFullness` | Cheek fullness | mm | `cheek` / `fullness` | −10…10, 1 | 0 | `cheekFullnessWeight` |

Notes:

- `nasal_dorsum` shares the bridge descriptors' *geometry*, but no descriptor uses
  it as `target`; the backend accepts `nasal_bridge` / `height` and
  `nasal_bridge` / `width` as well as the same pairs on `nasal_dorsum`. Both map
  to `bridgeHeight` / `bridgeWidth`.
- `tipProjection`, `tipHeight` and `tipRotation` all drive `tipWeight`, so they are
  independent *fields* but overlapping *deformation zones*. Independence is
  tested at the field level, not claimed at the vertex level.
- The operations advertised per descriptor are in §5.6.

### 5.3 Registered parameters (11, not geometry-wired)

| # | Key | Label | Unit | Target / parameter | Bounds | Default | Declared weight | Backend verdict for the pair | Effective field |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | `dorsalHumpReduction` | Dorsal hump reduction | mm | `nasal_bridge` / `height` | 0…10, 1 | 0 | `bridgeWeight` | `ok` | `bridgeHeight` |
| 19 | `radixHeight` | Radix height | mm | `nasal_bridge` / `height` | −5…10, 1 | 0 | `bridgeWeight` | `ok` | `bridgeHeight` |
| 20 | `nasofrontalAngle` | Nasofrontal angle | degrees | `cheek` / `rotation` | 115…150, 1 | 130 | `bridgeWeight` | `unsupported` | `cheekProjection` (manual only) |
| 21 | `nasolabialAngle` | Nasolabial angle | degrees | `cheek` / `rotation` | 80…120, 1 | 95 | `bridgeWeight` | `unsupported` | `cheekProjection` (manual only) |
| 22 | `columellarShow` | Columellar show | mm | `cheek` / `projection` | 0…6, 1 | 3 | `bridgeWeight` | `ok` | `cheekProjection` |
| 23 | `columellarLobularAngle` | Columellar-lobular angle | degrees | `cheek` / `rotation` | 30…70, 1 | 45 | `bridgeWeight` | `unsupported` | `cheekProjection` (manual only) |
| 24 | `supratipBreak` | Supratip break | mm | `nasal_tip` / `height` | −3…3, 1 | 0 | `tipWeight` | `ok` | `tipHeight` |
| 25 | `tipDefinition` | Tip definition | mm | `nasal_tip` / `definition` | −3…5, 1 | 0 | `tipWeight` | `unsupported` | `tipHeight` (manual only) |
| 26 | `alarFlare` | Alar flare | mm | `nostril_region` / `width` | −5…5, 1 | 0 | `alarWeight` | `ok` | `alarWidth` |
| 27 | `alarBaseWidth` | Alar base width | mm | `nostril_region` / `width` | 0…10, 1 | 0 | `alarWeight` | `ok` | `alarWidth` |
| 32 | `nasalLength` | Nasal length | mm | `nasal_bridge` / `height` | 30…70, 1 | 50 | `bridgeWeight` | `ok` | `bridgeHeight` |

Seven of the eleven pairs pass validation (`ok`), but none writes its own field.
Four are rejected as `unsupported` for voice and are still manually adjustable,
which is the source of the angle/cheek-projection hazard described in §5.1.

### 5.4 Unsupported parameters (4, inert)

| # | Key | Label | Unit | Target / parameter | Bounds | `supported` | `manual` | Actual voice behaviour |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 28 | `nostrilShape` | Nostril shape | mm | `nostril_region` / `definition` | −3…3, 1 | `false` | `false` | `nostril_region` does not allow `definition` → `unsupported`. Phrases such as "nostril shape" are parsed as nostril **width** and accepted. |
| 29 | `nostrilSymmetry` | Nostril symmetry | mm | `nostril_region` / `definition` | −3…3, 1 | `false` | `false` | Same as above. |
| 30 | `dorsalSeptalDeviation` | Dorsal/septal deviation | mm | `septal_region` / `projection` | −5…5, 1 | `false` | `false` | `septal_region` is not in the backend map → `unsupported`. "Septal deviation" alone finds no region → `invalid`; "dorsal septal deviation" matches `dorsal` first and becomes an ordinary bridge-height change instead. |
| 31 | `leftRightAsymmetry` | Left-right asymmetry | mm | `jawline` / `definition` | −5…5, 1 | `false` | `false` | `jawline` / `definition` is **allowed**, so the LLM path turns "asymmetry" into an ordinary jawline-definition change; the rules path falls back to jawline **width**. In both cases the asymmetry field is never written. |

### 5.5 Advertised operations

The registry's `operations` array is presented in the UI and used by tests, but
the backend does not enforce it. Any allowed `(target, parameter)` pair accepts
any operation.

| Descriptor(s) | Advertised operations |
| --- | --- |
| `bridgeHeight`, `tipHeight`, `chinHeight`, `radixHeight` | `increase`, `decrease`, `raise`, `lower` |
| `bridgeWidth`, `alarWidth`, `chinWidth`, `jawWidth`, `alarFlare`, `alarBaseWidth` | `increase`, `decrease`, `widen`, `narrow` |
| `tipProjection` | `increase`, `decrease` |
| `tipRotation` | `rotate` |
| Lip projection/fullness, cheek projection/fullness, jaw definition, `columellarShow`, `supratipBreak`, `tipDefinition`, `nasalLength` | `increase`, `decrease` |
| `dorsalHumpReduction` | `decrease` |
| All four unsupported | `increase`, `decrease` |

`dorsalHumpReduction` advertises `decrease` only, yet "increase dorsal hump
reduction" passes validation and raises the bridge. Treat the advertised list as a
UI hint.

### 5.6 Groups and panel exposure

| Group | Core keys | Registered keys | Unsupported keys | Visible sliders |
| --- | --- | --- | --- | --- |
| `nose` | `bridgeHeight`, `bridgeWidth`, `tipProjection`, `tipHeight`, `tipRotation`, `alarWidth` | `dorsalHumpReduction`, `radixHeight`, `nasofrontalAngle`, `nasolabialAngle`, `columellarShow`, `columellarLobularAngle`, `supratipBreak`, `tipDefinition`, `alarFlare`, `alarBaseWidth`, `nasalLength` | `nostrilShape`, `nostrilSymmetry`, `dorsalSeptalDeviation` | 17 |
| `lips` | `upperLipProjection`, `upperLipFullness`, `lowerLipProjection`, `lowerLipFullness` | — | — | 4 |
| `chin` | `chinProjection`, `chinHeight`, `chinWidth` | — | — | 3 |
| `jawline` | `jawWidth`, `jawDefinition` | — | `leftRightAsymmetry` | 2 |
| `cheeks` | `cheekProjection`, `cheekFullness` | — | — | 2 |
| **Total** | **17** | **11** | **4** | **28** |

`dorsalSeptalDeviation` appears in the `nose` group despite targeting
`septal_region`; `leftRightAsymmetry` appears in `jawline`.

### 5.7 Registry bounds versus validation bounds

For registered parameters, "voice limit" describes the colliding core field the
command actually writes, not the registered field itself. Pairs rejected by
validation never reach a numeric check.

| Parameter | Registry min…max | Voice limit actually enforced | Mismatch |
| --- | --- | --- | --- |
| Most core lengths | −10…10 | ±10 mm | Compatible. |
| `tipRotation` | −45…45 | ±45° | Compatible. |
| `radixHeight` | −5…10 | ±10 mm on `bridgeHeight` | Registry narrower on the negative side; the UI prevents −6…−10, voice does not. |
| `dorsalHumpReduction` | 0…10 | ±10 mm on `bridgeHeight` | Voice accepts negative/reduction-sign inversion. |
| `columellarShow` | 0…6 | ±10 mm on `cheekProjection` | Voice can exceed 6. |
| `supratipBreak` | −3…3 | ±10 mm on `tipHeight` | Voice can exceed 3. |
| `tipDefinition` | −3…5 | n/a (pair rejected) | Voice cannot reach it; the manual slider still writes `tipHeight`. |
| `alarFlare` | −5…5 | ±10 mm on `alarWidth` | Voice can exceed 5. |
| `alarBaseWidth` | 0…10 | ±10 mm on `alarWidth` | Compatible at the boundary. |
| `nasalLength` | 30…70 | ±10 mm on `bridgeHeight` | Severe mismatch; the slider writes absolute 30–70. |
| `nasofrontalAngle` | 115…150 | n/a (pair rejected) | Severe mismatch; the manual slider writes 115–150 into a millimetre field. |
| `nasolabialAngle` | 80…120 | n/a (pair rejected) | Same. |
| `columellarLobularAngle` | 30…70 | n/a (pair rejected) | Same. |

The practical rule for a user: trust the slider's own range for manual edits and
the 10 mm / 45° limit for voice, but do not assume the two agree.

---

## 6. Parser grammar and synonyms

### 6.1 Pipeline

```text
text + context
   │
   ├─ parse_text() ────────────────────────────────┐
   │    split clauses → detect negatives →         │
   │    target → operation → parameter → value →   │
   │    context/correction → build_instruction()   │
   │                                               │
   ├─ hard negative? ── yes ──▶ return rules ──────┤
   │                                               │
   ├─ Gemini (12 s wall clock, 15 s SDK) ──────────┤
   │    raw JSON → build_instruction(parser=llm)   │
   │                                               │
   ├─ unusable / all invalid? ── yes ──▶ rules ────┤
   │                                               │
   └─ qualitative guard → contradictions ──▶ return │
                                                   ▼
                                             ParseResponse
```

Rules always run first. They are cheap, deterministic and offline. The LLM is
consulted only when the rules did not produce a hard negative. If the LLM fails
for any reason — missing key, SDK error, timeout, malformed JSON, empty list, or
every item invalid — the rules result is returned unchanged.

### 6.2 Clause segmentation

`_split_segments` splits on:

```text
;   ,   and   then   also   plus
```

Before splitting, phrases of the form `<word> and a half` are protected so
"one and a half" survives as one segment. A clause consisting only of a
correction cue (`actually`, `instead`, `rather`, `i mean`, `sorry`, `no wait`,
`make that`, `change that`, `make it`) is merged into the following clause.

Commas therefore always split, including a comma inside a natural sentence. That
is intentional: each clause becomes one `Instruction` with its own status.

### 6.3 Region synonyms (rules parser)

Regions are matched in the order below; the **first** match wins, and each
region's patterns are searched in listed order.

| Order | Region | Recognised phrases (case-insensitive) |
| --- | --- | --- |
| 1 | `nasal_bridge` | `nasal bridge`, `bridge`, `radix`, `nasion`, `dorsal hump`, `hump`, `dorsal prominence`, `dorsal convexity`, `bump` |
| 2 | `nasal_dorsum` | `nasal dorsum`, `dorsum`, `dorsal` |
| 3 | `nasal_tip` | `nasal tip`, `tip`, `pronasale`, `supratip`, `droopy tip`, `button nose`, `scooped`, `refined tip`, `tip definition` |
| 4 | `nostril_region` | `nostril`, `nostrils`, `nares`, `naris`, `alar base`, `alar`, `ala`, `alae`, `nostril shape`, `nostril symmetry`, `nostril flare`, `alar flare`, `alar base width` |
| 5 | `upper_lip` | `upper lip`, `upper-lip`, `top lip`, `upper … lip` |
| 6 | `lower_lip` | `lower lip`, `lower-lip`, `bottom lip`, `lower … lip` |
| 7 | `jawline` | `jaw line`, `jawline`, `mandible`, `mandibular`, `jaw`, `left-right asymmetry`, `left right asymmetry`, `asymmetry` |
| 8 | `chin` | `chin`, `menton`, `pogonion` |
| 9 | `cheek` | `cheek`, `cheeks`, `malar`, `zygomatic`, `nasolabial angle`, `columellar show`, `columellar-lobular angle` |

Ordering matters. `dorsal hump` is a bridge phrase, not a dorsum phrase. `tip
definition` resolves to the tip before `definition` is treated as a parameter.
`columellar show` and the two nasal angles resolve to `cheek` because the rules
parser has no columella region.

Unsupported region tokens (checked only when no supported region matched):

```text
brow, forehead, eye, eyes, ear, ears, mouth
```

A phrase containing one of these and no supported region becomes `unsupported`
with a reason naming the token; `target` is `null`.

A bare `lip` or `lips` with no upper/lower qualifier becomes
`needs_clarification` with `target: null`:
"Specify whether the upper or lower lip is intended (for example: upper lip or
lower lip)."

The rules parser does **not** recognise `nasal base`, `columella`, `septal
region`, `left side` or `right side` as regions. Only the LLM prompt advertises
them, and validation then rejects every parameter on them.

### 6.4 Operation lexicon

Detection order (first match wins):

| Order | Operation | Trigger words |
| --- | --- | --- |
| 1 | `narrow` | `narrow`, `narrower`, `pinch`, `thinner` |
| 2 | `widen` | `widen`, `wider`, `broaden`, `broader` |
| 3 | `rotate` | `rotate`, `rotation`, `rotated`, `angle`, `tilt` |
| 4 | `lower` | the standalone word `lower` |
| 5 | `raise` | `raise`, `lift` |
| 6 | `decrease` | `decrease`, `lower`, `reduce`, `shorten`, `subtract`, `minimise`, `minimize`, `take … off`, `down` |
| 7 | `increase` | `increase`, `raise`, `lift`, `augment`, `boost`, `add`, `gain`, `higher`, `project` |

Two quirks follow from this ordering:

- The word `angle` alone implies `rotate`, so "nasolabial angle" carries an
  operation even without an explicit verb. Because no `up`/`down` direction is
  present, the parser stops earlier with `needs_clarification` ("Rotation
  direction is required"). Only a phrase with an explicit direction, such as
  "nasolabial angle upward", reaches validation, where `cheek`/`rotation` is
  `unsupported`.
- `lower` is checked before the generic decrease bucket, and the phrase
  `lower lip` is neutralised to `lip` before verb detection, so "lower lip
  projection" is not read as a downward instruction.

### 6.5 Parameter lexicon

Detection order (first match wins):

| Order | Parameter | Trigger words |
| --- | --- | --- |
| 1 | `projection` | `projection`, `project`, `projected`, `projecting`, `forward` |
| 2 | `rotation` | `rotation`, `rotate`, `rotated`, `angle`, `tilt` |
| 3 | `height` | `height`, `high`, `projection of the height` |
| 4 | `width` | `width`, `wide`, `wideness`, `breadth` |
| 5 | `fullness` | `fullness`, `full`, `fuller`, `plump`, `plumpness`, `volume`, `pout`, `prominence`, `prominent` |
| 6 | `definition` | `definition`, `defined`, `define`, `sharpen`, `sharper`, `sharpness`, `angular`, `contour` |

Fallbacks when no parameter word is present:

| Context | Inferred parameter |
| --- | --- |
| Operation is `narrow` or `widen` | `width` |
| Operation is `rotate` | `rotation` |
| Target is `nostril_region` | `width` |
| Target is `nasal_bridge` or `nasal_dorsum` | `height` |
| Target is `nasal_tip` | `height` |
| Target is `upper_lip`, `lower_lip`, `chin` or `cheek` | `projection` |
| Target is `jawline` | `width` |
| Otherwise | `null` |

An inferred parameter lowers confidence to at most 0.8. The inference is what
makes "widen the chin", "raise the tip" and "reduce the bridge" work without
naming the parameter.

### 6.6 Numbers, units and direction

| Input form | Parsed value | Notes |
| --- | --- | --- |
| `2`, `2.5` | 2.0, 2.5 | Decimal digits. |
| `one` … `twelve` | 1–12 | Word numbers in the table. `zero` is not in the number pattern, so "zero mm" produces no amount and is rejected for a missing measurement. |
| `half` | 0.5 | Standalone. |
| `one and a half` | 1.5 | Protected before segmentation. |
| `a millimetre`, `an inch` | 1.0 | Article + unit. |
| `-2 mm`, `minus two` | 2.0 | The sign is ignored: the number regex matches `2`/`two` and the word list has no `minus`. Direction must come from an operation. |
| `2 centimetres` | 2.0, unit `cm` → later 20 mm | Conversion happens in validation. |
| `2 inches`, `2"` | — | `unsupported` at parser level. |

Direction words:

| Direction | Triggers |
| --- | --- |
| `up` | `up`, `upward`, `upwards`, `cephalic`, `superior`, `higher` |
| `down` | `down`, `downward`, `downwards`, `caudal`, `inferior`, `lower` |

A `rotate` instruction without a direction is rejected by the parser before
validation:
"Rotation direction is required (for example: upward or downward)."

### 6.7 Negation and no-change

Negation-prefix pattern (anchored at the start of a clause):

```text
please? (do not | don't | never | avoid | no change | no) ...
```

Keep-unchanged pattern (anywhere in the clause):

```text
(keep | leave | hold) ... (unchanged | the same | as is | constant | unmodified | fixed)
no change
stay / stays (the same | unchanged)
```

A match produces `status: "no_change"`, `operation: null`, `value: null`,
`requires_confirmation: false`, and the reason
"No change requested (negated or 'keep unchanged' instruction)." A target may
still be recorded if a region was detected.

Because the negation prefix is anchored, "do not reduce the bridge" is caught but
"the bridge should not be reduced" is not. Prefer imperative phrasing.

### 6.8 Corrections and context

| Cue or reference | Behaviour |
| --- | --- |
| `actually`, `instead`, `rather`, `i mean`, `sorry`, `no wait`, `make that`, `change that`, `make it` | Only **operation** detection starts after the cue; direction, parameter and value detection still scan the whole clause. If the clause follows another clause in the same utterance, the earlier clause is replaced (`_supersedes`). Target/parameter/operation may be inherited from the previous clause. |
| `it`, `that`, `this`, `those`, `these` with no region | Inherits target, and missing parameter/operation, from the last request `ContextItem`. Confidence becomes 0.65. |
| Correction with no previous clause and no context | `needs_clarification`: "This phrase refers to a previous instruction, but no earlier instruction is available in the current session." |
| Pronoun with no context | Same clarification message. |

Only the last four context items are sent by the client and accepted by the server.

### 6.9 Single-clause contradictions

Before validation, if a non-correction clause matches both the increase and
decrease patterns, the parser returns `needs_clarification`:
"This phrase contains contradictory actions; please restate a single direction."

Cross-clause contradictions are handled later by `flag_contradictions` (§4.5).

### 6.10 LLM prompt vocabulary differences

The Gemini system instruction advertises the same six parameters, seven
operations and three units, but its synonym list differs from the rules lexicon:

| Concept | LLM mapping | Rules parser |
| --- | --- | --- |
| `nasal base` | `nasal_base` | No region → `invalid` |
| `columella` | `columella` | No region; only `columellar show`/angles map to `cheek` |
| `septal region`, `septal deviation` | `septal_region` | No region → `invalid` |
| `left side`, `right side` | `left_side` / `right_side` | No region → `invalid` |
| `hump`, `bump`, `dorsal prominence` | `nasal_bridge` + `decrease` | `nasal_bridge`; operation taken from the verb |
| `droopy tip` | tip + `decrease` (height) or `increase` (downward rotation) | `nasal_tip`; operation from the verb |
| `button nose`, `scooped` | tip + `increase` (rotation upward) | `nasal_tip`; parameter fallback `height` unless a parameter word appears |
| `refined tip`, `tip definition` | tip + `increase` (definition) | `nasal_tip`; parameter `definition` → backend `unsupported` |
| `alar flare`, `nostril flare` | nostril + `widen` | nostril + `width` |
| `alar base width` | nostril + `increase` (width) | nostril + `width` |
| `nasolabial angle` | `cheek` + angle | `cheek` + `rotation`; no direction → `needs_clarification`, with direction → `unsupported` |
| `columellar show` | `cheek` + projection | `cheek` + fallback `projection` → `ok` |
| `columellar-lobular angle` | `cheek` + angle | `cheek` + `rotation`; no direction → `needs_clarification`, with direction → `unsupported` |
| `left-right asymmetry` | `jawline` + definition | `jawline` + fallback `width` → `ok` |

The LLM is told to report units exactly as spoken, never to invent a number, to
set `operation` to null for negated phrases, and to set `target` to null for
unsupported regions. These instructions are advisory; the real guarantee is
`build_instruction`, which runs on the LLM output exactly as on the rules output.

### 6.11 Worked examples

These are the outcomes of the **rules** parser with no LLM key configured.

| Utterance | Target | Parameter | Operation | Value | Status |
| --- | --- | --- | --- | --- | --- |
| "Reduce the bridge by 2 mm and raise the tip by 1 mm" | bridge, tip | height, height | decrease, raise | 2, 1 | two `ok` |
| "Do not reduce the bridge" | bridge | — | — | — | `no_change` |
| "Keep the bridge unchanged" | bridge | — | — | — | `no_change` |
| "Increase tip projection by 0.2 cm" | tip | projection | increase | 2.0 mm | `ok` |
| "Increase tip projection by 100 mm" | tip | projection | increase | 100.0 | `needs_clarification`, `adjusted_value: 10` |
| "Reduce the forehead by 2 mm" | null | — | — | — | `unsupported` |
| "Increase the upper lip projection by 2 mm" | upper_lip | projection | increase | 2 | `ok` |
| "Add fullness to the lower lip by 1 mm" | lower_lip | fullness | increase | 1 | `ok` |
| "Increase the lip projection by 2 mm" | null | — | — | — | `needs_clarification` (bare lip) |
| "Widen the chin by 2 mm" | chin | width | widen | 2 | `ok` |
| "Increase jawline definition by 2 mm" | jawline | definition | increase | 2 | `ok` |
| "Reduce the bridge by 1 inch" | bridge | — | — | — | `unsupported` |
| "Lower the tip" | tip | height | lower | — | `needs_clarification` (no amount) |
| "Raise the tip slightly" | tip | height | raise | — | `needs_clarification` (qualitative) |
| "Rotate the tip by 5 degrees" | tip | — | — | — | `needs_clarification` (no direction; parameter and value are dropped with the rejection) |
| "Rotate the tip upward by 5 degrees" | tip | rotation | rotate | 5 | `ok` |
| "Rotate the tip upward by 5 mm" | tip | rotation | rotate | — | `invalid` (unit mismatch) |
| "Increase the bridge by 2 mm and decrease the bridge by 1 mm" | bridge ×2 | height ×2 | increase, decrease | 2, 1 | both `needs_clarification` |
| "Reduce the bridge by 2 mm, actually increase it by 1 mm" | bridge | height | increase | 1 | one `ok` (supersedes) |
| "Reduce it by 1 mm" with bridge context | bridge | height | decrease | 1 | `ok` |
| "Narrow the bridge by 1 mm" | bridge | width | narrow | 1 | `ok` |
| "Make my nose better" | null | — | — | — | `invalid` (no region, no parameter) |
| "Set the bridge width to 2 mm" | bridge | width | — | — (requested 2) | `needs_clarification` (no direction; `value` is null, `requested_value` is 2) |
| "Lift the tip by one and a half mm" | tip | height | raise | 1.5 | `ok` |

### 6.12 Grammar limits

- English only.
- No signed numbers; no "minus".
- No ranges ("2 to 3 mm") — the first number wins.
- No fractions other than "half" and "X and a half".
- No unit before the number.
- No parameter synonyms outside the listed lexicon; the LLM path broadens this
  but is optional.
- No spelled-out decimals.
- Word numbers stop at twelve.
- Punctuation other than the listed separators does not create instruction
  boundaries.
- The rules parser has no notion of sentence boundaries; every clause is
  independent unless a correction cue links it.

---

## 7. Target × parameter capability matrix

### 7.1 Backend allow-list

`TARGET_PARAMETER_MAP` in `backend/app/validation.py` is the authority. A pair not
shown here is `unsupported` before any numeric checks.

| Target | `height` | `width` | `projection` | `rotation` | `fullness` | `definition` |
| --- | --- | --- | --- | --- | --- | --- |
| `nasal_bridge` | Yes | Yes | — | — | — | — |
| `nasal_dorsum` | Yes | Yes | — | — | — | — |
| `nasal_tip` | Yes | — | Yes | Yes | — | — |
| `nostril_region` | — | Yes | — | — | — | — |
| `upper_lip` | — | — | Yes | — | Yes | — |
| `lower_lip` | — | — | Yes | — | Yes | — |
| `chin` | Yes | Yes | Yes | — | — | — |
| `jawline` | — | Yes | — | — | — | Yes |
| `cheek` | — | — | Yes | — | Yes | — |
| `nasal_base` | — | — | — | — | — | — |
| `columella` | — | — | — | — | — | — |
| `septal_region` | — | — | — | — | — | — |
| `left_side` | — | — | — | — | — | — |
| `right_side` | — | — | — | — | — | — |

Valid pairs and the field they resolve to:

| Target / parameter | Effective `ModelField` | Geometry-wired |
| --- | --- | --- |
| `nasal_bridge` / `height` | `bridgeHeight` | Yes |
| `nasal_bridge` / `width` | `bridgeWidth` | Yes |
| `nasal_dorsum` / `height` | `bridgeHeight` | Yes |
| `nasal_dorsum` / `width` | `bridgeWidth` | Yes |
| `nasal_tip` / `height` | `tipHeight` | Yes |
| `nasal_tip` / `projection` | `tipProjection` | Yes |
| `nasal_tip` / `rotation` | `tipRotation` | Yes |
| `nostril_region` / `width` | `alarWidth` | Yes |
| `upper_lip` / `projection` | `upperLipProjection` | Yes |
| `upper_lip` / `fullness` | `upperLipFullness` | Yes |
| `lower_lip` / `projection` | `lowerLipProjection` | Yes |
| `lower_lip` / `fullness` | `lowerLipFullness` | Yes |
| `chin` / `projection` | `chinProjection` | Yes |
| `chin` / `height` | `chinHeight` | Yes |
| `chin` / `width` | `chinWidth` | Yes |
| `jawline` / `width` | `jawWidth` | Yes |
| `jawline` / `definition` | `jawDefinition` | Yes |
| `cheek` / `projection` | `cheekProjection` | Yes |
| `cheek` / `fullness` | `cheekFullness` | Yes |

There are exactly 19 valid pairs, collapsing onto 17 fields (the two
`nasal_dorsum` pairs share the bridge fields).

### 7.2 Full matrix with frontend resolution

The frontend's `paramKeyFor` knows more pairs than the backend accepts. The table
shows both layers. A cell is:

- **`field`** — backend accepts and the frontend resolves to that field;
- **`rejected`** — backend rejects the pair; the frontend may still have a branch
  (manual sliders only);
- **`—`** — neither layer resolves it.

| Target | `height` | `width` | `projection` | `rotation` | `fullness` | `definition` |
| --- | --- | --- | --- | --- | --- | --- |
| `nasal_bridge` | `bridgeHeight` | `bridgeWidth` | — | — | — | — |
| `nasal_dorsum` | `bridgeHeight` | `bridgeWidth` | — | — | — | — |
| `nasal_tip` | `tipHeight` | — | `tipProjection` | `tipRotation` | — | rejected → `tipHeight` |
| `nostril_region` | — | `alarWidth` | — | — | — | rejected → `alarFlare` |
| `upper_lip` | — | — | `upperLipProjection` | — | `upperLipFullness` | — |
| `lower_lip` | — | — | `lowerLipProjection` | — | `lowerLipFullness` | — |
| `chin` | `chinHeight` | `chinWidth` | `chinProjection` | — | — | — |
| `jawline` | — | `jawWidth` | — | — | — | `jawDefinition` |
| `cheek` | — | — | `cheekProjection` | rejected → `cheekProjection` | `cheekFullness` | — |
| `nasal_base` | rejected → `radixHeight` | rejected → `bridgeWidth` | — | — | — | — |
| `columella` | — | — | rejected → `columellarShow` | rejected → `columellarLobularAngle` | — | — |
| `septal_region` | — | — | rejected → `dorsalSeptalDeviation` | — | — | — |
| `left_side` | — | — | — | — | — | rejected → `leftRightAsymmetry` |
| `right_side` | — | — | — | — | — | rejected → `leftRightAsymmetry` |

Rejected cells can be reached only where a `manual: true` descriptor carries the
pair: `cheek`/`rotation` (the three angle sliders), `cheek`/`projection`
(`columellarShow`) and `nasal_tip`/`definition` (`tipDefinition`). The
`nasal_base`, `columella`, `septal_region`, `left_side` and `right_side` cells
have no manually adjustable descriptor at all, so they are unreachable from the
UI as well as from voice. No validated voice instruction can reach any rejected
cell, because `build_instruction` returns `unsupported` first.

### 7.3 What the matrix means

| Situation | Result |
| --- | --- |
| Voice command for a core pair | Applies, subject to status and range. |
| Voice command for `nasal_tip` / `definition` ("tip definition") | `unsupported`, because the tip allows `height`, `projection`, `rotation` only. |
| Voice command for a nasal angle | `needs_clarification` if no rotation direction is given, otherwise `unsupported`, because `cheek` allows `projection`, `fullness` only. |
| Voice command mentioning `nasal_base`, `columella`, `septal_region`, `left_side`, `right_side` | `unsupported` (if the LLM supplies the region) or `invalid` (rules parser finds no region). |
| Manual edit of any of the 28 sliders | Writes the mapped field, including collisions described in §5.1. |
| Reset | Sets all 32 fields to 0. |

If you add a new pair, update **all** of:

1. `TargetRegion` / `Parameter` if new enum values are needed.
2. `TARGET_PARAMETER_MAP` (`validation.py`).
3. A `ModelState` field and `initialModelState`.
4. A `ParamDescriptor` and `SIMULATED_PARAM_KEYS`.
5. `paramKeyFor` with a **unique** pair.
6. `deformPositions`, if the field should be visible.
7. Tests on both sides and §5 of this page.

See [Developer guide §8](DEVELOPER_GUIDE.md#8-extension-recipes) for the full
recipe.

---

## 8. Command mapping and state semantics

### 8.1 Signed magnitude

`signedMagnitude(command)` implements exactly:

| Operation | Sign |
| --- | --- |
| `increase` | `+` |
| `raise` | `+` |
| `widen` | `+` |
| `decrease` | `−` |
| `lower` | `−` |
| `narrow` | `−` |
| `rotate` | `−` if `direction === "down"`, otherwise `+` |
| anything else / `null` | `0` |

The magnitude is `command.value ?? 0`. There is no visual gain, easing or hidden
scale factor: the number shown in the review card is the number added to the
field.

### 8.2 Voice versus manual

| Property | Voice command | Manual command |
| --- | --- | --- |
| Created by | `Instruction` accepted from the backend | `createManualCommand(key, value)` |
| `source` | `"voice"` | `"manual"` |
| `status` | From validation | Always `"ok"` |
| `value` | Non-negative delta magnitude | Absolute target value, may be negative |
| Sign | From `operation` / `direction` | Encoded directly in `value` |
| `operation` | Parsed operation | `"increase"` if value ≥ 0, else `"decrease"` |
| `original_text` | The utterance | `Manual adjustment · <label>` |
| Validation | Full backend + frontend gates | None beyond a resolvable mapping |
| Effect | `newState[field] += signedMagnitude(command)` | `newState[field] = command.value` |
| Replay | Applied in order from zero | Applied in order, overwriting the field |

A manual command is absolute by design: dragging a core slider from +4 to +2
updates a single existing command so that it sets the field to 2, not a −2 delta.
Replaying the history therefore reconstructs the same state regardless of how many
intermediate slider events occurred. For a registered slider the aliasing defect
means `isManualFor` cannot find the previous command under the registered key, so
each input event appends another command that writes the core field; the final
value is still correct, but the history and audit trail grow quickly.

### 8.3 Replay, undo and reset

```text
initialModelState (all zero)
   │  applyCommand(…, cmd₁)
   │  applyCommand(…, cmd₂)
   │  …
   ▼
current ModelState
```

- `applyAllCommands(history)` always starts from `resetModel()`.
- Undo removes the selected command and replays the remaining history.
- Reset clears the history and returns `initialModelState`.
- Loading a scenario does **not** keep the previous history. `stateToCommands`
  converts every non-zero field in the scenario snapshot into an absolute manual
  command, and those commands become the new history. The working state is
  therefore reproduced through the same replay path, not assigned directly.
- Because replay is pure and order-dependent, a command that was accepted under
  an old mapping and a newer one can produce a different state after a code
  change; archives store the resulting `modelState`, not just the commands.

### 8.4 Live-mode gating

`evaluateLiveInstruction` returns one of:

| Result | When |
| --- | --- |
| `applied` | `ok`, no `adjusted_value`, resolvable key, non-zero delta. |
| `out_of_range` | `adjusted_value` is present. Checked after the `unsupported` branch, so an unsupported instruction is never reported as out of range. |
| `needs_clarification` | Status is `needs_clarification` (and no adjustment). |
| `unsupported` | Status is `unsupported`, or no key resolves. |
| `not_applied` | Status is `invalid`. |
| `no_change` | Status is `no_change`, `value` is null, or the computed delta is zero. |

The reason strings are written into the `LiveEvent`, so a rejected instruction is
never silently dropped. The before/after values are only populated for `applied`.

### 8.5 Effective mapping summary

| Wire pair | Field | Notes |
| --- | --- | --- |
| `nasal_bridge`/`height`, `nasal_dorsum`/`height` | `bridgeHeight` | Shared by three registered descriptors. |
| `nasal_bridge`/`width`, `nasal_dorsum`/`width` | `bridgeWidth` | |
| `nasal_tip`/`height` | `tipHeight` | Shared by `supratipBreak`; `tipDefinition` also lands here. |
| `nasal_tip`/`projection` | `tipProjection` | |
| `nasal_tip`/`rotation` | `tipRotation` | |
| `nostril_region`/`width` | `alarWidth` | Shared by `alarFlare`, `alarBaseWidth`. |
| `upper_lip`/`projection` | `upperLipProjection` | |
| `upper_lip`/`fullness` | `upperLipFullness` | |
| `lower_lip`/`projection` | `lowerLipProjection` | |
| `lower_lip`/`fullness` | `lowerLipFullness` | |
| `chin`/`projection` | `chinProjection` | |
| `chin`/`height` | `chinHeight` | |
| `chin`/`width` | `chinWidth` | |
| `jawline`/`width` | `jawWidth` | |
| `jawline`/`definition` | `jawDefinition` | `leftRightAsymmetry` branch is unreachable. |
| `cheek`/`projection` | `cheekProjection` | Shared by `columellarShow`. |
| `cheek`/`rotation` | `cheekProjection` | Manual-only; three angle sliders collide here. |
| `cheek`/`fullness` | `cheekFullness` | |
| `nasal_tip`/`definition` | `tipHeight` | Manual-only. |
| `nostril_region`/`definition` | `alarFlare` | Manual-only, but `nostrilShape`/`nostrilSymmetry` are `manual: false`, so no slider uses it today. |
| `nasal_base`/`height` | `radixHeight` | Unreachable from validated commands. |
| `nasal_base`/`width` | `bridgeWidth` | Unreachable. |
| `columella`/`projection` | `columellarShow` | Unreachable from validated commands. |
| `columella`/`rotation` | `columellarLobularAngle` | Unreachable. |
| `septal_region`/`projection` | `dorsalSeptalDeviation` | Unreachable. |
| `left_side`/`definition`, `right_side`/`definition` | `leftRightAsymmetry` | Unreachable. |

---

## 9. Storage schemas

### 9.1 Where data lives

| Data | Location | Survives reload? | Leaves the device? |
| --- | --- | --- | --- |
| Current `ModelState` | React memory | No | No |
| `Command[]` history | React memory | No | No |
| Consultation session | React memory | No | No |
| Scenarios | React memory; the archive keeps only `scenarioCount` and the scenario names inside the summary text | No | No |
| Archive | IndexedDB `voicesurg-history`, version 1 | Yes | No |
| Photographs | Browser memory / object URLs | No | No |
| Derived personalisation (`FaceMorph`, skin tone, profile) | Archive record, if saved | Yes | No |
| Command text | Sent to the local backend; optionally to Gemini | No | Yes, if LLM configured |
| API key | `.env` (gitignored) | — | Used only by backend |

### 9.2 IndexedDB layout

| Property | Value |
| --- | --- |
| Database | `voicesurg-history` |
| Version | `1` |
| Object store | `consultations` |
| Key path | `id` |
| Indexes | None |
| List order | `savedAt` descending, applied in memory after `getAll()` |
| Fallback | In-memory `Map<string, ArchivedConsultation>` when IndexedDB is missing or any operation throws |
| Clear | Clears memory first, then the object store if available |
| Test hook | `resetArchivedConsultationsMemory()` |

The fallback is transparent: the UI keeps working but records disappear on
reload. jsdom tests always exercise the fallback.

### 9.3 Archive lifecycle

1. The consultation is summarised with `buildConsultationReport`.
2. An `ArchivedConsultation` is assembled from the session, history and current
   state, plus optional personalisation and live events.
3. `saveArchivedConsultation` performs `put` by `id`; saving the same id replaces
   the record.
4. The archive list reads all records and sorts by `savedAt` descending.
5. Restoring converts every non-zero `modelState` field into an absolute manual
   command (`stateToCommands`), restores the stored `liveEvents`, optionally
   reapplies `personalization`, clears the selected scenario and appends a
   `consultation_restored` event. It does not re-run the parser or reconstruct
   the original transcript; the stored `summary` remains the narrative record.
6. Delete removes one record; clear removes all.

Scenario snapshots are not stored as structured data. Only `scenarioCount` and the
scenario names embedded in `summary` survive, and a restore does not rebuild the
scenario list, so scenarios must be recreated in a new session.

### 9.4 Personalisation limits

Only derived values are stored:

- `morph` — identity coefficients.
- `skinTone` — a sampled colour string.
- `profile` — reconstructed proportions.
- `photoName` — the file name for display.

Never stored: the image, a blob, a data URL, an object URL, landmarks, or the raw
detector output. A record saved before personalisation existed has no
`personalization` key; readers must treat it as absent, not corrupt.

### 9.5 Export formats

| Export | Function | Format | Notes |
| --- | --- | --- | --- |
| Consultation summary | `buildConsultationReport` | Markdown text | Human-readable; never claims clinical validity. |
| Live change log (CSV) | `buildLiveCsv` | RFC-4180-style CSV, CRLF | 18 columns, header described in §3.12. |
| Live change log (JSON) | `buildLiveJson` | Pretty-printed JSON | Wrapper with `exportedAt`, `count`, `events`. |
| Live change log (PDF) | `buildLivePdf` | PDF 1.4 | ASCII only, Helvetica, 58 lines per page. |

All exports are generated locally in the browser. No export endpoint exists.

### 9.6 Retention

There is no retention policy, no expiry and no server-side deletion, because
there is no server-side store. Deleting browser data, clearing site data, or using
a private window removes the archive. The in-memory fallback is discarded when
the tab closes.

---

## 10. Glossary

| Term | Meaning in this project |
| --- | --- |
| **alar** | Relating to the wing of the nose (`nostril_region`). |
| **alar base** | The tissue at the base of the nostril; mapped to nostril width in the lexicon. |
| **alar flare** | Lateral flaring of the alar wing; a registered parameter. |
| **alar width** | Core field `alarWidth`, independent of bridge width. |
| **adjusted_value** | Suggested in-range replacement for an over-limit request. Never applied automatically. |
| **batch / proposal** | One parse attempt and the instructions it produced. |
| **bridge** | Nasal dorsum between the radix and the tip (`nasal_bridge`). |
| **canonical unit** | `mm` for lengths, `degrees` for rotations. |
| **cm** | Input-only unit; multiplied by 10 into `mm`. |
| **Command** | An applied instruction plus `id`, `source` and `createdAt`. |
| **core parameter** | A parameter whose field is read by `deformPositions`. 17 today. |
| **deformPositions** | The pure geometry function that maps `ModelState` to vertex offsets. |
| **direction** | `up` or `down`, required for `rotate`. |
| **dorsum** | The upper surface of the nose; `nasal_dorsum` is accepted and shares bridge fields. |
| **hard negative** | A negation, keep-unchanged phrase, unsupported unit/region or `no_change` that short-circuits the LLM. |
| **indexedDB** | Browser database used for the local archive. |
| **Instruction** | The backend's validated wire object. |
| **live event** | A `LiveEvent` recorded for every handled instruction, applied or not. |
| **manual command** | An absolute slider edit (`source: "manual"`). |
| **ModelField** | Any key of `ModelState`. |
| **ModelState** | The 32-field parameter object that drives the mesh. |
| **nasal base** | Enum-only region; no supported parameters, so always `unsupported` from the backend. |
| **nasolabial angle** | Angle between columella and upper lip; registered as `cheek`/`rotation`. |
| **normalised value** | `value` after unit conversion and validation. |
| **nostril region** | `nostril_region`; supports `width` only. |
| **paramKeyFor** | The explicit `(target, parameter) → ModelField` mapping. |
| **ParamKey** | The 32-key union of model fields used by the registry and UI. |
| **parser** | Either the deterministic rules path or Gemini. |
| **`parser` field** | Which path produced the accepted instruction set. |
| **primitive** | A head mesh or geometry construct; not a clinical entity. |
| **proposal** | The consultation wrapper around a set of instructions and their outcome. |
| **registered parameter** | Declared, visible and manually adjustable, but not read by geometry. 11 today. |
| **requested_value** | The magnitude exactly as requested, in `requested_unit`. |
| **risk / safety gate** | The status/reason/adjusted-value mechanism that prevents unsafe application. |
| **rotation** | Angular change; the only angle parameter. |
| **rules parser** | Offline deterministic parser in `backend/app/parser.py`. |
| **scenario** | A named, absolute `ModelState` snapshot. |
| **septal region** | Enum-only region; no supported parameters. |
| **signedMagnitude** | Converts an operation plus non-negative value into a signed delta. |
| **status** | `ok`, `needs_clarification`, `unsupported`, `invalid`, `no_change`. |
| **tessellation** | The triangulation of a head mesh; not a clinical measurement. |
| **tip** | Nasal tip (`nasal_tip`); supports height, projection, rotation. |
| **unsupported parameter** | Declared with `supported: false`; inert by design. 4 today. |
| **voice command** | An instruction from the parser, as opposed to a slider edit. |

---

## 11. Symbol and file index

### 11.1 Backend

| Symbol | File | Role |
| --- | --- | --- |
| `app` | `backend/app/main.py` | FastAPI application, CORS, routes. |
| `CommandRequest` | `backend/app/schemas.py` | Request body. |
| `ParseResponse` | `backend/app/schemas.py` | Response body. |
| `Instruction` | `backend/app/schemas.py` | Wire instruction. |
| `ContextItem` | `backend/app/schemas.py` | Follow-up context. |
| `TARGET_PARAMETER_MAP` | `backend/app/validation.py` | Capability allow-list. |
| `LENGTH_LIMIT_MM` / `ANGLE_LIMIT_DEG` | `backend/app/validation.py` | Global magnitude limits. |
| `build_instruction` | `backend/app/validation.py` | Single validation entry point. |
| `parse_text` | `backend/app/parser.py` | Rules parser. |
| `flag_contradictions` | `backend/app/parser.py` | Cross-clause contradiction pass. |
| `parse_command` | `backend/app/parser_service.py` | Rules/LLM orchestration. |
| `MODEL_NAME` | `backend/app/llm_parser.py` | `gemini-2.5-flash`. |
| `LLM_CALL_TIMEOUT_S` | `backend/app/parser_service.py` | 12 s wall clock. |

### 11.2 Frontend

| Symbol | File | Role |
| --- | --- | --- |
| `ModelState` / `initialModelState` | `frontend/src/scene/transformations/types.ts` | State shape and zero baseline. |
| `Instruction` / `Command` | `frontend/src/scene/transformations/types.ts` | Wire instruction and local command. |
| `ParamKey` / `SIMULATED_PARAM_KEYS` | `frontend/src/scene/transformations/types.ts` | 32 keys and panel order. |
| `PARAM_DESCRIPTORS` | `frontend/src/lib/params.ts` | Registry of 32 descriptors. |
| `PARAM_GROUPS` | `frontend/src/lib/params.ts` | Five UI groups. |
| `REGION_OPTIONS` | `frontend/src/lib/params.ts` | 14 re-target regions. |
| `paramKeyFor` | `frontend/src/lib/params.ts` | Pair → field mapping. |
| `descriptorsForGroup` | `frontend/src/lib/params.ts` | Group listing. |
| `applyCommand` | `frontend/src/scene/transformations/logic.ts` | Apply one command. |
| `applyAllCommands` | `frontend/src/scene/transformations/logic.ts` | Replay history from zero. |
| `createManualCommand` | `frontend/src/scene/transformations/logic.ts` | Absolute slider command. |
| `signedMagnitude` | `frontend/src/scene/transformations/logic.ts` | Operation → sign. |
| `evaluateLiveInstruction` | `frontend/src/scene/live/logic.ts` | Live-mode gate. |
| `makeLiveEvent` | `frontend/src/scene/live/logic.ts` | Build a `LiveEvent`. |
| `buildLiveCsv` / `buildLiveJson` / `buildLivePdf` | `frontend/src/scene/live/logic.ts` | Exports. |
| `createSession` / `endSession` | `frontend/src/scene/session/logic.ts` | Session lifecycle. |
| `buildProposal` / `deriveProposalStatus` | `frontend/src/scene/session/logic.ts` | Proposal lifecycle. |
| `buildConsultationReport` | `frontend/src/scene/session/logic.ts` | Markdown summary. |
| `saveArchivedConsultation` / `listArchivedConsultations` | `frontend/src/lib/historyStore.ts` | Archive CRUD. |
| `parseCommandAPI` / `checkBackendHealth` | `frontend/src/services/api.ts` | HTTP client. |
| `statusMeta` / `isApplicable` / `describeCommand` | `frontend/src/lib/format.ts` | UI labels and applicability. |

### 11.3 Documentation map

| Question | Document |
| --- | --- |
| How does a sentence become a vertex change? | [Architecture §4](ARCHITECTURE.md#4-end-to-end-flows) |
| How is the head mesh built and deformed? | [Geometry and reconstruction](GEOMETRY_AND_RECONSTRUCTION.md) |
| What does the clinician see and click? | [User guide](USER_GUIDE.md) |
| How do I run, test or extend it? | [Developer guide](DEVELOPER_GUIDE.md) |
| What is the exact wire value? | This page |

---

*Maintained alongside the code. When the registry, API or validation rules change,
update the corresponding section here in the same change set.*
