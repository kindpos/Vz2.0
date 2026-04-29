"""
KINDpos Smoke Test Suite
========================
Fast pre-deploy CI gate: 5 independent tests covering auth, order
lifecycle, and day reporting.
"""

import os
import pytest
import pytest_asyncio
from pathlib import Path

from httpx import AsyncClient, ASGITransport

from app.api import dependencies as deps
from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event


_TEST_DB = Path("./data/test_smoke.db")


@pytest_asyncio.fixture
async def ledger():
    if _TEST_DB.exists():
        _TEST_DB.unlink()
    async with EventLedger(str(_TEST_DB)) as _ledger:
        yield _ledger
    if _TEST_DB.exists():
        _TEST_DB.unlink()


@pytest_asyncio.fixture
async def client(ledger):
    from app.main import app

    async def _override_ledger():
        return ledger

    app.dependency_overrides[deps.get_ledger] = _override_ledger

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


async def _seed_employee(ledger, *, employee_id: str, pin: str, display_name: str = "Alice", roles=None):
    await ledger.append(create_event(
        event_type=EventType.EMPLOYEE_CREATED,
        terminal_id="T-SMOKE",
        payload={
            "employee_id": employee_id,
            "display_name": display_name,
            "first_name": display_name.split()[0] if display_name else "",
            "last_name": "",
            "pin": pin,
            "role_ids": roles or ["server"],
            "active": True,
            "hourly_rate": "0",
        },
    ))


class TestSmokeSuite:

    @pytest.mark.smoke
    async def test_smoke_login(self, ledger, client):
        await _seed_employee(
            ledger,
            employee_id="smoke_emp_01",
            pin="1234",
            display_name="Smoke Server",
            roles=["server"],
        )
        resp = await client.post("/api/v1/auth/verify-pin", json={"pin": "1234"})
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("valid") is True
        assert "token" in data or "employee_id" in data

    @pytest.mark.smoke
    async def test_smoke_create_order(self, client):
        resp = await client.post("/api/v1/orders", json={
            "table": "T-1",
            "server_id": "srv-smoke-01",
            "server_name": "Smoke Server",
            "guest_count": 2,
        })
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert "order_id" in data
        assert data["status"] == "open"

    @pytest.mark.smoke
    async def test_smoke_add_and_send_items(self, client):
        resp = await client.post("/api/v1/orders", json={
            "server_id": "srv-smoke-02",
            "server_name": "Smoke Server",
        })
        assert resp.status_code in (200, 201)
        order_id = resp.json()["order_id"]

        for name, price in [("Burger", "10.00"), ("Fries", "5.00")]:
            r = await client.post(f"/api/v1/orders/{order_id}/items", json={
                "menu_item_id": f"menu_{name.lower()}",
                "name": name,
                "price": price,
                "quantity": 1,
            })
            assert r.status_code == 200

        resp = await client.post(f"/api/v1/orders/{order_id}/send")
        assert resp.status_code == 200

    @pytest.mark.smoke
    async def test_smoke_cash_payment(self, client):
        resp = await client.post("/api/v1/orders", json={
            "server_id": "srv-smoke-03",
            "server_name": "Smoke Server",
        })
        assert resp.status_code in (200, 201)
        order_id = resp.json()["order_id"]

        resp = await client.post(f"/api/v1/orders/{order_id}/items", json={
            "menu_item_id": "menu_steak",
            "name": "Steak",
            "price": "20.00",
            "quantity": 1,
        })
        assert resp.status_code == 200
        total = resp.json()["total"]

        resp = await client.post("/api/v1/payments/cash", json={
            "order_id": order_id,
            "amount": total,
        })
        assert resp.status_code == 200

        resp = await client.get(f"/api/v1/orders/{order_id}")
        assert resp.status_code == 200
        assert resp.json()["status"] in ("paid", "closed")

    @pytest.mark.smoke
    async def test_smoke_day_summary(self, client):
        resp = await client.get("/api/v1/orders/day-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "cash_total" in data
        assert "card_total" in data
