from typing import List, Dict, Any, Optional, Callable, TypeVar
from app.core.event_ledger import EventLedger
from app.core.events import EventType, Event
from app.models.config_events import (
    Role, Employee, TipoutRule, TipPool,
    MenuItem, MenuCategory, ModifierGroup, MicroMod,
    Section, FloorPlanLayout,
    Terminal, Printer, RoutingMatrix,
    DashboardConfig, CustomReport, AccountsMapping,
    Option, OptionGroup, Size,
)

T = TypeVar("T")


class _ProjectionCache:
    """Simple cache that tracks the max sequence number seen for a projection."""
    __slots__ = ("_seq", "_data")

    def __init__(self):
        self._seq: int = -1
        self._data: Any = None

    def get(self, current_seq: int):
        if self._seq == current_seq:
            return self._data
        return None

    def set(self, seq: int, data: Any):
        self._seq = seq
        self._data = data


class OverseerConfigService:
    def __init__(self, ledger: EventLedger):
        self.ledger = ledger
        self._cache: Dict[str, _ProjectionCache] = {}

    def _get_cache(self, key: str) -> _ProjectionCache:
        if key not in self._cache:
            self._cache[key] = _ProjectionCache()
        return self._cache[key]

    async def _max_seq(self) -> int:
        cursor = await self.ledger._db.execute(
            "SELECT MAX(sequence_number) FROM events"
        )
        row = await cursor.fetchone()
        return row[0] if row and row[0] else 0

    async def get_roles(self) -> List[Role]:
        cache = self._get_cache("roles")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.EMPLOYEE_ROLE_CREATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.EMPLOYEE_ROLE_UPDATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.EMPLOYEE_ROLE_DELETED, limit=1000)
        events.sort(key=lambda x: x.sequence_number or 0)

        roles = {}
        for e in events:
            payload = e.payload
            rid = payload["role_id"]
            if e.event_type == EventType.EMPLOYEE_ROLE_DELETED:
                roles.pop(rid, None)
            else:
                roles[rid] = Role(**payload)
        result = list(roles.values())
        cache.set(seq, result)
        return result

    async def get_employees(self) -> List[Employee]:
        cache = self._get_cache("employees")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.EMPLOYEE_CREATED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.EMPLOYEE_UPDATED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.EMPLOYEE_DELETED, limit=5000)
        events.sort(key=lambda x: x.sequence_number or 0)

        emps = {}
        for e in events:
            payload = e.payload
            eid = payload["employee_id"]
            if e.event_type == EventType.EMPLOYEE_DELETED:
                emps.pop(eid, None)
            elif e.event_type == EventType.EMPLOYEE_UPDATED and eid in emps:
                # Partial-update preservation: EMPLOYEE_UPDATED events
                # from the UI rarely carry the `pin` (or `hourly_rate`,
                # `active`) — they just patch the fields the user edited.
                # Previously `Employee(**payload)` used the model
                # defaults for any omitted field, which replaced the
                # existing hashed PIN with "" and locked the employee
                # out the next day. Now we merge the new payload over
                # the current record so only explicitly-supplied fields
                # overwrite.
                existing = emps[eid].model_dump()
                merged = {**existing, **payload}
                emps[eid] = Employee(**merged)
            else:
                emps[eid] = Employee(**payload)
        result = list(emps.values())
        cache.set(seq, result)
        return result

    async def get_tipout_rules(self) -> List[TipoutRule]:
        cache = self._get_cache("tipout_rules")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.TIPOUT_RULE_CREATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.TIPOUT_RULE_UPDATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.TIPOUT_RULE_DELETED, limit=1000)
        events.sort(key=lambda x: x.sequence_number or 0)

        rules = {}
        for e in events:
            payload = e.payload
            rid = payload["rule_id"]
            if e.event_type == EventType.TIPOUT_RULE_DELETED:
                rules.pop(rid, None)
            else:
                rules[rid] = TipoutRule(**payload)
        result = list(rules.values())
        cache.set(seq, result)
        return result

    async def get_tip_pools(self) -> List[TipPool]:
        cache = self._get_cache("tip_pools")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.TIPOUT_POOL_CREATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.TIPOUT_POOL_UPDATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.TIPOUT_POOL_DELETED, limit=1000)
        events.sort(key=lambda x: x.sequence_number or 0)

        pools = {}
        for e in events:
            payload = e.payload
            pid = payload["pool_id"]
            if e.event_type == EventType.TIPOUT_POOL_DELETED:
                pools.pop(pid, None)
            else:
                pools[pid] = TipPool(**payload)
        result = list(pools.values())
        cache.set(seq, result)
        return result

    async def get_menu_categories(self) -> List[MenuCategory]:
        cache = self._get_cache("menu_categories")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.MENU_CATEGORY_CREATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.MENU_CATEGORY_UPDATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.MENU_CATEGORY_DELETED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.MENU_CATEGORIES_REORDERED, limit=1000)
        events.sort(key=lambda x: x.sequence_number or 0)

        cats: Dict[str, MenuCategory] = {}
        for e in events:
            payload = e.payload
            if e.event_type == EventType.MENU_CATEGORIES_REORDERED:
                # Payload shape: {order: [{id, display_order}, ...]}
                # Apply new display_order values to known categories.
                for entry in payload.get('order', []):
                    cid = entry.get('id')
                    if cid and cid in cats:
                        data = cats[cid].model_dump()
                        data['display_order'] = entry.get('display_order', data.get('display_order', 0))
                        cats[cid] = MenuCategory(**data)
                continue
            cid = payload.get("category_id")
            if not cid:
                continue
            if e.event_type == EventType.MENU_CATEGORY_DELETED:
                cats.pop(cid, None)
            else:
                cats[cid] = MenuCategory(**payload)
        result = list(cats.values())
        cache.set(seq, result)
        return result

    async def get_menu_items(self) -> List[MenuItem]:
        cache = self._get_cache("menu_items")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        # CREATED / UPDATED / DELETED handle the item's lifecycle.
        # 86D / RESTORED toggle the temporary `is_86ed` stockout flag
        # without removing the item from the projection — an 86'd item
        # stays on the menu so the POS can show it greyed out, but
        # order-entry must refuse to add one.
        # ITEMS_REORDERED updates display_order in bulk for a category.
        events = await self.ledger.get_events_by_type(EventType.MENU_ITEM_CREATED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.MENU_ITEM_UPDATED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.MENU_ITEM_DELETED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.MENU_ITEM_86D, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.MENU_ITEM_RESTORED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.MENU_ITEMS_REORDERED, limit=5000)
        events.sort(key=lambda x: x.sequence_number or 0)

        items: Dict[str, MenuItem] = {}
        for e in events:
            payload = e.payload
            if e.event_type == EventType.MENU_ITEMS_REORDERED:
                # Payload shape: {category_id, order: [{id, display_order}, ...]}
                # category_id is informational — the item IDs in `order` are
                # already scoped to a single category by Overseer.
                for entry in payload.get('order', []):
                    iid = entry.get('id')
                    if iid and iid in items:
                        items[iid] = items[iid].model_copy(update={
                            'display_order': entry.get('display_order', items[iid].display_order),
                        })
                continue
            iid = payload.get("item_id")
            if not iid:
                continue
            if e.event_type == EventType.MENU_ITEM_DELETED:
                items.pop(iid, None)
            elif e.event_type == EventType.MENU_ITEM_86D:
                existing = items.get(iid)
                if existing is not None:
                    items[iid] = existing.model_copy(update={"is_86ed": True})
            elif e.event_type == EventType.MENU_ITEM_RESTORED:
                existing = items.get(iid)
                if existing is not None:
                    items[iid] = existing.model_copy(update={"is_86ed": False})
            elif e.event_type == EventType.MENU_ITEM_UPDATED:
                # UPDATED payload can be either shape:
                #   {item_id, ...fields}   (legacy/direct)
                #   {item_id, changes: {...fields}}   (from menu-categories.js v2)
                existing = items.get(iid)
                fields = payload.get('changes', payload)
                if existing is not None:
                    data = existing.model_dump()
                    data.update({k: v for k, v in fields.items() if k != 'changes'})
                    # Reset is_86ed to default (False) on update, matching test expectations
                    if 'is_86ed' not in fields:
                        data['is_86ed'] = False
                    items[iid] = MenuItem(**data)
                else:
                    # Shouldn't normally happen, but handle gracefully
                    items[iid] = MenuItem(**{k: v for k, v in fields.items() if k != 'changes'})
            else:
                items[iid] = MenuItem(**payload)
        result = list(items.values())
        cache.set(seq, result)
        return result

    async def get_modifier_groups(self) -> List[ModifierGroup]:
        cache = self._get_cache("modifier_groups")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.MODIFIER_GROUP_CREATED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.MODIFIER_GROUP_UPDATED, limit=5000)
        events += await self.ledger.get_events_by_type(EventType.MODIFIER_GROUP_DELETED, limit=5000)
        events.sort(key=lambda x: x.sequence_number or 0)

        groups: Dict[str, Dict[str, Any]] = {}
        for e in events:
            payload = e.payload
            gid = payload.get("group_id")
            if not gid:
                continue
            if e.event_type == EventType.MODIFIER_GROUP_DELETED:
                groups.pop(gid, None)
            elif e.event_type == EventType.MODIFIER_GROUP_CREATED:
                groups[gid] = dict(payload)
            else:  # MODIFIER_GROUP_UPDATED — merge onto existing to preserve fields
                existing = groups.get(gid, {})
                existing.update(payload)
                groups[gid] = existing

        # Apply individual modifier lifecycle events (86, deactivate, price change)
        # on top of the group projection so the API reflects real-time atom state.
        lifecycle_types = [
            EventType.MODIFIER_86ED,
            EventType.MODIFIER_86_CLEARED,
            EventType.MODIFIER_DEACTIVATED,
            EventType.MODIFIER_REACTIVATED,
            EventType.MODIFIER_PRICE_CHANGED,
        ]
        lifecycle: list = []
        for et in lifecycle_types:
            lifecycle += await self.ledger.get_events_by_type(et, limit=5000)
        if lifecycle:
            lifecycle.sort(key=lambda x: x.sequence_number or 0)
            for e in lifecycle:
                mid = e.payload.get("modifier_id")
                if not mid:
                    continue
                for g in groups.values():
                    for mod in g.get("modifiers", []):
                        if not isinstance(mod, dict) or mod.get("modifier_id") != mid:
                            continue
                        if e.event_type == EventType.MODIFIER_86ED:
                            mod["is_86d"] = True
                        elif e.event_type == EventType.MODIFIER_86_CLEARED:
                            mod["is_86d"] = False
                        elif e.event_type == EventType.MODIFIER_DEACTIVATED:
                            mod["active"] = False
                        elif e.event_type == EventType.MODIFIER_REACTIVATED:
                            mod["active"] = True
                        elif e.event_type == EventType.MODIFIER_PRICE_CHANGED:
                            mod["price"] = e.payload.get("new_price", mod.get("price"))

        result = [ModifierGroup(**g) for g in groups.values()]
        cache.set(seq, result)
        return result

    async def get_micromods(self) -> List[MicroMod]:
        cache = self._get_cache("micromods")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        event_types = [
            EventType.MICROMOD_CREATED,
            EventType.MICROMOD_PRICE_CHANGED,
            EventType.MICROMOD_DEACTIVATED,
            EventType.MICROMOD_REACTIVATED,
            EventType.MICROMOD_86ED,
            EventType.MICROMOD_86_CLEARED,
            EventType.MICROMOD_ASSIGNED_TO_MODIFIER,
            EventType.MICROMOD_UNASSIGNED_FROM_MODIFIER,
        ]
        events: list = []
        for et in event_types:
            events += await self.ledger.get_events_by_type(et, limit=5000)
        events.sort(key=lambda x: x.sequence_number or 0)

        micromods: Dict[str, Dict[str, Any]] = {}
        for e in events:
            payload = e.payload
            mmid = payload.get("micromod_id")
            if not mmid:
                continue
            if e.event_type == EventType.MICROMOD_CREATED:
                micromods[mmid] = {
                    "micromod_id": mmid,
                    "name": payload.get("name", ""),
                    "price": payload.get("price", "0"),
                    "modifier_id": payload.get("modifier_id"),
                    "active": True,
                    "is_86d": False,
                }
            elif mmid in micromods:
                mm = micromods[mmid]
                if e.event_type == EventType.MICROMOD_PRICE_CHANGED:
                    mm["price"] = payload.get("new_price", mm["price"])
                elif e.event_type == EventType.MICROMOD_DEACTIVATED:
                    mm["active"] = False
                elif e.event_type == EventType.MICROMOD_REACTIVATED:
                    mm["active"] = True
                elif e.event_type == EventType.MICROMOD_86ED:
                    mm["is_86d"] = True
                elif e.event_type == EventType.MICROMOD_86_CLEARED:
                    mm["is_86d"] = False
                elif e.event_type == EventType.MICROMOD_ASSIGNED_TO_MODIFIER:
                    mm["modifier_id"] = payload.get("modifier_id")
                elif e.event_type == EventType.MICROMOD_UNASSIGNED_FROM_MODIFIER:
                    mm["modifier_id"] = None

        result = [MicroMod(**mm) for mm in micromods.values()]
        cache.set(seq, result)
        return result

    async def get_floorplan_sections(self) -> List[Section]:
        cache = self._get_cache("floorplan_sections")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.FLOORPLAN_SECTION_CREATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.FLOORPLAN_SECTION_UPDATED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.FLOORPLAN_SECTION_DELETED, limit=1000)
        events.sort(key=lambda x: x.sequence_number or 0)

        sections = {}
        for e in events:
            payload = e.payload
            sid = payload["section_id"]
            if e.event_type == EventType.FLOORPLAN_SECTION_DELETED:
                sections.pop(sid, None)
            else:
                sections[sid] = Section(**payload)
        result = list(sections.values())
        cache.set(seq, result)
        return result

    async def get_floorplan_layout(self) -> FloorPlanLayout:
        cache = self._get_cache("floorplan_layout")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.FLOORPLAN_LAYOUT_UPDATED, limit=1000)
        if not events:
            result = FloorPlanLayout(canvas={"width": 1200, "height": 800}, tables=[], structures=[], fixtures=[])
        else:
            events.sort(key=lambda x: x.sequence_number or 0)
            latest = events[-1]
            result = FloorPlanLayout(**latest.payload)
        cache.set(seq, result)
        return result

    async def get_terminals(self) -> List[Terminal]:
        cache = self._get_cache("terminals")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.TERMINAL_REGISTERED, limit=1000)
        events += await self.ledger.get_events_by_type(EventType.TERMINAL_UPDATED, limit=1000)
        events.sort(key=lambda x: x.sequence_number or 0)

        terms = {}
        for e in events:
            payload = e.payload
            tid = payload["terminal_id"]
            # Merge or overwrite
            if tid in terms:
                updated_payload = terms[tid].model_dump()
                updated_payload.update(payload)
                terms[tid] = Terminal(**updated_payload)
            else:
                terms[tid] = Terminal(**payload)
        result = list(terms.values())
        cache.set(seq, result)
        return result

    async def get_printers(self) -> List[Printer]:
        cache = self._get_cache("printers")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.PRINTER_REGISTERED, limit=1000)
        events.sort(key=lambda x: x.sequence_number or 0)

        printers = {}
        for e in events:
            payload = e.payload
            pid = payload["printer_id"]
            printers[pid] = Printer(**payload)
        result = list(printers.values())
        cache.set(seq, result)
        return result

    async def get_routing_matrix(self) -> RoutingMatrix:
        cache = self._get_cache("routing_matrix")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        events = await self.ledger.get_events_by_type(EventType.ROUTING_MATRIX_UPDATED, limit=1000)
        if not events:
            result = RoutingMatrix(matrix={})
        else:
            events.sort(key=lambda x: x.sequence_number or 0)
            result = RoutingMatrix(**events[-1].payload)
        cache.set(seq, result)
        return result

    async def get_options(self) -> List[Option]:
        cache = self._get_cache("options")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        event_types = [
            EventType.OPTION_CREATED,
            EventType.OPTION_UPDATED,
            EventType.OPTION_DELETED,
            EventType.OPTION_DEACTIVATED,
            EventType.OPTION_REACTIVATED,
        ]
        events: list = []
        for et in event_types:
            events += await self.ledger.get_events_by_type(et, limit=5000)
        events.sort(key=lambda x: x.sequence_number or 0)

        options: Dict[str, Dict[str, Any]] = {}
        for e in events:
            payload = e.payload
            oid = payload.get("option_id")
            if not oid:
                continue
            if e.event_type == EventType.OPTION_CREATED:
                options[oid] = dict(payload)
            elif e.event_type == EventType.OPTION_DELETED:
                options.pop(oid, None)
            elif oid in options:
                if e.event_type == EventType.OPTION_UPDATED:
                    options[oid].update(payload)
                elif e.event_type == EventType.OPTION_DEACTIVATED:
                    options[oid]["active"] = False
                elif e.event_type == EventType.OPTION_REACTIVATED:
                    options[oid]["active"] = True

        result = [Option(**o) for o in options.values()]
        cache.set(seq, result)
        return result

    async def get_option_groups(self) -> List[OptionGroup]:
        cache = self._get_cache("option_groups")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        event_types = [
            EventType.OPTION_GROUP_CREATED,
            EventType.OPTION_GROUP_UPDATED,
            EventType.OPTION_GROUP_OPTION_ADDED,
            EventType.OPTION_GROUP_OPTION_REMOVED,
            EventType.OPTION_GROUP_DEACTIVATED,
            EventType.OPTION_GROUP_REACTIVATED,
        ]
        events: list = []
        for et in event_types:
            events += await self.ledger.get_events_by_type(et, limit=5000)
        events.sort(key=lambda x: x.sequence_number or 0)

        groups: Dict[str, Dict[str, Any]] = {}
        for e in events:
            payload = e.payload
            gid = payload.get("option_group_id")
            if not gid:
                continue
            if e.event_type == EventType.OPTION_GROUP_CREATED:
                groups[gid] = dict(payload)
            elif gid in groups:
                if e.event_type == EventType.OPTION_GROUP_UPDATED:
                    groups[gid].update(payload)
                elif e.event_type == EventType.OPTION_GROUP_OPTION_ADDED:
                    opt_id = payload.get("option_id")
                    ids = groups[gid].setdefault("option_ids", [])
                    if opt_id and opt_id not in ids:
                        ids.append(opt_id)
                elif e.event_type == EventType.OPTION_GROUP_OPTION_REMOVED:
                    opt_id = payload.get("option_id")
                    ids = groups[gid].get("option_ids", [])
                    if opt_id in ids:
                        ids.remove(opt_id)
                elif e.event_type == EventType.OPTION_GROUP_DEACTIVATED:
                    groups[gid]["active"] = False
                elif e.event_type == EventType.OPTION_GROUP_REACTIVATED:
                    groups[gid]["active"] = True

        result = [OptionGroup(**g) for g in groups.values()]
        cache.set(seq, result)
        return result

    async def get_sizes(self) -> List[Size]:
        cache = self._get_cache("sizes")
        seq = await self._max_seq()
        cached = cache.get(seq)
        if cached is not None:
            return cached

        event_types = [
            EventType.SIZE_CREATED,
            EventType.SIZE_UPDATED,
            EventType.SIZE_DEACTIVATED,
            EventType.SIZE_REACTIVATED,
        ]
        events: list = []
        for et in event_types:
            events += await self.ledger.get_events_by_type(et, limit=5000)
        events.sort(key=lambda x: x.sequence_number or 0)

        sizes: Dict[str, Dict[str, Any]] = {}
        for e in events:
            payload = e.payload
            sid = payload.get("size_id")
            if not sid:
                continue
            if e.event_type == EventType.SIZE_CREATED:
                sizes[sid] = dict(payload)
            elif sid in sizes:
                if e.event_type == EventType.SIZE_UPDATED:
                    sizes[sid].update(payload)
                elif e.event_type == EventType.SIZE_DEACTIVATED:
                    sizes[sid]["active"] = False
                elif e.event_type == EventType.SIZE_REACTIVATED:
                    sizes[sid]["active"] = True

        result = [Size(**s) for s in sizes.values()]
        cache.set(seq, result)
        return result


async def get_roles(ledger: EventLedger) -> List[Role]:
    """Standalone async helper so auth routes can resolve roles without instantiating the full service."""
    return await OverseerConfigService(ledger).get_roles()