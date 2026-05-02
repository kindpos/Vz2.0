"""Modifier-group membership and micromod assignment routes.

Covers:
  POST   /modifier-groups/{group_id}/modifiers/{modifier_id}
  DELETE /modifier-groups/{group_id}/modifiers/{modifier_id}
  POST   /modifiers/{modifier_id}/micromods/{micromod_id}
  DELETE /modifiers/{modifier_id}/micromods/{micromod_id}

All four route handlers must be idempotent: re-adding an existing
member or removing an absent one is a no-op, not an error.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio

from app.api.routes import modifier_groups as mg_routes
from app.api.routes import modifiers as mod_routes
from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event
from app.core.menu_projection import project_menu


TEST_DB = Path("./data/test_modifier_group_membership.db")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _seed_group(ledger, group_id="grp_a", name="Add-ons"):
    """Insert a MODIFIER_GROUP_CREATED event so the group is projectable."""
    event = create_event(
        event_type=EventType.MODIFIER_GROUP_CREATED,
        terminal_id="OVERSEER",
        payload={"group_id": group_id, "name": name, "modifiers": []},
    )
    await ledger.append(event)


async def _seed_modifier_in_group(ledger, group_id, modifier_id, name="Bacon"):
    """Place a fully-shaped modifier dict inside a group via MODIFIER_GROUP_UPDATED.

    The route handlers under test use ``_get_modifier`` which looks up
    ``menu.modifiers[modifier_id]`` — that flat dict is built from each
    group's ``modifiers`` list during projection finalization.
    """
    event = create_event(
        event_type=EventType.MODIFIER_GROUP_UPDATED,
        terminal_id="OVERSEER",
        payload={
            "group_id": group_id,
            "modifiers": [{"modifier_id": modifier_id, "name": name}],
        },
    )
    await ledger.append(event)


def _group_modifier_ids(state, group_id):
    grp = state.modifier_groups_by_id.get(group_id, {})
    return [m.get("modifier_id") for m in grp.get("modifiers", []) if isinstance(m, dict)]


def _modifier_micromod_ids(state, modifier_id):
    mod = state.modifiers.get(modifier_id, {})
    return list(mod.get("included_modifier_ids", []))


# ─── Modifier-to-group membership ──────────────────────────────────────


@pytest.mark.asyncio
async def test_add_modifier_to_group(ledger):
    await _seed_group(ledger, "grp_a")
    res = await mg_routes.add_modifier_to_group(
        group_id="grp_a", modifier_id="mod_bacon", ledger=ledger,
    )
    assert res == {"status": "ok", "group_id": "grp_a", "modifier_id": "mod_bacon"}

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    assert "mod_bacon" in _group_modifier_ids(state, "grp_a")


@pytest.mark.asyncio
async def test_add_modifier_idempotent(ledger):
    await _seed_group(ledger, "grp_a")
    await mg_routes.add_modifier_to_group("grp_a", "mod_bacon", ledger)
    await mg_routes.add_modifier_to_group("grp_a", "mod_bacon", ledger)

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    ids = _group_modifier_ids(state, "grp_a")
    assert ids.count("mod_bacon") == 1


@pytest.mark.asyncio
async def test_remove_modifier_from_group(ledger):
    await _seed_group(ledger, "grp_a")
    await mg_routes.add_modifier_to_group("grp_a", "mod_bacon", ledger)
    await mg_routes.remove_modifier_from_group("grp_a", "mod_bacon", ledger)

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    assert "mod_bacon" not in _group_modifier_ids(state, "grp_a")


@pytest.mark.asyncio
async def test_remove_modifier_idempotent_when_absent(ledger):
    await _seed_group(ledger, "grp_a")
    res = await mg_routes.remove_modifier_from_group("grp_a", "mod_ghost", ledger)
    assert res["status"] == "ok"

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    assert _group_modifier_ids(state, "grp_a") == []


# ─── Micromod-to-modifier assignment ────────────────────────────────────


@pytest.mark.asyncio
async def test_assign_micromod_to_modifier(ledger):
    await _seed_group(ledger, "grp_a")
    await _seed_modifier_in_group(ledger, "grp_a", "mod_bacon")

    res = await mod_routes.assign_micromod_to_modifier(
        modifier_id="mod_bacon", micromod_id="mm_crispy", ledger=ledger,
    )
    assert res == {"status": "ok", "modifier_id": "mod_bacon", "micromod_id": "mm_crispy"}

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    assert "mm_crispy" in _modifier_micromod_ids(state, "mod_bacon")


@pytest.mark.asyncio
async def test_assign_micromod_idempotent(ledger):
    await _seed_group(ledger, "grp_a")
    await _seed_modifier_in_group(ledger, "grp_a", "mod_bacon")

    await mod_routes.assign_micromod_to_modifier("mod_bacon", "mm_crispy", ledger)
    await mod_routes.assign_micromod_to_modifier("mod_bacon", "mm_crispy", ledger)

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    ids = _modifier_micromod_ids(state, "mod_bacon")
    assert ids.count("mm_crispy") == 1


@pytest.mark.asyncio
async def test_unassign_micromod_from_modifier(ledger):
    await _seed_group(ledger, "grp_a")
    await _seed_modifier_in_group(ledger, "grp_a", "mod_bacon")
    await mod_routes.assign_micromod_to_modifier("mod_bacon", "mm_crispy", ledger)
    await mod_routes.unassign_micromod_from_modifier("mod_bacon", "mm_crispy", ledger)

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    assert "mm_crispy" not in _modifier_micromod_ids(state, "mod_bacon")


@pytest.mark.asyncio
async def test_unassign_micromod_idempotent_when_absent(ledger):
    await _seed_group(ledger, "grp_a")
    await _seed_modifier_in_group(ledger, "grp_a", "mod_bacon")

    res = await mod_routes.unassign_micromod_from_modifier("mod_bacon", "mm_ghost", ledger)
    assert res["status"] == "ok"

    state = project_menu(await ledger.get_events_since(0, limit=10000))
    assert "mm_ghost" not in _modifier_micromod_ids(state, "mod_bacon")
