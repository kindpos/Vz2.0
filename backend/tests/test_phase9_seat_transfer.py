"""Phase 9 — seat-transfer family dark-ship round-trip tests.

12 new EventType entries covering per-seat add/remove/relabel,
cross-check seat transfers, per-seat item moves, whole-seat
transfers, seat splits/merges, and seat reopen. All emittable via
/config/push; the product features themselves are coming later.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase9.db")


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


# ── LG-06 / LG-07 / LG-08 per-seat add / remove / relabel ──────────────
@pytest.mark.asyncio
async def test_check_seat_add_remove_relabel(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="check.seat_added",
                      payload={"order_id": "o1", "seat_number": 5, "seat_label": "VIP"}),
        PendingChange(event_type="check.seat_relabeled",
                      payload={"order_id": "o1", "seat_number": 5,
                               "previous_label": "VIP", "new_label": "Birthday"}),
        PendingChange(event_type="check.seat_removed",
                      payload={"order_id": "o1", "seat_number": 5,
                               "removed_by": "srv", "reason": "left party"}),
    ])
    assert len(await ledger.get_events_by_type(EventType.CHECK_SEAT_ADDED)) == 1
    assert len(await ledger.get_events_by_type(EventType.CHECK_SEAT_RELABELED)) == 1
    assert len(await ledger.get_events_by_type(EventType.CHECK_SEAT_REMOVED)) == 1


# ── LG-17 / LG-18 cross-check seat transfer ────────────────────────────
@pytest.mark.asyncio
async def test_check_seat_cross_check_transfer(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="check.seat_sent_out",
                      payload={"order_id": "o1", "seat_number": 3,
                               "target_order_id": "o2", "sent_by": "srv_alice"}),
        PendingChange(event_type="check.seat_received",
                      payload={"order_id": "o2", "seat_number": 3,
                               "source_order_id": "o1", "received_by": "srv_bob"}),
    ])
    sent = await ledger.get_events_by_type(EventType.CHECK_SEAT_SENT_OUT)
    received = await ledger.get_events_by_type(EventType.CHECK_SEAT_RECEIVED)
    assert sent[0].payload["target_order_id"] == "o2"
    assert received[0].payload["source_order_id"] == "o1"


# ── LG-24 / LG-25 item seat-to-seat transfer ───────────────────────────
@pytest.mark.asyncio
async def test_seat_item_transfer_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="seat.item_transferred_out",
                      payload={"order_id": "o1", "seat_number": 2,
                               "item_id": "it_steak", "target_seat_number": 4,
                               "transferred_by": "srv"}),
        PendingChange(event_type="seat.item_received",
                      payload={"order_id": "o1", "seat_number": 4,
                               "item_id": "it_steak", "source_seat_number": 2,
                               "received_by": "srv"}),
    ])
    out = await ledger.get_events_by_type(EventType.SEAT_ITEM_TRANSFERRED_OUT)
    received = await ledger.get_events_by_type(EventType.SEAT_ITEM_RECEIVED)
    assert out[0].payload["item_id"] == "it_steak"
    assert received[0].payload["source_seat_number"] == 2


# ── LG-38 / LG-39 whole-seat transfer ──────────────────────────────────
@pytest.mark.asyncio
async def test_whole_seat_transfer_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="seat.transferred_out",
                      payload={"order_id": "o1", "seat_number": 3,
                               "target_order_id": "o2", "transferred_by": "srv"}),
        PendingChange(event_type="seat.transferred_in",
                      payload={"order_id": "o2", "seat_number": 3,
                               "source_order_id": "o1", "received_by": "srv"}),
    ])
    assert len(await ledger.get_events_by_type(EventType.SEAT_TRANSFERRED_OUT)) == 1
    assert len(await ledger.get_events_by_type(EventType.SEAT_TRANSFERRED_IN)) == 1


# ── LG-40 / LG-41 seat split + merge ───────────────────────────────────
@pytest.mark.asyncio
async def test_seat_split_and_merge(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="seat.split_from",
                      payload={"order_id": "o1", "parent_seat_number": 2,
                               "child_seat_number": 6, "split_by": "srv"}),
        PendingChange(event_type="seat.merged_into",
                      payload={"order_id": "o1", "source_seat_number": 6,
                               "target_seat_number": 2, "merged_by": "srv"}),
    ])
    split = await ledger.get_events_by_type(EventType.SEAT_SPLIT_FROM)
    merged = await ledger.get_events_by_type(EventType.SEAT_MERGED_INTO)
    assert split[0].payload["child_seat_number"] == 6
    assert merged[0].payload["target_seat_number"] == 2


# ── LG-42 seat.reopened ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_seat_reopened_lands(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="seat.reopened",
                      payload={"order_id": "o1", "seat_number": 2,
                               "reopened_by": "mgr_alice",
                               "reason": "late dessert"}),
    ])
    events = await ledger.get_events_by_type(EventType.SEAT_REOPENED)
    assert len(events) == 1
    assert events[0].payload["reason"] == "late dessert"
