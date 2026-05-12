"""
One-shot migration: rewrite the server_license table to the new shape
(id, license_key, hardware_fingerprint, activated_at, status).

Old rows are not ported — the legacy schema (activation_code PK,
server_mac, platform, store_id, label, created_at, activated_at,
node_number) carries no license_key/hardware_fingerprint columns that
map cleanly to the new shape. The table is repopulated on the next
successful POST /api/v1/licenses/activate.

Usage:
    python -m app.migrations.migrate_server_license [DB_PATH]
"""

from __future__ import annotations

import argparse
import sqlite3
import sys


NEW_COLUMNS = ("id", "license_key", "hardware_fingerprint", "activated_at", "status")

NEW_TABLE_DDL = """
    CREATE TABLE server_license_new (
        id                   INTEGER PRIMARY KEY,
        license_key          TEXT NOT NULL,
        hardware_fingerprint TEXT NOT NULL,
        activated_at         TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'active'
    )
"""


def _default_db_path() -> str:
    try:
        from app.config import settings  # type: ignore[import-not-found]
        path = getattr(settings, "hardware_db_path", None)
        if path:
            return str(path)
    except Exception:
        pass
    return "/data/hardware_config.db"


def _current_columns(conn: sqlite3.Connection) -> tuple[str, ...]:
    cur = conn.execute("PRAGMA table_info(server_license)")
    return tuple(row[1] for row in cur.fetchall())


def migrate(db_path: str) -> int:
    conn = sqlite3.connect(db_path)
    conn.isolation_level = None  # manual transaction control
    try:
        cols = _current_columns(conn)
        if not cols or tuple(cols) == NEW_COLUMNS:
            print("Schema already current. No migration needed.")
            return 0

        conn.execute("BEGIN")
        conn.execute(NEW_TABLE_DDL)
        conn.execute("DROP TABLE server_license")
        conn.execute("ALTER TABLE server_license_new RENAME TO server_license")
        conn.execute("COMMIT")
        print("Migration complete.")
        return 0
    except Exception as e:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        print(f"Migration failed: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Rewrite the server_license table to the new shape "
            "(id, license_key, hardware_fingerprint, activated_at, status). "
            "Old rows are discarded."
        ),
    )
    parser.add_argument(
        "db_path",
        nargs="?",
        default=_default_db_path(),
        help="Path to hardware_config.db (default: from app.config.settings.hardware_db_path or /data/hardware_config.db)",
    )
    args = parser.parse_args()
    return migrate(args.db_path)


if __name__ == "__main__":
    sys.exit(main())
