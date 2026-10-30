from app.parser import parse_text
from app.schemas import InstructionStatus
import csv

gold_path = "tests/gold/utterances.csv"
rows = []
with open(gold_path, "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        rows.append(row)

false_commits = 0
for row in rows:
    text = row["text"]
    expected_label = row["label"]
    if expected_label not in {"proposal", "question", "ignored"}:
        continue
    instructions = parse_text(text)
    for inst in instructions:
        if inst.status == InstructionStatus.ok and inst.value is not None and inst.adjusted_value is None:
            false_commits += 1
            print(f"FALSE COMMIT: {expected_label} | {text} -> {inst.status} {inst.value} {inst.target} {inst.parameter}")
            break

print(f"\nTotal false commits: {false_commits}")
