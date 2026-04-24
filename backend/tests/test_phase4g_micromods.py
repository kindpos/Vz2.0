"""Phase 4g — micromod.* dark-ship tests.

The micromod feature is scaffolding only: enum + factory exist so the
overseer rollout has a stable emission point, and events flow through
the existing /config/push route. These tests pin the round-trip via
/config/push so the rollout can rely on the schema.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase4g.db")


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


@pytest.mark.asyncio
async def test_micromod_created_lands_in_ledger(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="micromod.created",
                payload={
                    "micromod_id": "micro_ranch",
                    "name": "Ranch",
                    "price": 0.50,
                    "modifier_id": "mod_sauce_on_side",
                },
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.MICROMOD_CREATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["micromod_id"] == "micro_ranch"
    assert p["modifier_id"] == "mod_sauce_on_side"


@pytest.mark.asyncio
async def test_micromod_price_changed_carries_delta(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="micromod.price_changed",
                payload={
                    "micromod_id": "micro_ranch",
                    "previous_price": 0.50,
                    "new_price": 0.75,
                    "changed_by": "mgr_alice",
                },
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.MICROMOD_PRICE_CHANGED)
    assert len(events) == 1
    p = events[0].payload
    assert p["previous_price"] == 0.50
    assert p["new_price"] == 0.75


@pytest.mark.asyncio
async def test_micromod_assignment_events_roundtrip(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="micromod.assigned_to_modifier",
                payload={
                    "micromod_id": "micro_ranch",
                    "modifier_id": "mod_sauce",
                },
            ),
            PendingChange(
                event_type="micromod.unassigned_from_modifier",
                payload={
                    "micromod_id": "micro_ranch",
                    "modifier_id": "mod_sauce",
                },
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    assigned = await ledger.get_events_by_type(EventType.MICROMOD_ASSIGNED_TO_MODIFIER)
    unassigned = await ledger.get_events_by_type(EventType.MICROMOD_UNASSIGNED_FROM_MODIFIER)
    assert len(assigned) == 1
    assert len(unassigned) == 1


@pytest.mark.asyncio
async def test_micromod_86_roundtrip(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="micromod.86ed",
                payload={"micromod_id": "micro_ranch", "reason": "out of ranch"},
            ),
            PendingChange(
                event_type="micromod.86_cleared",
                payload={"micromod_id": "micro_ranch"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    sixed = await ledger.get_events_by_type(EventType.MICROMOD_86ED)
    cleared = await ledger.get_events_by_type(EventType.MICROMOD_86_CLEARED)
    assert len(sixed) == 1
    assert len(cleared) == 1


@pytest.mark.asyncio
async def test_micromod_deactivate_reactivate_roundtrip(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="micromod.deactivated",
                payload={"micromod_id": "micro_ranch"},
            ),
            PendingChange(
                event_type="micromod.reactivated",
                payload={"micromod_id": "micro_ranch"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    assert len(await ledger.get_events_by_type(EventType.MICROMOD_DEACTIVATED)) == 1
    assert len(await ledger.get_events_by_type(EventType.MICROMOD_REACTIVATED)) == 1
