"""
Tests for seat-related gaps identified in the coverage audit:

  - PUT /{order_id}/seats  (update_seats route)
  - SeatBalance.balance_due calculated property
  - SEATS_UPDATED projection event handling
"""

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.api.routes import orders as orders_mod
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    item_added,
    order_created,
    payment_confirmed,
    payment_initiated,
    seats_updated,
)
from app.core.projections import OrderItem, SeatBalance, project_order

TEST_DB = Path("./data/test_seats_coverage.db")
TERMINAL = "terminal_seat"


@pytest.fixture(autouse=True)
def _zero_config(monkeypatch):
    monkeypatch.setattr(settings, "tax_rate", Decimal("0.00"))
    monkeypatch.setattr(settings, "cash_discount_rate", Decimal("0.00"))


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


def _make_item(item_id="i1", price="10.00", quantity=1, seat_number=None):
    return OrderItem(
        item_id=item_id,
        menu_item_id="m1",
        name="Item",
        price=Decimal(price),
        quantity=quantity,
        seat_number=seat_number,
    )


# ═══════════════════════════════════════════════════════════════════
#  PUT /orders/{id}/seats  — update_seats route
# ═══════════════════════════════════════════════════════════════════

class TestUpdateSeats:

    @pytest.mark.asyncio
    async def test_seat_numbers_written_to_projection(self, ledger):
        """Basic update: seat list is persisted and readable via projection."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-s1",
            order_type="dine_in", guest_count=2,
            server_id="srv1", server_name="S1", correlation_id="ord-s1",
        ))
        res = await orders_mod.update_seats(
            "ord-s1",
            orders_mod.UpdateSeatsRequest(seat_numbers=[1, 2]),
            ledger=ledger,
        )
        assert res.seat_numbers == [1, 2]

    @pytest.mark.asyncio
    async def test_deduplicates_and_sorts_seat_numbers(self, ledger):
        """Duplicate or out-of-order input is normalised: [3,1,2,1] → [1,2,3]."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-s2",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-s2",
        ))
        res = await orders_mod.update_seats(
            "ord-s2",
            orders_mod.UpdateSeatsRequest(seat_numbers=[3, 1, 2, 1]),
            ledger=ledger,
        )
        assert res.seat_numbers == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_unions_with_existing_item_seats(self, ledger):
        """Items on seat 4 survive a SEATS_UPDATED to [1,2]: result is [1,2,4]."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-s3",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-s3",
        ))
        await ledger.append(item_added(
            terminal_id=TERMINAL, order_id="ord-s3",
            item_id="i1", menu_item_id="m1",
            name="Pizza", price=Decimal("10.00"), quantity=1,
            seat_number=4,
        ))
        res = await orders_mod.update_seats(
            "ord-s3",
            orders_mod.UpdateSeatsRequest(seat_numbers=[1, 2]),
            ledger=ledger,
        )
        assert res.seat_numbers == [1, 2, 4]

    @pytest.mark.asyncio
    async def test_guest_count_matches_seat_count(self, ledger):
        """guest_count tracks the authoritative seat list after update."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-s4",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-s4",
        ))
        res = await orders_mod.update_seats(
            "ord-s4",
            orders_mod.UpdateSeatsRequest(seat_numbers=[1, 2, 3]),
            ledger=ledger,
        )
        assert res.guest_count == 3

    @pytest.mark.asyncio
    async def test_404_on_unknown_order(self, ledger):
        with pytest.raises(HTTPException) as exc_info:
            await orders_mod.update_seats(
                "no-such-order",
                orders_mod.UpdateSeatsRequest(seat_numbers=[1]),
                ledger=ledger,
            )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_emits_seats_updated_event(self, ledger):
        """A SEATS_UPDATED event is appended to the correlation timeline."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-s5",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-s5",
        ))
        await orders_mod.update_seats(
            "ord-s5",
            orders_mod.UpdateSeatsRequest(seat_numbers=[1, 2]),
            ledger=ledger,
        )
        events = await ledger.get_events_by_correlation("ord-s5")
        seat_events = [e for e in events if e.event_type == EventType.SEATS_UPDATED]
        assert len(seat_events) == 1
        assert seat_events[0].payload["seat_numbers"] == [1, 2]


# ═══════════════════════════════════════════════════════════════════
#  SeatBalance.balance_due
# ═══════════════════════════════════════════════════════════════════

class TestSeatBalanceDue:

    def test_balance_due_items_only(self):
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="12.00"))
        assert sb.balance_due == Decimal("12.00")

    def test_balance_due_multiple_items(self):
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item("i1", price="10.00"))
        sb.items.append(_make_item("i2", price="5.50"))
        assert sb.balance_due == Decimal("15.50")

    def test_balance_due_quantity_multiplied(self):
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="4.00", quantity=3))
        assert sb.balance_due == Decimal("12.00")

    def test_balance_due_reduced_by_discount(self):
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="20.00"))
        sb.discounts.append({"amount": "5.00"})
        assert sb.balance_due == Decimal("15.00")

    def test_balance_due_reduced_by_confirmed_payment(self):
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="20.00"))
        sb.seat_payments.append({"amount": "8.00", "status": "confirmed"})
        assert sb.balance_due == Decimal("12.00")

    def test_balance_due_ignores_pending_payment(self):
        """Only confirmed payments reduce the balance."""
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="10.00"))
        sb.seat_payments.append({"amount": "10.00", "status": "pending"})
        assert sb.balance_due == Decimal("10.00")

    def test_balance_due_ignores_failed_payment(self):
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="10.00"))
        sb.seat_payments.append({"amount": "10.00", "status": "failed"})
        assert sb.balance_due == Decimal("10.00")

    def test_balance_due_never_negative_on_overpayment(self):
        """Overpayment clamps to zero, never goes below."""
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="10.00"))
        sb.seat_payments.append({"amount": "15.00", "status": "confirmed"})
        assert sb.balance_due == Decimal("0.00")

    def test_balance_due_discount_plus_payment(self):
        """Discount and partial payment stack correctly."""
        sb = SeatBalance(seat_number=1)
        sb.items.append(_make_item(price="30.00"))
        sb.discounts.append({"amount": "5.00"})
        sb.seat_payments.append({"amount": "10.00", "status": "confirmed"})
        # 30 - 5 - 10 = 15
        assert sb.balance_due == Decimal("15.00")

    def test_balance_due_zero_on_empty_seat(self):
        sb = SeatBalance(seat_number=1)
        assert sb.balance_due == Decimal("0.00")


# ═══════════════════════════════════════════════════════════════════
#  SEATS_UPDATED projection event
# ═══════════════════════════════════════════════════════════════════

class TestSeatsUpdatedProjection:

    @pytest.mark.asyncio
    async def test_replaces_seat_list(self, ledger):
        """SEATS_UPDATED overwrites the order's seat_numbers."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-p1",
            order_type="dine_in", guest_count=3,
            server_id="srv1", server_name="S1", correlation_id="ord-p1",
            seat_numbers=[1, 2, 3],
        ))
        await ledger.append(seats_updated(
            terminal_id=TERMINAL, order_id="ord-p1",
            seat_numbers=[4, 5],
        ))
        events = await ledger.get_events_by_correlation("ord-p1")
        order = project_order(events)
        assert order.seat_numbers == [4, 5]

    @pytest.mark.asyncio
    async def test_unions_item_seats_not_in_new_list(self, ledger):
        """Items on seat 3 are preserved even if SEATS_UPDATED omits seat 3."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-p2",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-p2",
        ))
        await ledger.append(item_added(
            terminal_id=TERMINAL, order_id="ord-p2",
            item_id="i1", menu_item_id="m1",
            name="Steak", price=Decimal("25.00"), quantity=1,
            seat_number=3,
        ))
        await ledger.append(seats_updated(
            terminal_id=TERMINAL, order_id="ord-p2",
            seat_numbers=[1, 2],
        ))
        events = await ledger.get_events_by_correlation("ord-p2")
        order = project_order(events)
        # Seat 3 must be retained because an item lives there
        assert 3 in order.seat_numbers
        assert 1 in order.seat_numbers
        assert 2 in order.seat_numbers

    @pytest.mark.asyncio
    async def test_updates_guest_count_to_seat_count(self, ledger):
        """guest_count reflects the new seat total after SEATS_UPDATED."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-p3",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-p3",
        ))
        await ledger.append(seats_updated(
            terminal_id=TERMINAL, order_id="ord-p3",
            seat_numbers=[1, 2, 3, 4],
        ))
        events = await ledger.get_events_by_correlation("ord-p3")
        order = project_order(events)
        assert order.guest_count == 4

    @pytest.mark.asyncio
    async def test_multiple_updates_last_wins(self, ledger):
        """A second SEATS_UPDATED replaces the first."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-p4",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-p4",
        ))
        await ledger.append(seats_updated(
            terminal_id=TERMINAL, order_id="ord-p4",
            seat_numbers=[1, 2, 3],
        ))
        await ledger.append(seats_updated(
            terminal_id=TERMINAL, order_id="ord-p4",
            seat_numbers=[1, 2],
        ))
        events = await ledger.get_events_by_correlation("ord-p4")
        order = project_order(events)
        assert order.seat_numbers == [1, 2]
        assert order.guest_count == 2

    @pytest.mark.asyncio
    async def test_seat_balance_created_for_each_seat(self, ledger):
        """Items added after SEATS_UPDATED populate the correct SeatBalance bucket."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="ord-p5",
            order_type="dine_in", guest_count=1,
            server_id="srv1", server_name="S1", correlation_id="ord-p5",
        ))
        await ledger.append(seats_updated(
            terminal_id=TERMINAL, order_id="ord-p5",
            seat_numbers=[1, 2],
        ))
        await ledger.append(item_added(
            terminal_id=TERMINAL, order_id="ord-p5",
            item_id="i1", menu_item_id="m1",
            name="Burger", price=Decimal("12.00"), quantity=1,
            seat_number=1,
        ))
        await ledger.append(item_added(
            terminal_id=TERMINAL, order_id="ord-p5",
            item_id="i2", menu_item_id="m2",
            name="Fries", price=Decimal("4.00"), quantity=1,
            seat_number=2,
        ))
        events = await ledger.get_events_by_correlation("ord-p5")
        order = project_order(events)
        assert order.seat_balances[1].item_subtotal == Decimal("12.00")
        assert order.seat_balances[2].item_subtotal == Decimal("4.00")
