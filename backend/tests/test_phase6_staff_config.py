"""Phase 6 — staff + config completeness dark-ship.

11 new EventType entries round-trip through /config/push. No new
routes; the overseer UI can emit any of these the moment it adopts
the schema.
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


TEST_DB = Path("./data/test_phase6.db")


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


# ── Staff lifecycle ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_staff_updated_lands(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="staff.updated",
            payload={
                "employee_id": "e1",
                "fields_changed": ["display_name", "hourly_rate"],
                "updated_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.STAFF_UPDATED)
    assert len(events) == 1
    assert events[0].payload["fields_changed"] == ["display_name", "hourly_rate"]


@pytest.mark.asyncio
async def test_staff_role_changed_carries_delta(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="staff.role_changed",
            payload={
                "employee_id": "e1",
                "previous_role_ids": ["server"],
                "new_role_ids": ["server", "shift_lead"],
                "changed_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.STAFF_ROLE_CHANGED)
    assert len(events) == 1
    p = events[0].payload
    assert p["previous_role_ids"] == ["server"]
    assert p["new_role_ids"] == ["server", "shift_lead"]


@pytest.mark.asyncio
async def test_staff_deactivate_reactivate_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="staff.deactivated",
                      payload={"employee_id": "e1", "deactivated_by": "mgr_alice",
                               "reason": "left the company"}),
        PendingChange(event_type="staff.reactivated",
                      payload={"employee_id": "e1", "reactivated_by": "mgr_alice"}),
    ])
    assert len(await ledger.get_events_by_type(EventType.STAFF_DEACTIVATED)) == 1
    assert len(await ledger.get_events_by_type(EventType.STAFF_REACTIVATED)) == 1


# ── Timecard / shift ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_clock_edit_records_before_and_after(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="clock.edit",
            payload={
                "employee_id": "e1",
                "shift_id": "shift_42",
                "field": "clock_out",
                "previous_value": "2026-04-24T23:05:00+00:00",
                "new_value": "2026-04-24T23:30:00+00:00",
                "edited_by": "mgr_alice",
                "reason": "forgot to clock out",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.CLOCK_EDIT)
    assert len(events) == 1
    p = events[0].payload
    assert p["field"] == "clock_out"
    assert p["edited_by"] == "mgr_alice"


@pytest.mark.asyncio
async def test_shift_deleted_records_audit(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="shift.deleted",
            payload={
                "employee_id": "e1",
                "shift_id": "shift_42",
                "deleted_by": "mgr_alice",
                "reason": "duplicate clock-in",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.SHIFT_DELETED)
    assert len(events) == 1
    assert events[0].payload["deleted_by"] == "mgr_alice"


# ── Category soft-delete ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_category_deactivate_reactivate_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="category.deactivated",
                      payload={"category_id": "cat_beer"}),
        PendingChange(event_type="category.reactivated",
                      payload={"category_id": "cat_beer"}),
    ])
    assert len(await ledger.get_events_by_type(EventType.CATEGORY_DEACTIVATED)) == 1
    assert len(await ledger.get_events_by_type(EventType.CATEGORY_REACTIVATED)) == 1


# ── Tipout rule soft-delete ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_tipout_rule_deactivated(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(event_type="tipout.rule_deactivated",
                      payload={"rule_id": "rule_1", "deactivated_by": "mgr_alice"}),
    ])
    events = await ledger.get_events_by_type(EventType.TIPOUT_RULE_DEACTIVATED)
    assert len(events) == 1
    assert events[0].payload["rule_id"] == "rule_1"


# ── Security settings (PCI/SOX compliance anchor) ──────────────────────
@pytest.mark.asyncio
async def test_security_setting_updated_records_delta(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="security.setting_updated",
            payload={
                "setting_key": "session_ttl_minutes",
                "previous_value": "30",
                "new_value": "15",
                "updated_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.SECURITY_SETTING_UPDATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["setting_key"] == "session_ttl_minutes"
    assert p["previous_value"] == "30"
    assert p["new_value"] == "15"
