"""Shared normalization and validation for parsed instructions.

Both the deterministic rules parser and the Gemini parser produce *raw* intent
dictionaries. This module is the single place where those raw values are coerced
into the strict contract and validated. That guarantees AI output and fallback
output obey exactly the same rules.
"""

from typing import Dict, Optional, Set

from .clinical_registry import get_clinical_parameter
from .schemas import (
    Instruction,
    InstructionStatus,
    Operation,
    Parameter,
    ParserSource,
    TargetRegion,
    Unit,
)

# ---------------------------------------------------------------------------
# Supported capabilities
# ---------------------------------------------------------------------------

#: target -> parameters that map to a real simulation parameter.
TARGET_PARAMETER_MAP: Dict[TargetRegion, Set[Parameter]] = {
    TargetRegion.nasal_bridge: {Parameter.height, Parameter.width},
    TargetRegion.nasal_dorsum: {Parameter.height, Parameter.width},
    TargetRegion.nasal_tip: {
        Parameter.height,
        Parameter.projection,
        Parameter.rotation,
    },
    TargetRegion.nostril_region: {Parameter.width},
    TargetRegion.upper_lip: {Parameter.projection, Parameter.fullness},
    TargetRegion.lower_lip: {Parameter.projection, Parameter.fullness},
    TargetRegion.chin: {Parameter.projection, Parameter.height, Parameter.width},
    TargetRegion.jawline: {Parameter.width, Parameter.definition},
    TargetRegion.cheek: {Parameter.projection, Parameter.fullness},
}

#: Parameters measured in millimetres vs degrees.
LENGTH_PARAMETERS = {
    Parameter.height,
    Parameter.width,
    Parameter.projection,
    Parameter.fullness,
    Parameter.definition,
}
ANGLE_PARAMETERS = {Parameter.rotation}

#: Supported magnitude bounds (simulation units, *not* calibrated).
LENGTH_LIMIT_MM = 10.0
ANGLE_LIMIT_DEG = 45.0

OPERATION_VERBS = {
    "increase": Operation.increase,
    "decrease": Operation.decrease,
    "rotate": Operation.rotate,
    "narrow": Operation.narrow,
    "widen": Operation.widen,
    "raise": Operation.raise_,
    "lower": Operation.lower,
}


def canonical_unit_for(parameter: Optional[Parameter]) -> Optional[Unit]:
    if parameter is None:
        return None
    return Unit.degrees if parameter in ANGLE_PARAMETERS else Unit.mm


def canonical_unit_for_clinical(
    clinical_key: Optional[str], parameter: Optional[Parameter]
) -> Optional[Unit]:
    clinical = get_clinical_parameter(clinical_key)
    if clinical is None:
        return canonical_unit_for(parameter)
    if clinical.value_kind == "angle":
        return Unit.degrees
    if clinical.value_kind == "ratio":
        return Unit.ratio
    if clinical.value_kind == "categorical":
        return None
    return Unit.mm


def _safe_enum(enum_cls, value):
    """Return (member, error_message). Never raises."""
    if value is None or value == "":
        return None, None
    if isinstance(value, enum_cls):
        return value, None
    try:
        return enum_cls(str(value).strip().lower()), None
    except ValueError:
        return None, f"Unsupported {enum_cls.__name__.lower()} value: '{value}'."


def _coerce_float(value) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _limit_for(parameter: Optional[Parameter]) -> Optional[float]:
    if parameter in ANGLE_PARAMETERS:
        return ANGLE_LIMIT_DEG
    if parameter in LENGTH_PARAMETERS:
        return LENGTH_LIMIT_MM
    return None


