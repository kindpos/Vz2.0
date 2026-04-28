"""
Close-Day Extended Tests
========================
Covers the _do_close_day path that test_daily_workflow.py and
test_day_close_lock.py leave untested:

  - Empty-day close (zero orders)
  - Auto-voiding of unpaid open orders
  - Auto-closing of paid-but-open orders
  - Cash reconciliation: actual_cash_counted → over_short computed correctly
  - Day boundary: events emitted before DAY_CLOSED are included; events
    after the boundary are excluded from the next business day's view
"""

import os
import pytest
import pytest_asyncio
from decimal import Decimal
from pathlib import Path

from app.api.routes.orders import close_day, _do_close_day, CloseDayRequest
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    order_created,
    item_added,
    payment_initiated,
    payment_confirmed,
    order_closed,
)
from app.core.projections import project_order, project_orders
from app.core.money import money_round

TEST_DB = Path("./data/test_close_day_ext.db")
TERMINAL = "t_cd_ext"
TAX_RATE = Decimal(os.environ.get("KINDPOS_TAX_RATE", "0.07"))


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _l:
        yield _l
    if TEST_DB.exists():
        TEST_DB.unlink()


# ─── Helpers ────────────────────────────────────────────────────────────────

async def _make_order(ledger, order_id, item_price=Decimal("20.00"),
                      server_id="emp_01"):
    """Append ORDER_CREATED + ITEM_ADDED; return the projected order."""
    evt = order_created(
        terminal_id=TERMINAL,
        order_id=order_id,
        table="T1",
        server_id=server_id,
        server_name="Alice",
        order_type="dine_in",
        guest_count=2,
    )
    await ledger.append(evt.model_copy(update={"correlation_id": order_id}))
    evt = item_added(
        terminal_id=TERMINAL,
        order_id=order_id,
        item_id=f"item_{order_id}",
        menu_item_id="menu_001",
        name="Burger",
        price=item_price,
        quantity=1,
        category="food",
    )
    await ledger.append(evt.model_copy(update={"correlation_id": order_id}))
    events = await ledger.get_events_by_correlation(order_id)
    return project_order(events)


async def _pay_order(ledger, order_id, order):
    """Add PAYMENT_INITIATED + PAYMENT_CONFIRMED for the full balance."""
    pay_id = f"pay_{order_id}"
    amt = money_round(order.total)
    for factory, extra in [
        (payment_initiated, {"method": "cash"}),
        (payment_confirmed, {"transaction_id": f"txn_{order_id}"}),
    ]:
        evt = factory(
            terminal_id=TERMINAL,
            order_id=order_id,
            payment_id=pay_id,
            amount=amt,
            **extra,
        )
        await ledger.append(evt.model_copy(update={"correlation_id": order_id}))
    return pay_id


# ─── Tests ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_close_day_empty(ledger):
    """Closing with no orders emits DAY_CLOSED with zeroed totals."""
    resp = await _do_close_day(None, ledger)

    s = resp["summary"]
    assert s["total_orders"] == 0
    assert s["total_sales"] == Decimal("0.00")
    assert s["cash_total"] == Decimal("0.00")
    assert s["card_total"] == Decimal("0.00")

    day_close_events = await ledger.get_events_by_type(EventType.DAY_CLOSED)
    assert len(day_close_events) == 1
    payload = day_close_events[0].payload
    assert payload["total_orders"] == 0
    assert Decimal(str(payload["total_sales"])) == Decimal("0.00")


@pytest.mark.asyncio
async def test_close_day_auto_voids_unpaid_order(ledger):
    """An open order with no payments is auto-voided at close."""
    order = await _make_order(ledger, "ord_unpaid")
    assert order.status == "open"

    resp = await _do_close_day(None, ledger)

    voided = await ledger.get_events_by_type(EventType.ORDER_VOIDED)
    assert len(voided) == 1
    assert voided[0].payload["order_id"] == "ord_unpaid"
    assert "Auto-voided" in voided[0].payload.get("reason", "")

    # Voided order must NOT appear in total_sales, but IS counted in total_orders
    assert resp["summary"]["total_sales"] == Decimal("0.00")
    assert resp["summary"]["total_orders"] == 1  # all orders regardless of status


@pytest.mark.asyncio
async def test_close_day_auto_closes_paid_open_order(ledger):
    """A fully paid but not explicitly closed order is closed at day-end."""
    order = await _make_order(ledger, "ord_paid_open")
    await _pay_order(ledger, "ord_paid_open", order)

    events = await ledger.get_events_by_correlation("ord_paid_open")
    order = project_order(events)
    assert order.status == "paid"       # paid but not closed
    assert order.is_fully_paid

    resp = await _do_close_day(None, ledger)

    # ORDER_CLOSED should have been emitted by close_day
    closed_events = await ledger.get_events_by_type(EventType.ORDER_CLOSED)
    assert any(e.payload.get("order_id") == "ord_paid_open" for e in closed_events)

    assert resp["summary"]["orders_closed_now"] >= 1
    assert resp["summary"]["total_sales"] > Decimal("0.00")


