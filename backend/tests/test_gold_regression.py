"""Ratchet regression test for the committed gold baseline.

A normal test run never changes `baseline.json`. Updating it requires:

    python -m app.eval.cli --update-baseline

after the changed behaviour has been reviewed.
"""

from __future__ import annotations

import json
import unittest

from app.eval.current_system import load_live_decisions
from app.eval.gold_io import (
    BASELINE_PATH,
    CSV_PATH,
    LIVE_DECISIONS_PATH,
    attach_splits,
    file_sha256,
    load_gold_rows,
)
from app.eval.metrics import evaluate

# Allowed noise. Rates must not fall by more than one point; value MAE may drift
# by 0.05 mm. False commits have no allowance: they must never increase.
RATE_TOLERANCE = 0.01
MAE_TOLERANCE_MM = 0.05


class GoldRatchetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = attach_splits(load_gold_rows(CSV_PATH))
        cls.metrics = evaluate(cls.rows, load_live_decisions(LIVE_DECISIONS_PATH))
        cls.metrics["gold_sha256"] = file_sha256(CSV_PATH)
        cls.baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))

    def test_gold_set_identity_matches_baseline(self):
        self.assertEqual(
            self.metrics["gold_sha256"],
            self.baseline["gold_sha256"],
            "The gold CSV changed. Review the metrics, then run "
            "`python -m app.eval.cli --update-baseline` explicitly.",
        )

    def test_false_commit_rate_does_not_increase(self):
        current = self.metrics["overall"]["false_commit_rate"]
        baseline = self.baseline["overall"]["false_commit_rate"]
        self.assertLessEqual(current, baseline + 1e-12)

    def test_missed_commit_rate_does_not_increase_materially(self):
        current = self.metrics["overall"]["missed_commit_rate"]
        baseline = self.baseline["overall"]["missed_commit_rate"]
        self.assertLessEqual(current, baseline + RATE_TOLERANCE)

    def test_wrong_execution_rate_does_not_increase_materially(self):
        current = self.metrics["overall"]["wrong_execution_rate"]
        baseline = self.baseline["overall"]["wrong_execution_rate"]
        self.assertLessEqual(current, baseline + RATE_TOLERANCE)

    def test_slot_accuracy_does_not_drop_materially(self):
        current = self.metrics["overall"]["command_slot_accuracy"]
        baseline = self.baseline["overall"]["command_slot_accuracy"]
        self.assertGreaterEqual(current, baseline - RATE_TOLERANCE)

    def test_value_error_does_not_increase_materially(self):
        current = self.metrics["overall"]["mean_abs_value_error_mm"]
        baseline = self.baseline["overall"]["mean_abs_value_error_mm"]
        if current is None or baseline is None:
            self.assertEqual(current, baseline)
        else:
            self.assertLessEqual(current, baseline + MAE_TOLERANCE_MM)

    def test_split_false_commit_does_not_increase(self):
        for split in ("dev", "test"):
            current = self.metrics["splits"][split]["false_commit_rate"]
            baseline = self.baseline["splits"][split]["false_commit_rate"]
            self.assertLessEqual(current, baseline + 1e-12, split)

    def test_per_category_false_commit_does_not_increase(self):
        for category, item in self.baseline["per_category"].items():
            if category == "direct_command":
                continue
            current = self.metrics["per_category"][category]["false_commit_rate"]
            self.assertLessEqual(current, item["false_commit_rate"] + 1e-12, category)


if __name__ == "__main__":
    unittest.main()
