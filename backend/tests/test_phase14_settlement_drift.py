"""Phase 14 — Settlement drift alert in /entomology.

GET /entomology/settlement-drift surfaces all batch.settlement_failed
events so operators can review drift without mining diagnostic events.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.api.routes.entomology import get_settlement_drift
from app.core.event_ledger import EventLedger
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase14.db")


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


# stub session — settlement-drift checks Depends(get_current_session) but
# we call the handler directly so we can pass a mock session dict
_SESSION = {"user_id": "admin", "role": "admin"}


# ── no failures ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_no_settlement_failures(ledger):
    result = await get_settlement_drift(session=_SESSION, ledger=ledger)
    assert result["count"] == 0
    assert result["failures"] == []


# ── single failure surfaces ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_settlement_failure_surfaces(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="batch.settlement_failed",
            payload={
                "reason": "recon_diff exceeded threshold",
                "recon_diff": 12.50,
                "failed_invariants": [{"check": "cash_balance", "delta": 12.50}],
            },
        ),
    ])
    result = await get_settlement_drift(session=_SESSION, ledger=ledger)
    assert result["count"] == 1
    failure = result["failures"][0]
    assert failure["reason"] == "recon_diff exceeded threshold"
    assert failure["recon_diff"] == 12.50
    assert len(failure["failed_invariants"]) == 1
    assert failure["timestamp"] is not None


# ── multiple failures newest-first ──────────────────────────────────────
@pytest.mark.asyncio
async def test_multiple_failures_sorted_newest_first(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="batch.settlement_failed",
            payload={"reason": "first drift", "recon_diff": 1.00},
        ),
        PendingChange(
            event_type="batch.settlement_failed",
            payload={"reason": "second drift", "recon_diff": 2.00},
        ),
        PendingChange(
            event_type="batch.settlement_failed",
            payload={"reason": "third drift", "recon_diff": 3.00},
        ),
    ])
    result = await get_settlement_drift(session=_SESSION, ledger=ledger)
    assert result["count"] == 3
    reasons = [f["reason"] for f in result["failures"]]
    # newest first: third, second, first
    assert reasons[0] == "third drift"
    assert reasons[-1] == "first drift"


# ── missing optional fields default gracefully ───────────────────────────
@pytest.mark.asyncio
async def test_settlement_failure_missing_optional_fields(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="batch.settlement_failed",
            payload={"reason": "minimal event"},
        ),
    ])
    result = await get_settlement_drift(session=_SESSION, ledger=ledger)
    assert result["count"] == 1
    failure = result["failures"][0]
    assert failure["reason"] == "minimal event"
    assert failure["recon_diff"] is None
    assert failure["failed_invariants"] == []
