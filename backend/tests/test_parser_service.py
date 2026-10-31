"""Orchestration / fallback-policy tests with the Gemini call mocked.

No network is used: ``app.parser_service.parse_with_llm`` is patched.
"""

import time
import unittest
from unittest import mock

from app import parser_service
from app.llm_parser import LlmError
from app.schemas import InstructionStatus, ParserSource


class ParserServicePolicyTests(unittest.TestCase):
    def test_falls_back_to_rules_when_llm_unavailable(self):
        with mock.patch.object(
            parser_service, "parse_with_llm", side_effect=LlmError("no key")
        ):
            result = parser_service.parse_command("Reduce the bridge by 2 mm")
        self.assertEqual(len(result.instructions), 1)
        self.assertEqual(result.instructions[0].parser, ParserSource.rules)
        self.assertEqual(result.instructions[0].status, InstructionStatus.ok)

    def test_uses_llm_when_it_returns_valid_intent(self):
        raw = [
            {
                "target": "nasal_bridge",
                "parameter": "height",
                "operation": "increase",
                "value": 2,
                "unit": "mm",
                "confidence": 0.9,
                "original_text": "raise the bridge by 2 mm",
            }
        ]
        with mock.patch.object(parser_service, "parse_with_llm", return_value=raw):
            result = parser_service.parse_command("raise the bridge by 2 mm")
        self.assertEqual(result.instructions[0].parser, ParserSource.llm)
        self.assertEqual(result.instructions[0].status, InstructionStatus.ok)
        self.assertEqual(result.instructions[0].target.value, "nasal_bridge")

    def test_hard_negative_bypasses_llm_entirely(self):
        with mock.patch.object(parser_service, "parse_with_llm") as llm:
            result = parser_service.parse_command("Do not reduce the bridge")
        llm.assert_not_called()
        self.assertEqual(result.instructions[0].status, InstructionStatus.no_change)

    def test_registered_only_concept_bypasses_llm_entirely(self):
        with mock.patch.object(parser_service, "parse_with_llm") as llm:
            result = parser_service.parse_command("Reduce the dorsal hump by 1 mm")
        llm.assert_not_called()
        self.assertEqual(
            result.instructions[0].status, InstructionStatus.not_simulated
        )
        self.assertEqual(
            result.instructions[0].clinical_parameter, "dorsal_hump_reduction"
        )

    def test_llm_cannot_substitute_a_simulated_pair_without_a_key(self):
        raw = [
            {
                "target": "nostril_region",
                "parameter": "width",
                "clinical_parameter": "alar_flare",
                "operation": "narrow",
                "value": 1,
                "unit": "mm",
                "confidence": 0.9,
                "original_text": "narrow the alar flare by 1 mm",
            }
        ]
        with mock.patch.object(parser_service, "parse_with_llm", return_value=raw):
            result = parser_service.parse_command("Narrow the alar flare by 1 mm")
        self.assertEqual(
            result.instructions[0].status, InstructionStatus.not_simulated
        )

    def test_all_invalid_llm_output_falls_back_to_rules(self):
        raw = [{"target": "lips", "operation": "increase", "value": 2, "unit": "mm"}]
        with mock.patch.object(parser_service, "parse_with_llm", return_value=raw):
            result = parser_service.parse_command("Reduce the bridge by 2 mm")
        self.assertEqual(result.instructions[0].parser, ParserSource.rules)
        self.assertEqual(result.instructions[0].status, InstructionStatus.ok)

    def test_llm_hang_times_out_and_falls_back_to_rules(self):
        def slow(*_args, **_kwargs):
            time.sleep(0.6)
            return []

        with mock.patch.object(parser_service, "parse_with_llm", side_effect=slow):
            with mock.patch.object(parser_service, "LLM_CALL_TIMEOUT_S", 0.1):
                result = parser_service.parse_command("Reduce the bridge by 2 mm")
        self.assertEqual(result.instructions[0].parser, ParserSource.rules)
        self.assertEqual(result.instructions[0].status, InstructionStatus.ok)

    def test_qualitative_guard_strips_llm_invented_value(self):
        raw = [
            {
                "target": "nasal_tip",
                "parameter": "height",
                "operation": "raise",
                "value": 3,
                "unit": "mm",
                "confidence": 0.8,
                "original_text": "raise the tip slightly",
            }
        ]
        with mock.patch.object(parser_service, "parse_with_llm", return_value=raw):
            result = parser_service.parse_command("raise the tip slightly")
        ins = result.instructions[0]
        self.assertEqual(ins.status, InstructionStatus.needs_clarification)
        self.assertIsNone(ins.value)


if __name__ == "__main__":
    unittest.main()
