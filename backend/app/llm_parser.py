import os
import json
import logging
from .schemas import ParsedCommand

logger = logging.getLogger(__name__)

def parse_clinical_command_llm(text: str) -> ParsedCommand:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set")
        
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ImportError("google-genai package is not installed")
        
    client = genai.Client(api_key=api_key)
    
    system_instruction = """
You are a clinical simulation command parser.
You do not provide medical advice.
You do not recommend procedures.
You only translate the provided surgeon instruction into the predefined simulation schema.
Never invent numerical values.
If a required measurement is missing, return value=null and requires_confirmation=true.

Supported targets:
nasal_bridge, nasal_dorsum, nasal_tip

Supported parameters:
height, width, projection, rotation

Supported operations:
increase, decrease, rotate, narrow, widen, raise, lower

Supported units:
mm, degrees

RULES:
1. Normalize all units (cm) strictly to millimeters (mm). Example: "0.2 cm" -> 2.0 mm.
2. Map anatomical synonyms to canonical targets. Example: "bridge" or "dorsum" -> "nasal_bridge", "tip" -> "nasal_tip".
3. For relative instructions like "slightly" or "a little", set value to null. Never guess precise numbers.

The command schema output must be strict JSON matching this structure:
{
  "target": string | null,
  "parameter": string | null,
  "operation": string | null,
  "value": number | null,
  "unit": string | null,
  "direction": string | null,
  "confidence": number,
  "requires_confirmation": boolean,
  "original_text": string
}
"""

    prompt = f"Parse the following surgeon command into structured JSON: '{text}'"

    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    
    if not response.text:
        raise ValueError("Empty response from LLM")
        
    text_content = response.text.strip()
    if text_content.startswith('```json'):
        text_content = text_content[7:]
    if text_content.startswith('```'):
        text_content = text_content[3:]
    if text_content.endswith('```'):
        text_content = text_content[:-3]
        
    parsed_json = json.loads(text_content.strip())
    parsed_json["original_text"] = text
    
    return ParsedCommand(**parsed_json)
