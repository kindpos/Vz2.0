"""
Test that a successful password change triggers the first-boot phone-home
enqueue when first_boot_pending = 'true'.
OVERSEER_AUTH.md §4, §9.1.

Uses the same TestClient + fresh accounts.db pattern as tests/api/test_v1_auth.py
rather than the AsyncClient outline in the V1 prompt — the project standard is
sync TestClient and pytest.ini has asyncio_mode=auto, but no async fixtures
exist for v1_auth yet.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import v1_auth
from app.auth import rate_limit
from app.persistence.accounts_db import init_accounts_db
from app.persistence.provisioning_keys import (
    CUSTOMER_API_KEY,
    FIRST_BOOT_PENDING,
    STORE_REF,
)
from app.persistence.provisioning_repository import ProvisioningRepository
from app.persistence.users_repository import UsersRepository


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
    fastapi_app = FastAPI()
    fastapi_app.include_router(v1_auth.router)
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
    repo.create_user(email, password, "store_admin", must_change_password=True)
    return {"email": email, "password": password}


# ─── tests ───────────────────────────────────────────────────────────────


def test_password_change_enqueues_phone_home_on_first_boot(
    client: TestClient,
    accounts_db_conn: sqlite3.Connection,
    provisioning_repo: ProvisioningRepository,
    seeded_store_admin: dict,
):
    """
    Given first_boot_pending = 'true' and customer_api_key + store_ref set,
    a successful password change should:
    - Enqueue one phone_home_queue row with status='pending'
    - Set first_boot_pending = 'false'
    """
    # Arrange: set provisioning keys as the image-builder would
    provisioning_repo.set_value(FIRST_BOOT_PENDING, "true")
    provisioning_repo.set_value(STORE_REF, "STORE-PILOT-1")
    provisioning_repo.set_value(CUSTOMER_API_KEY, "test-api-key-abc123")

    # Log in first
    login = client.post(
        "/v1/auth/login",
        json={
            "email": seeded_store_admin["email"],
            "password": seeded_store_admin["password"],
        },
    )
    assert login.status_code == 200

    # Act: change password
    resp = client.post(
        "/v1/auth/password-change",
        json={
            "current_password": seeded_store_admin["password"],
            "new_password": "NewSecurePass!99",
        },
    )
    assert resp.status_code == 204

    # Assert: phone_home_queue has one pending row
    row = accounts_db_conn.execute(
        "SELECT endpoint, status FROM phone_home_queue WHERE status = 'pending'"
    ).fetchone()
    assert row is not None
    assert "notify/activated" in row["endpoint"]

    # Assert: first_boot_pending cleared
    assert provisioning_repo.get_value(FIRST_BOOT_PENDING) == "false"


def test_password_change_no_enqueue_when_first_boot_false(
    client: TestClient,
    accounts_db_conn: sqlite3.Connection,
    provisioning_repo: ProvisioningRepository,
    seeded_store_admin: dict,
):
    """When first_boot_pending = 'false', password change must NOT enqueue."""
    provisioning_repo.set_value(FIRST_BOOT_PENDING, "false")
    provisioning_repo.set_value(STORE_REF, "STORE-PILOT-1")
    provisioning_repo.set_value(CUSTOMER_API_KEY, "test-api-key-abc123")

    login = client.post(
        "/v1/auth/login",
        json={
            "email": seeded_store_admin["email"],
            "password": seeded_store_admin["password"],
        },
    )
    assert login.status_code == 200

    resp = client.post(
        "/v1/auth/password-change",
        json={
            "current_password": seeded_store_admin["password"],
            "new_password": "AnotherNewPass!88",
        },
    )
    assert resp.status_code == 204

    rows = accounts_db_conn.execute(
        "SELECT COUNT(*) as n FROM phone_home_queue"
    ).fetchone()
    assert rows["n"] == 0
