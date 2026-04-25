"""Tests for cash-control endpoints under /day/cash/*.

The router is manager-gated in production, but the handler functions
themselves (which write the ledger events) are what the tests exercise
directly — the auth dependency is a FastAPI concern, not relevant to
the event-emission contract.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.api.routes import day_cash
from app.core.events import EventType
from app.models.config_events import PendingChange


async def _push(ledger, changes):
    bg = BackgroundTasks()
    await cfg.push_changes(changes=changes, background_tasks=bg, ledger=ledger)


@pytest.mark.asyncio
async def test_update_cash_float_emits_event_and_tracks_previous(ledger):
    first = await day_cash.update_cash_float(
        day_cash.FloatUpdateRequest(amount=Decimal("200.00"), set_by="mgr_alice"),
        ledger=ledger,
    )
    assert first["success"] is True
    assert Decimal(first["previous_float"]) == Decimal("0.00")

    second = await day_cash.update_cash_float(
        day_cash.FloatUpdateRequest(amount=Decimal("250.00"), set_by="mgr_alice",
                                    reason="Added lunch break float"),
        ledger=ledger,
    )
    assert Decimal(second["previous_float"]) == Decimal("200.00")

    events = await ledger.get_events_by_type(EventType.DAY_CASH_FLOAT_UPDATED)
    assert len(events) == 2
    assert events[0].payload["amount"] == Decimal("200.00")
    assert events[1].payload["previous_float"] == Decimal("200.00")
    assert events[1].payload["reason"] == "Added lunch break float"


@pytest.mark.asyncio
async def test_record_cash_drop_emits_event_with_audit_fields(ledger):
    await day_cash.record_cash_drop(
        day_cash.CashDropRequest(
            amount=Decimal("320.00"),
            approved_by="mgr_bob",
            reason="mid-shift drop",
            deposit_ref="DROP-2026-04-24-01",
        ),
        ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.DAY_CASH_DROP)
    assert len(events) == 1
    p = events[0].payload
    assert p["amount"] == Decimal("320.00")
    assert p["approved_by"] == "mgr_bob"
    assert p["deposit_ref"] == "DROP-2026-04-24-01"


@pytest.mark.asyncio
async def test_record_cash_payout_requires_recipient(ledger):
    with pytest.raises(Exception):
        # pydantic Field(min_length=1) rejects empty recipient before the handler runs
        day_cash.CashPayoutRequest(amount=Decimal("10.00"), recipient="")


@pytest.mark.asyncio
async def test_record_cash_payout_emits_event(ledger):
    await day_cash.record_cash_payout(
        day_cash.CashPayoutRequest(
            amount=Decimal("45.00"),
            recipient="Linen vendor",
            approved_by="mgr_alice",
            category="supplies",
        ),
        ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.DAY_CASH_PAYOUT)
    assert len(events) == 1
    p = events[0].payload
    assert p["amount"] == Decimal("45.00")
    assert p["recipient"] == "Linen vendor"
    assert p["category"] == "supplies"


# ── edge cases ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_multiple_float_resets_last_value_wins(ledger):
    """Float is an assignment, not an accumulation.  Only the final value counts."""
    for amount in ["100.00", "150.00", "200.00"]:
        await day_cash.update_cash_float(
            day_cash.FloatUpdateRequest(amount=Decimal(amount), set_by="mgr"),
            ledger=ledger,
        )
    result = await day_cash._compute_cash_variance(ledger)
    # Expected = last float (200), NOT sum 100+150+200=450
    assert result["expected_in_drawer"] == "200.00"
    assert Decimal(result["float"]) == Decimal("200")


@pytest.mark.asyncio
async def test_multiple_drops_accumulate(ledger):
    """Each drop is subtracted; they are cumulative unlike float."""
    await day_cash.update_cash_float(
        day_cash.FloatUpdateRequest(amount=Decimal("300.00"), set_by="mgr"),
        ledger=ledger,
    )
    await day_cash.record_cash_drop(
        day_cash.CashDropRequest(amount=Decimal("100.00"), approved_by="mgr", reason="first drop"),
        ledger=ledger,
    )
    await day_cash.record_cash_drop(
        day_cash.CashDropRequest(amount=Decimal("75.00"), approved_by="mgr", reason="second drop"),
        ledger=ledger,
    )
    result = await day_cash._compute_cash_variance(ledger)
    assert result["drops"] == "175.00"
    assert result["expected_in_drawer"] == "125.00"  # 300 - 100 - 75


@pytest.mark.asyncio
async def test_payout_category_is_optional(ledger):
    """Category field is not required on a cash payout."""
    result = await day_cash.record_cash_payout(
        day_cash.CashPayoutRequest(
            amount=Decimal("12.00"),
            recipient="Server Bob",
            approved_by="mgr",
            reason="cash tip out",
        ),
        ledger=ledger,
    )
    assert result["success"] is True
    events = await ledger.get_events_by_type(EventType.DAY_CASH_PAYOUT)
    assert events[0].payload.get("category") is None


@pytest.mark.asyncio
async def test_cash_sales_accumulate_card_excluded(ledger):
    """Multiple cash payments stack; card payments are invisible to variance."""
    await _push(ledger, [
        PendingChange(
            event_type="payment.confirmed",
            payload={"order_id": "o1", "payment_id": "p1",
                     "transaction_id": "t1", "amount": 30.00, "method": "cash"},
        ),
        PendingChange(
            event_type="payment.confirmed",
            payload={"order_id": "o2", "payment_id": "p2",
                     "transaction_id": "t2", "amount": 50.00, "method": "card"},
        ),
        PendingChange(
            event_type="payment.confirmed",
            payload={"order_id": "o3", "payment_id": "p3",
                     "transaction_id": "t3", "amount": 20.00, "method": "cash"},
        ),
    ])
    result = await day_cash._compute_cash_variance(ledger)
    assert result["cash_sales"] == "50.00"          # 30 + 20
    assert result["expected_in_drawer"] == "50.00"  # no float set


@pytest.mark.asyncio
async def test_refund_reduces_expected(ledger):
    """A cash refund reduces the expected drawer total."""
    await _push(ledger, [
        PendingChange(
            event_type="payment.confirmed",
            payload={"order_id": "o1", "payment_id": "p1",
                     "transaction_id": "t1", "amount": 60.00, "method": "cash"},
        ),
        PendingChange(
            event_type="payment.refunded",
            payload={"order_id": "o1", "payment_id": "p1",
                     "amount": 15.00, "method": "cash"},
        ),
    ])
    result = await day_cash._compute_cash_variance(ledger)
    assert result["cash_sales"] == "60.00"
    assert result["cash_refunds"] == "15.00"
    assert result["expected_in_drawer"] == "45.00"


@pytest.mark.asyncio
async def test_empty_recipient_rejected_at_model_level():
    """Pydantic Field(min_length=1) must reject blank recipient before handler runs."""
    import pydantic
    with pytest.raises((ValueError, pydantic.ValidationError)):
        day_cash.CashPayoutRequest(
            amount=Decimal("10.00"),
            recipient="",
            approved_by="mgr",
            reason="test",
        )
