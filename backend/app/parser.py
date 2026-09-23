import re
from typing import Optional, Tuple
from .schemas import ParsedCommand

def normalize_target(text: str) -> Optional[str]:
    if re.search(r'\b(bridge|nasal bridge)\b', text):
        return 'nasal_bridge'
    if re.search(r'\b(dorsum|nasal dorsum)\b', text):
        return 'nasal_dorsum'
    if re.search(r'\b(tip|nasal tip)\b', text):
        return 'nasal_tip'
    return None

def normalize_operation_parameter(text: str) -> Tuple[Optional[str], Optional[str]]:
    operation = None
    parameter = None
    
    # narrow/widen logic
    if re.search(r'\b(narrow|narrower)\b', text):
        return 'decrease', 'width'
    if re.search(r'\b(widen)\b', text):
        return 'increase', 'width'

    # operations
    if re.search(r'\b(reduce|lower|decrease)\b', text):
        operation = 'decrease'
    elif re.search(r'\b(increase|raise|lift)\b', text):
        operation = 'increase'
    elif re.search(r'\b(rotate|rotation)\b', text):
        operation = 'rotate'
    
    # parameters
    if re.search(r'\b(projection)\b', text):
        parameter = 'projection'
    elif re.search(r'\b(rotation|rotate)\b', text):
        parameter = 'rotation'
    elif re.search(r'\b(height)\b', text):
        parameter = 'height'
    elif re.search(r'\b(width)\b', text):
        parameter = 'width'

    # default parameter if implicit (e.g. "raise bridge")
    if not parameter and operation in ['increase', 'decrease']:
        parameter = 'height'

    return operation, parameter

def extract_value_unit(text: str) -> Tuple[Optional[float], Optional[str]]:
    match = re.search(r'(\d+(?:\.\d+)?)\s*(millimeters?|mm|degrees?|deg)', text)
    if match:
        val = float(match.group(1))
        unit_str = match.group(2)
        if 'mm' in unit_str or 'millimeter' in unit_str:
            unit = 'mm'
        else:
            unit = 'degrees'
        return val, unit
    return None, None

def extract_direction(text: str) -> Optional[str]:
    if re.search(r'\b(up|upward|upwards)\b', text):
        return 'up'
    if re.search(r'\b(down|downward|downwards)\b', text):
        return 'down'
    return None

def parse_clinical_command(text: str) -> ParsedCommand:
    text_lower = text.lower()
    
    target = normalize_target(text_lower)
    operation, parameter = normalize_operation_parameter(text_lower)
    value, unit = extract_value_unit(text_lower)
    direction = extract_direction(text_lower)
    
    # Confidence heuristics
    confidence = 0.95
    if not target or not operation or not parameter:
        confidence -= 0.35
    if value is None:
        confidence -= 0.35
        
    requires_confirmation = True
    
    # Handle unit defaulting
    if value is None and re.search(r'\b(slightly|a bit)\b', text_lower):
        if not unit:
            unit = 'mm' if parameter != 'rotation' else 'degrees'
    
    if value is not None and not unit:
        unit = 'mm' if parameter != 'rotation' else 'degrees'

    return ParsedCommand(
        target=target,
        parameter=parameter,
        operation=operation,
        value=value,
        unit=unit,
        direction=direction,
        confidence=round(max(0.0, confidence), 2),
        requires_confirmation=requires_confirmation,
        original_text=text
    )
