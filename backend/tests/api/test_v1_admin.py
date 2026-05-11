"""
Tests for /v1/admin/users — the first role-gated admin route.

Exercises the full auth chain (login → cookie → session → user → role check)
end-to-end. Mirrors the test_v1_auth.py fixture style: a fresh accounts.db
per test, a minimal app that wires both the auth and admin routers, and
HTTPS base_url so the Secure session cookie round-trips through httpx.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import v1_admin, v1_auth
from app.auth import rate_limit
from app.persistence.accounts_db import init_accounts_db
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
    app = FastAPI()
    app.include_router(v1_auth.router)
    app.include_router(v1_admin.router)
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, base_url="https://testserver") as c:
        yield c


@pytest.fixture
def repo(db_path: Path) -> UsersRepository:
    return UsersRepository(db_path)


# ─── helpers ─────────────────────────────────────────────────────────────


_DEFAULT_PASSWORD = "supersecret-pw-12"


def _make_user(
    repo: UsersRepository,
    email: str,
    role: str = "store_admin",
    password: str = _DEFAULT_PASSWORD,
) -> str:
    return repo.create_user(
        email=email, password_plaintext=password, role=role
    )


def _login(client: TestClient, email: str, password: str = _DEFAULT_PASSWORD) -> None:
    resp = client.post(
        "/v1/auth/login", json={"email": email, "password": password}
    )
    assert resp.status_code == 200, resp.text


# ─── tests ───────────────────────────────────────────────────────────────


def test_unauthenticated_returns_401(client: TestClient):
    resp = client.get("/v1/admin/users")
    assert resp.status_code == 401


def test_authenticated_non_admin_returns_403(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "manager@example.com", role="manager")
    _login(client, "manager@example.com")
    resp = client.get("/v1/admin/users")
    assert resp.status_code == 403


def test_authenticated_server_role_also_returns_403(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "server@example.com", role="server")
    _login(client, "server@example.com")
    resp = client.get("/v1/admin/users")
    assert resp.status_code == 403


def test_store_admin_returns_200_with_users(
    client: TestClient, repo: UsersRepository
):
    admin_id = _make_user(repo, "admin@example.com", role="store_admin")
    _login(client, "admin@example.com")
    resp = client.get("/v1/admin/users")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    ids = {u["user_id"] for u in body}
    assert admin_id in ids


def test_response_never_includes_password_hash(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "admin@example.com", role="store_admin")
    _make_user(repo, "manager@example.com", role="manager")
    _make_user(repo, "server@example.com", role="server")
    _login(client, "admin@example.com")
    resp = client.get("/v1/admin/users")
    assert resp.status_code == 200
    for user in resp.json():
        assert "password_hash" not in user


def test_endpoint_reflects_users_added_after_login(
    client: TestClient, repo: UsersRepository
):
    admin_id = _make_user(repo, "admin@example.com", role="store_admin")
    _login(client, "admin@example.com")

    # Sanity: only the admin is visible initially.
    first = client.get("/v1/admin/users").json()
    assert {u["user_id"] for u in first} == {admin_id}

    # Add a second user out-of-band; the endpoint must reflect it.
    new_id = _make_user(repo, "newbie@example.com", role="manager")
    second = client.get("/v1/admin/users").json()
    ids = {u["user_id"] for u in second}
    assert ids == {admin_id, new_id}


def test_inactive_users_excluded_by_default(
    client: TestClient, repo: UsersRepository
):
    admin_id = _make_user(repo, "admin@example.com", role="store_admin")
    other_id = _make_user(repo, "other@example.com", role="manager")
    repo.set_active(other_id, False)
    _login(client, "admin@example.com")
    listed = {u["user_id"] for u in client.get("/v1/admin/users").json()}
    assert admin_id in listed
    assert other_id not in listed
