"""Backend access to the shared clinical parameter registry.

The JSON file at ``shared/clinical_parameters.json`` is the single source of
truth for both the Python parser and the React frontend. This module only adds
typed accessors and integrity checks; it never invents or mutates parameters.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

from .schemas import Parameter, TargetRegion, Unit

REGISTRY_PATH = Path(
    os.environ.get(
        "VOICESURG_CLINICAL_REGISTRY",
        Path(__file__).resolve().parents[2] / "shared" / "clinical_parameters.json",
    )
)


@dataclass(frozen=True)
class ClinicalParameter:
    key: str
    clinical_name: str
    group: str
    anatomical_region: str
    parameter_type: Parameter
    value_kind: str
    unit: Optional[Unit]
    definition: str
    synonyms: Tuple[str, ...]
    operations: Tuple[str, ...]
    min_value: float
    max_value: float
    default: float
    parser_status: str
    parser_target: TargetRegion
    parser_parameter: Parameter
    reviewable: bool
    simulation_status: str
    model_field: Optional[str]
    driver: Optional[str]
    source: str
    limitations: str

    @property
    def simulated(self) -> bool:
        return self.simulation_status == "simulated"

    @property
    def parser_supported(self) -> bool:
        return self.parser_status == "supported"


def _load() -> Dict[str, ClinicalParameter]:
    if not REGISTRY_PATH.exists():
        raise RuntimeError(f"Clinical registry not found: {REGISTRY_PATH}")
    payload = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    if payload.get("schema") != 1:
        raise ValueError(f"Unsupported clinical registry schema: {payload.get('schema')}")

    loaded: Dict[str, ClinicalParameter] = {}
    for raw in payload.get("parameters", []):
        key = raw["key"]
        if key in loaded:
            raise ValueError(f"Duplicate clinical parameter key: {key}")
        simulation = raw["simulation"]
        parser = raw["parser"]
        try:
            target = TargetRegion(parser["target"])
            parameter = Parameter(parser["parameter"])
        except (KeyError, ValueError) as exc:
            raise ValueError(f"Invalid parser mapping for {key}: {exc}") from exc
        unit = Unit(raw["unit"]) if raw.get("unit") is not None else None
        if simulation["status"] == "simulated":
            if not simulation.get("modelField") or not simulation.get("driver"):
                raise ValueError(
                    f"Simulated parameter {key} requires modelField and driver"
                )
        loaded[key] = ClinicalParameter(
            key=key,
            clinical_name=raw["clinicalName"],
            group=raw["group"],
            anatomical_region=raw["anatomicalRegion"],
            parameter_type=Parameter(raw["parameterType"]),
            value_kind=raw["valueKind"],
            unit=unit,
            definition=raw["definition"],
            synonyms=tuple(raw.get("synonyms", ())),
            operations=tuple(raw.get("operations", ())),
            min_value=float(raw["min"]),
            max_value=float(raw["max"]),
            default=float(raw["default"]),
            parser_status=parser["status"],
            parser_target=target,
            parser_parameter=parameter,
            reviewable=bool(raw["reviewable"]),
            simulation_status=simulation["status"],
            model_field=simulation.get("modelField"),
            driver=simulation.get("driver"),
            source=raw["source"],
            limitations=raw["limitations"],
        )
    if not loaded:
        raise ValueError("Clinical registry is empty")
    return loaded


CLINICAL_PARAMETERS: Dict[str, ClinicalParameter] = _load()


def get_clinical_parameter(key: Optional[str]) -> Optional[ClinicalParameter]:
    if not key:
        return None
    return CLINICAL_PARAMETERS.get(key)


def simulated_parameters() -> Iterable[ClinicalParameter]:
    return (p for p in CLINICAL_PARAMETERS.values() if p.simulated)


def is_simulated_key(key: Optional[str]) -> bool:
    parameter = get_clinical_parameter(key)
    return bool(parameter and parameter.simulated)


def model_field_for_key(key: Optional[str]) -> Optional[str]:
    parameter = get_clinical_parameter(key)
    return parameter.model_field if parameter and parameter.simulated else None


# ---------------------------------------------------------------------------
# Phrase matching
# ---------------------------------------------------------------------------

_APOSTROPHES = str.maketrans({"\u2018": "'", "\u2019": "'"})


def normalize_phrase(value: str) -> str:
    """Case-, hyphen- and punctuation-insensitive phrase normalization."""

    text = value.lower().translate(_APOSTROPHES)
    text = text.replace("-", " ").replace("_", " ")
    text = re.sub(r"[^a-z0-9'.]+", " ", text)
    # Articles do not change the clinical concept, and ASR often drops them.
    text = re.sub(r"\b(?:the|a|an)\b", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


@dataclass(frozen=True)
class ClinicalMatch:
    key: Optional[str]
    synonym: Optional[str]
    length: int
    candidates: Tuple[str, ...]
    ambiguous: bool = False


_SYNONYM_INDEX: Tuple[Tuple[str, str], ...] = tuple(
    sorted(
        (
            (normalize_phrase(synonym), parameter.key)
            for parameter in CLINICAL_PARAMETERS.values()
            for synonym in parameter.synonyms
            if normalize_phrase(synonym)
        ),
        key=lambda item: (-len(item[0].split()), -len(item[0]), item[1]),
    )
)


def match_clinical_parameter(text: str) -> ClinicalMatch:
    """Find the most specific clinical concept in one clause.

    Ambiguous equal-length matches (for example "alar width and flare") return
    ``ambiguous=True`` rather than choosing one silently. Ties are broken by
    word count first, then character length, so "dorsal hump reduction" always
    beats the generic "dorsal".
    """

    normalized = normalize_phrase(text)
    if not normalized:
        return ClinicalMatch(None, None, 0, ())

    matches: list[Tuple[int, int, str, str]] = []
    for synonym, key in _SYNONYM_INDEX:
        pattern = r"(?<![a-z0-9])" + re.escape(synonym).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
        if re.search(pattern, normalized):
            matches.append((len(synonym.split()), len(synonym), key, synonym))
    if not matches:
        return ClinicalMatch(None, None, 0, ())
    matches.sort(key=lambda item: (-item[0], -item[1], item[2]))
    top_words, top_len, top_key, top_synonym = matches[0]
    tied = {
        key
        for words, length, key, _ in matches
        if words == top_words and length == top_len and key != top_key
    }
    if tied:
        return ClinicalMatch(
            None,
            None,
            top_len,
            tuple(sorted({top_key, *tied})),
            ambiguous=True,
        )
    return ClinicalMatch(top_key, top_synonym, top_len, (top_key,))


def unique_pair_for(key: str) -> Tuple[TargetRegion, Parameter]:
    parameter = CLINICAL_PARAMETERS[key]
    return parameter.parser_target, parameter.parser_parameter
