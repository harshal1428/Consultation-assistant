from pydantic import BaseModel
from typing import Optional

class CommandRequest(BaseModel):
    text: str

class ParsedCommand(BaseModel):
    target: Optional[str]
    parameter: Optional[str]
    operation: Optional[str]
    value: Optional[float]
    unit: Optional[str]
    direction: Optional[str]
    confidence: float
    requires_confirmation: bool
    original_text: str
