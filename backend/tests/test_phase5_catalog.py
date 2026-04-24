"""Phase 5 — menu-catalog completeness + check.table_changed.

Events:
- check.table_changed   (wired into PATCH /orders)
- item.price_changed     (dark-ship via /config/push)
- item.deactivated       (dark-ship via /config/push)
- item.reactivated       (dark-ship via /config/push)
- special.created/updated/activated/deactivated (dark-ship via /config/push)
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.api.routes import orders as orders_mod
from app.api.routes.orders import PatchOrderRequest
from app.core.event_ledger import EventLedger
from app.core.events import EventType, order_created, item_added
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase5.db")
TERMINAL = "T-5"


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


async def _seed_order(ledger, order_id: str, table: str = "5"):
    await ledger.append(order_created(
        terminal_id=TERMINAL, order_id=order_id,
        table=table, server_id="srv", server_name="srv",
    ).model_copy(update={"correlation_id": order_id}))


# ── LG-10 check.table_changed ──────────────────────────────────────────
@pytest.mark.asyncio
async def test_patch_table_emits_check_table_changed(ledger):
    oid = "order_table_change"
    await _seed_order(ledger, oid, table="5")
    await orders_mod.patch_order(
        order_id=oid,
        request=PatchOrderRequest(table="12", changed_by="srv_alice"),
        ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.CHECK_TABLE_CHANGED)
    assert len(events) == 1
    p = events[0].payload
    assert p["previous_table"] == "5"
    assert p["new_table"] == "12"
    assert p["changed_by"] == "srv_alice"


@pytest.mark.asyncio
async def test_patch_same_table_emits_no_event(ledger):
    oid = "order_table_same"
    await _seed_order(ledger, oid, table="7")
    await orders_mod.patch_order(
        order_id=oid,
        request=PatchOrderRequest(table="7"),
        ledger=ledger,
    )
    assert await ledger.get_events_by_type(EventType.CHECK_TABLE_CHANGED) == []


# ── LG-75 item.price_changed ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_item_price_changed_lands_in_ledger(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="item.price_changed",
                payload={
                    "item_id": "burger",
                    "previous_price": 10.00,
                    "new_price": 11.50,
                    "changed_by": "mgr_alice",
                },
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    events = await ledger.get_events_by_type(EventType.ITEM_PRICE_CHANGED)
    assert len(events) == 1
    assert events[0].payload["previous_price"] == 10.00
    assert events[0].payload["new_price"] == 11.50


# ── LG-76 / LG-77 item.deactivated / reactivated ───────────────────────
@pytest.mark.asyncio
async def test_item_deactivate_reactivate_roundtrip(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="item.deactivated",
                payload={"item_id": "burger", "deactivated_by": "mgr_alice"},
            ),
            PendingChange(
                event_type="item.reactivated",
                payload={"item_id": "burger"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    assert len(await ledger.get_events_by_type(EventType.ITEM_DEACTIVATED)) == 1
    assert len(await ledger.get_events_by_type(EventType.ITEM_REACTIVATED)) == 1


# ── LG-86 special.* ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_special_full_lifecycle_roundtrip(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="special.created",
                payload={"special_id": "sp_tuesday", "name": "Tuesday Tacos", "price": 5.00},
            ),
            PendingChange(
                event_type="special.updated",
                payload={"special_id": "sp_tuesday", "fields_changed": ["price"]},
            ),
            PendingChange(
                event_type="special.activated",
                payload={"special_id": "sp_tuesday", "activated_by": "mgr_alice"},
            ),
            PendingChange(
                event_type="special.deactivated",
                payload={"special_id": "sp_tuesday", "reason": "Ended early"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    assert len(await ledger.get_events_by_type(EventType.SPECIAL_CREATED)) == 1
    assert len(await ledger.get_events_by_type(EventType.SPECIAL_UPDATED)) == 1
    assert len(await ledger.get_events_by_type(EventType.SPECIAL_ACTIVATED)) == 1
    assert len(await ledger.get_events_by_type(EventType.SPECIAL_DEACTIVATED)) == 1
