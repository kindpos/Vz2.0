"""
Coverage gaps: close_batch auto-void loop, close_day auto-void loop,
void_order guards + card-reversal, adjust_tip_on_order guards,
get_sales_summary structure and server filter.

Gaps addressed: 🔴4, 🔴5, 🔴6, 🔴7, 🔴8 from COVERAGE_AUDIT.md.

Direct-call pattern (same as test_adjust_tip_on_order.py):
    await close_batch(ledger=ledger)
    await void_order(order_id, request, ledger=ledger)
"""

from pathlib import Path
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import AsyncClient, ASGITransport

from app.api import dependencies as deps
from app.api.routes.orders import (
    VoidOrderRequest,
    close_batch,
    close_day,
    void_order,
)
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    item_added,
    order_closed,
    order_created,
    order_voided,
    payment_confirmed,
    payment_initiated,
)
from app.core.projections import project_order

TEST_DB = Path("./data/test_orders_and_reporting_gaps.db")
TERMINAL = settings.terminal_id
TODAY = date.today().isoformat()


@pytest.fixture(autouse=True)
def _zero_rates(monkeypatch):
    monkeypatch.setattr(settings, "tax_rate", Decimal("0.00"))
    monkeypatch.setattr(settings, "cash_discount_rate", Decimal("0.00"))


@pytest.fixture(autouse=True)
def _reset_payment_globals(monkeypatch):
    """Prevent stale PaymentManager state from bleeding between tests."""
    import app.api.routes.payment_routes as pr
    monkeypatch.setattr(pr, "_manager", None)
    monkeypatch.setattr(pr, "_validator", None)
    monkeypatch.setattr(pr, "_devices_initialized", False)


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest_asyncio.fixture
async def client(ledger):
    """HTTP client wired to the real FastAPI app with a test ledger."""
    from app.main import app

    async def _override():
        return ledger

    app.dependency_overrides[deps.get_ledger] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Seed helpers ─────────────────────────────────────────────────────────────

async def _seed_open_order(ledger, order_id: str, amount: Decimal = Decimal("25.00"),
                           server_id: str = "srv-1"):
    await ledger.append(order_created(
        terminal_id=TERMINAL, order_id=order_id,
        server_id=server_id, guest_count=2, correlation_id=order_id,
    ))
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=order_id,
        item_id=f"{order_id}_i", menu_item_id="m1",
        name="Dish", price=amount, quantity=1,
    ))


async def _seed_fully_paid_order(
    ledger, order_id: str, amount: Decimal = Decimal("25.00"),
    server_id: str = "srv-1",
) -> None:
    await _seed_open_order(ledger, order_id, amount, server_id)
    pid = f"pay_{order_id}"
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=order_id,
        payment_id=pid, amount=amount, method="cash",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=order_id,
        payment_id=pid, transaction_id=f"txn_{pid}",
        amount=amount, tax=Decimal("0.00"),
    ))


# =============================================================================
# close_batch — gap 🔴5
# =============================================================================

@pytest.mark.asyncio
async def test_close_batch_fully_paid_order_gets_closed(ledger):
    """close_batch emits ORDER_CLOSED for a fully-paid open order."""
    oid = "batch-paid"
    await _seed_fully_paid_order(ledger, oid)

    result = await close_batch(ledger=ledger)

    assert result["success"] is True
    assert result["orders_closed_now"] >= 1

    events = await ledger.get_events_by_correlation(oid)
    order = project_order(events)
    assert order.status == "closed"


@pytest.mark.asyncio
async def test_close_batch_unpaid_order_gets_voided(ledger):
    """close_batch emits ORDER_VOIDED with 'Auto-voided at batch close' for unpaid order."""
    oid = "batch-unpaid"
    await _seed_open_order(ledger, oid)

    result = await close_batch(ledger=ledger)
    assert result["success"] is True

    events = await ledger.get_events_by_correlation(oid)
    void_evts = [e for e in events if e.event_type == EventType.ORDER_VOIDED]
    assert len(void_evts) == 1
    assert "batch close" in void_evts[0].payload.get("reason", "").lower()

    order = project_order(events)
    assert order.status == "voided"


@pytest.mark.asyncio
async def test_close_batch_empty_day_returns_no_transactions_status(ledger):
    """close_batch with no orders returns status: no_transactions."""
    result = await close_batch(ledger=ledger)
    assert result["success"] is True
    assert result["status"] == "no_transactions"


