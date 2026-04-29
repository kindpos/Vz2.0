"""
Server Shift Route Extended Tests
===================================
Covers the three read endpoints that have zero test coverage:
  - GET /server/shift/sales-by-category
  - GET /server/shift/table-stats
  - GET /server/shift/checkout-status

Also verifies the 501 on the tip-out patch endpoint.
"""

import pytest
import pytest_asyncio
from decimal import Decimal
from pathlib import Path

from app.api.routes.server_shift import (
    sales_by_category,
    table_stats,
    checkout_status,
    patch_tipout,
    TipOutRequest,
)
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    order_created,
    item_added,
    order_voided,
    payment_initiated,
    payment_confirmed,
    order_closed,
    tip_adjusted,
)
from app.core.projections import project_order
from app.core.money import money_round
from fastapi import HTTPException

TEST_DB = Path("./data/test_server_shift_ext.db")
TERMINAL = "t_shift_ext"
SERVER_A = "srv_alice"
SERVER_B = "srv_bob"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _l:
        yield _l
    if TEST_DB.exists():
        TEST_DB.unlink()


# ─── Helpers ────────────────────────────────────────────────────────────────

async def _make_order(ledger, order_id, server_id=SERVER_A, guest_count=2,
                      items=None):
    """Create an order and add items. items = [(name, price, category), ...]"""
    if items is None:
        items = [("Burger", Decimal("20.00"), "food")]

    evt = order_created(
        terminal_id=TERMINAL,
        order_id=order_id,
        table=f"T_{order_id[-2:]}",
        server_id=server_id,
        server_name=server_id,
        order_type="dine_in",
        guest_count=guest_count,
    )
    await ledger.append(evt.model_copy(update={"correlation_id": order_id}))

    for i, (name, price, category) in enumerate(items):
        evt = item_added(
            terminal_id=TERMINAL,
            order_id=order_id,
            item_id=f"item_{order_id}_{i}",
            menu_item_id=f"menu_{i}",
            name=name,
            price=price,
            quantity=1,
            category=category,
        )
        await ledger.append(evt.model_copy(update={"correlation_id": order_id}))

    events = await ledger.get_events_by_correlation(order_id)
    return project_order(events)


