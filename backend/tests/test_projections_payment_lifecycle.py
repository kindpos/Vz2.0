"""
Payment lifecycle projection tests — gaps not covered by test_phase12_seat_balance.py.

Covers: pending-payment exclusion from amount_paid, failed-payment exclusion,
fail-then-retry success, partial refund after confirmation, mixed confirmed/failed,
3-seat uneven distribution, seat discount + payment combo, TIMED_OUT/CANCELLED
both fail, and order status reverts to 'open' on payment decline.
"""

import pytest
import pytest_asyncio
from decimal import Decimal
from pathlib import Path

from app.config import settings as app_settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    create_event,
    order_created,
    item_added,
    payment_initiated,
    payment_confirmed,
    payment_failed,
)
from app.core.projections import project_order

TEST_DB = Path("./data/test_projections_payment.db")
TERMINAL = "T-pay"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.fixture(autouse=True)
def _zero_tax(monkeypatch):
    """Zero tax so order.total == subtotal, simplifying is_fully_paid assertions."""
    monkeypatch.setattr(app_settings, "tax_rate", 0.0)


async def _seed(ledger: EventLedger, oid: str, price: Decimal = Decimal("20.00")) -> None:
    """Emit ORDER_CREATED + ITEM_ADDED for a single-seat-free item."""
    await ledger.append(
        order_created(
            terminal_id=TERMINAL, order_id=oid,
            server_id="srv", server_name="Alice",
        ).model_copy(update={"correlation_id": oid})
    )
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=oid,
        item_id=f"{oid}_item", menu_item_id="m1",
        name="Dish", price=price, quantity=1,
    ))


async def _project(ledger: EventLedger, oid: str):
    events = await ledger.get_events_by_correlation(oid)
    return project_order(events)


# ═══════════════════════════════════════════════════════════════════════
# 1. Pending payment (initiated, not confirmed) is not counted in amount_paid
# ═══════════════════════════════════════════════════════════════════════

async def test_pending_payment_not_counted(ledger):
    oid = "pay-pending-01"
    await _seed(ledger, oid, Decimal("20.00"))
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_1", amount=Decimal("20.00"), method="card",
    ))

    order = await _project(ledger, oid)

    assert order.is_fully_paid is False
    assert order.amount_paid == Decimal("0.00")
    assert len(order.payments) == 1
    assert order.payments[0].status == "pending"
    assert order.status == "open"


# ═══════════════════════════════════════════════════════════════════════
# 2. Failed payment (declined) is not counted in amount_paid
# ═══════════════════════════════════════════════════════════════════════

async def test_failed_payment_not_counted(ledger):
    oid = "pay-failed-01"
    await _seed(ledger, oid, Decimal("20.00"))
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_2", amount=Decimal("20.00"), method="card",
    ))
    await ledger.append(payment_failed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_2", error="Card declined",
    ))

    order = await _project(ledger, oid)

    assert order.amount_paid == Decimal("0.00")
    assert order.payments[0].status == "failed"
    assert order.payments[0].error == "Card declined"
    assert order.is_fully_paid is False
    assert order.status == "open"


# ═══════════════════════════════════════════════════════════════════════
# 3. First payment fails; second payment is confirmed → fully paid
# ═══════════════════════════════════════════════════════════════════════

async def test_failed_then_repaid(ledger):
    oid = "pay-repaid-01"
    await _seed(ledger, oid, Decimal("20.00"))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_fail", amount=Decimal("20.00"), method="card",
    ))
    await ledger.append(payment_failed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_fail", error="Declined",
    ))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_ok", amount=Decimal("20.00"), method="card",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_ok", transaction_id="txn_ok",
        amount=Decimal("20.00"), tax=Decimal("0.00"),
    ))

    order = await _project(ledger, oid)

    assert order.is_fully_paid is True
    assert order.amount_paid == Decimal("20.00")
    assert order.status == "paid"

    failed = [p for p in order.payments if p.status == "failed"]
    confirmed = [p for p in order.payments if p.status == "confirmed"]
    assert len(failed) == 1
    assert len(confirmed) == 1


