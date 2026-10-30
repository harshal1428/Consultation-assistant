"""Offline ASR evaluation tooling tests; no network or models."""

from __future__ import annotations

import csv
import tempfile
import unittest
import wave
from pathlib import Path

from app.voice.asr.fake_backend import FakeASRBackend
from app.voice.asr_eval import (
    character_error_rate,
    evaluate_manifest,
    render_markdown,
    word_error_rate,
)


def write_wav(path: Path, seconds: float = 1.0, rate: int = 16000) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x00" * int(rate * seconds))


class ASREvalTests(unittest.TestCase):
    def test_error_rates(self):
        self.assertEqual(word_error_rate("raise the bridge", "raise the bridge"), 0.0)
        self.assertAlmostEqual(word_error_rate("raise the bridge", "raise bridge"), 1 / 3)
        self.assertEqual(character_error_rate("raise", "raise"), 0.0)
        self.assertGreater(character_error_rate("raise", "rase"), 0.0)
        self.assertEqual(word_error_rate("", ""), 0.0)
        self.assertEqual(word_error_rate("", "noise"), 1.0)

    def test_manifest_with_hypotheses_needs_no_audio_or_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.csv"
            with manifest.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=["key", "reference_text", "file", "hypothesis"],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "key": "a:1",
                        "reference_text": "raise the bridge by 2 mm",
                        "file": "",
                        "hypothesis": "raise the bridge by two mm",
                    }
                )
            report = evaluate_manifest(manifest)
            self.assertEqual(report["clips"], 1)
            self.assertEqual(report["normalized_wer"], 0.0)
            self.assertGreater(report["raw_wer"], 0.0)
            self.assertIn("Normalized WER", render_markdown(report))

    def test_manifest_transcribes_audio_with_fake_backend(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_wav(root / "clip.wav")
            manifest = root / "manifest.csv"
            with manifest.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle, fieldnames=["key", "reference_text", "file"]
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "key": "a:1",
                        "reference_text": "raise the bridge by 2 mm",
                        "file": "clip.wav",
                    }
                )
            backend = FakeASRBackend("raise the bridge by two mm")
            report = evaluate_manifest(manifest, backend=backend, base_dir=root)
            self.assertEqual(report["clips"], 1)
            self.assertEqual(report["normalized_wer"], 0.0)
            self.assertIsNotNone(report["per_clip"][0]["latency_ms"])
            self.assertAlmostEqual(report["per_clip"][0]["duration_s"], 1.0)

    def test_missing_manifest_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                evaluate_manifest(Path(tmp) / "missing.csv")


if __name__ == "__main__":
    unittest.main()
