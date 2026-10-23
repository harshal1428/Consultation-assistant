"""VoiceSurg 3D — structured command contract.

This module defines the *only* representation that may cross the API boundary
between the parser and the simulation frontend. Every field is explicit and
validated; the language model output is coerced into these enums before it can
influence the simulation.
"""

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class TargetRegion(str, Enum):
    """Anatomical regions the prototype understands."""

    nasal_bridge = "nasal_bridge"
    nasal_dorsum = "nasal_dorsum"
    nasal_tip = "nasal_tip"
    nostril_region = "nostril_region"
    upper_lip = "upper_lip"
    lower_lip = "lower_lip"
    chin = "chin"
    jawline = "jawline"
    cheek = "cheek"


class Parameter(str, Enum):
    """Canonical simulation parameters."""

    height = "height"
    width = "width"
    projection = "projection"
    rotation = "rotation"
    fullness = "fullness"
    definition = "definition"


class Operation(str, Enum):
    """Canonical operations. ``narrow``/``widen`` are explicit operations with

    defined width semantics rather than aliases that the frontend might ignore.
    """

    increase = "increase"
    decrease = "decrease"
    rotate = "rotate"
    narrow = "narrow"
    widen = "widen"
    raise_ = "raise"
    lower = "lower"


class Unit(str, Enum):
    """Canonical units. ``cm`` may appear on input but is normalized to ``mm``."""

    mm = "mm"
    cm = "cm"
    degrees = "degrees"


class InstructionStatus(str, Enum):
    """Validation verdict for a single instruction."""

    ok = "ok"
    needs_clarification = "needs_clarification"
    unsupported = "unsupported"
    invalid = "invalid"
    no_change = "no_change"


class ParserSource(str, Enum):
    llm = "llm"
    rules = "rules"


class Instruction(BaseModel):
    """A single interpreted instruction.

    Nullable fields honestly represent "not identified". ``status`` and
    ``reason`` describe the validation verdict so the frontend never has to
    guess whether a change is safe to apply.
    """

    target: Optional[TargetRegion] = None
    parameter: Optional[Parameter] = None
    operation: Optional[Operation] = None

    # Normalized magnitude (always non-negative) in the canonical unit.
    value: Optional[float] = None
    # The magnitude exactly as requested, in ``requested_unit`` (before any
    # normalization or accepted adjustment). Preserved for honest display.
    requested_value: Optional[float] = None
    requested_unit: Optional[Unit] = None

    # Canonical unit for the parameter (mm for lengths, degrees for angles).
    unit: Optional[Unit] = None
    direction: Optional[str] = None

    # Suggested in-range replacement when ``value`` exceeds supported bounds.
    adjusted_value: Optional[float] = None

    confidence: float = Field(ge=0.0, le=1.0)
    requires_confirmation: bool = True
    status: InstructionStatus
    reason: Optional[str] = None
    original_text: str
    parser: ParserSource


class ContextItem(BaseModel):
    """A bounded, explicit memory entry used only for follow-up resolution."""

    target: Optional[TargetRegion] = None
    parameter: Optional[Parameter] = None
    operation: Optional[Operation] = None
    value: Optional[float] = None
    unit: Optional[Unit] = None


class CommandRequest(BaseModel):
    text: str
    # At most the last few applied instructions. The server truncates this and
    # never persists it.
    context: Optional[List[ContextItem]] = None


class ParseResponse(BaseModel):
    """Response contract for ``POST /api/parse-command``."""

    instructions: List[Instruction]
    text: str
