"""Structural, label, value, and split tests for the read-only gold set."""

from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from app.eval.gold_io import (
    CSV_PATH,
    REQUIRED_COLUMNS,
    SPLITS_PATH,
    attach_splits,
    category_for_label,
    file_sha256,
    load_gold_rows,
    load_splits,
)
from tests.gold.make_splits import build_split
from tests.gold.validate_gold import validate

BACKEND = Path(__file__).resolve().parents[2]


def _write_csv(path: Path, rows: list[dict], columns: list[str] = REQUIRED_COLUMNS) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _base_row(**overrides):
    row = {
        "text": "Raise the bridge by 2 mm",
        "label": "command",
        "parameter": "height",
        "direction": "up",
        "value": "2",
        "unit": "mm",
        "side": "",
        "note": "",
        "conversation_id": "s1",
        "turn_index": "1",
        "source": "synthetic",
    }
    row.update(overrides)
    return row


class GoldDatasetTests(unittest.TestCase):
    def test_committed_gold_set_is_valid(self):
        result = validate(CSV_PATH, check_near_duplicates=False)
        self.assertTrue(result.ok, result.errors)
        self.assertEqual(result.rows, 265)
        self.assertEqual(result.sha256, file_sha256(CSV_PATH))
        self.assertIn("command", result.label_counts)
        self.assertEqual(result.category_counts["direct_command"], 100)
        self.assertEqual(result.category_counts["proposal"], 59)

    def test_labels_are_documented(self):
        rows = load_gold_rows()
        for row in rows:
            self.assertIn(row.canonical_label, {
                "command", "proposal", "question", "confirm",
                "reject", "undo", "view", "ignored",
            })
            self.assertIn(row.category, {
                "direct_command", "proposal", "question", "confirm",
                "reject", "undo", "view", "chatter",
            })
        self.assertEqual(category_for_label("command;width"), "direct_command")

    def test_missing_required_column_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            _write_csv(path, [_base_row()], columns=[c for c in REQUIRED_COLUMNS if c != "unit"])
            result = validate(path, check_near_duplicates=False)
            self.assertFalse(result.ok)
            self.assertTrue(any("missing required columns" in e.lower() for e in result.errors))

    def test_empty_text_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            _write_csv(path, [_base_row(text="   ")])
            result = validate(path, check_near_duplicates=False)
            self.assertFalse(result.ok)
            self.assertTrue(any("empty utterance text" in e for e in result.errors))

    def test_unknown_label_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            _write_csv(path, [_base_row(label="shout")])
            result = validate(path, check_near_duplicates=False)
            self.assertFalse(result.ok)
            self.assertTrue(any("unknown label" in e for e in result.errors))

    def test_unknown_compound_suffix_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            _write_csv(path, [_base_row(label="command;volume")])
            result = validate(path, check_near_duplicates=False)
            self.assertFalse(result.ok)
            self.assertTrue(any("compound-label parameter" in e for e in result.errors))

    def test_unparseable_value_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            _write_csv(path, [_base_row(value="quite a lot")])
            result = validate(path, check_near_duplicates=False)
            self.assertFalse(result.ok)
            self.assertTrue(any("unparseable value" in e for e in result.errors))

    def test_unparseable_unit_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            _write_csv(path, [_base_row(unit="bananas")])
            result = validate(path, check_near_duplicates=False)
            self.assertFalse(result.ok)
            self.assertTrue(any("unparseable unit" in e for e in result.errors))

    def test_known_column_shifts_are_repaired_and_reported(self):
        rows = {row.key: row for row in load_gold_rows()}
        self.assertEqual(rows["sess197:1"].value, "2")
        self.assertEqual(rows["sess197:1"].source, "synthetic")
        self.assertEqual(rows["sess248:1"].note, "mixed unclear")
        self.assertTrue(rows["sess129:1"].repaired)


class GoldSplitTests(unittest.TestCase):
    def test_splits_cover_every_row_once(self):
        rows = attach_splits(load_gold_rows())
        keys = [row.key for row in rows]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual({row.split for row in rows}, {"dev", "test"})
        self.assertEqual(sum(1 for row in rows if row.split == "dev"), 185)
        self.assertEqual(sum(1 for row in rows if row.split == "test"), 80)

    def test_split_is_stratified_and_deterministic(self):
        committed = load_splits()
        rebuilt = build_split(committed["seed"])
        self.assertEqual(committed["assignments"], rebuilt["assignments"])
        self.assertEqual(committed["source_sha256"], file_sha256(CSV_PATH))
        for label in ("command", "proposal", "ignored", "question", "undo"):
            assigned = [
                value
                for key, value in committed["assignments"].items()
                if key in {
                    row.key for row in load_gold_rows() if row.canonical_label == label
                }
            ]
            self.assertGreater(len(assigned), 0)
            if len(assigned) > 1:
                self.assertIn("dev", assigned)
                self.assertIn("test", assigned)

    def test_conversations_do_not_cross_splits(self):
        rows = attach_splits(load_gold_rows())
        by_conversation = {}
        for row in rows:
            by_conversation.setdefault(row.conversation_id, set()).add(row.split)
        for conversation, splits in by_conversation.items():
            self.assertEqual(len(splits), 1, conversation)


if __name__ == "__main__":
    unittest.main()
