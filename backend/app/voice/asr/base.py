"""ASR backend protocol and shared result types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Protocol


@dataclass(frozen=True)
class ASRWord:
    word: str
    start: float = 0.0
    end: float = 0.0
    probability: float = 1.0


@dataclass
class ASRResult:
    text: str
    words: List[ASRWord] = field(default_factory=list)
    backend: str = "unknown"
    model: str = "unknown"
    language: str | None = None
    latency_ms: float = 0.0
    duration_s: float = 0.0
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    compression_ratio: float | None = None


class ASRBackend(Protocol):
    name: str
    model: str

    def transcribe(self, audio, sample_rate: int = 16000) -> ASRResult:
        ...
