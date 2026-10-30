"""Report rendering and baseline/ratchet helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

from .gold_io import BASELINE_PATH, CSV_PATH, REPORTS_DIR, file_sha256


def _rate(value) -> str:
    if value is None:
        return "n/a"
    return f"{value:.4f}"


def _pct(value) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.2f}%"


def _mae(value) -> str:
    if value is None:
        return "n/a"
    return f"{value:.4f}"


def _metric_table(metrics: Dict) -> str:
    return "\n".join(
        [
            f"| Rows | {metrics['rows']} |",
            f"| Direct-command rows | {metrics['command_rows']} |",
            f"| Non-command rows | {metrics['non_command_rows']} |",
            f"| **False-commit rate** | **{_rate(metrics['false_commit_rate'])}** "
            f"({metrics['false_commits']} rows) |",
            f"| Missed-commit rate | {_rate(metrics['missed_commit_rate'])} "
            f"({metrics['missed_commits']} rows) |",
            f"| Wrong-execution rate | {_rate(metrics['wrong_execution_rate'])} "
            f"({metrics['wrong_executions']} rows) |",
            f"| Applied command rows | {metrics['applied_command_rows']} |",
            f"| Slot accuracy (all slots) | {_pct(metrics['command_slot_accuracy'])} |",
            f"| Mean absolute value error (mm) | "
            f"{_mae(metrics['mean_abs_value_error_mm'])}"
            f" (n={metrics['value_error_n']}) |",
            f"| Speech-act accuracy | {_pct(metrics['speech_act_accuracy'])} |",
        ]
    )


def render_markdown(metrics: Dict) -> str:
    lines = [
        "# Gold-set evaluation",
        "",
        f"Gold SHA-256: `{metrics.get('gold_sha256') or ''}`  ",
        "Auto-apply decision: real `frontend/src/scene/live/logic.ts`",
        "`evaluateLiveInstruction` over exported parse fixtures.",
        "",
        "## Overall",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        _metric_table(metrics["overall"]),
        "",
        "## Split",
        "",
        "| Split | Rows | False commit | Missed commit | Wrong execution | Slot acc. |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for split in ("dev", "test"):
        item = metrics["splits"][split]
        lines.append(
            f"| {split} | {item['rows']} | {_rate(item['false_commit_rate'])} | "
            f"{_rate(item['missed_commit_rate'])} | {_rate(item['wrong_execution_rate'])} | "
            f"{_pct(item['command_slot_accuracy'])} |"
        )

    lines += [
        "",
        "## Slot accuracy (command rows)",
        "",
        "| Slot | Correct | Total | Accuracy |",
        "| --- | ---: | ---: | ---: |",
    ]
    for name, item in metrics["overall"]["slot_accuracy"].items():
        lines.append(
            f"| {name} | {item['correct']} | {item['total']} | {_pct(item['accuracy'])} |"
        )

    lines += [
        "",
        "## Per category",
        "",
        "| Category | Rows | False commits | False-commit rate |",
        "| --- | ---: | ---: | ---: |",
    ]
    for category, item in metrics["per_category"].items():
        if category == "direct_command":
            lines.append(
                f"| {category} | {item['rows']} | n/a (commands) | "
                f"missed {_rate(item['missed_commit_rate'])}; "
                f"wrong {_rate(item['wrong_execution_rate'])} |"
            )
        else:
            lines.append(
                f"| {category} | {item['rows']} | {item['false_commits']} | "
                f"{_rate(item['false_commit_rate'])} |"
            )

    lines += [
        "",
        "## Confusion matrix (reporting-only predicted act)",
        "",
    ]
    labels = sorted(metrics["confusion_matrix"])
    predicted = sorted(
        {pred for row in metrics["confusion_matrix"].values() for pred in row}
    )
    lines.append("| expected \\ predicted | " + " | ".join(predicted) + " |")
    lines.append("| --- | " + " | ".join("---:" for _ in predicted) + " |")
    for expected in labels:
        row = metrics["confusion_matrix"][expected]
        lines.append(
            f"| {expected} | " + " | ".join(str(row.get(pred, 0)) for pred in predicted) + " |"
        )

    lines += [
        "",
        "## Top failures",
        "",
    ]
    if not metrics.get("top_failures"):
        lines.append("None.")
    for failure in metrics.get("top_failures", []):
        lines.append(
            f"- **{failure['failure']}** `{failure['key']}` — {failure['text']!r}  "
            f"expected `{failure['expected_label']}` slots {failure['expected_slots']}; "
            f"got {failure['got']}"
        )
    lines += [
        "",
        "## Notes",
        "",
        "- `speech_act_accuracy` is N/A until the later commitment gate exposes a speech act.",
        "- The current system's confusion matrix labels are inferred from the parser reason; "
        "they are not used by the headline false-commit metric.",
        "- Rare categories have small test counts; per-category rates are descriptive, not precise.",
    ]
    return "\n".join(lines) + "\n"


def write_reports(metrics: Dict, out_dir: Path = REPORTS_DIR) -> Dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "latest.json"
    md_path = out_dir / "latest.md"
    json_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(metrics), encoding="utf-8")
    return {"json": json_path, "markdown": md_path}


def baseline_payload(metrics: Dict) -> Dict:
    return {
        "schema": 1,
        "gold_sha256": metrics.get("gold_sha256") or file_sha256(CSV_PATH),
        "overall": metrics["overall"],
        "splits": metrics["splits"],
        "per_category": metrics["per_category"],
        "confusion_matrix": metrics["confusion_matrix"],
    }


def write_baseline(metrics: Dict, path: Path = BASELINE_PATH) -> None:
    path.write_text(
        json.dumps(baseline_payload(metrics), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def load_baseline(path: Path = BASELINE_PATH) -> Dict:
    return json.loads(path.read_text(encoding="utf-8"))
