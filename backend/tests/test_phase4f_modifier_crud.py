"""Phase 4f — modifier CRUD (modifier.created/updated/price_changed/
deactivated/reactivated/86ed/86_cleared).

The events flow through /config/push (the existing overseer batch
push), not via dedicated routes. Tests assert that pushing each event
type lands the right enum in the ledger with the right payload.
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


TEST_DB = Path("./data/test_phase4f.db")


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
async def test_modifier_created_lands_in_ledger(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="modifier.created",
                payload={
                    "modifier_id": "mod_bacon",
                    "name": "Add Bacon",
                    "price": 1.50,
                    "modifier_group_id": "grp_addons",
                },
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.MODIFIER_CREATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["modifier_id"] == "mod_bacon"
    assert p["name"] == "Add Bacon"
    assert p["modifier_group_id"] == "grp_addons"


@pytest.mark.asyncio
async def test_modifier_price_changed_carries_delta(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="modifier.price_changed",
                payload={
                    "modifier_id": "mod_bacon",
                    "previous_price": 1.50,
                    "new_price": 1.75,
                    "changed_by": "mgr_alice",
                },
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.MODIFIER_PRICE_CHANGED)
    assert len(events) == 1
    p = events[0].payload
    assert p["previous_price"] == 1.50
    assert p["new_price"] == 1.75
    assert p["changed_by"] == "mgr_alice"


@pytest.mark.asyncio
async def test_modifier_86ed_and_cleared_roundtrip(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="modifier.86ed",
                payload={"modifier_id": "mod_bacon", "reason": "supplier outage"},
            ),
            PendingChange(
                event_type="modifier.86_cleared",
                payload={"modifier_id": "mod_bacon", "cleared_by": "mgr_alice"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    eighty_sixed = await ledger.get_events_by_type(EventType.MODIFIER_86ED)
    cleared = await ledger.get_events_by_type(EventType.MODIFIER_86_CLEARED)
    assert len(eighty_sixed) == 1
    assert len(cleared) == 1
    assert eighty_sixed[0].payload["reason"] == "supplier outage"
    assert cleared[0].payload["cleared_by"] == "mgr_alice"


@pytest.mark.asyncio
async def test_modifier_deactivate_reactivate_roundtrip(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="modifier.deactivated",
                payload={"modifier_id": "mod_bacon", "deactivated_by": "mgr_alice"},
            ),
            PendingChange(
                event_type="modifier.reactivated",
                payload={"modifier_id": "mod_bacon", "reactivated_by": "mgr_alice"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    deact = await ledger.get_events_by_type(EventType.MODIFIER_DEACTIVATED)
    react = await ledger.get_events_by_type(EventType.MODIFIER_REACTIVATED)
    assert len(deact) == 1
    assert len(react) == 1


@pytest.mark.asyncio
async def test_modifier_updated_records_changed_fields(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="modifier.updated",
                payload={
                    "modifier_id": "mod_bacon",
                    "fields_changed": ["name", "sort_order"],
                    "updated_by": "mgr_alice",
                },
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.MODIFIER_UPDATED)
    assert len(events) == 1
    assert events[0].payload["fields_changed"] == ["name", "sort_order"]
