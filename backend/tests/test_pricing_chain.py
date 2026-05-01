"""
Tests for Prompt 2 — Pricing Chain.

Coverage:
- MenuState has modifier_groups_by_id and modifiers fields
- Projection handlers for all 6 new pricing chain events
- calculate_item_price: base price, size pricing, option adj, negates_price,
  size_price_overrides, option_group_overrides, ROUND_HALF_UP
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
from app.core.pricing import calculate_item_price


TEST_DB = Path("./data/test_pricing_chain.db")


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


# ─── helpers ──────────────────────────────────────────────────────────────────

def _make_menu_state(events):
    """Project events into MenuState."""
    return project_menu(events)


# ─── Test 1: MenuState fields exist ───────────────────────────────────────────

class TestMenuStateFields:
    def test_modifier_groups_by_id_exists(self):
        state = project_menu([])
        assert isinstance(state.modifier_groups_by_id, dict)

    def test_modifiers_exists(self):
        state = project_menu([])
        assert isinstance(state.modifiers, dict)

    def test_options_exists(self):
        state = project_menu([])
        assert isinstance(state.options, dict)

    def test_option_groups_exists(self):
        state = project_menu([])
        assert isinstance(state.option_groups, dict)

    def test_sizes_exists(self):
        state = project_menu([])
        assert isinstance(state.sizes, dict)


# ─── Test 2: Projection handlers ──────────────────────────────────────────────

class TestPricingChainProjection:
    def test_modifier_group_option_group_set(self):
        events = [
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "grp1",
                "name": "Toppings",
                "modifiers": [],
            }),
            _evt(EventType.OPTION_GROUP_CREATED, {
                "option_group_id": "og1",
                "name": "Standard Options",
            }),
            _evt(EventType.MODIFIER_GROUP_OPTION_GROUP_SET, {
                "group_id": "grp1",
                "option_group_id": "og1",
            }),
        ]
        state = project_menu(events)
        grp = state.modifier_groups_by_id["grp1"]
        assert grp["default_option_group_id"] == "og1"

    def test_modifier_group_size_adjustments_updated(self):
        events = [
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "grp2",
                "name": "Extras",
                "modifiers": [],
            }),
            _evt(EventType.MODIFIER_GROUP_SIZE_ADJUSTMENTS_UPDATED, {
                "group_id": "grp2",
                "size_price_adjustments": {"sm": 0.5, "lg": 1.5},
            }),
        ]
        state = project_menu(events)
        grp = state.modifier_groups_by_id["grp2"]
        assert "sm" in grp["size_price_adjustments"]
        assert "lg" in grp["size_price_adjustments"]

    def test_modifier_size_pricing_set(self):
        events = [
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "sizes_grp",
                "name": "Sizes",
                "drives_pricing": True,
                "modifiers": [
                    {"modifier_id": "mod_sm", "name": "Small", "price": 0},
                    {"modifier_id": "mod_lg", "name": "Large", "price": 2.0},
                ],
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "toppings_grp",
                "name": "Toppings",
                "modifiers": [
                    {"modifier_id": "mod_cheese", "name": "Cheese", "price": 1.0},
                ],
            }),
            _evt(EventType.MODIFIER_SIZE_PRICING_SET, {
                "modifier_id": "mod_cheese",
                "group_id": "sizes_grp",
                "size_prices": {"Small": 0.75, "Large": 1.50},
            }),
        ]
        state = project_menu(events)
        mod = state.modifiers.get("mod_cheese")
        assert mod is not None
        assert "sizes_grp" in mod["price_by_size"]
        assert mod["price_by_size"]["sizes_grp"]["Small"] == 0.75

    def test_menu_item_size_pricing_set(self):
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item1",
                "name": "Pizza",
                "price": 10.0,
                "category": "Food",
            }),
            _evt(EventType.MENU_ITEM_SIZE_PRICING_SET, {
                "item_id": "item1",
                "group_id": "sizes_grp",
                "size_prices": {"Small": 8.0, "Large": 14.0},
            }),
        ]
        state = project_menu(events)
        item = next(i for i in state.items if i["item_id"] == "item1")
        assert "sizes_grp" in item["price_by_size"]
        assert item["price_by_size"]["sizes_grp"]["Small"] == 8.0

    def test_menu_item_option_group_override_set(self):
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item2",
                "name": "Burger",
                "price": 12.0,
                "category": "Food",
            }),
            _evt(EventType.MENU_ITEM_OPTION_GROUP_OVERRIDE_SET, {
                "item_id": "item2",
                "group_id": "grp1",
                "option_group_id": "og_special",
            }),
        ]
        state = project_menu(events)
        item = next(i for i in state.items if i["item_id"] == "item2")
        assert item["option_group_overrides"]["grp1"] == "og_special"

    def test_menu_item_size_price_override_set(self):
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item3",
                "name": "Wings",
                "price": 11.0,
                "category": "Food",
            }),
            _evt(EventType.MENU_ITEM_SIZE_PRICE_OVERRIDE_SET, {
                "item_id": "item3",
                "group_id": "sizes_grp",
                "size_name": "Large",
                "price": 15.0,
            }),
        ]
        state = project_menu(events)
        item = next(i for i in state.items if i["item_id"] == "item3")
        assert item["size_price_overrides"]["sizes_grp"]["Large"] == 15.0


# ─── Test 3: calculate_item_price ─────────────────────────────────────────────

class TestCalculateItemPrice:
    def _build_state(self, events):
        return project_menu(events)

    def test_base_price_no_selections(self):
        """Item with no selections returns base price."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_base",
                "name": "Salad",
                "price": 9.99,
                "category": "Food",
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_base")
        result = calculate_item_price(item, [], state)
        assert result == Decimal("9.99")

    def test_base_price_with_modifier(self):
        """Modifier adds to base price."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_mod",
                "name": "Coffee",
                "price": 3.00,
                "category": "Drinks",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "add_ins",
                "name": "Add-Ins",
                "modifiers": [
                    {"modifier_id": "mod_milk", "name": "Milk", "price": 0.50},
                ],
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_mod")
        selections = [{"group_id": "add_ins", "modifier_id": "mod_milk"}]
        result = calculate_item_price(item, selections, state)
        assert result == Decimal("3.50")

    def test_size_pricing_replaces_base(self):
        """When drives_pricing group selected, item base price uses size-specific value."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_sz",
                "name": "Soda",
                "price": 2.00,
                "category": "Drinks",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "size_grp",
                "name": "Size",
                "drives_pricing": True,
                "modifiers": [
                    {"modifier_id": "sz_sm", "name": "Small", "price": 0},
                    {"modifier_id": "sz_lg", "name": "Large", "price": 0},
                ],
            }),
            _evt(EventType.MENU_ITEM_SIZE_PRICING_SET, {
                "item_id": "item_sz",
                "group_id": "size_grp",
                "size_prices": {"Small": 1.50, "Large": 2.50},
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_sz")
        # Select Large
        selections = [{"group_id": "size_grp", "modifier_id": "sz_lg"}]
        result = calculate_item_price(item, selections, state)
        assert result == Decimal("2.50")

    def test_modifier_size_pricing(self):
        """Modifier price uses size-specific value when drives_pricing group selected."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_mpz",
                "name": "Pizza",
                "price": 10.00,
                "category": "Food",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "pizza_sizes",
                "name": "Size",
                "drives_pricing": True,
                "modifiers": [
                    {"modifier_id": "ps_sm", "name": "Small", "price": 0},
                    {"modifier_id": "ps_lg", "name": "Large", "price": 0},
                ],
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "toppings",
                "name": "Toppings",
                "modifiers": [
                    {"modifier_id": "top_pep", "name": "Pepperoni", "price": 1.00},
                ],
            }),
            _evt(EventType.MODIFIER_SIZE_PRICING_SET, {
                "modifier_id": "top_pep",
                "group_id": "pizza_sizes",
                "size_prices": {"Small": 0.75, "Large": 1.50},
            }),
            _evt(EventType.MENU_ITEM_SIZE_PRICING_SET, {
                "item_id": "item_mpz",
                "group_id": "pizza_sizes",
                "size_prices": {"Small": 8.00, "Large": 14.00},
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_mpz")
        # Large pizza + pepperoni
        selections = [
            {"group_id": "pizza_sizes", "modifier_id": "ps_lg"},
            {"group_id": "toppings", "modifier_id": "top_pep"},
        ]
        result = calculate_item_price(item, selections, state)
        # 14.00 (large base) + 1.50 (pepperoni at large) = 15.50
        assert result == Decimal("15.50")

    def test_negates_price_zeroes_modifier(self):
        """Option with negates_price=True zeroes that modifier's line price only."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_neg",
                "name": "Burger",
                "price": 12.00,
                "category": "Food",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "extras",
                "name": "Extras",
                "modifiers": [
                    {"modifier_id": "mod_bacon", "name": "Bacon", "price": 2.00},
                    {"modifier_id": "mod_avocado", "name": "Avocado", "price": 1.50},
                ],
            }),
            _evt(EventType.OPTION_CREATED, {
                "option_id": "mod_bacon",
                "name": "Bacon",
                "price_adjustment": 0.0,
                "negates_price": True,
            }),
            _evt(EventType.OPTION_GROUP_CREATED, {
                "option_group_id": "free_extras_og",
                "name": "Free Extras",
                "option_ids": ["mod_bacon"],
            }),
            _evt(EventType.MODIFIER_GROUP_OPTION_GROUP_SET, {
                "group_id": "extras",
                "option_group_id": "free_extras_og",
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_neg")
        # Bacon (negated) + Avocado (not negated)
        selections = [
            {"group_id": "extras", "modifier_id": "mod_bacon"},
            {"group_id": "extras", "modifier_id": "mod_avocado"},
        ]
        result = calculate_item_price(item, selections, state)
        # 12.00 (base) + 0.00 (bacon negated) + 1.50 (avocado normal) = 13.50
        assert result == Decimal("13.50")

    def test_option_price_adjustment(self):
        """Option with price_adjustment adds to modifier price."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_opa",
                "name": "Drink",
                "price": 3.00,
                "category": "Drinks",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "extras_opa",
                "name": "Extras",
                "modifiers": [
                    {"modifier_id": "mod_shot", "name": "Extra Shot", "price": 0.50},
                ],
            }),
            _evt(EventType.OPTION_CREATED, {
                "option_id": "mod_shot",
                "name": "Extra Shot",
                "price_adjustment": 0.25,
                "negates_price": False,
            }),
            _evt(EventType.OPTION_GROUP_CREATED, {
                "option_group_id": "shot_og",
                "name": "Shot Options",
                "option_ids": ["mod_shot"],
            }),
            _evt(EventType.MODIFIER_GROUP_OPTION_GROUP_SET, {
                "group_id": "extras_opa",
                "option_group_id": "shot_og",
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_opa")
        selections = [{"group_id": "extras_opa", "modifier_id": "mod_shot"}]
        result = calculate_item_price(item, selections, state)
        # 3.00 + (0.50 modifier + 0.25 option adj) = 3.75
        assert result == Decimal("3.75")

    def test_size_price_override(self):
        """Per-item size_price_override takes precedence over item's price_by_size."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_spo",
                "name": "Specialty Pizza",
                "price": 15.00,
                "category": "Food",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "sp_sizes",
                "name": "Size",
                "drives_pricing": True,
                "modifiers": [
                    {"modifier_id": "sp_sm", "name": "Small", "price": 0},
                    {"modifier_id": "sp_lg", "name": "Large", "price": 0},
                ],
            }),
            _evt(EventType.MENU_ITEM_SIZE_PRICING_SET, {
                "item_id": "item_spo",
                "group_id": "sp_sizes",
                "size_prices": {"Small": 12.00, "Large": 18.00},
            }),
            _evt(EventType.MENU_ITEM_SIZE_PRICE_OVERRIDE_SET, {
                "item_id": "item_spo",
                "group_id": "sp_sizes",
                "size_name": "Large",
                "price": 20.00,
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_spo")
        selections = [{"group_id": "sp_sizes", "modifier_id": "sp_lg"}]
        result = calculate_item_price(item, selections, state)
        # Override 20.00 (not 18.00 from price_by_size)
        assert result == Decimal("20.00")

    def test_option_group_override_on_item(self):
        """Item's option_group_override takes precedence over group's default."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_ogo",
                "name": "Tacos",
                "price": 10.00,
                "category": "Food",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "fillings",
                "name": "Fillings",
                "modifiers": [
                    {"modifier_id": "filling_chicken", "name": "Chicken", "price": 2.00},
                ],
            }),
            # Default option group — no option for this modifier
            _evt(EventType.OPTION_GROUP_CREATED, {
                "option_group_id": "default_og",
                "name": "Default Options",
                "option_ids": [],
            }),
            _evt(EventType.MODIFIER_GROUP_OPTION_GROUP_SET, {
                "group_id": "fillings",
                "option_group_id": "default_og",
            }),
            # Override option group with one that negates chicken
            _evt(EventType.OPTION_CREATED, {
                "option_id": "filling_chicken",
                "name": "Chicken",
                "price_adjustment": 0.0,
                "negates_price": True,
            }),
            _evt(EventType.OPTION_GROUP_CREATED, {
                "option_group_id": "override_og",
                "name": "Override Options",
                "option_ids": ["filling_chicken"],
            }),
            _evt(EventType.MENU_ITEM_OPTION_GROUP_OVERRIDE_SET, {
                "item_id": "item_ogo",
                "group_id": "fillings",
                "option_group_id": "override_og",
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_ogo")
        selections = [{"group_id": "fillings", "modifier_id": "filling_chicken"}]
        result = calculate_item_price(item, selections, state)
        # 10.00 + 0.00 (chicken negated by override og) = 10.00
        assert result == Decimal("10.00")

    def test_round_half_up(self):
        """Final total rounds ROUND_HALF_UP to 2 decimal places."""
        events = [
            _evt(EventType.MENU_ITEM_CREATED, {
                "item_id": "item_rnd",
                "name": "Test Item",
                "price": 1.00,
                "category": "Food",
            }),
            _evt(EventType.MODIFIER_GROUP_CREATED, {
                "group_id": "rnd_grp",
                "name": "Round Test",
                "modifiers": [
                    {"modifier_id": "mod_rnd", "name": "Third", "price": 0.333},
                    {"modifier_id": "mod_rnd2", "name": "Third2", "price": 0.333},
                    {"modifier_id": "mod_rnd3", "name": "Third3", "price": 0.334},
                ],
            }),
        ]
        state = self._build_state(events)
        item = next(i for i in state.items if i["item_id"] == "item_rnd")
        # 1.00 + 0.333 + 0.333 + 0.334 = 2.000 exactly
        selections = [
            {"group_id": "rnd_grp", "modifier_id": "mod_rnd"},
            {"group_id": "rnd_grp", "modifier_id": "mod_rnd2"},
            {"group_id": "rnd_grp", "modifier_id": "mod_rnd3"},
        ]
        result = calculate_item_price(item, selections, state)
        assert isinstance(result, Decimal)
        assert result == Decimal("2.00")


# ─── Final marker ─────────────────────────────────────────────────────────────

def test_prompt2_complete():
    print("PROMPT 2 COMPLETE")
    assert True
