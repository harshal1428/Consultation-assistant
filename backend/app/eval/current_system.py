"""Adapter around the real current backend parse path.

The harness deliberately forces the optional Gemini path offline. Everything
else is the same orchestration used by ``POST /api/parse-command``:
``parser_service.parse_command`` -> deterministic rules first -> hard negatives
short-circuit -> validation -> fallback. This makes the baseline deterministic
and avoids network/API-key use in CI.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List
from unittest import mock

from .. import parser_service
from ..llm_parser import LlmError
from .gold_io import LIVE_DECISIONS_PATH, PARSE_RESULTS_PATH, GoldRow


def parse_offline(text: str) -> Dict:
    """Run the current parse pipeline with the LLM path forced unavailable."""
    with mock.patch.object(
        parser_service, "parse_with_llm", side_effect=LlmError("offline gold eval")
    ):
        response = parser_service.parse_command(text)
    return {
        "text": response.text,
        "instructions": [instruction.model_dump(mode="json") for instruction in response.instructions],
    }


class CurrentSystemAdapter:
    """The system under test: current parser + real TS live decision fixtures."""

    name = "current_system"

    def parse(self, text: str) -> Dict:
        return parse_offline(text)

    def parse_rows(self, rows: Iterable[GoldRow]) -> List[Dict]:
        results = []
        for row in rows:
            parsed = self.parse(row.text)
            results.append(
                {
                    "key": row.key,
                    "text": row.text,
                    "label": row.label,
                    "category": row.category,
                    "split": row.split,
                    "instructions": parsed["instructions"],
                }
            )
        return results


def export_parse_results(
    rows: Iterable[GoldRow], path: Path = PARSE_RESULTS_PATH
) -> List[Dict]:
    results = CurrentSystemAdapter().parse_rows(rows)
    payload = {
        "generated_by": "backend/app/eval/current_system.py",
        "note": (
            "Real parse_command output with the LLM path forced offline. "
            "Regenerate with: python -m app.eval.cli --export"
        ),
        "rows": results,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return results


def load_parse_results(path: Path = PARSE_RESULTS_PATH) -> Dict[str, Dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} does not exist. Run: python -m app.eval.cli --export"
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {row["key"]: row for row in payload.get("rows", [])}


def load_live_decisions(path: Path = LIVE_DECISIONS_PATH) -> Dict[str, Dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} does not exist. Run the Vitest gold fixture test:\n"
            "  cd frontend && npx vitest run tests/goldLiveDecisions.test.ts"
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("rows", {})
