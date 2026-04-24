"""Phase 10 — Discount catalog CRUD (closes LG-87, LG-88, LG-89).

Four new EventType entries, all emittable via /config/push:
- discount.created   (LG-87)
- discount.updated   (LG-88)
- discount.deactivated (LG-89a)
- discount.reactivated (LG-89b)
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


TEST_DB = Path("./data/test_phase10.db")


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
    return await cfg.push_changes(changes=changes, background_tasks=bg, ledger=ledger)


# ── LG-87 discount.created ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_discount_created_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="discount.created",
            payload={
                "discount_id": "disc_001",
                "name": "Happy Hour 20%",
                "discount_type": "percentage",
                "amount": "20.00",
                "applies_to": "check",
                "created_by": "mgr_bob",
                "requires_approval": True,
                "auto_apply": False,
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.DISCOUNT_CREATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["discount_id"] == "disc_001"
    assert p["name"] == "Happy Hour 20%"
    assert p["discount_type"] == "percentage"
    assert p["requires_approval"] is True
    assert p["auto_apply"] is False
    assert p["created_by"] == "mgr_bob"


@pytest.mark.asyncio
async def test_discount_created_minimal_payload(ledger, bg):
    """discount.created lands with only required fields; optional booleans
    are absent from the payload when not sent (push_changes is a raw pass-through)."""
    await _push(ledger, bg, [
        PendingChange(
            event_type="discount.created",
            payload={
                "discount_id": "disc_002",
                "name": "Staff Meal",
                "discount_type": "flat_dollar",
                "amount": "10.00",
                "applies_to": "item",
                "created_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.DISCOUNT_CREATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["discount_id"] == "disc_002"
    assert p["name"] == "Staff Meal"
    assert p["created_by"] == "mgr_alice"


# ── LG-88 discount.updated ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_discount_updated_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="discount.updated",
            payload={
                "discount_id": "disc_001",
                "fields_changed": {"name": "Happy Hour 25%", "amount": "25.00"},
                "updated_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.DISCOUNT_UPDATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["discount_id"] == "disc_001"
    assert p["fields_changed"]["name"] == "Happy Hour 25%"
    assert p["updated_by"] == "mgr_alice"


# ── LG-89a discount.deactivated ────────────────────────────────────────
@pytest.mark.asyncio
async def test_discount_deactivated_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="discount.deactivated",
            payload={
                "discount_id": "disc_001",
                "deactivated_by": "mgr_bob",
                "reason": "Promotion ended",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.DISCOUNT_DEACTIVATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["discount_id"] == "disc_001"
    assert p["deactivated_by"] == "mgr_bob"
    assert p["reason"] == "Promotion ended"


@pytest.mark.asyncio
async def test_discount_deactivated_no_reason(ledger, bg):
    """reason is optional — omitting it should not error."""
    await _push(ledger, bg, [
        PendingChange(
            event_type="discount.deactivated",
            payload={
                "discount_id": "disc_002",
                "deactivated_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.DISCOUNT_DEACTIVATED)
    assert len(events) == 1
    assert "reason" not in events[0].payload


# ── LG-89b discount.reactivated ────────────────────────────────────────
@pytest.mark.asyncio
async def test_discount_reactivated_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="discount.reactivated",
            payload={
                "discount_id": "disc_001",
                "reactivated_by": "mgr_bob",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.DISCOUNT_REACTIVATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["discount_id"] == "disc_001"
    assert p["reactivated_by"] == "mgr_bob"


# ── Full lifecycle ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_discount_full_lifecycle(ledger, bg):
    """created → updated → deactivated → reactivated all land in one push."""
    result = await _push(ledger, bg, [
        PendingChange(
            event_type="discount.created",
            payload={
                "discount_id": "disc_lc",
                "name": "Lifecycle Test",
                "discount_type": "percentage",
                "amount": "15.00",
                "applies_to": "check",
                "created_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="discount.updated",
            payload={
                "discount_id": "disc_lc",
                "fields_changed": {"amount": "10.00"},
                "updated_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="discount.deactivated",
            payload={
                "discount_id": "disc_lc",
                "deactivated_by": "mgr_bob",
            },
        ),
        PendingChange(
            event_type="discount.reactivated",
            payload={
                "discount_id": "disc_lc",
                "reactivated_by": "mgr_alice",
            },
        ),
    ])
    assert result["events_written"] == 4

    created = await ledger.get_events_by_type(EventType.DISCOUNT_CREATED)
    updated = await ledger.get_events_by_type(EventType.DISCOUNT_UPDATED)
    deactivated = await ledger.get_events_by_type(EventType.DISCOUNT_DEACTIVATED)
    reactivated = await ledger.get_events_by_type(EventType.DISCOUNT_REACTIVATED)

    assert len(created) == 1
    assert len(updated) == 1
    assert len(deactivated) == 1
    assert len(reactivated) == 1


# ── Section inference ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_discount_section_inferred(ledger, bg):
    """discount.* events must not raise and must write to the ledger."""
    result = await _push(ledger, bg, [
        PendingChange(
            event_type="discount.created",
            payload={
                "discount_id": "disc_sec",
                "name": "Section Test",
                "discount_type": "flat_dollar",
                "amount": "5.00",
                "applies_to": "seat",
                "created_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="discount.updated",
            payload={
                "discount_id": "disc_sec",
                "fields_changed": {"name": "Section Test Updated"},
                "updated_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="discount.deactivated",
            payload={"discount_id": "disc_sec", "deactivated_by": "mgr_alice"},
        ),
        PendingChange(
            event_type="discount.reactivated",
            payload={"discount_id": "disc_sec", "reactivated_by": "mgr_alice"},
        ),
    ])
    assert result["events_written"] == 4


# ── EventType enum smoke test ───────────────────────────────────────────
def test_event_type_entries_exist():
    """Verify all four new EventType entries are present in the enum."""
    assert EventType.DISCOUNT_CREATED.value == "discount.created"
    assert EventType.DISCOUNT_UPDATED.value == "discount.updated"
    assert EventType.DISCOUNT_DEACTIVATED.value == "discount.deactivated"
    assert EventType.DISCOUNT_REACTIVATED.value == "discount.reactivated"
