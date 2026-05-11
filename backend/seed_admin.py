#!/usr/bin/env python3
"""
Seed a `store_admin` row into accounts.db for development and provisioning.

Reads configuration from env vars so the same script works for the image
builder, a developer's local box, and CI test fixtures without touching
files. Idempotent: a second run with the same email is a no-op rather than
an error, which keeps `make seed` style workflows safe.

Env vars
--------
    BOOTSTRAP_ADMIN_EMAIL           required
    BOOTSTRAP_ADMIN_PASSWORD        required, min 12 chars (matches API policy)
    BOOTSTRAP_MUST_CHANGE_PASSWORD  optional; '1'|'true'|'yes' → True (default 0)
    KINDPOS_ACCOUNTS_DB_PATH        optional; default = backend/data/accounts.db
                                    (resolved against the script's location so
                                    cwd doesn't matter)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


_BACKEND_DIR = Path(__file__).resolve().parent
_DEFAULT_DB_PATH = _BACKEND_DIR / "data" / "accounts.db"

# Make `app.*` imports resolve regardless of cwd.
sys.path.insert(0, str(_BACKEND_DIR))

from app.persistence.accounts_db import init_accounts_db  # noqa: E402
from app.persistence.users_repository import UsersRepository  # noqa: E402


_TRUE_LITERALS = frozenset({"1", "true", "yes"})


def _parse_bool(s: str | None) -> bool:
    if s is None:
        return False
    return s.strip().lower() in _TRUE_LITERALS


def _fail(message: str) -> int:
    sys.stderr.write(f"seed_admin: {message}\n")
    return 1


def main() -> int:
    email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "").strip()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    must_change = _parse_bool(os.environ.get("BOOTSTRAP_MUST_CHANGE_PASSWORD"))
    db_path = os.environ.get("KINDPOS_ACCOUNTS_DB_PATH") or str(_DEFAULT_DB_PATH)

    if not email:
        return _fail("BOOTSTRAP_ADMIN_EMAIL is required")
    if not password:
        return _fail("BOOTSTRAP_ADMIN_PASSWORD is required")
    if len(password) < 12:
        return _fail("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters")

    init_accounts_db(db_path)
    repo = UsersRepository(db_path)

    if repo.get_user_by_email(email) is not None:
        print(f"User {email} already exists, skipping")
        return 0

    user_id = repo.create_user(
        email=email,
        password_plaintext=password,
        role="store_admin",
        must_change_password=must_change,
    )
    print(f"Seeded admin user {email} with id {user_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
