"""Tests for the shared clinical registry and the parser's vocabulary layer."""

from __future__ import annotations

import unittest

from app.clinical_registry import (
    CLINICAL_PARAMETERS,
    REGISTRY_PATH,
    get_clinical_parameter,
    is_simulated_key,
    match_clinical_parameter,
    model_field_for_key,
)
from app.parser import parse_text
from app.schemas import InstructionStatus, Parameter, ParserSource, TargetRegion, Unit
from app.validation import build_instruction

SIMULATED_MODEL_FIELDS = {
    "bridgeHeight",
    "bridgeWidth",
    "tipHeight",
    "tipProjection",
    "tipRotation",
    "alarWidth",
    "upperLipProjection",
    "upperLipFullness",
    "lowerLipProjection",
    "lowerLipFullness",
    "chinProjection",
    "chinHeight",
    "chinWidth",
    "jawWidth",
    "jawDefinition",
    "cheekProjection",
    "cheekFullness",
}


class ClinicalRegistryIntegrityTests(unittest.TestCase):
    def test_registry_loads_the_shared_file(self):
        self.assertTrue(REGISTRY_PATH.exists())
        self.assertEqual(len(CLINICAL_PARAMETERS), 59)
        self.assertEqual(len({p.key for p in CLINICAL_PARAMETERS.values()}), 59)

    def test_exactly_seventeen_parameters_are_simulated(self):
        simulated = {p for p in CLINICAL_PARAMETERS.values() if p.simulated}
        self.assertEqual(len(simulated), 17)
        self.assertEqual(
            {p.model_field for p in simulated},
            SIMULATED_MODEL_FIELDS,
        )
        for parameter in simulated:
            self.assertEqual(parameter.simulation_status, "simulated")
            self.assertTrue(parameter.driver)
            self.assertEqual(parameter.parser_status, "supported")
            self.assertTrue(parameter.reviewable)

    def test_registered_parameters_have_no_geometry_driver(self):
        registered = [p for p in CLINICAL_PARAMETERS.values() if not p.simulated]
        self.assertEqual(len(registered), 42)
        for parameter in registered:
            self.assertEqual(parameter.simulation_status, "registered_not_simulated")
            self.assertIsNone(parameter.model_field)
            self.assertIsNone(parameter.driver)
            self.assertTrue(parameter.reviewable)

    def test_every_parser_mapping_uses_valid_enums(self):
        for parameter in CLINICAL_PARAMETERS.values():
            self.assertIsInstance(parameter.parser_target, TargetRegion)
            self.assertIsInstance(parameter.parser_parameter, Parameter)
            self.assertTrue(parameter.clinical_name)
            self.assertTrue(parameter.definition)
            self.assertTrue(parameter.limitations)
            self.assertTrue(parameter.synonyms)

    def test_simulated_lookup_helpers(self):
        self.assertTrue(is_simulated_key("alar_width"))
        self.assertEqual(model_field_for_key("alar_width"), "alarWidth")
        self.assertFalse(is_simulated_key("alar_flare"))
        self.assertIsNone(model_field_for_key("alar_flare"))
        self.assertIsNone(model_field_for_key("does_not_exist"))


