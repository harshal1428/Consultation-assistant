"""Streaming VAD segmentation tests using the deterministic energy detector."""

from __future__ import annotations

import unittest

import numpy as np

from app.voice.config import VoiceConfig
from app.voice.vad import EnergySpeechDetector, VADSegmenter


SAMPLE_RATE = 16000


def tone(seconds: float, amplitude: float = 0.2) -> np.ndarray:
    samples = int(SAMPLE_RATE * seconds)
    t = np.arange(samples, dtype=np.float32) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 180 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * seconds), dtype=np.float32)


def config(**overrides) -> VoiceConfig:
    values = dict(
        sample_rate=SAMPLE_RATE,
        frame_ms=20,
        vad_end_silence_ms=200,
        vad_pre_roll_ms=100,
        max_segment_s=2.0,
    )
    values.update(overrides)
    return VoiceConfig(**values)


def segmenter(cfg: VoiceConfig | None = None) -> VADSegmenter:
    cfg = cfg or config()
    return VADSegmenter(cfg, EnergySpeechDetector(rms_floor=0.01, rms_full=0.05))


class EnergyDetectorTests(unittest.TestCase):
    def test_silence_has_zero_probability(self):
        detector = EnergySpeechDetector(rms_floor=0.01, rms_full=0.05)
        self.assertEqual(detector.probability(silence(0.02)), 0.0)

    def test_tone_has_high_probability(self):
        detector = EnergySpeechDetector(rms_floor=0.01, rms_full=0.05)
        self.assertGreater(detector.probability(tone(0.02)), 0.5)


class VADSegmenterTests(unittest.TestCase):
    def test_utterance_with_trailing_silence_is_emitted_once(self):
        vad = segmenter()
        events = []
        events.extend(vad.push_audio(silence(0.2)))
        events.extend(vad.push_audio(tone(0.2)))
        events.extend(vad.push_audio(silence(0.3)))
        self.assertEqual(len(events), 1)
        segment = events[0]
        self.assertGreaterEqual(segment.start_s, 0.08)
        self.assertLessEqual(segment.start_s, 0.12)
        self.assertGreaterEqual(segment.duration_s, 0.45)
        self.assertLessEqual(segment.duration_s, 0.55)

    def test_pre_roll_is_included(self):
        vad = segmenter(config(vad_pre_roll_ms=200))
        events = vad.push_audio(silence(0.4))
        events += vad.push_audio(tone(0.15))
        events += vad.push_audio(silence(0.25))
        self.assertEqual(len(events), 1)
        self.assertGreaterEqual(events[0].duration_s, 0.35)

    def test_flush_emits_short_utterance(self):
        vad = segmenter()
        events = vad.push_audio(tone(0.2))
        self.assertEqual(events, [])
        events = vad.flush()
        self.assertEqual(len(events), 1)
        self.assertGreaterEqual(events[0].duration_s, 0.18)

    def test_no_speech_emits_nothing(self):
        vad = segmenter()
        events = vad.push_audio(silence(1.0))
        events += vad.flush()
        self.assertEqual(events, [])

    def test_max_segment_splits_continuous_speech(self):
        vad = segmenter(config(max_segment_s=0.5, vad_end_silence_ms=500))
        events = vad.push_audio(tone(1.3, amplitude=0.3))
        events += vad.flush()
        self.assertGreaterEqual(len(events), 2)

    def test_arbitrary_chunk_sizes_are_buffered(self):
        vad = segmenter()
        audio = np.concatenate([tone(0.2), silence(0.3)])
        events = []
        for start in range(0, audio.size, 123):
            events.extend(vad.push_audio(audio[start : start + 123]))
        self.assertEqual(len(events), 1)
        self.assertIsInstance(events[0].audio, np.ndarray)

    def test_reset_discards_partial_speech(self):
        vad = segmenter()
        vad.push_audio(tone(0.2))
        vad.reset()
        self.assertEqual(vad.flush(), [])


if __name__ == "__main__":
    unittest.main()
