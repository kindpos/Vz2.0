"""
Tests for payment route hardware-adjacent endpoints not covered by
test_payment_routes_gaps.py:
  POST /payments/reload-devices   — hot-reload falls back to mock when no hardware
  GET  /payments/test-device      — mock device returns ready status
  GET  /payments/spin-diag        — mock path returns error (no real reader)
"""

import os
import pytest
import pytest_asyncio
from pathlib import Path

from httpx import AsyncClient, ASGITransport

from app.api import dependencies as deps
from app.core.event_ledger import EventLedger
import app.api.routes.payment_routes as pay_mod

TEST_DB = Path("./data/test_payment_routes_hw.db")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        os.remove(TEST_DB)
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        os.remove(TEST_DB)


@pytest_asyncio.fixture(autouse=True)
def _reset_payment_globals():
    """Ensure each test gets a fresh payment manager state."""
    pay_mod._manager = None
    pay_mod._devices_initialized = False
    yield
    pay_mod._manager = None
    pay_mod._devices_initialized = False


@pytest_asyncio.fixture
async def client(ledger):
    from app.main import app

    async def _override():
        return ledger

    app.dependency_overrides[deps.get_ledger] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ═══════════════════════════════════════════════════════════════════════
# 1. POST /reload-devices — no hardware_config.db → falls back to mock
# ═══════════════════════════════════════════════════════════════════════

async def test_reload_devices_falls_back_to_mock(client):
    """With no real hardware DB, reload-devices registers a mock device."""
    resp = await client.post("/api/v1/payments/reload-devices")

    # auth_enforced=False so no 401/403 without a token
    assert resp.status_code == 200
    data = resp.json()
    assert data["reloaded"] is True
    assert data["using_mock"] is True
    assert len(data["active_devices"]) >= 1


# ═══════════════════════════════════════════════════════════════════════
# 2. GET /test-device — mock device returns ready status
# ═══════════════════════════════════════════════════════════════════════

async def test_test_device_mock_returns_ready(client):
    """With mock device loaded, test-device reports connected + using_mock."""
    resp = await client.get("/api/v1/payments/test-device")

    assert resp.status_code == 200
    data = resp.json()
    assert data["connected"] is True
    assert data["using_mock"] is True
    assert data["device"] == "mock"
    assert data["status"] == "ready"


# ═══════════════════════════════════════════════════════════════════════
# 3. GET /spin-diag — mock path returns error (no real reader)
# ═══════════════════════════════════════════════════════════════════════

async def test_spin_diag_mock_path_returns_error(client):
    """With no real card reader, spin-diag returns an error dict, not 5xx."""
    resp = await client.get("/api/v1/payments/spin-diag")

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data
    assert "mock" in data["error"].lower() or "no real" in data["error"].lower()
