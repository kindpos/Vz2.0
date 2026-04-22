"""
Tests for `services/startup_sweep.sweep_orphan_initiated_payments`.

The sweep's job is a single invariant: by the time it returns, no
PAYMENT_INITIATED older than `max_age_seconds` is left unresolved.
These tests cover the three cases that matter in production:

  - an orphan (INITIATED with no result) → emits PAYMENT_TIMED_OUT
  - an already-resolved INITIATED → untouched
  - a brand-new INITIATED inside the live window → untouched
  - idempotency: running twice does not double-resolve
"""

from pathlib import Path

import pytest
import pytest_asyncio

from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event, payment_initiated
from app.services.startup_sweep import sweep_orphan_initiated_payments


TEST_DB = Path("./data/test_startup_sweep.db")
TERMINAL = "terminal_sweep"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _emit_initiated(ledger, *, order_id: str, txn_id: str):
    """Emit a PAYMENT_INITIATED. Timestamp is server-side (now)."""
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL,
        order_id=order_id,
        payment_id=txn_id,
        amount=20.00,
        method="card",
        transaction_id=txn_id,
    ))


async def _count_events(ledger, event_type):
    events = await ledger.get_events_by_type(event_type)
    return len(events)


class TestOrphanSweep:

    @pytest.mark.asyncio
    async def test_orphan_is_swept(self, ledger):
        """A lone PAYMENT_INITIATED with no result event older than the
        threshold → sweep emits PAYMENT_TIMED_OUT and returns 1."""
        await _emit_initiated(ledger, order_id="o1", txn_id="txn_orphan")

        # max_age_seconds=0 forces "everything counts as old enough".
        swept = await sweep_orphan_initiated_payments(
            ledger, max_age_seconds=0, terminal_id=TERMINAL,
        )
        assert swept == 1

        timed_out = await ledger.get_events_by_type(EventType.PAYMENT_TIMED_OUT)
        assert len(timed_out) == 1
        payload = timed_out[0].payload
        assert payload["payment_id"] == "txn_orphan"
        assert payload["order_id"] == "o1"
        assert payload["error_code"] == "CRASH_RECOVERY_TIMEOUT"

    @pytest.mark.asyncio
    async def test_resolved_initiated_is_untouched(self, ledger):
        """An INITIATED that already has a CONFIRMED/DECLINED/etc event
        is considered done and must not be re-resolved."""
        await _emit_initiated(ledger, order_id="o_done", txn_id="txn_done")
        # Resolve via PAYMENT_CONFIRMED
        await ledger.append(create_event(
            event_type=EventType.PAYMENT_CONFIRMED,
            terminal_id=TERMINAL,
            payload={
                "order_id": "o_done",
                "payment_id": "txn_done",
                "transaction_id": "txn_done",
                "amount": 20.00,
                "tax": 0.00,
            },
            correlation_id="o_done",
        ))

        swept = await sweep_orphan_initiated_payments(
            ledger, max_age_seconds=0, terminal_id=TERMINAL,
        )
        assert swept == 0
        assert await _count_events(ledger, EventType.PAYMENT_TIMED_OUT) == 0

    @pytest.mark.asyncio
    async def test_young_initiated_is_not_swept_prematurely(self, ledger):
        """An INITIATED that's inside the live window may still get a
        result — the sweep must leave it alone rather than double-resolve."""
        await _emit_initiated(ledger, order_id="o_live", txn_id="txn_live")

        # Default live window is 600s; this PAYMENT_INITIATED was just
        # written so its age is ~0s — well below the threshold.
        swept = await sweep_orphan_initiated_payments(
            ledger, max_age_seconds=600, terminal_id=TERMINAL,
        )
        assert swept == 0
        assert await _count_events(ledger, EventType.PAYMENT_TIMED_OUT) == 0

    @pytest.mark.asyncio
    async def test_sweep_is_idempotent(self, ledger):
        """Running the sweep twice must not double-resolve. Second
        pass sees the PAYMENT_TIMED_OUT from the first and skips."""
        await _emit_initiated(ledger, order_id="o2", txn_id="txn_idem")

        first = await sweep_orphan_initiated_payments(
            ledger, max_age_seconds=0, terminal_id=TERMINAL,
        )
        second = await sweep_orphan_initiated_payments(
            ledger, max_age_seconds=0, terminal_id=TERMINAL,
        )
        assert first == 1
        assert second == 0
        assert await _count_events(ledger, EventType.PAYMENT_TIMED_OUT) == 1

    @pytest.mark.asyncio
    async def test_multiple_orphans_all_swept(self, ledger):
        await _emit_initiated(ledger, order_id="oA", txn_id="txnA")
        await _emit_initiated(ledger, order_id="oB", txn_id="txnB")
        await _emit_initiated(ledger, order_id="oC", txn_id="txnC")
        # Mix in one that resolves normally — sweep must skip it.
        await _emit_initiated(ledger, order_id="oD", txn_id="txnD")
        await ledger.append(create_event(
            event_type=EventType.PAYMENT_DECLINED,
            terminal_id=TERMINAL,
            payload={
                "order_id": "oD",
                "payment_id": "txnD",
                "transaction_id": "txnD",
                "error": "test",
            },
            correlation_id="oD",
        ))

        swept = await sweep_orphan_initiated_payments(
            ledger, max_age_seconds=0, terminal_id=TERMINAL,
        )
        assert swept == 3

        timed_out = await ledger.get_events_by_type(EventType.PAYMENT_TIMED_OUT)
        resolved_txns = {e.payload["payment_id"] for e in timed_out}
        assert resolved_txns == {"txnA", "txnB", "txnC"}
