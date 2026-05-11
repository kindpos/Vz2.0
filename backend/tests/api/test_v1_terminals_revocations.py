"""
Tests for GET /v1/terminals/revocations (OVERSEER_AUTH.md §7.2, §7.3).

Mirrors the TestClient pattern in test_v1_terminals_bind_token.py: fresh
accounts.db per test, real Ed25519 keypair seeded into the provisioning
table, slot pre-bound to a known fingerprint. Tokens are minted in-test
via `issue_terminal_token(lifetime_days=...)` so we can produce expired
and near-expiry tokens without time-travel hacks.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import v1_terminals
from app.persistence.accounts_db import init_accounts_db
from app.persistence.provisioning_keys import (
    OVERSEER_PRIVATE_KEY,
    OVERSEER_PUBLIC_KEY,
    STORE_REF,
)
from app.persistence.provisioning_repository import ProvisioningRepository
from app.services.token_service import (
    _b64url_decode_nopad,
    _b64url_nopad,
    issue_terminal_token,
)


REVOCATIONS_URL = "/v1/terminals/revocations"
SLOT_ID = "KIND-001-AAAA-BBBB-CCCC"
FINGERPRINT = "fp-abc123def456"
STORE_REF_VALUE = "STORE-PILOT-1"


# ─── fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "accounts.db"
    init_accounts_db(str(path))
    return path


@pytest.fixture
def app(db_path: Path) -> FastAPI:
    fastapi_app = FastAPI()
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
def seeded_keypair(db_path: Path) -> dict:
    """Generate a real Ed25519 keypair, seed both halves into provisioning."""
    repo = ProvisioningRepository(str(db_path))
    private_key = Ed25519PrivateKey.generate()
    priv_raw = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    priv_b64 = _b64url_nopad(priv_raw)
    pub_b64 = _b64url_nopad(pub_raw)
    repo.set_value(OVERSEER_PRIVATE_KEY, priv_b64)
    repo.set_value(OVERSEER_PUBLIC_KEY, pub_b64)
    repo.set_value(STORE_REF, STORE_REF_VALUE)
    return {"private_b64": priv_b64, "public_b64": pub_b64}


@pytest.fixture
def bound_slot(accounts_db_conn: sqlite3.Connection) -> str:
    """Pre-bind SLOT_ID to FINGERPRINT so token validation passes."""
    accounts_db_conn.execute(
        """
        INSERT OR REPLACE INTO terminal_bindings
            (slot_id, terminal_name, hardware_fingerprint, bound_at,
             is_active, is_hub)
        VALUES (?, 'Test Terminal', ?, '2026-01-01T00:00:00+00:00', 1, 0)
        """,
        (SLOT_ID, FINGERPRINT),
    )
    accounts_db_conn.commit()
    return SLOT_ID


def _mint(seeded_keypair: dict, *, lifetime_days: int, fingerprint: str = FINGERPRINT) -> str:
    issued = issue_terminal_token(
        slot_id=SLOT_ID,
        store_ref=STORE_REF_VALUE,
        fingerprint=fingerprint,
        private_key_b64url=seeded_keypair["private_b64"],
        lifetime_days=lifetime_days,
    )
    return issued["token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─── tests ───────────────────────────────────────────────────────────────


def test_valid_token_returns_revoked_slot_ids(
    client: TestClient,
    seeded_keypair: dict,
    bound_slot: str,
    accounts_db_conn: sqlite3.Connection,
):
    """Valid Bearer token → 200 with the current revocations list."""
    # Seed two revocations on unrelated slot rows.
    for sid in ("KIND-007-XXXX-YYYY-ZZZZ", "KIND-012-PPPP-QQQQ-RRRR"):
        accounts_db_conn.execute(
            """
            INSERT INTO terminal_bindings (slot_id, terminal_name, is_active, is_hub)
            VALUES (?, 'Other', 1, 0)
            """,
            (sid,),
        )
    accounts_db_conn.execute(
        "INSERT INTO revocations (slot_id, revoked_at, source) VALUES (?, ?, 'cloud')",
        ("KIND-007-XXXX-YYYY-ZZZZ", "2026-05-01T00:00:00+00:00"),
    )
    accounts_db_conn.execute(
        "INSERT INTO revocations (slot_id, revoked_at, source) VALUES (?, ?, 'cloud')",
        ("KIND-012-PPPP-QQQQ-RRRR", "2026-05-02T00:00:00+00:00"),
    )
    accounts_db_conn.commit()

    token = _mint(seeded_keypair, lifetime_days=30)
    resp = client.get(REVOCATIONS_URL, headers=_auth(token))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["revoked_slot_ids"] == [
        "KIND-007-XXXX-YYYY-ZZZZ",
        "KIND-012-PPPP-QQQQ-RRRR",
    ]
    assert body["as_of"]


def test_expired_token_returns_401(
    client: TestClient,
    seeded_keypair: dict,
    bound_slot: str,
):
    """Token whose `expires_at` has passed → 401."""
    token = _mint(seeded_keypair, lifetime_days=-1)
    resp = client.get(REVOCATIONS_URL, headers=_auth(token))
    assert resp.status_code == 401, resp.text


def test_invalid_signature_returns_401(
    client: TestClient,
    seeded_keypair: dict,
    bound_slot: str,
):
    """Mangled signature → Ed25519 verify fails → 401."""
    token = _mint(seeded_keypair, lifetime_days=30)
    payload_b64, sig_b64 = token.split(".")
    sig_raw = bytearray(_b64url_decode_nopad(sig_b64))
    # Flip the last byte to corrupt the signature.
    sig_raw[-1] ^= 0xFF
    bad_token = f"{payload_b64}.{_b64url_nopad(bytes(sig_raw))}"
    resp = client.get(REVOCATIONS_URL, headers=_auth(bad_token))
    assert resp.status_code == 401, resp.text


def test_fingerprint_mismatch_returns_401(
    client: TestClient,
    seeded_keypair: dict,
    bound_slot: str,
):
    """Signed token whose `fingerprint` ≠ stored hardware_fingerprint → 401."""
    token = _mint(seeded_keypair, lifetime_days=30, fingerprint="fp-DIFFERENT-789")
    resp = client.get(REVOCATIONS_URL, headers=_auth(token))
    assert resp.status_code == 401, resp.text


def test_token_within_seven_days_of_expiry_is_refreshed(
    client: TestClient,
    seeded_keypair: dict,
    bound_slot: str,
    accounts_db_conn: sqlite3.Connection,
):
    """§7.2 — `expires_at` within 7 days of now → response carries a refreshed
    token, and the row is updated to match."""
    token = _mint(seeded_keypair, lifetime_days=5)
    resp = client.get(REVOCATIONS_URL, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["refreshed_token"], "expected a refreshed_token within 7-day window"
    assert body["refreshed_token_expires_at"]
    # Refreshed token must be a new value, not the same one we presented.
    assert body["refreshed_token"] != token
    # New expiry must be in the future, well past the original 5-day window.
    new_exp = datetime.fromisoformat(body["refreshed_token_expires_at"])
    assert new_exp > datetime.now(timezone.utc)

    # Row is updated to the freshly-issued token.
    row = accounts_db_conn.execute(
        "SELECT token, token_expires_at FROM terminal_bindings WHERE slot_id = ?",
        (SLOT_ID,),
    ).fetchone()
    assert row["token"] == body["refreshed_token"]
    assert row["token_expires_at"] == body["refreshed_token_expires_at"]


def test_token_not_near_expiry_is_not_refreshed(
    client: TestClient,
    seeded_keypair: dict,
    bound_slot: str,
):
    """§7.2 — `expires_at` > 7 days away → response does NOT include a refresh."""
    token = _mint(seeded_keypair, lifetime_days=30)
    resp = client.get(REVOCATIONS_URL, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("refreshed_token") is None
    assert body.get("refreshed_token_expires_at") is None
