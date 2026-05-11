"""Tests for provisioning_keys constants and phone_home_repository."""
import json
import sqlite3

import pytest

from app.persistence.provisioning_keys import (
    CUSTOMER_API_KEY,
    FIRST_BOOT_PENDING,
    KINDPOS_API_BASE,
    OVERSEER_PRIVATE_KEY,
    OVERSEER_PUBLIC_KEY,
    RECOVERY_CODE_HASH,
    STORE_REF,
)
from app.persistence.phone_home_repository import (
    enqueue_phone_home,
    get_pending_jobs,
    mark_abandoned,
    mark_failed_retrying,
    mark_sent,
)


@pytest.fixture
def mem_db():
    """In-memory SQLite with phone_home_queue schema."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE phone_home_queue (
            queue_id      TEXT PRIMARY KEY,
            endpoint      TEXT NOT NULL,
            payload       TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_attempt  TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','failed_retrying','abandoned')),
            created_at    TEXT NOT NULL,
            last_error    TEXT
        )
    """)
    conn.commit()
    return conn


# ── constants ──────────────────────────────────────────────────────────────

def test_key_constants_are_strings():
    for key in [FIRST_BOOT_PENDING, STORE_REF, CUSTOMER_API_KEY,
                KINDPOS_API_BASE, OVERSEER_PRIVATE_KEY, OVERSEER_PUBLIC_KEY,
                RECOVERY_CODE_HASH]:
        assert isinstance(key, str) and key


def test_key_constants_are_unique():
    keys = [FIRST_BOOT_PENDING, STORE_REF, CUSTOMER_API_KEY,
            KINDPOS_API_BASE, OVERSEER_PRIVATE_KEY, OVERSEER_PUBLIC_KEY,
            RECOVERY_CODE_HASH]
    assert len(keys) == len(set(keys))


# ── enqueue_phone_home ─────────────────────────────────────────────────────

def test_enqueue_inserts_pending_row(mem_db):
    qid = enqueue_phone_home(
        mem_db,
        endpoint="https://kindpos.com/api/notify/activated",
        payload={"store_ref": "STORE-1", "activated_at": "2026-05-11T14:00:00Z"},
    )
    row = mem_db.execute(
        "SELECT * FROM phone_home_queue WHERE queue_id = ?", (qid,)
    ).fetchone()
    assert row is not None
    assert row["status"] == "pending"
    assert row["attempt_count"] == 0
    assert json.loads(row["payload"])["store_ref"] == "STORE-1"


def test_enqueue_returns_unique_ids(mem_db):
    id1 = enqueue_phone_home(mem_db, endpoint="https://x.com/a", payload={})
    id2 = enqueue_phone_home(mem_db, endpoint="https://x.com/b", payload={})
    assert id1 != id2


# ── get_pending_jobs ───────────────────────────────────────────────────────

def test_get_pending_jobs_returns_due_rows(mem_db):
    enqueue_phone_home(
        mem_db,
        endpoint="https://kindpos.com/api/notify/activated",
        payload={},
        next_attempt="2026-01-01T00:00:00Z",  # past
    )
    jobs = get_pending_jobs(mem_db, as_of="2026-12-31T00:00:00Z")
    assert len(jobs) == 1


def test_get_pending_jobs_skips_future_rows(mem_db):
    enqueue_phone_home(
        mem_db,
        endpoint="https://kindpos.com/api/notify/activated",
        payload={},
        next_attempt="2099-01-01T00:00:00Z",  # far future
    )
    jobs = get_pending_jobs(mem_db, as_of="2026-05-11T00:00:00Z")
    assert jobs == []


# ── mark_sent / mark_failed_retrying / mark_abandoned ─────────────────────

def test_mark_sent(mem_db):
    qid = enqueue_phone_home(mem_db, endpoint="https://x.com", payload={})
    mark_sent(mem_db, qid)
    row = mem_db.execute(
        "SELECT status FROM phone_home_queue WHERE queue_id = ?", (qid,)
    ).fetchone()
    assert row["status"] == "sent"


def test_mark_failed_retrying(mem_db):
    qid = enqueue_phone_home(mem_db, endpoint="https://x.com", payload={})
    mark_failed_retrying(
        mem_db, qid,
        next_attempt="2026-05-12T00:00:00Z",
        last_error="connection timeout",
    )
    row = mem_db.execute(
        "SELECT status, attempt_count, last_error FROM phone_home_queue WHERE queue_id = ?",
        (qid,),
    ).fetchone()
    assert row["status"] == "failed_retrying"
    assert row["attempt_count"] == 1
    assert row["last_error"] == "connection timeout"


def test_mark_abandoned(mem_db):
    qid = enqueue_phone_home(mem_db, endpoint="https://x.com", payload={})
    mark_abandoned(mem_db, qid, last_error="max retries exceeded")
    row = mem_db.execute(
        "SELECT status FROM phone_home_queue WHERE queue_id = ?", (qid,)
    ).fetchone()
    assert row["status"] == "abandoned"
