"""
Physical device integration tests — require real hardware on the network.

Each test is gated by an environment variable and skips automatically
when that variable is not set, keeping the CI suite clean.

Set these before running:
    export KINDPOS_TEST_SPIN_IP=192.168.x.x        # Dejavoo SPIn card reader IP
    export KINDPOS_TEST_SPIN_PORT=9000              # (default: 9000)
    export KINDPOS_TEST_SPIN_REGISTER_ID=REG001     # (default: "")
    export KINDPOS_TEST_PRINTER_IP=192.168.x.x      # Thermal receipt printer IP
    export KINDPOS_TEST_PRINTER_PORT=9100           # (default: 9100)
    export KINDPOS_TEST_KITCHEN_IP=192.168.x.x      # Impact kitchen printer IP
    export KINDPOS_TEST_SUBNET=192.168.x            # Subnet prefix for ARP scan

Then run:
    PYTHONPATH=/home/user/Vz2.0/backend python3 -m pytest tests/test_physical_integration.py -v
"""

import os
from decimal import Decimal

import pytest

from app.core.adapters.base_payment import (
    BatchStatus,
    PaymentDeviceConfig,
    PaymentDeviceStatus,
    PaymentDeviceType,
)
from app.core.adapters.dejavoo_spin import DejavooSPInAdapter
from app.api.routes.hardware import (
    _get_arp_hosts,
    _ping_broadcast,
    _probe_host,
    _tcp_probe,
    ALL_SCAN_PORTS,
    PRINTER_PORTS,
)

# ── Device coordinates from environment ───────────────────────────────────────

SPIN_IP = os.getenv("KINDPOS_TEST_SPIN_IP")
SPIN_PORT = int(os.getenv("KINDPOS_TEST_SPIN_PORT", "9000"))
SPIN_REG = os.getenv("KINDPOS_TEST_SPIN_REGISTER_ID", "")

PRINTER_IP = os.getenv("KINDPOS_TEST_PRINTER_IP")
PRINTER_PORT = int(os.getenv("KINDPOS_TEST_PRINTER_PORT", "9100"))

KITCHEN_IP = os.getenv("KINDPOS_TEST_KITCHEN_IP")

SUBNET = os.getenv("KINDPOS_TEST_SUBNET")  # e.g. "192.168.1"


def _spin_config() -> PaymentDeviceConfig:
    return PaymentDeviceConfig(
        device_id="physical-test",
        name="Physical Test Device",
        device_type=PaymentDeviceType.SMART_TERMINAL,
        ip_address=SPIN_IP,
        mac_address="00:00:00:00:00:00",
        port=SPIN_PORT,
        protocol="spin",
        processor_id="dejavoo",
        register_id=SPIN_REG,
    )


# ═══════════════════════════════════════════════════════════════════════
# 1. Dejavoo SPIn — connect + check_status
# ═══════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not SPIN_IP, reason="KINDPOS_TEST_SPIN_IP not set")
async def test_spin_real_check_status():
    """Connect to the real SPIn device and verify it responds with a valid status."""
    adapter = DejavooSPInAdapter()
    connected = await adapter.connect(_spin_config())

    assert connected is True, "Device did not respond — check IP/port"
    assert adapter.status in (
        PaymentDeviceStatus.IDLE,
        PaymentDeviceStatus.ONLINE,
        PaymentDeviceStatus.PROCESSING,
    ), f"Unexpected status: {adapter.status}"


# ═══════════════════════════════════════════════════════════════════════
# 2. Dejavoo SPIn — close_batch
# ═══════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not SPIN_IP, reason="KINDPOS_TEST_SPIN_IP not set")
async def test_spin_real_close_batch():
    """Send BatchClose to the real device — result must be SUCCESS or FAILED,
    not an unhandled exception. Device may have zero transactions."""
    adapter = DejavooSPInAdapter()
    await adapter.connect(_spin_config())

    result = await adapter.close_batch()

    assert result.status in (BatchStatus.SUCCESS, BatchStatus.FAILED), (
        f"Unexpected batch status: {result.status}"
    )
    # batch_id must be a non-empty string (device always returns one)
    assert result.batch_id, "batch_id was empty"


# ═══════════════════════════════════════════════════════════════════════
# 3. Thermal receipt printer — TCP probe
# ═══════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not PRINTER_IP, reason="KINDPOS_TEST_PRINTER_IP not set")
def test_printer_real_tcp_probe():
    """TCP port probe must succeed on the live thermal printer."""
    result = _tcp_probe(PRINTER_IP, PRINTER_PORT, 3.0)

    assert result is True, (
        f"Could not reach printer at {PRINTER_IP}:{PRINTER_PORT} — "
        "check network connectivity"
    )


# ═══════════════════════════════════════════════════════════════════════
# 4. Impact kitchen printer — TCP probe
# ═══════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not KITCHEN_IP, reason="KINDPOS_TEST_KITCHEN_IP not set")
def test_kitchen_printer_real_tcp_probe():
    """TCP port probe must succeed on the live impact kitchen printer."""
    result = _tcp_probe(KITCHEN_IP, 9100, 3.0)

    assert result is True, (
        f"Could not reach kitchen printer at {KITCHEN_IP}:9100"
    )


# ═══════════════════════════════════════════════════════════════════════
# 5. ARP scan — finds at least one live host
# ═══════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not SUBNET, reason="KINDPOS_TEST_SUBNET not set")
def test_real_arp_scan_finds_hosts():
    """After a broadcast ping, ARP cache must contain at least one host
    on the test subnet. Verifies _ping_broadcast and _get_arp_hosts work
    end-to-end on real network hardware."""
    _ping_broadcast(SUBNET)
    hosts = _get_arp_hosts(SUBNET)

    assert len(hosts) >= 1, (
        f"No ARP entries found for subnet {SUBNET} — "
        "check that devices are online and ARP is not blocked"
    )
    for h in hosts:
        assert "ip" in h and "mac" in h


# ═══════════════════════════════════════════════════════════════════════
# 6. _probe_host — classifies real printer
# ═══════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not PRINTER_IP, reason="KINDPOS_TEST_PRINTER_IP not set")
async def test_real_probe_host_classifies_printer():
    """_probe_host must classify the live thermal printer as 'printer'."""
    result = await _probe_host(PRINTER_IP, None, ALL_SCAN_PORTS, 3.0)

    assert result is not None, (
        f"_probe_host returned None for {PRINTER_IP} — printer may be offline"
    )
    assert result["type"] == "printer"
    assert result["port"] in PRINTER_PORTS
