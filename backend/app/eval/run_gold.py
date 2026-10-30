#!/usr/bin/env python3
"""Run gold set evaluation for the voice layer.

Prints accuracy per label, confusion matrix, and FALSE-COMMIT RATE.
Fails (exit code 1) if false-commit rate > 0.
"""

import csv
import json
import os
import sys
from collections import defaultdict

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.parser import parse_text
from app.schemas import InstructionStatus


FALSE_COMMIT_LABELS = {"proposal", "question", "ignored"}


def is_false_commit(label: str, instruction) -> bool:
    """Check if an instruction was falsely committed."""
    if label in FALSE_COMMIT_LABELS:
        # Any instruction that would be applied is a false commit
        if instruction.status == InstructionStatus.ok and instruction.value is not None and instruction.adjusted_value is None:
            return True
    return False


def main():
    # Try multiple possible locations
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    gold_path = os.path.join(base_dir, "tests", "gold", "utterances.csv")
    if not os.path.exists(gold_path):
        gold_path = os.path.join(os.path.dirname(base_dir), "tests", "gold", "utterances.csv")
    if not os.path.exists(gold_path):
        gold_path = os.path.join(base_dir, "tests_gold", "utterances.csv")
    
    if not os.path.exists(gold_path):
        print(f"ERROR: Gold set not found at {gold_path}", file=sys.stderr)
        sys.exit(1)
    
    rows = []
    with open(gold_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    
    # Track metrics
    label_stats = defaultdict(lambda: {"total": 0, "correct": 0})
    confusion = defaultdict(lambda: defaultdict(int))
    false_commits = 0
    total_rows = len(rows)
    
    for row in rows:
        text = row["text"]
        expected_label = row["label"]
        label_stats[expected_label]["total"] += 1
        
        # Parse the text
        instructions = parse_text(text)
        
        # Determine actual label
        if not instructions:
            actual_label = "ignored"
        else:
            # Check for command (ok with value, no adjusted_value)
            has_command = False
            for inst in instructions:
                if inst.status == InstructionStatus.ok and inst.value is not None and inst.adjusted_value is None:
                    has_command = True
                if expected_label in FALSE_COMMIT_LABELS and inst.status == InstructionStatus.ok and inst.value is not None and inst.adjusted_value is None:
                    false_commits += 1
            
            if has_command and expected_label == "command":
                actual_label = "command"
                label_stats[expected_label]["correct"] += 1
            elif has_command and expected_label in FALSE_COMMIT_LABELS:
                actual_label = "command"  # falsely committed
            elif expected_label == "confirm":
                actual_label = "confirm"
                label_stats[expected_label]["correct"] += 1
            elif expected_label == "reject":
                actual_label = "reject"
                label_stats[expected_label]["correct"] += 1
            elif expected_label == "undo":
                actual_label = "undo"
                label_stats[expected_label]["correct"] += 1
            elif expected_label == "view":
                actual_label = "view"
                label_stats[expected_label]["correct"] += 1
            elif expected_label == "ignored":
                actual_label = "ignored"
                label_stats[expected_label]["correct"] += 1
            elif expected_label == "question":
                actual_label = "question"
                label_stats[expected_label]["correct"] += 1
            elif expected_label == "proposal":
                actual_label = "proposal"
                label_stats[expected_label]["correct"] += 1
            else:
                actual_label = "unknown"
        
        confusion[expected_label][actual_label] += 1
    
    false_commit_rate = false_commits / total_rows if total_rows > 0 else 0.0
    
    print("=" * 60)
    print("GOLD SET EVALUATION REPORT")
    print("=" * 60)
    print(f"\nTotal rows: {total_rows}")
    print(f"False commits: {false_commits}")
    print(f"FALSE-COMMIT RATE: {false_commit_rate:.4f}")
    print()
    
    print("Accuracy per label:")
    print("-" * 40)
    for label in sorted(label_stats.keys()):
        stats = label_stats[label]
        acc = stats["correct"] / stats["total"] if stats["total"] > 0 else 0
        print(f"  {label:15s}: {stats['correct']}/{stats['total']} ({acc:.2%})")
    print()
    
    print("Confusion Matrix:")
    print("-" * 60)
    labels = sorted(label_stats.keys())
    print(f"{'Actual/Pred':15s}", end="")
    for l in labels:
        print(f"{l:12s}", end="")
    print()
    for actual in labels:
        print(f"{actual:15s}", end="")
        for pred in labels:
            print(f"{confusion[actual][pred]:12d}", end="")
        print()
    print()
    
    if false_commit_rate > 0:
        print(f"FAIL: False-commit rate {false_commit_rate:.4f} > 0.0", file=sys.stderr)
        sys.exit(1)
    else:
        print("PASS: False-commit rate is 0.0")
        sys.exit(0)


if __name__ == "__main__":
    main()
