"""Tests for the versioned research clinical-vocabulary evaluation set."""

from __future__ import annotations

import unittest
from collections import Counter

from app.clinical_registry import CLINICAL_PARAMETERS
from app.eval.research import (
    SUPPORTED_VERSION,
    evaluate_research,
    load_research_rows,
    render_markdown,
)


class ResearchDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = load_research_rows()
        cls.result = evaluate_research(cls.rows)

    def test_dataset_is_versioned_and_balanced(self):
        self.assertEqual({row.dataset_version for row in self.rows}, {SUPPORTED_VERSION})
        self.assertEqual(len(self.rows), 68)
        self.assertEqual(len({row.id for row in self.rows}), 68)
        self.assertEqual(
            set(Counter(row.group for row in self.rows)),
            {"nose", "lips", "chin", "jawline", "cheeks", "face"},
        )

    def test_every_key_exists_and_matches_its_simulation_status(self):
        for row in self.rows:
            if not row.expected_clinical_parameter:
                continue
            parameter = CLINICAL_PARAMETERS.get(row.expected_clinical_parameter)
            self.assertIsNotNone(
                parameter,
                f"{row.id} references unknown key {row.expected_clinical_parameter}",
            )
            if parameter.simulated:
                # A simulated concept may still need clarification when the
                # utterance omits a required direction or magnitude.
                self.assertIn(
                    row.expected_status,
                    {"ok", "needs_clarification"},
                    f"{row.id} must not claim a simulated concept failed",
                )
                self.assertEqual(
                    row.expected_unit,
                    parameter.unit.value if parameter.unit else "",
                )
            else:
                self.assertIn(
                    row.expected_status,
                    {"not_simulated", "needs_clarification"},
                    f"{row.id} must not claim a registered-only concept was applied",
                )

    def test_no_gold_overlap_is_enforced(self):
        # load_research_rows raises before this point on exact normalised overlap.
        self.assertEqual(len(self.rows), 68)

    def test_metrics_meet_the_v1_floor(self):
        overall = self.result["overall"]
        self.assertEqual(overall["critical_false_applications"], [])
        self.assertGreaterEqual(overall["status_accuracy"], 0.98)
        self.assertGreaterEqual(overall["clinical_parameter_accuracy"], 0.95)
        self.assertGreaterEqual(overall["exact_match_accuracy"], 0.95)
        self.assertGreaterEqual(overall["not_simulated_recall"], 0.95)
        self.assertGreaterEqual(overall["simulated_recall"], 0.95)
        self.assertLessEqual(overall["mean_abs_value_error"], 0.001)

    def test_registered_only_rows_never_apply(self):
        from app.eval.current_system import parse_offline

        for row in self.rows:
            if row.expected_status != "not_simulated":
                continue
            with self.subTest(row=row.id):
                instruction = parse_offline(row.text)["instructions"][0]
                self.assertEqual(instruction["status"], "not_simulated")
                self.assertEqual(
                    instruction["clinical_parameter"],
                    row.expected_clinical_parameter,
                )

    def test_markdown_report_has_per_group_and_per_parameter_sections(self):
        markdown = render_markdown(self.result)
        self.assertIn("## Per anatomical group", markdown)
        self.assertIn("## Per clinical parameter", markdown)
        for group in ("nose", "lips", "chin", "jawline", "cheeks", "face"):
            self.assertIn(f"| {group} |", markdown)
        self.assertIn("| `dorsal_hump_reduction` |", markdown)


if __name__ == "__main__":
    unittest.main()
