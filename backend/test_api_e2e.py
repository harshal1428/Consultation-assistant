"""Ad-hoc end-to-end check against a running backend.

Start the server first:
    uvicorn app.main:app --reload --port 8000      (from the backend/ folder)

Then run:  python test_api_e2e.py
Automated assertions live in ``backend/tests/test_api.py``.
"""

import requests

CASES = [
    "Reduce the bridge by 2 millimeters",
    "Lower the bridge by 3 mm",
    "Make the bridge narrower by 1 millimeter",
    "Increase tip projection by 2 mm",
    "Raise the nasal tip by 1 millimeter",
    "Rotate the tip upward by 5 degrees",
    "Make the dorsum lower by 2 mm",
    "Lift the tip slightly",
    "Make my nose better",
    "Reduce the bridge by 100 millimeters",
    "Reduce the bridge by 2 mm and raise the tip by 1 mm",
    "Do not reduce the bridge",
]

print("--- API /api/parse-command ---")
for text in CASES:
    print(f"\nCommand: '{text}'")
    try:
        response = requests.post(
            "http://127.0.0.1:8000/api/parse-command", json={"text": text}
        )
        if response.status_code != 200:
            print(f"[{response.status_code}] {response.text}")
            continue
        data = response.json()
        for i, ins in enumerate(data.get("instructions", []), 1):
            print(
                f"  [{i}] status={ins['status']} target={ins['target']} "
                f"param={ins['parameter']} op={ins['operation']} "
                f"value={ins['value']}{ins.get('unit') or ''} "
                f"adjusted={ins['adjusted_value']} parser={ins['parser']}"
            )
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] {exc}")