async def _pay_cash(ledger, order_id, order, pay_id=None):
    pay_id = pay_id or f"pay_cash_{order_id}"
    amt = order.total
    for factory, extra in [
        (payment_initiated, {"method": "cash"}),
        (payment_confirmed, {"transaction_id": f"txn_c_{order_id}"}),
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


async def _pay_card(ledger, order_id, order, pay_id=None):
    pay_id = pay_id or f"pay_card_{order_id}"
    amt = order.total
    for factory, extra in [
        (payment_initiated, {"method": "card"}),
        (payment_confirmed, {"transaction_id": f"txn_k_{order_id}"}),
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


async def _close(ledger, order_id):
    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)
    evt = order_closed(
        terminal_id=TERMINAL, order_id=order_id, total=order.total,
    )
    await ledger.append(evt.model_copy(update={"correlation_id": order_id}))


# ─── sales_by_category ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sales_by_category_empty(ledger):
    """No orders → empty list returned."""
    result = await sales_by_category(server_id=SERVER_A, ledger=ledger)
    assert result == []
    # Confirm the endpoint is live: adding an order must produce a non-empty list.
    order = await _make_order(ledger, "ord_cat_probe", server_id=SERVER_A,
                              items=[("Probe", Decimal("5.00"), "food")])
    await _pay_cash(ledger, "ord_cat_probe", order)
    await _close(ledger, "ord_cat_probe")
    assert await sales_by_category(server_id=SERVER_A, ledger=ledger) != []


@pytest.mark.asyncio
async def test_sales_by_category_single_category(ledger):
    """Cash-paid food order → food category appears with cash revenue."""
    order = await _make_order(ledger, "ord_cat1", server_id=SERVER_A,
                              items=[("Burger", Decimal("20.00"), "food")])
    await _pay_cash(ledger, "ord_cat1", order)
    await _close(ledger, "ord_cat1")

    result = await sales_by_category(server_id=SERVER_A, ledger=ledger)
    assert len(result) == 1
    assert result[0]["category"] == "FOOD"
    assert result[0]["cash"] == Decimal("20.00")
    assert result[0]["card"] == Decimal("0.00")


@pytest.mark.asyncio
async def test_sales_by_category_multiple_sorted_by_revenue(ledger):
    """Multiple categories are returned sorted by total revenue descending."""
    # food: $30, drinks: $10
    order = await _make_order(
        ledger, "ord_cat_multi", server_id=SERVER_A,
        items=[
            ("Steak", Decimal("30.00"), "food"),
            ("Soda", Decimal("10.00"), "drinks"),
        ],
    )
    await _pay_cash(ledger, "ord_cat_multi", order)
    await _close(ledger, "ord_cat_multi")

    result = await sales_by_category(server_id=SERVER_A, ledger=ledger)
    assert len(result) == 2
    # Food ($30) should come before drinks ($10)
    assert result[0]["category"] == "FOOD"
    assert result[1]["category"] == "DRINKS"
    assert result[0]["cash"] > result[1]["cash"]


@pytest.mark.asyncio
async def test_sales_by_category_excludes_other_servers(ledger):
    """Orders belonging to a different server are not included."""
    order_a = await _make_order(ledger, "ord_srv_a", server_id=SERVER_A,
                                items=[("Pasta", Decimal("18.00"), "food")])
    await _pay_cash(ledger, "ord_srv_a", order_a)
    await _close(ledger, "ord_srv_a")

    order_b = await _make_order(ledger, "ord_srv_b", server_id=SERVER_B,
                                items=[("Pizza", Decimal("22.00"), "food")])
    await _pay_cash(ledger, "ord_srv_b", order_b)
    await _close(ledger, "ord_srv_b")

    result_a = await sales_by_category(server_id=SERVER_A, ledger=ledger)
    result_b = await sales_by_category(server_id=SERVER_B, ledger=ledger)

    assert len(result_a) == 1
    assert result_a[0]["cash"] == Decimal("18.00")
    assert len(result_b) == 1
    assert result_b[0]["cash"] == Decimal("22.00")


@pytest.mark.asyncio
async def test_sales_by_category_card_payment_goes_to_card_column(ledger):
    """Card-paid order revenue appears in the card column, not cash."""
    order = await _make_order(ledger, "ord_card_cat", server_id=SERVER_A,
                              items=[("Wine", Decimal("15.00"), "drinks")])
    await _pay_card(ledger, "ord_card_cat", order)
    await _close(ledger, "ord_card_cat")

    result = await sales_by_category(server_id=SERVER_A, ledger=ledger)
    assert len(result) == 1
    assert result[0]["cash"] == Decimal("0.00")
    assert result[0]["card"] == Decimal("15.00")


# ─── table_stats ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_table_stats_empty(ledger):
    """No orders → all counters zero."""
    result = await table_stats(server_id=SERVER_A, ledger=ledger)
    assert result["guestCount"] == 0
    assert result["tableCount"] == 0
    assert result["checkAvg"] == Decimal("0.00")
    assert result["byPartySize"] == []
    # Confirm the endpoint is live: a closed order must raise guestCount above 0.
    order = await _make_order(ledger, "ord_tbl_probe", server_id=SERVER_A,
                              guest_count=2, items=[("X", Decimal("10.00"), "food")])
    await _pay_cash(ledger, "ord_tbl_probe", order)
    await _close(ledger, "ord_tbl_probe")
    assert (await table_stats(server_id=SERVER_A, ledger=ledger))["guestCount"] == 2


@pytest.mark.asyncio
async def test_table_stats_single_order(ledger):
    """Single closed order → correct guest count, table count, check avg."""
    order = await _make_order(ledger, "ord_tbl1", server_id=SERVER_A,
                              guest_count=3,
                              items=[("Salad", Decimal("12.00"), "food"),
                                     ("Pasta", Decimal("18.00"), "food")])
    await _pay_cash(ledger, "ord_tbl1", order)
    await _close(ledger, "ord_tbl1")

    result = await table_stats(server_id=SERVER_A, ledger=ledger)
    assert result["guestCount"] == 3
    assert result["tableCount"] == 1
    assert result["checkAvg"] == Decimal("30.00")  # subtotal only


@pytest.mark.asyncio
async def test_table_stats_party_size_bucketing(ledger):
    """Party sizes > 4 are bucketed into the 4+ group."""
    # Party of 6 → bucketed to 4
    order = await _make_order(ledger, "ord_tbl_big", server_id=SERVER_A,
                              guest_count=6,
                              items=[("Burger", Decimal("20.00"), "food")])
    await _pay_cash(ledger, "ord_tbl_big", order)
    await _close(ledger, "ord_tbl_big")

    result = await table_stats(server_id=SERVER_A, ledger=ledger)
    sizes = [b["size"] for b in result["byPartySize"]]
    assert 4 in sizes
    assert 6 not in sizes


@pytest.mark.asyncio
async def test_table_stats_excludes_voided_orders(ledger):
    """Voided orders do not contribute to table stats.

    Also adds a live closed order so the assertion distinguishes an
    implementation that correctly excludes voids from one that returns
    all-zeros for any input.
    """
    # Live order: 3 guests, $20 item — should appear in stats
    live = await _make_order(ledger, "ord_tbl_live", server_id=SERVER_A,
                             guest_count=3,
                             items=[("Burger", Decimal("20.00"), "food")])
    await _pay_cash(ledger, "ord_tbl_live", live)
    await _close(ledger, "ord_tbl_live")

    # Voided order: 10 guests, $500 item — must NOT appear in stats
    voided = await _make_order(ledger, "ord_tbl_void", server_id=SERVER_A,
                               guest_count=10,
                               items=[("BigItem", Decimal("500.00"), "food")])
    evt = order_voided(
        terminal_id=TERMINAL, order_id="ord_tbl_void", reason="test void"
    )
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_tbl_void"}))

    result = await table_stats(server_id=SERVER_A, ledger=ledger)
    assert result["guestCount"] == 3      # voided 10-guest order excluded
    assert result["tableCount"] == 1      # only the live order counts
    assert result["checkAvg"] == Decimal("20.00")


# ─── checkout_status ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_checkout_status_no_orders(ledger):
    """No orders → open_checks=0, unadjusted_tips=0."""
    result = await checkout_status(server_id=SERVER_A, ledger=ledger)
    assert result["openChecks"] == 0
    assert result["unadjustedTips"] == 0
    # Confirm the endpoint is live: an open order must increment openChecks.
    await _make_order(ledger, "ord_chk_probe", server_id=SERVER_A,
                      items=[("Y", Decimal("8.00"), "drinks")])
    assert (await checkout_status(server_id=SERVER_A, ledger=ledger))["openChecks"] == 1


@pytest.mark.asyncio
async def test_checkout_status_open_check_counted(ledger):
    """An open order with items is counted as an open check."""
    await _make_order(ledger, "ord_open_chk", server_id=SERVER_A,
                      items=[("Beer", Decimal("8.00"), "drinks")])
    result = await checkout_status(server_id=SERVER_A, ledger=ledger)
    assert result["openChecks"] == 1


@pytest.mark.asyncio
async def test_checkout_status_card_without_tip_is_unadjusted(ledger):
    """A closed card payment with no TIP_ADJUSTED event counts as unadjusted."""
    order = await _make_order(ledger, "ord_notip", server_id=SERVER_A,
                              items=[("Steak", Decimal("45.00"), "food")])
    await _pay_card(ledger, "ord_notip", order)
    await _close(ledger, "ord_notip")

    result = await checkout_status(server_id=SERVER_A, ledger=ledger)
    assert result["unadjustedTips"] == 1
    assert result["openChecks"] == 0


@pytest.mark.asyncio
async def test_checkout_status_adjusted_tip_not_counted(ledger):
    """A card payment with a TIP_ADJUSTED event is NOT counted as unadjusted."""
    order = await _make_order(ledger, "ord_tipped", server_id=SERVER_A,
                              items=[("Pasta", Decimal("22.00"), "food")])
    pay_id = await _pay_card(ledger, "ord_tipped", order)
    await _close(ledger, "ord_tipped")

    tip_evt = tip_adjusted(
        terminal_id=TERMINAL,
        order_id="ord_tipped",
        payment_id=pay_id,
        tip_amount=Decimal("5.00"),
    )
    await ledger.append(tip_evt.model_copy(update={"correlation_id": "ord_tipped"}))

    result = await checkout_status(server_id=SERVER_A, ledger=ledger)
    assert result["unadjustedTips"] == 0


@pytest.mark.asyncio
async def test_checkout_status_cash_payment_never_unadjusted(ledger):
    """Cash payments are never counted as needing tip adjustment."""
    order = await _make_order(ledger, "ord_cash_tip", server_id=SERVER_A,
                              items=[("Burger", Decimal("15.00"), "food")])
    await _pay_cash(ledger, "ord_cash_tip", order)
    await _close(ledger, "ord_cash_tip")

    result = await checkout_status(server_id=SERVER_A, ledger=ledger)
    assert result["unadjustedTips"] == 0


@pytest.mark.asyncio
async def test_checkout_status_excludes_other_servers(ledger):
    """Open checks and unadjusted tips from other servers are not included."""
    # Server B has an open check and an unadjusted tip
    order_b = await _make_order(ledger, "ord_b_open", server_id=SERVER_B,
                                items=[("Item", Decimal("10.00"), "food")])
    order_b2 = await _make_order(ledger, "ord_b_tip", server_id=SERVER_B,
                                 items=[("Item", Decimal("20.00"), "food")])
    await _pay_card(ledger, "ord_b_tip", order_b2)
    await _close(ledger, "ord_b_tip")

    # Server A has no activity
    result_a = await checkout_status(server_id=SERVER_A, ledger=ledger)
    assert result_a["openChecks"] == 0
    assert result_a["unadjustedTips"] == 0


# ─── tipout 501 ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tipout_returns_501(ledger):
    """PATCH /tipout is not yet implemented — must return 501."""
    req = TipOutRequest(amount=Decimal("5.00"))
    with pytest.raises(HTTPException) as exc:
        await patch_tipout(req, server_id=SERVER_A, ledger=ledger)
    assert exc.value.status_code == 501
