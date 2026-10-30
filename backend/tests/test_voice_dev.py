"""Development recorder endpoints are guarded and gitignored."""

from __future__ import annotations

import base64
import csv
import io
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app


def wav_bytes(seconds: float = 0.2, sample_rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * int(sample_rate * seconds))
    return buffer.getvalue()


class DevEndpointTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"DEV_TOOLS": "1"}, clear=False)
        self.env.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.env.stop()

    def test_gold_utterances_requires_dev_tools(self):
        with mock.patch.dict(os.environ, {"DEV_TOOLS": "0"}, clear=False):
            response = self.client.get("/api/dev/gold-utterances")
        self.assertEqual(response.status_code, 404)

    def test_gold_utterances_returns_gold_and_split(self):
        response = self.client.get("/api/dev/gold-utterances")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 265)
        self.assertEqual(len(payload["rows"]), 265)
        self.assertIn("text", payload["rows"][0])

        response = self.client.get("/api/dev/gold-utterances?split=test")
        payload = response.json()
        self.assertEqual(payload["count"], 80)
        self.assertTrue(all(row["split"] == "test" for row in payload["rows"]))

    def test_save_clip_writes_gitignored_audio_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("app.voice.dev.AUDIO_DIR", Path(tmp)):
                payload = {
                    "key": "sess1:1",
                    "reference_text": "Raise the bridge by 2 mm",
                    "audio_base64": base64.b64encode(wav_bytes()).decode("ascii"),
                }
                response = self.client.post("/api/dev/save-clip", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                body = response.json()
                self.assertTrue(body["saved"])
                clip = Path(tmp) / body["file"]
                self.assertTrue(clip.exists())
                self.assertTrue(clip.read_bytes().startswith(b"RIFF"))
                manifest = Path(tmp) / "manifest.csv"
                rows = list(csv.DictReader(manifest.open(encoding="utf-8")))
                self.assertEqual(rows[0]["key"], "sess1:1")
                self.assertEqual(rows[0]["text"], "Raise the bridge by 2 mm")

    def test_save_clip_rejects_non_wav(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("app.voice.dev.AUDIO_DIR", Path(tmp)):
                response = self.client.post(
                    "/api/dev/save-clip",
                    json={
                        "key": "x",
                        "reference_text": "x",
                        "audio_base64": base64.b64encode(b"not a wav").decode("ascii"),
                    },
                )
                self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
