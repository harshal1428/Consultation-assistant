"""Voice pipeline configuration, read from environment with safe defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class VoiceConfig:
    sample_rate: int = 16000
    frame_ms: int = 32
    asr_backend: str = "faster-whisper"
    fw_model: str = "small.en"
    device: str = "auto"
    compute_type: str = "auto"
    language: str = "en"
    beam_size: int = 5
    vad_end_silence_ms: int = 700
    vad_pre_roll_ms: int = 300
    max_segment_s: float = 25.0
    vad_threshold: float = 0.5
    vad_onnx_path: str = ""
    dev_tools: bool = False
    hotwords: str = ""
    low_number_confidence: float = 0.62

    @classmethod
    def from_env(cls) -> "VoiceConfig":
        return cls(
            sample_rate=_int("VOICE_SAMPLE_RATE", 16000),
            frame_ms=_int("VOICE_FRAME_MS", 32),
            asr_backend=os.getenv("ASR_BACKEND", "faster-whisper").strip(),
            fw_model=os.getenv("ASR_FW_MODEL", "small.en").strip(),
            device=os.getenv("ASR_DEVICE", "auto").strip(),
            compute_type=os.getenv("ASR_COMPUTE_TYPE", "auto").strip(),
            language=os.getenv("ASR_LANGUAGE", "en").strip() or "en",
            beam_size=_int("ASR_BEAM_SIZE", 5),
            vad_end_silence_ms=_int("VAD_END_SILENCE_MS", 700),
            vad_pre_roll_ms=_int("VAD_PRE_ROLL_MS", 300),
            max_segment_s=_float("MAX_SEGMENT_S", 25.0),
            vad_threshold=_float("VAD_THRESHOLD", 0.5),
            vad_onnx_path=os.getenv("SILERO_VAD_ONNX", "").strip(),
            dev_tools=_bool("DEV_TOOLS", False),
            hotwords=os.getenv("ASR_HOTWORDS", "").strip(),
            low_number_confidence=_float("ASR_LOW_NUMBER_CONFIDENCE", 0.62),
        )

    @property
    def frame_samples(self) -> int:
        return max(1, int(round(self.sample_rate * self.frame_ms / 1000)))

    def resolved_device_and_compute(self) -> tuple[str, str]:
        """Resolve ``auto`` without assuming CUDA exists.

        ctranslate2 is imported only when available; its CUDA probe does not
        download anything. Without CUDA the deterministic CPU choice is int8.
        """
        device = self.device
        compute = self.compute_type
        if device == "auto":
            try:
                import ctranslate2  # type: ignore

                device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
            except Exception:
                device = "cpu"
        if compute == "auto":
            compute = "float16" if device == "cuda" else "int8"
        return device, compute