class ClinicalVocabularyTests(unittest.TestCase):
    def test_longest_specific_synonym_wins(self):
        cases = {
            "reduce the dorsal hump by 1 mm": "dorsal_hump_reduction",
            "increase the alar base width by 1 mm": "alar_base_width",
            "narrow the alar flare by 1 mm": "alar_flare",
            "narrow the alar width by 1 mm": "alar_width",
            "increase nasolabial angle by 5 degrees": "nasolabial_angle",
            "increase columellar show by 1 mm": "columellar_show",
            "plump the lower lip by 0.5 mm": "lower_lip_fullness",
            "advance the chin by 1 mm": "chin_projection",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                match = match_clinical_parameter(text)
                self.assertFalse(match.ambiguous)
                self.assertEqual(match.key, expected)

    def test_article_insensitive_matching(self):
        self.assertEqual(
            match_clinical_parameter("raise tip by 2 mm").key,
            "tip_height",
        )
        self.assertEqual(
            match_clinical_parameter("raise the tip by 2 mm").key,
            "tip_height",
        )

    def test_equal_length_conflicts_are_flagged(self):
        match = match_clinical_parameter("alar width tip height")
        self.assertTrue(match.ambiguous)
        self.assertIsNone(match.key)
        self.assertEqual(set(match.candidates), {"alar_width", "tip_height"})

    def test_generic_bridge_region_is_not_a_clinical_concept(self):
        match = match_clinical_parameter("narrow the bridge by 1 mm")
        self.assertIsNone(match.key)


class ParserClinicalOutcomeTests(unittest.TestCase):
    def test_simulated_alar_width_still_applies(self):
        instruction = parse_text("Narrow the alar width by 1 mm")[0]
        self.assertEqual(instruction.status, InstructionStatus.ok)
        self.assertEqual(instruction.clinical_parameter, "alar_width")
        self.assertEqual(instruction.parameter, Parameter.width)
        self.assertEqual(instruction.unit, Unit.mm)

    def test_alar_flare_is_reviewable_but_not_simulated(self):
        instruction = parse_text("Narrow the alar flare by 1 mm")[0]
        self.assertEqual(instruction.status, InstructionStatus.not_simulated)
        self.assertEqual(instruction.clinical_parameter, "alar_flare")
        self.assertEqual(instruction.value, 1.0)
        self.assertIn("not applied", instruction.reason.lower())

    def test_alar_base_is_not_silently_treated_as_alar_width(self):
        instruction = parse_text("Narrow the alar base by 1 mm")[0]
        self.assertEqual(instruction.status, InstructionStatus.not_simulated)
        self.assertEqual(instruction.clinical_parameter, "alar_base_width")

    def test_dorsal_hump_is_not_silently_treated_as_bridge_height(self):
        instruction = parse_text("Reduce dorsal hump by 1.5 mm")[0]
        self.assertEqual(instruction.status, InstructionStatus.not_simulated)
        self.assertEqual(instruction.clinical_parameter, "dorsal_hump_reduction")
        self.assertEqual(instruction.target, TargetRegion.nasal_bridge)
        self.assertEqual(instruction.parameter, Parameter.height)

    def test_angle_is_not_coerced_to_millimetres(self):
        instruction = parse_text("Increase nasolabial angle by 5 degrees")[0]
        self.assertEqual(instruction.status, InstructionStatus.not_simulated)
        self.assertEqual(instruction.clinical_parameter, "nasolabial_angle")
        self.assertEqual(instruction.unit, Unit.degrees)
        self.assertEqual(instruction.value, 5.0)

    def test_ratio_is_kept_as_a_ratio(self):
        instruction = build_instruction(
            {
                "target": "face",
                "parameter": "height",
                "clinical_parameter": "facial_thirds",
                "operation": "increase",
                "value": 0.1,
                "unit": None,
            },
            "increase facial thirds by 0.1",
            ParserSource.rules,
        )
        self.assertEqual(instruction.status, InstructionStatus.not_simulated)
        self.assertEqual(instruction.unit, Unit.ratio)
        self.assertEqual(instruction.value, 0.1)

    def test_registered_shape_without_direction_needs_clarification(self):
        instruction = parse_text("Change the tip definition")[0]
        self.assertEqual(instruction.status, InstructionStatus.needs_clarification)
        self.assertEqual(instruction.clinical_parameter, "tip_definition")

    def test_mismatched_clinical_key_is_invalid(self):
        instruction = build_instruction(
            {
                "target": "chin",
                "parameter": "projection",
                "clinical_parameter": "alar_width",
                "operation": "increase",
                "value": 1,
                "unit": "mm",
            },
            "mismatch",
            ParserSource.llm,
        )
        self.assertEqual(instruction.status, InstructionStatus.invalid)
        self.assertIn("does not match", instruction.reason)

    def test_unknown_clinical_key_is_invalid(self):
        instruction = build_instruction(
            {
                "target": "chin",
                "parameter": "projection",
                "clinical_parameter": "made_up_parameter",
                "operation": "increase",
                "value": 1,
                "unit": "mm",
            },
            "unknown",
            ParserSource.llm,
        )
        self.assertEqual(instruction.status, InstructionStatus.invalid)
        self.assertIn("Unknown clinical parameter", instruction.reason)

    def test_contradictions_are_scoped_per_concept(self):
        instructions = parse_text(
            "Increase the alar width by 1 mm and decrease the alar flare by 1 mm"
        )
        self.assertEqual(len(instructions), 2)
        self.assertEqual(instructions[0].status, InstructionStatus.ok)
        self.assertEqual(instructions[1].status, InstructionStatus.not_simulated)

    def test_generic_bridge_operations_still_use_the_right_simulated_parameter(self):
        narrow = parse_text("Narrow the bridge by 1 mm")[0]
        raise_ = parse_text("Raise the bridge by 2 mm")[0]
        self.assertEqual(narrow.status, InstructionStatus.ok)
        self.assertEqual(narrow.parameter, Parameter.width)
        self.assertEqual(raise_.status, InstructionStatus.ok)
        self.assertEqual(raise_.parameter, Parameter.height)


if __name__ == "__main__":
    unittest.main()
