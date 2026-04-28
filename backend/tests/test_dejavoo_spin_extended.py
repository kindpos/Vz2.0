"""
Extended DejavooSPInAdapter tests — gaps not covered by test_dejavoo_spin.py
or test_dejavoo_spin_lockdown.py.

Covers: close_batch() all branches, check_status() response parsing,
adjust_tip() exception path, _send() network error paths (DEV-002/003),
and _parse_response() ExtData field extraction.

All tests mock _send or httpx.AsyncClient — no physical hardware needed.
"""

import xml.etree.ElementTree as ET
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import app.core.adapters.dejavoo_spin as spin_mod
from app.core.adapters.base_payment import (
    BatchResult,
    BatchStatus,
    PaymentDeviceConfig,
    PaymentDeviceStatus,
    PaymentDeviceType,
    TransactionStatus,
)
from app.core.adapters.dejavoo_spin import DejavooSPInAdapter


def _make_adapter() -> DejavooSPInAdapter:
    a = DejavooSPInAdapter()
    a._config = PaymentDeviceConfig(
        device_id="test-dev",
        name="Test",
        device_type=PaymentDeviceType.SMART_TERMINAL,
        ip_address="192.168.1.100",
        mac_address="AA:BB:CC:DD:EE:FF",
        port=9000,
        protocol="spin",
        processor_id="dejavoo",
        register_id="REG-1",
    )
    return a


def _xml(text: str) -> ET.Element:
    return ET.fromstring(text)


# ═══════════════════════════════════════════════════════════════════════
# close_batch() — 6 scenarios
# ═══════════════════════════════════════════════════════════════════════

async def test_close_batch_approved():
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=_xml(
        "<response><RespMSG>Approved</RespMSG>"
        "<BatchID>B01</BatchID><BatchCount>5</BatchCount>"
        "<BatchAmount>150.00</BatchAmount></response>"
    ))

    result = await adapter.close_batch()

    assert result.status == BatchStatus.SUCCESS
    assert result.batch_id == "B01"
    assert result.transaction_count == 5
    assert result.total_amount == Decimal("150.00")


async def test_close_batch_failed_response():
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=_xml(
        "<response><RespMSG>Declined</RespMSG>"
        "<BatchCount>0</BatchCount><BatchAmount>0.00</BatchAmount></response>"
    ))

    result = await adapter.close_batch()

    assert result.status == BatchStatus.FAILED


async def test_close_batch_send_returns_none():
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=None)

    result = await adapter.close_batch()

    assert result.status == BatchStatus.FAILED
    assert result.error.error_code == "BATCH_ERR"


async def test_close_batch_non_numeric_count():
    """Non-numeric BatchCount should fall back to 0, not raise."""
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=_xml(
        "<response><RespMSG>Approved</RespMSG>"
        "<BatchCount>N/A</BatchCount><BatchAmount>50.00</BatchAmount></response>"
    ))

    result = await adapter.close_batch()

    assert result.transaction_count == 0
    assert result.total_amount == Decimal("50.00")


async def test_close_batch_non_decimal_amount():
    """Non-decimal BatchAmount should fall back to 0.00, not raise."""
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=_xml(
        "<response><RespMSG>Approved</RespMSG>"
        "<BatchCount>3</BatchCount><BatchAmount>ERR</BatchAmount></response>"
    ))

    result = await adapter.close_batch()

    assert result.transaction_count == 3
    assert result.total_amount == Decimal("0.00")


async def test_close_batch_send_raises():
    """Exception from _send produces BATCH_ERR result, not an unhandled raise."""
    adapter = _make_adapter()
    adapter._send = AsyncMock(side_effect=RuntimeError("connection lost"))

    result = await adapter.close_batch()

    assert result.status == BatchStatus.FAILED
    assert result.error.error_code == "BATCH_ERR"


# ═══════════════════════════════════════════════════════════════════════
# check_status() — 5 scenarios
# ═══════════════════════════════════════════════════════════════════════

async def test_check_status_approved_sets_idle():
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=_xml("<response><RespMSG>Approved</RespMSG></response>"))

    status = await adapter.check_status()

    assert status == PaymentDeviceStatus.IDLE


