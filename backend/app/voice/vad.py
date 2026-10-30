"""Streaming VAD and utterance segmentation.

The preferred detector is Silero VAD through onnxruntime. No model weights are
bundled; set ``SILERO_VAD_ONNX`` to a locally downloaded ONNX model. If that file
is absent or fails to load, the deterministic energy detector is used and the
condition is reported in the logs. CI never downloads a model.
"""

from __future__ import annotations

import logging
import math
from collections import deque
from dataclasses import dataclass
from typing import Deque, List, Optional, Protocol

import numpy as np

from .config import VoiceConfig

logger = logging.getLogger(__name__)


class SpeechDetector(Protocol):
    name: str

    def probability(self, frame: np.ndarray) -> float:
        ...


class EnergySpeechDetector:
    """Fallback detector for machines without the Silero ONNX model."""

    name = "energy-fallback"

    def __init__(self, rms_floor: float = 0.012, rms_full: float = 0.08):
        self.rms_floor = rms_floor
        self.rms_full = max(rms_full, rms_floor + 1e-6)

    def probability(self, frame: np.ndarray) -> float:
        if frame.size == 0:
            return 0.0
        rms = float(np.sqrt(np.mean(np.square(frame, dtype=np.float64))))
        scaled = (rms - self.rms_floor) / (self.rms_full - self.rms_floor)
        return float(min(1.0, max(0.0, scaled)))


class SileroOnnxDetector:
    """Thin streaming wrapper around a user-provided Silero VAD ONNX file.

    Silero VAD is MIT-licensed. Different exported versions disagree about input
    names and state shapes, so this wrapper supports the common v4 (h/c) and v5
    (state) exports. It is intentionally optional and unverified without a local
    model file. A failure falls back to energy VAD rather than breaking voice.
    """

    name = "silero-onnx"

    def __init__(self, model_path: str, sample_rate: int = 16000):
        import onnxruntime as ort  # type: ignore

        self.sample_rate = sample_rate
        self.session = ort.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self.input_names = {item.name for item in self.session.get_inputs()}
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)
        self._fallback = EnergySpeechDetector()
        self._failed = False

    def _run_v5(self, frame: np.ndarray) -> float:
        inputs = {
            "input": frame.reshape(1, -1).astype(np.float32),
            "state": self._state,
            "sr": np.array(self.sample_rate, dtype=np.int64),
        }
        outputs = self.session.run(None, inputs)
        self._state = outputs[1]
        return float(np.asarray(outputs[0]).reshape(-1)[0])

    def _run_v4(self, frame: np.ndarray) -> float:
        inputs = {
            "input": frame.reshape(1, -1).astype(np.float32),
            "sr": np.array(self.sample_rate, dtype=np.int64),
            "h": self._h,
            "c": self._c,
        }
        outputs = self.session.run(None, inputs)
        self._h = outputs[1]
        self._c = outputs[2]
        return float(np.asarray(outputs[0]).reshape(-1)[0])

    def probability(self, frame: np.ndarray) -> float:
        if self._failed:
            return self._fallback.probability(frame)
        try:
            if {"state", "sr"}.issubset(self.input_names):
                return self._run_v5(frame)
            if {"h", "c", "sr"}.issubset(self.input_names):
                return self._run_v4(frame)
            # Unknown export: one input frame plus sample rate.
            outputs = self.session.run(
                None,
                {"input": frame.reshape(1, -1).astype(np.float32), "sr": np.array(self.sample_rate, dtype=np.int64)},
            )
            return float(np.asarray(outputs[0]).reshape(-1)[0])
        except Exception as exc:  # pragma: no cover - model-format dependent
            logger.warning("Silero ONNX inference failed; using energy VAD: %s", exc)
            self._failed = True
            return self._fallback.probability(frame)


def create_detector(config: VoiceConfig) -> SpeechDetector:
    if config.vad_onnx_path:
        try:
            detector = SileroOnnxDetector(config.vad_onnx_path, config.sample_rate)
            logger.info("Using Silero VAD ONNX model at %s", config.vad_onnx_path)
            return detector
        except Exception as exc:
            logger.warning(
                "Could not load Silero VAD ONNX model %r (%s); using energy VAD",
                config.vad_onnx_path,
                exc,
            )
    return EnergySpeechDetector()


