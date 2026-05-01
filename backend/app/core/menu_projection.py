"""
Menu Projection

Projects the current menu state from the Event Ledger.
"""

from typing import Dict, List, Any, Optional
from pydantic import BaseModel
from .events import Event, EventType

class MenuItem(BaseModel):
    item_id: str
    name: str
    price: float
    category: str
    description: Optional[str] = None
    display_order: int = 999
    mods: Dict[str, Any] = {}

class MenuCategory(BaseModel):
    category_id: str
    name: str
    label: str
    color: str = "orange"
    display_order: int = 999
    subcats: Dict[str, Any] = {}

class MenuState(BaseModel):
    restaurant: Dict[str, Any] = {}
    categories: List[Dict[str, Any]] = []
    items: List[Dict[str, Any]] = []
    items_by_category: Dict[str, List[Dict[str, Any]]] = {}
    tax_rules: List[Dict[str, Any]] = []
    modifier_groups: List[Dict[str, Any]] = []
    options: Dict[str, Any] = {}
    option_groups: Dict[str, Any] = {}
    sizes: Dict[str, Any] = {}
    # Pricing chain lookups — keyed by group_id and modifier_id respectively.
    # These parallel modifier_groups (list) and modifiers embedded in groups
    # with fast O(1) access needed by the pricing chain.
    modifier_groups_by_id: Dict[str, Any] = {}
    modifiers: Dict[str, Any] = {}

def _apply_group_defaults(group: Dict[str, Any]) -> None:
    """Fill in new-model fields on a modifier group projection.

    Group-level defaults:
      - min_selections / max_selections: single-select by default (0 / 1),
        which matches the historical behavior of single-choice mandatory groups.
      - drives_pricing: False — only pizza-size groups opt in.
      - default_option_group_id / size_price_adjustments: pricing-chain fields.

    Per-atom defaults:
      - included_modifier_ids: [] — subatomic layer. An empty list means
        the atom is a leaf; non-empty means it's a bundled atom whose
        quarks come along at order entry.
      - price_by_size: {} — size-aware pricing map (Prompt 2).
    """
    group.setdefault('min_selections', 0)
    group.setdefault('max_selections', 1)
    group.setdefault('drives_pricing', False)
    group.setdefault('default_option_group_id', None)
    group.setdefault('size_price_adjustments', {})
    for m in group.get('modifiers', []):
        m.setdefault('included_modifier_ids', [])
        m.setdefault('price_by_size', {})


