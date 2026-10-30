"""Gold-set data model and tolerant reader.

The CSV is the source of truth and is never modified. A few source rows contain
column-shift typos (missing or extra commas). Those known, documented anomalies
are repaired in memory here so the rest of the harness can work with typed
values. The repairs are deliberately explicit and limited; unknown malformed
rows still fail validation.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence

GOLD_DIR = Path(__file__).resolve().parents[2] / "tests" / "gold"
CSV_PATH = GOLD_DIR / "utterances.csv"
SPLITS_PATH = GOLD_DIR / "splits.json"
BASELINE_PATH = GOLD_DIR / "baseline.json"
REPORTS_DIR = GOLD_DIR / "reports"
PARSE_RESULTS_PATH = GOLD_DIR / "parse_results.json"
LIVE_DECISIONS_PATH = GOLD_DIR / "live_decisions.json"

REQUIRED_COLUMNS = [
    "text",
    "label",
    "parameter",
    "direction",
    "value",
    "unit",
    "side",
    "note",
    "conversation_id",
    "turn_index",
    "source",
]

BASE_LABELS = {
    "command",
    "proposal",
    "question",
    "confirm",
    "reject",
    "undo",
    "view",
    "ignored",
}

PARAMETER_VOCAB = {
    "height",
    "width",
    "projection",
    "rotation",
    "fullness",
    "definition",
}

DIRECTION_VOCAB = {"up", "down"}
UNIT_VOCAB = {"mm", "cm", "degrees", "inch"}
SIDE_VOCAB = {"", "left", "right", "both", "bilateral"}

CATEGORY_BY_LABEL = {
    "command": "direct_command",
    "proposal": "proposal",
    "question": "question",
    "confirm": "confirm",
    "reject": "reject",
    "undo": "undo",
    "view": "view",
    "ignored": "chatter",
}

#: Rows whose source file has a known comma typo. ``insert`` adds the missing
#: blank cell at ``at``; ``drop`` removes the extra blank cell at ``at``.
KNOWN_SHIFTED_ROWS = {
    # Missing the blank ``side`` cell: side/note/conversation/turn/source shifted.
    "sess129:1": {"at": "side", "mode": "insert"},
    # Extra blank cell between direction and value.
    "sess197:1": {"at": "value", "mode": "drop"},
    # Compound label plus shifted slots. The slot columns are not reliable, so
    # only text/label/note/session metadata are used for this row.
    "sess248:1": {"at": "side", "mode": "insert", "clear_slots": True},
}

#: Pre-repair text -> known row key, because a bad shift can also corrupt the
#: key columns.
KNOWN_SHIFTED_TEXTS = {
    "We should probably check the alar width first": "sess129:1",
    "Maybe do the bridge by 2 mm": "sess197:1",
    "Raise the bridge by 2 mm could we also narrow the alar base": "sess248:1",
}


def canonical_label(label: str) -> str:
    """Return the base label (``command;width`` -> ``command``)."""
    return (label or "").split(";", 1)[0].strip().lower()


def label_parts(label: str) -> List[str]:
    return [p.strip().lower() for p in (label or "").split(";") if p.strip()]


def category_for_label(label: str) -> str:
    return CATEGORY_BY_LABEL.get(canonical_label(label), "unknown")


def file_sha256(path: Path = CSV_PATH) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass
class GoldRow:
    text: str
    label: str
    parameter: str = ""
    direction: str = ""
    value: str = ""
    unit: str = ""
    side: str = ""
    note: str = ""
    conversation_id: str = ""
    turn_index: str = ""
    source: str = ""
    line_number: int = 0
    split: Optional[str] = None
    repaired: List[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.conversation_id}:{self.turn_index}"

    @property
    def canonical_label(self) -> str:
        return canonical_label(self.label)

    @property
    def category(self) -> str:
        return category_for_label(self.label)

    @property
    def is_command(self) -> bool:
        return self.canonical_label == "command"

    @property
    def parameters(self) -> List[str]:
        return _split_slots(self.parameter)

    @property
    def directions(self) -> List[str]:
        return _split_slots(self.direction)

    @property
    def values(self) -> List[str]:
        return _split_slots(self.value)

    @property
    def units(self) -> List[str]:
        return _split_slots(self.unit)

    @property
    def sides(self) -> List[str]:
        return _split_slots(self.side)

    @property
    def expected_slot_count(self) -> int:
        counts = [
            len(self.parameters),
            len(self.directions),
            len(self.values),
            len(self.units),
            len(self.sides),
        ]
        return max(counts) if counts else 0


def _clean(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _split_slots(value: str) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str) and ";" in value:
        return [part.strip() for part in value.split(";")]
    text = str(value).strip()
    return [text] if text else []


def _repair_shifted(row: dict, repair: dict) -> dict:
    """Repair a known missing/extra blank cell."""
    out = dict(row)
    columns = REQUIRED_COLUMNS
    start = columns.index(repair["at"])
    extra = out.pop(None, None)
    values = [out.get(col, "") for col in columns]
    if extra:
        values = values + list(extra)
    if repair["mode"] == "insert":
        shifted = values[:start] + [""] + values[start:]
    else:
        shifted = values[:start] + values[start + 1 :]
    for index, col in enumerate(columns):
        out[col] = shifted[index] if index < len(shifted) else ""
    if repair.get("clear_slots"):
        for col in ("parameter", "direction", "value", "unit", "side"):
            out[col] = ""
    return out


def _row_from_dict(raw: dict, line_number: int) -> GoldRow:
    # Keep the csv restkey (``None``) until after a known shift is repaired.
    text = _clean(raw.get("text"))
    key_guess = f"{_clean(raw.get('conversation_id'))}:{_clean(raw.get('turn_index'))}"
    repair = KNOWN_SHIFTED_ROWS.get(key_guess)
    if repair is None and text in KNOWN_SHIFTED_TEXTS:
        repair = KNOWN_SHIFTED_ROWS[KNOWN_SHIFTED_TEXTS[text]]
    repaired: List[str] = []
    if repair is not None:
        raw = _repair_shifted(raw, repair)
        repaired.append("column_shift")
    raw = {key: _clean(value) for key, value in raw.items() if key is not None}
    return GoldRow(
        text=_clean(raw.get("text")),
        label=_clean(raw.get("label")),
        parameter=_clean(raw.get("parameter")),
        direction=_clean(raw.get("direction")),
        value=_clean(raw.get("value")),
        unit=_clean(raw.get("unit")),
        side=_clean(raw.get("side")),
        note=_clean(raw.get("note")),
        conversation_id=_clean(raw.get("conversation_id")),
        turn_index=_clean(raw.get("turn_index")),
        source=_clean(raw.get("source")),
        line_number=line_number,
        repaired=repaired,
    )


def load_gold_rows(path: Path = CSV_PATH) -> List[GoldRow]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"Gold CSV is missing required columns: {', '.join(missing)}")
        rows: List[GoldRow] = []
        for line_number, raw in enumerate(reader, start=2):
            rows.append(_row_from_dict(raw, line_number))
    return rows


def load_splits(path: Path = SPLITS_PATH) -> Dict:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} does not exist. Run: python tests/gold/make_splits.py"
        )
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if "assignments" not in data or not isinstance(data["assignments"], dict):
        raise ValueError("splits.json must contain an 'assignments' object")
    return data


def attach_splits(rows: Iterable[GoldRow], splits: Optional[Dict] = None) -> List[GoldRow]:
    data = splits or load_splits()
    assignments = data["assignments"]
    result = []
    for row in rows:
        if row.key not in assignments:
            raise ValueError(f"Row {row.key!r} is missing from splits.json")
        row.split = assignments[row.key]
        result.append(row)
    return result


def rows_for_split(rows: Sequence[GoldRow], split: str) -> List[GoldRow]:
    return [row for row in rows if row.split == split]


def expected_slots(row: GoldRow) -> List[Dict[str, str]]:
    count = row.expected_slot_count
    parameters = row.parameters
    directions = row.directions
    values = row.values
    units = row.units
    sides = row.sides
    slots: List[Dict[str, str]] = []
    for index in range(count):
        slots.append(
            {
                "parameter": parameters[index] if index < len(parameters) else "",
                "direction": directions[index] if index < len(directions) else "",
                "value": values[index] if index < len(values) else "",
                "unit": units[index] if index < len(units) else "",
                "side": sides[index] if index < len(sides) else "",
            }
        )
    return slots


def near_duplicate_pairs(texts: Sequence[str], threshold: float = 95.0) -> List[tuple]:
    """Return (i, j, score) for near-duplicate utterance texts."""
    pairs = []
    try:
        from rapidfuzz import fuzz
    except Exception:  # pragma: no cover - optional dependency fallback
        from difflib import SequenceMatcher

        for i in range(len(texts)):
            for j in range(i + 1, len(texts)):
                score = SequenceMatcher(None, texts[i], texts[j]).ratio() * 100
                if score > threshold:
                    pairs.append((i, j, score))
        return pairs

    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            score = fuzz.ratio(texts[i], texts[j])
            if score > threshold:
                pairs.append((i, j, score))
    return pairs


def is_numeric(value: str) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def numeric_value(value: str) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalise_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())
