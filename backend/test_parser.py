import sys
import os

# Add parent directory to path so we can import app module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.parser import parse_clinical_command

commands = [
    "Reduce the bridge by 2 millimeters",
    "Increase tip projection by 1 millimeter",
    "Raise the tip slightly",
    "Narrow the bridge by 1 mm",
    "Rotate the tip upward by 5 degrees",
    "Lower the dorsum by 3 millimeters",
    "Widen the bridge by 2mm",
    "Lift the tip by 1.5 mm",
    "Decrease bridge height by 2.5 millimeters",
    "Make the tip lower"
]

print("--- Testing Clinical Parser ---")
for text in commands:
    print(f"Input: '{text}'")
    parsed = parse_clinical_command(text)
    print(parsed.model_dump_json(indent=2))
    print("-" * 40)
