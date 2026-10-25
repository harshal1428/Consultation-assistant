"""Deterministic, offline rules parser for VoiceSurg 3D.

Produces a list of :class:`~.schemas.Instruction` objects from free text with no
network or API key. All hard-negative detection (negation, unsupported regions,
contradictions, missing direction) lives here so the language model can never
silently turn an unsafe phrase into a positive action.
"""

import re
from typing import Dict, List, Optional, Tuple

from .schemas import (
    ContextItem,
    Instruction,
    InstructionStatus,
    Operation,
    Parameter,
    ParserSource,
    TargetRegion,
    Unit,
)
from .validation import build_instruction, canonical_unit_for

# ---------------------------------------------------------------------------
# Lexicon
# ---------------------------------------------------------------------------

#: Ordered (region, [patterns]) — first match wins.
TARGET_SYNONYMS: List[Tuple[TargetRegion, List[str]]] = [
    (TargetRegion.nasal_bridge, [r"nasal bridge", r"\bbridge\b", r"\bradix\b", r"\bnasion\b", r"\bdorsal hump", r"\bhump\b", r"\bdorsal prominence", r"\bdorsal convexity", r"\bbump\b"]),
    (TargetRegion.nasal_dorsum, [r"nasal dorsum", r"\bdorsum\b", r"\bdorsal\b", r"\bnasal dorsum\b"]),
    (TargetRegion.nasal_tip, [r"nasal tip", r"\btip\b", r"\bpronasale\b", r"\bsupratip\b", r"\bdroopy tip", r"\bbutton nose", r"\bscooped", r"\brefined tip", r"\btip definition"]),
    (
        TargetRegion.nostril_region,
        [r"\bnostrils?\b", r"\bnares\b", r"\bnaris\b", r"\balar base\b", r"\balar\b", r"\bala\b", r"\balae\b", r"\bnostril shape", r"\bnostril symmetry", r"\bnostril flare", r"\balar flare", r"\balar base width"],
    ),
    (
        TargetRegion.upper_lip,
        [r"upper[\s-]*lips?", r"top lip", r"\bupper\b[^.]*\blip\b"],
    ),
    (
        TargetRegion.lower_lip,
        [r"lower[\s-]*lips?", r"bottom lip", r"\blower\b[^.]*\blip\b"],
    ),
    (TargetRegion.jawline, [r"\bjaw\s?line\b", r"\bmandible\b", r"\bmandibular\b", r"\bjaw\b", r"\bleft.right asymmetry", r"\bleft right asymmetry", r"\basymmetry"]),
    (TargetRegion.chin, [r"\bchin\b", r"\bmenton\b", r"\bpogonion\b"]),
    (TargetRegion.cheek, [r"\bcheeks?\b", r"\bmalar\b", r"\bzygomatic\b", r"\bnasolabial angle", r"\bcolumellar show", r"\bcolumellar.lobular angle", r"\bcolumellar lobular angle"]),
]

#: Region words that are explicitly *not* supported in this phase.
UNSUPPORTED_REGION_TOKENS = [
    "brow", "forehead", "eye", "eyes", "ear", "ears", "mouth",
]

QUALITATIVE_TOKENS = [
    "slightly", "a bit", "a little", "a touch", "somewhat", "minimally",
    "minimal", "subtle", "subtly", "just a", "slight",
]

NEGATION_PREFIX = re.compile(
    r"^\s*(?:please\s+)?(?:do\s+not|don'?t|never|avoid|no\s+change\b|no\s+)", re.I
)
NEGATION_KEEP = re.compile(
    r"\b(?:keep|leave|hold)\b.*\b(?:unchanged|the same|as is|constant|unmodified|fixed)\b"
    r"|\bno change\b|\bstay(?:s)?\s+(?:the same|unchanged)\b",
    re.I,
)

CORRECTION_CUE = re.compile(
    r"\b(?:actually|instead|rather|i mean|sorry|no wait|make that|change that|make it)\b", re.I
)

