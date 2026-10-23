import logging

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .parser_service import parse_command
from .schemas import CommandRequest, ParseResponse

import os

load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))

logger = logging.getLogger(__name__)

app = FastAPI(title="VoiceSurg 3D Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check_root():
    return {"status": "ok"}


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.post("/api/parse-command", response_model=ParseResponse)
def parse_command_endpoint(request: CommandRequest) -> ParseResponse:
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Command text cannot be empty")

    result = parse_command(text, request.context)

    if not result.instructions:
        raise HTTPException(
            status_code=422,
            detail="Could not extract any instruction from the command",
        )

    return result
