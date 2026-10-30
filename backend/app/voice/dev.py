"""Development-only endpoints for recording local ASR evaluation clips.

Every endpoint is guarded by ``DEV_TOOLS=1``. Audio is written under the
gitignored ``backend/tests/audio_local`` directory; no audio is committed.
"""

from __future__ import annotations

import base64
import csv
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..eval.gold_io import CSV_PATH, attach_splits, load_gold_rows
from .config import VoiceConfig

router = APIRouter()
AUDIO_DIR = Path(__file__).resolve().parents[2] / "tests" / "audio_local"


def _dev_enabled() -> bool:
    return VoiceConfig.from_env().dev_tools


def _require_dev() -> None:
    if not _dev_enabled():
        raise HTTPException(status_code=404, detail="Not found")


class ClipRequest(BaseModel):
    key: str
    reference_text: str
    audio_base64: str
    sample_rate: int = 16000
    source: str = "gold"


@router.get("/api/dev/gold-utterances")
def gold_utterances(split: str | None = None) -> dict:
    _require_dev()
    rows = attach_splits(load_gold_rows(CSV_PATH))
    payload = [
        {
            "key": row.key,
            "text": row.text,
            "label": row.label,
            "category": row.category,
            "split": row.split,
        }
        for row in rows
    ]
    if split:
        payload = [row for row in payload if row["split"] == split]
    return {"rows": payload, "count": len(payload)}


@router.post("/api/dev/save-clip")
def save_clip(request: ClipRequest) -> dict:
    _require_dev()
    encoded = request.audio_base64.strip()
    if "," in encoded and encoded.lower().startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        audio = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 audio: {exc}") from exc
    if len(audio) < 44 or not audio.startswith(b"RIFF"):
        raise HTTPException(status_code=400, detail="Expected a WAV file")

    clips = AUDIO_DIR / "clips"
    clips.mkdir(parents=True, exist_ok=True)
    safe_key = re.sub(r"[^A-Za-z0-9_.-]+", "_", request.key) or "clip"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    filename = f"{safe_key}-{stamp}.wav"
    path = clips / filename
    path.write_bytes(audio)

    manifest = AUDIO_DIR / "manifest.csv"
    new_file = not manifest.exists()
    with manifest.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "key",
                "text",
                "file",
                "created_at",
                "sample_rate",
                "source",
            ],
        )
        if new_file:
            writer.writeheader()
        writer.writerow(
            {
                "key": request.key,
                "text": request.reference_text,
                "file": str(path.relative_to(AUDIO_DIR)),
                "created_at": stamp,
                "sample_rate": request.sample_rate,
                "source": request.source,
            }
        )
    return {
        "saved": True,
        "file": str(path.relative_to(AUDIO_DIR)),
        "bytes": len(audio),
    }
