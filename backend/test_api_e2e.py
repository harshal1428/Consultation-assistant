import requests

commands = [
    "Reduce the bridge by 2 millimeters",
    "Lower the bridge by 3 mm",
    "Make the bridge narrower by 1 millimeter",
    "Increase tip projection by 2 mm",
    "Raise the nasal tip by 1 millimeter",
    "Rotate the tip upward by 5 degrees",
    "Make the dorsum lower by 2 mm",
    "Lift the tip slightly",
    "Make my nose better",
    "Reduce the bridge by 100 millimeters"
]

print("--- Testing API Endpoint (Fallback to Deterministic Parser) ---")
for text in commands:
    print(f"\\nCommand: '{text}'")
    try:
        response = requests.post("http://127.0.0.1:8000/api/parse-command", json={"text": text})
        if response.status_code == 200:
            data = response.json()
            print(f"[PASSED] Valid intent extracted.")
            print(f"  Target: {data.get('target')}")
            print(f"  Parameter: {data.get('parameter')}")
            print(f"  Operation: {data.get('operation')}")
            print(f"  Value: {data.get('value')}{data.get('unit', '')}")
            if data.get('value') == 20.0 and "100" in text:
                print("  [SECURE] EXTREME VALUE SUCCESSFULLY CONSTRAINED (100 -> 20)")
        elif response.status_code == 422:
            print(f"[REJECTED] (422) - {response.json().get('detail')}")
        else:
            print(f"[FAILED] HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"[ERROR] CONNECTION ERROR: {e}")