def build_instruction(
    raw: Dict,
    original_text: str,
    parser: ParserSource,
    missing_reason: Optional[str] = None,
) -> Instruction:
    """Coerce a raw intent dict into a validated :class:`Instruction`.

    The function never raises: malformed input becomes an ``invalid``
    instruction with an explicit reason instead of an invented command.
    """

    clinical_key_raw = raw.get("clinical_parameter")
    clinical_key = str(clinical_key_raw).strip() if clinical_key_raw else None
    clinical = get_clinical_parameter(clinical_key)
    if clinical_key and clinical is None:
        return Instruction(
            target=None,
            parameter=None,
            clinical_parameter=clinical_key,
            operation=None,
            value=None,
            requested_value=None,
            requested_unit=None,
            unit=None,
            direction=None,
            adjusted_value=None,
            confidence=0.0,
            requires_confirmation=False,
            status=InstructionStatus.invalid,
            reason=f"Unknown clinical parameter key: '{clinical_key}'.",
            original_text=original_text,
            parser=parser,
        )

    def invalid(reason: str, **overrides) -> Instruction:
        base = dict(
            target=None,
            parameter=None,
            clinical_parameter=clinical_key,
            operation=None,
            value=None,
            requested_value=None,
            requested_unit=None,
            unit=None,
            direction=None,
            adjusted_value=None,
            confidence=0.0,
            requires_confirmation=False,
            status=InstructionStatus.invalid,
            reason=reason,
            original_text=original_text,
            parser=parser,
        )
        base.update(overrides)
        return Instruction(**base)

    target, err = _safe_enum(TargetRegion, raw.get("target"))
    if err:
        return invalid(err)
    parameter, err = _safe_enum(Parameter, raw.get("parameter"))
    if err:
        return invalid(err)
    operation, err = _safe_enum(Operation, raw.get("operation"))
    if err:
        return invalid(err)
    unit, err = _safe_enum(Unit, raw.get("unit"))
    if err:
        return invalid(err)
    requested_unit, err = _safe_enum(Unit, raw.get("requested_unit"))
    if err:
        return invalid(err)

    value = _coerce_float(raw.get("value"))
    requested_value = _coerce_float(raw.get("requested_value"))
    if requested_value is None:
        requested_value = value

    direction = raw.get("direction") or None
    confidence = raw.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = 0.5
    confidence = max(0.0, min(1.0, float(confidence)))

    # --- Structural completeness ------------------------------------------
    if target is None:
        return invalid(
            "No supported anatomical region was identified in this phrase.",
            confidence=confidence,
        )
    if operation is None and parameter is None:
        return invalid(
            "No supported operation or parameter was identified in this phrase.",
            confidence=confidence,
        )

    # --- Region / parameter compatibility ---------------------------------
    if parameter is None:
        return invalid(
            f"The '{target.value}' region needs an explicit parameter.",
            target=target,
            operation=operation,
            confidence=confidence,
        )

    # A known clinical key is authoritative. Reject a mismatched target/pair
    # instead of silently applying a different concept.
    if clinical is not None and (
        target != clinical.parser_target or parameter != clinical.parser_parameter
    ):
        return invalid(
            "The clinical parameter does not match its target/parameter mapping.",
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation,
            confidence=confidence,
        )

    allowed = TARGET_PARAMETER_MAP.get(target, set())
    if clinical is None and parameter not in allowed:
        allowed_labels = ", ".join(sorted(p.value for p in allowed))
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=None,
            operation=operation,
            value=None,
            requested_value=requested_value,
            requested_unit=requested_unit,
            unit=canonical_unit_for(parameter),
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.unsupported,
            reason=(
                f"'{parameter.value}' is not a supported parameter for the "
                f"'{target.value}' region (supported: {allowed_labels})."
            ),
            original_text=original_text,
            parser=parser,
        )

    if operation is None:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=None,
            value=None,
            requested_value=requested_value,
            requested_unit=requested_unit,
            unit=canonical_unit_for_clinical(clinical_key, parameter),
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.needs_clarification,
            reason="No direction was given (for example: increase or decrease).",
            original_text=original_text,
            parser=parser,
        )

    canonical_unit = canonical_unit_for_clinical(clinical_key, parameter)

    # --- Unit normalization ------------------------------------------------
    if unit is None:
        unit = canonical_unit
    if unit == Unit.cm:
        if value is not None:
            value = round(value * 10.0, 4)
            if requested_unit in (None, Unit.cm):
                requested_value = requested_value  # keep as requested (cm)
        unit = Unit.mm

    # Detect linear/angular unit mismatches.
    if parameter in ANGLE_PARAMETERS and unit == Unit.mm:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation,
            value=None,
            requested_value=requested_value,
            requested_unit=requested_unit or Unit.mm,
            unit=canonical_unit,
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.invalid,
            reason="A linear unit (mm) cannot be applied to an angular parameter; use degrees.",
            original_text=original_text,
            parser=parser,
        )
    if parameter in LENGTH_PARAMETERS and unit == Unit.degrees:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation,
            value=None,
            requested_value=requested_value,
            requested_unit=requested_unit or Unit.degrees,
            unit=canonical_unit,
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.invalid,
            reason="An angular unit (degrees) cannot be applied to a linear parameter; use mm.",
            original_text=original_text,
            parser=parser,
        )

    # --- Missing / negative values ----------------------------------------
    if value is None:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation,
            value=None,
            requested_value=requested_value,
            requested_unit=requested_unit,
            unit=canonical_unit,
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.needs_clarification,
            reason=missing_reason
            or "A measurement is required; no numeric value was provided.",
            original_text=original_text,
            parser=parser,
        )
    if value < 0:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation if operation else None,
            value=None,
            requested_value=requested_value,
            requested_unit=requested_unit,
            unit=canonical_unit,
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.invalid,
            reason="A negative measurement was given; state the direction with a positive value.",
            original_text=original_text,
            parser=parser,
        )
    if value == 0:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation,
            value=0.0,
            requested_value=requested_value,
            requested_unit=requested_unit,
            unit=canonical_unit,
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.no_change,
            reason="A zero change produces no modification.",
            original_text=original_text,
            parser=parser,
        )

    # --- Range guard (no silent clamping) ---------------------------------
    # Registered-but-not-simulated concepts keep their own registry bounds and
    # are returned as not_simulated below; applying the simulation delta limits
    # to an absolute angle such as 130 degrees would be misleading.
    limit = _limit_for(parameter) if clinical is None or clinical.simulated else None
    if limit is not None and value > limit:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation,
            value=value,
            requested_value=requested_value,
            requested_unit=requested_unit,
            unit=canonical_unit,
            direction=direction,
            adjusted_value=limit,
            confidence=confidence,
            requires_confirmation=True,
            status=InstructionStatus.needs_clarification,
            reason=(
                f"Requested {value:g} {canonical_unit.value} exceeds the supported "
                f"simulation range of {limit:g} {canonical_unit.value}; accept the "
                f"adjusted proposal or enter a smaller value."
            ),
            original_text=original_text,
            parser=parser,
        )

    if clinical is not None and not clinical.simulated:
        return Instruction(
            target=target,
            parameter=parameter,
            clinical_parameter=clinical_key,
            operation=operation,
            value=value,
            requested_value=requested_value,
            requested_unit=requested_unit or canonical_unit,
            unit=canonical_unit,
            direction=direction,
            adjusted_value=None,
            confidence=confidence,
            requires_confirmation=False,
            status=InstructionStatus.not_simulated,
            reason=(
                f"{clinical.clinical_name} is registered and reviewable, but this "
                "prototype has no verified geometry driver for it. It was not "
                f"applied. {clinical.limitations}"
            ),
            original_text=original_text,
            parser=parser,
        )

    return Instruction(
        target=target,
        parameter=parameter,
        clinical_parameter=clinical_key,
        operation=operation,
        value=value,
        requested_value=requested_value,
        requested_unit=requested_unit or canonical_unit,
        unit=canonical_unit,
        direction=direction,
        adjusted_value=None,
        confidence=confidence,
        requires_confirmation=True,
        status=InstructionStatus.ok,
        reason=None,
        original_text=original_text,
        parser=parser,
    )
