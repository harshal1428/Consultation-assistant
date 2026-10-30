"""Hallucination guard tests: conservative, never confidence-only for real words."""

from __future__ import annotations

import unittest

from app.voice.asr.base import ASRWord
from app.voice.hallucination import guard_transcript


class HallucinationGuardTests(unittest.TestCase):
    def test_empty_is_discarded(self):
        self.assertTrue(guard_transcript("").discard)
        self.assertTrue(guard_transcript("   ").discard)

    def test_stock_hallucinations_are_discarded(self):
        for text in (
            "Thank you for watching",
            "thanks for watching!",
            "Please subscribe to my channel",
            "Subtitles by the Amara.org community",
            "...",
            "you",
            "bye.",
            "music",
        ):
            with self.subTest(text=text):
                result = guard_transcript(text, duration_s=1.0)
                self.assertTrue(result.discard)
                self.assertEqual(result.text, text)

    def test_high_no_speech_probability_is_discarded(self):
        result = guard_transcript("raise the bridge", duration_s=1.0, no_speech_prob=0.75)
        self.assertTrue(result.discard)
        self.assertIn("no-speech", result.reason or "")

    def test_very_low_logprob_is_discarded(self):
        result = guard_transcript("raise the bridge", duration_s=1.0, avg_logprob=-1.2)
        self.assertTrue(result.discard)

    def test_high_compression_is_discarded(self):
        result = guard_transcript("raise the bridge", duration_s=1.0, compression_ratio=2.6)
        self.assertTrue(result.discard)

    def test_too_short_audio_is_discarded(self):
        result = guard_transcript("raise the bridge", duration_s=0.1)
        self.assertTrue(result.discard)

    def test_implausible_characters_per_second_is_discarded(self):
        result = guard_transcript(
            "raise the bridge by two millimetres and lower the tip by one",
            duration_s=0.3,
        )
        self.assertTrue(result.discard)

    def test_repeated_loop_is_discarded(self):
        result = guard_transcript("no no no no no no", duration_s=2.0)
        self.assertTrue(result.discard)
        self.assertIn("repeated", result.reason or "")

    def test_legitimate_short_chatter_is_kept(self):
        for text in ("thank you", "go ahead", "yes do that", "never mind"):
            with self.subTest(text=text):
                result = guard_transcript(text, duration_s=1.0)
                self.assertFalse(result.discard, result.reason)

    def test_low_confidence_alone_does_not_discard_a_sentence(self):
        words = [ASRWord("raise", probability=0.2), ASRWord("bridge", probability=0.2)]
        result = guard_transcript(
            "raise bridge", words=words, duration_s=1.0, avg_logprob=-0.4
        )
        self.assertFalse(result.discard, result.reason)

    def test_low_confidence_two_word_hallucination_is_discarded(self):
        words = [ASRWord("mm", probability=0.05), ASRWord("hmm", probability=0.05)]
        result = guard_transcript(
            "mm hmm", words=words, duration_s=1.0, avg_logprob=-0.4
        )
        self.assertTrue(result.discard)
        self.assertIn("confidence", result.reason or "")

    def test_numbers_are_kept_even_when_short(self):
        result = guard_transcript("2", duration_s=1.0)
        self.assertFalse(result.discard)


if __name__ == "__main__":
    unittest.main()
