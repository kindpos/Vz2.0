"""
Staff route gap tests — scenarios not covered by test_staff_routes_extended.py
or test_api_routes.py.

Covers: double clock-in rejection, clock-out without clock-in rejection,
declare_cash_tips negative and >2dp validation, CLOCK_IN/CLOCK_OUT events
emitted alongside USER_LOGGED_IN/OUT, and get_servers empty roster.
"""

import os
import pytest
import pytest_asyncio
from pathlib import Path

from httpx import AsyncClient, ASGITransport

from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.api import dependencies as deps

TEST_DB = Path("./data/test_staff_gaps.db")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        os.remove(TEST_DB)
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        os.remove(TEST_DB)


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
# 1. Double clock-in rejected with 400
# ═══════════════════════════════════════════════════════════════════════

async def test_double_clock_in_rejected(client):
    await client.post("/api/v1/servers/clock-in", json={
        "employee_id": "emp-dbl", "employee_name": "Alice",
    })

    resp = await client.post("/api/v1/servers/clock-in", json={
        "employee_id": "emp-dbl", "employee_name": "Alice",
    })

    assert resp.status_code == 400
    assert "already clocked in" in resp.json()["detail"].lower()


# ═══════════════════════════════════════════════════════════════════════
# 2. Clock-out without clock-in rejected with 400
# ═══════════════════════════════════════════════════════════════════════

async def test_clock_out_without_clock_in_rejected(client):
    resp = await client.post("/api/v1/servers/clock-out", json={
        "employee_id": "emp-noclockin", "employee_name": "Bob",
    })

    assert resp.status_code == 400
    assert "not clocked in" in resp.json()["detail"].lower()


# ═══════════════════════════════════════════════════════════════════════
# 3. clock_in emits both CLOCK_IN and USER_LOGGED_IN events
# ═══════════════════════════════════════════════════════════════════════

async def test_clock_in_emits_both_events(client, ledger):
    resp = await client.post("/api/v1/servers/clock-in", json={
        "employee_id": "emp-events", "employee_name": "Carol",
    })
    assert resp.status_code == 200

    login_evts = await ledger.get_events_by_type(EventType.USER_LOGGED_IN)
    clock_in_evts = await ledger.get_events_by_type(EventType.CLOCK_IN)

    assert any(e.payload["employee_id"] == "emp-events" for e in login_evts)
    assert any(e.payload["employee_id"] == "emp-events" for e in clock_in_evts)


# ═══════════════════════════════════════════════════════════════════════
# 4. clock_out emits both CLOCK_OUT and USER_LOGGED_OUT events
# ═══════════════════════════════════════════════════════════════════════

async def test_clock_out_emits_both_events(client, ledger):
    await client.post("/api/v1/servers/clock-in", json={
        "employee_id": "emp-out", "employee_name": "Dave",
    })
    resp = await client.post("/api/v1/servers/clock-out", json={
        "employee_id": "emp-out", "employee_name": "Dave",
    })
    assert resp.status_code == 200

    logout_evts = await ledger.get_events_by_type(EventType.USER_LOGGED_OUT)
    clock_out_evts = await ledger.get_events_by_type(EventType.CLOCK_OUT)

    assert any(e.payload["employee_id"] == "emp-out" for e in logout_evts)
    assert any(e.payload["employee_id"] == "emp-out" for e in clock_out_evts)


# ═══════════════════════════════════════════════════════════════════════
# 5. declare_cash_tips with negative amount returns 400
# ═══════════════════════════════════════════════════════════════════════

async def test_declare_cash_tips_negative_rejected(client):
    resp = await client.post("/api/v1/servers/declare-cash-tips", json={
        "server_id": "srv-neg", "amount": -5.0,
    })

    assert resp.status_code == 400
    assert "negative" in resp.json()["detail"].lower()


# ═══════════════════════════════════════════════════════════════════════
# 6. declare_cash_tips with >2 decimal places returns 422
# ═══════════════════════════════════════════════════════════════════════

async def test_declare_cash_tips_too_many_decimals_rejected(client):
    resp = await client.post("/api/v1/servers/declare-cash-tips", json={
        "server_id": "srv-dp", "amount": 10.001,
    })

    assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════
# 7. get_servers returns empty list when no employees configured
# ═══════════════════════════════════════════════════════════════════════

async def test_get_servers_empty(client):
    resp = await client.get("/api/v1/servers")

    assert resp.status_code == 200
    assert resp.json()["servers"] == []
