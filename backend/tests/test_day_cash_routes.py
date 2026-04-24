"""Tests for cash-control endpoints under /day/cash/*.

The router is manager-gated in production, but the handler functions
themselves (which write the ledger events) are what the tests exercise
directly — the auth dependency is a FastAPI concern, not relevant to
the event-emission contract.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.api.routes import day_cash
from app.core.events import EventType


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
