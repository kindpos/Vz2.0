"""
Payment Precision & Edge-Case Tests
=====================================
Covers split/multi-tender, refund, and tip-adjustment paths that have
zero test coverage in the existing suite.

  Split payments:
    - Cash dual-pricing discount applied only on first payment
    - Second cash payment receives no discount
    - Cash overpayment → SEAT_OVERPAYMENT_RESOLVED (change event)

  Refunds:
    - Full refund emits PAYMENT_REFUNDED
    - Partial refund
    - Over-refund (amount > payment) → 400

  Tip adjustments:
    - SEAT_TIP_ADDED emitted on first tip write
    - SEAT_TIP_ADDED NOT emitted on subsequent overrides
    - Zero-amount first tip → no SEAT_TIP_ADDED
"""

import os
import pytest
import pytest_asyncio
from decimal import Decimal
from pathlib import Path
from fastapi import HTTPException

from app.api.routes.payment_routes import (
    process_cash_payment, CashPaymentRequest,
    adjust_tip, TipAdjustRequest,
    process_refund, RefundRequest,
)
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    order_created,
    item_added,
    payment_initiated,
    payment_confirmed,
    order_closed,
)
from app.core.projections import project_order
from app.core.money import money_round

TEST_DB = Path("./data/test_payment_precision.db")
TERMINAL = "t_pay_prec"


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
        menu_item_id="menu_x",
        name="Test Item",
        price=item_price,
        quantity=1,
        category="food",
    )
    await ledger.append(evt.model_copy(update={"correlation_id": order_id}))
    events = await ledger.get_events_by_correlation(order_id)
    return project_order(events)


async def _confirm_card_payment(ledger, order_id, pay_id, amount):
    """Emit PAYMENT_INITIATED + PAYMENT_CONFIRMED for a card payment."""
    for factory, extra in [
        (payment_initiated, {"method": "card"}),
        (payment_confirmed, {"transaction_id": f"card_txn_{pay_id}"}),
    ]:
        evt = factory(
            terminal_id=TERMINAL,
            order_id=order_id,
            payment_id=pay_id,
            amount=amount,
            **extra,
        )
        await ledger.append(evt.model_copy(update={"correlation_id": order_id}))


