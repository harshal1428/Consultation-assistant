import logging

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from . import consultation_store
from .parser_service import parse_command
from .schemas import CommandRequest, ConsultationRecord, ParseResponse
from .voice.dev import router as voice_dev_router
from .voice.ws import router as voice_router

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

app.include_router(voice_router)
app.include_router(voice_dev_router)


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


# ---------------------------------------------------------------------------
# Consultation archive (SQLite)
# ---------------------------------------------------------------------------


@app.get("/api/consultations", response_model=list[ConsultationRecord])
def list_consultations_endpoint() -> list[ConsultationRecord]:
    """Return every archived consultation, newest first."""
    return [ConsultationRecord(**record) for record in consultation_store.list_consultations()]


@app.get("/api/consultations/{consultation_id}", response_model=ConsultationRecord)
def get_consultation_endpoint(consultation_id: str) -> ConsultationRecord:
    record = consultation_store.get_consultation(consultation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Consultation not found")
    return ConsultationRecord(**record)


@app.post("/api/consultations", response_model=ConsultationRecord, status_code=201)
def save_consultation_endpoint(record: ConsultationRecord) -> ConsultationRecord:
    """Insert a new consultation or update one with the same id.

    Saving the same session twice (for example auto-save on end followed by an
    explicit archive) overwrites the record instead of creating a duplicate.
    """
    payload = record.model_dump(by_alias=True)
    stored = consultation_store.save_consultation(payload)
    return ConsultationRecord(**stored)


@app.delete("/api/consultations/{consultation_id}", status_code=204)
def delete_consultation_endpoint(consultation_id: str) -> Response:
    if not consultation_store.delete_consultation(consultation_id):
        raise HTTPException(status_code=404, detail="Consultation not found")
    return Response(status_code=204)


@app.delete("/api/consultations", status_code=204)
def clear_consultations_endpoint() -> Response:
    consultation_store.clear_consultations()
    return Response(status_code=204)
