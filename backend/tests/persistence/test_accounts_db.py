"""
Tests for accounts.db schema and the UsersRepository.

Covers acceptance criteria from Prompt 1 of the auth rebuild: schema creates
cleanly, password verification round-trips, list/filter behavior, case-
insensitive email uniqueness, role CHECK enforcement, argon2 salting.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from app.persistence.accounts_db import (
    init_accounts_db,
    get_accounts_db_connection,
)
from app.persistence.users_repository import UsersRepository, User


EXPECTED_TABLES = {
    "users",
    "sessions",
    "terminal_bindings",
    "revocations",
    "provisioning",
    "phone_home_queue",
}


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    """Fresh accounts.db per test, initialized with the full schema."""
    path = tmp_path / "accounts.db"
    init_accounts_db(str(path))
    return path


@pytest.fixture
def repo(db_path: Path) -> UsersRepository:
    return UsersRepository(db_path)


def _list_tables(path: Path) -> set[str]:
    conn = sqlite3.connect(str(path))
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    finally:
        conn.close()
    return {r[0] for r in rows}


# ─── schema ──────────────────────────────────────────────────────────────


def test_init_creates_all_six_tables(db_path: Path):
    assert _list_tables(db_path) == EXPECTED_TABLES


def test_init_is_idempotent(tmp_path: Path):
    path = tmp_path / "accounts.db"
    init_accounts_db(str(path))
    init_accounts_db(str(path))  # second call must not raise
    assert _list_tables(path) == EXPECTED_TABLES


def test_get_connection_returns_row_factory(db_path: Path):
    conn = get_accounts_db_connection(str(db_path))
    try:
        assert conn.row_factory is sqlite3.Row
    finally:
        conn.close()


def test_get_connection_without_init_raises(monkeypatch):
    # Force the module-level path back to None to simulate "never initialized"
    import app.persistence.accounts_db as accounts_db_mod

    monkeypatch.setattr(accounts_db_mod, "_DB_PATH", None)
    with pytest.raises(RuntimeError):
        get_accounts_db_connection()


# ─── create / get ────────────────────────────────────────────────────────


def test_create_user_returns_id_and_persists(repo: UsersRepository):
    user_id = repo.create_user(
        "owner@example.com", "correct horse battery staple", "store_admin"
    )
    assert user_id

    user = repo.get_user_by_id(user_id)
    assert isinstance(user, User)
    assert user.email == "owner@example.com"
    assert user.role == "store_admin"
    assert user.is_active is True
    assert user.must_change_password is False
    assert user.last_login_at is None


def test_user_dataclass_does_not_expose_password_hash(repo: UsersRepository):
    user_id = repo.create_user("a@b.com", "passwordpassword", "manager")
    user = repo.get_user_by_id(user_id)
    assert not hasattr(user, "password_hash")


def test_get_user_by_email_case_insensitive(repo: UsersRepository):
    repo.create_user("Mixed.Case@Example.com", "passwordpassword", "manager")
    via_lower = repo.get_user_by_email("mixed.case@example.com")
    via_upper = repo.get_user_by_email("MIXED.CASE@EXAMPLE.COM")
    assert via_lower is not None
    assert via_upper is not None
    assert via_lower.user_id == via_upper.user_id


def test_create_user_rejects_duplicate_email_case_insensitive(
    repo: UsersRepository,
):
    repo.create_user("dup@example.com", "passwordpassword", "manager")
    with pytest.raises(sqlite3.IntegrityError):
        repo.create_user("DUP@example.com", "otherpassword", "server")


def test_role_check_constraint_rejects_invalid_role(repo: UsersRepository):
    with pytest.raises(sqlite3.IntegrityError):
        repo.create_user("bad@example.com", "passwordpassword", "wizard")


# ─── password verification ───────────────────────────────────────────────


def test_verify_password_true_for_correct(repo: UsersRepository):
    user_id = repo.create_user("v@example.com", "supersecret123", "store_admin")
    assert repo.verify_password(user_id, "supersecret123") is True


def test_verify_password_false_for_wrong(repo: UsersRepository):
    user_id = repo.create_user("v@example.com", "supersecret123", "store_admin")
    assert repo.verify_password(user_id, "wrong") is False


def test_verify_password_false_for_unknown_user(repo: UsersRepository):
    assert repo.verify_password("nonexistent-id", "anything") is False


def test_update_password_invalidates_old_hash(repo: UsersRepository):
    user_id = repo.create_user("u@example.com", "oldpassword!!", "manager")
    repo.update_password(user_id, "newpassword!!")
    assert repo.verify_password(user_id, "oldpassword!!") is False
    assert repo.verify_password(user_id, "newpassword!!") is True


def test_update_password_bumps_updated_at(repo: UsersRepository):
    user_id = repo.create_user("u@example.com", "oldpassword!!", "manager")
    before = repo.get_user_by_id(user_id).updated_at
    # argon2 hashing dominates wall time on slow boxes; this still proves
    # the column moved forward.
    time.sleep(0.005)
    repo.update_password(user_id, "newpassword!!")
    after = repo.get_user_by_id(user_id).updated_at
    assert after > before


def test_argon2_salts_each_call(repo: UsersRepository):
    """Two users with the same plaintext must have distinct stored hashes."""
    repo.create_user("a@example.com", "samepassword", "manager")
    repo.create_user("b@example.com", "samepassword", "manager")
    conn = sqlite3.connect(str(repo.db_path))
    try:
        hashes = [
            row[0]
            for row in conn.execute(
                "SELECT password_hash FROM users ORDER BY email"
            ).fetchall()
        ]
    finally:
        conn.close()
    assert len(hashes) == 2
    assert hashes[0] != hashes[1]


# ─── list / activation ───────────────────────────────────────────────────


def test_list_users_excludes_inactive_by_default(repo: UsersRepository):
    active_id = repo.create_user("active@example.com", "passwordpassword", "manager")
    inactive_id = repo.create_user(
        "inactive@example.com", "passwordpassword", "manager"
    )
    repo.set_active(inactive_id, False)

    listed = repo.list_users()
    listed_ids = {u.user_id for u in listed}
    assert active_id in listed_ids
    assert inactive_id not in listed_ids


def test_list_users_include_inactive_returns_all(repo: UsersRepository):
    repo.create_user("active@example.com", "passwordpassword", "manager")
    inactive_id = repo.create_user(
        "inactive@example.com", "passwordpassword", "manager"
    )
    repo.set_active(inactive_id, False)

    all_users = repo.list_users(include_inactive=True)
    assert len(all_users) == 2


def test_set_active_round_trip(repo: UsersRepository):
    user_id = repo.create_user("u@example.com", "passwordpassword", "manager")
    repo.set_active(user_id, False)
    assert repo.get_user_by_id(user_id).is_active is False
    repo.set_active(user_id, True)
    assert repo.get_user_by_id(user_id).is_active is True


# ─── login bookkeeping ───────────────────────────────────────────────────


def test_mark_login_sets_last_login_at(repo: UsersRepository):
    user_id = repo.create_user("u@example.com", "passwordpassword", "manager")
    assert repo.get_user_by_id(user_id).last_login_at is None
    repo.mark_login(user_id)
    assert repo.get_user_by_id(user_id).last_login_at is not None


def test_must_change_password_flag_round_trip(repo: UsersRepository):
    user_id = repo.create_user(
        "admin@example.com",
        "tempseedpassword",
        "store_admin",
        must_change_password=True,
    )
    user = repo.get_user_by_id(user_id)
    assert user.must_change_password is True
