from app.parser import parse_text
from app.schemas import InstructionStatus
for t in ['Do not reduce the bridge', "Don't touch the tip", 'Never narrow the alar base', 'Keep the bridge unchanged', 'Leave the tip as is']:
    res = parse_text(t)
    print(t, '->', [(r.status.value, r.value, r.reason) for r in res])
