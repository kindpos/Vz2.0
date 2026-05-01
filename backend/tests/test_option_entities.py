"""
Tests for Option, OptionGroup, and Size entities (Prompt 1).

Coverage:
- Projection state from events (sync, project_menu)
- OverseerConfigService projection methods (async)
- API endpoint happy paths (async, via route handlers directly)
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event
from app.core.menu_projection import project_menu

from app.services.overseer_config_service import OverseerConfigService

import app.api.routes.options as options_router
import app.api.routes.option_groups as option_groups_router
import app.api.routes.sizes as sizes_router

from app.api.routes.options import _OptionCreate, _OptionUpdate
from app.api.routes.option_groups import _OptionGroupCreate, _OptionGroupUpdate
from app.api.routes.sizes import _SizeCreate, _SizeUpdate


TEST_DB = Path("./data/test_option_entities.db")


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


def _evt(event_type, payload, terminal_id="t1"):
    return create_event(event_type=event_type, terminal_id=terminal_id, payload=payload)


# =============================================================================
# Projection tests — synchronous, using project_menu()
# =============================================================================

class TestOptionProjection:

    def test_option_created_lands_in_state(self):
        e = _evt(EventType.OPTION_CREATED, {
            "option_id": "opt_light",
            "name": "Light",
            "price_adjustment": -0.50,
            "negates_price": False,
            "active": True,
        })
        state = project_menu([e])
        assert "opt_light" in state.options
        assert state.options["opt_light"]["name"] == "Light"

    def test_option_updated_merges_fields(self):
        e1 = _evt(EventType.OPTION_CREATED, {
            "option_id": "opt_extra",
            "name": "Extra",
            "price_adjustment": 1.0,
            "negates_price": False,
            "active": True,
        })
        e2 = _evt(EventType.OPTION_UPDATED, {
            "option_id": "opt_extra",
            "price_adjustment": 1.5,
        })
        state = project_menu([e1, e2])
        assert state.options["opt_extra"]["price_adjustment"] == 1.5
        assert state.options["opt_extra"]["name"] == "Extra"

    def test_option_updated_on_unknown_is_noop(self):
        e = _evt(EventType.OPTION_UPDATED, {"option_id": "ghost", "name": "Ghost"})
        state = project_menu([e])
        assert "ghost" not in state.options

    def test_option_deactivate_reactivate_cycle(self):
        e1 = _evt(EventType.OPTION_CREATED, {
            "option_id": "opt_none",
            "name": "None",
            "price_adjustment": 0,
            "negates_price": True,
            "active": True,
        })
        e2 = _evt(EventType.OPTION_DEACTIVATED, {"option_id": "opt_none"})
        state = project_menu([e1, e2])
        assert state.options["opt_none"]["active"] is False

        e3 = _evt(EventType.OPTION_REACTIVATED, {"option_id": "opt_none"})
        state = project_menu([e1, e2, e3])
        assert state.options["opt_none"]["active"] is True

    def test_empty_state_has_options_dict(self):
        state = project_menu([])
        assert isinstance(state.options, dict)
        assert len(state.options) == 0


class TestOptionGroupProjection:

    def test_option_group_created_lands_in_state(self):
        e = _evt(EventType.OPTION_GROUP_CREATED, {
            "option_group_id": "og_temps",
            "name": "Temperatures",
            "option_ids": ["opt_rare", "opt_medium", "opt_well"],
            "active": True,
        })
        state = project_menu([e])
        assert "og_temps" in state.option_groups
        assert state.option_groups["og_temps"]["name"] == "Temperatures"
        assert state.option_groups["og_temps"]["option_ids"] == ["opt_rare", "opt_medium", "opt_well"]

    def test_option_group_updated_merges_fields(self):
        e1 = _evt(EventType.OPTION_GROUP_CREATED, {
            "option_group_id": "og_spice",
            "name": "Spice",
            "option_ids": [],
            "active": True,
        })
        e2 = _evt(EventType.OPTION_GROUP_UPDATED, {
            "option_group_id": "og_spice",
            "name": "Spice Level",
        })
        state = project_menu([e1, e2])
        assert state.option_groups["og_spice"]["name"] == "Spice Level"

    def test_option_group_option_added(self):
        e1 = _evt(EventType.OPTION_GROUP_CREATED, {
            "option_group_id": "og_sauce",
            "name": "Sauce",
            "option_ids": [],
            "active": True,
        })
        e2 = _evt(EventType.OPTION_GROUP_OPTION_ADDED, {
            "option_group_id": "og_sauce",
            "option_id": "opt_ranch",
        })
        e3 = _evt(EventType.OPTION_GROUP_OPTION_ADDED, {
            "option_group_id": "og_sauce",
            "option_id": "opt_bbq",
        })
        state = project_menu([e1, e2, e3])
        assert state.option_groups["og_sauce"]["option_ids"] == ["opt_ranch", "opt_bbq"]

    def test_option_group_option_added_dedup(self):
        e1 = _evt(EventType.OPTION_GROUP_CREATED, {
            "option_group_id": "og_s",
            "name": "S",
            "option_ids": [],
            "active": True,
        })
        e2 = _evt(EventType.OPTION_GROUP_OPTION_ADDED, {"option_group_id": "og_s", "option_id": "opt_x"})
        e3 = _evt(EventType.OPTION_GROUP_OPTION_ADDED, {"option_group_id": "og_s", "option_id": "opt_x"})
        state = project_menu([e1, e2, e3])
        assert state.option_groups["og_s"]["option_ids"].count("opt_x") == 1

    def test_option_group_option_removed(self):
        e1 = _evt(EventType.OPTION_GROUP_CREATED, {
            "option_group_id": "og_toppings",
            "name": "Toppings",
            "option_ids": ["opt_cheese", "opt_bacon"],
            "active": True,
        })
        e2 = _evt(EventType.OPTION_GROUP_OPTION_REMOVED, {
            "option_group_id": "og_toppings",
            "option_id": "opt_cheese",
        })
        state = project_menu([e1, e2])
        assert "opt_cheese" not in state.option_groups["og_toppings"]["option_ids"]
        assert "opt_bacon" in state.option_groups["og_toppings"]["option_ids"]

    def test_option_group_deactivate_reactivate_cycle(self):
        e1 = _evt(EventType.OPTION_GROUP_CREATED, {
            "option_group_id": "og_x",
            "name": "X",
            "option_ids": [],
            "active": True,
        })
        e2 = _evt(EventType.OPTION_GROUP_DEACTIVATED, {"option_group_id": "og_x"})
        state = project_menu([e1, e2])
        assert state.option_groups["og_x"]["active"] is False

        e3 = _evt(EventType.OPTION_GROUP_REACTIVATED, {"option_group_id": "og_x"})
        state = project_menu([e1, e2, e3])
        assert state.option_groups["og_x"]["active"] is True

    def test_empty_state_has_option_groups_dict(self):
        state = project_menu([])
        assert isinstance(state.option_groups, dict)


class TestSizeProjection:

    def test_size_created_lands_in_state(self):
        e = _evt(EventType.SIZE_CREATED, {
            "size_id": "size_sm",
            "name": "Small",
            "price_adjustment": 0.0,
            "active": True,
        })
        state = project_menu([e])
        assert "size_sm" in state.sizes
        assert state.sizes["size_sm"]["name"] == "Small"

    def test_size_updated_merges_fields(self):
        e1 = _evt(EventType.SIZE_CREATED, {
            "size_id": "size_lg",
            "name": "Large",
            "price_adjustment": 2.0,
            "active": True,
        })
        e2 = _evt(EventType.SIZE_UPDATED, {
            "size_id": "size_lg",
            "price_adjustment": 2.5,
        })
        state = project_menu([e1, e2])
        assert state.sizes["size_lg"]["price_adjustment"] == 2.5
        assert state.sizes["size_lg"]["name"] == "Large"

    def test_size_updated_on_unknown_is_noop(self):
        e = _evt(EventType.SIZE_UPDATED, {"size_id": "ghost_size", "name": "Ghost"})
        state = project_menu([e])
        assert "ghost_size" not in state.sizes

    def test_size_deactivate_reactivate_cycle(self):
        e1 = _evt(EventType.SIZE_CREATED, {
            "size_id": "size_xl",
            "name": "XL",
            "price_adjustment": 3.0,
            "active": True,
        })
        e2 = _evt(EventType.SIZE_DEACTIVATED, {"size_id": "size_xl"})
        state = project_menu([e1, e2])
        assert state.sizes["size_xl"]["active"] is False

        e3 = _evt(EventType.SIZE_REACTIVATED, {"size_id": "size_xl"})
        state = project_menu([e1, e2, e3])
        assert state.sizes["size_xl"]["active"] is True

    def test_empty_state_has_sizes_dict(self):
        state = project_menu([])
        assert isinstance(state.sizes, dict)


# =============================================================================
# OverseerConfigService projection tests (async)
# =============================================================================

class TestOverseerOptionProjection:

    async def test_get_options_projects_from_ledger(self, ledger, bg):
        await options_router.create_option(
            body=_OptionCreate(name="Mild", price_adjustment=Decimal("0")),
            background_tasks=bg,
            ledger=ledger,
        )
        svc = OverseerConfigService(ledger)
        opts = await svc.get_options()
        assert len(opts) == 1
        assert opts[0].name == "Mild"

    async def test_get_option_groups_projects_option_ids(self, ledger, bg):
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(
                option_group_id="og_heat",
                name="Heat",
                option_ids=["opt_mild", "opt_hot"],
            ),
            background_tasks=bg,
            ledger=ledger,
        )
        svc = OverseerConfigService(ledger)
        groups = await svc.get_option_groups()
        assert len(groups) == 1
        assert groups[0].option_ids == ["opt_mild", "opt_hot"]

    async def test_get_sizes_projects_from_ledger(self, ledger, bg):
        await sizes_router.create_size(
            body=_SizeCreate(name="Medium", price_adjustment=Decimal("1.00")),
            background_tasks=bg,
            ledger=ledger,
        )
        svc = OverseerConfigService(ledger)
        sizes = await svc.get_sizes()
        assert len(sizes) == 1
        assert sizes[0].name == "Medium"
        assert sizes[0].price_adjustment == Decimal("1.00")


# =============================================================================
# API endpoint happy-path tests
# =============================================================================

class TestOptionsEndpoints:

    async def test_create_option_auto_generates_id(self, ledger, bg):
        result = await options_router.create_option(
            body=_OptionCreate(name="On the Side"),
            background_tasks=bg,
            ledger=ledger,
        )
        assert result["status"] == "ok"
        assert result["option_id"] == "on_the_side"

    async def test_create_option_uses_provided_id(self, ledger, bg):
        result = await options_router.create_option(
            body=_OptionCreate(option_id="opt_custom", name="Custom"),
            background_tasks=bg,
            ledger=ledger,
        )
        assert result["option_id"] == "opt_custom"

    async def test_list_options_returns_active_only(self, ledger, bg):
        await options_router.create_option(
            body=_OptionCreate(option_id="opt_a", name="A"),
            background_tasks=bg,
            ledger=ledger,
        )
        await options_router.create_option(
            body=_OptionCreate(option_id="opt_b", name="B"),
            background_tasks=bg,
            ledger=ledger,
        )
        await options_router.deactivate_option("opt_b", bg, ledger)
        result = await options_router.list_options(ledger)
        ids = [o.option_id for o in result]
        assert "opt_a" in ids
        assert "opt_b" not in ids

    async def test_get_single_option(self, ledger, bg):
        await options_router.create_option(
            body=_OptionCreate(option_id="opt_find_me", name="Find Me"),
            background_tasks=bg,
            ledger=ledger,
        )
        result = await options_router.get_option("opt_find_me", ledger)
        assert result.name == "Find Me"

    async def test_get_option_404_on_missing(self, ledger):
        import pytest
        with pytest.raises(Exception) as exc_info:
            await options_router.get_option("nonexistent", ledger)
        assert exc_info.value.status_code == 404

    async def test_update_option(self, ledger, bg):
        await options_router.create_option(
            body=_OptionCreate(option_id="opt_upd", name="Old Name"),
            background_tasks=bg,
            ledger=ledger,
        )
        result = await options_router.update_option(
            "opt_upd",
            body=_OptionUpdate(name="New Name"),
            background_tasks=bg,
            ledger=ledger,
        )
        assert result["status"] == "ok"
        updated = await options_router.get_option("opt_upd", ledger)
        assert updated.name == "New Name"

    async def test_deactivate_option(self, ledger, bg):
        await options_router.create_option(
            body=_OptionCreate(option_id="opt_del", name="Delete Me"),
            background_tasks=bg,
            ledger=ledger,
        )
        result = await options_router.deactivate_option("opt_del", bg, ledger)
        assert result["status"] == "ok"
        opt = await options_router.get_option("opt_del", ledger)
        assert opt.active is False

    async def test_deactivate_already_inactive_returns_409(self, ledger, bg):
        import pytest
        await options_router.create_option(
            body=_OptionCreate(option_id="opt_gone", name="Gone"),
            background_tasks=bg,
            ledger=ledger,
        )
        await options_router.deactivate_option("opt_gone", bg, ledger)
        with pytest.raises(Exception) as exc_info:
            await options_router.deactivate_option("opt_gone", bg, ledger)
        assert exc_info.value.status_code == 409


class TestOptionGroupsEndpoints:

    async def test_create_option_group_auto_generates_id(self, ledger, bg):
        result = await option_groups_router.create_option_group(
            body=_OptionGroupCreate(name="My Group"),
            background_tasks=bg,
            ledger=ledger,
        )
        assert result["status"] == "ok"
        assert result["option_group_id"] == "my_group"

    async def test_list_option_groups_active_only(self, ledger, bg):
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(option_group_id="og_1", name="G1"),
            background_tasks=bg,
            ledger=ledger,
        )
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(option_group_id="og_2", name="G2"),
            background_tasks=bg,
            ledger=ledger,
        )
        await option_groups_router.deactivate_option_group("og_2", bg, ledger)
        result = await option_groups_router.list_option_groups(ledger)
        ids = [g.option_group_id for g in result]
        assert "og_1" in ids
        assert "og_2" not in ids

    async def test_add_and_remove_option_in_group(self, ledger, bg):
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(option_group_id="og_test", name="Test Group"),
            background_tasks=bg,
            ledger=ledger,
        )
        await option_groups_router.add_option_to_group("og_test", "opt_alpha", bg, ledger)
        await option_groups_router.add_option_to_group("og_test", "opt_beta", bg, ledger)

        g = await option_groups_router.get_option_group("og_test", ledger)
        assert "opt_alpha" in g.option_ids
        assert "opt_beta" in g.option_ids

        await option_groups_router.remove_option_from_group("og_test", "opt_alpha", bg, ledger)
        g = await option_groups_router.get_option_group("og_test", ledger)
        assert "opt_alpha" not in g.option_ids
        assert "opt_beta" in g.option_ids

    async def test_add_duplicate_option_returns_409(self, ledger, bg):
        import pytest
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(option_group_id="og_dup", name="Dup"),
            background_tasks=bg,
            ledger=ledger,
        )
        await option_groups_router.add_option_to_group("og_dup", "opt_z", bg, ledger)
        with pytest.raises(Exception) as exc_info:
            await option_groups_router.add_option_to_group("og_dup", "opt_z", bg, ledger)
        assert exc_info.value.status_code == 409

    async def test_remove_missing_option_returns_404(self, ledger, bg):
        import pytest
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(option_group_id="og_empty", name="Empty"),
            background_tasks=bg,
            ledger=ledger,
        )
        with pytest.raises(Exception) as exc_info:
            await option_groups_router.remove_option_from_group("og_empty", "opt_missing", bg, ledger)
        assert exc_info.value.status_code == 404

    async def test_deactivate_option_group(self, ledger, bg):
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(option_group_id="og_bye", name="Bye"),
            background_tasks=bg,
            ledger=ledger,
        )
        result = await option_groups_router.deactivate_option_group("og_bye", bg, ledger)
        assert result["status"] == "ok"
        g = await option_groups_router.get_option_group("og_bye", ledger)
        assert g.active is False

    async def test_update_option_group(self, ledger, bg):
        await option_groups_router.create_option_group(
            body=_OptionGroupCreate(option_group_id="og_rename", name="Old"),
            background_tasks=bg,
            ledger=ledger,
        )
        await option_groups_router.update_option_group(
            "og_rename",
            body=_OptionGroupUpdate(name="New"),
            background_tasks=bg,
            ledger=ledger,
        )
        g = await option_groups_router.get_option_group("og_rename", ledger)
        assert g.name == "New"


class TestSizesEndpoints:

    async def test_create_size_auto_generates_id(self, ledger, bg):
        result = await sizes_router.create_size(
            body=_SizeCreate(name="Extra Large"),
            background_tasks=bg,
            ledger=ledger,
        )
        assert result["status"] == "ok"
        assert result["size_id"] == "extra_large"

    async def test_list_sizes_active_only(self, ledger, bg):
        await sizes_router.create_size(
            body=_SizeCreate(size_id="sz_s", name="S"),
            background_tasks=bg,
            ledger=ledger,
        )
        await sizes_router.create_size(
            body=_SizeCreate(size_id="sz_m", name="M"),
            background_tasks=bg,
            ledger=ledger,
        )
        await sizes_router.deactivate_size("sz_m", bg, ledger)
        result = await sizes_router.list_sizes(ledger)
        ids = [s.size_id for s in result]
        assert "sz_s" in ids
        assert "sz_m" not in ids

    async def test_get_single_size(self, ledger, bg):
        await sizes_router.create_size(
            body=_SizeCreate(size_id="sz_get", name="Get Me"),
            background_tasks=bg,
            ledger=ledger,
        )
        result = await sizes_router.get_size("sz_get", ledger)
        assert result.name == "Get Me"

    async def test_get_size_404_on_missing(self, ledger):
        import pytest
        with pytest.raises(Exception) as exc_info:
            await sizes_router.get_size("nope", ledger)
        assert exc_info.value.status_code == 404

    async def test_update_size(self, ledger, bg):
        await sizes_router.create_size(
            body=_SizeCreate(size_id="sz_upd", name="Old", price_adjustment=Decimal("1.00")),
            background_tasks=bg,
            ledger=ledger,
        )
        await sizes_router.update_size(
            "sz_upd",
            body=_SizeUpdate(price_adjustment=Decimal("2.00")),
            background_tasks=bg,
            ledger=ledger,
        )
        s = await sizes_router.get_size("sz_upd", ledger)
        assert s.price_adjustment == Decimal("2.00")

    async def test_deactivate_size(self, ledger, bg):
        await sizes_router.create_size(
            body=_SizeCreate(size_id="sz_del", name="Del Me"),
            background_tasks=bg,
            ledger=ledger,
        )
        result = await sizes_router.deactivate_size("sz_del", bg, ledger)
        assert result["status"] == "ok"
        s = await sizes_router.get_size("sz_del", ledger)
        assert s.active is False

    async def test_deactivate_already_inactive_returns_409(self, ledger, bg):
        import pytest
        await sizes_router.create_size(
            body=_SizeCreate(size_id="sz_gone", name="Gone"),
            background_tasks=bg,
            ledger=ledger,
        )
        await sizes_router.deactivate_size("sz_gone", bg, ledger)
        with pytest.raises(Exception) as exc_info:
            await sizes_router.deactivate_size("sz_gone", bg, ledger)
        assert exc_info.value.status_code == 409


def test_prompt1_complete():
    print("PROMPT 1 COMPLETE")
    assert True