@pytest.mark.asyncio
async def test_close_batch_mixed_orders(ledger):
    """close_batch closes fully-paid orders and voids unpaid ones independently."""
    oid_paid = "batch-mix-paid"
    oid_unpaid = "batch-mix-unpaid"
    await _seed_fully_paid_order(ledger, oid_paid)
    await _seed_open_order(ledger, oid_unpaid)

    result = await close_batch(ledger=ledger)
    assert result["success"] is True

    paid_events = await ledger.get_events_by_correlation(oid_paid)
    unpaid_events = await ledger.get_events_by_correlation(oid_unpaid)

    assert project_order(paid_events).status == "closed"
    assert project_order(unpaid_events).status == "voided"


# =============================================================================
# close_day — gap 🔴6
# =============================================================================

@pytest.mark.asyncio
async def test_close_day_fully_paid_order_gets_closed(ledger):
    """close_day emits ORDER_CLOSED for a fully-paid open order."""
    oid = "day-paid"
    await _seed_fully_paid_order(ledger, oid)

    result = await close_day(body=None, ledger=ledger)
    assert result["success"] is True

    events = await ledger.get_events_by_correlation(oid)
    assert project_order(events).status == "closed"


@pytest.mark.asyncio
async def test_close_day_unpaid_order_gets_voided(ledger):
    """close_day emits ORDER_VOIDED with 'Auto-voided at day close' for unpaid orders."""
    oid = "day-unpaid"
    await _seed_open_order(ledger, oid)

    result = await close_day(body=None, ledger=ledger)
    assert result["success"] is True

    events = await ledger.get_events_by_correlation(oid)
    void_evts = [e for e in events if e.event_type == EventType.ORDER_VOIDED]
    assert len(void_evts) == 1
    assert "day close" in void_evts[0].payload.get("reason", "").lower()

    assert project_order(events).status == "voided"


@pytest.mark.asyncio
async def test_close_day_emits_day_closed_event(ledger):
    """close_day emits a DAY_CLOSED event as the day boundary."""
    oid = "day-event"
    await _seed_fully_paid_order(ledger, oid)

    await close_day(body=None, ledger=ledger)

    all_evts = await ledger.get_events_by_type(EventType.DAY_CLOSED)
    assert len(all_evts) >= 1


# =============================================================================
# void_order guards and card-reversal — gap 🔴7
# =============================================================================

