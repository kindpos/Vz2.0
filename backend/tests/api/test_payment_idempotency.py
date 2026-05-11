"""
Audit follow-up: PaymentManager.initiate_sale was racy. Two concurrent
calls with the same transaction_id could both pass `_check_idempotency`
before either appended `PAYMENT_INITIATED` to the ledger — both then
reached the device and a double charge was possible.

The fix is a module-level `asyncio.Lock` (`_initiate_lock`) wrapping the
critical section: check → device lookup → ledger append. The device call
itself runs OUTSIDE the lock so unrelated terminals' sales are not
serialized on a 90 s SPIn round trip.

This test pins that behavior:
- exactly one `PAYMENT_INITIATED` lands in the ledger;
- the device's `initiate_sale` is invoked exactly once;
- the losing concurrent caller receives `ERROR / IN_FLIGHT`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from decimal import Decimal

import pytest
import pytest_asyncio

from app.core.adapters.base_payment import (
    PaymentDeviceConfig,
    PaymentDeviceType,
    PaymentError,
    PaymentErrorCategory,
    TransactionRequest,
    TransactionResult,
    TransactionStatus,
)
from app.core.adapters import payment_manager as pm_module
from app.core.adapters.payment_manager import PaymentManager
from app.core.events import EventType


class _HangingDevice:
    """Mock payment device whose `initiate_sale` blocks on an event so
    the test can deterministically interleave a second concurrent call
    against the still-in-flight transaction.

    Tracks call count so the test can assert the device was hit exactly
    once even after two `manager.initiate_sale` calls."""

    def __init__(self, started: asyncio.Event, can_complete: asyncio.Event):
        self._cfg = PaymentDeviceConfig(
            device_id="mock-001",
            name="Hanging Mock",
            device_type=PaymentDeviceType.SMART_TERMINAL,
            ip_address="127.0.0.1",
            mac_address="00:00:00:00:00:00",
            port=9000,
            protocol="mock",
            processor_id="mock",
        )
        self._started = started
        self._can_complete = can_complete
        self.call_count = 0

    @property
    def config(self) -> PaymentDeviceConfig:
        return self._cfg

    async def initiate_sale(self, request: TransactionRequest) -> TransactionResult:
        self.call_count += 1
        self._started.set()
        await self._can_complete.wait()
        return TransactionResult(
            transaction_id=request.transaction_id,
            status=TransactionStatus.APPROVED,
            timestamp=datetime.now(),
        )

    async def cancel_transaction(self) -> bool:
        return True


@pytest_asyncio.fixture
async def _reset_lock():
    """The module-level _initiate_lock is shared across tests. Re-init
    before each test so a prior test left in a wedged state (lock
    acquired but never released, e.g. cancelled task) doesn't poison
    this one."""
    pm_module._initiate_lock = asyncio.Lock()
    yield


async def test_concurrent_initiate_sale_emits_one_initiated_event(
    ledger, _reset_lock
):
    """Two concurrent `initiate_sale` calls with the same
    `transaction_id` produce exactly one `PAYMENT_INITIATED` in the
    ledger and call the device exactly once. The losing caller receives
    `TransactionStatus.ERROR` with `error_code == "IN_FLIGHT"`."""
    device_started = asyncio.Event()
    device_can_complete = asyncio.Event()
    device = _HangingDevice(device_started, device_can_complete)

    manager = PaymentManager(ledger, "T-01")
    manager.register_device(device)
    manager.map_terminal_to_device("T-01", "mock-001")

    request = TransactionRequest(
        transaction_id="tx-concurrent-001",
        order_id="ord-001",
        amount=Decimal("10.00"),
        terminal_id="T-01",
    )

    # First call: runs through the lock, appends INITIATED, then awaits
    # the device. `await device_started.wait()` lets us synchronize
    # AFTER the lock has been released so the second call (started
    # next) sees the in-flight state and short-circuits.
    task_first = asyncio.create_task(manager.initiate_sale(request))
    await device_started.wait()

    # Second call: by the time it acquires the lock, the first call has
    # already exited the critical section, INITIATED is in the ledger,
    # and `_has_terminal_result` returns False → IN_FLIGHT.
    task_second = asyncio.create_task(manager.initiate_sale(request))
    second_result = await task_second

    # Release the device so the first call can finish.
    device_can_complete.set()
    first_result = await task_first

    # Core invariants ---------------------------------------------------
    initiated = await ledger.get_events_by_type(EventType.PAYMENT_INITIATED)
    matching = [
        e for e in initiated
        if e.payload.get("transaction_id") == "tx-concurrent-001"
    ]
    assert len(matching) == 1, (
        f"Expected exactly one PAYMENT_INITIATED for the duplicate "
        f"transaction_id, found {len(matching)}"
    )
    assert device.call_count == 1, (
        f"Device.initiate_sale called {device.call_count} times; "
        "the lock must prevent the second call from reaching the device"
    )

    # The second call must surface as IN_FLIGHT, not as a new device hit
    # or a synthetic approval.
    assert second_result.status == TransactionStatus.ERROR
    assert second_result.error is not None
    assert second_result.error.error_code == "IN_FLIGHT"

    # The first call still completes successfully via the real device.
    assert first_result.status == TransactionStatus.APPROVED
