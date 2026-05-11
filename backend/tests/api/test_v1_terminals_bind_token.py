"""
Tests for the Ed25519 binding token returned by POST /v1/terminals/bind
(OVERSEER_AUTH.md §6.3, §7).

Same TestClient pattern as tests/api/test_v1_auth.py: fresh accounts.db per
test, real Ed25519 keypair seeded into the provisioning table, signature
verified end-to-end with the public key the handler returns to the caller.
"""

from __future__ import annotations

import base64
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import v1_auth, v1_terminals
from app.auth import rate_limit
from app.persistence.accounts_db import init_accounts_db
from app.persistence.provisioning_keys import (
    OVERSEER_PRIVATE_KEY,
    OVERSEER_PUBLIC_KEY,
    STORE_REF,
)
from app.persistence.provisioning_repository import ProvisioningRepository
from app.persistence.users_repository import UsersRepository


BIND_URL = "/v1/terminals/bind"
LOGIN_URL = "/v1/auth/login"


# ─── helpers ─────────────────────────────────────────────────────────────


def _b64url_nopad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode_nopad(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


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
def seeded_keypair(provisioning_repo: ProvisioningRepository) -> dict:
    """Generate a real Ed25519 keypair, seed both halves into provisioning,
    and return the raw bytes + base64url forms for cross-checking."""
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
    provisioning_repo.set_value(OVERSEER_PRIVATE_KEY, priv_b64)
    provisioning_repo.set_value(OVERSEER_PUBLIC_KEY, pub_b64)
    return {
        "private_key": private_key,
        "private_raw": priv_raw,
        "public_raw": pub_raw,
        "private_b64": priv_b64,
        "public_b64": pub_b64,
    }


@pytest.fixture
def seeded_store_ref(provisioning_repo: ProvisioningRepository) -> str:
    ref = "STORE-PILOT-1"
    provisioning_repo.set_value(STORE_REF, ref)
    return ref


@pytest.fixture
def seeded_store_admin(db_path: Path) -> dict:
    repo = UsersRepository(db_path)
    email = "owner@example.com"
    password = "currentpass1234"
    repo.create_user(email, password, "store_admin", must_change_password=False)
    return {"email": email, "password": password}


@pytest.fixture
def seeded_slot(accounts_db_conn: sqlite3.Connection) -> str:
    slot_id = "KIND-001-AAAA-BBBB-CCCC"
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


@pytest.fixture
def logged_in_admin(
    client: TestClient, seeded_store_admin: dict
) -> TestClient:
    resp = client.post(
        LOGIN_URL,
        json={
            "email": seeded_store_admin["email"],
            "password": seeded_store_admin["password"],
        },
    )
    assert resp.status_code == 200, resp.text
    return client


# ─── tests ───────────────────────────────────────────────────────────────


def test_bind_returns_token_and_public_key(
    logged_in_admin: TestClient,
    seeded_keypair: dict,
    seeded_store_ref: str,
    seeded_slot: str,
):
    """Bind response includes a token, an expiry, and the public key from
    provisioning. The public key in the response matches what was seeded."""
    resp = logged_in_admin.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-abc123def456",
            "terminal_name_preferred": "Front Counter",
            "slot_id": seeded_slot,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["slot_id"] == seeded_slot
    assert body["terminal_name"] == "Front Counter"
    assert "." in body["token"]
    assert body["token_expires_at"]
    assert body["overseer_public_key"] == seeded_keypair["public_b64"]


def test_bind_token_signature_verifies_with_returned_public_key(
    logged_in_admin: TestClient,
    seeded_keypair: dict,
    seeded_store_ref: str,
    seeded_slot: str,
):
    """End-to-end: take the token + public_key from the response, verify
    the signature, and confirm the payload's claims match what we bound."""
    fingerprint = "fp-abc123def456"
    resp = logged_in_admin.post(
        BIND_URL,
        json={
            "hardware_fingerprint": fingerprint,
            "terminal_name_preferred": "Front Counter",
            "slot_id": seeded_slot,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    payload_b64, sig_b64 = body["token"].split(".")
    payload_bytes = _b64url_decode_nopad(payload_b64)
    signature = _b64url_decode_nopad(sig_b64)

    pub_raw = _b64url_decode_nopad(body["overseer_public_key"])
    pub_key = Ed25519PublicKey.from_public_bytes(pub_raw)
    # Raises InvalidSignature on mismatch — no exception == valid.
    pub_key.verify(signature, payload_bytes)

    payload = json.loads(payload_bytes.decode("utf-8"))
    assert payload["v"] == 1
    assert payload["slot_id"] == seeded_slot
    assert payload["store_ref"] == seeded_store_ref
    assert payload["fingerprint"] == fingerprint
    assert payload["issued_at"]
    assert payload["expires_at"] == body["token_expires_at"]


def test_bind_token_expires_about_thirty_days_from_now(
    logged_in_admin: TestClient,
    seeded_keypair: dict,
    seeded_store_ref: str,
    seeded_slot: str,
):
    """Default token lifetime is 30 days (§7.1). Allow 60s of clock slack."""
    before = datetime.now(timezone.utc)
    resp = logged_in_admin.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-abc123def456",
            "slot_id": seeded_slot,
        },
    )
    assert resp.status_code == 200, resp.text
    expires_at = datetime.fromisoformat(resp.json()["token_expires_at"])

    expected = before + timedelta(days=30)
    delta = abs((expires_at - expected).total_seconds())
    assert delta < 60, (
        f"token_expires_at {expires_at.isoformat()} is "
        f"{delta:.1f}s off from expected 30-day mark"
    )


def test_bind_persists_token_and_expiry_on_terminal_bindings_row(
    logged_in_admin: TestClient,
    accounts_db_conn: sqlite3.Connection,
    seeded_keypair: dict,
    seeded_store_ref: str,
    seeded_slot: str,
):
    """The same token returned in the response is also persisted on the row."""
    resp = logged_in_admin.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-abc123def456",
            "slot_id": seeded_slot,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    row = accounts_db_conn.execute(
        "SELECT token, token_expires_at FROM terminal_bindings WHERE slot_id = ?",
        (seeded_slot,),
    ).fetchone()
    assert row["token"] == body["token"]
    assert row["token_expires_at"] == body["token_expires_at"]


# ─── HARDWARE_ROUTING.md §2.3 + §2.2 ─────────────────────────────────────


@pytest.fixture
def hardware_db_path(tmp_path: Path, monkeypatch) -> Path:
    """Point the hardware module's HARDWARE_DB_PATH at a temp file and
    create the minimal `terminals` schema the bind handler will UPDATE.

    Mirrors the columns produced by hardware.py `_ensure_db()` so the
    real UPDATE statement matches against a realistic row shape, but
    avoids spinning up the full aiosqlite migration path inside a sync
    test fixture."""
    path = tmp_path / "hardware_config.db"
    monkeypatch.setattr(
        "app.api.routes.hardware.HARDWARE_DB_PATH", str(path)
    )
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(
            """
            CREATE TABLE terminals (
                terminal_id     TEXT PRIMARY KEY,
                auth_key_hash   TEXT NOT NULL DEFAULT '',
                activated_at    TEXT NOT NULL DEFAULT '',
                is_active       INTEGER NOT NULL DEFAULT 1,
                name            TEXT NOT NULL DEFAULT '',
                ip_address      TEXT NOT NULL DEFAULT '',
                mac_address     TEXT NOT NULL DEFAULT '',
                role            TEXT NOT NULL DEFAULT 'server',
                is_hub          INTEGER NOT NULL DEFAULT 0,
                slot_id         TEXT DEFAULT ''
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
    return path


def test_bind_writes_mac_address_to_terminal_bindings(
    logged_in_admin: TestClient,
    accounts_db_conn: sqlite3.Connection,
    seeded_keypair: dict,
    seeded_store_ref: str,
    seeded_slot: str,
    hardware_db_path: Path,
):
    """When a MAC is supplied, it is persisted on the terminal_bindings row
    (HARDWARE_ROUTING.md §2.3)."""
    mac = "AA:BB:CC:DD:EE:01"
    resp = logged_in_admin.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-abc123def456",
            "slot_id": seeded_slot,
            "mac_address": mac,
        },
    )
    assert resp.status_code == 200, resp.text

    row = accounts_db_conn.execute(
        "SELECT mac_address FROM terminal_bindings WHERE slot_id = ?",
        (seeded_slot,),
    ).fetchone()
    assert row["mac_address"] == mac


def test_bind_backfills_slot_id_on_hardware_terminals_row(
    logged_in_admin: TestClient,
    seeded_keypair: dict,
    seeded_store_ref: str,
    seeded_slot: str,
    hardware_db_path: Path,
):
    """When a MAC is supplied AND a terminals row in hardware_config.db has
    that MAC, the row's slot_id is back-filled to the bound slot
    (HARDWARE_ROUTING.md §2.2)."""
    mac = "AA:BB:CC:DD:EE:02"
    # Seed a terminals row whose mac_address matches the bind request's MAC.
    hw_conn = sqlite3.connect(str(hardware_db_path))
    try:
        hw_conn.execute(
            """
            INSERT INTO terminals
                (terminal_id, auth_key_hash, activated_at, is_active,
                 mac_address, slot_id)
            VALUES ('T-01', 'hashval', '2026-05-01T00:00:00+00:00', 1, ?, '')
            """,
            (mac,),
        )
        hw_conn.commit()
    finally:
        hw_conn.close()

    resp = logged_in_admin.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-abc123def456",
            "slot_id": seeded_slot,
            "mac_address": mac,
        },
    )
    assert resp.status_code == 200, resp.text

    hw_conn = sqlite3.connect(str(hardware_db_path))
    hw_conn.row_factory = sqlite3.Row
    try:
        row = hw_conn.execute(
            "SELECT slot_id FROM terminals WHERE mac_address = ?", (mac,)
        ).fetchone()
    finally:
        hw_conn.close()
    assert row is not None
    assert row["slot_id"] == seeded_slot


def test_bind_without_mac_address_succeeds_and_skips_hardware_write(
    logged_in_admin: TestClient,
    accounts_db_conn: sqlite3.Connection,
    seeded_keypair: dict,
    seeded_store_ref: str,
    seeded_slot: str,
):
    """Omitting mac_address must not raise. terminal_bindings.mac_address
    stays at its '' default and no hardware_config.db connection is opened
    (no fixture here — if the handler tried to touch the prod hardware DB
    in this test environment it would fail)."""
    resp = logged_in_admin.post(
        BIND_URL,
        json={
            "hardware_fingerprint": "fp-abc123def456",
            "slot_id": seeded_slot,
        },
    )
    assert resp.status_code == 200, resp.text

    row = accounts_db_conn.execute(
        "SELECT mac_address FROM terminal_bindings WHERE slot_id = ?",
        (seeded_slot,),
    ).fetchone()
    assert row["mac_address"] == ""