def project_menu(events: List[Event]) -> MenuState:
    """
    Build current menu state by replaying events.
    Supports both legacy batch events and new granular events.
    """
    state = MenuState()

    # We use dictionaries internally during projection for easy updates
    categories_map = {}
    items_map = {}
    modifier_groups_map: Dict[str, Any] = {}
    options_map: Dict[str, Any] = {}
    option_groups_map: Dict[str, Any] = {}
    sizes_map: Dict[str, Any] = {}
    modifiers_map: Dict[str, Any] = {}  # flat: modifier_id → modifier dict

    for event in events:
        payload = event.payload

        # Legacy batch events (from Terminal prototype)
        if event.event_type == "restaurant.configured":
            state.restaurant = {k: v for k, v in payload.items() if k != 'import_id'}

        elif event.event_type == "tax_rules.batch_created":
            state.tax_rules = payload.get('tax_rules', [])

        elif event.event_type == "categories.batch_created":
            cats = payload.get('categories', [])
            for cat in cats:
                categories_map[cat['category_id']] = cat

        elif event.event_type == "items.batch_created":
            items = payload.get('items', [])
            for item in items:
                items_map[item['item_id']] = item

        # Modern granular events (from core/backend)
        elif event.event_type == EventType.MENU_CATEGORY_CREATED:
            cat_id = payload.get('category_id')
            categories_map[cat_id] = payload
            categories_map[cat_id].setdefault('universal_group_ids', [])

        elif event.event_type == EventType.MENU_CATEGORY_UPDATED:
            cat_id = payload.get('category_id')
            if cat_id in categories_map:
                categories_map[cat_id].update(payload)
                categories_map[cat_id].setdefault('universal_group_ids', [])

        elif event.event_type == EventType.MENU_CATEGORY_DELETED:
            cat_id = payload.get('category_id')
            if cat_id in categories_map:
                del categories_map[cat_id]

        elif event.event_type == EventType.MENU_ITEM_CREATED:
            item_id = payload.get('item_id')
            items_map[item_id] = payload
            # New-model defaults — older payloads missing these fields still
            # project to a shape the terminal's resolveBackendModifierConfig can read.
            items_map[item_id].setdefault('mandatory_group_ids', [])
            items_map[item_id].setdefault('included_modifier_ids', [])
            items_map[item_id].setdefault('price_by_size', {})
            items_map[item_id].setdefault('option_group_overrides', {})
            items_map[item_id].setdefault('size_price_overrides', {})

        elif event.event_type == EventType.MENU_ITEM_UPDATED:
            item_id = payload.get('item_id')
            if item_id in items_map:
                items_map[item_id].update(payload)
                items_map[item_id].setdefault('mandatory_group_ids', [])
                items_map[item_id].setdefault('included_modifier_ids', [])
                items_map[item_id].setdefault('price_by_size', {})
                items_map[item_id].setdefault('option_group_overrides', {})
                items_map[item_id].setdefault('size_price_overrides', {})

        elif event.event_type == EventType.MENU_ITEM_DELETED:
            item_id = payload.get('item_id')
            if item_id in items_map:
                del items_map[item_id]

        elif event.event_type == EventType.MENU_ITEM_86D:
            # Temporary "out of stock tonight" flag. Previously dropped by
            # this projection, so /api/v1/menu kept showing 86'd items as
            # available — the UI let servers tap them and only then the
            # server rejected with 409. Carry the flag through so the
            # terminal can grey the tile out.
            iid = payload.get('item_id')
            if iid in items_map:
                items_map[iid]['is_86ed'] = True

        elif event.event_type == EventType.MENU_ITEM_RESTORED:
            iid = payload.get('item_id')
            if iid in items_map:
                items_map[iid]['is_86ed'] = False

        elif event.event_type == EventType.MODIFIER_GROUP_CREATED:
            group_id = payload.get('group_id')
            modifier_groups_map[group_id] = payload
            _apply_group_defaults(modifier_groups_map[group_id])

        elif event.event_type == EventType.MODIFIER_GROUP_UPDATED:
            group_id = payload.get('group_id')
            if group_id in modifier_groups_map:
                modifier_groups_map[group_id].update(payload)
                _apply_group_defaults(modifier_groups_map[group_id])

        elif event.event_type == EventType.MODIFIER_GROUP_DELETED:
            group_id = payload.get('group_id')
            if group_id in modifier_groups_map:
                del modifier_groups_map[group_id]

        # ── Options ──────────────────────────────────────────────────
        elif event.event_type == EventType.OPTION_CREATED:
            options_map[payload['option_id']] = dict(payload)

        elif event.event_type == EventType.OPTION_UPDATED:
            oid = payload.get('option_id')
            if oid in options_map:
                options_map[oid].update(payload)

        elif event.event_type == EventType.OPTION_DEACTIVATED:
            oid = payload.get('option_id')
            if oid in options_map:
                options_map[oid]['active'] = False

        elif event.event_type == EventType.OPTION_REACTIVATED:
            oid = payload.get('option_id')
            if oid in options_map:
                options_map[oid]['active'] = True

        # ── OptionGroups ──────────────────────────────────────────────
        elif event.event_type == EventType.OPTION_GROUP_CREATED:
            option_groups_map[payload['option_group_id']] = dict(payload)

        elif event.event_type == EventType.OPTION_GROUP_UPDATED:
            gid = payload.get('option_group_id')
            if gid in option_groups_map:
                option_groups_map[gid].update(payload)

        elif event.event_type == EventType.OPTION_GROUP_OPTION_ADDED:
            gid = payload.get('option_group_id')
            opt_id = payload.get('option_id')
            if gid in option_groups_map:
                ids = option_groups_map[gid].setdefault('option_ids', [])
                if opt_id not in ids:
                    ids.append(opt_id)

        elif event.event_type == EventType.OPTION_GROUP_OPTION_REMOVED:
            gid = payload.get('option_group_id')
            opt_id = payload.get('option_id')
            if gid in option_groups_map:
                ids = option_groups_map[gid].get('option_ids', [])
                if opt_id in ids:
                    ids.remove(opt_id)

        elif event.event_type == EventType.OPTION_GROUP_DEACTIVATED:
            gid = payload.get('option_group_id')
            if gid in option_groups_map:
                option_groups_map[gid]['active'] = False

        elif event.event_type == EventType.OPTION_GROUP_REACTIVATED:
            gid = payload.get('option_group_id')
            if gid in option_groups_map:
                option_groups_map[gid]['active'] = True

        # ── Sizes ─────────────────────────────────────────────────────
        elif event.event_type == EventType.SIZE_CREATED:
            sizes_map[payload['size_id']] = dict(payload)

        elif event.event_type == EventType.SIZE_UPDATED:
            sid = payload.get('size_id')
            if sid in sizes_map:
                sizes_map[sid].update(payload)

        elif event.event_type == EventType.SIZE_DEACTIVATED:
            sid = payload.get('size_id')
            if sid in sizes_map:
                sizes_map[sid]['active'] = False

        elif event.event_type == EventType.SIZE_REACTIVATED:
            sid = payload.get('size_id')
            if sid in sizes_map:
                sizes_map[sid]['active'] = True

        # ── Pricing chain events ──────────────────────────────────────
        elif event.event_type == EventType.MODIFIER_GROUP_OPTION_GROUP_SET:
            gid = payload.get('group_id')
            if gid in modifier_groups_map:
                modifier_groups_map[gid]['default_option_group_id'] = payload.get('option_group_id')

        elif event.event_type == EventType.MODIFIER_GROUP_SIZE_ADJUSTMENTS_UPDATED:
            gid = payload.get('group_id')
            if gid in modifier_groups_map:
                modifier_groups_map[gid]['size_price_adjustments'] = dict(payload.get('size_price_adjustments', {}))

        elif event.event_type == EventType.MODIFIER_SIZE_PRICING_SET:
            mid = payload.get('modifier_id')
            gid = payload.get('group_id')
            size_prices = payload.get('size_prices', {})
            if mid in modifiers_map:
                modifiers_map[mid].setdefault('price_by_size', {})[gid] = dict(size_prices)
            # Also update in-group modifier dict so modifier_groups list stays consistent
            for grp in modifier_groups_map.values():
                for m in grp.get('modifiers', []):
                    if isinstance(m, dict) and m.get('modifier_id') == mid:
                        m.setdefault('price_by_size', {})[gid] = dict(size_prices)

        elif event.event_type == EventType.MENU_ITEM_SIZE_PRICING_SET:
            iid = payload.get('item_id')
            gid = payload.get('group_id')
            size_prices = payload.get('size_prices', {})
            if iid in items_map:
                items_map[iid].setdefault('price_by_size', {})[gid] = dict(size_prices)

        elif event.event_type == EventType.MENU_ITEM_OPTION_GROUP_OVERRIDE_SET:
            iid = payload.get('item_id')
            gid = payload.get('group_id')
            ogid = payload.get('option_group_id')
            if iid in items_map:
                items_map[iid].setdefault('option_group_overrides', {})[gid] = ogid

        elif event.event_type == EventType.MENU_ITEM_SIZE_PRICE_OVERRIDE_SET:
            iid = payload.get('item_id')
            gid = payload.get('group_id')
            size_name = payload.get('size_name')
            price = payload.get('price')
            if iid in items_map and size_name is not None:
                items_map[iid].setdefault('size_price_overrides', {}).setdefault(gid, {})[size_name] = price

    # Finalize state
    state.categories = sorted(categories_map.values(), key=lambda c: c.get('display_order', 999))
    state.items = list(items_map.values())
    state.modifier_groups = list(modifier_groups_map.values())
    state.options = options_map
    state.option_groups = option_groups_map
    state.sizes = sizes_map
    state.modifier_groups_by_id = modifier_groups_map
    # Build flat modifiers dict from all groups, then overlay the modifiers_map
    # (which has price_by_size updates applied)
    for grp in modifier_groups_map.values():
        for m in grp.get('modifiers', []):
            if isinstance(m, dict) and m.get('modifier_id'):
                mid = m['modifier_id']
                modifiers_map.setdefault(mid, m)
    state.modifiers = modifiers_map

    # Enrich items authored by Overseer: they carry category_id but not
    # category (the name string). The terminal's fetchMenuFromAPI matches
    # items by category name, so resolve it here from categories_map.
    cat_name_by_id = {cid: cat.get('name', '') for cid, cat in categories_map.items()}
    for item in state.items:
        if not item.get('category') and item.get('category_id'):
            item['category'] = cat_name_by_id.get(item['category_id'], 'Uncategorized')

    # Build items_by_category
    for item in state.items:
        cat_name = item.get('category', 'Uncategorized')
        if cat_name not in state.items_by_category:
            state.items_by_category[cat_name] = []
        state.items_by_category[cat_name].append(item)

    return state