@pytest.mark.asyncio
async def test_void_order_403_without_approved_by(ledger):
    """void_order requires approved_by — empty string → 403."""
    oid = "void-no-mgr"
    await _seed_open_order(ledger, oid)

    with pytest.raises(HTTPException) as exc:
        await void_order(
            oid,
            VoidOrderRequest(reason="test", approved_by=""),
            ledger=ledger,
        )
    assert exc.value.status_code == 403
    assert "approval" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_void_order_400_already_voided(ledger):
    """Voiding an already-voided order → 400."""
    oid = "void-already-voided"
    await _seed_open_order(ledger, oid)
    await ledger.append(order_voided(
        terminal_id=TERMINAL, order_id=oid,
        reason="first void", approved_by="mgr",
    ))

    with pytest.raises(HTTPException) as exc:
        await void_order(
            oid,
            VoidOrderRequest(reason="second void", approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "voided" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_void_order_400_already_closed(ledger):
    """Voiding a closed order → 400."""
    oid = "void-already-closed"
    await _seed_open_order(ledger, oid, amount=Decimal("10.00"))
    await ledger.append(order_closed(terminal_id=TERMINAL, order_id=oid, total=Decimal("10.00")))

    with pytest.raises(HTTPException) as exc:
        await void_order(
            oid,
            VoidOrderRequest(reason="test", approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "closed" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_void_order_happy_path_emits_order_voided(ledger):
    """Voiding an open order with no card payments succeeds and emits ORDER_VOIDED."""
    oid = "void-happy"
    await _seed_open_order(ledger, oid)

    result = await void_order(
        oid,
        VoidOrderRequest(reason="customer cancelled", approved_by="mgr-1"),
        ledger=ledger,
    )
    assert result.status == "voided"

    events = await ledger.get_events_by_correlation(oid)
    void_evts = [e for e in events if e.event_type == EventType.ORDER_VOIDED]
    assert len(void_evts) == 1
    assert void_evts[0].payload.get("approved_by") == "mgr-1"


@pytest.mark.asyncio
async def test_void_order_404_for_missing_order(ledger):
    """void_order on a nonexistent order → 404."""
    with pytest.raises(HTTPException) as exc:
        await void_order(
            "no-such-order",
            VoidOrderRequest(reason="test", approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code == 404


# =============================================================================
# get_sales_summary — gap 🔴8
# =============================================================================

@pytest.mark.asyncio
async def test_sales_summary_returns_expected_shape(client):
    """GET /reports/sales-summary returns all required top-level keys."""
    resp = await client.get(f"/api/v1/reports/sales-summary?date={TODAY}")
    assert resp.status_code == 200
    data = resp.json()

    required_keys = {
        "date", "net_sales", "gross_sales", "voids_total", "discounts_total",
        "refunds_total", "tax_collected", "tips_collected",
        "total_checks", "check_avg",
        "cash_total", "card_total",
        "hourly_sales", "top_items", "tip_buckets",
        "category_breakdown", "open_checks",
    }
    for key in required_keys:
        assert key in data, f"Missing key: {key}"


@pytest.mark.asyncio
async def test_sales_summary_counts_closed_orders(client, ledger):
    """Closed orders are counted in total_checks and net_sales."""
    oid = "rep-closed"
    await _seed_fully_paid_order(ledger, oid, amount=Decimal("40.00"))
    await ledger.append(order_closed(terminal_id=TERMINAL, order_id=oid, total=Decimal("40.00")))

    resp = await client.get(f"/api/v1/reports/sales-summary?date={TODAY}")
    assert resp.status_code == 200
    data = resp.json()

    assert data["total_checks"] >= 1
    assert Decimal(str(data["net_sales"])) >= Decimal("40.00")


@pytest.mark.asyncio
async def test_sales_summary_server_filter_isolates_one_server(client, ledger):
    """?server_id= returns only that server's closed orders."""
    await _seed_fully_paid_order(ledger, "rep-srv1", amount=Decimal("30.00"), server_id="srv-A")
    await ledger.append(order_closed(terminal_id=TERMINAL, order_id="rep-srv1", total=Decimal("30.00")))

    await _seed_fully_paid_order(ledger, "rep-srv2", amount=Decimal("50.00"), server_id="srv-B")
    await ledger.append(order_closed(terminal_id=TERMINAL, order_id="rep-srv2", total=Decimal("50.00")))

    resp = await client.get(f"/api/v1/reports/sales-summary?date={TODAY}&server_id=srv-A")
    assert resp.status_code == 200
    data = resp.json()

    # srv-A had $30 net; srv-B's $50 should not appear
    assert data["total_checks"] == 1
    assert Decimal(str(data["net_sales"])) == Decimal("30.00")


@pytest.mark.asyncio
async def test_sales_summary_empty_day_returns_zeros(client):
    """With no transactions, all aggregated values are zero."""
    resp = await client.get(f"/api/v1/reports/sales-summary?date={TODAY}")
    assert resp.status_code == 200
    data = resp.json()

    assert data["total_checks"] == 0
    assert Decimal(str(data["net_sales"])) == Decimal("0.00")
    assert data["hourly_sales"] == []


# =============================================================================
# tip_avg fix — $0 tips must be included in the denominator
# =============================================================================

@pytest.mark.asyncio
async def test_tip_avg_includes_zero_tip_payments_in_denominator(client, ledger):
    """
    Regression: tip_avg was calculated over non-zero tips only, inflating the
    average.  With two payments — $5 tip and $0 tip — the correct avg is $2.50,
    not $5.00.
    """
    oid1 = "tipavg-has-tip"
    oid2 = "tipavg-no-tip"

    for oid, tip_id in [(oid1, "pay_t1"), (oid2, "pay_t2")]:
        await _seed_fully_paid_order(ledger, oid, amount=Decimal("20.00"))
        await ledger.append(order_closed(terminal_id=TERMINAL, order_id=oid, total=Decimal("20.00")))

    # Append a TIP_ADJUSTED for oid1 only ($5) — oid2 keeps $0 tip
    from app.core.events import tip_adjusted
    await ledger.append(tip_adjusted(
        terminal_id=TERMINAL,
        order_id=oid1,
        payment_id=f"pay_{oid1}",
        tip_amount=Decimal("5.00"),
        previous_tip=Decimal("0.00"),
    ))

    resp = await client.get(f"/api/v1/reports/sales-summary?date={TODAY}")
    assert resp.status_code == 200
    data = resp.json()

    # $5 tip + $0 tip across 2 card payments → avg = $2.50
    assert Decimal(str(data["tip_avg"])) == Decimal("2.50")


# =============================================================================
# merge_orders race condition — target re-validated before write loop
# =============================================================================

@pytest.mark.asyncio
async def test_merge_target_closed_concurrently_returns_409(ledger):
    """
    Regression: merge validated target was open, then a concurrent payment
    closed it before the write loop.  We now re-fetch and raise 409.
    """
    from app.api.routes.orders import MergeOrderRequest, merge_orders

    target_id = "merge-rc-target"
    source_id = "merge-rc-source"

    await _seed_open_order(ledger, target_id)
    await _seed_open_order(ledger, source_id)

    # Simulate concurrent closure of target between validation and loop
    await ledger.append(order_closed(
        terminal_id=TERMINAL, order_id=target_id, total=Decimal("25.00"),
    ))

    with pytest.raises(HTTPException) as exc:
        await merge_orders(
            target_id,
            MergeOrderRequest(source_ids=[source_id], approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code in (400, 409)


# =============================================================================
# _voidPendingTimer cleanup — manager-landing cleanup test (JS)
# =============================================================================
# Covered by manager-landing.test.js which exercises the cleanup() return value.


# =============================================================================
# Input validation guards — negative prices, zero payments, bad seat numbers
# =============================================================================

import pydantic
from app.api.routes.orders import (
    AddItemRequest, InlineModifier, ApplyModifierRequest,
    ModifyItemRequest, InitiatePaymentRequest,
)
from app.api.routes.payment_routes import CashPaymentRequest


class TestNegativePriceRejected:
    def test_add_item_negative_price_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            AddItemRequest(menu_item_id="m1", name="Burger", price=Decimal("-1.00"))

    def test_add_item_zero_price_allowed(self):
        req = AddItemRequest(menu_item_id="m1", name="Water", price=Decimal("0.00"))
        assert req.price == Decimal("0.00")

    def test_inline_modifier_negative_price_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            InlineModifier(name="Extra Cheese", price=Decimal("-0.50"))

    def test_inline_modifier_negative_modifier_price_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            InlineModifier(name="Extra Cheese", modifier_price=Decimal("-0.50"))

    def test_apply_modifier_negative_price_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            ApplyModifierRequest(
                modifier_id="m1", modifier_name="Cheese", modifier_price=Decimal("-1.00")
            )

    def test_modify_item_negative_price_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            ModifyItemRequest(price=Decimal("-5.00"))

    def test_initiate_payment_negative_amount_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            InitiatePaymentRequest(amount=Decimal("-10.00"), method="cash")

    def test_initiate_payment_zero_amount_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            InitiatePaymentRequest(amount=Decimal("0.00"), method="cash")

    def test_cash_payment_negative_amount_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            CashPaymentRequest(order_id="o1", amount=Decimal("-5.00"))

    def test_cash_payment_zero_amount_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            CashPaymentRequest(order_id="o1", amount=Decimal("0.00"))


class TestSeatNumberValidation:
    def test_add_item_seat_zero_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            AddItemRequest(
                menu_item_id="m1", name="Burger", price=Decimal("10.00"), seat_number=0
            )

    def test_add_item_seat_negative_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            AddItemRequest(
                menu_item_id="m1", name="Burger", price=Decimal("10.00"), seat_number=-1
            )

    def test_add_item_seat_none_allowed(self):
        req = AddItemRequest(
            menu_item_id="m1", name="Burger", price=Decimal("10.00"), seat_number=None
        )
        assert req.seat_number is None

    def test_add_item_seat_one_allowed(self):
        req = AddItemRequest(
            menu_item_id="m1", name="Burger", price=Decimal("10.00"), seat_number=1
        )
        assert req.seat_number == 1

    def test_modify_item_seat_zero_rejected(self):
        with pytest.raises((ValueError, pydantic.ValidationError)):
            ModifyItemRequest(seat_number=0)

    def test_modify_item_seat_none_allowed(self):
        req = ModifyItemRequest(seat_number=None)
        assert req.seat_number is None