async def test_check_status_busy_sets_processing():
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=_xml("<response><RespMSG>Busy</RespMSG></response>"))

    status = await adapter.check_status()

    assert status == PaymentDeviceStatus.PROCESSING


async def test_check_status_other_response_sets_online():
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=_xml("<response><RespMSG>SomethingElse</RespMSG></response>"))

    status = await adapter.check_status()

    assert status == PaymentDeviceStatus.ONLINE


async def test_check_status_none_sets_offline():
    adapter = _make_adapter()
    adapter._send = AsyncMock(return_value=None)

    status = await adapter.check_status()

    assert status == PaymentDeviceStatus.OFFLINE


async def test_check_status_sacred_state_skips_send():
    """In AWAITING_CARD state, check_status must return immediately without
    calling _send — polling the device while a card is in the reader would
    corrupt the in-flight transaction."""
    adapter = _make_adapter()
    adapter._status = PaymentDeviceStatus.AWAITING_CARD
    send_mock = AsyncMock()
    adapter._send = send_mock

    status = await adapter.check_status()

    assert status == PaymentDeviceStatus.AWAITING_CARD
    send_mock.assert_not_called()


# ═══════════════════════════════════════════════════════════════════════
# adjust_tip() exception path
# ═══════════════════════════════════════════════════════════════════════

async def test_adjust_tip_exception_returns_tip_adj_err():
    adapter = _make_adapter()
    adapter._status = PaymentDeviceStatus.IDLE
    adapter._send = AsyncMock(side_effect=RuntimeError("network blip"))

    result = await adapter.adjust_tip("txn-tip-01", Decimal("3.00"))

    assert result.status == TransactionStatus.ERROR
    assert result.error.error_code == "TIP_ADJ_ERR"


# ═══════════════════════════════════════════════════════════════════════
# _send() network error paths
# ═══════════════════════════════════════════════════════════════════════

async def test_send_timeout_returns_none(monkeypatch):
    """TimeoutException → _send returns None and emits DEV-002."""
    adapter = _make_adapter()
    diag_calls: list[str] = []

    async def _stub_diag(**kwargs):
        diag_calls.append(kwargs.get("event_code", ""))

    monkeypatch.setattr(spin_mod, "_report_dev_event", _stub_diag)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

    with patch("app.core.adapters.dejavoo_spin.httpx.AsyncClient", return_value=mock_client):
        result = await adapter._send("<request><TransType>GetStatus</TransType></request>")

    assert result is None
    assert "DEV-002" in diag_calls


async def test_send_connect_error_returns_none(monkeypatch):
    """ConnectError → _send returns None and emits DEV-003."""
    adapter = _make_adapter()
    diag_calls: list[str] = []

    async def _stub_diag(**kwargs):
        diag_calls.append(kwargs.get("event_code", ""))

    monkeypatch.setattr(spin_mod, "_report_dev_event", _stub_diag)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("app.core.adapters.dejavoo_spin.httpx.AsyncClient", return_value=mock_client):
        result = await adapter._send("<request><TransType>GetStatus</TransType></request>")

    assert result is None
    assert "DEV-003" in diag_calls


# ═══════════════════════════════════════════════════════════════════════
# _parse_response() ExtData field extraction
# ═══════════════════════════════════════════════════════════════════════

def test_parse_response_ext_data_card_fields():
    """When CardBrand/LastFour are absent but ExtData carries them,
    _parse_response must extract card_brand and last_four from ExtData."""
    adapter = _make_adapter()
    root = _xml(
        "<response>"
        "<RespMSG>Approved</RespMSG>"
        "<ResultCode>0</ResultCode>"
        "<RefId>txn-ext-01</RefId>"
        "<ExtData>CardType=VISA,AcntLast4=0049,Amount=0.01</ExtData>"
        "</response>"
    )

    result = adapter._parse_response(root, "txn-ext-01")

    assert result.status == TransactionStatus.APPROVED
    assert result.card_brand == "VISA"
    assert result.last_four == "0049"
