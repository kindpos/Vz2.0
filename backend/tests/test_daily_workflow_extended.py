"""
Daily Workflow Extended Tests
==============================
Error injection and edge-case state validation for the event-sourced
order lifecycle. test_daily_workflow.py covers only the happy path.

Scenarios added here:
  - Split payment: two PAYMENT_CONFIRMED events sum to full balance
  - Partial payment: balance_due reflects the unpaid remainder
  - Double-close idempotency: second ORDER_CLOSED does not corrupt state
  - ORDER_VOIDED after full payment: status becomes "voided"
  - ORDER_REOPENED on a paid order reverts status to "open"
  - ITEM_REMOVED reduces subtotal and total correctly
  - Multiple independent orders share no state (project_orders isolation)
  - Zero-item order has empty subtotal
"""

import os
import pytest
import pytest_asyncio
from decimal import Decimal
from pathlib import Path

from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    order_created,
    item_added,
    item_removed,
    payment_initiated,
    payment_confirmed,
    order_closed,
    order_reopened,
    order_voided,
)
from app.core.projections import project_order, project_orders
from app.core.money import money_round

TEST_DB = Path("./data/test_daily_wf_ext.db")
TERMINAL = "t_wf_ext"
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

async def _create_order(ledger, order_id, table="T1", server_id="emp_01",
                        guest_count=2):
    evt = order_created(
        terminal_id=TERMINAL, order_id=order_id, table=table,
        server_id=server_id, server_name="Alice", order_type="dine_in",
        guest_count=guest_count,
    )
    await ledger.append(evt.model_copy(update={"correlation_id": order_id}))


async def _add_item(ledger, order_id, item_id, price=Decimal("20.00"),
                    name="Burger", category="food"):
    evt = item_added(
        terminal_id=TERMINAL, order_id=order_id, item_id=item_id,
        menu_item_id="menu_001", name=name, price=price,
        quantity=1, category=category,
    )
    await ledger.append(evt.model_copy(update={"correlation_id": order_id}))


async def _pay(ledger, order_id, pay_id, amount, method="cash"):
    for factory, extra in [
        (payment_initiated, {"method": method}),
        (payment_confirmed, {"transaction_id": f"txn_{pay_id}"}),
    ]:
        evt = factory(
            terminal_id=TERMINAL, order_id=order_id,
            payment_id=pay_id, amount=amount, **extra,
        )
        await ledger.append(evt.model_copy(update={"correlation_id": order_id}))


async def _get_order(ledger, order_id):
    events = await ledger.get_events_by_correlation(order_id)
    return project_order(events)


# ─── Split payment ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_split_payment_two_halves_clears_balance(ledger):
    """Two cash payments each covering half the total → fully paid."""
    await _create_order(ledger, "ord_split")
    await _add_item(ledger, "ord_split", "item_s1", price=Decimal("20.00"))

    order = await _get_order(ledger, "ord_split")
    total = order.total
    half = money_round(total / 2)
    # Ensure we cover the full total (rounding may leave a cent gap)
    second_half = money_round(total - half)

    await _pay(ledger, "ord_split", "pay_a", half)
    await _pay(ledger, "ord_split", "pay_b", second_half)

    order = await _get_order(ledger, "ord_split")
    assert order.is_fully_paid
    assert order.balance_due == Decimal("0.00")
    assert order.status in ("paid", "closed")


@pytest.mark.asyncio
async def test_split_payment_each_payment_tracked_separately(ledger):
    """Each payment in a split is visible in the order's payment list."""
    await _create_order(ledger, "ord_split2")
    await _add_item(ledger, "ord_split2", "item_ss", price=Decimal("40.00"))

    order = await _get_order(ledger, "ord_split2")
    total = order.total
    first = money_round(total * Decimal("0.6"))
    second = money_round(total - first)

    await _pay(ledger, "ord_split2", "pay_x1", first, method="cash")
    await _pay(ledger, "ord_split2", "pay_x2", second, method="card")

    order = await _get_order(ledger, "ord_split2")
    payment_ids = {p.payment_id for p in order.payments if p.status == "confirmed"}
    assert "pay_x1" in payment_ids
    assert "pay_x2" in payment_ids


