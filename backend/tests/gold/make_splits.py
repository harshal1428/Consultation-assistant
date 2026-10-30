#!/usr/bin/env python3
"""Create the deterministic, stratified dev/test split.

The source CSV is read-only. The output is ``splits.json`` keyed by
``conversation_id:turn_index``. Re-running without ``--force`` is refused so a
split cannot be silently reshuffled after results have been recorded.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.eval.gold_io import (  # noqa: E402
    CSV_PATH,
    SPLITS_PATH,
    canonical_label,
    file_sha256,
    load_gold_rows,
)

DEFAULT_SEED = 20261030
DEV_RATIO = 0.7
TEST_RATIO = 0.3


def build_split(seed: int = DEFAULT_SEED) -> Dict:
    rows = load_gold_rows(CSV_PATH)
    by_label: Dict[str, List[str]] = defaultdict(list)
    for row in rows:
        by_label[canonical_label(row.label)].append(row.key)

    rng = random.Random(seed)
    assignments: Dict[str, str] = {}
    for label in sorted(by_label):
        keys = sorted(by_label[label])
        rng.shuffle(keys)
        n = len(keys)
        test_count = int(round(n * TEST_RATIO))
        if n >= 2:
            test_count = max(1, min(n - 1, test_count))
        else:
            test_count = 0 if n == 1 else 0
        for index, key in enumerate(keys):
            assignments[key] = "test" if index < test_count else "dev"

    # A conversation-aware guard: if a conversation appears in both splits,
    # move all of its turns to the split of its first turn. This keeps
    # multi-turn context from leaking across dev/test.
    conversation_splits: Dict[str, str] = {}
    for row in rows:
        conversation_splits.setdefault(row.conversation_id, assignments[row.key])
    for row in rows:
        assignments[row.key] = conversation_splits[row.conversation_id]

    dev = sum(1 for value in assignments.values() if value == "dev")
    test = sum(1 for value in assignments.values() if value == "test")
    return {
        "seed": seed,
        "ratios": {"dev": DEV_RATIO, "test": TEST_RATIO},
        "strategy": "stratified by base label, conversation-aware, sorted keys",
        "source": CSV_PATH.name,
        "source_sha256": file_sha256(CSV_PATH),
        "rows": len(rows),
        "counts": {"dev": dev, "test": test},
        "assignments": dict(sorted(assignments.items())),
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="overwrite splits.json")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", type=Path, default=SPLITS_PATH)
    args = parser.parse_args(argv)

    if args.out.exists() and not args.force:
        print(
            f"Refusing to overwrite {args.out} without --force. "
            "Move or delete it explicitly if you intend to reshuffle.",
            file=sys.stderr,
        )
        return 2

    data = build_split(args.seed)
    args.out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.out} ({data['counts']['dev']} dev / {data['counts']['test']} test)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
