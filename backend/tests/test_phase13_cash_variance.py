"""Phase 13 — Cash variance projection at day close.

GET /day/cash/variance computes expected cash in the drawer by summing
float, cash sales, drops, payouts, and refunds since the last day.closed.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks

from app.api.routes import config as cfg
from app.api.routes.day_cash import _compute_cash_variance
from app.core.event_ledger import EventLedger
from app.models.config_events import PendingChange


TEST_DB = Path("./data/test_phase13.db")


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


# ── empty day ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_empty_day(ledger):
    result = await _compute_cash_variance(ledger)
    assert result["float"] == "0.00"
    assert result["cash_sales"] == "0.00"
    assert result["cash_refunds"] == "0.00"
    assert result["drops"] == "0.00"
    assert result["payouts"] == "0.00"
    assert result["expected_in_drawer"] == "0.00"
    # Structural check: all expected keys are present (guards against an empty dict).
    expected_keys = {"float", "cash_sales", "cash_refunds", "drops", "payouts", "expected_in_drawer"}
    assert expected_keys.issubset(result.keys())


# ── float only ───────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_float_only(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.cash_float_updated",
            payload={"amount": 200.00, "set_by": "manager"},
        ),
    ])
    result = await _compute_cash_variance(ledger)
    assert Decimal(result["float"]) == Decimal("200.00")
    assert Decimal(result["expected_in_drawer"]) == Decimal("200.00")


# ── float + cash sales ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_with_sales(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.cash_float_updated",
            payload={"amount": 100.00},
        ),
        PendingChange(
            event_type="payment.confirmed",
            payload={
                "order_id": "o1", "payment_id": "p1",
                "transaction_id": "t1", "amount": 45.50, "method": "cash",
            },
        ),
    ])
    result = await _compute_cash_variance(ledger)
    assert Decimal(result["float"]) == Decimal("100.00")
    assert Decimal(result["cash_sales"]) == Decimal("45.50")
    assert Decimal(result["expected_in_drawer"]) == Decimal("145.50")


# ── card payments are ignored ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_card_payments_ignored(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.cash_float_updated",
            payload={"amount": 100.00},
        ),
        PendingChange(
            event_type="payment.confirmed",
            payload={
                "order_id": "o2", "payment_id": "p2",
                "transaction_id": "t2", "amount": 80.00, "method": "card",
            },
        ),
    ])
    result = await _compute_cash_variance(ledger)
    assert Decimal(result["cash_sales"]) == Decimal("0.00")
    assert Decimal(result["expected_in_drawer"]) == Decimal("100.00")


# ── cash drop reduces expected ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_drop_reduces(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.cash_float_updated",
            payload={"amount": 200.00},
        ),
        PendingChange(
            event_type="day.cash_drop",
            payload={"amount": 150.00, "approved_by": "manager"},
        ),
    ])
    result = await _compute_cash_variance(ledger)
    assert Decimal(result["drops"]) == Decimal("150.00")
    assert Decimal(result["expected_in_drawer"]) == Decimal("50.00")


# ── cash payout reduces expected ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_payout_reduces(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.cash_float_updated",
            payload={"amount": 200.00},
        ),
        PendingChange(
            event_type="day.cash_payout",
            payload={"amount": 30.00, "recipient": "plumber"},
        ),
    ])
    result = await _compute_cash_variance(ledger)
    assert Decimal(result["payouts"]) == Decimal("30.00")
    assert Decimal(result["expected_in_drawer"]) == Decimal("170.00")


# ── cash refund reduces expected ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_refund_reduces(ledger, bg):
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.cash_float_updated",
            payload={"amount": 100.00},
        ),
        PendingChange(
            event_type="payment.confirmed",
            payload={
                "order_id": "o3", "payment_id": "p3",
                "transaction_id": "t3", "amount": 50.00, "method": "cash",
            },
        ),
        PendingChange(
            event_type="payment.refunded",
            payload={
                "order_id": "o3", "payment_id": "p3",
                "amount": 50.00, "method": "cash", "reason": "order voided",
            },
        ),
    ])
    result = await _compute_cash_variance(ledger)
    assert Decimal(result["cash_sales"]) == Decimal("50.00")
    assert Decimal(result["cash_refunds"]) == Decimal("50.00")
    assert Decimal(result["expected_in_drawer"]) == Decimal("100.00")


# ── full combined scenario ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cash_variance_combined(ledger, bg):
    # float=200, sales=75, refund=10, drop=100, payout=20
    # expected = 200 + 75 - 10 - 100 - 20 = 145
    await _push(ledger, bg, [
        PendingChange(
            event_type="day.cash_float_updated",
            payload={"amount": 200.00},
        ),
        PendingChange(
            event_type="payment.confirmed",
            payload={
                "order_id": "o4", "payment_id": "p4",
                "transaction_id": "t4", "amount": 75.00, "method": "cash",
            },
        ),
        PendingChange(
            event_type="payment.refunded",
            payload={
                "order_id": "o4", "payment_id": "p4",
                "amount": 10.00, "method": "cash", "reason": "partial refund",
            },
        ),
        PendingChange(
            event_type="day.cash_drop",
            payload={"amount": 100.00, "approved_by": "manager"},
        ),
        PendingChange(
            event_type="day.cash_payout",
            payload={"amount": 20.00, "recipient": "vendor"},
        ),
    ])
    result = await _compute_cash_variance(ledger)
    assert Decimal(result["expected_in_drawer"]) == Decimal("145.00")
