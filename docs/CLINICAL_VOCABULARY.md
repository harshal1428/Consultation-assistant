# Clinical Vocabulary

**Source of truth:** `shared/clinical_parameters.json`  
**Matching:** Backend `backend/app/clinical_registry.py` (`match_clinical_parameter`)

## Matching precedence

1. **Clause-based matching**: `match_clinical_parameter` searches synonyms within the clause (longest phrase first, then length).
2. **Specificity wins**: "dorsal hump reduction" beats generic "dorsal" or "hump". Generic bridge/dorsal/tip synonyms were removed where they caused incorrect overrides.
3. **Ambiguity detection**: Equal best matches (e.g., "reduce the dorsal hump and dorsal deviation") return `ambiguous` with candidate keys; parser marks `needs_clarification` and does **not** choose a simulated parameter.
4. **Context inheritance**: Corrections ("same, but 3 mm") and antecedents can inherit `clinical_parameter` when unambiguous.
5. **Coarse pair inference**: Only used when no clinical key is matched; coarse `target`/`parameter` come from synonym lists in `backend/app/parser.py`.

## Operations

| Operation | Triggers (examples) | Notes |
| --- | --- | --- |
| `increase`/`raise_` | increase, raise, add, advance, elevate, plump, fill, enlarge, augment | Directional synonyms normalized. |
| `decrease`/`lower` | decrease, lower, reduce, shorten, subtract, minimize, deproject, retract, deflate, close, take off, bring back, set back | `deproject`/`deflate` added. `shorten`/`lengthen` for nose length. |
| `rotate` | rotate, rotation, rotated, tilt | **Only** rotate/rotation/rotated/tilt imply rotation. The noun "angle" alone does **not** trigger rotate. |
| `narrow` | narrow, taper | Explicit width operation. |
| `widen` | widen, flare | Explicit width operation. |

## Units

| Unit | Notes |
| --- | --- |
| `mm` | Canonical for lengths; illustrative scene units, not calibrated clinical mm. |
| `cm` | Normalized to mm on input. |
| `degrees` | For angles (e.g., nasolabial angle). Never coerced to mm. |
| `ratio` | For proportions (e.g., facial thirds/fifths). Never coerced to mm. |

## High-risk confusions (enforced)

| Phrase | Correct behavior | Why |
| --- | --- | --- |
| "reduce dorsal hump by 1 mm" | `dorsal_hump_reduction`, `not_simulated` | No hump driver; must not become bridge height reduction. |
| "shorten the nose / lengthen the nose" | `nasal_length`, `not_simulated` | No independent length driver. |
| "increase/decrease columellar show" | `columellar_show`, `not_simulated` | Must not alias to cheek projection. |
| "change nasolabial angle" | `nasolabial_angle`, `not_simulated` (rotation needs direction/clarification) | Angle requires direction or clarification; no angle driver. |
| "increase alar flare / alar base width" | `alar_flare`/`alar_base_width`, `not_simulated` | Separate from simulated `alar_width`. |
| "reduce dorsal asymmetry" | Ambiguous between `dorsal_deviation` and `dorsal_asymmetry` → `needs_clarification` | Intentionally ambiguous; side/direction required. |
| "tip definition" | `tip_definition`, `not_simulated` | Must not become tip height. |
| "deproject the tip" | Recognized operation; may be `not_simulated` depending on concept | `deproject` added to operations. |

## Special cases

- **Bare "lips"**: Ambiguous between upper/lower lip → `needs_clarification` (unless clinical key already resolves).
- **"rotate ... by X degrees" without direction**: Rotation direction required → `needs_clarification`.
- **Contradictory actions**: "raise and lower..." → `needs_clarification`.
- **Proposals/hedges**: "maybe raise..." / "perhaps..." → marked as proposal/ambiguous, not auto-applied.
- **Numbers without units**: Treated as mm by default in context of length parameters; units still tracked.
- **Face proportions**: `facial_thirds`, `facial_fifths`, `facial_width`, `facial_height` are registered (`ratio`/`mm`) but `registered_not_simulated` with no calibrated driver.

## Validation behavior

- **Clinical key consistency**: If key present, target/parameter validated against registry; inconsistent values can be corrected/rejected per rules.
- **Simulation enforcement**: Non-simulated keys → `status: "not_simulated"` (never `ok`/applied). Parser service hard-negative prevents LLM from substituting simulated concept.
- **Bounds**: Only enforced for simulated concepts. Non-simulated concepts skip simulation bounds.
- **Review-first**: Voice transcripts use `parseText(text, "voice")`; Live uses review-first commitment path. `not_simulated` instructions appear in review with clear disclosure.

## Adding vocabulary

When adding synonyms:
- Prefer specific phrases over generic words.
- Avoid creating aliases to simulated parameters.
- Test for ambiguity with existing concepts.
- Update `shared/clinical_parameters.json` (source of truth). Both backend and frontend load from it.
- Run `backend/tests/test_clinical_registry.py` and `frontend/tests/params.test.ts`.
