"""Phase 7 — day/batch lifecycle completeness dark-ship.

7 new EventType entries round-trip through /config/push. No new
routes; the overseer / manager UI can emit any of these the moment
they adopt the schema.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase7.db")


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


async def _push(ledger, bg, changes):
    await cfg.push_changes(changes=changes, background_tasks=bg, ledger=ledger)


# ── LG-19 check.day_locked ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_check_day_locked_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="check.day_locked",
                      payload={"order_id": "order_1", "locked_by_event": "day.closed"}),
    ])
    events = await ledger.get_events_by_type(EventType.CHECK_DAY_LOCKED)
    assert len(events) == 1
    assert events[0].payload["order_id"] == "order_1"


# ── LG-52 day.flash_report_generated ───────────────────────────────────
@pytest.mark.asyncio
async def test_flash_report_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.flash_report_generated",
            payload={
                "report_id": "flash_1530",
                "window_start": "2026-04-24T11:00:00+00:00",
                "window_end": "2026-04-24T15:30:00+00:00",
                "total_sales": 4250.00,
                "generated_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.DAY_FLASH_REPORT_GENERATED)
    assert len(events) == 1
    assert events[0].payload["generated_by"] == "mgr_alice"


# ── LG-54 / LG-55 day.locked / day.reopened ────────────────────────────
@pytest.mark.asyncio
async def test_day_lock_reopen_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="day.locked",
                      payload={"date": "2026-04-24", "locked_by": "mgr_alice"}),
        PendingChange(event_type="day.reopened",
                      payload={"date": "2026-04-24", "reopened_by": "mgr_alice",
                               "reason": "forgot to void a comp"}),
    ])
    locked = await ledger.get_events_by_type(EventType.DAY_LOCKED)
    reopened = await ledger.get_events_by_type(EventType.DAY_REOPENED)
    assert len(locked) == 1
    assert len(reopened) == 1
    assert reopened[0].payload["reason"] == "forgot to void a comp"


# ── LG-91 / LG-92 / LG-95 batch lifecycle ──────────────────────────────
@pytest.mark.asyncio
async def test_batch_lifecycle_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="batch.opened",
            payload={
                "batch_id": "batch_2026_04_24",
                "opened_at": "2026-04-24T10:00:00+00:00",
            },
        ),
        PendingChange(
            event_type="batch.settlement_initiated",
            payload={"batch_id": "batch_2026_04_24", "initiated_by": "auto_close"},
        ),
        PendingChange(
            event_type="batch.reopened",
            payload={
                "batch_id": "batch_2026_04_24",
                "reopened_by": "mgr_alice",
                "reason": "processor adjustment",
            },
        ),
    ])
    opened = await ledger.get_events_by_type(EventType.BATCH_OPENED)
    initiated = await ledger.get_events_by_type(EventType.BATCH_SETTLEMENT_INITIATED)
    reopened = await ledger.get_events_by_type(EventType.BATCH_REOPENED)
    assert len(opened) == 1
    assert len(initiated) == 1
    assert len(reopened) == 1
    assert reopened[0].payload["reopened_by"] == "mgr_alice"
