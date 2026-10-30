"""WebSocket voice protocol tests using the fake ASR backend."""

from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app
from app.voice.asr import reset_asr_backend_cache
from app.voice.asr.base import ASRResult, ASRWord
from app.voice.config import VoiceConfig
from app.voice.ws import _low_confidence_numbers


def pcm16(samples: int, value: int = 0) -> bytes:
    return value.to_bytes(2, "little", signed=True) * samples


def receive_until(ws, wanted: str, limit: int = 12) -> dict:
    for _ in range(limit):
        message = ws.receive_json()
        if message.get("type") == wanted:
            return message
    raise AssertionError(f"never received {wanted!r}")


class VoiceWebSocketTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(
            os.environ,
            {
                "ASR_BACKEND": "fake",
                "FAKE_ASR_TEXT": "um raise the bridge by two point five millimeters",
                "VAD_END_SILENCE_MS": "200",
                "DEV_TOOLS": "0",
            },
            clear=False,
        )
        self.env.start()
        reset_asr_backend_cache()
        self.client = TestClient(app)

    def tearDown(self):
        reset_asr_backend_cache()
        self.env.stop()

    def test_ptt_returns_normalised_final(self):
        with self.client.websocket_connect("/ws/voice") as ws:
            self.assertEqual(ws.receive_json(), {"type": "state", "state": "idle"})
            ws.send_json({"type": "ptt_start"})
            self.assertEqual(
                receive_until(ws, "state"), {"type": "state", "state": "listening"}
            )
            ws.send_bytes(pcm16(16000 * 2))
            ws.send_json({"type": "ptt_end"})
            final = receive_until(ws, "utterance_final")
            self.assertEqual(final["text"], "raise the bridge by 2.5 mm")
            self.assertEqual(final["raw_text"], "um raise the bridge by two point five millimeters")
            self.assertEqual(final["numbers"][0]["value"], 2.5)
            self.assertEqual(final["numbers"][0]["unit"], "mm")
            self.assertEqual(final["corrections"], [])
            self.assertEqual(final["vad"], "energy-fallback")

    def test_ptt_applies_lexicon_correction(self):
        with mock.patch.dict(os.environ, {"FAKE_ASR_TEXT": "aller base by two millimeters"}):
            reset_asr_backend_cache()
            with self.client.websocket_connect("/ws/voice") as ws:
                ws.receive_json()
                ws.send_json({"type": "ptt_start"})
                ws.receive_json()
                ws.send_bytes(pcm16(16000 * 2))
                ws.send_json({"type": "ptt_end"})
                final = receive_until(ws, "utterance_final")
                self.assertEqual(final["text"], "alar base by 2 mm")
                self.assertEqual(final["corrections"][0]["from"], "aller base")

    def test_stock_hallucination_is_reported_not_committed(self):
        with mock.patch.dict(os.environ, {"FAKE_ASR_TEXT": "Thank you for watching"}):
            reset_asr_backend_cache()
            with self.client.websocket_connect("/ws/voice") as ws:
                ws.receive_json()
                ws.send_json({"type": "ptt_start"})
                ws.receive_json()
                ws.send_bytes(pcm16(16000 * 2))
                ws.send_json({"type": "ptt_end"})
                discarded = receive_until(ws, "utterance_discarded")
                self.assertEqual(discarded["raw_text"], "Thank you for watching")
                self.assertIn("hallucination", discarded["reason"])

    def test_mute_blocks_audio_and_ptt(self):
        with self.client.websocket_connect("/ws/voice") as ws:
            ws.receive_json()
            ws.send_json({"type": "mute"})
            self.assertEqual(
                receive_until(ws, "state"), {"type": "state", "state": "muted"}
            )
            ws.send_json({"type": "ptt_start"})
            self.assertEqual(
                receive_until(ws, "state"), {"type": "state", "state": "muted"}
            )
            ws.send_bytes(pcm16(16000 * 2))
            ws.send_json({"type": "ptt_end"})
            self.assertEqual(
                receive_until(ws, "state"), {"type": "state", "state": "muted"}
            )
            ws.send_json({"type": "unmute"})
            self.assertEqual(
                receive_until(ws, "state"), {"type": "state", "state": "idle"}
            )

    def test_open_mic_segments_on_vad_silence(self):
        with self.client.websocket_connect("/ws/voice") as ws:
            ws.receive_json()
            ws.send_json({"type": "open_mic"})
            self.assertEqual(
                receive_until(ws, "state"), {"type": "state", "state": "listening"}
            )
            # A loud 2 s tone followed by enough silence for the 200 ms VAD end.
            tone = (10000).to_bytes(2, "little", signed=True)
            ws.send_bytes(tone * (16000 * 2))
            ws.send_bytes(pcm16(int(16000 * 0.4)))
            final = receive_until(ws, "utterance_final")
            self.assertEqual(final["text"], "raise the bridge by 2.5 mm")
            ws.send_json({"type": "close_mic"})
            for _ in range(6):
                state = receive_until(ws, "state")
                if state["state"] == "idle":
                    break
            else:
                self.fail("never returned to idle after close_mic")
            self.assertEqual(state["state"], "idle")

    def test_bad_json_and_unknown_control_return_errors(self):
        with self.client.websocket_connect("/ws/voice") as ws:
            ws.receive_json()
            ws.send_text("{not json")
            error = receive_until(ws, "error")
            self.assertIn("JSON", error["message"])
            ws.send_json({"type": "dance"})
            error = receive_until(ws, "error")
            self.assertIn("Unknown control", error["message"])

    def test_ping(self):
        with self.client.websocket_connect("/ws/voice") as ws:
            ws.receive_json()
            ws.send_json({"type": "ping"})
            pong = receive_until(ws, "pong")
            self.assertIn("at", pong)

    def test_voice_health_endpoint(self):
        response = self.client.get("/api/voice/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["asr_backend"], "fake")
        self.assertIn("vad", payload)
        self.assertEqual(payload["sample_rate"], 16000)


class LowConfidenceNumberTests(unittest.TestCase):
    def test_flags_only_low_confidence_numbers(self):
        result = ASRResult(
            text="raise bridge by 2 mm",
            words=[
                ASRWord("raise", probability=0.9),
                ASRWord("bridge", probability=0.9),
                ASRWord("by", probability=0.9),
                ASRWord("2", probability=0.3),
                ASRWord("mm", probability=0.9),
            ],
        )
        findings = _low_confidence_numbers(result, threshold=0.62)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["token"], "2")

    def test_number_words_are_flagged(self):
        result = ASRResult(
            text="two mm",
            words=[ASRWord("two", probability=0.4), ASRWord("mm", probability=0.9)],
        )
        self.assertEqual(len(_low_confidence_numbers(result, 0.62)), 1)


class VoiceConfigTests(unittest.TestCase):
    def test_documented_defaults(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            config = VoiceConfig.from_env()
        self.assertEqual(config.asr_backend, "faster-whisper")
        self.assertEqual(config.fw_model, "small.en")
        self.assertEqual(config.device, "auto")
        self.assertEqual(config.compute_type, "auto")
        self.assertEqual(config.vad_end_silence_ms, 700)
        self.assertEqual(config.vad_pre_roll_ms, 300)
        self.assertEqual(config.max_segment_s, 25.0)
        self.assertFalse(config.dev_tools)
        self.assertEqual(config.frame_samples, 512)

    def test_fake_is_explicit(self):
        with mock.patch.dict(os.environ, {"ASR_BACKEND": "fake"}, clear=True):
            self.assertEqual(VoiceConfig.from_env().asr_backend, "fake")

    def test_auto_device_never_requires_cuda(self):
        device, compute = VoiceConfig(device="auto", compute_type="auto").resolved_device_and_compute()
        self.assertIn(device, {"cpu", "cuda"})
        self.assertIn(compute, {"int8", "float16"})


if __name__ == "__main__":
    unittest.main()
