"""
Extended hardware route tests — gaps not covered by test_hardware_ledger_emissions.py
or test_printer_api.py.

Covers: list_devices (empty + after save), list_kitchen_printers (empty +
categories_list), _tcp_probe exception path, _probe_spin mock path,
_probe_host printer/no-ports classification.

All tests use a tmp_path hardware DB so hardware_config.db is never touched.
No physical hardware required.
"""

import socket
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio

from httpx import AsyncClient, ASGITransport

from app.api import dependencies as deps
from app.api.routes import hardware as hw
from app.api.routes.hardware import (
    _probe_host,
    _probe_spin,
    _tcp_probe,
    PRINTER_PORTS,
    CARD_READER_PORTS,
    ALL_SCAN_PORTS,
)
from app.core.event_ledger import EventLedger


@pytest.fixture(autouse=True)
def _tmp_hw_db(tmp_path, monkeypatch):
    """Redirect every test to a fresh throwaway hardware DB."""
    monkeypatch.setattr(hw, "HARDWARE_DB_PATH", str(tmp_path / "hw.db"))


@pytest_asyncio.fixture
async def client(ledger):
    from app.main import app

    async def _override():
        return ledger

    app.dependency_overrides[deps.get_ledger] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ═══════════════════════════════════════════════════════════════════════
# list_devices()
# ═══════════════════════════════════════════════════════════════════════

async def test_list_devices_empty(client):
    resp = await client.get("/api/v1/hardware/devices")

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_devices_after_save(client, ledger):
    # Save a device first
    await client.post("/api/v1/hardware/devices", json={
        "mac": "AA:BB:CC:DD:EE:01",
        "ip": "192.168.1.10",
        "type": "receipt",
        "name": "Front Register",
        "port": 9100,
        "register_id": "",
        "tpn": "",
        "auth_key": "",
        "categories": "",
    })

    resp = await client.get("/api/v1/hardware/devices")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["mac"] == "AA:BB:CC:DD:EE:01"
    assert data[0]["ip"] == "192.168.1.10"


# ═══════════════════════════════════════════════════════════════════════
# list_kitchen_printers()
# ═══════════════════════════════════════════════════════════════════════

async def test_list_kitchen_printers_empty(client):
    resp = await client.get("/api/v1/hardware/kitchen-printers")

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_kitchen_printers_with_categories(client, ledger):
    await client.post("/api/v1/hardware/devices", json={
        "mac": "AA:BB:CC:DD:EE:02",
        "ip": "192.168.1.20",
        "type": "kitchen",
        "name": "Kitchen Main",
        "port": 9100,
        "register_id": "",
        "tpn": "",
        "auth_key": "",
        "categories": "Food,Grill",
    })

    resp = await client.get("/api/v1/hardware/kitchen-printers")

    assert resp.status_code == 200
    printers = resp.json()
    assert len(printers) == 1
    assert printers[0]["categories_list"] == ["Food", "Grill"]


# ═══════════════════════════════════════════════════════════════════════
# _tcp_probe() — exception path
# ═══════════════════════════════════════════════════════════════════════

def test_tcp_probe_connection_refused(monkeypatch):
    """ConnectionRefusedError inside socket.connect must be caught → False."""
    mock_sock = MagicMock()
    mock_sock.__enter__ = MagicMock(return_value=mock_sock)
    mock_sock.__exit__ = MagicMock(return_value=False)
    mock_sock.connect = MagicMock(side_effect=ConnectionRefusedError("refused"))

    with patch("app.api.routes.hardware.socket.socket", return_value=mock_sock):
        result = _tcp_probe("192.168.1.99", 9100, 1.0)

    assert result is False


# ═══════════════════════════════════════════════════════════════════════
# _probe_spin() — mock HTTP response
# ═══════════════════════════════════════════════════════════════════════

async def test_probe_spin_returns_register_id():
    """When device responds with valid SPIn XML, register_id is extracted."""
    xml_body = "<response><RegisterId>REG01</RegisterId><RespMSG>Ready</RespMSG></response>"

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = xml_body

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("app.api.routes.hardware.httpx.AsyncClient", return_value=mock_client):
        result = await _probe_spin("192.168.1.100", 9000)

    assert result.get("register_id") == "REG01"


async def test_probe_spin_on_error_returns_empty():
    """ConnectError from the device → returns {} without raising."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("app.api.routes.hardware.httpx.AsyncClient", return_value=mock_client):
        result = await _probe_spin("192.168.1.100", 9000)

    assert result == {}


# ═══════════════════════════════════════════════════════════════════════
# _probe_host() — classification
# ═══════════════════════════════════════════════════════════════════════

async def test_probe_host_classifies_printer(monkeypatch):
    """When port 9100 is open, _probe_host classifies the device as a printer."""
    def _fake_tcp_probe(host, port, timeout):
        return port == 9100

    monkeypatch.setattr(hw, "_tcp_probe", _fake_tcp_probe)

    result = await _probe_host("192.168.1.50", "AA:BB:CC:00:00:01", ALL_SCAN_PORTS, 1.0)

    assert result is not None
    assert result["type"] == "printer"
    assert result["port"] == 9100
    assert result["ip"] == "192.168.1.50"


async def test_probe_host_no_open_ports_returns_none(monkeypatch):
    """When no ports respond, _probe_host returns None."""
    monkeypatch.setattr(hw, "_tcp_probe", lambda host, port, timeout: False)

    result = await _probe_host("192.168.1.99", None, ALL_SCAN_PORTS, 1.0)

    assert result is None
