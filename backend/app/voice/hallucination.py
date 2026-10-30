"""Hallucination and non-speech guards.

These are deliberately conservative: low confidence alone does not discard an
utterance. Only clearly empty, non-speech, or stock hallucination output is
dropped, and the raw text is returned to the client so it is never silently
lost.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Optional

from .asr.base import ASRWord

STOCK_PHRASES = {
    "thank you for watching",
    "thanks for watching",
    "thank you for watching!",
    "thanks for watching!",
    "please subscribe",
    "please subscribe to my channel",
    "subscribe to my channel",
    "subtitles by",
    "subtitles by the amara.org community",
    "transcribed by",
    "amara.org",
    "www.amara.org",
    "you",
    "bye",
    "bye.",
    "...",
    "…",
    "music",
    "[music]",
    "♪",
}


@dataclass
class GuardResult:
    discard: bool
    reason: Optional[str] = None
    text: str = ""


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def guard_transcript(
    text: str,
    words: Iterable[ASRWord] = (),
    duration_s: float = 0.0,
    no_speech_prob: Optional[float] = None,
    avg_logprob: Optional[float] = None,
    compression_ratio: Optional[float] = None,
) -> GuardResult:
    cleaned = (text or "").strip()
    if not cleaned:
        return GuardResult(True, "empty transcript", cleaned)

    if no_speech_prob is not None and no_speech_prob >= 0.60:
        return GuardResult(True, f"no-speech probability {no_speech_prob:.2f}", cleaned)
    if avg_logprob is not None and avg_logprob <= -1.0:
        return GuardResult(True, f"average log probability {avg_logprob:.2f}", cleaned)
    if compression_ratio is not None and compression_ratio >= 2.4:
        return GuardResult(True, f"compression ratio {compression_ratio:.2f}", cleaned)

    normalised = _normalise(cleaned)
    if normalised in STOCK_PHRASES:
        return GuardResult(True, "stock ASR hallucination phrase", cleaned)
    if len(normalised) <= 2 and not any(char.isdigit() for char in normalised):
        return GuardResult(True, "too short to be an instruction", cleaned)

    if duration_s > 0:
        if duration_s < 0.25:
            return GuardResult(True, "audio segment too short", cleaned)
        if len(normalised) / duration_s > 35.0:
            return GuardResult(True, "implausibly many characters per second", cleaned)

    tokens: List[str] = re.findall(r"[a-z0-9']+", normalised)
    if len(tokens) >= 6:
        unique_ratio = len(set(tokens)) / len(tokens)
        if unique_ratio < 0.35:
            return GuardResult(True, "repeated-token loop", cleaned)

    # A lone stock filler at very low confidence is usually non-speech text from
    # the model; numbers and real words are kept for the parser to judge.
    if words:
        probabilities = [word.probability for word in words if word.word.strip()]
        if probabilities and max(probabilities) < 0.15 and len(tokens) <= 2:
            return GuardResult(True, "very low word confidence", cleaned)

    return GuardResult(False, None, cleaned)
