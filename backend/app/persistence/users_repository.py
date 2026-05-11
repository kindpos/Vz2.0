"""
Users repository for accounts.db (OVERSEER_AUTH.md §2).

Hashes passwords with argon2id. Plaintext passwords are never persisted and
must never be logged — callers must avoid placing them in exception messages
or log records.

Role values are constrained by a CHECK at the DB level (see accounts_schema.sql).
The repository never returns `password_hash` in the `User` dataclass; that
column stays inside this module.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError


_PASSWORD_HASHER = PasswordHasher()


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


@dataclass(frozen=True)
class User:
    """Public projection of a users row. Never carries password_hash."""

    user_id: str
    email: str
    role: str
    must_change_password: bool
    created_at: str
    updated_at: str
    last_login_at: Optional[str]
    is_active: bool


def _row_to_user(row: sqlite3.Row) -> User:
    return User(
        user_id=row["user_id"],
        email=row["email"],
        role=row["role"],
        must_change_password=bool(row["must_change_password"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        last_login_at=row["last_login_at"],
        is_active=bool(row["is_active"]),
    )


class UsersRepository:
    """CRUD + password verification against the `users` table in accounts.db.

    Each method opens a short-lived sqlite3 connection. WAL mode (set by
    `init_accounts_db`) keeps reads non-blocking under concurrent writers.
    """

    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def create_user(
        self,
        email: str,
        password_plaintext: str,
        role: str,
        must_change_password: bool = False,
    ) -> str:
        """Insert a new user and return its `user_id`.

        Raises `sqlite3.IntegrityError` on duplicate email (case-insensitive
        via the UNIQUE COLLATE NOCASE constraint) or invalid role.
        """
        user_id = str(uuid.uuid4())
        password_hash = _PASSWORD_HASHER.hash(password_plaintext)
        now = _utcnow_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO users (
                    user_id, email, password_hash, role,
                    must_change_password, created_at, updated_at,
                    last_login_at, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)
                """,
                (
                    user_id,
                    email,
                    password_hash,
                    role,
                    1 if must_change_password else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
        return user_id

    def get_user_by_email(self, email: str) -> Optional[User]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ? COLLATE NOCASE",
                (email,),
            ).fetchone()
        return _row_to_user(row) if row else None

    def get_user_by_id(self, user_id: str) -> Optional[User]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        return _row_to_user(row) if row else None

    def verify_password(self, user_id: str, password_plaintext: str) -> bool:
        """Constant-time argon2id verification. Returns False on unknown user
        or mismatch — never raises for bad credentials."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT password_hash FROM users WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return False
        try:
            return _PASSWORD_HASHER.verify(row["password_hash"], password_plaintext)
        except (VerifyMismatchError, InvalidHashError):
            return False

    def update_password(self, user_id: str, new_password_plaintext: str) -> None:
        new_hash = _PASSWORD_HASHER.hash(new_password_plaintext)
        now = _utcnow_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE users
                   SET password_hash = ?, updated_at = ?
                 WHERE user_id = ?
                """,
                (new_hash, now, user_id),
            )
            conn.commit()

    def list_users(self, include_inactive: bool = False) -> list[User]:
        sql = "SELECT * FROM users"
        if not include_inactive:
            sql += " WHERE is_active = 1"
        sql += " ORDER BY created_at"
        with self._connect() as conn:
            rows = conn.execute(sql).fetchall()
        return [_row_to_user(r) for r in rows]

    def mark_login(self, user_id: str) -> None:
        now = _utcnow_iso()
        with self._connect() as conn:
            conn.execute(
                "UPDATE users SET last_login_at = ? WHERE user_id = ?",
                (now, user_id),
            )
            conn.commit()

    def set_active(self, user_id: str, is_active: bool) -> None:
        now = _utcnow_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE users
                   SET is_active = ?, updated_at = ?
                 WHERE user_id = ?
                """,
                (1 if is_active else 0, now, user_id),
            )
            conn.commit()
