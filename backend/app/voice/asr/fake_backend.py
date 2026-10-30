"""Deterministic ASR backend used by tests and CI without model downloads."""

from __future__ import annotations

import os
import time
from typing import List, Optional

from .base import ASRResult, ASRWord


class FakeASRBackend:
    name = "fake"
    model = "fake"

    def __init__(self, text: Optional[str] = None, words: Optional[List[ASRWord]] = None):
        self._text = text if text is not None else os.getenv("FAKE_ASR_TEXT", "Raise the bridge by 2 mm")

    def transcribe(self, audio, sample_rate: int = 16000) -> ASRResult:
        started = time.perf_counter()
        words = [
            ASRWord(word=token, probability=0.95)
            for token in self._text.split()
        ]
        return ASRResult(
            text=self._text,
            words=words,
            backend=self.name,
            model=self.model,
            language="en",
            latency_ms=(time.perf_counter() - started) * 1000.0,
            duration_s=len(audio) / sample_rate if hasattr(audio, "__len__") else 0.0,
            avg_logprob=-0.2,
            no_speech_prob=0.01,
            compression_ratio=1.0,
        )