# ═══════════════════════════════════════════════════════════════════════
# 4. Partial refund after confirmation — is_fully_paid stays True
# ═══════════════════════════════════════════════════════════════════════

async def test_partial_refund_after_confirmation(ledger):
    oid = "pay-refund-01"
    await _seed(ledger, oid, Decimal("20.00"))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_full", amount=Decimal("20.00"), method="card",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_full", transaction_id="txn_full",
        amount=Decimal("20.00"), tax=Decimal("0.00"),
    ))

    # Partial refund — does NOT alter the payment's confirmed status
    await ledger.append(create_event(
        event_type=EventType.PAYMENT_REFUNDED,
        terminal_id=TERMINAL,
        payload={
            "order_id": oid,
            "payment_id": "pid_full",
            "amount": Decimal("5.00"),
            "reason": "Partial refund",
        },
        correlation_id=oid,
    ))

    order = await _project(ledger, oid)

    # amount_paid is still the confirmed payment total — refunds are separate
    assert order.is_fully_paid is True
    assert order.amount_paid == Decimal("20.00")
    assert len(order.refunds) == 1
    assert order.refunds[0]["amount"] == Decimal("5.00")
    assert order.refund_total == Decimal("5.00")


# ═══════════════════════════════════════════════════════════════════════
# 5. Mixed confirmed + failed payments — only confirmed counts
# ═══════════════════════════════════════════════════════════════════════

async def test_mixed_confirmed_and_failed(ledger):
    oid = "pay-mixed-01"
    await _seed(ledger, oid, Decimal("30.00"))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_a", amount=Decimal("15.00"), method="card",
    ))
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_b", amount=Decimal("15.00"), method="cash",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_a", transaction_id="txn_a",
        amount=Decimal("15.00"), tax=Decimal("0.00"),
    ))
    await ledger.append(payment_failed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_b", error="Cash short",
    ))

    order = await _project(ledger, oid)

    assert order.amount_paid == Decimal("15.00")
    assert order.is_fully_paid is False
    assert order.status == "open"

    confirmed = [p for p in order.payments if p.status == "confirmed"]
    failed_ps = [p for p in order.payments if p.status == "failed"]
    assert len(confirmed) == 1
    assert len(failed_ps) == 1


# ═══════════════════════════════════════════════════════════════════════
# 6. 3-seat payment — remainder goes to last seat, sum is exact
# ═══════════════════════════════════════════════════════════════════════

async def test_three_seat_uneven_distribution(ledger):
    oid = "pay-3seat-01"
    await ledger.append(
        order_created(
            terminal_id=TERMINAL, order_id=oid,
            server_id="srv", server_name="Alice",
        ).model_copy(update={"correlation_id": oid})
    )
    # Three items, one per seat
    for seat, price in [(1, Decimal("3.34")), (2, Decimal("3.33")), (3, Decimal("3.33"))]:
        await ledger.append(item_added(
            terminal_id=TERMINAL, order_id=oid,
            item_id=f"{oid}_s{seat}", menu_item_id=f"m{seat}",
            name=f"Item{seat}", price=price, quantity=1,
            seat_number=seat,
        ))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_3s", amount=Decimal("10.00"), method="card",
        seat_numbers=[1, 2, 3],
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_3s", transaction_id="txn_3s",
        amount=Decimal("10.00"), tax=Decimal("0.00"),
        seat_numbers=[1, 2, 3],
    ))

    order = await _project(ledger, oid)

    s1 = order.seat_balances[1].amount_paid
    s2 = order.seat_balances[2].amount_paid
    s3 = order.seat_balances[3].amount_paid

    # First two get floor(10/3)=3.33, last gets the remainder 3.34
    assert s1 == Decimal("3.33")
    assert s2 == Decimal("3.33")
    assert s3 == Decimal("3.34")
    assert s1 + s2 + s3 == Decimal("10.00")


