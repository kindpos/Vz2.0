"""
Unit tests for the lockdown work on DejavooSPInAdapter.

We don't hit a real device — every test stubs `_send` so we can control
the protocol layer and focus on the state machine and concurrency
discipline. The physical device can only run one transaction at a
time, so these tests pin:

  - concurrent initiate_sale calls serialize on `_tx_lock`
  - a sacred-state device rejects new transaction starts with a clean
    DEVICE_BUSY ERROR (not a race on the wire)
  - cancel_transaction is NOT blocked by the lock (must be callable
    while a sale is in flight)
  - on mid-transaction exception the status is NOT force-reset to
    IDLE (health monitor reconciles next via check_status)
  - `_build_xml` XML-escapes values so a tricky RefId doesn't corrupt
    the wire format
"""

import asyncio
import xml.etree.ElementTree as ET
from decimal import Decimal

import pytest

from app.core.adapters.base_payment import (
    PaymentDeviceConfig,
    PaymentDeviceStatus,
    PaymentDeviceType,
    TransactionRequest,
    TransactionStatus,
)
from app.core.adapters.dejavoo_spin import DejavooSPInAdapter


def _make_adapter() -> DejavooSPInAdapter:
    a = DejavooSPInAdapter()
    a._config = PaymentDeviceConfig(
        device_id="test-dev",
        name="Test",
        device_type=PaymentDeviceType.SMART_TERMINAL,
        ip_address="127.0.0.1",
        mac_address="00:00:00:00:00:00",
        port=9000,
        protocol="spin",
        processor_id="dejavoo",
        register_id="REG-1",
    )
    return a


def _approved_root(ref_id: str = "txn_1") -> ET.Element:
    return ET.fromstring(
        f"<response><ResultCode>0</ResultCode><RespMSG>Approved</RespMSG>"
        f"<RefId>{ref_id}</RefId></response>"
    )


class TestTransactionLock:
    """Two concurrent initiate_sale calls must serialize, not race."""

    @pytest.mark.asyncio
    async def test_concurrent_sales_serialize(self):
        adapter = _make_adapter()
        adapter._status = PaymentDeviceStatus.IDLE

        send_order: list[str] = []

        async def slow_send(xml, timeout=None):
            # Capture which call grabbed the lock; sleep so the other
            # call would have to wait.
            txn = "A" if "txnA" in xml else "B"
            send_order.append(f"{txn}-start")
            await asyncio.sleep(0.05)
            send_order.append(f"{txn}-end")
            return _approved_root()

        adapter._send = slow_send  # type: ignore[assignment]

        req_a = TransactionRequest(
            transaction_id="txnA",
            amount=Decimal("10.00"),
            tip_amount=Decimal("0.00"),
            terminal_id="T",
            order_id="oA",
        )
        req_b = TransactionRequest(
            transaction_id="txnB",
            amount=Decimal("20.00"),
            tip_amount=Decimal("0.00"),
            terminal_id="T",
            order_id="oB",
        )

        # Fire both roughly simultaneously. Serialization means one
        # completes fully before the other starts, so the send_order
        # interleaving must be A-start A-end B-start B-end (or B,A).
        await asyncio.gather(
            adapter.initiate_sale(req_a),
            adapter.initiate_sale(req_b),
        )

        # The "end" of the first must precede the "start" of the second.
        first_end_idx = next(i for i, s in enumerate(send_order) if s.endswith("-end"))
        first_end = send_order[first_end_idx]
        first_prefix = first_end.split("-")[0]
        remaining = send_order[first_end_idx + 1:]
        # After the first call ended, the other one should start.
        other_starts = [s for s in remaining if s.endswith("-start") and not s.startswith(first_prefix)]
        assert other_starts, f"Second transaction did not start after first ended: {send_order}"


class TestSacredStateGate:
    """Starting a new transaction while the device is already busy
    must return a clean DEVICE_BUSY error, not race the device."""

    @pytest.mark.asyncio
    async def test_initiate_sale_rejects_when_awaiting_card(self):
        adapter = _make_adapter()
        adapter._status = PaymentDeviceStatus.AWAITING_CARD

        req = TransactionRequest(
            transaction_id="txn_busy",
            amount=Decimal("5.00"),
            tip_amount=Decimal("0.00"),
            terminal_id="T",
            order_id="o",
        )
        result = await adapter.initiate_sale(req)
        assert result.status == TransactionStatus.ERROR
        assert result.error is not None
        assert result.error.error_code == "DEVICE_BUSY"

    @pytest.mark.asyncio
    async def test_initiate_refund_rejects_when_processing(self):
        adapter = _make_adapter()
        adapter._status = PaymentDeviceStatus.PROCESSING

        req = TransactionRequest(
            transaction_id="txn_refund",
            amount=Decimal("5.00"),
            tip_amount=Decimal("0.00"),
            terminal_id="T",
            order_id="o",
        )
        result = await adapter.initiate_refund(req)
        assert result.status == TransactionStatus.ERROR
        assert result.error.error_code == "DEVICE_BUSY"

    @pytest.mark.asyncio
    async def test_initiate_void_rejects_when_awaiting(self):
        adapter = _make_adapter()
        adapter._status = PaymentDeviceStatus.AWAITING_CARD

        req = TransactionRequest(
            transaction_id="txn_void",
            amount=Decimal("5.00"),
            tip_amount=Decimal("0.00"),
            terminal_id="T",
            order_id="o",
        )
        result = await adapter.initiate_void(req)
        assert result.status == TransactionStatus.ERROR
        assert result.error.error_code == "DEVICE_BUSY"


