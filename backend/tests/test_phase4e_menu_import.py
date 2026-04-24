"""Phase 4e — menu.import_started / completed / failed lifecycle
around the /config/push path."""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase4e.db")


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


# ── Success path wraps the batch in started/completed ─────────────────
@pytest.mark.asyncio
async def test_menu_push_wraps_started_and_completed(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="menu.item_created",
                payload={"item_id": "i1", "name": "Burger", "price": 10.0},
            ),
            PendingChange(
                event_type="menu.category_created",
                payload={"category_id": "c1", "name": "Mains"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    started = await ledger.get_events_by_type(EventType.MENU_IMPORT_STARTED)
    completed = await ledger.get_events_by_type(EventType.MENU_IMPORT_COMPLETED)
    assert len(started) == 1
    assert len(completed) == 1
    assert started[0].payload["expected_event_count"] == 2
    assert completed[0].payload["event_count"] == 2
    # started and completed share one import_id
    assert started[0].payload["import_id"] == completed[0].payload["import_id"]


# ── Non-menu batches pass through unchanged (no envelope) ──────────────
@pytest.mark.asyncio
async def test_non_menu_push_does_not_emit_import_envelope(ledger, bg):
    await cfg.push_changes(
        changes=[
            PendingChange(
                event_type="employee.created",
                payload={"employee_id": "e1", "display_name": "Alice"},
            ),
        ],
        background_tasks=bg, ledger=ledger,
    )
    assert await ledger.get_events_by_type(EventType.MENU_IMPORT_STARTED) == []
    assert await ledger.get_events_by_type(EventType.MENU_IMPORT_COMPLETED) == []


# ── Failure path emits import_failed and re-raises ─────────────────────
@pytest.mark.asyncio
async def test_menu_push_failure_emits_import_failed(ledger, bg, monkeypatch):
    real_append_batch = ledger.append_batch

    async def flaky_append_batch(events):
        # Explode only on the import batch so the subsequent failure
        # append (import_failed) can still succeed on the real method.
        raise RuntimeError("forced batch failure")

    monkeypatch.setattr(ledger, "append_batch", flaky_append_batch)

    with pytest.raises(RuntimeError):
        await cfg.push_changes(
            changes=[
                PendingChange(
                    event_type="menu.item_created",
                    payload={"item_id": "i1", "name": "X", "price": 5.0},
                ),
            ],
            background_tasks=bg, ledger=ledger,
        )

    # Restore append_batch so we can read back the failure event.
    monkeypatch.setattr(ledger, "append_batch", real_append_batch)
    failed = await ledger.get_events_by_type(EventType.MENU_IMPORT_FAILED)
    assert len(failed) == 1
    assert failed[0].payload["reason"] == "forced batch failure"
    assert failed[0].payload["error_type"] == "RuntimeError"
    # Nothing menu-related actually committed.
    assert await ledger.get_events_by_type(EventType.MENU_ITEM_CREATED) == []