OP_INCREASE = re.compile(r"\b(increase|raise|lift|augment|boost|add|gain|higher|project)\b", re.I)
OP_DECREASE = re.compile(r"\b(decrease|lower|reduce|shorten|subtract|minimi[sz]e|take\b.*\boff|down)\b", re.I)
OP_NARROW = re.compile(r"\b(narrow|narrower|pinch|thinner)\b", re.I)
OP_WIDEN = re.compile(r"\b(widen|wider|broaden|broader)\b", re.I)
OP_ROTATE = re.compile(r"\b(rotate|rotation|rotated|angle|tilt)\b", re.I)

DIR_UP = re.compile(r"\b(up|upward|upwards|cephalic|superior|higher)\b", re.I)
DIR_DOWN = re.compile(r"\b(down|downward|downwards|caudal|inferior|lower)\b", re.I)

PARAM_HEIGHT = re.compile(r"\b(height|high|projection of the height)\b", re.I)
PARAM_WIDTH = re.compile(r"\b(width|wide|wideness|breadth)\b", re.I)
PARAM_PROJECTION = re.compile(r"\b(projection|project|projected|projecting|forward)\b", re.I)
PARAM_ROTATION = re.compile(r"\b(rotation|rotate|rotated|angle|tilt)\b", re.I)
PARAM_FULLNESS = re.compile(
    r"\b(fullness|full|fuller|plump|plumpness|volume|pout|prominence|prominent)\b", re.I
)
PARAM_DEFINITION = re.compile(
    r"\b(definition|defined|define|sharpen|sharper|sharpness|angular|contour)\b", re.I
)

PRONOUN = re.compile(r"\b(it|that|this|those|these)\b", re.I)

#: "upper/lower lip" is a *region*, not the "raise/lower" verb. Neutralise the
#: qualifier before verb/direction detection so "lower lip" never reads as a
#: downward instruction.
LIP_QUALIFIER = re.compile(r"\b(upper|top|lower|bottom)[\s-]*lips?\b", re.I)

NUMBER_WORD = (
    r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"half|[a-z]+_and_a_half)"
)
NUMBER_RE = re.compile(rf"\b(\d+(?:\.\d+)?|{NUMBER_WORD})\b", re.I)
UNIT_PATTERN = r"millimet(?:er|re)s?|mm|centimet(?:er|re)s?|cm|degrees?|deg|°"
UNIT_RE = re.compile(rf"({UNIT_PATTERN})", re.I)
INCH_RE = re.compile(r"\binch(?:es)?\b", re.I)

