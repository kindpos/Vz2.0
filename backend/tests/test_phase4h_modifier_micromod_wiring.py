"""Phase 4h — modifier lifecycle projection + micromod wiring.

Verifies:
1. get_modifier_groups() replays individual modifier lifecycle events
   (86ed, 86_cleared, deactivated, reactivated, price_changed) and
   reflects them in the returned ModifierOption objects.
2. get_micromods() projects the full micromod catalog from events.
3. /config/push with micromod.* events adds "modifiers" to the
   broadcast sections set.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.core.event_ledger import EventLedger
from app.models.config_events import PendingChange
from app.services.overseer_config_service import OverseerConfigService


TEST_DB = Path("./data/test_phase4h.db")


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


# ── helpers ──────────────────────────────────────────────────────────────────

async def _push(ledger, bg, *changes):
    await cfg.push_changes(
        changes=[PendingChange(**c) for c in changes],
        background_tasks=bg,
        ledger=ledger,
    )


def _find_modifier(groups, modifier_id):
    for g in groups:
        for m in g.modifiers:
            if m.modifier_id == modifier_id:
                return m
    return None


# ── modifier lifecycle projection ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_modifier_86_reflected_in_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "modifier.group_created", "payload": {
            "group_id": "grp_sauces",
            "name": "Sauces",
            "modifier_ids": ["mod_ranch"],
            "modifiers": [{"modifier_id": "mod_ranch", "name": "Ranch", "price": 0}],
        }},
    )
    svc = OverseerConfigService(ledger)
    groups = await svc.get_modifier_groups()
    mod = _find_modifier(groups, "mod_ranch")
    assert mod is not None
    assert mod.is_86d is False

    await _push(ledger, bg,
        {"event_type": "modifier.86ed", "payload": {"modifier_id": "mod_ranch", "reason": "out of ranch"}},
    )
    groups = await svc.get_modifier_groups()
    mod = _find_modifier(groups, "mod_ranch")
    assert mod.is_86d is True


@pytest.mark.asyncio
async def test_modifier_86_cleared_restores_availability(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "modifier.group_created", "payload": {
            "group_id": "grp_sauces",
            "name": "Sauces",
            "modifier_ids": ["mod_ranch"],
            "modifiers": [{"modifier_id": "mod_ranch", "name": "Ranch", "price": 0}],
        }},
        {"event_type": "modifier.86ed", "payload": {"modifier_id": "mod_ranch"}},
        {"event_type": "modifier.86_cleared", "payload": {"modifier_id": "mod_ranch"}},
    )
    svc = OverseerConfigService(ledger)
    groups = await svc.get_modifier_groups()
    mod = _find_modifier(groups, "mod_ranch")
    assert mod.is_86d is False


@pytest.mark.asyncio
async def test_modifier_deactivate_reactivate_reflected_in_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "modifier.group_created", "payload": {
            "group_id": "grp_proteins",
            "name": "Proteins",
            "modifier_ids": ["mod_chicken"],
            "modifiers": [{"modifier_id": "mod_chicken", "name": "Chicken", "price": 2.00}],
        }},
    )
    svc = OverseerConfigService(ledger)

    await _push(ledger, bg,
        {"event_type": "modifier.deactivated", "payload": {"modifier_id": "mod_chicken"}},
    )
    groups = await svc.get_modifier_groups()
    mod = _find_modifier(groups, "mod_chicken")
    assert mod.active is False

    await _push(ledger, bg,
        {"event_type": "modifier.reactivated", "payload": {"modifier_id": "mod_chicken"}},
    )
    groups = await svc.get_modifier_groups()
    mod = _find_modifier(groups, "mod_chicken")
    assert mod.active is True


@pytest.mark.asyncio
async def test_modifier_price_change_reflected_in_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "modifier.group_created", "payload": {
            "group_id": "grp_extras",
            "name": "Extras",
            "modifier_ids": ["mod_avocado"],
            "modifiers": [{"modifier_id": "mod_avocado", "name": "Avocado", "price": 1.50}],
        }},
    )
    svc = OverseerConfigService(ledger)

    await _push(ledger, bg,
        {"event_type": "modifier.price_changed", "payload": {
            "modifier_id": "mod_avocado",
            "previous_price": 1.50,
            "new_price": 2.00,
        }},
    )
    groups = await svc.get_modifier_groups()
    mod = _find_modifier(groups, "mod_avocado")
    assert Decimal(str(mod.price)) == Decimal("2.00")


# ── micromod projection ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_micromods_empty_when_no_events(ledger):
    svc = OverseerConfigService(ledger)
    result = await svc.get_micromods()
    assert result == []


@pytest.mark.asyncio
async def test_micromod_created_appears_in_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "micromod.created", "payload": {
            "micromod_id": "mm_ranch",
            "name": "Ranch",
            "price": 0.50,
            "modifier_id": "mod_sauce_side",
        }},
    )
    svc = OverseerConfigService(ledger)
    mms = await svc.get_micromods()
    assert len(mms) == 1
    mm = mms[0]
    assert mm.micromod_id == "mm_ranch"
    assert mm.name == "Ranch"
    assert mm.modifier_id == "mod_sauce_side"
    assert mm.active is True
    assert mm.is_86d is False


@pytest.mark.asyncio
async def test_micromod_price_changed_updates_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "micromod.created", "payload": {
            "micromod_id": "mm_ranch", "name": "Ranch", "price": 0.50,
        }},
        {"event_type": "micromod.price_changed", "payload": {
            "micromod_id": "mm_ranch", "previous_price": 0.50, "new_price": 0.75,
        }},
    )
    svc = OverseerConfigService(ledger)
    mms = await svc.get_micromods()
    assert len(mms) == 1
    assert Decimal(str(mms[0].price)) == Decimal("0.75")


@pytest.mark.asyncio
async def test_micromod_86_and_cleared_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "micromod.created", "payload": {
            "micromod_id": "mm_bbq", "name": "BBQ", "price": 0,
        }},
        {"event_type": "micromod.86ed", "payload": {"micromod_id": "mm_bbq"}},
    )
    svc = OverseerConfigService(ledger)
    mms = await svc.get_micromods()
    assert mms[0].is_86d is True

    await _push(ledger, bg,
        {"event_type": "micromod.86_cleared", "payload": {"micromod_id": "mm_bbq"}},
    )
    mms = await svc.get_micromods()
    assert mms[0].is_86d is False


@pytest.mark.asyncio
async def test_micromod_deactivate_reactivate_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "micromod.created", "payload": {
            "micromod_id": "mm_honey", "name": "Honey Mustard", "price": 0,
        }},
        {"event_type": "micromod.deactivated", "payload": {"micromod_id": "mm_honey"}},
    )
    svc = OverseerConfigService(ledger)
    mms = await svc.get_micromods()
    assert mms[0].active is False

    await _push(ledger, bg,
        {"event_type": "micromod.reactivated", "payload": {"micromod_id": "mm_honey"}},
    )
    mms = await svc.get_micromods()
    assert mms[0].active is True


@pytest.mark.asyncio
async def test_micromod_assign_unassign_projection(ledger, bg):
    await _push(ledger, bg,
        {"event_type": "micromod.created", "payload": {
            "micromod_id": "mm_caesar", "name": "Caesar", "price": 0,
        }},
        {"event_type": "micromod.assigned_to_modifier", "payload": {
            "micromod_id": "mm_caesar", "modifier_id": "mod_dressing",
        }},
    )
    svc = OverseerConfigService(ledger)
    mms = await svc.get_micromods()
    assert mms[0].modifier_id == "mod_dressing"

    await _push(ledger, bg,
        {"event_type": "micromod.unassigned_from_modifier", "payload": {
            "micromod_id": "mm_caesar", "modifier_id": "mod_dressing",
        }},
    )
    mms = await svc.get_micromods()
    assert mms[0].modifier_id is None


# ── micromod broadcast section ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_micromod_push_queues_modifiers_broadcast(ledger, bg):
    """Pushing a micromod.* event must queue a broadcast for the 'modifiers'
    section so terminals know to re-sync their modifier catalog."""
    result = await cfg.push_changes(
        changes=[PendingChange(
            event_type="micromod.created",
            payload={"micromod_id": "mm_test", "name": "Test Sauce", "price": 0},
        )],
        background_tasks=bg,
        ledger=ledger,
    )
    assert result["events_written"] == 1
    # BackgroundTasks collects tasks synchronously; inspect the queued call.
    assert len(bg.tasks) == 1
    task = bg.tasks[0]
    # First positional arg to broadcast_config_update is the sections list.
    sections_arg = task.args[0] if task.args else (task.kwargs.get("sections") or [])
    assert "modifiers" in sections_arg
