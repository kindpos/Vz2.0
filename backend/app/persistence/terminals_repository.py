"""
Read helpers for the `terminal_bindings` and `revocations` tables
(OVERSEER_AUTH.md §3.1, §7.3).

Functions accept an open sqlite3.Connection so callers can share a single
transaction across multiple reads (e.g. the revocations endpoint reads the
bound slot to validate the token, then the revocations list, in one pass).
"""

from __future__ import annotations

import sqlite3
from typing import Optional


def get_slot_by_token_payload(
    conn: sqlite3.Connection, slot_id: str
) -> Optional[dict]:
    """Return the `terminal_bindings` row for `slot_id` as a dict, or None
    if the slot is unknown. Used to cross-check a verified token payload
    against the stored fingerprint / is_active flag."""
    row = conn.execute(
        """
        SELECT slot_id, terminal_name, hardware_fingerprint, bound_at,
               bound_by_user_id, token, token_expires_at, is_active, is_hub
          FROM terminal_bindings
         WHERE slot_id = ?
        """,
        (slot_id,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def get_store_revocations(conn: sqlite3.Connection) -> list[dict]:
    """Return every row in `revocations` as `{"slot_id": ..., "revoked_at": ...}`
    dicts, ordered by `revoked_at` for stable client-side diffing."""
    rows = conn.execute(
        """
        SELECT slot_id, revoked_at
          FROM revocations
         ORDER BY revoked_at, slot_id
        """,
    ).fetchall()
    return [{"slot_id": r["slot_id"], "revoked_at": r["revoked_at"]} for r in rows]