@dataclass
class SpeechSegment:
    audio: np.ndarray
    sample_rate: int
    start_s: float
    end_s: float

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s


class VADSegmenter:
    def __init__(self, config: VoiceConfig, detector: Optional[SpeechDetector] = None):
        self.config = config
        self.sample_rate = config.sample_rate
        self.frame_samples = config.frame_samples
        self.frame_s = config.frame_ms / 1000.0
        self.detector = detector or create_detector(config)
        self.pre_roll_frames = max(1, int(math.ceil(config.vad_pre_roll_ms / config.frame_ms)))
        self.end_silence_frames = max(1, int(math.ceil(config.vad_end_silence_ms / config.frame_ms)))
        self.max_frames = max(1, int(config.max_segment_s / self.frame_s))
        self.min_frames = max(2, int(0.15 / self.frame_s))
        self._pre_roll: Deque[np.ndarray] = deque(maxlen=self.pre_roll_frames)
        self._pending = np.zeros(0, dtype=np.float32)
        self._in_speech = False
        self._segment_frames: List[np.ndarray] = []
        self._silence_frames = 0
        self._sample_index = 0
        self._segment_start_sample = 0

    def reset(self) -> None:
        self._pre_roll.clear()
        self._pending = np.zeros(0, dtype=np.float32)
        self._in_speech = False
        self._segment_frames = []
        self._silence_frames = 0
        self._segment_start_sample = 0

    def _start(self, first: np.ndarray, pre_roll: List[np.ndarray]) -> None:
        self._in_speech = True
        self._segment_frames = list(pre_roll) + [first]
        self._silence_frames = 0
        self._segment_start_sample = (
            self._sample_index - len(pre_roll) * self.frame_samples
        )
        self._pre_roll.clear()

    def _finish(self) -> Optional[SpeechSegment]:
        if not self._segment_frames:
            self._in_speech = False
            return None
        frames = self._segment_frames
        self._in_speech = False
        self._segment_frames = []
        self._silence_frames = 0
        self._pre_roll.clear()
        if len(frames) < self.min_frames:
            return None
        audio = np.concatenate(frames).astype(np.float32, copy=False)
        start_s = self._segment_start_sample / self.sample_rate
        end_s = start_s + len(audio) / self.sample_rate
        return SpeechSegment(audio=audio, sample_rate=self.sample_rate, start_s=start_s, end_s=end_s)

    def _push_frame(self, frame: np.ndarray) -> List[SpeechSegment]:
        events: List[SpeechSegment] = []
        probability = self.detector.probability(frame)
        is_speech = probability >= self.config.vad_threshold
        if not self._in_speech:
            if is_speech:
                pre_roll = list(self._pre_roll)
                self._start(frame, pre_roll)
            else:
                self._pre_roll.append(frame.copy())
        else:
            self._segment_frames.append(frame.copy())
            if is_speech:
                self._silence_frames = 0
            else:
                self._silence_frames += 1
            too_long = len(self._segment_frames) >= self.max_frames
            silence_done = self._silence_frames >= self.end_silence_frames
            if too_long or silence_done:
                segment = self._finish()
                if segment is not None:
                    events.append(segment)
                # Preserve the triggering frame as pre-roll for a following
                # command only when it was silence (not a forced split).
                if silence_done and not too_long:
                    self._pre_roll.append(frame.copy())
        self._sample_index += self.frame_samples
        return events

    def push_audio(self, audio: np.ndarray) -> List[SpeechSegment]:
        samples = np.asarray(audio, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            return []
        self._pending = np.concatenate([self._pending, samples]) if self._pending.size else samples
        events: List[SpeechSegment] = []
        while self._pending.size >= self.frame_samples:
            frame = self._pending[: self.frame_samples].copy()
            self._pending = self._pending[self.frame_samples :]
            events.extend(self._push_frame(frame))
        return events

    def flush(self) -> List[SpeechSegment]:
        events: List[SpeechSegment] = []
        if self._pending.size:
            padded = np.pad(self._pending, (0, self.frame_samples - self._pending.size))
            self._pending = np.zeros(0, dtype=np.float32)
            events.extend(self._push_frame(padded))
        if self._in_speech:
            segment = self._finish()
            if segment is not None:
                events.append(segment)
        return events
