"""SQLite persistence for archived consultations.

The database is a single local file (by default
``backend/app/data/voicesurg.db``). It only ever contains structured
consultation data produced by this application; uploaded photographs are never
stored here. Set ``VOICESURG_DB_PATH`` to point at a different file (the test
suite uses this to work on a temporary database).

The storage layer deliberately has no FastAPI dependency so it can be exercised
directly in unit tests.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "voicesurg.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS consultations (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    saved_at        INTEGER NOT NULL,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER,
    status          TEXT NOT NULL,
    patient_id      TEXT NOT NULL DEFAULT '',
    patient_name    TEXT NOT NULL DEFAULT '',
    surgeon_name    TEXT NOT NULL DEFAULT '',
    change_count    INTEGER NOT NULL DEFAULT 0,
    scenario_count  INTEGER NOT NULL DEFAULT 0,
    model_state     TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    personalization TEXT,
    live_events     TEXT,
    transcript      TEXT,
    proposals       TEXT,
    events          TEXT,
    scenarios       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consultations_saved_at
    ON consultations (saved_at DESC);
"""


def db_path() -> Path:
    """Return the active database path (environment override wins)."""
    override = os.getenv("VOICESURG_DB_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return DEFAULT_DB_PATH


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    # WAL keeps reads responsive while a request is writing; both pragmas are
    # process-local and harmless when the database was just created.
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _ensure_columns(conn: sqlite3.Connection) -> None:
    """Add columns introduced after a database file was first created.

    There is no ORM/migration framework, so this small additive migration keeps
    an existing local archive readable when the record shape grows.
    """
    existing = {row[1] for row in conn.execute("PRAGMA table_info(consultations)")}
    additions = {
        "ended_at": "INTEGER",
        "patient_id": "TEXT NOT NULL DEFAULT ''",
        "patient_name": "TEXT NOT NULL DEFAULT ''",
        "surgeon_name": "TEXT NOT NULL DEFAULT ''",
        "personalization": "TEXT",
        "live_events": "TEXT",
        "transcript": "TEXT",
        "proposals": "TEXT",
        "events": "TEXT",
        "scenarios": "TEXT",
        "created_at": "TEXT",
        "updated_at": "TEXT",
    }
    for name, ddl in additions.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE consultations ADD COLUMN {name} {ddl}")


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        conn.executescript(SCHEMA)
        _ensure_columns(conn)
        # Created after the additive migration so an old database file can gain
        # the patient columns before the index that references them exists.
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_consultations_patient "
            "ON consultations (patient_id, saved_at DESC)"
        )
        yield conn
        conn.commit()
    finally:
        conn.close()


def _json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _row_to_record(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a SQLite row into the camelCase frontend contract."""
    return {
        "id": row["id"],
        "label": row["label"],
        "savedAt": row["saved_at"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "status": row["status"],
        "patientId": row["patient_id"],
        "patientName": row["patient_name"],
        "surgeonName": row["surgeon_name"],
        "changeCount": row["change_count"],
        "scenarioCount": row["scenario_count"],
        "modelState": _json_loads(row["model_state"]) or {},
        "summary": row["summary"],
        "personalization": _json_loads(row["personalization"]),
        "liveEvents": _json_loads(row["live_events"]),
        "transcript": _json_loads(row["transcript"]),
        "proposals": _json_loads(row["proposals"]),
        "events": _json_loads(row["events"]),
        "scenarios": _json_loads(row["scenarios"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def save_consultation(record: dict[str, Any]) -> dict[str, Any]:
    """Insert or update one consultation and return the stored record."""
    now = _now()
    payload = (
        record["id"],
        record["label"],
        int(record["savedAt"]),
        int(record["startedAt"]),
        record.get("endedAt"),
        record.get("status") or "active",
        record.get("patientId") or "",
        record.get("patientName") or "",
        record.get("surgeonName") or "",
        int(record.get("changeCount") or 0),
        int(record.get("scenarioCount") or 0),
        _json_dumps(record.get("modelState") or {}) or "{}",
        record.get("summary") or "",
        _json_dumps(record.get("personalization")),
        _json_dumps(record.get("liveEvents")),
        _json_dumps(record.get("transcript")),
        _json_dumps(record.get("proposals")),
        _json_dumps(record.get("events")),
        _json_dumps(record.get("scenarios")),
        now,
        now,
    )

    with connection() as conn:
        conn.execute(
            """
            INSERT INTO consultations (
                id, label, saved_at, started_at, ended_at, status,
                patient_id, patient_name, surgeon_name,
                change_count, scenario_count, model_state, summary,
                personalization, live_events, transcript, proposals, events,
                scenarios, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                label           = excluded.label,
                saved_at        = excluded.saved_at,
                started_at      = excluded.started_at,
                ended_at        = excluded.ended_at,
                status          = excluded.status,
                patient_id      = excluded.patient_id,
                patient_name    = excluded.patient_name,
                surgeon_name    = excluded.surgeon_name,
                change_count    = excluded.change_count,
                scenario_count  = excluded.scenario_count,
                model_state     = excluded.model_state,
                summary         = excluded.summary,
                personalization = excluded.personalization,
                live_events     = excluded.live_events,
                transcript      = excluded.transcript,
                proposals       = excluded.proposals,
                events          = excluded.events,
                scenarios       = excluded.scenarios,
                updated_at      = excluded.updated_at
            """,
            payload,
        )
    stored = get_consultation(record["id"])
    if stored is None:  # pragma: no cover - only possible on a storage failure
        raise RuntimeError("Consultation could not be stored")
    return stored


def list_consultations() -> list[dict[str, Any]]:
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM consultations ORDER BY saved_at DESC, updated_at DESC"
        ).fetchall()
    return [_row_to_record(row) for row in rows]


def get_consultation(consultation_id: str) -> dict[str, Any] | None:
    with connection() as conn:
        row = conn.execute(
            "SELECT * FROM consultations WHERE id = ?", (consultation_id,)
        ).fetchone()
    return _row_to_record(row) if row else None


def delete_consultation(consultation_id: str) -> bool:
    with connection() as conn:
        cursor = conn.execute(
            "DELETE FROM consultations WHERE id = ?", (consultation_id,)
        )
    return cursor.rowcount > 0


def clear_consultations() -> int:
    with connection() as conn:
        cursor = conn.execute("DELETE FROM consultations")
    return cursor.rowcount
