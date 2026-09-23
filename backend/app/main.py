from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .schemas import CommandRequest, ParsedCommand
from .parser import parse_clinical_command
from .llm_parser import parse_clinical_command_llm
import logging
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

logger = logging.getLogger(__name__)

app = FastAPI(title="VoiceSurg 3D Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    return {"status": "ok"}

@app.post("/api/parse-command", response_model=ParsedCommand)
def parse_command(request: CommandRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Command text cannot be empty")
        
    try:
        parsed = parse_clinical_command_llm(request.text)
        # If the LLM successfully generated JSON but failed to extract intent, force a fallback
        if parsed.target is None or parsed.operation is None:
            raise ValueError("LLM returned null target or operation")
    except Exception as e:
        logger.warning(f"LLM parser failed or returned null intent: {e}. Falling back to deterministic parser.")
        parsed = parse_clinical_command(request.text)
    
    # Reject commands without enough context after BOTH parsers have tried
    if parsed.target is None or parsed.operation is None:
        raise HTTPException(status_code=422, detail="Could not extract a valid clinical intent from the command")
        
    # Constrain extreme values for safety
    if parsed.value is not None:
        if parsed.unit in ['degrees', 'deg'] and parsed.value > 45:
            parsed.value = 45.0
            parsed.confidence = 0.5  # lower confidence since it was clamped
        elif parsed.unit in ['mm', 'millimeter', 'millimeters'] and parsed.value > 20:
            parsed.value = 20.0
            parsed.confidence = 0.5
            
    return parsed
