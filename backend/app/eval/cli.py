"""Gold-set evaluation CLI.

Typical sequence (from ``backend/``):

    python -m app.eval.cli --export
    cd ../frontend && npx vitest run tests/goldLiveDecisions.test.ts
    cd ../backend && python -m app.eval.cli --write-report

``--update-baseline`` is intentionally explicit: the committed baseline is not
changed by a normal report run.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from .current_system import (
    export_parse_results,
    load_live_decisions,
    load_parse_results,
)
from .gold_io import (
    BASELINE_PATH,
    CSV_PATH,
    LIVE_DECISIONS_PATH,
    PARSE_RESULTS_PATH,
    SPLITS_PATH,
    attach_splits,
    file_sha256,
    load_gold_rows,
    load_splits,
)
from .metrics import evaluate
from .report import load_baseline, render_markdown, write_baseline, write_reports


def _rows_with_splits():
    rows = attach_splits(load_gold_rows(CSV_PATH))
    return rows


def _load_decisions():
    return load_live_decisions(LIVE_DECISIONS_PATH)


def _check_fixtures(rows, decisions) -> list:
    problems = []
    parse_rows = load_parse_results(PARSE_RESULTS_PATH)
    row_keys = {row.key for row in rows}
    parse_keys = set(parse_rows)
    decision_keys = set(decisions)
    if row_keys - parse_keys:
        problems.append(
            "parse_results.json is missing rows: "
            + ", ".join(sorted(row_keys - parse_keys)[:10])
        )
    if parse_keys - row_keys:
        problems.append(
            "parse_results.json has unknown rows: "
            + ", ".join(sorted(parse_keys - row_keys)[:10])
        )
    if row_keys - decision_keys:
        problems.append(
            "live_decisions.json is missing rows: "
            + ", ".join(sorted(row_keys - decision_keys)[:10])
        )
    if decision_keys - row_keys:
        problems.append(
            "live_decisions.json has unknown rows: "
            + ", ".join(sorted(decision_keys - row_keys)[:10])
        )
    for row in rows:
        parsed = parse_rows.get(row.key)
        if parsed and parsed.get("text") != row.text:
            problems.append(f"{row.key}: parse fixture text is stale")
        decision = decisions.get(row.key)
        if decision and decision.get("text") not in (None, row.text):
            problems.append(f"{row.key}: live decision text is stale")
    return problems


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", action="store_true", help="write parse_results.json")
    parser.add_argument("--check", action="store_true", help="verify committed fixtures")
    parser.add_argument("--write-report", action="store_true", help="write ignored reports")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="explicitly replace tests/gold/baseline.json",
    )
    parser.add_argument("--json", action="store_true", help="print metrics JSON")
    args = parser.parse_args(argv)

    rows = _rows_with_splits()

    if args.export:
        export_parse_results(rows, PARSE_RESULTS_PATH)
        print(f"Wrote {PARSE_RESULTS_PATH}")
        print(
            "Now run: cd frontend && npx vitest run tests/goldLiveDecisions.test.ts",
            file=sys.stderr,
        )

    try:
        decisions = _load_decisions()
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.check:
        problems = _check_fixtures(rows, decisions)
        if problems:
            for problem in problems:
                print(f"ERROR: {problem}", file=sys.stderr)
            return 1
        print(
            f"Fixtures OK: {len(rows)} rows, "
            f"gold sha256 {file_sha256(CSV_PATH)}"
        )

    metrics = evaluate(rows, decisions)
    metrics["gold_sha256"] = file_sha256(CSV_PATH)
    metrics["splits_path"] = str(SPLITS_PATH.relative_to(SPLITS_PATH.parents[2]))
    metrics["parse_fixture_sha256"] = file_sha256(PARSE_RESULTS_PATH)
    metrics["live_fixture_sha256"] = file_sha256(LIVE_DECISIONS_PATH)

    if args.json:
        print(json.dumps(metrics, indent=2, ensure_ascii=False))

    if args.write_report or args.update_baseline or not (args.check or args.export or args.json):
        paths = write_reports(metrics)
        print(f"Wrote {paths['markdown']}")
        print(f"Wrote {paths['json']}")
        print(render_markdown(metrics).split("## Top failures", 1)[0])

    if args.update_baseline:
        write_baseline(metrics, BASELINE_PATH)
        print(f"Updated baseline: {BASELINE_PATH}")

    if args.check and not args.write_report and not args.update_baseline and not args.json:
        baseline = load_baseline(BASELINE_PATH)
        print(
            "Baseline false_commit_rate="
            f"{baseline['overall']['false_commit_rate']:.4f}; current="
            f"{metrics['overall']['false_commit_rate']:.4f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
