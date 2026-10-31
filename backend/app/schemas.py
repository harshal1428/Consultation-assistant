"""VoiceSurg 3D — structured command contract.

This module defines the *only* representation that may cross the API boundary
between the parser and the simulation frontend. Every field is explicit and
validated; the language model output is coerced into these enums before it can
influence the simulation.
"""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


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
    nasal_base = "nasal_base"
    columella = "columella"
    septal_region = "septal_region"
    left_side = "left_side"
    right_side = "right_side"
    # Composite facial measurements are registered and reviewable even though
    # the prototype has no calibrated face-wide geometry driver.
    face = "face"


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
    # Ratios are retained as ratios. They are never coerced into millimetres.
    ratio = "ratio"


class InstructionStatus(str, Enum):
    """Validation verdict for a single instruction."""

    ok = "ok"
    needs_clarification = "needs_clarification"
    unsupported = "unsupported"
    invalid = "invalid"
    no_change = "no_change"
    # Registered and reviewable, but no verified geometry driver exists.
    not_simulated = "not_simulated"


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
    # Stable key in shared/clinical_parameters.json. The coarse target/parameter
    # pair remains for legacy review controls, but the clinical key is
    # authoritative when deciding whether a geometry driver exists.
    clinical_parameter: Optional[str] = None
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
    clinical_parameter: Optional[str] = None
    operation: Optional[Operation] = None
    value: Optional[float] = None
    unit: Optional[Unit] = None


class CommandRequest(BaseModel):
    text: str
    # At most the last few applied instructions. The server truncates this and
    # never persists it.
    context: Optional[List[ContextItem]] = None
    # Provenance supplied by a client ("voice" or "typed"). Parsing behaviour is
    # identical; this keeps the existing endpoint the single parse pathway.
    source: Optional[str] = None


class ParseResponse(BaseModel):
    """Response contract for ``POST /api/parse-command``."""

    instructions: List[Instruction]
    text: str


class ConsultationRecord(BaseModel):
    """One archived consultation, stored in the local SQLite database.

    Field names use the same camelCase spelling as the frontend
    ``ArchivedConsultation`` contract so the two sides share one shape. Nested
    simulation/session values stay as free-form JSON; the backend is a durable
    store, not a second source of truth for the simulation schema.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str
    saved_at: int = Field(alias="savedAt")
    started_at: int = Field(alias="startedAt")
    ended_at: Optional[int] = Field(default=None, alias="endedAt")
    status: str = "active"
    patient_id: str = Field(default="", alias="patientId")
    patient_name: str = Field(default="", alias="patientName")
    surgeon_name: str = Field(default="", alias="surgeonName")
    change_count: int = Field(default=0, alias="changeCount")
    scenario_count: int = Field(default=0, alias="scenarioCount")
    model_state: Dict[str, Any] = Field(alias="modelState")
    summary: str = ""
    personalization: Optional[Dict[str, Any]] = None
    live_events: Optional[List[Dict[str, Any]]] = Field(default=None, alias="liveEvents")
    transcript: Optional[List[Dict[str, Any]]] = None
    proposals: Optional[List[Dict[str, Any]]] = None
    events: Optional[List[Dict[str, Any]]] = None
    scenarios: Optional[List[Dict[str, Any]]] = None
    created_at: Optional[str] = Field(default=None, alias="createdAt")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")
