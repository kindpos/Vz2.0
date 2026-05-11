"""
Tests for the phone_home_drain service.
PROVISIONING_FLOW.md §7.6 — backoff schedule + status transitions.
"""
import sqlite3
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.persistence.phone_home_repository import enqueue_phone_home
from app.persistence.provisioning_keys import CUSTOMER_API_KEY
from app.persistence.provisioning_repository import ProvisioningRepository
from app.services.phone_home_drain import (
    ABANDON_AFTER_DAYS,
    BACKOFF_SECONDS,
    _add_seconds,
    _drain_once,
    _is_abandoned,
    _next_backoff,
    _now_iso,
)


# ── fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture
def mem_db(tmp_path):
    """Temp SQLite file with just the phone_home_queue + provisioning tables."""
    db_path = str(tmp_path / "test_accounts.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS phone_home_queue (
            queue_id      TEXT PRIMARY KEY,
            endpoint      TEXT NOT NULL,
            payload       TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_attempt  TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','failed_retrying','abandoned')),
            created_at    TEXT NOT NULL,
            last_error    TEXT
        );
        CREATE TABLE IF NOT EXISTS provisioning (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)
    conn.commit()
    conn.close()
    return db_path


def seed_api_key(db_path: str, key: str = "test-api-key") -> None:
    # ProvisioningRepository takes a path — it manages its own connection.
    ProvisioningRepository(db_path).set_value(CUSTOMER_API_KEY, key)


def seed_job(db_path: str, **kwargs) -> str:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        qid = enqueue_phone_home(
            conn,
            endpoint=kwargs.get("endpoint", "https://kindpos.com/api/notify/activated"),
            payload=kwargs.get("payload", {"store_ref": "STORE-1"}),
            next_attempt=kwargs.get("next_attempt", None),
        )
        if "created_at" in kwargs:
            conn.execute(
                "UPDATE phone_home_queue SET created_at = ? WHERE queue_id = ?",
                (kwargs["created_at"], qid),
            )
            conn.commit()
    finally:
        conn.close()
    return qid


def get_status(db_path: str, queue_id: str) -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT status, attempt_count, last_error FROM phone_home_queue "
            "WHERE queue_id = ?",
            (queue_id,),
        ).fetchone()
    finally:
        conn.close()
    return dict(row)


# ── unit tests ─────────────────────────────────────────────────────────────

def test_backoff_schedule_length():
    assert len(BACKOFF_SECONDS) == 6


def test_next_backoff_returns_correct_delays():
    assert _next_backoff(0) == 60
    assert _next_backoff(1) == 300
    assert _next_backoff(5) == 86400
    assert _next_backoff(99) == 86400  # capped at daily


def test_is_abandoned_false_for_recent():
    recent = _now_iso()
    assert _is_abandoned(recent) is False


def test_is_abandoned_true_after_threshold():
    old = (
        datetime.now(timezone.utc) - timedelta(days=ABANDON_AFTER_DAYS + 1)
    ).isoformat()
    assert _is_abandoned(old) is True


def test_add_seconds():
    base = "2026-05-11T00:00:00+00:00"
    result = _add_seconds(base, 3600)
    assert "01:00:00" in result


# ── drain integration tests ────────────────────────────────────────────────

def test_drain_marks_sent_on_204(mem_db):
    seed_api_key(mem_db)
    qid = seed_job(mem_db)
    with patch("app.services.phone_home_drain._post_sync", return_value=204):
        _drain_once(mem_db)
    assert get_status(mem_db, qid)["status"] == "sent"


def test_drain_marks_sent_on_409_idempotent(mem_db):
    seed_api_key(mem_db)
    qid = seed_job(mem_db)
    with patch("app.services.phone_home_drain._post_sync", return_value=409):
        _drain_once(mem_db)
    assert get_status(mem_db, qid)["status"] == "sent"


def test_drain_retries_on_500(mem_db):
    seed_api_key(mem_db)
    qid = seed_job(mem_db)
    with patch("app.services.phone_home_drain._post_sync", return_value=500):
        _drain_once(mem_db)
    row = get_status(mem_db, qid)
    assert row["status"] == "failed_retrying"
    assert row["attempt_count"] == 1


def test_drain_abandons_on_401(mem_db):
    seed_api_key(mem_db)
    qid = seed_job(mem_db)
    with patch("app.services.phone_home_drain._post_sync", return_value=401):
        _drain_once(mem_db)
    assert get_status(mem_db, qid)["status"] == "abandoned"


def test_drain_abandons_old_job(mem_db):
    seed_api_key(mem_db)
    old_created = (
        datetime.now(timezone.utc) - timedelta(days=ABANDON_AFTER_DAYS + 1)
    ).isoformat()
    qid = seed_job(mem_db, created_at=old_created)
    with patch("app.services.phone_home_drain._post_sync", return_value=204):
        _drain_once(mem_db)
    assert get_status(mem_db, qid)["status"] == "abandoned"


def test_drain_skips_when_no_api_key(mem_db):
    """If customer_api_key is not provisioned, drain should do nothing."""
    qid = seed_job(mem_db)
    _drain_once(mem_db)  # no mock needed — should short-circuit
    assert get_status(mem_db, qid)["status"] == "pending"


def test_drain_skips_future_jobs(mem_db):
    seed_api_key(mem_db)
    future = _add_seconds(_now_iso(), 9999)
    qid = seed_job(mem_db, next_attempt=future)
    with patch("app.services.phone_home_drain._post_sync", return_value=204):
        _drain_once(mem_db)
    assert get_status(mem_db, qid)["status"] == "pending"


def test_drain_retries_on_network_error(mem_db):
    import urllib.error
    seed_api_key(mem_db)
    qid = seed_job(mem_db)
    with patch(
        "app.services.phone_home_drain._post_sync",
        side_effect=urllib.error.URLError("connection refused"),
    ):
        _drain_once(mem_db)
    row = get_status(mem_db, qid)
    assert row["status"] == "failed_retrying"
    assert "connection refused" in row["last_error"]