# ═══════════════════════════════════════════════════════════════════════
# 7. SeatBalance: discount applied + payment confirmed = zero balance_due
# ═══════════════════════════════════════════════════════════════════════

async def test_seat_discount_and_payment(ledger):
    oid = "pay-seat-disc-01"
    await ledger.append(
        order_created(
            terminal_id=TERMINAL, order_id=oid,
            server_id="srv", server_name="Alice",
        ).model_copy(update={"correlation_id": oid})
    )
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=oid,
        item_id="it_s1", menu_item_id="m1",
        name="Dish", price=Decimal("20.00"), quantity=1,
        seat_number=1,
    ))

    # Apply $5 seat discount
    await ledger.append(create_event(
        event_type=EventType.SEAT_DISCOUNT_APPLIED,
        terminal_id=TERMINAL,
        payload={
            "order_id": oid,
            "seat_number": 1,
            "discount_id": "disc_1",
            "discount_type": "flat",
            "amount": Decimal("5.00"),
            "approved_by": "mgr",
        },
        correlation_id=oid,
    ))

    # Confirm $15 payment for seat 1
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_s1", amount=Decimal("15.00"), method="card",
        seat_numbers=[1],
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_s1", transaction_id="txn_s1",
        amount=Decimal("15.00"), tax=Decimal("0.00"),
        seat_numbers=[1],
    ))

    order = await _project(ledger, oid)

    sb = order.seat_balances[1]
    assert sb.item_subtotal == Decimal("20.00")
    assert sb.discount_total == Decimal("5.00")
    assert sb.amount_paid == Decimal("15.00")
    assert sb.balance_due == Decimal("0.00")


# ═══════════════════════════════════════════════════════════════════════
# 8. PAYMENT_TIMED_OUT and PAYMENT_CANCELLED both produce status='failed'
# ═══════════════════════════════════════════════════════════════════════

async def test_timed_out_and_cancelled_both_fail(ledger):
    oid = "pay-timeout-cancel-01"
    await _seed(ledger, oid, Decimal("25.00"))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_timeout", amount=Decimal("25.00"), method="card",
    ))
    await ledger.append(create_event(
        event_type=EventType.PAYMENT_TIMED_OUT,
        terminal_id=TERMINAL,
        payload={"order_id": oid, "payment_id": "pid_timeout", "error": "Payment timed out"},
        correlation_id=oid,
    ))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_cancel", amount=Decimal("25.00"), method="card",
    ))
    await ledger.append(create_event(
        event_type=EventType.PAYMENT_CANCELLED,
        terminal_id=TERMINAL,
        payload={"order_id": oid, "payment_id": "pid_cancel", "error": "Customer cancelled"},
        correlation_id=oid,
    ))

    order = await _project(ledger, oid)

    assert order.status == "open"
    assert order.is_fully_paid is False
    assert order.amount_paid == Decimal("0.00")
    for p in order.payments:
        assert p.status == "failed"


# ═══════════════════════════════════════════════════════════════════════
# 9. Order status reverts to 'open' when a confirmed payment is later declined
# ═══════════════════════════════════════════════════════════════════════

async def test_order_reverts_open_on_decline(ledger):
    oid = "pay-revert-01"
    await _seed(ledger, oid, Decimal("20.00"))

    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_r", amount=Decimal("20.00"), method="card",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_r", transaction_id="txn_r",
        amount=Decimal("20.00"), tax=Decimal("0.00"),
    ))

    # Confirm the order moved to "paid" after confirmation
    order = await _project(ledger, oid)
    assert order.status == "paid"
    assert order.is_fully_paid is True

    # Now decline the payment (e.g. chargeback)
    await ledger.append(payment_failed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id="pid_r", error="Chargeback",
    ))

    order = await _project(ledger, oid)

    assert order.payments[0].status == "failed"
    assert order.amount_paid == Decimal("0.00")
    assert order.is_fully_paid is False
    assert order.status == "open"
