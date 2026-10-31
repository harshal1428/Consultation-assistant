# Clinical Parameter Registry

**Source of truth:** `shared/clinical_parameters.json` (schema version 1)  
**Consumers:** FastAPI backend (`backend/app/clinical_registry.py`) and React frontend (`frontend/src/lib/clinicalRegistry.ts`)  
**Status:** Research-driven registry, loaded at import time. Must stay consistent across backend and frontend.

## Purpose

The registry centralizes all recognized clinical concepts with explicit simulation status. It ensures:
- **Honesty**: Concepts without verified geometry drivers are never silently aliased to simulated parameters. They return `not_simulated`.
- **Authority**: `clinical_parameter` (key) is authoritative when present; coarse `target`/`parameter` pairs are retained for legacy review controls but must not guess model fields when a key exists.
- **No geometry changes**: The registry only annotates existing behavior; it does not add face/head geometry, topology, reconstruction changes, MediaPipe changes, or bundled assets.
- **Units**: Illustrative scene units (labelled mm) are not calibrated clinical millimetres. Degrees for angles, ratios as ratios (never coerced to mm).

## Schema (per entry)

| Field | Type | Description |
| --- | --- | --- |
| `key` | string | Stable identifier (snake_case). Authoritative key into the registry. |
| `clinicalName` | string | Human-readable clinical name. |
| `group` | `nose\|lips\|chin\|jawline\|cheeks\|face` | Anatomical group. |
| `anatomicalRegion` | string | Coarse anatomical region. |
| `parameterType` | `height\|width\|projection\|rotation\|fullness\|definition` | Conceptual type. |
| `valueKind` | `length\|angle\|ratio\|other` | Value kind. |
| `unit` | `mm\|degrees\|ratio\|null` | Canonical unit (or null if not applicable). |
| `definition` | string | Clinical definition. |
| `synonyms` | string[] | Phrases that match this concept (longest/specific match wins). |
| `operations` | string[] | Allowed operations for this concept. |
| `min`/`max`/`default` | number\|null | Illustrative bounds (not clinical limits). |
| `parser.status` | `supported\|registered` | Whether parser can directly recognize this concept. |
| `parser.target` | TargetRegion | Coarse target used for validation/review (may differ from anatomy). |
| `parser.parameter` | Parameter | Coarse parameter used for validation/review. |
| `reviewable` | boolean | Whether concept appears in review UI. |
| `simulation.status` | `simulated\|registered_not_simulated` | **Authoritative** for whether geometry driver exists. |
| `simulation.modelField` | string\|null | Model field name if simulated (must exist in `ModelState` and be geometry-wired). |
| `simulation.driver` | string\|null | Internal driver name if simulated. |
| `source` | string | Reference to docs (e.g., `docs/REFERENCE.md`). |
| `limitations` | string | Explicit limitation/honesty note. |

## Counts (as of current registry)

- **Total unique parameters:** 59
- **Simulated (geometry-backed):** 17
- **Registered but not simulated:** 42
- **Groups:** nose (24), lips (11), face (7), chin (6), jawline (6), cheeks (5)

### Simulated parameters (17) — geometry-backed
Only these map to actual deform drivers in `frontend/src/scene/transformations/*` and are exposed as simulation controls:

| Key | Clinical name | Group | Model field | Parser target/param |
| --- | --- | --- | --- | --- |
| `bridge_height` | Nasal bridge height | nose | `bridgeHeight` | nasal_bridge/height |
| `bridge_width` | Nasal bridge width | nose | `bridgeWidth` | nasal_bridge/width |
| `tip_projection` | Nasal tip projection | nose | `tipProjection` | nasal_tip/projection |
| `tip_height` | Nasal tip height | nose | `tipHeight` | nasal_tip/height |
| `tip_rotation` | Nasal tip rotation | nose | `tipRotation` | nasal_tip/rotation |
| `alar_width` | Alar width | nose | `alarWidth` | nostril_region/width |
| `upper_lip_projection` | Upper lip projection | lips | `upperLipProjection` | upper_lip/projection |
| `lower_lip_projection` | Lower lip projection | lips | `lowerLipProjection` | lower_lip/projection |
| `upper_lip_fullness` | Upper lip fullness | lips | `upperLipFullness` | upper_lip/fullness |
| `lower_lip_fullness` | Lower lip fullness | lips | `lowerLipFullness` | lower_lip/fullness |
| `chin_projection` | Chin projection | chin | `chinProjection` | chin/projection |
| `chin_height` | Chin height | chin | `chinHeight` | chin/height |
| `chin_width` | Chin width | chin | `chinWidth` | chin/width |
| `mandibular_width` | Mandibular width | jawline | `jawWidth` | jawline/width |
| `jawline_definition` | Jawline definition | jawline | `jawDefinition` | jawline/definition |
| `malar_projection` | Malar projection | cheeks | `cheekProjection` | cheek/projection |
| `cheek_fullness` | Cheek fullness | cheeks | `cheekFullness` | cheek/fullness |

### Registered but not simulated (42) — key examples
Recognized, reviewable, must return `not_simulated` (never applied to mesh):

