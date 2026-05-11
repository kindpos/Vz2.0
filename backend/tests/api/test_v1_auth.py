"""
Tests for /v1/auth/login and /v1/auth/password-change (OVERSEER_AUTH.md §5).

The fixtures here build a fresh FastAPI app with just the v1_auth router and
a small `_protected` probe endpoint that exercises `get_current_session`.
Each test gets its own accounts.db and a clean rate-limit state, so tests can
run in any order without bleed.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Iterator

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.routes import v1_auth
from app.auth import rate_limit
from app.auth.dependencies import (
    SESSION_COOKIE_NAME,
    get_current_session,
    get_current_user,
)
from app.auth.recovery import seed_recovery_code_hash, verify_recovery_code
from app.auth.sessions import Session
from app.persistence.accounts_db import init_accounts_db
from app.persistence.users_repository import User, UsersRepository


# ─── fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    """Fresh accounts.db per test, registered as the active accounts DB."""
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
    """Minimal app: just the v1_auth router plus a protected probe."""
    app = FastAPI()
    app.include_router(v1_auth.router)

    @app.get("/v1/auth/_probe")
    def _probe(
        session: Session = Depends(get_current_session),
        user: User = Depends(get_current_user),
    ):
        return {
            "session_id": session.session_id,
            "expires_at": session.expires_at,
            "user_id": user.user_id,
            "role": user.role,
        }

    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """HTTPS base_url so the Secure cookie is honored by the httpx jar."""
    with TestClient(app, base_url="https://testserver") as c:
        yield c


@pytest.fixture
def repo(db_path: Path) -> UsersRepository:
    return UsersRepository(db_path)


def _make_user(
    repo: UsersRepository,
    email: str = "owner@example.com",
    password: str = "correcthorsebatterystaple",
    role: str = "store_admin",
    must_change_password: bool = False,
) -> str:
    return repo.create_user(email, password, role, must_change_password)


def _read_session_row(db_path: Path, session_id: str) -> dict | None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ─── login: happy path ───────────────────────────────────────────────────


def test_login_valid_returns_200_and_cookie(client: TestClient, repo: UsersRepository):
    user_id = _make_user(repo, "owner@example.com", "supersecretpass12")
    resp = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "supersecretpass12"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == user_id
    assert body["email"] == "owner@example.com"
    assert body["role"] == "store_admin"
    assert body["must_change_password"] is False
    assert body["session_id"]
    assert body["expires_at"]

    # cookie set
    set_cookie = resp.headers.get("set-cookie", "")
    assert SESSION_COOKIE_NAME in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "SameSite=strict" in set_cookie.lower() or "samesite=strict" in set_cookie.lower()
    assert client.cookies.get(SESSION_COOKIE_NAME) == body["session_id"]


def test_login_email_is_case_insensitive(client: TestClient, repo: UsersRepository):
    _make_user(repo, "Mixed.Case@Example.com", "supersecretpass12")
    resp = client.post(
        "/v1/auth/login",
        json={"email": "mixed.case@example.com", "password": "supersecretpass12"},
    )
    assert resp.status_code == 200


# ─── login: failure modes ────────────────────────────────────────────────


def test_login_wrong_password_returns_401_generic(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "supersecretpass12")
    resp = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "wrongpassword!!"},
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "invalid credentials"}


def test_login_unknown_email_returns_same_generic_message(
    client: TestClient, repo: UsersRepository
):
    """No user enumeration — unknown email and wrong password must look identical."""
    _make_user(repo, "owner@example.com", "supersecretpass12")
    resp_unknown = client.post(
        "/v1/auth/login",
        json={"email": "ghost@example.com", "password": "anything12345"},
    )
    resp_wrong = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "wrongguess12!"},
    )
    assert resp_unknown.status_code == 401
    assert resp_wrong.status_code == 401
    assert resp_unknown.json() == resp_wrong.json() == {"detail": "invalid credentials"}


def test_login_deactivated_user_returns_423(client: TestClient, repo: UsersRepository):
    user_id = _make_user(repo, "owner@example.com", "supersecretpass12")
    repo.set_active(user_id, False)
    resp = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "supersecretpass12"},
    )
    assert resp.status_code == 423


# ─── login: rate limiting ────────────────────────────────────────────────


def test_login_per_email_rate_limit_kicks_in_on_sixth_attempt(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "supersecretpass12")
    for _ in range(5):
        r = client.post(
            "/v1/auth/login",
            json={"email": "owner@example.com", "password": "wrongguess12!"},
        )
        assert r.status_code == 401
    r6 = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "wrongguess12!"},
    )
    assert r6.status_code == 429
    assert "retry-after" in {k.lower() for k in r6.headers.keys()}


def test_login_per_ip_rate_limit_kicks_in_on_twenty_first_attempt(
    client: TestClient, repo: UsersRepository
):
    # 20 distinct emails so per-email cap (5) never trips first.
    for i in range(20):
        r = client.post(
            "/v1/auth/login",
            json={"email": f"ghost{i}@example.com", "password": "wrongguess12!"},
        )
        assert r.status_code == 401, f"attempt {i} got {r.status_code}"
    r21 = client.post(
        "/v1/auth/login",
        json={"email": "ghost-final@example.com", "password": "wrongguess12!"},
    )
    assert r21.status_code == 429


def test_successful_login_resets_email_rate_limit_counter(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "supersecretpass12")
    for _ in range(4):
        r = client.post(
            "/v1/auth/login",
            json={"email": "owner@example.com", "password": "wrongguess12!"},
        )
        assert r.status_code == 401

    # Success — should clear the bucket.
    ok = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "supersecretpass12"},
    )
    assert ok.status_code == 200

    # Five more failures should all be 401 (not 429).
    for _ in range(5):
        r = client.post(
            "/v1/auth/login",
            json={"email": "owner@example.com", "password": "wrongguess12!"},
        )
        assert r.status_code == 401

    # And the 6th in this new run should finally 429.
    r6 = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "wrongguess12!"},
    )
    assert r6.status_code == 429


# ─── password-change ─────────────────────────────────────────────────────


def _login(client: TestClient, email: str, password: str) -> dict:
    resp = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_password_change_wrong_current_returns_401(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    _login(client, "owner@example.com", "currentpass1234")
    resp = client.post(
        "/v1/auth/password-change",
        json={"current_password": "wrongcurrent12", "new_password": "newpassword1234"},
    )
    assert resp.status_code == 401


def test_password_change_new_equals_current_returns_400(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    _login(client, "owner@example.com", "currentpass1234")
    resp = client.post(
        "/v1/auth/password-change",
        json={"current_password": "currentpass1234", "new_password": "currentpass1234"},
    )
    assert resp.status_code == 400


def test_password_change_too_short_returns_400(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    _login(client, "owner@example.com", "currentpass1234")
    resp = client.post(
        "/v1/auth/password-change",
        json={"current_password": "currentpass1234", "new_password": "short"},
    )
    assert resp.status_code == 400


def test_password_change_success_returns_204_and_rotates_credentials(
    client: TestClient, repo: UsersRepository, db_path: Path
):
    user_id = _make_user(
        repo, "owner@example.com", "currentpass1234", must_change_password=True
    )
    _login(client, "owner@example.com", "currentpass1234")
    resp = client.post(
        "/v1/auth/password-change",
        json={"current_password": "currentpass1234", "new_password": "newpassword1234"},
    )
    assert resp.status_code == 204

    # must_change_password cleared
    refreshed = repo.get_user_by_id(user_id)
    assert refreshed.must_change_password is False

    # Old credentials no longer log in
    rate_limit.reset_all()
    bad = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "currentpass1234"},
    )
    assert bad.status_code == 401

    # New credentials work
    good = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "newpassword1234"},
    )
    assert good.status_code == 200


# ─── session middleware (cookie → user) ──────────────────────────────────


def test_authenticated_request_with_valid_cookie_succeeds(
    client: TestClient, repo: UsersRepository
):
    user_id = _make_user(repo, "owner@example.com", "currentpass1234")
    _login(client, "owner@example.com", "currentpass1234")
    resp = client.get("/v1/auth/_probe")
    assert resp.status_code == 200
    assert resp.json()["user_id"] == user_id


def test_authenticated_request_with_no_cookie_returns_401(client: TestClient):
    resp = client.get("/v1/auth/_probe")
    assert resp.status_code == 401


def test_authenticated_request_with_revoked_session_returns_401(
    client: TestClient, repo: UsersRepository, db_path: Path
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    body = _login(client, "owner@example.com", "currentpass1234")
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "UPDATE sessions SET revoked = 1 WHERE session_id = ?",
            (body["session_id"],),
        )
        conn.commit()
    finally:
        conn.close()
    resp = client.get("/v1/auth/_probe")
    assert resp.status_code == 401


def test_authenticated_request_with_expired_session_returns_401(
    client: TestClient, repo: UsersRepository, db_path: Path
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    body = _login(client, "owner@example.com", "currentpass1234")
    # Force expiry into the past.
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "UPDATE sessions SET expires_at = ? WHERE session_id = ?",
            ("2000-01-01T00:00:00.000000Z", body["session_id"]),
        )
        conn.commit()
    finally:
        conn.close()
    resp = client.get("/v1/auth/_probe")
    assert resp.status_code == 401


def test_authenticated_request_refreshes_session_expiry(
    client: TestClient, repo: UsersRepository, db_path: Path
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    body = _login(client, "owner@example.com", "currentpass1234")
    session_id = body["session_id"]
    initial_expires = _read_session_row(db_path, session_id)["expires_at"]

    # Microsecond-precision ISO timestamps; sleep just long enough to
    # guarantee a forward move on any clock.
    time.sleep(0.02)
    resp = client.get("/v1/auth/_probe")
    assert resp.status_code == 200

    after_expires = _read_session_row(db_path, session_id)["expires_at"]
    assert after_expires > initial_expires


# ─── logout ──────────────────────────────────────────────────────────────


def test_logout_valid_session_returns_204_and_revokes(
    client: TestClient, repo: UsersRepository, db_path: Path
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    body = _login(client, "owner@example.com", "currentpass1234")
    resp = client.post("/v1/auth/logout")
    assert resp.status_code == 204

    # DB-side: session is marked revoked.
    row = _read_session_row(db_path, body["session_id"])
    assert row is not None
    assert row["revoked"] == 1

    # Re-injecting the same cookie should now fail. We bypass the test client's
    # cookie jar (which dropped the cookie on the delete_cookie response) and
    # set the header directly to simulate a stolen cookie being replayed.
    resp2 = client.get(
        "/v1/auth/_probe",
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={body['session_id']}"},
    )
    assert resp2.status_code == 401


def test_logout_without_session_returns_401(client: TestClient):
    resp = client.post("/v1/auth/logout")
    assert resp.status_code == 401


# ─── /me ─────────────────────────────────────────────────────────────────


def test_me_with_valid_session_returns_user(
    client: TestClient, repo: UsersRepository
):
    user_id = _make_user(
        repo, "owner@example.com", "currentpass1234", must_change_password=True
    )
    _login(client, "owner@example.com", "currentpass1234")
    resp = client.get("/v1/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == user_id
    assert body["email"] == "owner@example.com"
    assert body["role"] == "store_admin"
    assert body["must_change_password"] is True
    # last_login_at was set by login.
    assert body["last_login_at"]


def test_me_without_session_returns_401(client: TestClient):
    resp = client.get("/v1/auth/me")
    assert resp.status_code == 401


def test_me_with_expired_session_returns_401(
    client: TestClient, repo: UsersRepository, db_path: Path
):
    _make_user(repo, "owner@example.com", "currentpass1234")
    body = _login(client, "owner@example.com", "currentpass1234")
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "UPDATE sessions SET expires_at = ? WHERE session_id = ?",
            ("2000-01-01T00:00:00.000000Z", body["session_id"]),
        )
        conn.commit()
    finally:
        conn.close()
    resp = client.get("/v1/auth/me")
    assert resp.status_code == 401


# ─── password recovery ──────────────────────────────────────────────────


_KNOWN_RECOVERY_CODE = "abcd-efgh-ijkl-mnop-qrst-uvwx"


def test_password_recovery_success_returns_new_code_and_rotates(
    client: TestClient, repo: UsersRepository
):
    user_id = _make_user(
        repo, "owner@example.com", "oldpassword1234", must_change_password=True
    )
    seed_recovery_code_hash(_KNOWN_RECOVERY_CODE)

    resp = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "owner@example.com",
            "recovery_code": _KNOWN_RECOVERY_CODE,
            "new_password": "brandnewpass1234",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "new_recovery_code" in body
    assert body["new_recovery_code"] != _KNOWN_RECOVERY_CODE

    # Old password no longer logs in.
    rate_limit.reset_all()
    bad = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "oldpassword1234"},
    )
    assert bad.status_code == 401

    # New password works.
    good = client.post(
        "/v1/auth/login",
        json={"email": "owner@example.com", "password": "brandnewpass1234"},
    )
    assert good.status_code == 200

    # Old recovery code no longer verifies; the new one does.
    assert verify_recovery_code(_KNOWN_RECOVERY_CODE) is False
    assert verify_recovery_code(body["new_recovery_code"]) is True

    # must_change_password cleared.
    assert repo.get_user_by_id(user_id).must_change_password is False


def test_password_recovery_wrong_code_returns_401_generic(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "oldpassword1234")
    seed_recovery_code_hash(_KNOWN_RECOVERY_CODE)
    resp = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "owner@example.com",
            "recovery_code": "wrng-wrng-wrng-wrng-wrng-wrng",
            "new_password": "brandnewpass1234",
        },
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "invalid credentials"}


def test_password_recovery_unknown_email_returns_same_generic_message(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "oldpassword1234")
    seed_recovery_code_hash(_KNOWN_RECOVERY_CODE)
    resp_unknown = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "ghost@example.com",
            "recovery_code": _KNOWN_RECOVERY_CODE,
            "new_password": "brandnewpass1234",
        },
    )
    resp_wrong = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "owner@example.com",
            "recovery_code": "wrng-wrng-wrng-wrng-wrng-wrng",
            "new_password": "brandnewpass1234",
        },
    )
    assert resp_unknown.status_code == 401
    assert resp_wrong.status_code == 401
    assert resp_unknown.json() == resp_wrong.json() == {"detail": "invalid credentials"}


def test_password_recovery_short_new_password_returns_400(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "oldpassword1234")
    seed_recovery_code_hash(_KNOWN_RECOVERY_CODE)
    resp = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "owner@example.com",
            "recovery_code": _KNOWN_RECOVERY_CODE,
            "new_password": "short",
        },
    )
    assert resp.status_code == 400


def test_password_recovery_clears_must_change_password(
    client: TestClient, repo: UsersRepository
):
    user_id = _make_user(
        repo, "owner@example.com", "oldpassword1234", must_change_password=True
    )
    seed_recovery_code_hash(_KNOWN_RECOVERY_CODE)
    resp = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "owner@example.com",
            "recovery_code": _KNOWN_RECOVERY_CODE,
            "new_password": "brandnewpass1234",
        },
    )
    assert resp.status_code == 200
    assert repo.get_user_by_id(user_id).must_change_password is False


def test_password_recovery_is_single_use(
    client: TestClient, repo: UsersRepository
):
    _make_user(repo, "owner@example.com", "oldpassword1234")
    seed_recovery_code_hash(_KNOWN_RECOVERY_CODE)

    first = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "owner@example.com",
            "recovery_code": _KNOWN_RECOVERY_CODE,
            "new_password": "brandnewpass1234",
        },
    )
    assert first.status_code == 200

    # Replaying the original code must fail — rotation invalidated it.
    second = client.post(
        "/v1/auth/password-recovery",
        json={
            "email": "owner@example.com",
            "recovery_code": _KNOWN_RECOVERY_CODE,
            "new_password": "anotherpass1234",
        },
    )
    assert second.status_code == 401
