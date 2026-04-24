"""Phase 8 — seat-scoped financial + tipout calc dark-ship.

Seven new EventType entries, all emittable via /config/push:
- seat.discount_applied / seat.discount_voided / seat.comped
- seat.payment_voided
- tipout.calculated / tipout.adjusted / tipout.distributed
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase8.db")


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


async def _push(ledger, bg, changes):
    await cfg.push_changes(changes=changes, background_tasks=bg, ledger=ledger)


# ── LG-28 / LG-29 seat.discount_applied / voided ───────────────────────
@pytest.mark.asyncio
async def test_seat_discount_apply_void_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="seat.discount_applied",
            payload={
                "order_id": "o1", "seat_number": 2,
                "amount": 5.00, "discount_type": "10%",
                "approved_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="seat.discount_voided",
            payload={
                "order_id": "o1", "seat_number": 2,
                "amount": 5.00, "voided_by": "mgr_alice",
                "discount_type": "10%",
            },
        ),
    ])
    applied = await ledger.get_events_by_type(EventType.SEAT_DISCOUNT_APPLIED)
    voided = await ledger.get_events_by_type(EventType.SEAT_DISCOUNT_VOIDED)
    assert len(applied) == 1
    assert applied[0].payload["seat_number"] == 2
    assert len(voided) == 1


# ── LG-30 seat.comped ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_seat_comped_lands(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="seat.comped",
            payload={
                "order_id": "o1", "seat_number": 3,
                "amount": 24.50, "comped_by": "mgr_alice",
                "reason": "VIP guest", "comp_category": "guest_relations",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.SEAT_COMPED)
    assert len(events) == 1
    assert events[0].payload["comp_category"] == "guest_relations"


# ── LG-33 seat.payment_voided ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_seat_payment_voided_records_seat_scope(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="seat.payment_voided",
            payload={
                "order_id": "o1", "seat_number": 1,
                "payment_id": "pay_abc", "amount": 22.00,
                "voided_by": "mgr_alice", "reason": "wrong card on file",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.SEAT_PAYMENT_VOIDED)
    assert len(events) == 1
    p = events[0].payload
    assert p["seat_number"] == 1
    assert p["payment_id"] == "pay_abc"


# ── LG-99 tipout.calculated ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_tipout_calculated_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="tipout.calculated",
            payload={
                "tipout_id": "to_2026_04_24",
                "shift_date": "2026-04-24",
                "total_tipout": 84.50,
                "rule_ids": ["rule_bar", "rule_bussers"],
                "breakdown": [
                    {"recipient_id": "e2", "amount": 40.00},
                    {"recipient_id": "e3", "amount": 44.50},
                ],
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.TIPOUT_CALCULATED)
    assert len(events) == 1
    assert events[0].payload["total_tipout"] == 84.50


# ── LG-100 / LG-101 tipout adjusted + distributed ───────────────────────
@pytest.mark.asyncio
async def test_tipout_adjusted_and_distributed_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="tipout.adjusted",
            payload={
                "tipout_id": "to_2026_04_24",
                "recipient_id": "e2",
                "previous_amount": 40.00,
                "new_amount": 45.00,
                "adjusted_by": "mgr_alice",
                "reason": "manager override",
            },
        ),
        PendingChange(
            event_type="tipout.distributed",
            payload={
                "tipout_id": "to_2026_04_24",
                "total_distributed": 89.50,
                "distributed_by": "mgr_alice",
                "recipient_count": 2,
            },
        ),
    ])
    adjusted = await ledger.get_events_by_type(EventType.TIPOUT_ADJUSTED)
    distributed = await ledger.get_events_by_type(EventType.TIPOUT_DISTRIBUTED)
    assert len(adjusted) == 1
    assert len(distributed) == 1
    assert distributed[0].payload["recipient_count"] == 2
