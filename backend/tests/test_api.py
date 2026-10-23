"""HTTP contract tests for the FastAPI app (Gemini mocked away, no network)."""

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app import parser_service
from app.llm_parser import LlmError
from app.main import app


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        # Force the deterministic parser so tests never touch Gemini.
        patcher = mock.patch.object(
            parser_service, "parse_with_llm", side_effect=LlmError("offline")
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)

    def test_empty_text_is_rejected(self):
        response = self.client.post("/api/parse-command", json={"text": "   "})
        self.assertEqual(response.status_code, 400)

    def test_valid_command_returns_parse_response(self):
        response = self.client.post(
            "/api/parse-command", json={"text": "Reduce the bridge by 2 mm"}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("instructions", body)
        self.assertEqual(body["text"], "Reduce the bridge by 2 mm")
        first = body["instructions"][0]
        self.assertEqual(first["status"], "ok")
        self.assertEqual(first["target"], "nasal_bridge")

    def test_multi_command_response_has_multiple_instructions(self):
        response = self.client.post(
            "/api/parse-command",
            json={"text": "Reduce the bridge by 2 mm and raise the tip by 1 mm"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["instructions"]), 2)

    def test_invalid_text_returns_invalid_instruction_not_500(self):
        response = self.client.post(
            "/api/parse-command", json={"text": "Make my nose better"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["instructions"][0]["status"], "invalid")


if __name__ == "__main__":
    unittest.main()
