"""
Sessions repository for accounts.db (OVERSEER_AUTH.md §3.1, §5).

Wraps the `sessions` table. Sessions are 24-hour HttpOnly browser sessions
identified by an opaque UUID stored in a Secure cookie. A session is valid
iff it has not been revoked and `expires_at > now`.

`refresh_session` extends `expires_at` by another 24 hours on each
authenticated request, matching the "refreshed on activity" rule in §5.1.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional


SESSION_LIFETIME = timedelta(hours=24)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _parse_iso(s: str) -> datetime:
    # Stored timestamps always come from `_iso`, so the format is fixed.
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class Session:
    session_id: str
    user_id: str
    created_at: str
    expires_at: str
    ip: Optional[str]
    user_agent: Optional[str]
    revoked: bool


def _row_to_session(row: sqlite3.Row) -> Session:
    return Session(
        session_id=row["session_id"],
        user_id=row["user_id"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
        ip=row["ip"],
        user_agent=row["user_agent"],
        revoked=bool(row["revoked"]),
    )


class SessionsRepository:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def create_session(
        self,
        user_id: str,
        ip: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> tuple[str, str]:
        """Insert a fresh session row and return (session_id, expires_at_iso)."""
        session_id = str(uuid.uuid4())
        now = _utcnow()
        expires_at = now + SESSION_LIFETIME
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions
                    (session_id, user_id, created_at, expires_at, ip, user_agent, revoked)
                VALUES (?, ?, ?, ?, ?, ?, 0)
                """,
                (session_id, user_id, _iso(now), _iso(expires_at), ip, user_agent),
            )
            conn.commit()
        return session_id, _iso(expires_at)

    def get_session(self, session_id: str) -> Optional[Session]:
        """Return the session iff it exists, is not revoked, and has not
        expired. Otherwise None — callers treat None as 'reauthenticate'."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if row is None:
            return None
        sess = _row_to_session(row)
        if sess.revoked:
            return None
        if _parse_iso(sess.expires_at) <= _utcnow():
            return None
        return sess

    def refresh_session(self, session_id: str) -> Optional[str]:
        """Extend `expires_at` to now + SESSION_LIFETIME. Returns the new
        expires_at ISO string, or None if the session is gone."""
        new_expires = _iso(_utcnow() + SESSION_LIFETIME)
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE sessions SET expires_at = ? WHERE session_id = ? AND revoked = 0",
                (new_expires, session_id),
            )
            conn.commit()
            if cur.rowcount == 0:
                return None
        return new_expires

    def revoke_session(self, session_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE sessions SET revoked = 1 WHERE session_id = ?",
                (session_id,),
            )
            conn.commit()
