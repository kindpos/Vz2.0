"""
accounts.db — SQLite database for Overseer authentication and terminal binding.

Schema is defined in `accounts_schema.sql` per OVERSEER_AUTH.md §3.1.
This module provides initialization and connection helpers; CRUD lives in
sibling repository modules (see `users_repository.py`).

Connections are opened with WAL journaling and NORMAL synchronous mode for
local-only single-process use. Foreign keys are enabled.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional


_SCHEMA_PATH = Path(__file__).with_name("accounts_schema.sql")

# Path of the most recently initialized accounts DB. `get_accounts_db_connection`
# falls back to this when no explicit path is supplied.
_DB_PATH: Optional[Path] = None


def _read_schema() -> str:
    return _SCHEMA_PATH.read_text(encoding="utf-8")


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")


def init_accounts_db(path: str) -> Path:
    """Create the accounts DB file (if absent) and apply the schema.

    Idempotent: the schema uses `CREATE TABLE IF NOT EXISTS`, so calling this
    against an existing DB is a no-op for tables that already exist.

    Stores the path on the module so `get_accounts_db_connection()` can return
    a fresh connection without re-passing it.
    """
    global _DB_PATH
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        _apply_pragmas(conn)
        conn.executescript(_read_schema())
        conn.commit()
    finally:
        conn.close()

    _DB_PATH = db_path
    return db_path


def get_accounts_db_connection(path: Optional[str] = None) -> sqlite3.Connection:
    """Return a new sqlite3 connection to the accounts DB.

    If `path` is omitted, uses the path most recently passed to
    `init_accounts_db`. Raises if neither is set.

    The returned connection has `row_factory = sqlite3.Row` for dict-like
    access, plus WAL/NORMAL/foreign_keys pragmas applied.
    """
    target = Path(path) if path is not None else _DB_PATH
    if target is None:
        raise RuntimeError(
            "accounts DB path not configured; call init_accounts_db(path) first"
        )
    conn = sqlite3.connect(str(target))
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn)
    return conn
