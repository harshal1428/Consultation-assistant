"""Orchestration between the Gemini parser and the deterministic fallback.

Policy (documented in ``docs/PHASE_3_REPORT.md``):

1. Always compute the deterministic rules result first.
2. If the rules parser finds a hard negative (unsupported region or an explicit
   negation) return it immediately — the model must never turn those into a
   positive action.
3. Otherwise try Gemini; validate its raw output against the strict contract.
4. If Gemini is unavailable, malformed, empty, or produces nothing usable,
   fall back to the rules result.
5. A qualitative phrase may never acquire an invented numeric value.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from typing import List, Optional

from .parser import NEGATION_KEEP, NEGATION_PREFIX, QUALITATIVE_TOKENS, flag_contradictions, parse_text
from .llm_parser import LlmError, parse_with_llm
from .schemas import (
    ContextItem,
    Instruction,
    InstructionStatus,
    ParseResponse,
    ParserSource,
)
from .validation import build_instruction

logger = logging.getLogger(__name__)

# Hard wall-clock ceiling for a single Gemini call. The SDK is configured with
# its own 15s timeout, but a provider/network stall must never leave the UI
# stuck on "Processing…", so this guarantees a bounded response either way.
LLM_CALL_TIMEOUT_S = 12.0
_LLM_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm-parse")


def _call_llm_bounded(text: str, context: List[ContextItem]) -> List[dict]:
    """Run the Gemini call under a hard timeout, raising :class:`LlmError`."""

    future = _LLM_EXECUTOR.submit(parse_with_llm, text, context)
    try:
        return future.result(timeout=LLM_CALL_TIMEOUT_S)
    except FuturesTimeoutError as exc:
        future.cancel()
        raise LlmError(
            f"Gemini call exceeded {LLM_CALL_TIMEOUT_S:.0f}s"
        ) from exc


_QUALITATIVE_RE = re.compile(
    r"\b(" + "|".join(re.escape(q) for q in QUALITATIVE_TOKENS) + r")\b", re.I
)


def _rules_hard_negative(text: str, rules: List[Instruction]) -> bool:
    if NEGATION_PREFIX.search(text) or NEGATION_KEEP.search(text):
        return True
    return any(
        i.status
        in (
            InstructionStatus.unsupported,
            InstructionStatus.no_change,
            # A registered-only concept must not be handed to the language model
            # where a similar simulated parameter could be substituted.
            InstructionStatus.not_simulated,
        )
        for i in rules
    )


def _guard_qualitative(instructions: List[Instruction]) -> List[Instruction]:
    guarded: List[Instruction] = []
    for ins in instructions:
        if (
            ins.status == InstructionStatus.ok
            and ins.value is not None
            and _QUALITATIVE_RE.search(ins.original_text)
        ):
            ins = ins.model_copy(
                update={
                    "value": None,
                    "status": InstructionStatus.needs_clarification,
                    "reason": (
                        "The requested amount is qualitative; an explicit "
                        "measurement is required before this can be simulated."
                    ),
                    "confidence": min(ins.confidence, 0.5),
                }
            )
        guarded.append(ins)
    return guarded


def parse_command(text: str, context: Optional[List[ContextItem]] = None) -> ParseResponse:
    context = (context or [])[-4:]

    rules = parse_text(text, context)

    if _rules_hard_negative(text, rules):
        return ParseResponse(instructions=rules, text=text)

    try:
        raw_items = _call_llm_bounded(text, context)
    except LlmError as exc:
        logger.info("Falling back to deterministic parser: %s", exc)
        return ParseResponse(instructions=rules, text=text)

    llm_instructions: List[Instruction] = []
    for item in raw_items:
        original = str(item.get("original_text") or text)
        item = dict(item)
        item.setdefault("original_text", original)
        llm_instructions.append(
            build_instruction(item, original, ParserSource.llm)
        )

    if not llm_instructions or all(
        i.status == InstructionStatus.invalid for i in llm_instructions
    ):
        logger.info("Gemini output was unusable; using deterministic parser.")
        return ParseResponse(instructions=rules, text=text)

    llm_instructions = flag_contradictions(_guard_qualitative(llm_instructions))
    return ParseResponse(instructions=llm_instructions, text=text)
