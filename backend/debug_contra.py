from app.parser import parse_text
from app.schemas import InstructionStatus
res = parse_text('Narrow alar base and widen alar base by 1 mm')
for r in res:
    print(r.status.value, r.value, r.target, r.parameter, r.reason)
