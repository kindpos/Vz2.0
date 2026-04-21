# Menu Sync Patches — Apply in Order

Four files in this folder. Apply sequentially, test after each stage.

---

## Diagnosis summary

`POST /api/v1/config/push` calls `parse_event_type(change.event_type)` which
raises `ValueError` on unknown types. FastAPI returns 500, `ledger.append_batch`
is never called, **the entire save batch is discarded**. One unknown event
kills everything — including the good events saved alongside it.

Your ledger count proves this: every event type in the enum made it through;
every event type NOT in the enum has 0 rows.

Current failures:
- `menu.item_available` / `menu.item_eightysixed` — wrong names (backend uses `_restored` / `_86d`)
- `menu.items_reordered` / `menu.categories_reordered` — not in enum
- `pricing.*` (all) — not in enum, no backend at all

Current silent losses (land in ledger, but projection strips them):
- `schedule` / `special_active` / `special_label` fields on category updates
  (Pydantic `MenuCategory` drops unknown fields)

---

## Patch 1 — Frontend event rename

**File:** `patch-1-generateMenuEvents.js`

**Apply:** In `overseer/src/sections/menu-categories.js`, replace the existing
`generateMenuEvents()` function with the one from this patch file.

Specifically: the block under `// Availability` changes from `menu.item_available`
/ `menu.item_eightysixed` to `menu.item_restored` / `menu.item_86d`, and the
payload drops `eightysixed_at`.

**Test after:** 86 an item in Overseer → save → terminal shows item greyed out.

---

## Patch 2 — MenuCategory Pydantic model

**File:** `patch-2-config_events.py`

**Apply:** Drop in as the new `backend/app/models/config_events.py`. It's a full
replacement of the existing file with three additions:

- New `ScheduleWindow` model (window shape)
- New `CategorySchedule` model (enabled + grace + windows list)
- `MenuCategory` gains `schedule`, `special_active`, `special_label` fields

Everything else is preserved.

**Test after:** Edit a category in Overseer, turn Schedule ON with one window,
save. Hit `GET /api/v1/config/menu/categories` — the category should include
the `schedule` object with the window you authored.

---

## Patch 3 — Reorder event support

### 3a. Enum additions

**File:** `patch-3a-events.txt`

**Apply:** Manual edit to `backend/app/core/events.py`. Instructions inside
the file — just insert 2 lines in the Menu management section of the
`EventType` enum.

### 3b. Projection handlers

**File:** `patch-3b-overseer_config_service.py`

**Apply:** Drop in as the new `backend/app/services/overseer_config_service.py`.
Full replacement. The changes are scoped to `get_menu_categories()` and
`get_menu_items()` — all other methods are identical to what you have now.

Also subtly improves `get_menu_items()` to handle the `{item_id, changes: {...}}`
payload shape that `menu-categories.js` v2 uses for `menu.item_updated`.

**Test after:** Drag-reorder items within a category in Overseer → save →
reload terminal's menu → items appear in new order.

---

## Patch 4 — Pricing backend (deferred)

Not in this batch. When ready, we'll add:
- ~10 `pricing.*` entries to the `EventType` enum
- `"pricing."` to `CONFIG_EVENT_PREFIXES`
- New Pydantic models: `DayPart`, `Special`, `OrderType`, `EmployeeDiscount`, `CompReason`
- New `PricingConfigService` class (~200 lines, same pattern as `OverseerConfigService`)
- New API routes in `config.py` — 5 endpoints the Overseer pricing-specials.js already targets

---

## Verification sequence

After applying 1, 2, 3a, 3b:

1. Restart backend.
2. Open Overseer menu-categories scene.
3. Edit an item name, save. Ledger: `menu.item_updated` row count should increment.
4. 86 an item, save. Ledger: `menu.item_86d` row appears. Terminal: item greyed.
5. Un-86 same item, save. Ledger: `menu.item_restored` row appears. Terminal: item live again.
6. Drag-reorder items. Ledger: `menu.items_reordered` row appears. Terminal: items in new order.
7. Edit category → Schedule ON + 1 window + 1 price adjustment → save.
   Ledger: `menu.category_updated` with schedule in payload. API: `GET /api/v1/config/menu/categories` shows windows.
8. Re-run count:
```powershell
python -c "import sqlite3; c = sqlite3.connect('backend/data/event_ledger.db'); rows = list(c.execute('SELECT event_type, COUNT(1) FROM events GROUP BY event_type ORDER BY 2 DESC')); [print(r) for r in rows]"
```
Should show non-zero counts for all of: `menu.item_updated`, `menu.item_86d`,
`menu.item_restored`, `menu.items_reordered`, `menu.category_updated`.

If any step fails, check Fly logs / uvicorn logs for the 500 — the message
will name the specific event type that's still unknown.
