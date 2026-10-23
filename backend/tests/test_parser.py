"""Deterministic rules-parser tests (offline, no API key, no network).

Run from the ``backend/`` directory:
    python -m unittest discover -s tests -v
"""

import unittest

from app.parser import parse_text
from app.schemas import (
    ContextItem,
    InstructionStatus,
    Operation,
    Parameter,
    TargetRegion,
    Unit,
)


def only(instructions):
    assert len(instructions) == 1, f"expected 1 instruction, got {len(instructions)}"
    return instructions[0]


class RulesParserTests(unittest.TestCase):
    def test_multi_command_splits_independent_instructions(self):
        result = parse_text("Reduce the bridge by 2 mm and raise the tip by 1 mm")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].target, TargetRegion.nasal_bridge)
        self.assertEqual(result[0].operation, Operation.decrease)
        self.assertEqual(result[0].value, 2.0)
        self.assertEqual(result[1].target, TargetRegion.nasal_tip)
        self.assertEqual(result[1].operation, Operation.raise_)
        self.assertEqual(result[1].value, 1.0)
        self.assertTrue(all(i.status == InstructionStatus.ok for i in result))

    def test_negation_is_no_change(self):
        ins = only(parse_text("Do not reduce the bridge"))
        self.assertEqual(ins.status, InstructionStatus.no_change)
        self.assertIsNone(ins.value)
        self.assertIsNone(ins.operation)

    def test_keep_unchanged_is_no_change(self):
        ins = only(parse_text("Keep the bridge unchanged"))
        self.assertEqual(ins.status, InstructionStatus.no_change)

    def test_cm_is_normalized_to_mm_but_requested_is_preserved(self):
        ins = only(parse_text("Increase tip projection by 0.2 cm"))
        self.assertEqual(ins.status, InstructionStatus.ok)
        self.assertEqual(ins.parameter, Parameter.projection)
        self.assertEqual(ins.value, 2.0)
        self.assertEqual(ins.unit, Unit.mm)
        self.assertEqual(ins.requested_value, 0.2)
        self.assertEqual(ins.requested_unit, Unit.cm)

    def test_out_of_range_is_not_silently_clamped(self):
        ins = only(parse_text("Increase tip projection by 100 mm"))
        self.assertEqual(ins.status, InstructionStatus.needs_clarification)
        self.assertEqual(ins.adjusted_value, 10.0)
        self.assertEqual(ins.value, 100.0)

    def test_unsupported_region(self):
        ins = only(parse_text("Reduce the forehead by 2 mm"))
        self.assertEqual(ins.status, InstructionStatus.unsupported)
        self.assertIsNone(ins.target)

    def test_upper_lip_projection_is_supported(self):
        ins = only(parse_text("Increase the upper lip projection by 2 mm"))
        self.assertEqual(ins.status, InstructionStatus.ok)
        self.assertEqual(ins.target, TargetRegion.upper_lip)
        self.assertEqual(ins.parameter, Parameter.projection)
        self.assertEqual(ins.value, 2.0)

    def test_lower_lip_fullness_is_supported(self):
        ins = only(parse_text("Add fullness to the lower lip by 1 mm"))
        self.assertEqual(ins.status, InstructionStatus.ok)
        self.assertEqual(ins.target, TargetRegion.lower_lip)
        self.assertEqual(ins.parameter, Parameter.fullness)

    def test_bare_lip_is_ambiguous_not_guessed(self):
        ins = only(parse_text("Increase the lip projection by 2 mm"))
        self.assertEqual(ins.status, InstructionStatus.needs_clarification)
        self.assertIsNone(ins.target)

    def test_chin_regions_are_supported(self):
        projection = only(parse_text("Reduce the chin projection by 2 mm"))
        self.assertEqual(projection.status, InstructionStatus.ok)
        self.assertEqual(projection.target, TargetRegion.chin)
        self.assertEqual(projection.parameter, Parameter.projection)

        height = only(parse_text("Increase chin height by 3 mm"))
        self.assertEqual(height.target, TargetRegion.chin)
        self.assertEqual(height.parameter, Parameter.height)

        width = only(parse_text("Widen the chin by 2 mm"))
        self.assertEqual(width.target, TargetRegion.chin)
        self.assertEqual(width.parameter, Parameter.width)

    def test_jawline_width_and_definition_are_supported(self):
        width = only(parse_text("Widen the jaw by 2 mm"))
        self.assertEqual(width.status, InstructionStatus.ok)
        self.assertEqual(width.target, TargetRegion.jawline)
        self.assertEqual(width.parameter, Parameter.width)

        definition = only(parse_text("Increase jawline definition by 2 mm"))
        self.assertEqual(definition.status, InstructionStatus.ok)
        self.assertEqual(definition.target, TargetRegion.jawline)
        self.assertEqual(definition.parameter, Parameter.definition)

    def test_cheek_fullness_is_supported(self):
        ins = only(parse_text("Increase cheek fullness by 2 mm"))
        self.assertEqual(ins.status, InstructionStatus.ok)
        self.assertEqual(ins.target, TargetRegion.cheek)
        self.assertEqual(ins.parameter, Parameter.fullness)

    def test_unsupported_unit_inches(self):
        ins = only(parse_text("Reduce the bridge by 1 inch"))
        self.assertEqual(ins.status, InstructionStatus.unsupported)

    def test_missing_value_needs_clarification(self):
        ins = only(parse_text("Lower the tip"))
        self.assertEqual(ins.status, InstructionStatus.needs_clarification)
        self.assertIsNone(ins.value)

    def test_qualitative_neutral_never_invents_a_number(self):
        ins = only(parse_text("Raise the tip slightly"))
        self.assertEqual(ins.status, InstructionStatus.needs_clarification)
        self.assertIsNone(ins.value)

    def test_rotation_requires_direction(self):
        ins = only(parse_text("Rotate the tip by 5 degrees"))
        self.assertEqual(ins.status, InstructionStatus.needs_clarification)

    def test_rotation_with_direction_is_ok(self):
        ins = only(parse_text("Rotate the tip upward by 5 degrees"))
        self.assertEqual(ins.status, InstructionStatus.ok)
        self.assertEqual(ins.parameter, Parameter.rotation)
        self.assertEqual(ins.direction, "up")
        self.assertEqual(ins.value, 5.0)

    def test_linear_unit_on_angular_parameter_is_invalid(self):
        ins = only(parse_text("Rotate the tip upward by 5 mm"))
        self.assertEqual(ins.status, InstructionStatus.invalid)

    def test_contradictory_instructions_are_flagged(self):
        result = parse_text(
            "Increase the bridge by 2 mm and decrease the bridge by 1 mm"
        )
        self.assertEqual(len(result), 2)
        self.assertTrue(
            all(i.status == InstructionStatus.needs_clarification for i in result)
        )

    def test_self_correction_supersedes_previous_clause(self):
        result = parse_text("Reduce the bridge by 2 mm, actually increase it by 1 mm")
        ins = only(result)
        self.assertEqual(ins.operation, Operation.increase)
        self.assertEqual(ins.value, 1.0)
        self.assertEqual(ins.target, TargetRegion.nasal_bridge)

    def test_pronoun_resolves_from_context(self):
        context = [
            ContextItem(
                target=TargetRegion.nasal_bridge,
                parameter=Parameter.height,
                operation=Operation.decrease,
                value=2.0,
                unit=Unit.mm,
            )
        ]
        ins = only(parse_text("reduce it by 1 mm", context))
        self.assertEqual(ins.target, TargetRegion.nasal_bridge)
        self.assertEqual(ins.parameter, Parameter.height)
        self.assertEqual(ins.status, InstructionStatus.ok)

    def test_narrow_maps_to_width(self):
        ins = only(parse_text("Narrow the bridge by 1 mm"))
        self.assertEqual(ins.status, InstructionStatus.ok)
        self.assertEqual(ins.operation, Operation.narrow)
        self.assertEqual(ins.parameter, Parameter.width)

    def test_gibberish_is_invalid(self):
        ins = only(parse_text("Make my nose better"))
        self.assertEqual(ins.status, InstructionStatus.invalid)

    def test_parameter_without_direction_needs_clarification(self):
        ins = only(parse_text("Set the bridge width to 2 mm"))
        self.assertEqual(ins.status, InstructionStatus.needs_clarification)

    def test_word_number_and_a_half(self):
        ins = only(parse_text("Lift the tip by one and a half mm"))
        self.assertEqual(ins.status, InstructionStatus.ok)
        self.assertEqual(ins.value, 1.5)


if __name__ == "__main__":
    unittest.main()
