"""Strict xfail target for the later commitment gate.

The current parser happens to score zero false commits on this synthetic set,
but it does not expose a speech act and the Mic 2 commitment gate does not exist
yet. The test is strict: when the gate lands and speech-act accuracy is 1.0 with
zero false commits, it will XPASS and force the marker to be removed.
"""

from __future__ import annotations

import pytest

from app.eval.current_system import load_live_decisions
from app.eval.gold_io import CSV_PATH, LIVE_DECISIONS_PATH, attach_splits, load_gold_rows
from app.eval.metrics import evaluate


@pytest.mark.xfail(
    strict=True,
    reason="Commitment gate (Milestone 2) is not implemented; speech_act_accuracy is N/A.",
)
def test_false_commit_rate_is_zero():
    rows = attach_splits(load_gold_rows(CSV_PATH))
    metrics = evaluate(rows, load_live_decisions(LIVE_DECISIONS_PATH))
    assert metrics["overall"]["false_commit_rate"] == 0.0
    assert metrics["overall"]["speech_act_accuracy"] == 1.0