@pytest.mark.asyncio
async def test_close_day_only_counts_paid_orders_in_sales(ledger):
    """Total sales include paid orders and exclude voided ones."""
    order_a = await _make_order(ledger, "ord_a", item_price=Decimal("30.00"))
    order_b = await _make_order(ledger, "ord_b", item_price=Decimal("50.00"))

    # Pay order_a in full; leave order_b unpaid (will be auto-voided)
    await _pay_order(ledger, "ord_a", order_a)

    resp = await _do_close_day(None, ledger)

    expected_sales = money_round(order_a.total)
    assert resp["summary"]["total_sales"] == expected_sales
    assert resp["summary"]["total_orders"] == 2  # both orders in the day
    assert resp["summary"]["payment_count"] == 1  # only one was actually paid


@pytest.mark.asyncio
async def test_close_day_cash_counted_exact_match(ledger):
    """actual_cash_counted == cash_expected → over_short is zero."""
    order = await _make_order(ledger, "ord_exact", item_price=Decimal("40.00"))
    await _pay_order(ledger, "ord_exact", order)

    events = await ledger.get_events_by_correlation("ord_exact")
    order = project_order(events)
    cash_expected = money_round(order.total)  # no card tips so expected == cash total

    req = CloseDayRequest(actual_cash_counted=cash_expected)
    resp = await _do_close_day(req, ledger)

    assert resp["summary"]["over_short"] == Decimal("0.00")
    assert resp["summary"]["actual_cash_counted"] == cash_expected


@pytest.mark.asyncio
async def test_close_day_cash_over(ledger):
    """actual_cash_counted > cash_expected → positive over_short."""
    order = await _make_order(ledger, "ord_over", item_price=Decimal("40.00"))
    await _pay_order(ledger, "ord_over", order)

    events = await ledger.get_events_by_correlation("ord_over")
    order = project_order(events)
    cash_expected = money_round(order.total)
    actual = money_round(cash_expected + Decimal("5.00"))

    req = CloseDayRequest(actual_cash_counted=actual)
    resp = await _do_close_day(req, ledger)

    assert resp["summary"]["over_short"] == Decimal("5.00")


@pytest.mark.asyncio
async def test_close_day_cash_short(ledger):
    """actual_cash_counted < cash_expected → negative over_short."""
    order = await _make_order(ledger, "ord_short", item_price=Decimal("40.00"))
    await _pay_order(ledger, "ord_short", order)

    events = await ledger.get_events_by_correlation("ord_short")
    order = project_order(events)
    cash_expected = money_round(order.total)
    actual = money_round(cash_expected - Decimal("3.00"))

    req = CloseDayRequest(actual_cash_counted=actual)
    resp = await _do_close_day(req, ledger)

    assert resp["summary"]["over_short"] == Decimal("-3.00")


@pytest.mark.asyncio
async def test_close_day_boundary_excludes_next_day_events(ledger):
    """Orders created after DAY_CLOSED do not appear in the next close summary."""
    # Day 1: one paid order, then close
    order_d1 = await _make_order(ledger, "ord_d1", item_price=Decimal("25.00"))
    await _pay_order(ledger, "ord_d1", order_d1)
    resp1 = await _do_close_day(None, ledger)
    assert resp1["summary"]["total_orders"] == 1

    # Day 2: new order created after the DAY_CLOSED boundary
    order_d2 = await _make_order(ledger, "ord_d2", item_price=Decimal("35.00"))
    await _pay_order(ledger, "ord_d2", order_d2)

    # Close day 2 — should only see ord_d2
    resp2 = await _do_close_day(None, ledger)
    assert resp2["summary"]["total_orders"] == 1
    assert resp2["summary"]["total_sales"] == money_round(
        project_order(await ledger.get_events_by_correlation("ord_d2")).total
    )


@pytest.mark.asyncio
async def test_close_day_emits_batch_submitted_and_day_closed(ledger):
    """Closing always emits BATCH_SUBMITTED and DAY_CLOSED atomically."""
    order = await _make_order(ledger, "ord_batch", item_price=Decimal("20.00"))
    await _pay_order(ledger, "ord_batch", order)

    await _do_close_day(None, ledger)

    batch_events = await ledger.get_events_by_type(EventType.BATCH_SUBMITTED)
    day_events = await ledger.get_events_by_type(EventType.DAY_CLOSED)
    assert len(batch_events) == 1
    assert len(day_events) == 1
    # BATCH_SUBMITTED must be sequenced before DAY_CLOSED
    assert batch_events[0].sequence_number < day_events[0].sequence_number
