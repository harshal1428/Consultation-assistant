# Research clinical-vocabulary evaluation (v1)

This report is generated from the versioned evaluation-only dataset in `backend/tests/research/clinical_vocabulary_v1.csv`. It is separate from the read-only gold set and is not used for training or prompt tuning.

## Overall

| Metric | Value |
| --- | --- |
| Rows | 68 |
| Exact row match | 100.00% |
| Status accuracy | 100.00% |
| Clinical-key accuracy | 100.00% |
| Target accuracy | 100.00% |
| Parameter accuracy | 100.00% |
| Operation accuracy | 100.00% |
| Value accuracy | 100.00% |
| Unit accuracy | 100.00% |
| Not-simulated recall | 100.00% |
| Simulated recall | 100.00% |
| Critical false applications | 0 |
| Mean absolute value error | 0.0 (n=60) |

## Per anatomical group

| Group | Rows | Exact | Status | Clinical key | Not-simulated recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| cheeks | 5 | 100.00% | 100.00% | 100.00% | 100.00% |
| chin | 5 | 100.00% | 100.00% | 100.00% | 100.00% |
| face | 7 | 100.00% | 100.00% | 100.00% | 100.00% |
| jawline | 6 | 100.00% | 100.00% | 100.00% | 100.00% |
| lips | 12 | 100.00% | 100.00% | 100.00% | 100.00% |
| nose | 33 | 100.00% | 100.00% | 100.00% | 100.00% |

## Per clinical parameter

| Clinical parameter | Rows | Exact | Status | Value | Unit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `alar_asymmetry` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `alar_base_width` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `alar_flare` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `alar_width` | 2 | 100.00% | 100.00% | 100.00% | 100.00% |
| `bridge_height` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `bridge_width` | 2 | 100.00% | 100.00% | 100.00% | 100.00% |
| `cheek_asymmetry` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `cheek_fullness` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `cheek_width` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `chin_asymmetry` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `chin_height` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `chin_width` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `columellar_show` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `cupids_bow_definition` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `dorsal_contour` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `dorsal_deviation` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `dorsal_hump_reduction` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `facial_fifths` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `facial_height` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `facial_symmetry` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `facial_thirds` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `facial_width` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `gonial_angle` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `jaw_asymmetry` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `jawline_contour` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `jawline_definition` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `lip_asymmetry` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `lower_face_width` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `lower_lip_fullness` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `lower_lip_height` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `lower_lip_projection` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `malar_projection` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `mandibular_width` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `mentolabial_angle` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `midface_contour` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `midline_deviation` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `nasal_length` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `nasofrontal_angle` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `nasolabial_angle` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `nostril_width` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `oral_commissure_position` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `philtrum_length` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `regional_proportions` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `septal_deviation` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `supratip_break` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `tip_definition` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `tip_height` | 2 | 100.00% | 100.00% | 100.00% | 100.00% |
| `tip_projection` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `tip_rotation` | 3 | 100.00% | 100.00% | 100.00% | 100.00% |
| `upper_lip_fullness` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `upper_lip_height` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `upper_lip_projection` | 2 | 100.00% | 100.00% | 100.00% | 100.00% |
| `vermilion_height` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |
| `vertical_chin_proportion` | 1 | 100.00% | 100.00% | 100.00% | 100.00% |

## Mismatches

None.

## Interpretation limits

- This is a small, typed evaluation set, not a clinically validated corpus.
- `not_simulated` is the correct outcome for registered concepts without a verified geometry driver; those rows are not expected to change the mesh.
- Real microphone/ASR behavior is covered separately in `docs/VOICE_PIPELINE_VERIFICATION.md`.