class TestCancelIsLockFree:
    """cancel_transaction MUST be callable while a sale is in flight —
    that's its whole purpose. Blocking it behind the tx_lock would
    deadlock the manager's timeout-cancel path."""

    @pytest.mark.asyncio
    async def test_cancel_runs_while_sale_in_flight(self):
        adapter = _make_adapter()
        adapter._status = PaymentDeviceStatus.IDLE

        sale_progressed = asyncio.Event()
        cancel_fired = asyncio.Event()

        async def slow_sale_send(xml, timeout=None):
            sale_progressed.set()
            # Hold the transaction long enough for cancel to fire.
            await asyncio.sleep(0.1)
            return _approved_root()

        async def cancel_send(xml, timeout=None):
            cancel_fired.set()
            return ET.fromstring("<response><Message>Cancelled</Message></response>")

        # Single _send stub that routes by XML body.
        async def router(xml, timeout=None):
            if "Cancel" in xml:
                return await cancel_send(xml, timeout)
            return await slow_sale_send(xml, timeout)

        adapter._send = router  # type: ignore[assignment]

        req = TransactionRequest(
            transaction_id="txn_cancel",
            amount=Decimal("1.00"),
            tip_amount=Decimal("0.00"),
            terminal_id="T",
            order_id="o",
        )
        sale_task = asyncio.create_task(adapter.initiate_sale(req))
        await sale_progressed.wait()  # Sale is now holding _tx_lock.

        # Cancel must run without waiting on the lock.
        cancelled = await asyncio.wait_for(adapter.cancel_transaction(), timeout=0.5)
        assert cancel_fired.is_set()
        assert cancelled is True

        # Sale still completes.
        await sale_task


class TestStatusOnException:
    """Prior version always reset status to IDLE in a finally block —
    even if the send path raised mid-transaction. That masked stuck-
    device conditions (card still in the reader). Now the status only
    transitions on observed outcomes."""

    @pytest.mark.asyncio
    async def test_send_exception_preserves_awaiting_card_state(self):
        adapter = _make_adapter()
        adapter._status = PaymentDeviceStatus.IDLE

        async def raising_send(xml, timeout=None):
            raise RuntimeError("simulated network blip")

        adapter._send = raising_send  # type: ignore[assignment]

        req = TransactionRequest(
            transaction_id="txn_raise",
            amount=Decimal("5.00"),
            tip_amount=Decimal("0.00"),
            terminal_id="T",
            order_id="o",
        )
        with pytest.raises(RuntimeError):
            await adapter.initiate_sale(req)

        # The status must NOT be reset to IDLE — the card may still be
        # in the reader. Health monitor's check_status will reconcile.
        assert adapter._status == PaymentDeviceStatus.AWAITING_CARD


class TestXmlEscape:
    """XML-special characters in a value must be escaped, not emitted
    verbatim — otherwise a RefId with an `&` or `<` produces malformed
    XML on the wire."""

    def test_ampersand_is_escaped(self):
        adapter = _make_adapter()
        xml = adapter._build_xml("Sale", {"RefId": "a&b"})
        # Round-trips through the parser (would throw on raw `&`).
        root = ET.fromstring(xml)
        assert root.findtext("RefId") == "a&b"

    def test_angle_brackets_escaped(self):
        adapter = _make_adapter()
        xml = adapter._build_xml("Sale", {"RefId": "<script>"})
        root = ET.fromstring(xml)
        assert root.findtext("RefId") == "<script>"

    def test_escape_survives_auth_fields(self):
        adapter = _make_adapter()
        adapter._config.register_id = "REG&1"
        adapter._config.tpn = "T<PN>"
        adapter._config.auth_key = "key\"with quotes"
        xml = adapter._build_xml("Sale", {})
        root = ET.fromstring(xml)
        assert root.findtext("RegisterId") == "REG&1"
        assert root.findtext("TPN") == "T<PN>"
        assert root.findtext("AuthKey") == "key\"with quotes"