# ─── Partial payment ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_partial_payment_leaves_correct_balance_due(ledger):
    """Paying less than the total leaves balance_due equal to the remainder."""
    await _create_order(ledger, "ord_partial")
    await _add_item(ledger, "ord_partial", "item_p", price=Decimal("50.00"))

    order = await _get_order(ledger, "ord_partial")
    total = order.total
    partial = money_round(total * Decimal("0.5"))

    await _pay(ledger, "ord_partial", "pay_part", partial)

    order = await _get_order(ledger, "ord_partial")
    expected_balance = money_round(total - partial)
    assert order.balance_due == expected_balance
    assert not order.is_fully_paid
    assert order.status == "open"  # not yet paid


@pytest.mark.asyncio
async def test_partial_payment_status_stays_open(ledger):
    """An order with only a partial payment stays 'open', not 'paid'."""
    await _create_order(ledger, "ord_part2")
    await _add_item(ledger, "ord_part2", "item_pp", price=Decimal("30.00"))

    order = await _get_order(ledger, "ord_part2")
    await _pay(ledger, "ord_part2", "pay_pp",
               amount=money_round(order.total * Decimal("0.3")))

    order = await _get_order(ledger, "ord_part2")
    assert order.status == "open"


# ─── Double-close idempotency ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_double_order_closed_stays_closed(ledger):
    """Appending ORDER_CLOSED twice is idempotent — status remains 'closed'."""
    await _create_order(ledger, "ord_dclose")
    await _add_item(ledger, "ord_dclose", "item_dc", price=Decimal("15.00"))

    order = await _get_order(ledger, "ord_dclose")
    await _pay(ledger, "ord_dclose", "pay_dc", order.total)

    for _ in range(2):
        evt = order_closed(terminal_id=TERMINAL, order_id="ord_dclose",
                           total=order.total)
        await ledger.append(evt.model_copy(update={"correlation_id": "ord_dclose"}))

    order = await _get_order(ledger, "ord_dclose")
    assert order.status == "closed"


# ─── Void after payment ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_order_voided_after_payment_status_is_voided(ledger):
    """An ORDER_VOIDED event overrides the 'paid' status → 'voided'."""
    await _create_order(ledger, "ord_void_paid")
    await _add_item(ledger, "ord_void_paid", "item_vp", price=Decimal("25.00"))

    order = await _get_order(ledger, "ord_void_paid")
    await _pay(ledger, "ord_void_paid", "pay_vp", order.total)

    order = await _get_order(ledger, "ord_void_paid")
    assert order.status == "paid"

    evt = order_voided(
        terminal_id=TERMINAL, order_id="ord_void_paid",
        reason="Manager void", approved_by="mgr_01",
    )
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_void_paid"}))

    order = await _get_order(ledger, "ord_void_paid")
    assert order.status == "voided"


@pytest.mark.asyncio
async def test_order_voided_unpaid_status_is_voided(ledger):
    """Voiding an unpaid open order → status becomes 'voided'."""
    await _create_order(ledger, "ord_void_open")
    await _add_item(ledger, "ord_void_open", "item_vo", price=Decimal("10.00"))

    evt = order_voided(
        terminal_id=TERMINAL, order_id="ord_void_open",
        reason="Test void",
    )
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_void_open"}))

    order = await _get_order(ledger, "ord_void_open")
    assert order.status == "voided"


# ─── ORDER_REOPENED ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reopen_paid_order_reverts_to_open(ledger):
    """ORDER_REOPENED on a paid (not yet closed) order puts it back to 'open'."""
    await _create_order(ledger, "ord_reopen")
    await _add_item(ledger, "ord_reopen", "item_ro", price=Decimal("20.00"))

    order = await _get_order(ledger, "ord_reopen")
    await _pay(ledger, "ord_reopen", "pay_ro", order.total)

    order = await _get_order(ledger, "ord_reopen")
    assert order.status == "paid"

    evt = order_reopened(terminal_id=TERMINAL, order_id="ord_reopen")
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_reopen"}))

    order = await _get_order(ledger, "ord_reopen")
    assert order.status == "open"


@pytest.mark.asyncio
async def test_reopen_closed_order_reverts_to_open(ledger):
    """ORDER_REOPENED on a closed order → 'open'."""
    await _create_order(ledger, "ord_reopen2")
    await _add_item(ledger, "ord_reopen2", "item_ro2", price=Decimal("20.00"))

    order = await _get_order(ledger, "ord_reopen2")
    await _pay(ledger, "ord_reopen2", "pay_ro2", order.total)
    evt = order_closed(terminal_id=TERMINAL, order_id="ord_reopen2",
                       total=order.total)
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_reopen2"}))

    order = await _get_order(ledger, "ord_reopen2")
    assert order.status == "closed"

    evt = order_reopened(terminal_id=TERMINAL, order_id="ord_reopen2")
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_reopen2"}))

    order = await _get_order(ledger, "ord_reopen2")
    assert order.status == "open"