_NUMBER_WORD_VALUES = {
    "zero": 0.0, "one": 1.0, "two": 2.0, "three": 3.0, "four": 4.0,
    "five": 5.0, "six": 6.0, "seven": 7.0, "eight": 8.0, "nine": 9.0,
    "ten": 10.0, "eleven": 11.0, "twelve": 12.0, "half": 0.5,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _number_value(token: str) -> Optional[float]:
    token = token.lower().strip()
    if token.endswith("_and_a_half"):
        base = token[: -len("_and_a_half")]
        base_val = _NUMBER_WORD_VALUES.get(base)
        if base_val is None:
            return None
        return base_val + 0.5
    if token in _NUMBER_WORD_VALUES:
        return _NUMBER_WORD_VALUES[token]
    try:
        return float(token)
    except ValueError:
        return None


def _norm_unit_token(token: str) -> str:
    t = token.lower()
    if t.startswith("millim") or t == "mm":
        return Unit.mm.value
    if t.startswith("centim") or t == "cm":
        return Unit.cm.value
    if t.startswith("deg") or t == "°":
        return Unit.degrees.value
    if t.startswith("inch"):
        return "inch"
    return t


def _split_segments(text: str) -> List[str]:
    # Protect word-number phrases such as "one and a half".
    protected = re.sub(r"\b([a-z]+)\s+and\s+a\s+half\b", r"\1_and_a_half", text, flags=re.I)
    parts = re.split(r"\s*(?:;|,|\band\b|\bthen\b|\balso\b|\bplus\b)\s*", protected, flags=re.I)
    segments = [p.strip() for p in parts if p.strip()]

    # A clause that is only a correction cue ("no wait", "actually") belongs to
    # the following clause, not on its own.
    merged: List[str] = []
    idx = 0
    while idx < len(segments):
        if not CORRECTION_CUE.sub("", segments[idx]).strip() and idx + 1 < len(segments):
            segments[idx + 1] = f"{segments[idx]} {segments[idx + 1]}"
            idx += 1
            continue
        merged.append(segments[idx])
        idx += 1
    return merged


def _detect_target(text: str) -> Optional[TargetRegion]:
    for region, patterns in TARGET_SYNONYMS:
        for pat in patterns:
            if re.search(pat, text, re.I):
                return region
    return None


def _detect_unsupported_region(text: str) -> Optional[str]:
    for token in UNSUPPORTED_REGION_TOKENS:
        if re.search(rf"\b{re.escape(token)}\b", text, re.I):
            return token
    return None


def _extract_amount(text: str) -> Tuple[Optional[float], Optional[str]]:
    value: Optional[float] = None
    unit: Optional[str] = None

    match = NUMBER_RE.search(text)
    if match:
        value = _number_value(match.group(1))
        rest = text[match.end(): match.end() + 20]
        um = UNIT_RE.search(rest)
        if um and um.start() <= 3:
            unit = _norm_unit_token(um.group(1))
    else:
        # "a millimetre" / "an inch"
        m2 = re.search(rf"\b(?:a|an)\s+({UNIT_PATTERN})", text, re.I)
        if m2:
            value = 1.0
            unit = _norm_unit_token(m2.group(1))

    if INCH_RE.search(text) or '"' in text:
        unit = "inch"

    return value, unit


def _detect_operation(text: str) -> Optional[Operation]:
    if OP_NARROW.search(text):
        return Operation.narrow
    if OP_WIDEN.search(text):
        return Operation.widen
    if OP_ROTATE.search(text):
        return Operation.rotate
    # "lower" is a distinct verb; keep it before the generic decrease bucket.
    if re.search(r"\blower\b", text, re.I):
        return Operation.lower
    if re.search(r"\b(raise|lift)\b", text, re.I):
        return Operation.raise_
    if OP_DECREASE.search(text):
        return Operation.decrease
    if OP_INCREASE.search(text):
        return Operation.increase
    return None


def _detect_direction(text: str) -> Optional[str]:
    if DIR_UP.search(text):
        return "up"
    if DIR_DOWN.search(text):
        return "down"
    return None


def _detect_parameter(text: str, operation: Optional[Operation], target: Optional[TargetRegion]) -> Optional[Parameter]:
    if PARAM_PROJECTION.search(text):
        return Parameter.projection
    if PARAM_ROTATION.search(text):
        return Parameter.rotation
    if PARAM_HEIGHT.search(text):
        return Parameter.height
    if PARAM_WIDTH.search(text):
        return Parameter.width
    if PARAM_FULLNESS.search(text):
        return Parameter.fullness
    if PARAM_DEFINITION.search(text):
        return Parameter.definition

    if operation in (Operation.narrow, Operation.widen):
        return Parameter.width
    if operation == Operation.rotate:
        return Parameter.rotation
    if target == TargetRegion.nostril_region:
        return Parameter.width
    if target in (TargetRegion.nasal_bridge, TargetRegion.nasal_dorsum):
        return Parameter.height
    if target == TargetRegion.nasal_tip:
        return Parameter.height
    if target in (
        TargetRegion.upper_lip,
        TargetRegion.lower_lip,
        TargetRegion.chin,
        TargetRegion.cheek,
    ):
        return Parameter.projection
    if target == TargetRegion.jawline:
        return Parameter.width
    return None


def _is_no_change(text: str) -> bool:
    return bool(NEGATION_PREFIX.search(text) or NEGATION_KEEP.search(text))


# ---------------------------------------------------------------------------
# Clause parsing
# ---------------------------------------------------------------------------

def _parse_clause(text: str, context: List[ContextItem], previous: Optional[Dict] = None) -> Dict:
    clause = text.strip()
    lower = clause.lower()

    raw: Dict = {
        "target": None,
        "parameter": None,
        "operation": None,
        "value": None,
        "unit": None,
        "requested_value": None,
        "requested_unit": None,
        "direction": None,
        "confidence": 0.95,
        "original_text": clause,
        "_no_change": False,
        "_unsupported": None,
        "_ambiguous": None,
        "_missing_reason": None,
        "_note": None,
        "_is_correction": False,
        "_supersedes": False,
    }

    correction = CORRECTION_CUE.search(clause)
    is_correction = bool(correction)
    raw["_is_correction"] = is_correction

    if not is_correction and _is_no_change(clause):
        raw["_no_change"] = True
        target = _detect_target(clause)
        raw["target"] = target.value if target else None
        raw["confidence"] = 0.9
        return raw

    unsupported = _detect_unsupported_region(clause)
    target = _detect_target(clause)
    if unsupported and target is None:
        raw["_unsupported"] = (
            f"The '{unsupported}' region is not supported in this prototype "
            f"(supported: nasal bridge, dorsum, tip, nostrils, upper/lower lip, "
            f"chin, jawline, cheeks)."
        )
        raw["confidence"] = 0.4
        return raw

    # A bare "lip"/"lips" is genuinely ambiguous between the upper and lower lip.
    if target is None and re.search(r"\blips?\b", clause, re.I):
        raw["_ambiguous"] = (
            "Specify whether the upper or lower lip is intended "
            "(for example: upper lip or lower lip)."
        )
        raw["confidence"] = 0.4
        return raw

    working = clause[correction.end():] if correction else clause
    # Region qualifiers such as "lower lip" must not be mistaken for verbs.
    verb_working = LIP_QUALIFIER.sub("lip", working)
    verb_clause = LIP_QUALIFIER.sub("lip", clause)

    operation = _detect_operation(verb_working)
    direction = _detect_direction(verb_clause)
    parameter = _detect_parameter(clause, operation, target)
    value, unit = _extract_amount(clause)

    # Context resolution: pronouns / corrections inherit the previous target.
    resolved_from_context = False
    if target is None and (PRONOUN.search(clause) or is_correction):
        if is_correction and previous is not None:
            target = _safe_target(previous.get("target"))[0]
            if parameter is None:
                parameter = _safe_parameter(previous.get("parameter"))
            if operation is None:
                operation = _safe_operation(previous.get("operation"))
            raw["_supersedes"] = True
            resolved_from_context = True
            raw["confidence"] = 0.6
        elif context:
            antecedent = context[-1]
            target = antecedent.target
            if parameter is None:
                parameter = antecedent.parameter
            if operation is None:
                operation = antecedent.operation
            resolved_from_context = True
            raw["confidence"] = 0.65
        else:
            raw["_ambiguous"] = (
                "This phrase refers to a previous instruction, but no earlier "
                "instruction is available in the current session."
            )
            return raw
    elif is_correction and previous is not None:
        raw["_supersedes"] = True

    raw["target"] = target.value if target else None
    raw["parameter"] = parameter.value if parameter else None
    raw["operation"] = operation.value if operation else None
    raw["direction"] = direction
    raw["value"] = value
    raw["unit"] = unit
    raw["requested_value"] = value
    raw["requested_unit"] = unit

    # Unsupported unit (inches).
    if unit == "inch":
        raw["_unsupported"] = "Inches are not supported; please use millimetres (or centimetres)."
        return raw

    # Qualitative amounts never invent a number.
    if value is None:
        if any(re.search(rf"\b{re.escape(q)}\b", lower) for q in QUALITATIVE_TOKENS):
            raw["_missing_reason"] = (
                "The requested amount is qualitative; an explicit measurement "
                "is required before this can be simulated."
            )
        elif operation is not None or parameter is not None or target is not None:
            raw["_missing_reason"] = "A measurement is required; no numeric value was provided."

    # Rotation requires an explicit direction.
    if operation == Operation.rotate and direction is None:
        raw["_ambiguous"] = "Rotation direction is required (for example: upward or downward)."
        return raw

    # Contradiction within a single clause.
    if not is_correction:
        if OP_INCREASE.search(verb_working) and OP_DECREASE.search(verb_working):
            raw["_ambiguous"] = (
                "This phrase contains contradictory actions; please restate a "
                "single direction."
            )
            return raw

    if is_correction:
        raw["_note"] = "Interpreted as a self-correction of the previous phrase."
    elif resolved_from_context:
        raw["_note"] = "Resolved from the previous instruction in this session."

    # Slightly lower confidence when key fields were inferred.
    if parameter is not None and not (
        PARAM_HEIGHT.search(clause)
        or PARAM_WIDTH.search(clause)
        or PARAM_PROJECTION.search(clause)
        or PARAM_ROTATION.search(clause)
        or PARAM_FULLNESS.search(clause)
        or PARAM_DEFINITION.search(clause)
    ):
        raw["confidence"] = min(raw["confidence"], 0.8)

    return raw


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _sign(operation: Optional[str], direction: Optional[str]) -> int:
    if operation in ("increase", "raise", "widen"):
        return 1
    if operation in ("decrease", "lower", "narrow"):
        return -1
    if operation == "rotate":
        return -1 if direction == "down" else 1
    return 0


def flag_contradictions(instructions: List[Instruction]) -> List[Instruction]:
    """Mark opposing instructions on the same parameter as contradictory."""
    groups: Dict[Tuple, List[int]] = {}
    for idx, ins in enumerate(instructions):
        if ins.status != InstructionStatus.ok or ins.value is None:
            continue
        key = (ins.target, ins.parameter)
        groups.setdefault(key, []).append(idx)

    for indices in groups.values():
        signs = {_sign(instructions[i].operation.value if instructions[i].operation else None,
                       instructions[i].direction) for i in indices}
        if 1 in signs and -1 in signs:
            for i in indices:
                instructions[i] = instructions[i].model_copy(
                    update={
                        "status": InstructionStatus.needs_clarification,
                        "reason": (
                            "Contradictory instructions were given for the same "
                            "parameter. Please state a single direction."
                        ),
                        "confidence": min(instructions[i].confidence, 0.3),
                    }
                )
    return instructions


def parse_text(text: str, context: Optional[List[ContextItem]] = None) -> List[Instruction]:
    """Parse free text into a deterministic list of instructions."""
    context = context or []
    segments = _split_segments(text) or [text.strip()]

    merged: List[Dict] = []
    for seg in segments:
        previous = merged[-1] if merged else None
        raw = _parse_clause(seg, context, previous)
        if raw.get("_supersedes") and merged:
            merged[-1] = raw
        else:
            merged.append(raw)

    instructions: List[Instruction] = []
    for raw in merged:
        clause = raw["original_text"]
        if raw["_no_change"]:
            target, _ = _safe_target(raw["target"])
            instructions.append(
                Instruction(
                    target=target,
                    parameter=None,
                    operation=None,
                    value=None,
                    unit=None,
                    confidence=raw["confidence"],
                    requires_confirmation=False,
                    status=InstructionStatus.no_change,
                    reason="No change requested (negated or 'keep unchanged' instruction).",
                    original_text=clause,
                    parser=ParserSource.rules,
                )
            )
            continue
        if raw["_unsupported"]:
            instructions.append(
                Instruction(
                    target=_safe_target(raw["target"])[0],
                    confidence=raw["confidence"],
                    requires_confirmation=False,
                    status=InstructionStatus.unsupported,
                    reason=raw["_unsupported"],
                    original_text=clause,
                    parser=ParserSource.rules,
                )
            )
            continue
        if raw["_ambiguous"]:
            instructions.append(
                Instruction(
                    target=_safe_target(raw["target"])[0],
                    confidence=raw["confidence"],
                    requires_confirmation=False,
                    status=InstructionStatus.needs_clarification,
                    reason=raw["_ambiguous"],
                    original_text=clause,
                    parser=ParserSource.rules,
                )
            )
            continue

        instr = build_instruction(
            raw, clause, ParserSource.rules, missing_reason=raw.get("_missing_reason")
        )
        if raw.get("_note") and instr.status == InstructionStatus.ok:
            instr = instr.model_copy(update={"reason": raw["_note"]})
        instructions.append(instr)

    return flag_contradictions(instructions)


def _safe_target(value) -> Tuple[Optional[TargetRegion], None]:
    if not value:
        return None, None
    try:
        return TargetRegion(value), None
    except ValueError:
        return None, None


def _safe_parameter(value) -> Optional[Parameter]:
    if not value:
        return None
    try:
        return Parameter(value)
    except ValueError:
        return None


def _safe_operation(value) -> Optional[Operation]:
    if not value:
        return None
    try:
        return Operation(value)
    except ValueError:
        return None
