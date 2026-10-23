"""Ad-hoc smoke script for the deterministic rules parser.

Runs with NO API key and NO network: it exercises only ``app.parser.parse_text``.
For the automated assertions see ``backend/tests/`` (``python -m unittest``).
"""

import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.parser import parse_text  # noqa: E402

COMMANDS = [
    "Reduce the bridge by 2 millimeters",
    "Increase tip projection by 1 millimeter",
    "Raise the tip slightly",
    "Narrow the bridge by 1 mm",
    "Rotate the tip upward by 5 degrees",
    "Lower the dorsum by 3 millimeters",
    "Widen the bridge by 2mm",
    "Lift the tip by 1.5 mm",
    "Decrease bridge height by 2.5 millimeters",
    "Make the tip lower",
    "Reduce the bridge by 2 mm and raise the tip by 1 mm",
    "Do not reduce the bridge",
    "Reduce the chin by 2 mm",
    "Increase tip projection by 100 mm",
]

print("--- Rules parser smoke test (offline, no API key) ---")
for text in COMMANDS:
    print(f"\nInput: '{text}'")
    for instruction in parse_text(text):
        print(instruction.model_dump_json(indent=2))
    print("-" * 40)
