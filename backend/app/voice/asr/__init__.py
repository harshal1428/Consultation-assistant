"""ASR backend selection.

The default and only real backend is faster-whisper. ``fake`` exists for tests,
CI, and offline smoke checks.
"""

from __future__ import annotations

from typing import Optional

from ..config import VoiceConfig
from .base import ASRBackend
from .fake_backend import FakeASRBackend
from .faster_whisper_backend import FasterWhisperBackend

_DEFAULT: Optional[ASRBackend] = None
_DEFAULT_KEY = None


def create_asr_backend(config: VoiceConfig) -> ASRBackend:
    name = (config.asr_backend or "faster-whisper").strip().lower()
    if name in {"fake", "test"}:
        return FakeASRBackend()
    if name in {"faster-whisper", "faster_whisper", "whisper"}:
        return FasterWhisperBackend(config)
    raise ValueError(
        f"Unknown ASR_BACKEND {config.asr_backend!r}; expected faster-whisper or fake"
    )


def get_default_asr_backend(config: VoiceConfig) -> ASRBackend:
    global _DEFAULT, _DEFAULT_KEY
    key = (config.asr_backend, config.fw_model, config.device, config.compute_type)
    if _DEFAULT is None or _DEFAULT_KEY != key:
        _DEFAULT = create_asr_backend(config)
        _DEFAULT_KEY = key
    return _DEFAULT


def reset_asr_backend_cache() -> None:
    global _DEFAULT, _DEFAULT_KEY
    _DEFAULT = None
    _DEFAULT_KEY = None
