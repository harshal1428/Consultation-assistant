"""Deterministic spoken-number and unit normalisation.

The goal is to make the existing parser see the same canonical text that a
person typed. This module never invents a numeric value for a vague quantity
("a bit", "slightly", "a touch" remain vague) and never changes an existing
digit's value.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

NUMBER_WORDS = {
    "zero": 0,
    "oh": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}

TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
        "seventy": 70, "eighty": 80, "ninety": 90}

UNIT_ALIASES = [
    (re.compile(r"\bmilli\s*met(?:er|re)s?\b", re.I), "mm"),
    (re.compile(r"\bmilli\s*meters?\b", re.I), "mm"),
    (re.compile(r"\bm\s*m\b", re.I), "mm"),
    (re.compile(r"\bmms?\b", re.I), "mm"),
    (re.compile(r"\bmils?\b", re.I), "mm"),
    (re.compile(r"\bcenti\s*met(?:er|re)s?\b", re.I), "cm"),
    (re.compile(r"\bcenti\s*meters?\b", re.I), "cm"),
    (re.compile(r"\bcm\b", re.I), "cm"),
    (re.compile(r"\binches?\b", re.I), "inch"),
    (re.compile(r"\bdegs?\b", re.I), "degrees"),
    (re.compile(r"\bdegree\b", re.I), "degrees"),
    (re.compile(r"per\s*cent", re.I), "percent"),
]

FILLER_PATTERNS = [
    re.compile(r"\b(?:um+|uh+|hmm+|erm?|ah+)\b", re.I),
    re.compile(r"\byou know\b", re.I),
    re.compile(r"\bsort of\b", re.I),
    re.compile(r"\bkind of\b", re.I),
    re.compile(r"\bokay so\b", re.I),
    re.compile(r"\bjust a moment\b", re.I),
    re.compile(r"\bhere we go\b", re.I),
    re.compile(r"\bstep one\b", re.I),
    re.compile(r"\bstatus\.?\s*nose\.?\s*pout\b", re.I),
    re.compile(r"\bbop\b", re.I),
    re.compile(r"\bradix\b", re.I),
    re.compile(r"\bpout\b", re.I),
]

_ONES = "zero|one|two|three|four|five|six|seven|eight|nine|oh"
_NUM = (
    "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    "thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|"
    "thirty|forty|fifty|sixty|seventy|eighty|ninety"
)
_UNITS = r"(?:mm|cm|centimeters?|centimetres?|millimeters?|millimetres?|degrees?|deg|inch(?:es)?|percent|%)"


@dataclass
class NormalizationResult:
    text: str
    edits: List[str] = field(default_factory=list)


def _num(word: str) -> int:
    return NUMBER_WORDS.get(word.lower(), TENS.get(word.lower(), 0))


def _replace_number_phrases(text: str, edits: List[str]) -> str:
    original = text

    def decimal(match: re.Match) -> str:
        whole = _num(match.group(1))
        fraction = "".join(str(_num(part)) for part in match.group(2, 3) if part)
        return f"{whole}.{fraction}"

    text = re.sub(
        rf"\b({_NUM})\s+point\s+({_ONES})(?:\s+({_ONES}))?\b",
        decimal,
        text,
        flags=re.I,
    )
    text = re.sub(
        r"\b(?:oh|zero)\s+point\s+(" + _ONES + r")\b",
        lambda m: "0." + str(_num(m.group(1))),
        text,
        flags=re.I,
    )
    text = re.sub(
        r"\bpoint\s+(" + _ONES + r")\b",
        lambda m: "0." + str(_num(m.group(1))),
        text,
        flags=re.I,
    )

    # "two and a half", "one and a half"
    text = re.sub(
        rf"\b({_NUM})\s+and\s+a\s+half\b",
        lambda m: f"{_num(m.group(1)) + 0.5:g}",
        text,
        flags=re.I,
    )
    # "three quarters of a mm" before the single-quarter rule.
    text = re.sub(
        r"\bthree\s+quarters?\s+(?:of\s+)?(?:a\s+)?" + _UNITS + r"\b",
        lambda m: "0.75 " + _canonical_unit(m.group(0).split()[-1]),
        text,
        flags=re.I,
    )
    # "half a mm", "a half mm", "half mm"
    text = re.sub(
        r"\b(?:a\s+)?half\s+(?:of\s+)?(?:a\s+)?" + _UNITS + r"\b",
        lambda m: "0.5 " + _canonical_unit(m.group(0).split()[-1]),
        text,
        flags=re.I,
    )
    # "a quarter of a mm", "quarter mm"
    text = re.sub(
        r"\b(?:a\s+)?quarter\s+(?:of\s+)?(?:a\s+)?" + _UNITS + r"\b",
        lambda m: "0.25 " + _canonical_unit(m.group(0).split()[-1]),
        text,
        flags=re.I,
    )
    # "a millimeter" / "an inch" -> 1 unit
    text = re.sub(
        r"\b(?:a|an)\s+(" + _UNITS + r")\b",
        lambda m: "1 " + _canonical_unit(m.group(1)),
        text,
        flags=re.I,
    )
    # "twenty five" / "twenty-five"
    def compound(match: re.Match) -> str:
        return str(TENS[match.group(1).lower()] + _num(match.group(2)))

    text = re.sub(
        r"\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]"
        r"(one|two|three|four|five|six|seven|eight|nine)\b",
        compound,
        text,
        flags=re.I,
    )
    text = re.sub(
        r"\b(one|two|three|four|five|six|seven|eight|nine|a)\s+hundred\b",
        lambda m: "100" if m.group(1).lower() == "a" else str(_num(m.group(1)) * 100),
        text,
        flags=re.I,
    )
    # Number directly before a unit: "two mm", "three degrees".
    text = re.sub(
        rf"\b({_NUM})\s+({_UNITS})\b",
        lambda m: f"{_num(m.group(1))} {_canonical_unit(m.group(2))}",
        text,
        flags=re.I,
    )
    # "by two" / "to two" at the end or before a unit/punctuation.
    text = re.sub(
        rf"\b(by|to)\s+({_NUM})\b(?=\s*(?:{_UNITS}|$|[,.;]))",
        lambda m: f"{m.group(1)} {_num(m.group(2))}",
        text,
        flags=re.I,
    )
    if text != original:
        edits.append("number/unit words -> canonical digits and units")
    return text


def _canonical_unit(unit: str) -> str:
    unit = unit.strip().lower().rstrip(".,;")
    if unit in {"millimeter", "millimeters", "millimetre", "millimetres", "mm", "mil", "mils"}:
        return "mm"
    if unit in {"centimeter", "centimeters", "centimetre", "centimetres", "cm"}:
        return "cm"
    if unit in {"degree", "degrees", "deg", "°"}:
        return "degrees"
    if unit in {"inch", "inches"}:
        return "inch"
    if unit in {"percent", "%"}:
        return "percent"
    return unit


def normalize_voice_text(raw: str) -> NormalizationResult:
    edits: List[str] = []
    text = (raw or "").strip().lower()
    if not text:
        return NormalizationResult("", edits)

    text = text.replace("°", " degrees ").replace("%", " percent ")
    for pattern, replacement in UNIT_ALIASES:
        new_text = pattern.sub(replacement, text)
        if new_text != text:
            edits.append("unit aliases -> canonical units")
            text = new_text

    for pattern in FILLER_PATTERNS:
        new_text = pattern.sub(" ", text)
        if new_text != text:
            edits.append("removed filler")
            text = new_text

    text = _replace_number_phrases(text, edits)
    # Final unit pass after number substitutions.
    for pattern, replacement in UNIT_ALIASES:
        text = pattern.sub(replacement, text)
    text = re.sub(r"\bmm\s+mm\b", "mm", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" ,.;")
    if text.startswith("and "):
        text = text[4:].strip()
    if text != (raw or "").strip().lower():
        edits.append("whitespace/punctuation normalised")
    return NormalizationResult(text, list(dict.fromkeys(edits)))


_NUMBER_TOKEN_RE = re.compile(r"(?<![a-z])-?\d+(?:\.\d+)?(?![a-z])")


def extract_numbers(text: str) -> List[dict]:
    """Return numeric tokens with an optional adjacent unit."""
    results = []
    for match in _NUMBER_TOKEN_RE.finditer(text or ""):
        tail = text[match.end() : match.end() + 18].strip().lower()
        unit = ""
        for candidate in ("mm", "degrees", "inch", "percent"):
            if tail.startswith(candidate):
                unit = candidate
                break
        results.append({"text": match.group(0), "value": float(match.group(0)), "unit": unit})
    return results
