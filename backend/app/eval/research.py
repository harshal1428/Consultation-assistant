"""Research evaluation for clinical vocabulary, separate from the gold set.

The gold set in ``backend/tests/gold`` remains read-only and measures the
original voice-command contract. This module evaluates the broader clinical
registry vocabulary, including concepts that are registered/reviewable but have
no verified geometry driver.

It is intentionally evaluation-only: the CSV under ``backend/tests/research``
is never used for training, prompt examples or fitting. The loader rejects
duplicate ids/texts and exact text overlap with the gold set.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from .current_system import parse_offline
from .gold_io import CSV_PATH as GOLD_CSV_PATH, load_gold_rows

RESEARCH_DIR = Path(__file__).resolve().parents[2] / "tests" / "research"
DATASET_PATH = RESEARCH_DIR / "clinical_vocabulary_v1.csv"
REPORT_JSON_PATH = RESEARCH_DIR / "research_v1_report.json"
REPORT_MD_PATH = RESEARCH_DIR / "research_v1_report.md"
SUPPORTED_VERSION = "v1"
SUPPORTED_GROUPS = {"nose", "lips", "chin", "jawline", "cheeks", "face"}
MISSING_INSTRUCTION_STATUS = "none"


@dataclass(frozen=True)
class ResearchRow:
    dataset_version: str
    id: str
    text: str
    group: str
    expected_status: str
    expected_clinical_parameter: str
    expected_target: str
    expected_parameter: str
    expected_operation: str
    expected_value: Optional[float]
    expected_unit: str
    notes: str


def _normalise_compare(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_value(raw: str) -> Optional[float]:
    raw = raw.strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"Invalid research expected_value: {raw!r}") from exc


def load_research_rows(path: Path = DATASET_PATH) -> List[ResearchRow]:
    if not path.exists():
        raise FileNotFoundError(f"Research dataset does not exist: {path}")
    rows: List[ResearchRow] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {
            "dataset_version",
            "id",
            "text",
            "group",
            "expected_status",
            "expected_clinical_parameter",
            "expected_target",
            "expected_parameter",
            "expected_operation",
            "expected_value",
            "expected_unit",
            "notes",
        }
        if reader.fieldnames is None or not required.issubset(reader.fieldnames):
            missing = required.difference(reader.fieldnames or [])
            raise ValueError(f"Research dataset is missing columns: {sorted(missing)}")
        for raw in reader:
            version = (raw["dataset_version"] or "").strip()
            if version != SUPPORTED_VERSION:
                raise ValueError(
                    f"{raw.get('id')}: unsupported dataset_version {version!r}; "
                    f"expected {SUPPORTED_VERSION!r}"
                )
            group = (raw["group"] or "").strip()
            if group not in SUPPORTED_GROUPS:
                raise ValueError(f"{raw.get('id')}: unsupported group {group!r}")
            row = ResearchRow(
                dataset_version=version,
                id=(raw["id"] or "").strip(),
                text=(raw["text"] or "").strip(),
                group=group,
                expected_status=(raw["expected_status"] or "").strip(),
                expected_clinical_parameter=(
                    raw["expected_clinical_parameter"] or ""
                ).strip(),
                expected_target=(raw["expected_target"] or "").strip(),
                expected_parameter=(raw["expected_parameter"] or "").strip(),
                expected_operation=(raw["expected_operation"] or "").strip(),
                expected_value=_parse_value(raw["expected_value"] or ""),
                expected_unit=(raw["expected_unit"] or "").strip(),
                notes=(raw["notes"] or "").strip(),
            )
            if not row.id or not row.text:
                raise ValueError("Research rows require a non-empty id and text")
            rows.append(row)

    ids = [row.id for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Research dataset contains duplicate ids")

    text_keys = [_normalise_compare(row.text) for row in rows]
    if len(text_keys) != len(set(text_keys)):
        raise ValueError("Research dataset contains duplicate texts")

    gold_keys = {_normalise_compare(gold.text) for gold in load_gold_rows(GOLD_CSV_PATH)}
    leaked = [row.id for row, key in zip(rows, text_keys) if key in gold_keys]
    if leaked:
        raise ValueError(
            "Research dataset overlaps the gold set (no train/test leakage): "
            + ", ".join(leaked)
        )
    return rows


def _field(instruction: Dict, name: str) -> str:
    if name == "clinical_parameter":
        return (instruction.get("clinical_parameter") or "").strip()
    if name in {"target", "parameter", "operation", "unit"}:
        return (instruction.get(name) or "").strip()
    if name == "status":
        return (instruction.get("status") or MISSING_INSTRUCTION_STATUS).strip()
    raise ValueError(name)


def _first_instruction(parsed_row: Dict) -> Dict:
    instructions = parsed_row.get("instructions") or []
    return instructions[0] if instructions else {}


def _value_equal(expected: Optional[float], instruction: Dict) -> bool:
    actual = instruction.get("value")
    if expected is None:
        return actual is None
    if actual is None:
        return False
    return math.isclose(expected, float(actual), rel_tol=1e-9, abs_tol=1e-9)


def _summarise(rows: Sequence[ResearchRow], parsed: Dict[str, Dict]) -> Dict:
    fields = (
        "status",
        "clinical_parameter",
        "target",
        "parameter",
        "operation",
    )
    counts = {name: {"correct": 0, "total": 0} for name in fields}
    value_correct = 0
    value_total = 0
    unit_correct = 0
    unit_total = 0
    exact_rows = 0
    critical_false_applications: List[str] = []
    mismatches: List[Dict] = []
    value_errors: List[float] = []

    for row in rows:
        instruction = _first_instruction(parsed.get(row.id, {}))
        row_ok = True
        for name in fields:
            counts[name]["total"] += 1
            expected = getattr(row, f"expected_{name}")
            actual = _field(instruction, name)
            if expected == actual:
                counts[name]["correct"] += 1
            else:
                row_ok = False

        value_total += 1
        if _value_equal(row.expected_value, instruction):
            value_correct += 1
        else:
            row_ok = False

        unit_total += 1
        if row.expected_unit == _field(instruction, "unit"):
            unit_correct += 1
        else:
            row_ok = False

        if (
            row.expected_value is not None
            and instruction.get("value") is not None
            and row.expected_unit == _field(instruction, "unit")
            and row.expected_unit in {"mm", "degrees", "ratio"}
        ):
            value_errors.append(
                abs(float(row.expected_value) - float(instruction["value"]))
            )

        if row.expected_status != "ok" and _field(instruction, "status") == "ok":
            critical_false_applications.append(row.id)

        if row_ok:
            exact_rows += 1
        else:
            mismatches.append(
                {
                    "id": row.id,
                    "text": row.text,
                    "group": row.group,
                    "expected": {
                        "status": row.expected_status,
                        "clinical_parameter": row.expected_clinical_parameter,
                        "target": row.expected_target,
                        "parameter": row.expected_parameter,
                        "operation": row.expected_operation,
                        "value": row.expected_value,
                        "unit": row.expected_unit,
                    },
                    "got": {
                        "status": _field(instruction, "status"),
                        "clinical_parameter": _field(
                            instruction, "clinical_parameter"
                        ),
                        "target": _field(instruction, "target"),
                        "parameter": _field(instruction, "parameter"),
                        "operation": _field(instruction, "operation"),
                        "value": instruction.get("value"),
                        "unit": _field(instruction, "unit"),
                        "reason": instruction.get("reason"),
                    },
                }
            )

    def rate(correct: int, total: int) -> Optional[float]:
        return round(correct / total, 4) if total else None

    not_simulated_expected = [row for row in rows if row.expected_status == "not_simulated"]
    not_simulated_correct = [
        row
        for row in not_simulated_expected
        if _field(_first_instruction(parsed.get(row.id, {})), "status")
        == "not_simulated"
    ]
    ok_expected = [row for row in rows if row.expected_status == "ok"]
    ok_correct = [
        row
        for row in ok_expected
        if _field(_first_instruction(parsed.get(row.id, {})), "status") == "ok"
    ]

    return {
        "rows": len(rows),
        "exact_rows": exact_rows,
        "exact_match_accuracy": rate(exact_rows, len(rows)),
        "status_accuracy": rate(counts["status"]["correct"], counts["status"]["total"]),
        "clinical_parameter_accuracy": rate(
            counts["clinical_parameter"]["correct"],
            counts["clinical_parameter"]["total"],
        ),
        "target_accuracy": rate(counts["target"]["correct"], counts["target"]["total"]),
        "parameter_accuracy": rate(
            counts["parameter"]["correct"], counts["parameter"]["total"]
        ),
        "operation_accuracy": rate(
            counts["operation"]["correct"], counts["operation"]["total"]
        ),
        "value_accuracy": rate(value_correct, value_total),
        "unit_accuracy": rate(unit_correct, unit_total),
        "mean_abs_value_error": (
            round(sum(value_errors) / len(value_errors), 6) if value_errors else None
        ),
        "value_error_n": len(value_errors),
        "not_simulated_recall": rate(
            len(not_simulated_correct), len(not_simulated_expected)
        ),
        "simulated_recall": rate(len(ok_correct), len(ok_expected)),
        "critical_false_applications": critical_false_applications,
        "mismatches": mismatches,
    }


def evaluate_research(rows: Sequence[ResearchRow]) -> Dict:
    parsed = {
        row.id: parse_offline(row.text)
        for row in rows
    }
    overall = _summarise(rows, parsed)

    by_group: Dict[str, List[ResearchRow]] = defaultdict(list)
    for row in rows:
        by_group[row.group].append(row)
    per_group = {
        group: _summarise(group_rows, parsed)
        for group, group_rows in sorted(by_group.items())
    }

    by_parameter: Dict[str, List[ResearchRow]] = defaultdict(list)
    for row in rows:
        if row.expected_clinical_parameter:
            by_parameter[row.expected_clinical_parameter].append(row)
    per_parameter = {
        key: _summarise(parameter_rows, parsed)
        for key, parameter_rows in sorted(by_parameter.items())
    }

    return {
        "dataset": {
            "path": str(DATASET_PATH.relative_to(DATASET_PATH.parents[3])),
            "version": SUPPORTED_VERSION,
            "rows": len(rows),
            "note": (
                "Evaluation-only clinical vocabulary set; never used for training "
                "or prompt fitting; no exact overlap with the gold set."
            ),
        },
        "overall": overall,
        "per_group": per_group,
        "per_parameter": per_parameter,
    }


def _compact(summary: Dict) -> str:
    return (
        f"{summary['exact_match_accuracy']:.2%} exact · "
        f"status {summary['status_accuracy']:.2%} · "
        f"key {summary['clinical_parameter_accuracy']:.2%}"
    )


def render_markdown(result: Dict) -> str:
    overall = result["overall"]
    lines = [
        "# Research clinical-vocabulary evaluation (v1)",
        "",
        "This report is generated from the versioned evaluation-only dataset in "
        "`backend/tests/research/clinical_vocabulary_v1.csv`. It is separate from "
        "the read-only gold set and is not used for training or prompt tuning.",
        "",
        "## Overall",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| Rows | {overall['rows']} |",
        f"| Exact row match | {overall['exact_match_accuracy']:.2%} |",
        f"| Status accuracy | {overall['status_accuracy']:.2%} |",
        f"| Clinical-key accuracy | {overall['clinical_parameter_accuracy']:.2%} |",
        f"| Target accuracy | {overall['target_accuracy']:.2%} |",
        f"| Parameter accuracy | {overall['parameter_accuracy']:.2%} |",
        f"| Operation accuracy | {overall['operation_accuracy']:.2%} |",
        f"| Value accuracy | {overall['value_accuracy']:.2%} |",
        f"| Unit accuracy | {overall['unit_accuracy']:.2%} |",
        f"| Not-simulated recall | {overall['not_simulated_recall']:.2%} |",
        f"| Simulated recall | {overall['simulated_recall']:.2%} |",
        f"| Critical false applications | {len(overall['critical_false_applications'])} |",
        (
            "| Mean absolute value error | "
            f"{overall['mean_abs_value_error']} "
            f"(n={overall['value_error_n']}) |"
            if overall["mean_abs_value_error"] is not None
            else "| Mean absolute value error | n/a |"
        ),
        "",
        "## Per anatomical group",
        "",
        "| Group | Rows | Exact | Status | Clinical key | Not-simulated recall |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for group, summary in result["per_group"].items():
        lines.append(
            f"| {group} | {summary['rows']} | "
            f"{summary['exact_match_accuracy']:.2%} | "
            f"{summary['status_accuracy']:.2%} | "
            f"{summary['clinical_parameter_accuracy']:.2%} | "
            f"{summary['not_simulated_recall']:.2%} |"
        )

    lines += [
        "",
        "## Per clinical parameter",
        "",
        "| Clinical parameter | Rows | Exact | Status | Value | Unit |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key, summary in result["per_parameter"].items():
        lines.append(
            f"| `{key}` | {summary['rows']} | "
            f"{summary['exact_match_accuracy']:.2%} | "
            f"{summary['status_accuracy']:.2%} | "
            f"{summary['value_accuracy']:.2%} | "
            f"{summary['unit_accuracy']:.2%} |"
        )

    lines += [
        "",
        "## Mismatches",
        "",
    ]
    if not overall["mismatches"]:
        lines.append("None.")
    else:
        lines += [
            "| Id | Text | Expected | Got |",
            "| --- | --- | --- | --- |",
        ]
        for mismatch in overall["mismatches"]:
            expected = mismatch["expected"]
            got = mismatch["got"]
            expected_text = (
                f"{expected['status']} / {expected['clinical_parameter'] or '-'} / "
                f"{expected['target'] or '-'} / {expected['parameter'] or '-'} / "
                f"{expected['value'] if expected['value'] is not None else '-'}"
                f"{(' ' + expected['unit']) if expected['unit'] else ''}"
            )
            got_text = (
                f"{got['status']} / {got['clinical_parameter'] or '-'} / "
                f"{got['target'] or '-'} / {got['parameter'] or '-'} / "
                f"{got['value'] if got['value'] is not None else '-'}"
                f"{(' ' + got['unit']) if got['unit'] else ''}"
            )
            lines.append(
                f"| {mismatch['id']} | {mismatch['text']} | "
                f"{expected_text} | {got_text} |"
            )

    lines += [
        "",
        "## Interpretation limits",
        "",
        "- This is a small, typed evaluation set, not a clinically validated corpus.",
        "- `not_simulated` is the correct outcome for registered concepts without a "
        "verified geometry driver; those rows are not expected to change the mesh.",
        "- Real microphone/ASR behavior is covered separately in "
        "`docs/VOICE_PIPELINE_VERIFICATION.md`.",
        "",
    ]
    return "\n".join(lines)


def write_reports(result: Dict, json_path: Path = REPORT_JSON_PATH, md_path: Path = REPORT_MD_PATH) -> None:
    json_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    md_path.write_text(render_markdown(result) + "\n", encoding="utf-8")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="Print metrics without rewriting the committed report files.",
    )
    args = parser.parse_args(argv)

    rows = load_research_rows()
    result = evaluate_research(rows)
    if not args.no_write:
        write_reports(result)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if not result["overall"]["critical_false_applications"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
