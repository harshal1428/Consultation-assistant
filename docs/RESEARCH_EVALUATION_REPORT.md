# Research Evaluation Report

**Dataset:** `backend/tests/research/clinical_vocabulary_v1.csv` (evaluation-only, versioned)  
**Evaluator:** `backend/app/eval/research.py`  
**Reports:** `backend/tests/research/research_v1_report.json`, `backend/tests/research/research_v1_report.md`  
**Tests:** `backend/tests/test_research_eval.py` (6 tests, 38 subtests passing)

## Research docs inspected

- **Repository docs:** `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/GEOMETRY_AND_RECONSTRUCTION.md`, `docs/VOICE.md`, `docs/AUDIT.md`, `docs/DEVELOPER_GUIDE.md`, `docs/PROJECT_BRIEF.md`
- **Gold evaluation:** `backend/tests/gold/*` (read-only dataset, baseline/reports)
- **Clinical references consulted (external):**
  - Brito IM, Avalos NA, Piccinini Filho L, et al. Facial Analysis for Rhinoplasty. *Plast Reconstr Surg Glob Open.* 2020;8(4):e2732. doi: 10.1097/GOX.0000000000002732. PMID: PMC7159929. https://pmc.ncbi.nlm.nih.gov/articles/PMC7159929/
  - Neoclassical canons / facial proportion analysis (descriptive reference): e.g. Farkas LG, anthropometric studies; comparisons noting high variability across populations (e.g., Vegter & Hage 2000; Mommaerts & Moerenhout 2011). These are **descriptive**, not universal ideals.
- **Internal sources:** `shared/clinical_parameters.json` definitions, `backend/tests/gold/utterances.csv` (read-only)

## Dataset design

- **Purpose:** Measure recognition of registered-but-not-simulated concepts, ambiguity handling, and honesty (no silent application). Separate from gold set.
- **Versioning:** `dataset_version: v1`. New versions required for changes; no edits to gold.
- **Leakage prevention:** Exact normalized text overlap with gold rejected by loader. Duplicate ids/texts rejected.
- **Coverage:** 68 rows across nose (33), lips (12), face (7), jawline (6), cheeks (5), chin (5). All 6 groups represented.
- **Fields:** text, group, expected_status, expected_clinical_parameter, expected_target, expected_parameter, expected_operation, expected_value, expected_unit, notes.

## Results (v1)

### Overall
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

### Per group
| Group | Rows | Exact | Status | Clinical key | Not-simulated recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| cheeks | 5 | 100.00% | 100.00% | 100.00% | 100.00% |
| chin | 5 | 100.00% | 100.00% | 100.00% | 100.00% |
| face | 7 | 100.00% | 100.00% | 100.00% | 100.00% |
| jawline | 6 | 100.00% | 100.00% | 100.00% | 100.00% |
| lips | 12 | 100.00% | 100.00% | 100.00% | 100.00% |
| nose | 33 | 100.00% | 100.00% | 100.00% | 100.00% |

All 52 clinical parameters in the dataset achieve 100% exact/status/value/unit. Critical false applications: 0.

## Interpretation limits

- **Small targeted set:** 68 rows designed for vocabulary coverage, not an unbiased benchmark. 100% reflects designed coverage and small size.
- **Typed text only:** No ASR errors, noise, or microphone conditions. Real-voice evaluation separate (see `VOICE_PIPELINE_VERIFICATION.md`).
- **Prototype scope:** Units illustrative, not calibrated. Some concepts intentionally ambiguous (e.g., "reduce dorsal asymmetry") require clarification.
- **Evaluation-only:** Never used for training/prompt fitting/parameter tuning. Loader enforces no-leakage.

## How to run
```powershell
cd backend
..\ .venv\Scripts\python.exe -m app.eval.research
```
Generates `research_v1_report.json` and `research_v1_report.md`.

## Future work
- Expand dataset with more ambiguity cases and cross-region phrasings.
- Add ASR-corrupted variants once real models evaluated.
- Add population-appropriate proportion examples with ratio units.
- Consider inter-annotator agreement if moving toward clinical validation (separate from prototype).
