#!/usr/bin/env python3
"""Validate the gold utterance set without modifying it.

Hard failures are limited to structural problems:

* missing required columns;
* empty utterance text;
* a label outside the documented vocabulary (compound labels are allowed only
  when the base label is known and every suffix is a known parameter);
* unparseable parameter/direction/value/unit/side values.

Data-quality warnings (duplicates, near-duplicates, rare labels, repaired
columns) are printed but do not fail the command. Run from ``backend/``:

    python tests/gold/validate_gold.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

# Allow direct execution from the backend directory and from the repository root.
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.eval.gold_io import (  # noqa: E402
    BASE_LABELS,
    CSV_PATH,
    DIRECTION_VOCAB,
    PARAMETER_VOCAB,
    REQUIRED_COLUMNS,
    SIDE_VOCAB,
    UNIT_VOCAB,
    canonical_label,
    file_sha256,
    is_numeric,
    label_parts,
    load_gold_rows,
    near_duplicate_pairs,
    normalise_text,
)


@dataclass
class ValidationResult:
    rows: int = 0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    label_counts: Dict[str, int] = field(default_factory=dict)
    category_counts: Dict[str, int] = field(default_factory=dict)
    repaired_rows: List[str] = field(default_factory=list)
    duplicates: List[str] = field(default_factory=list)
    near_duplicates: List[str] = field(default_factory=list)
    rare_categories: List[str] = field(default_factory=list)
    sha256: str = ""

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "rows": self.rows,
            "sha256": self.sha256,
            "errors": self.errors,
            "warnings": self.warnings,
            "label_counts": self.label_counts,
            "category_counts": self.category_counts,
            "repaired_rows": self.repaired_rows,
            "duplicates": self.duplicates,
            "near_duplicates": self.near_duplicates,
            "rare_categories": self.rare_categories,
        }


def _validate_label(label: str) -> Optional[str]:
    parts = label_parts(label)
    if not parts:
        return "empty label"
    if parts[0] not in BASE_LABELS:
        return f"unknown label {parts[0]!r}"
    for suffix in parts[1:]:
        if suffix not in PARAMETER_VOCAB:
            return f"unknown compound-label parameter {suffix!r} in {label!r}"
    return None


def _validate_slots(row) -> List[str]:
    errors = []
    for name, values, allowed in (
        ("parameter", row.parameters, PARAMETER_VOCAB),
        ("direction", row.directions, DIRECTION_VOCAB),
        ("unit", row.units, UNIT_VOCAB),
        ("side", row.sides, SIDE_VOCAB),
    ):
        for value in values:
            if value and value not in allowed:
                errors.append(
                    f"line {row.line_number}: unparseable {name} {value!r} in {row.key!r}"
                )
    for value in row.values:
        if value and not is_numeric(value):
            errors.append(
                f"line {row.line_number}: unparseable value {value!r} in {row.key!r}"
            )
    return errors


def validate(path: Path = CSV_PATH, check_near_duplicates: bool = True) -> ValidationResult:
    result = ValidationResult(sha256=file_sha256(path))
    try:
        rows = load_gold_rows(path)
    except Exception as exc:  # missing columns / unreadable file
        result.errors.append(str(exc))
        return result

    result.rows = len(rows)
    result.label_counts = dict(Counter(row.label for row in rows))
    result.category_counts = dict(Counter(row.category for row in rows))
    result.repaired_rows = [row.key for row in rows if row.repaired]

    seen_text = defaultdict(list)
    for row in rows:
        if not row.text.strip():
            result.errors.append(f"line {row.line_number}: empty utterance text")
        label_error = _validate_label(row.label)
        if label_error:
            result.errors.append(f"line {row.line_number} ({row.key}): {label_error}")
        result.errors.extend(_validate_slots(row))
        if not row.conversation_id:
            result.errors.append(f"line {row.line_number}: missing conversation_id")
        if not row.turn_index:
            result.errors.append(f"line {row.line_number}: missing turn_index")
        seen_text[normalise_text(row.text)].append(row.key)

    for text, keys in seen_text.items():
        if len(keys) > 1:
            result.duplicates.append(f"{text!r}: {', '.join(keys)}")
    if result.duplicates:
        result.warnings.append(f"{len(result.duplicates)} exact duplicate utterance(s)")

    if check_near_duplicates:
        texts = [row.text for row in rows]
        exact = {key for key, keys in seen_text.items() if len(keys) > 1}
        for i, j, score in near_duplicate_pairs(texts, threshold=95.0):
            if normalise_text(texts[i]) == normalise_text(texts[j]) and normalise_text(texts[i]) in exact:
                continue
            result.near_duplicates.append(
                f"{rows[i].key} ~ {rows[j].key} ({score:.1f})"
            )
        if result.near_duplicates:
            result.warnings.append(
                f"{len(result.near_duplicates)} near-duplicate utterance(s) (>95 similarity)"
            )

    minimum = max(1, int(round(result.rows * 0.05)))
    for category, count in sorted(result.category_counts.items()):
        if count < minimum:
            result.rare_categories.append(f"{category}: {count} row(s) (<{minimum})")
    if result.rare_categories:
        result.warnings.append(
            "rare label categories: " + "; ".join(result.rare_categories)
        )
    if result.repaired_rows:
        result.warnings.append(
            "known column-shift repair applied to: " + ", ".join(result.repaired_rows)
        )
    return result


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=CSV_PATH)
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument(
        "--no-near-duplicates",
        action="store_true",
        help="skip O(n^2) near-duplicate checking",
    )
    args = parser.parse_args(argv)
    result = validate(args.path, check_near_duplicates=not args.no_near_duplicates)
    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    else:
        print(f"Gold rows: {result.rows}")
        print(f"SHA-256: {result.sha256}")
        print("Labels:", json.dumps(result.label_counts, sort_keys=True))
        print("Categories:", json.dumps(result.category_counts, sort_keys=True))
        for warning in result.warnings:
            print(f"WARNING: {warning}")
        for error in result.errors:
            print(f"ERROR: {error}")
        print("OK" if result.ok else "FAILED")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
