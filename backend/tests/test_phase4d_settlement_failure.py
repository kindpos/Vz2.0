"""Phase 4d test — batch.settlement_failed emitted when close-day
invariants fail.

The invariant gate is logs-only in prod but raises in pytest (strict
mode from conftest). The test stubs `invariant_gate` in the orders
module so it returns a failing InvariantResult list without raising,
which is the prod-mode behavior we need to audit.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import orders as orders_mod
from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.core.financial_invariants import InvariantResult


TEST_DB = Path("./data/test_phase4d.db")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.mark.asyncio
async def test_close_day_emits_settlement_failed_when_invariants_fail(ledger, monkeypatch):
    """A failing invariant result set -> batch.settlement_failed lands
    atomically alongside batch.submitted + day.closed."""

    def fake_gate(results, context=""):
        # Simulate prod mode: return a list with a failure, do not raise.
        failing = InvariantResult(
            name="cash_plus_card_equals_net_plus_tax",
            ok=False,
            diff=Decimal("0.13"),
            message="Cash + Card drifted $0.13 from Net + Tax",
        )
        return [failing]

    monkeypatch.setattr(orders_mod, "invariant_gate", fake_gate)

    await orders_mod._do_close_day(body=None, ledger=ledger)

    failures = await ledger.get_events_by_type(EventType.BATCH_SETTLEMENT_FAILED)
    assert len(failures) == 1
    p = failures[0].payload
    assert p["reason"] == "day_close_invariants_failed"
    assert Decimal(str(p["recon_diff"])) == Decimal("0.13")
    assert p["failed_invariants"][0]["name"] == "cash_plus_card_equals_net_plus_tax"


@pytest.mark.asyncio
async def test_close_day_clean_does_not_emit_settlement_failed(ledger):
    """No invariant failures -> only batch.submitted + day.closed land."""
    await orders_mod._do_close_day(body=None, ledger=ledger)
    failures = await ledger.get_events_by_type(EventType.BATCH_SETTLEMENT_FAILED)
    assert failures == []
    submitted = await ledger.get_events_by_type(EventType.BATCH_SUBMITTED)
    closed = await ledger.get_events_by_type(EventType.DAY_CLOSED)
    assert len(submitted) == 1
    assert len(closed) == 1
