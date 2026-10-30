"""WebSocket voice endpoint and streaming orchestration."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .asr import get_default_asr_backend
from .asr.base import ASRResult
from .config import VoiceConfig
from .correct import correct_text
from .hallucination import guard_transcript
from .normalize import NUMBER_WORDS, extract_numbers, normalize_voice_text
from .vad import SpeechSegment, VADSegmenter, create_detector

logger = logging.getLogger(__name__)
router = APIRouter()


async def _send(ws: WebSocket, payload: dict) -> None:
    await ws.send_json(payload)


async def _state(ws: WebSocket, state: str, detail: Optional[str] = None) -> None:
    payload = {"type": "state", "state": state}
    if detail:
        payload["detail"] = detail
    await _send(ws, payload)


def _pcm16_to_float(data: bytes) -> np.ndarray:
    if len(data) % 2:
        raise ValueError("PCM16 payload must contain an even number of bytes")
    pcm = np.frombuffer(data, dtype="<i2")
    return (pcm.astype(np.float32) / 32768.0).copy()


def _low_confidence_numbers(result: ASRResult, threshold: float) -> List[dict]:
    findings = []
    for word in result.words:
        token = (word.word or "").strip().lower().strip(".,;:!?")
        if not token:
            continue
        numeric = any(char.isdigit() for char in token) or token in NUMBER_WORDS
        if numeric and word.probability < threshold:
            findings.append(
                {
                    "token": word.word.strip(),
                    "probability": round(word.probability, 4),
                    "start": round(word.start, 3),
                    "end": round(word.end, 3),
                }
            )
    return findings


def _serialise_result(result: ASRResult) -> dict:
    return {
        "text": result.text,
        "backend": result.backend,
        "model": result.model,
        "language": result.language,
        "latency_ms": round(result.latency_ms, 2),
        "duration_s": round(result.duration_s, 3),
        "avg_logprob": None if result.avg_logprob is None else round(result.avg_logprob, 4),
        "no_speech_prob": None if result.no_speech_prob is None else round(result.no_speech_prob, 4),
    }


class VoiceSession:
    def __init__(self, ws: WebSocket, config: Optional[VoiceConfig] = None):
        self.ws = ws
        self.config = config or VoiceConfig.from_env()
        self.backend = get_default_asr_backend(self.config)
        self.detector = create_detector(self.config)
        self.segmenter = VADSegmenter(self.config, self.detector)
        self.muted = False
        self.ptt = False
        self.open_mic = False
        self.manual_buffer: List[np.ndarray] = []
        self._closed = False

    def _rest_state(self) -> str:
        if self.muted:
            return "muted"
        if self.ptt or self.open_mic:
            return "listening"
        return "idle"

    async def _safe_send(self, payload: dict) -> None:
        if self._closed:
            return
        try:
            await _send(self.ws, payload)
        except Exception:
            self._closed = True

    async def _process_segment(self, segment: SpeechSegment) -> None:
        started = time.perf_counter()
        await self._safe_send({"type": "state", "state": "processing"})
        try:
            result = await asyncio.to_thread(
                self.backend.transcribe, segment.audio, segment.sample_rate
            )
            guard = guard_transcript(
                text=result.text,
                words=result.words,
                duration_s=result.duration_s or segment.duration_s,
                no_speech_prob=result.no_speech_prob,
                avg_logprob=result.avg_logprob,
                compression_ratio=result.compression_ratio,
            )
            if guard.discard:
                await self._safe_send(
                    {
                        "type": "utterance_discarded",
                        "raw_text": result.text,
                        "reason": guard.reason,
                        "duration_s": round(segment.duration_s, 3),
                        "asr": _serialise_result(result),
                    }
                )
                return

            normalized = normalize_voice_text(result.text)
            corrected = correct_text(normalized.text)
            clean = corrected.text.strip()
            if not clean:
                await self._safe_send(
                    {
                        "type": "utterance_discarded",
                        "raw_text": result.text,
                        "reason": "empty after normalisation",
                        "duration_s": round(segment.duration_s, 3),
                    }
                )
                return

            payload = {
                "type": "utterance_final",
                "raw_text": result.text,
                "text": clean,
                "normalized_text": normalized.text,
                "corrections": corrected.as_dicts(),
                "numbers": extract_numbers(clean),
                "low_confidence_numbers": _low_confidence_numbers(
                    result, self.config.low_number_confidence
                ),
                "duration_s": round(segment.duration_s, 3),
                "latency_ms": round(result.latency_ms, 2),
                "total_latency_ms": round((time.perf_counter() - started) * 1000.0, 2),
                "asr": _serialise_result(result),
                "vad": self.detector.name,
                "start_s": round(segment.start_s, 3),
                "end_s": round(segment.end_s, 3),
            }
            await self._safe_send(payload)
        except Exception as exc:
            logger.exception("Voice transcription failed")
            await self._safe_send(
                {
                    "type": "error",
                    "message": f"Transcription failed: {exc}",
                }
            )
        finally:
            await _state(self.ws, self._rest_state())

    async def _flush_segments(self, use_manual_fallback: bool = False) -> int:
        segments = self.segmenter.flush()
        if not segments and use_manual_fallback and self.manual_buffer:
            audio = np.concatenate(self.manual_buffer).astype(np.float32, copy=False)
            if audio.size >= int(0.15 * self.config.sample_rate):
                segments = [
                    SpeechSegment(
                        audio=audio,
                        sample_rate=self.config.sample_rate,
                        start_s=0.0,
                        end_s=audio.size / self.config.sample_rate,
                    )
                ]
        self.manual_buffer.clear()
        for segment in segments:
            await self._process_segment(segment)
        return len(segments)

    async def handle_audio(self, data: bytes) -> None:
        if self.muted or not (self.ptt or self.open_mic):
            return
        try:
            audio = _pcm16_to_float(data)
        except ValueError as exc:
            await self._safe_send({"type": "error", "message": str(exc)})
            return
        if self.ptt:
            self.manual_buffer.append(audio.copy())
        for segment in self.segmenter.push_audio(audio):
            await self._process_segment(segment)

    async def handle_control(self, message: dict) -> None:
        kind = (message.get("type") or "").strip().lower()
        if kind == "ping":
            await self._safe_send({"type": "pong", "at": int(time.time() * 1000)})
            return
        if kind == "ptt_start":
            if self.muted:
                await _state(self.ws, "muted")
                return
            self.ptt = True
            self.manual_buffer.clear()
            self.segmenter.reset()
            await _state(self.ws, "listening")
            return
        if kind == "ptt_end":
            self.ptt = False
            processed = await self._flush_segments(use_manual_fallback=True)
            if not processed:
                await _state(self.ws, self._rest_state())
            return
        if kind == "mute":
            self.muted = True
            self.ptt = False
            self.open_mic = False
            self.manual_buffer.clear()
            self.segmenter.reset()
            await _state(self.ws, "muted")
            return
        if kind == "unmute":
            self.muted = False
            await _state(self.ws, self._rest_state())
            return
        if kind == "open_mic":
            if self.muted:
                await _state(self.ws, "muted")
                return
            self.open_mic = True
            self.ptt = False
            self.segmenter.reset()
            await _state(self.ws, "listening")
            return
        if kind == "close_mic":
            self.open_mic = False
            processed = await self._flush_segments(use_manual_fallback=False)
            if not processed:
                await _state(self.ws, self._rest_state())
            return
        await self._safe_send(
            {"type": "error", "message": f"Unknown control message: {kind or '<empty>'}"}
        )


@router.websocket("/ws/voice")
async def voice_websocket(ws: WebSocket) -> None:
    await ws.accept()
    session = VoiceSession(ws)
    await _state(ws, "idle")
    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                await session.handle_audio(message["bytes"])
                continue
            raw = message.get("text")
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await _send(ws, {"type": "error", "message": "Control message must be JSON"})
                continue
            if not isinstance(payload, dict):
                await _send(ws, {"type": "error", "message": "Control message must be an object"})
                continue
            await session.handle_control(payload)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover - transport dependent
        logger.exception("Voice WebSocket failed")
        try:
            await _send(ws, {"type": "error", "message": f"Voice connection failed: {exc}"})
        except Exception:
            pass
    finally:
        session._closed = True


@router.get("/api/voice/health")
def voice_health() -> dict:
    config = VoiceConfig.from_env()
    detector = create_detector(config)
    return {
        "status": "ok",
        "asr_backend": config.asr_backend,
        "model": config.fw_model,
        "device": config.device,
        "compute_type": config.compute_type,
        "vad": detector.name,
        "sample_rate": config.sample_rate,
    }
