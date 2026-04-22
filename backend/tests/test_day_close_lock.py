"""
Concurrency tests for `_day_close_lock`.

The lock's one job: while close_day is snapshotting the day, no new
ORDER_CREATED can slip in as an orphan. These tests exercise the lock
directly and assert that create_order returns 409 (FIN-007 path) when
the lock is held.
"""

import asyncio
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException, Request

from app.api.routes import orders as orders_mod
from app.core.event_ledger import EventLedger


TEST_DB = Path("./data/test_day_close_lock.db")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


def _mock_request() -> Request:
    """Minimal Request stand-in — create_order only reads the
    idempotency-key header, which we leave unset here."""
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/orders",
        "headers": [],
        "client": ("127.0.0.1", 9999),
    })


@pytest.mark.asyncio
async def test_create_order_blocks_while_close_lock_held(ledger):
    """Acquire `_day_close_lock` manually, then call create_order.
    Expect 409 (the FIN-007 day-close-in-progress path)."""
    req = orders_mod.CreateOrderRequest(table="T1", server_id="emp_A")

    async with orders_mod._day_close_lock:
        with pytest.raises(HTTPException) as exc:
            await orders_mod.create_order(
                request=req,
                http_request=_mock_request(),
                ledger=ledger,
            )
        assert exc.value.status_code == 409
        assert "day close" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_create_order_proceeds_when_lock_free(ledger):
    """Sanity check: with the lock untouched, create_order succeeds."""
    assert not orders_mod._day_close_lock.locked()

    req = orders_mod.CreateOrderRequest(table="T2", server_id="emp_B")
    res = await orders_mod.create_order(
        request=req,
        http_request=_mock_request(),
        ledger=ledger,
    )
    assert res.order_id.startswith("order_")
    assert res.status == "open"


@pytest.mark.asyncio
async def test_create_order_unblocks_after_lock_release(ledger):
    """Hold the lock briefly in one task, fire create_order from
    another. The second call must wait, then succeed once the lock
    releases — without this the mutex would deadlock, not guard."""

    async def hold_lock_briefly():
        async with orders_mod._day_close_lock:
            await asyncio.sleep(0.05)

    async def try_create_order():
        # Tiny delay so hold_lock_briefly grabs the lock first. Then
        # _day_close_lock.locked() is True → create_order sees 409.
        await asyncio.sleep(0.01)
        req = orders_mod.CreateOrderRequest(table="T3", server_id="emp_C")
        with pytest.raises(HTTPException) as exc:
            await orders_mod.create_order(
                request=req,
                http_request=_mock_request(),
                ledger=ledger,
            )
        return exc.value.status_code

    hold_task = asyncio.create_task(hold_lock_briefly())
    status_code = await try_create_order()
    await hold_task

    assert status_code == 409

    # Lock released — a follow-up create_order now succeeds.
    req2 = orders_mod.CreateOrderRequest(table="T3", server_id="emp_C")
    res = await orders_mod.create_order(
        request=req2,
        http_request=_mock_request(),
        ledger=ledger,
    )
    assert res.order_id.startswith("order_")
