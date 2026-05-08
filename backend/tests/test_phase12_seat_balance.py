"""Phase 12 — Per-seat balance projection (Track 2).

Verifies that SeatBalance objects are built correctly by project_order() as
seat-scoped events are replayed, and that GET /orders/{id}/seats returns the
correct per-seat breakdown.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import orders as orders_mod
from app.api.routes import config as cfg
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    create_event,
    order_created,
    item_added,
    payment_initiated,
    payment_confirmed,
)
from app.core.projections import project_order, SeatBalance
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase12.db")
TERMINAL = "T-12"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.fixture
def bg():
    return BackgroundTasks()


async def _seed_two_seat_order(ledger, order_id: str):
    """Order with 2 seats: seat 1 has a $20 burger, seat 2 has a $15 salad."""
    await ledger.append_batch([
        order_created(
            terminal_id=TERMINAL, order_id=order_id,
            server_id="srv", server_name="Alice",
        ).model_copy(update={"correlation_id": order_id}),
        item_added(
            terminal_id=TERMINAL, order_id=order_id,
            item_id="item_burger", menu_item_id="m_burger",
            name="Burger", price=Decimal("20.00"), quantity=1, seat_number=1,
        ),
        item_added(
            terminal_id=TERMINAL, order_id=order_id,
            item_id="item_salad", menu_item_id="m_salad",
            name="Salad", price=Decimal("15.00"), quantity=1, seat_number=2,
        ),
    ])


# ── SeatBalance dataclass smoke test ──────────────────────────────────
def test_seat_balance_dataclass_exists():
    sb = SeatBalance(seat_number=1)
    assert sb.seat_number == 1
    assert sb.item_subtotal == Decimal("0.00")
    assert sb.discount_total == Decimal("0.00")
    assert sb.amount_paid == Decimal("0.00")
    assert sb.balance_due == Decimal("0.00")
    assert sb.is_paid is False
    assert sb.is_comped is False


# ── Item assignment ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_item_added_populates_seat_balance(ledger):
    order_id = "ord_12_item"
    await _seed_two_seat_order(ledger, order_id)

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)

    assert 1 in order.seat_balances
    assert 2 in order.seat_balances

    sb1 = order.seat_balances[1]
    assert len(sb1.items) == 1
    assert sb1.items[0].name == "Burger"
    assert sb1.item_subtotal == Decimal("20.00")

    sb2 = order.seat_balances[2]
    assert len(sb2.items) == 1
    assert sb2.items[0].name == "Salad"
    assert sb2.item_subtotal == Decimal("15.00")


@pytest.mark.asyncio
async def test_item_without_seat_not_in_seat_balances(ledger):
    """Items with no seat_number don't create seat_balances entries."""
    order_id = "ord_12_noseat"
    ev = order_created(
        terminal_id=TERMINAL, order_id=order_id,
        server_id="srv", server_name="Alice",
    ).model_copy(update={"correlation_id": order_id})
    item_ev = item_added(
        terminal_id=TERMINAL, order_id=order_id,
        item_id="item_x", menu_item_id="m_x",
        name="Soup", price=Decimal("8.00"), quantity=1,
        # seat_number intentionally omitted
    )
    await ledger.append_batch([ev, item_ev])

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)
    assert order.seat_balances == {}


# ── Item removal updates seat balance ─────────────────────────────────
@pytest.mark.asyncio
async def test_item_removed_updates_seat_balance(ledger):
    order_id = "ord_12_remove"
    await _seed_two_seat_order(ledger, order_id)

    # Remove the burger from seat 1
    remove_ev = create_event(
        EventType.ITEM_REMOVED,
        terminal_id=TERMINAL,
        payload={"order_id": order_id, "item_id": "item_burger"},
        correlation_id=order_id,
    )
    await ledger.append(remove_ev)

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)

    assert all(i.voided for i in order.seat_balances[1].items)
    assert order.seat_balances[1].item_subtotal == Decimal("0.00")
    # Seat 2 unchanged
    assert order.seat_balances[2].item_subtotal == Decimal("15.00")


# ── Seat discount reduces balance_due ─────────────────────────────────
@pytest.mark.asyncio
async def test_seat_discount_applied_reduces_balance(ledger, bg):
    order_id = "ord_12_disc"
    await _seed_two_seat_order(ledger, order_id)

    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="seat.discount_applied",
                payload={
                    "order_id": order_id, "seat_number": 1,
                    "amount": 5.00, "discount_type": "10%",
                    "approved_by": "mgr",
                },
            )
        ],
        background_tasks=bg,
        ledger=ledger,
    )

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)

    sb1 = order.seat_balances[1]
    assert sb1.item_subtotal == Decimal("20.00")
    assert sb1.discount_total == Decimal("5.0")
    assert sb1.balance_due == Decimal("15.00")


