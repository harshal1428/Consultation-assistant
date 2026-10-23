"""Gemini-backed intent parser.

This module only *extracts* candidate intent as raw dictionaries. Validation,
unit normalization and enum coercion happen in :mod:`.validation`, exactly as
for the deterministic parser, so the model can never bypass the contract.
"""

import json
import logging
import os
from typing import Dict, List, Optional

from .schemas import ContextItem

logger = logging.getLogger(__name__)

MODEL_NAME = "gemini-2.5-flash"
REQUEST_TIMEOUT_MS = 15000


class LlmError(RuntimeError):
    """Raised whenever the language-model path cannot produce usable output."""


SYSTEM_INSTRUCTION = """
You are a clinical simulation command parser for a facial-simulation training prototype.
You do not give medical advice and you never recommend procedures.
You translate the surgeon's instruction into a strict JSON schema.
Never invent numerical values. If a measurement is missing or qualitative, set value to null.
If a phrase is negated (e.g. "do not reduce the bridge"), set operation to null.
If a region is unsupported (brow, forehead, eyes, ears, mouth), set target to null.

Supported targets (enums):
nasal_bridge, nasal_dorsum, nasal_tip, nostril_region,
upper_lip, lower_lip, chin, jawline, cheek

Supported parameters (enums):
height, width, projection, rotation, fullness, definition

Supported operations (enums):
increase, decrease, rotate, narrow, widen, raise, lower

Supported units (enums):
mm, cm, degrees

Anatomical synonyms: bridge/radix -> nasal_bridge, dorsum -> nasal_dorsum,
tip/pronasale/supratip -> nasal_tip, nostril/alar/ala -> nostril_region,
upper lip -> upper_lip, lower lip -> lower_lip, chin/menton/pogonion -> chin,
jaw/jawline/mandible -> jawline, cheek/malar/zygomatic -> cheek.

Parameter notes: "fullness"/"plump"/"prominence" -> fullness;
"definition"/"sharpen"/"contour"/"angular" -> definition. If a lip instruction
does not say upper or lower, set target to null (it is ambiguous).

Multiple instructions: return one array element per independent instruction, in spoken order.

Return JSON with this exact shape:
{
  "instructions": [
    {
      "target": string | null,
      "parameter": string | null,
      "operation": string | null,
      "value": number | null,
      "unit": "mm" | "cm" | "degrees" | null,
      "direction": "up" | "down" | null,
      "confidence": number,
      "original_text": string
    }
  ]
}
Report the unit exactly as spoken (do not convert cm to mm yourself).
"""


def _client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise LlmError("GEMINI_API_KEY is not configured")
    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise LlmError("google-genai package is not installed") from exc
    try:
        return genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
        ), types
    except Exception:  # pragma: no cover - older SDK without http_options
        return genai.Client(api_key=api_key), types


def _extract_json(text: str) -> Dict:
    content = text.strip()
    if content.startswith("```"):
        content = content.split("```", 2)[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise LlmError(f"Model returned malformed JSON: {exc}") from exc


def parse_with_llm(
    text: str, context: Optional[List[ContextItem]] = None
) -> List[Dict]:
    """Return raw instruction dicts from Gemini, or raise :class:`LlmError`."""

    client, types = _client()

    context_block = ""
    if context:
        items = [
            {
                "target": c.target.value if c.target else None,
                "parameter": c.parameter.value if c.parameter else None,
                "operation": c.operation.value if c.operation else None,
                "value": c.value,
                "unit": c.unit.value if c.unit else None,
            }
            for c in context[-4:]
        ]
        context_block = (
            "\nRecent session context (most recent last). Use it only to resolve "
            "references such as 'that' or 'it':\n" + json.dumps(items)
        )

    prompt = f"Parse the surgeon instruction into the JSON schema.{context_block}\n\nInstruction: {text}"

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )
    except Exception as exc:  # noqa: BLE001 - provider/network/timeout errors
        raise LlmError(f"Gemini request failed: {exc}") from exc

    if not getattr(response, "text", None):
        raise LlmError("Gemini returned an empty response")

    data = _extract_json(response.text)
    instructions = data.get("instructions")
    if not isinstance(instructions, list) or not instructions:
        raise LlmError("Gemini response did not contain any instructions")

    cleaned: List[Dict] = []
    for item in instructions:
        if not isinstance(item, dict):
            raise LlmError("Gemini returned a non-object instruction")
        cleaned.append(item)
    return cleaned
