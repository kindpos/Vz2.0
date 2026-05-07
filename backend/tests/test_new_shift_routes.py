import pytest
import pytest_asyncio
from decimal import Decimal
from pathlib import Path

from app.api.routes.server_shift import (
    FinalizeCheckoutRequest,
    ShiftTransferRequest,
    finalize_checkout,
    transfer_shift_order,
)
from app.core.event_ledger import EventLedger
from app.core.events import EventType

TEST_DB = Path("./data/test_new_shift.db")

@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()

@pytest.mark.asyncio
async def test_finalize_checkout_route(ledger):
    req = FinalizeCheckoutRequest(
        employee_id="emp_01",
        take_home=Decimal("10.50"),
        cash_expected=Decimal("50.00"),
        manager_pin_verified=True
    )
    resp = await finalize_checkout(req, ledger)
    assert resp["success"] is True
    assert "event_seq" in resp
    assert resp["event_seq"] is not None
    assert "checkout" in resp
    assert "total_tips" in resp["checkout"]
    assert "cash_tips" in resp["checkout"]
    assert "card_tips" in resp["checkout"]
    assert "tipout_amount" in resp["checkout"]

    # Verify CHECKOUT_FINALIZED event was emitted
    events = await ledger.get_events_since(0)
    assert len(events) >= 1
    checkout_events = [e for e in events if e.event_type == EventType.CHECKOUT_FINALIZED]
    assert len(checkout_events) == 1
    assert checkout_events[0].payload["server_id"] == "emp_01"

@pytest.mark.asyncio
async def test_transfer_route(ledger):
    req = ShiftTransferRequest(
        order_id="order_123",
        to_server_id="emp_02",
        from_server_id="emp_01"
    )
    resp = await transfer_shift_order(req, ledger)
    assert resp == {"success": True}
    
    # Verify event was appended
    events = await ledger.get_events_since(0)
    assert len(events) == 1
    assert events[0].event_type == EventType.ORDER_TRANSFERRED
    assert events[0].payload["order_id"] == "order_123"
    assert events[0].payload["server_id"] == "emp_02"
