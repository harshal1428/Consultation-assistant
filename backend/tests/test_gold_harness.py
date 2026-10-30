"""Contract tests for the new gold harness (not the old evaluator)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.eval.current_system import (
    CurrentSystemAdapter,
    load_live_decisions,
    load_parse_results,
    parse_offline,
)
from app.eval.gold_io import (
    BASELINE_PATH,
    CSV_PATH,
    LIVE_DECISIONS_PATH,
    PARSE_RESULTS_PATH,
    attach_splits,
    file_sha256,
    load_gold_rows,
)
from app.eval.metrics import SLOT_NAMES, evaluate
from app.eval.report import render_markdown, write_reports


class GoldHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = attach_splits(load_gold_rows(CSV_PATH))
        cls.parse = load_parse_results(PARSE_RESULTS_PATH)
        cls.decisions = load_live_decisions(LIVE_DECISIONS_PATH)
        cls.metrics = evaluate(cls.rows, cls.decisions)
        cls.metrics["gold_sha256"] = file_sha256(CSV_PATH)

    def test_parse_fixture_covers_every_row(self):
        self.assertEqual(len(self.rows), 265)
        self.assertEqual(set(self.parse), {row.key for row in self.rows})
        for row in self.rows:
            self.assertEqual(self.parse[row.key]["text"], row.text)
            self.assertEqual(self.parse[row.key]["instructions"], parse_offline(row.text)["instructions"])

    def test_live_fixture_uses_real_ts_decisions(self):
        self.assertEqual(set(self.decisions), {row.key for row in self.rows})
        payload = json.loads(LIVE_DECISIONS_PATH.read_text(encoding="utf-8"))
        self.assertIn("evaluateLiveInstruction", payload["note"])
        for key, decision in self.decisions.items():
            statuses = [item["status"] for item in decision["instructions"]]
            self.assertEqual(decision["would_apply_in_live"], "applied" in statuses, key)
            for item in decision["instructions"]:
                self.assertIn("instruction", item)
                self.assertIn("reason", item)
                self.assertIn("paramKey", item)

    def test_false_commit_denominator_is_all_non_command_rows(self):
        non_commands = [row for row in self.rows if not row.is_command]
        expected = sum(
            1
            for row in non_commands
            if self.decisions[row.key]["would_apply_in_live"]
        ) / len(non_commands)
        self.assertAlmostEqual(self.metrics["overall"]["false_commit_rate"], expected)
        self.assertEqual(self.metrics["overall"]["non_command_rows"], len(non_commands))
        self.assertEqual(self.metrics["overall"]["non_command_rows"], 165)

    def test_command_rates_use_command_rows(self):
        commands = [row for row in self.rows if row.is_command]
        self.assertEqual(self.metrics["overall"]["command_rows"], len(commands))
        self.assertEqual(self.metrics["overall"]["command_rows"], 100)
        missed = sum(
            1
            for row in commands
            if not any(
                item["status"] == "applied" for item in self.decisions[row.key]["instructions"]
            )
        )
        self.assertAlmostEqual(
            self.metrics["overall"]["missed_commit_rate"], missed / len(commands)
        )
        # Current baseline: the parser applies 74 of 100 command rows.
        self.assertEqual(self.metrics["overall"]["applied_command_rows"], 74)

    def test_slot_accuracy_is_bounded_and_complete(self):
        slots = self.metrics["overall"]["slot_accuracy"]
        self.assertEqual(set(slots), set(SLOT_NAMES))
        for name, item in slots.items():
            self.assertGreater(item["total"], 0, name)
            self.assertGreaterEqual(item["correct"], 0)
            self.assertLessEqual(item["correct"], item["total"])
            self.assertGreaterEqual(item["accuracy"], 0.0)
            self.assertLessEqual(item["accuracy"], 1.0)
        self.assertEqual(
            self.metrics["overall"]["speech_act_accuracy"],
            None,
        )

    def test_per_category_and_splits_are_present(self):
        expected_categories = {
            "direct_command", "proposal", "question", "confirm",
            "reject", "undo", "view", "chatter",
        }
        self.assertEqual(set(self.metrics["per_category"]), expected_categories)
        self.assertEqual(set(self.metrics["splits"]), {"dev", "test"})
        self.assertEqual(self.metrics["splits"]["dev"]["rows"], 185)
        self.assertEqual(self.metrics["splits"]["test"]["rows"], 80)
        for split in ("dev", "test"):
            self.assertIn("false_commit_rate", self.metrics["splits"][split])

    def test_markdown_contains_headline_and_failures(self):
        markdown = render_markdown(self.metrics)
        self.assertIn("False-commit rate", markdown)
        self.assertIn("Top failures", markdown)
        self.assertIn("evaluateLiveInstruction", markdown)

    def test_report_writes_json_and_markdown(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = write_reports(self.metrics, Path(tmp))
            self.assertTrue(paths["json"].exists())
            self.assertTrue(paths["markdown"].exists())
            payload = json.loads(paths["json"].read_text(encoding="utf-8"))
            self.assertEqual(payload["overall"]["rows"], 265)

    def test_baseline_is_committed_and_shaped(self):
        self.assertTrue(BASELINE_PATH.exists())
        baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(baseline["gold_sha256"], file_sha256(CSV_PATH))
        for key in (
            "false_commit_rate", "missed_commit_rate", "wrong_execution_rate",
            "command_slot_accuracy", "mean_abs_value_error_mm",
        ):
            self.assertIn(key, baseline["overall"])
        self.assertEqual(baseline["overall"]["false_commit_rate"], 0.0)

    def test_adapter_is_deterministic_and_offline(self):
        adapter = CurrentSystemAdapter()
        first = adapter.parse("Raise the bridge by 2 mm")
        second = adapter.parse("Raise the bridge by 2 mm")
        self.assertEqual(first, second)
        self.assertEqual(first["instructions"][0]["status"], "ok")
        self.assertEqual(first["instructions"][0]["parser"], "rules")


if __name__ == "__main__":
    unittest.main()