@pytest.mark.asyncio
async def test_seat_discount_voided_restores_balance(ledger, bg):
    order_id = "ord_12_dvoid"
    await _seed_two_seat_order(ledger, order_id)

    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="seat.discount_applied",
                payload={
                    "order_id": order_id, "seat_number": 1,
                    "discount_id": "disc_x", "amount": 5.00,
                    "discount_type": "10%", "approved_by": "mgr",
                },
            ),
            PendingChange(
                event_type="seat.discount_voided",
                payload={
                    "order_id": order_id, "seat_number": 1,
                    "discount_id": "disc_x", "voided_by": "mgr",
                },
            ),
        ],
        background_tasks=bg,
        ledger=ledger,
    )

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)
    assert order.seat_balances[1].discount_total == Decimal("0.00")
    assert order.seat_balances[1].balance_due == Decimal("20.00")


# ── Seat comped ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_seat_comped_marks_is_comped(ledger, bg):
    order_id = "ord_12_comp"
    await _seed_two_seat_order(ledger, order_id)

    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="seat.comped",
                payload={
                    "order_id": order_id, "seat_number": 2,
                    "comp_category": "vip", "comped_by": "mgr",
                },
            )
        ],
        background_tasks=bg,
        ledger=ledger,
    )

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)
    assert order.seat_balances[2].is_comped is True
    assert order.seat_balances[2].comp_category == "vip"
    assert order.seat_balances[1].is_comped is False


# ── Seat paid marks is_paid ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_seat_paid_marks_seat(ledger, bg):
    order_id = "ord_12_paid"
    await _seed_two_seat_order(ledger, order_id)

    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="seat.paid",
                payload={"order_id": order_id, "seat_number": 1},
            )
        ],
        background_tasks=bg,
        ledger=ledger,
    )

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)
    assert order.seat_balances[1].is_paid is True
    assert order.seat_balances[2].is_paid is False


# ── Payment confirmed distributes to seat balances ─────────────────────
@pytest.mark.asyncio
async def test_payment_confirmed_distributes_to_seats(ledger):
    order_id = "ord_12_pay"
    await _seed_two_seat_order(ledger, order_id)

    # Initiate + confirm payment covering both seats
    await ledger.append_batch([
        payment_initiated(
            terminal_id=TERMINAL, order_id=order_id,
            payment_id="pay_1", amount=Decimal("35.00"),
            method="card", seat_numbers=[1, 2],
        ),
        payment_confirmed(
            terminal_id=TERMINAL, order_id=order_id,
            payment_id="pay_1", transaction_id="txn_1",
            amount=Decimal("35.00"), tax=Decimal("0.00"),
            seat_numbers=[1, 2],
        ),
    ])

    events = await ledger.get_events_by_correlation(order_id)
    order = project_order(events)

    # Each seat gets half of the $35 payment
    assert order.seat_balances[1].amount_paid == Decimal("17.50")
    assert order.seat_balances[2].amount_paid == Decimal("17.50")


# ── GET /orders/{id}/seats endpoint ───────────────────────────────────
@pytest.mark.asyncio
async def test_seat_balances_endpoint(ledger, bg):
    order_id = "ord_12_ep"
    await _seed_two_seat_order(ledger, order_id)

    # Apply a discount to seat 1
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="seat.discount_applied",
                payload={
                    "order_id": order_id, "seat_number": 1,
                    "amount": 5.00, "discount_type": "promo",
                    "approved_by": "mgr",
                },
            )
        ],
        background_tasks=bg,
        ledger=ledger,
    )

    result = await orders_mod.get_seat_balances(order_id=order_id, ledger=ledger)
    assert result["order_id"] == order_id
    seats = {s["seat_number"]: s for s in result["seats"]}

    assert 1 in seats
    assert 2 in seats
    assert seats[1]["item_subtotal"] == "20.00"
    assert Decimal(seats[1]["discount_total"]) == Decimal("5.0")
    assert Decimal(seats[1]["balance_due"]) == Decimal("15.00")
    assert seats[2]["item_subtotal"] == "15.00"
    assert seats[2]["discount_total"] == "0.00"
    assert len(seats[1]["items"]) == 1
    assert seats[1]["items"][0]["name"] == "Burger"


@pytest.mark.asyncio
async def test_seat_balances_endpoint_empty_order(ledger):
    """Order with no seat-scoped items returns empty seats list."""
    order_id = "ord_12_empty"
    await ledger.append(
        order_created(
            terminal_id=TERMINAL, order_id=order_id,
            server_id="srv", server_name="Alice",
        ).model_copy(update={"correlation_id": order_id})
    )
    result = await orders_mod.get_seat_balances(order_id=order_id, ledger=ledger)
    assert result["seats"] == []
