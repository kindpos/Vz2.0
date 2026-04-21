"""
Regression tests for the order-scoped tip-adjust endpoint
`POST /api/v1/orders/{order_id}/adjust-tip`
(`api/routes/orders.py:1881-1954`).

Covers every guard branch plus the M2 fix: `previous_tip` is passed
through `money_round()` before being echoed in the response and
written to the new TIP_ADJUSTED event. That keeps the tips partition
clean on repeat adjustments (e.g. a server over-adjusted a tip and
corrects it).

The device-sync block runs only when a real (non-mock) device is
registered; in our fixture the manager has no device mapped for the
test terminal_id, so the block short-circuits and we don't need to
mock a device for these tests.
"""

from pathlib import Path
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.api.routes.orders import OrderTipAdjustRequest, adjust_tip_on_order
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    item_added,
    order_created,
    payment_confirmed,
    payment_initiated,
)


TEST_DB = Path("./data/test_adjust_tip_on_order.db")
TERMINAL = settings.terminal_id


@pytest.fixture(autouse=True)
def _zero_tax(monkeypatch):
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


async def _seed_card_paid_order(
    ledger,
    *,
    order_id: str = "o_atipo",
    amount: Decimal = Decimal("20.00"),
    payment_id: str = "o_atipo_p0",
    confirmed: bool = True,
) -> tuple[str, str]:
    """Seed an order + one card payment. If `confirmed=False`, the
    payment stays at `pending` status so guard-branch tests can exercise
    it."""
    await ledger.append(order_created(
        terminal_id=TERMINAL, order_id=order_id,
        order_type="dine_in", guest_count=1,
        correlation_id=order_id,
    ))
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=order_id,
        item_id=f"{order_id}_i", menu_item_id="m1",
        name="Item", price=amount, quantity=1,
    ))
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=order_id, payment_id=payment_id,
        amount=amount, method="card",
    ))
    if confirmed:
        await ledger.append(payment_confirmed(
            terminal_id=TERMINAL, order_id=order_id, payment_id=payment_id,
            transaction_id=f"txn_{payment_id}",
            amount=amount, tax=Decimal("0.00"),
        ))
    return order_id, payment_id


# ── Happy paths ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_first_tip_adjust_emits_event_with_zero_previous(ledger):
    order_id, pid = await _seed_card_paid_order(ledger)

    res = await adjust_tip_on_order(
        order_id,
        OrderTipAdjustRequest(payment_id=pid, tip_amount=Decimal("3.50")),
        ledger=ledger,
    )
    assert res["success"] is True
    assert res["tip_amount"] == Decimal("3.50")
    assert res["previous_tip"] == Decimal("0.00")

    events = await ledger.get_events_by_correlation(order_id)
    tip_events = [e for e in events if e.event_type == EventType.TIP_ADJUSTED]
    assert len(tip_events) == 1
    assert Decimal(str(tip_events[0].payload["tip_amount"])) == Decimal("3.50")
    assert Decimal(str(tip_events[0].payload["previous_tip"])) == Decimal("0.00")


@pytest.mark.asyncio
async def test_second_adjust_surfaces_rounded_previous_tip(ledger):
    """M2 fix: `previous_tip` is `money_round`'d. Re-adjusting a tip
    returns the last tip as a 2dp Decimal."""
    order_id, pid = await _seed_card_paid_order(ledger, order_id="o_atipo_reap")

    await adjust_tip_on_order(
        order_id,
        OrderTipAdjustRequest(payment_id=pid, tip_amount=Decimal("2.75")),
        ledger=ledger,
    )
    res = await adjust_tip_on_order(
        order_id,
        OrderTipAdjustRequest(payment_id=pid, tip_amount=Decimal("4.20")),
        ledger=ledger,
    )
    assert res["tip_amount"] == Decimal("4.20")
    assert res["previous_tip"] == Decimal("2.75")

    events = await ledger.get_events_by_correlation(order_id)
    tip_events = [e for e in events if e.event_type == EventType.TIP_ADJUSTED]
    assert len(tip_events) == 2
    # Newest event records the rounded previous tip
    assert Decimal(str(tip_events[-1].payload["previous_tip"])) == Decimal("2.75")


# ── Guard branches ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_negative_tip_rejected(ledger):
    order_id, pid = await _seed_card_paid_order(ledger, order_id="o_atipo_neg")
    with pytest.raises(HTTPException) as exc:
        await adjust_tip_on_order(
            order_id,
            OrderTipAdjustRequest(payment_id=pid, tip_amount=Decimal("-1.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "negative" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_tip_with_more_than_two_decimal_places_rejected(ledger):
    """_validate_2dp blocks sub-cent precision that would break the
    financial invariants."""
    order_id, pid = await _seed_card_paid_order(ledger, order_id="o_atipo_3dp")
    with pytest.raises(HTTPException) as exc:
        await adjust_tip_on_order(
            order_id,
            OrderTipAdjustRequest(payment_id=pid, tip_amount=Decimal("1.234")),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "decimal places" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_missing_order_returns_404(ledger):
    with pytest.raises(HTTPException) as exc:
        await adjust_tip_on_order(
            "o_does_not_exist",
            OrderTipAdjustRequest(payment_id="p_x", tip_amount=Decimal("1.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_missing_payment_returns_404(ledger):
    order_id, _ = await _seed_card_paid_order(ledger, order_id="o_atipo_missp")
    with pytest.raises(HTTPException) as exc:
        await adjust_tip_on_order(
            order_id,
            OrderTipAdjustRequest(payment_id="p_no_such", tip_amount=Decimal("1.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 404
    assert "p_no_such" in exc.value.detail


@pytest.mark.asyncio
async def test_pending_payment_rejected(ledger):
    """Tip-adjust is only valid on confirmed payments — rejected on any
    other status."""
    order_id, pid = await _seed_card_paid_order(
        ledger, order_id="o_atipo_pend", confirmed=False,
    )
    with pytest.raises(HTTPException) as exc:
        await adjust_tip_on_order(
            order_id,
            OrderTipAdjustRequest(payment_id=pid, tip_amount=Decimal("1.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "confirmed" in exc.value.detail.lower()
