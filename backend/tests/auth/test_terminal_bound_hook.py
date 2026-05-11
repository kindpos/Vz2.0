"""
Test that POST /v1/terminals/bind enqueues a terminal-bound phone-home.
OVERSEER_AUTH.md §6.3, §9.2.

Uses the same sync TestClient pattern as tests/api/test_v1_auth.py and the
V1 first-boot hook test. The minimal bind route in app/api/routes/v1_terminals.py
issues no §7 token yet; the enqueue is the only side effect we assert here.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import v1_auth, v1_terminals
from app.auth import rate_limit
from app.persistence.accounts_db import init_accounts_db
from app.persistence.provisioning_keys import (
    CUSTOMER_API_KEY,
    FIRST_BOOT_PENDING,
    STORE_REF,
)
from app.persistence.provisioning_repository import ProvisioningRepository
from app.persistence.users_repository import UsersRepository


BIND_URL = "/v1/terminals/bind"


# ─── fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "accounts.db"
    init_accounts_db(str(path))
    return path


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> Iterator[None]:
    rate_limit.reset_all()
    yield
    rate_limit.reset_all()


@pytest.fixture
def app(db_path: Path) -> FastAPI:
    """Test app with both v1_auth (for login) and v1_terminals (for bind)."""
    fastapi_app = FastAPI()
    fastapi_app.include_router(v1_auth.router)
    fastapi_app.include_router(v1_terminals.router)
    return fastapi_app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, base_url="https://testserver") as c:
        yield c


@pytest.fixture
def accounts_db_conn(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture
def provisioning_repo(db_path: Path) -> ProvisioningRepository:
    return ProvisioningRepository(str(db_path))


@pytest.fixture
def seeded_store_admin(db_path: Path) -> dict:
    repo = UsersRepository(db_path)
    email = "owner@example.com"
    password = "currentpass1234"
    repo.create_user(email, password, "store_admin", must_change_password=False)
    return {"email": email, "password": password}


def _seed_slot(
    accounts_db_conn: sqlite3.Connection,
    slot_id: str = "KIND-001-AAAA-BBBB-CCCC",
) -> str:
    """Insert an unbound terminal_bindings row."""
    accounts_db_conn.execute(
        """
        INSERT OR IGNORE INTO terminal_bindings
            (slot_id, terminal_name, is_active, is_hub)
        VALUES (?, 'Test Terminal', 1, 0)
        """,
        (slot_id,),
    )
    accounts_db_conn.commit()
    return slot_id


# ─── tests ───────────────────────────────────────────────────────────────


def test_bind_enqueues_terminal_bound_phone_home(
    client: TestClient,
    accounts_db_conn: sqlite3.Connection,
    provisioning_repo: ProvisioningRepository,
    seeded_store_admin: dict,
):
    """A successful bind should insert one phone_home_queue row
    whose endpoint contains `terminal-bound`."""
    # Arrange
    provisioning_repo.set_value(STORE_REF, "STORE-PILOT-1")
    provisioning_repo.set_value(CUSTOMER_API_KEY, "test-key-xyz")
    provisioning_repo.set_value(FIRST_BOOT_PENDING, "false")

    slot_id = _seed_slot(accounts_db_conn)

    # Log in as store_admin
    login = client.post(
        "/v1/auth/login",
        json={
            "email": seeded_store_admin["email"],
            "password": seeded_store_admin["password"],
        },
    )
    assert login.status_code == 200

    # Act: bind
    resp = client.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-abc123def456",
            "terminal_name_preferred": "Front Counter",
            "slot_id": slot_id,
        },
    )
    assert resp.status_code == 200, resp.text

    # Assert: queue has one pending terminal-bound job
    row = accounts_db_conn.execute(
        "SELECT endpoint, status FROM phone_home_queue WHERE status = 'pending'"
    ).fetchone()
    assert row is not None
    assert "terminal-bound" in row["endpoint"]


def test_bind_no_enqueue_when_provisioning_keys_missing(
    client: TestClient,
    accounts_db_conn: sqlite3.Connection,
    provisioning_repo: ProvisioningRepository,
    seeded_store_admin: dict,
):
    """If store_ref or customer_api_key are not set in provisioning
    (e.g. dev environment), bind should succeed without enqueueing."""
    # No provisioning keys set — simulates a non-provisioned dev install
    slot_id = _seed_slot(accounts_db_conn, slot_id="KIND-002-CCCC-DDDD-EEEE")

    login = client.post(
        "/v1/auth/login",
        json={
            "email": seeded_store_admin["email"],
            "password": seeded_store_admin["password"],
        },
    )
    assert login.status_code == 200

    resp = client.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-noprovisioning",
            "terminal_name_preferred": "Bar Terminal",
            "slot_id": slot_id,
        },
    )
    assert resp.status_code == 200, resp.text

    rows = accounts_db_conn.execute(
        "SELECT COUNT(*) as n FROM phone_home_queue"
    ).fetchone()
    assert rows["n"] == 0
