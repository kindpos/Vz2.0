"""
Provisioning key/value store backed by the `provisioning` table in
accounts.db (OVERSEER_AUTH.md §3.1, §3.2).

Holds image-personalized values like `customer_id`, `recovery_code_hash`,
`overseer_private_key`, and the `first_boot_pending` flag. All values are
plain strings — callers serialize/deserialize structured data themselves.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional


class ProvisioningRepository:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_value(self, key: str) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM provisioning WHERE key = ?", (key,)
            ).fetchone()
        return row["value"] if row else None

    def set_value(self, key: str, value: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO provisioning (key, value) VALUES (?, ?)",
                (key, value),
            )
            conn.commit()

    def delete(self, key: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM provisioning WHERE key = ?", (key,))
            conn.commit()