# ─── Split Payment Tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cash_discount_only_on_first_payment(ledger):
    """Cash dual-pricing discount is applied on the first cash payment only.
    The second payment must not receive an additional DISCOUNT_APPROVED event."""
    cash_rate = Decimal(os.environ.get("KINDPOS_CASH_DISCOUNT_RATE", "0.04"))
    if cash_rate <= 0:
        pytest.skip("Cash discount rate is zero — discount path not active")

    # $100 item — easy math
    order = await _make_order(ledger, "ord_split", item_price=Decimal("100.00"))
    total = order.total  # includes tax

    # First partial cash payment (half)
    half = money_round(total / 2)
    req1 = CashPaymentRequest(order_id="ord_split", amount=half)
    await process_cash_payment(req1, ledger=ledger)

    # Count DISCOUNT_APPROVED events after first payment
    events = await ledger.get_events_by_correlation("ord_split")
    discounts_after_first = [
        e for e in events if e.event_type == EventType.DISCOUNT_APPROVED
    ]

    # Second cash payment for remaining balance
    events = await ledger.get_events_by_correlation("ord_split")
    order2 = project_order(events)
    remaining = order2.balance_due
    req2 = CashPaymentRequest(order_id="ord_split", amount=remaining)
    await process_cash_payment(req2, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_split")
    discounts_total = [
        e for e in events if e.event_type == EventType.DISCOUNT_APPROVED
    ]
    # No new discount event after the second payment
    assert len(discounts_total) == len(discounts_after_first)


@pytest.mark.asyncio
async def test_cash_overpayment_emits_change_event(ledger):
    """Paying more than balance_due triggers SEAT_OVERPAYMENT_RESOLVED with
    resolution='change' so the cash drawer variance is auditable."""
    order = await _make_order(ledger, "ord_over", item_price=Decimal("20.00"))
    total = order.total
    overpay = money_round(total + Decimal("10.00"))

    req = CashPaymentRequest(order_id="ord_over", amount=overpay)
    await process_cash_payment(req, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_over")
    change_events = [
        e for e in events
        if e.event_type == EventType.SEAT_OVERPAYMENT_RESOLVED
    ]
    assert len(change_events) == 1
    assert change_events[0].payload["resolution"] == "change"
    assert Decimal(str(change_events[0].payload["amount"])) == Decimal("10.00")


@pytest.mark.asyncio
async def test_cash_exact_payment_no_change_event(ledger):
    """Exact-amount cash payment produces no overpayment event."""
    order = await _make_order(ledger, "ord_exact", item_price=Decimal("30.00"))
    req = CashPaymentRequest(order_id="ord_exact", amount=order.total)
    await process_cash_payment(req, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_exact")
    change_events = [
        e for e in events
        if e.event_type == EventType.SEAT_OVERPAYMENT_RESOLVED
    ]
    assert len(change_events) == 0


@pytest.mark.asyncio
async def test_cash_payment_closes_order_when_fully_paid(ledger):
    """Full cash payment on a single-item order auto-emits ORDER_CLOSED."""
    order = await _make_order(ledger, "ord_autoclose", item_price=Decimal("15.00"))
    req = CashPaymentRequest(order_id="ord_autoclose", amount=order.total)
    await process_cash_payment(req, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_autoclose")
    order = project_order(events)
    assert order.status == "closed"

    close_events = [e for e in events if e.event_type == EventType.ORDER_CLOSED]
    assert len(close_events) == 1


# ─── Refund Tests ────────────────────────────────────────────────────────────

async def _make_paid_order(ledger, order_id, amount=Decimal("50.00")):
    """Build a closed card-paid order; return (order, pay_id)."""
    order = await _make_order(ledger, order_id, item_price=amount)
    pay_id = f"pay_{order_id}"
    total = order.total
    await _confirm_card_payment(ledger, order_id, pay_id, total)
    # Manually close the order
    close_evt = order_closed(
        terminal_id=TERMINAL, order_id=order_id, total=total,
    )
    await ledger.append(close_evt.model_copy(update={"correlation_id": order_id}))
    events = await ledger.get_events_by_correlation(order_id)
    return project_order(events), pay_id


@pytest.mark.asyncio
async def test_refund_full(ledger):
    """Full refund emits PAYMENT_REFUNDED with correct amount."""
    order, pay_id = await _make_paid_order(ledger, "ord_refund_full")
    payment = next(p for p in order.payments if p.payment_id == pay_id)

    req = RefundRequest(
        order_id="ord_refund_full",
        payment_id=pay_id,
        amount=None,  # None = full refund
        reason="Customer unhappy",
        approved_by="mgr_001",
    )
    resp = await process_refund(req, ledger=ledger)

    assert resp["success"] is True
    assert Decimal(str(resp["refund_amount"])) == money_round(payment.amount)

    events = await ledger.get_events_by_correlation("ord_refund_full")
    refund_events = [e for e in events if e.event_type == EventType.PAYMENT_REFUNDED]
    assert len(refund_events) == 1
    assert Decimal(str(refund_events[0].payload["amount"])) == money_round(payment.amount)


@pytest.mark.asyncio
async def test_refund_partial(ledger):
    """Partial refund records only the requested amount."""
    order, pay_id = await _make_paid_order(ledger, "ord_refund_partial",
                                            amount=Decimal("100.00"))
    partial = Decimal("25.00")
    req = RefundRequest(
        order_id="ord_refund_partial",
        payment_id=pay_id,
        amount=partial,
        reason="Partial comp",
        approved_by="mgr_001",
    )
    resp = await process_refund(req, ledger=ledger)

    assert Decimal(str(resp["refund_amount"])) == partial

    events = await ledger.get_events_by_correlation("ord_refund_partial")
    refund_events = [e for e in events if e.event_type == EventType.PAYMENT_REFUNDED]
    assert len(refund_events) == 1
    assert Decimal(str(refund_events[0].payload["amount"])) == partial


@pytest.mark.asyncio
async def test_refund_over_limit_rejected(ledger):
    """Refunding more than the payment amount raises HTTP 400."""
    order, pay_id = await _make_paid_order(ledger, "ord_refund_over",
                                            amount=Decimal("40.00"))
    payment = next(p for p in order.payments if p.payment_id == pay_id)
    too_much = money_round(payment.amount + Decimal("0.01"))

    req = RefundRequest(
        order_id="ord_refund_over",
        payment_id=pay_id,
        amount=too_much,
        reason="Bad amount",
        approved_by="mgr_001",
    )
    with pytest.raises(HTTPException) as exc:
        await process_refund(req, ledger=ledger)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_refund_cumulative_limit(ledger):
    """Two partial refunds cannot exceed the original payment total."""
    order, pay_id = await _make_paid_order(ledger, "ord_refund_cum",
                                            amount=Decimal("60.00"))
    payment = next(p for p in order.payments if p.payment_id == pay_id)
    half = money_round(payment.amount / 2)

    req1 = RefundRequest(
        order_id="ord_refund_cum", payment_id=pay_id,
        amount=half, reason="First", approved_by="mgr_001",
    )
    await process_refund(req1, ledger=ledger)

    # Try to refund half again — combined this would exceed the total
    req2 = RefundRequest(
        order_id="ord_refund_cum", payment_id=pay_id,
        amount=money_round(half + Decimal("0.01")),
        reason="Second (over)", approved_by="mgr_001",
    )
    with pytest.raises(HTTPException) as exc:
        await process_refund(req2, ledger=ledger)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_refund_requires_approved_by(ledger):
    """Empty approved_by raises HTTP 403."""
    order, pay_id = await _make_paid_order(ledger, "ord_refund_noauth")
    req = RefundRequest(
        order_id="ord_refund_noauth",
        payment_id=pay_id,
        amount=Decimal("5.00"),
        reason="Test",
        approved_by="",  # empty
    )
    with pytest.raises(HTTPException) as exc:
        await process_refund(req, ledger=ledger)
    assert exc.value.status_code == 403


# ─── Tip Adjustment Tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tip_adjust_first_tip_emits_seat_tip_added(ledger):
    """First tip write on a card payment emits SEAT_TIP_ADDED."""
    order, pay_id = await _make_paid_order(ledger, "ord_tip_first",
                                            amount=Decimal("50.00"))
    req = TipAdjustRequest(
        order_id="ord_tip_first",
        payment_id=pay_id,
        tip_amount=Decimal("10.00"),
    )
    await adjust_tip(req, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_tip_first")
    tip_events = [e for e in events if e.event_type == EventType.TIP_ADJUSTED]
    seat_tip_events = [e for e in events if e.event_type == EventType.SEAT_TIP_ADDED]

    assert len(tip_events) == 1
    assert Decimal(str(tip_events[0].payload["tip_amount"])) == Decimal("10.00")
    assert len(seat_tip_events) == 1


@pytest.mark.asyncio
async def test_tip_adjust_override_does_not_emit_seat_tip_added(ledger):
    """Overriding an existing tip does NOT emit another SEAT_TIP_ADDED."""
    order, pay_id = await _make_paid_order(ledger, "ord_tip_override",
                                            amount=Decimal("50.00"))
    # First tip
    req1 = TipAdjustRequest(
        order_id="ord_tip_override", payment_id=pay_id,
        tip_amount=Decimal("8.00"),
    )
    await adjust_tip(req1, ledger=ledger)

    # Override tip
    req2 = TipAdjustRequest(
        order_id="ord_tip_override", payment_id=pay_id,
        tip_amount=Decimal("12.00"),
    )
    await adjust_tip(req2, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_tip_override")
    seat_tip_events = [e for e in events if e.event_type == EventType.SEAT_TIP_ADDED]
    tip_events = [e for e in events if e.event_type == EventType.TIP_ADJUSTED]

    assert len(tip_events) == 2
    assert len(seat_tip_events) == 1  # only the first write

    # Latest TIP_ADJUSTED holds the overridden amount
    last_tip = sorted(tip_events, key=lambda e: e.sequence_number)[-1]
    assert Decimal(str(last_tip.payload["tip_amount"])) == Decimal("12.00")


@pytest.mark.asyncio
async def test_tip_adjust_zero_first_tip_no_seat_event(ledger):
    """Writing $0.00 as a first tip does NOT emit SEAT_TIP_ADDED."""
    order, pay_id = await _make_paid_order(ledger, "ord_tip_zero",
                                            amount=Decimal("50.00"))
    req = TipAdjustRequest(
        order_id="ord_tip_zero", payment_id=pay_id,
        tip_amount=Decimal("0.00"),
    )
    await adjust_tip(req, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_tip_zero")
    seat_tip_events = [e for e in events if e.event_type == EventType.SEAT_TIP_ADDED]
    assert len(seat_tip_events) == 0


@pytest.mark.asyncio
async def test_tip_adjust_negative_tip_rejected(ledger):
    """Negative tip amount raises HTTP 400."""
    order, pay_id = await _make_paid_order(ledger, "ord_tip_neg",
                                            amount=Decimal("30.00"))
    req = TipAdjustRequest(
        order_id="ord_tip_neg", payment_id=pay_id,
        tip_amount=Decimal("-5.00"),
    )
    with pytest.raises(HTTPException) as exc:
        await adjust_tip(req, ledger=ledger)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_tip_adjust_records_previous_tip(ledger):
    """TIP_ADJUSTED payload includes correct previous_tip for audit trail."""
    order, pay_id = await _make_paid_order(ledger, "ord_tip_prev",
                                            amount=Decimal("50.00"))
    # First tip: $10
    req1 = TipAdjustRequest(
        order_id="ord_tip_prev", payment_id=pay_id,
        tip_amount=Decimal("10.00"),
    )
    await adjust_tip(req1, ledger=ledger)

    # Second tip: $15 — previous should be $10
    req2 = TipAdjustRequest(
        order_id="ord_tip_prev", payment_id=pay_id,
        tip_amount=Decimal("15.00"),
    )
    await adjust_tip(req2, ledger=ledger)

    events = await ledger.get_events_by_correlation("ord_tip_prev")
    tip_events = sorted(
        [e for e in events if e.event_type == EventType.TIP_ADJUSTED],
        key=lambda e: e.sequence_number,
    )
    assert len(tip_events) == 2
    assert Decimal(str(tip_events[0].payload.get("previous_tip", "0.00"))) == Decimal("0.00")
    assert Decimal(str(tip_events[1].payload.get("previous_tip", "0.00"))) == Decimal("10.00")
