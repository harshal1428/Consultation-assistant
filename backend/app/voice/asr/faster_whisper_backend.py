"""faster-whisper backend.

The model is loaded lazily on the first utterance. No weights are bundled or
downloaded at import/startup time; CI uses the fake backend instead.
"""

from __future__ import annotations

import logging
import time
from functools import cached_property
from typing import Any, Dict, List

from ..config import VoiceConfig
from ..correct import hotwords_from_lexicon
from .base import ASRResult, ASRWord

logger = logging.getLogger(__name__)


class FasterWhisperASRError(RuntimeError):
    pass


class FasterWhisperBackend:
    name = "faster-whisper"

    def __init__(self, config: VoiceConfig):
        self.config = config
        self.model = config.fw_model

    @cached_property
    def _model(self):
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as exc:  # pragma: no cover - depends on optional extra
            raise FasterWhisperASRError(
                "faster-whisper is not installed. Run: "
                "pip install -r requirements-voice.txt"
            ) from exc
        device, compute_type = self.config.resolved_device_and_compute()
        logger.info(
            "Loading faster-whisper model=%s device=%s compute_type=%s",
            self.model,
            device,
            compute_type,
        )
        try:
            return WhisperModel(self.model, device=device, compute_type=compute_type)
        except Exception as exc:  # pragma: no cover - model/runtime dependent
            raise FasterWhisperASRError(
                f"Could not load faster-whisper model {self.model!r} "
                f"on {device}/{compute_type}: {exc}"
            ) from exc

    def _base_kwargs(self) -> Dict[str, Any]:
        return {
            "language": self.config.language or None,
            "beam_size": self.config.beam_size,
            "word_timestamps": True,
            "condition_on_previous_text": False,
            "vad_filter": False,
            "no_speech_threshold": 0.6,
            "log_prob_threshold": -1.0,
            "compression_ratio_threshold": 2.4,
        }

    def _transcribe_with_hotwords(self, audio):
        kwargs = self._base_kwargs()
        hotwords = self.config.hotwords or hotwords_from_lexicon() or None
        if hotwords:
            try:
                return self._model.transcribe(audio, hotwords=hotwords, **kwargs)
            except TypeError:
                kwargs["initial_prompt"] = f"Nasal terms: {hotwords}"
        # Add a short prefix to bias toward surgical instructions
        try:
            kwargs.setdefault("initial_prompt", "VoiceSurg: raise, lower, increase, decrease, rotate, narrow, widen, project, retract by mm or degrees.")
        except Exception:
            pass
        return self._model.transcribe(audio, **kwargs)

    def transcribe(self, audio, sample_rate: int = 16000) -> ASRResult:
        started = time.perf_counter()
        segments, info = self._transcribe_with_hotwords(audio)

        pieces: List[str] = []
        words: List[ASRWord] = []
        logprobs: List[float] = []
        no_speech: List[float] = []
        compression: List[float] = []
        for segment in segments:
            text = (segment.text or "").strip()
            if text:
                pieces.append(text)
            logprobs.append(float(getattr(segment, "avg_logprob", 0.0) or 0.0))
            no_speech.append(float(getattr(segment, "no_speech_prob", 0.0) or 0.0))
            compression.append(float(getattr(segment, "compression_ratio", 0.0) or 0.0))
            for word in getattr(segment, "words", None) or []:
                words.append(
                    ASRWord(
                        word=(word.word or "").strip(),
                        start=float(word.start or 0.0),
                        end=float(word.end or 0.0),
                        probability=float(getattr(word, "probability", 1.0) or 0.0),
                    )
                )

        text = " ".join(pieces).strip()
        duration = float(getattr(info, "duration", 0.0) or (len(audio) / sample_rate))
        return ASRResult(
            text=text,
            words=words,
            backend=self.name,
            model=self.model,
            language=getattr(info, "language", None),
            latency_ms=(time.perf_counter() - started) * 1000.0,
            duration_s=duration,
            avg_logprob=(sum(logprobs) / len(logprobs)) if logprobs else None,
            no_speech_prob=max(no_speech) if no_speech else None,
            compression_ratio=max(compression) if compression else None,
        )