| Key | Clinical name | Group | Unit | Parser target/param | Notes |
| --- | --- | --- | --- | --- | --- |
| `dorsal_hump_reduction` | Dorsal hump reduction | nose | mm | nasal_bridge/height | No independent hump driver; must not alias to bridge height. |
| `nasal_length` | Nasal length | nose | mm | nasal_bridge/height | No independent length driver. |
| `nasofrontal_angle` | Nasofrontal angle | nose | degrees | nasal_bridge/rotation | No angle driver. |
| `nasolabial_angle` | Nasolabial angle | nose | degrees | cheek/rotation | No angle driver. |
| `columellar_show` | Columellar show | nose | mm | cheek/projection | Must not alias cheek projection. |
| `columellar_lobular_angle` | Columellar-lobular angle | nose | degrees | cheek/rotation | No angle driver. |
| `tip_definition` | Nasal tip definition | nose | mm | nasal_tip/definition | No definition driver. |
| `supratip_break` | Supratip break | nose | mm | nasal_tip/height | No driver. |
| `alar_flare`/`alar_base_width` | Alar flare/base width | nose | mm | nostril_region/width | No drivers (separate from `alar_width`). |
| `dorsal_deviation`/`septal_deviation`/`dorsal_asymmetry` | Deviations/asymmetries | nose | mm | various | Laterality often needs clarification; no drivers. |
| `mentolabial_angle` | Mentolabial angle | chin | degrees | chin/rotation | No angle driver. |
| `gonial_angle` | Gonial angle | jawline | degrees | jawline/rotation | No angle driver. |
| `jawline_contour` | Jawline contour | jawline | - | jawline/definition | No driver. |
| `midface_contour` | Midface contour | cheeks | - | cheek/definition | No driver. |
| `facial_thirds`/`facial_fifths`/`facial_width`/`facial_height`/`facial_symmetry`/`midline_deviation`/`regional_proportions` | Proportions/symmetry | face | ratio/mm/- | various | No calibrated face-wide drivers. |

## Resolution rules

1. **Clinical match first**: Parser calls `match_clinical_parameter(clause)`. If ambiguous (equal best matches), parser sets `needs_clarification` with candidates listed; it does **not** pick a simulated parameter.
2. **Key authority**: If `clinical_parameter` key is set, coarse `target`/`parameter` are taken from the registry for that key (or validated against it). The key determines simulation status.
3. **Longest/specific wins**: Synonym matching uses longest-phrase-first ordering to prefer specific concepts (e.g., "dorsal hump reduction" over generic "dorsal/hump").
4. **No unsafe aliases**: Removed generic aliases like tip definition→tip height, alar flare→alar width, columellar show→cheek projection. Each concept is treated separately.
5. **Not simulated enforcement**: `validation` checks `is_simulated_key` (via `clinical_registry.model_field_for_key`). If key exists but not simulated, instruction becomes `status: "not_simulated"` with reason like "Registered concept but no verified geometry driver exists (illustrative only)". Parser service has a hard-negative so Gemini cannot substitute a simulated concept.
6. **Pair consistency**: Coarse target/parameter must be consistent with registry when key present; contradiction grouping includes `clinical_parameter` so different concepts with same coarse pair are not falsely paired.
7. **Context inheritance**: Corrections/antecedents can inherit `clinical_parameter` key when unambiguous.
8. **Simulation bounds**: Bounds are only enforced for simulated concepts; non-simulated concepts skip simulation bounds.

## Loading and validation

- **Backend**: `backend/app/clinical_registry.py` loads from `shared/clinical_parameters.json` at import. Validates schema (1), required fields, simulated entries have `modelField` and `driver`, parser mappings are valid enums, no duplicate keys.
- **Frontend**: `frontend/src/lib/clinicalRegistry.ts` loads the same JSON (bundled). Provides `clinicalParameterFor(key)`, `isSimulatedClinicalKey(key)`, `modelFieldForClinicalKey(key)`, `pairForClinicalKey(key)`, `simulationStatusLabel(status)`.
- **Frontend params**: `frontend/src/lib/params.ts` is limited to the 17 geometry-backed fields (`SIMULATED_PARAM_KEYS`). Registered-only concepts are not exposed as interactive simulation controls.

## Adding a new parameter

1. Add entry to `shared/clinical_parameters.json` with complete schema fields.
2. If `simulation.status == "simulated"`, ensure `modelField` exists in `ModelState`, is wired in geometry (`frontend/src/scene/transformations/*`), and add to `SIMULATED_PARAM_KEYS`.
3. Add synonyms/operations carefully; consider ambiguity with existing concepts.
4. Add parser support if needed (synonyms, operations, context).
5. Update tests (`backend/tests/test_clinical_registry.py`, `frontend/tests/params.test.ts`) and docs.
6. Run backend pytest and frontend Vitest.

## References

- Research sources consulted (see `docs/RESEARCH_EVALUATION_REPORT.md`): Brito et al., *Facial Analysis for Rhinoplasty*, PMC7159929 (2020); neoclassical canons / Farkas anthropometry (descriptive only). Terms used are standard anatomical/analysis terminology; the registry is a vocabulary layer for this prototype, not a clinical guideline.
- See also: `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/VOICE.md`.
