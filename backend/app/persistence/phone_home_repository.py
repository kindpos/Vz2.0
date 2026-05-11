"""
Producer-side helpers for phone_home_queue.
OVERSEER_AUTH.md §3.1 (schema), §9 (triggers), PROVISIONING_FLOW.md §7.6 (retry policy).

The drain loop (background task that processes the queue) is implemented in V3.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def enqueue_phone_home(
    conn: sqlite3.Connection,
    *,
    endpoint: str,
    payload: dict,
    next_attempt: str | None = None,
) -> str:
    """
    Insert a new phone-home job into phone_home_queue with status='pending'.

    Returns the queue_id of the new row.

    endpoint  — full URL, e.g. 'https://kindpos.com/api/notify/activated'
    payload   — dict; serialised to JSON TEXT in the DB
    next_attempt — ISO 8601 timestamp; defaults to now (immediate first attempt)
    """
    queue_id = str(uuid.uuid4())
    now = _now_iso()
    conn.execute(
        """
        INSERT INTO phone_home_queue
            (queue_id, endpoint, payload, attempt_count, next_attempt, status, created_at)
        VALUES (?, ?, ?, 0, ?, 'pending', ?)
        """,
        (
            queue_id,
            endpoint,
            json.dumps(payload),
            next_attempt or now,
            now,
        ),
    )
    conn.commit()
    return queue_id


def get_pending_jobs(
    conn: sqlite3.Connection,
    *,
    as_of: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """
    Return up to `limit` pending jobs whose next_attempt <= as_of (default: now).
    Ordered by next_attempt ASC.
    """
    as_of = as_of or _now_iso()
    rows = conn.execute(
        """
        SELECT queue_id, endpoint, payload, attempt_count, next_attempt, created_at
          FROM phone_home_queue
         WHERE status = 'pending'
           AND next_attempt <= ?
         ORDER BY next_attempt ASC
         LIMIT ?
        """,
        (as_of, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def mark_sent(conn: sqlite3.Connection, queue_id: str) -> None:
    conn.execute(
        "UPDATE phone_home_queue SET status = 'sent' WHERE queue_id = ?",
        (queue_id,),
    )
    conn.commit()


def mark_failed_retrying(
    conn: sqlite3.Connection,
    queue_id: str,
    *,
    next_attempt: str,
    last_error: str,
) -> None:
    conn.execute(
        """
        UPDATE phone_home_queue
           SET status        = 'failed_retrying',
               attempt_count = attempt_count + 1,
               next_attempt  = ?,
               last_error    = ?
         WHERE queue_id = ?
        """,
        (next_attempt, last_error, queue_id),
    )
    conn.commit()


def mark_abandoned(conn: sqlite3.Connection, queue_id: str, *, last_error: str) -> None:
    conn.execute(
        """
        UPDATE phone_home_queue
           SET status     = 'abandoned',
               last_error = ?
         WHERE queue_id   = ?
        """,
        (last_error, queue_id),
    )
    conn.commit()
