"""
Seed script — loads menu categories, items, and modifier groups from demo_seed.json.

Usage (from backend/ directory):
    python seed_demo_data.py

Idempotent: checks for existing MENU_ITEM_CREATED events before seeding.
"""

import asyncio
import sys
import os
import json
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

from app.core.event_ledger import EventLedger
from app.core.events import create_event, EventType

SEED_PATH = Path(__file__).parent / "data" / "demo_seed.json"


async def main():
    if not SEED_PATH.exists():
        print(f"Error: demo_seed.json not found at {SEED_PATH}")
        sys.exit(1)

    with open(SEED_PATH, 'r') as f:
        seed_data = json.load(f)

    ledger = EventLedger("data/event_ledger.db")
    await ledger.connect()

    # ── Check existing data for idempotency ───────────────────────────────
    existing_items = await ledger.get_events_by_type(EventType.MENU_ITEM_CREATED, limit=1000)
    existing_item_ids = {e.payload.get("item_id") for e in existing_items}

    existing_cats = await ledger.get_events_by_type(EventType.MENU_CATEGORY_CREATED, limit=1000)
    existing_cat_ids = {e.payload.get("category_id") for e in existing_cats}

    existing_mods = await ledger.get_events_by_type(EventType.MODIFIER_GROUP_CREATED, limit=1000)
    existing_mod_ids = {e.payload.get("group_id") for e in existing_mods}

    seeded = 0

    # ── Seed categories ───────────────────────────────────────────────────
    categories = seed_data.get("categories", [])
    for cat in categories:
        if cat["category_id"] in existing_cat_ids:
            print(f"  skip  category: {cat['name']} (already in ledger)")
            continue
        event = create_event(
            event_type=EventType.MENU_CATEGORY_CREATED,
            terminal_id="SEED",
            payload=cat,
        )
        await ledger.append(event)
        print(f"  added category: {cat['name']}")
        seeded += 1

    # ── Seed menu items ───────────────────────────────────────────────────
    items = seed_data.get("items", [])
    for item in items:
        if item["item_id"] in existing_item_ids:
            print(f"  skip  item: {item['name']} (already in ledger)")
            continue
        event = create_event(
            event_type=EventType.MENU_ITEM_CREATED,
            terminal_id="SEED",
            payload=item,
        )
        await ledger.append(event)
        print(f"  added item: {item['name']}  ${item['price']:.2f}")
        seeded += 1

    # ── Seed modifier groups ──────────────────────────────────────────────
    mod_groups = seed_data.get("modifier_groups", [])
    for group in mod_groups:
        if group["group_id"] in existing_mod_ids:
            print(f"  skip  modifier group: {group['name']} (already in ledger)")
            continue
        event = create_event(
            event_type=EventType.MODIFIER_GROUP_CREATED,
            terminal_id="SEED",
            payload=group,
        )
        await ledger.append(event)
        mods_str = ", ".join(m["name"] for m in group.get("modifiers", []))
        print(f"  added modifier group: {group['name']}  [{mods_str}]")
        seeded += 1

    await ledger.close()
    print(f"\nDone — {seeded} event(s) seeded ({len(items)} items, {len(categories)} categories, {len(mod_groups)} modifier groups).")


if __name__ == "__main__":
    asyncio.run(main())
