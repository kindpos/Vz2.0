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

def _apply_group_defaults(group: Dict[str, Any]) -> None:
    """Fill in new-model fields on a modifier group projection.

    Group-level defaults:
      - min_selections / max_selections: single-select by default (0 / 1),
        which matches the historical behavior of single-choice mandatory groups.
      - drives_pricing: False — only pizza-size groups opt in.

    Per-atom defaults:
      - included_modifier_ids: [] — subatomic layer. An empty list means
        the atom is a leaf; non-empty means it's a bundled atom whose
        quarks come along at order entry.
    """
    group.setdefault('min_selections', 0)
    group.setdefault('max_selections', 1)
    group.setdefault('drives_pricing', False)
    for m in group.get('modifiers', []):
        m.setdefault('included_modifier_ids', [])


def project_menu(events: List[Event]) -> MenuState:
    """
    Build current menu state by replaying events.
    Supports both legacy batch events and new granular events.
    """
    state = MenuState()

    # We use dictionaries internally during projection for easy updates
    categories_map = {}
    items_map = {}
    modifier_groups_map = {}

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

        elif event.event_type == EventType.MENU_ITEM_UPDATED:
            item_id = payload.get('item_id')
            if item_id in items_map:
                items_map[item_id].update(payload)
                items_map[item_id].setdefault('mandatory_group_ids', [])
                items_map[item_id].setdefault('included_modifier_ids', [])

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

    # Finalize state
    state.categories = sorted(categories_map.values(), key=lambda c: c.get('display_order', 999))
    state.items = list(items_map.values())
    state.modifier_groups = list(modifier_groups_map.values())

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