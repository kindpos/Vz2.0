"""Phase 4c emission tests — discount void, overpayment resolved, first tip."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio

from app.api.routes import orders as orders_mod
from app.api.routes import payment_routes as pr
from app.api.routes.orders import ApplyDiscountRequest, VoidDiscountRequest
from app.api.routes.payment_routes import CashPaymentRequest, TipAdjustRequest
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    order_created,
    item_added,
    payment_initiated,
    payment_confirmed,
)


TEST_DB = Path("./data/test_phase4c.db")
TERMINAL = "T-4c"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _seed_order(ledger, order_id: str, price: Decimal = Decimal("20.00")):
    await ledger.append(order_created(
        terminal_id=TERMINAL, order_id=order_id,
        server_id="srv", server_name="srv",
    ).model_copy(update={"correlation_id": order_id}))
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=order_id,
        item_id="it_1", menu_item_id="m1",
        name="Burger", price=price, quantity=1, seat_number=1,
    ))


# ── LG-13 discount.voided ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_void_discount_emits_discount_voided_and_refunds_amount(ledger):
    oid = "order_void_disc_1"
    await _seed_order(ledger, oid)
    await orders_mod.apply_discount(
        order_id=oid,
        request=ApplyDiscountRequest(
            discount_type="10%", amount=Decimal("2.00"),
            approved_by="mgr_a", discount_id="d-1",
        ),
        ledger=ledger,
    )
    before = await orders_mod.get_order_or_404(ledger, oid)
    assert before.discount_total == Decimal("2.00")

    resp = await orders_mod.void_discount(
        order_id=oid,
        request=VoidDiscountRequest(voided_by="mgr_a", discount_id="d-1"),
        ledger=ledger,
    )
    assert resp.discount_total == Decimal("0.00")

    voided = await ledger.get_events_by_type(EventType.DISCOUNT_VOIDED)
    assert len(voided) == 1
    p = voided[0].payload
    assert p["discount_id"] == "d-1"
    assert p["voided_by"] == "mgr_a"
    assert Decimal(str(p["amount"])) == Decimal("2.00")


@pytest.mark.asyncio
async def test_void_discount_with_no_discount_returns_404(ledger):
    oid = "order_void_disc_empty"
    await _seed_order(ledger, oid)
    with pytest.raises(Exception):
        await orders_mod.void_discount(
            order_id=oid,
            request=VoidDiscountRequest(voided_by="mgr_a"),
            ledger=ledger,
        )


# ── LG-34 seat.overpayment_resolved (cash change) ─────────────────────
@pytest.mark.asyncio
async def test_cash_overpayment_emits_overpayment_resolved_change(ledger, monkeypatch):
    # Disable cash dual-pricing so the overpay math is clean.
    monkeypatch.setattr(
        "app.api.routes.payment_routes.settings",
        type("S", (), {**vars(pr.settings), "cash_discount_rate": 0.0, "terminal_id": TERMINAL}),
        raising=False,
    )
    oid = "order_overpay_cash"
    await _seed_order(ledger, oid, price=Decimal("10.00"))
    # Order total (no tax configured in test env) -> balance = 10.00;
    # paying 15.00 leaves 5.00 as customer change.
    await pr.process_cash_payment(
        request=CashPaymentRequest(order_id=oid, amount=Decimal("15.00")),
        ledger=ledger,
    )
    overpay = await ledger.get_events_by_type(EventType.SEAT_OVERPAYMENT_RESOLVED)
    assert len(overpay) == 1
    p = overpay[0].payload
    assert p["resolution"] == "change"
    assert Decimal(str(p["amount"])) > Decimal("0.00")


async def _seed_confirmed_credit_payment(ledger, order_id: str, payment_id: str, amount: Decimal):
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=order_id,
        payment_id=payment_id, amount=amount, method="card",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=order_id,
        payment_id=payment_id,
        transaction_id=f"txn_{payment_id}",
        amount=amount, tax=Decimal("0.00"),
    ))


# ── LG-35 seat.tip_added (first tip only) ─────────────────────────────
@pytest.mark.asyncio
async def test_first_tip_emits_seat_tip_added_but_second_does_not(ledger):
    oid = "order_tip_added"
    await _seed_order(ledger, oid)
    await _seed_confirmed_credit_payment(ledger, oid, "pay_abc", Decimal("20.00"))

    # First tip — previous_tip == 0 so seat.tip_added should fire.
    await pr.adjust_tip(
        request=TipAdjustRequest(
            order_id=oid, payment_id="pay_abc",
            tip_amount=Decimal("3.00"), adjusted_by="srv",
        ),
        ledger=ledger,
    )
    first = await ledger.get_events_by_type(EventType.SEAT_TIP_ADDED)
    assert len(first) == 1

    # Second tip write — previous_tip != 0 so only tip_adjusted fires.
    await pr.adjust_tip(
        request=TipAdjustRequest(
            order_id=oid, payment_id="pay_abc",
            tip_amount=Decimal("4.00"), adjusted_by="mgr",
        ),
        ledger=ledger,
    )
    second = await ledger.get_events_by_type(EventType.SEAT_TIP_ADDED)
    assert len(second) == 1  # still one
    adjusted = await ledger.get_events_by_type(EventType.TIP_ADJUSTED)
    assert len(adjusted) == 2