# ─── ITEM_REMOVED ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_item_removed_reduces_subtotal(ledger):
    """After ITEM_REMOVED, the order subtotal drops by the removed item's price."""
    await _create_order(ledger, "ord_rm")
    await _add_item(ledger, "ord_rm", "item_keep", price=Decimal("30.00"))
    await _add_item(ledger, "ord_rm", "item_del", price=Decimal("20.00"))

    order = await _get_order(ledger, "ord_rm")
    assert order.subtotal == Decimal("50.00")

    evt = item_removed(terminal_id=TERMINAL, order_id="ord_rm",
                       item_id="item_del", reason="Customer changed mind")
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_rm"}))

    order = await _get_order(ledger, "ord_rm")
    assert order.subtotal == Decimal("30.00")
    active = [i for i in order.items if not i.voided]
    assert len(active) == 1
    assert active[0].item_id == "item_keep"


@pytest.mark.asyncio
async def test_item_removed_adjusts_total_with_tax(ledger):
    """Total after item removal reflects the correct subtotal + tax."""
    await _create_order(ledger, "ord_rm_tax")
    await _add_item(ledger, "ord_rm_tax", "item_a", price=Decimal("100.00"))
    await _add_item(ledger, "ord_rm_tax", "item_b", price=Decimal("50.00"))

    evt = item_removed(terminal_id=TERMINAL, order_id="ord_rm_tax",
                       item_id="item_b", reason="Void")
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_rm_tax"}))

    order = await _get_order(ledger, "ord_rm_tax")
    expected_total = money_round(Decimal("100.00") * (1 + TAX_RATE))
    assert order.total == expected_total


# ─── project_orders isolation ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_multiple_orders_do_not_cross_contaminate(ledger):
    """Events from order A do not appear in order B's projection."""
    await _create_order(ledger, "ord_iso_a")
    await _create_order(ledger, "ord_iso_b")

    await _add_item(ledger, "ord_iso_a", "item_ia", price=Decimal("40.00"))
    await _add_item(ledger, "ord_iso_b", "item_ib", price=Decimal("60.00"))

    order_a = await _get_order(ledger, "ord_iso_a")
    order_b = await _get_order(ledger, "ord_iso_b")

    assert order_a.subtotal == Decimal("40.00")
    assert order_b.subtotal == Decimal("60.00")
    assert len(order_a.items) == 1
    assert len(order_b.items) == 1
    assert order_a.items[0].item_id == "item_ia"
    assert order_b.items[0].item_id == "item_ib"


@pytest.mark.asyncio
async def test_project_orders_returns_all_open_orders(ledger):
    """project_orders called on the full event stream returns all orders."""
    for i in range(3):
        oid = f"ord_proj_{i}"
        await _create_order(ledger, oid)
        await _add_item(ledger, oid, f"item_proj_{i}", price=Decimal("10.00"))

    all_events = await ledger.get_events_since(0)
    orders = project_orders(all_events)
    assert len(orders) == 3
    for i in range(3):
        assert f"ord_proj_{i}" in orders


@pytest.mark.asyncio
async def test_project_orders_closed_order_included_in_dict(ledger):
    """project_orders includes closed orders — callers filter by status."""
    await _create_order(ledger, "ord_closed_proj")
    await _add_item(ledger, "ord_closed_proj", "item_cp", price=Decimal("20.00"))

    order = await _get_order(ledger, "ord_closed_proj")
    await _pay(ledger, "ord_closed_proj", "pay_cp", order.total)
    evt = order_closed(terminal_id=TERMINAL, order_id="ord_closed_proj",
                       total=order.total)
    await ledger.append(evt.model_copy(update={"correlation_id": "ord_closed_proj"}))

    all_events = await ledger.get_events_since(0)
    orders = project_orders(all_events)
    assert "ord_closed_proj" in orders
    assert orders["ord_closed_proj"].status == "closed"


# ─── Zero-item order ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_order_with_no_items_has_zero_subtotal(ledger):
    """An order that was created but had no items added has zero subtotal."""
    await _create_order(ledger, "ord_empty")
    order = await _get_order(ledger, "ord_empty")
    assert order.subtotal == Decimal("0.00")
    assert order.total == Decimal("0.00")
    assert order.is_fully_paid  # zero balance is always "paid"
