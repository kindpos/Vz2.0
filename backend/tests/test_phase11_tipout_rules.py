"""Phase 11 — Tipout rule factory + wiring (closes LG-96, LG-97).

The EventType enum entries TIPOUT_RULE_CREATED / TIPOUT_RULE_UPDATED existed
since Phase 8 but had no factory functions. This phase adds the factories and
verifies round-trip emission via /config/push.

Events:
- tipout.rule_created (LG-96) FACTORY-ONLY → IMPLEMENTED
- tipout.rule_updated (LG-97) FACTORY-ONLY → IMPLEMENTED
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


TEST_DB = Path("./data/test_phase11.db")


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
    return await cfg.push_changes(changes=changes, background_tasks=bg, ledger=ledger)


# ── LG-96 tipout.rule_created ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_tipout_rule_created_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="tipout.rule_created",
            payload={
                "rule_id": "rule_001",
                "name": "Bar-to-barback 10%",
                "pool_id": "pool_bar",
                "role_ids": ["barback"],
                "percentage": "10.00",
                "effective_date": "2026-05-01",
                "created_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.TIPOUT_RULE_CREATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["rule_id"] == "rule_001"
    assert p["name"] == "Bar-to-barback 10%"
    assert p["pool_id"] == "pool_bar"
    assert p["role_ids"] == ["barback"]
    assert p["percentage"] == "10.00"
    assert p["effective_date"] == "2026-05-01"
    assert p["created_by"] == "mgr_alice"


@pytest.mark.asyncio
async def test_tipout_rule_created_multiple_roles(ledger, bg):
    """role_ids can carry multiple role references."""
    await _push(ledger, bg, [
        PendingChange(
            event_type="tipout.rule_created",
            payload={
                "rule_id": "rule_002",
                "name": "Server split 5%",
                "pool_id": "pool_main",
                "role_ids": ["busser", "food_runner", "expo"],
                "percentage": "5.00",
                "effective_date": "2026-05-01",
                "created_by": "mgr_bob",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.TIPOUT_RULE_CREATED)
    assert len(events) == 1
    assert len(events[0].payload["role_ids"]) == 3


# ── LG-97 tipout.rule_updated ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_tipout_rule_updated_roundtrip(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="tipout.rule_updated",
            payload={
                "rule_id": "rule_001",
                "fields_changed": {"percentage": "12.00", "name": "Bar-to-barback 12%"},
                "updated_by": "mgr_alice",
            },
        ),
    ])
    events = await ledger.get_events_by_type(EventType.TIPOUT_RULE_UPDATED)
    assert len(events) == 1
    p = events[0].payload
    assert p["rule_id"] == "rule_001"
    assert p["fields_changed"]["percentage"] == "12.00"
    assert p["updated_by"] == "mgr_alice"


# ── Full lifecycle ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_tipout_rule_full_lifecycle(ledger, bg):
    """created → updated → deactivated all land in one push."""
    result = await _push(ledger, bg, [
        PendingChange(
            event_type="tipout.rule_created",
            payload={
                "rule_id": "rule_lc",
                "name": "Lifecycle Rule",
                "pool_id": "pool_main",
                "role_ids": ["busser"],
                "percentage": "8.00",
                "effective_date": "2026-05-01",
                "created_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="tipout.rule_updated",
            payload={
                "rule_id": "rule_lc",
                "fields_changed": {"percentage": "9.00"},
                "updated_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="tipout.rule_deactivated",
            payload={
                "rule_id": "rule_lc",
                "deactivated_by": "mgr_bob",
                "reason": "End of season",
            },
        ),
    ])
    assert result["events_written"] == 3

    created = await ledger.get_events_by_type(EventType.TIPOUT_RULE_CREATED)
    updated = await ledger.get_events_by_type(EventType.TIPOUT_RULE_UPDATED)
    deactivated = await ledger.get_events_by_type(EventType.TIPOUT_RULE_DEACTIVATED)

    assert len(created) == 1
    assert len(updated) == 1
    assert len(deactivated) == 1


# ── Section inference ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_tipout_rule_section_employees(ledger, bg):
    """tipout.* events must write to ledger without error (section: employees)."""
    result = await _push(ledger, bg, [
        PendingChange(
            event_type="tipout.rule_created",
            payload={
                "rule_id": "rule_sec",
                "name": "Section Test",
                "pool_id": "pool_main",
                "role_ids": ["busser"],
                "percentage": "5.00",
                "effective_date": "2026-05-01",
                "created_by": "mgr_alice",
            },
        ),
        PendingChange(
            event_type="tipout.rule_updated",
            payload={
                "rule_id": "rule_sec",
                "fields_changed": {"percentage": "6.00"},
                "updated_by": "mgr_alice",
            },
        ),
    ])
    assert result["events_written"] == 2


# ── EventType enum smoke test ─────────────────────────────────────────
def test_event_type_entries_exist():
    """Verify TIPOUT_RULE_CREATED/UPDATED are in the enum."""
    assert EventType.TIPOUT_RULE_CREATED.value == "tipout.rule_created"
    assert EventType.TIPOUT_RULE_UPDATED.value == "tipout.rule_updated"
