"""SQLite consultation archive contract tests (no network)."""

import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app import consultation_store
from app.main import app


def make_record(record_id: str = "session-test-1", saved_at: int = 1000) -> dict:
    return {
        "id": record_id,
        "label": "Consultation 10:30",
        "savedAt": saved_at,
        "startedAt": saved_at - 500,
        "endedAt": saved_at,
        "status": "ended",
        "changeCount": 2,
        "scenarioCount": 1,
        "modelState": {"tipHeight": 3, "bridgeHeight": 0},
        "summary": "# Summary",
        "personalization": None,
        "liveEvents": [],
        "transcript": [{"id": "t1", "text": "raise the tip", "status": "parsed"}],
        "proposals": [],
        "events": [{"id": "e1", "type": "session_ended"}],
        "scenarios": [{"id": "s1", "name": "Plan A"}],
    }


class ConsultationStoreTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db = Path(self.tempdir.name) / "test-consultations.db"
        self.previous = os.environ.get("VOICESURG_DB_PATH")
        os.environ["VOICESURG_DB_PATH"] = str(self.db)
        self.client = TestClient(app)

    def tearDown(self):
        if self.previous is None:
            os.environ.pop("VOICESURG_DB_PATH", None)
        else:
            os.environ["VOICESURG_DB_PATH"] = self.previous
        self.tempdir.cleanup()

    def test_starts_empty(self):
        response = self.client.get("/api/consultations")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_saves_lists_and_returns_full_record(self):
        response = self.client.post("/api/consultations", json=make_record())
        self.assertEqual(response.status_code, 201)
        saved = response.json()
        self.assertEqual(saved["id"], "session-test-1")
        self.assertEqual(saved["modelState"]["tipHeight"], 3)
        self.assertEqual(saved["transcript"][0]["text"], "raise the tip")
        self.assertTrue(saved["createdAt"])

        listed = self.client.get("/api/consultations").json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["scenarios"][0]["name"], "Plan A")

        fetched = self.client.get("/api/consultations/session-test-1")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["changeCount"], 2)

    def test_lists_newest_first(self):
        self.client.post("/api/consultations", json=make_record("old", 1000))
        self.client.post("/api/consultations", json=make_record("new", 3000))
        self.client.post("/api/consultations", json=make_record("mid", 2000))
        ids = [row["id"] for row in self.client.get("/api/consultations").json()]
        self.assertEqual(ids, ["new", "mid", "old"])

    def test_upserts_same_session_instead_of_duplicating(self):
        self.client.post("/api/consultations", json=make_record("same", 1000))
        updated = make_record("same", 5000)
        updated["changeCount"] = 9
        response = self.client.post("/api/consultations", json=updated)
        self.assertEqual(response.status_code, 201)

        listed = self.client.get("/api/consultations").json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["changeCount"], 9)
        self.assertEqual(listed[0]["savedAt"], 5000)

    def test_returns_404_for_unknown_consultation(self):
        response = self.client.get("/api/consultations/missing")
        self.assertEqual(response.status_code, 404)

    def test_deletes_one_and_clears_all(self):
        self.client.post("/api/consultations", json=make_record("a", 1000))
        self.client.post("/api/consultations", json=make_record("b", 2000))

        deleted = self.client.delete("/api/consultations/a")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(
            [row["id"] for row in self.client.get("/api/consultations").json()],
            ["b"],
        )

        cleared = self.client.delete("/api/consultations")
        self.assertEqual(cleared.status_code, 204)
        self.assertEqual(self.client.get("/api/consultations").json(), [])

    def test_store_writes_a_real_sqlite_file(self):
        consultation_store.save_consultation(make_record())
        self.assertTrue(self.db.exists())
        self.assertGreater(self.db.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
