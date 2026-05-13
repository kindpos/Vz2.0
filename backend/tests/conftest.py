"""
KINDpos Test Fixtures
=====================
Provides shared fixtures for all test modules.

Fixtures:
    ledger  - EventLedger connected to a temporary test database
    manager - PrinterManager with 4 mock printers registered:
              - Front Register (thermal, receipt)
              - Kitchen Main (impact, kitchen)
              - Kitchen Backup (impact, kitchen)
              - Bar Printer (thermal, bar)
"""

import os
# Tests pin a synthetic terminal_id because the production default in
# app.config now resolves from hardware_config.db.terminals (empty when
# unactivated). The test suite emits events that require a non-empty
# terminal_id; this preserves the historical fixture value.
os.environ.setdefault('KINDPOS_TERMINAL_ID', 'terminal_01')
os.environ.setdefault('KINDPOS_TAX_RATE', '0.07')
os.environ.setdefault('KINDPOS_CASH_DISCOUNT_RATE', '0.04')
# Every test runs under strict financial-invariants mode so any P&L /
# tender / tips identity that drifts out of tolerance fails the test
# the moment it happens, rather than silently logging and moving on
# like the production default.
os.environ.setdefault('KINDPOS_STRICT_INVARIANTS', 'true')
# Tests call route handlers directly or via TestClient without a PIN flow —
# flip auth_required to soft mode so SEC-005 diagnostics still fire but the
# request is allowed through. Production leaves auth_enforced=True.
os.environ.setdefault('KINDPOS_AUTH_ENFORCED', 'false')
# Disable the save-time IP reachability probe in tests — fixtures POST
# synthetic IPs that have no live device. Tests that exercise the probe
# path flip this back on via monkeypatch.
os.environ.setdefault('KINDPOS_PROBE_ON_SAVE', 'false')
import pytest
import pytest_asyncio
from pathlib import Path

from app.core.event_ledger import EventLedger
from app.core.adapters.printer_manager import PrinterManager
from app.core.adapters.base_printer import (
    PrinterConfig,
    PrinterType,
    CutType,
)
from app.core.adapters.mock_thermal import MockThermalPrinter
from app.core.adapters.mock_impact import MockImpactPrinter


# ─── Test database path ──────────────────────────────────
TEST_DB = Path("./data/test_printer_system.db")


# ─── Fixtures ────────────────────────────────────────────

@pytest_asyncio.fixture
async def ledger():
    """
    Provide a fresh EventLedger connected to a test database.
    Cleans up the db file after each test to ensure isolation.
    """
    # Remove stale test db if it exists
    if TEST_DB.exists():
        os.remove(TEST_DB)

    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger

    # Cleanup after test
    if TEST_DB.exists():
        os.remove(TEST_DB)


@pytest_asyncio.fixture
async def manager(ledger):
    """
    Provide a fully initialized PrinterManager with 4 mock printers.

    Mirrors the setup from the original test_printer_system.py:
      - Front Register  (thermal, receipt)
      - Kitchen Main    (impact, kitchen)
      - Kitchen Backup  (impact, kitchen)
      - Bar Printer     (thermal, bar)
    """
    mgr = PrinterManager(ledger=ledger, terminal_id="terminal-01")

    # Create the 4 printers
    receipt = MockThermalPrinter(PrinterConfig(
        printer_id="printer-receipt-01",
        name="Front Register",
        printer_type=PrinterType.THERMAL,
        role="receipt",
        connection_string="usb://mock-thermal-01",
        location_tag="front counter",
        cut_type=CutType.FULL,
        operating_hours_start="06:00",
        operating_hours_end="23:00",
    ))

    kitchen_main = MockImpactPrinter(PrinterConfig(
        printer_id="printer-kitchen-01",
        name="Kitchen Main",
        printer_type=PrinterType.IMPACT,
        role="kitchen",
        connection_string="usb://mock-impact-01",
        location_tag="hot line",
        cut_type=CutType.TEAR,
        operating_hours_start="06:00",
        operating_hours_end="23:00",
    ))

    kitchen_backup = MockImpactPrinter(PrinterConfig(
        printer_id="printer-kitchen-02",
        name="Kitchen Backup",
        printer_type=PrinterType.IMPACT,
        role="kitchen",
        connection_string="usb://mock-impact-02",
        location_tag="cold line",
        cut_type=CutType.TEAR,
    ))

    bar = MockThermalPrinter(PrinterConfig(
        printer_id="printer-bar-01",
        name="Bar Printer",
        printer_type=PrinterType.THERMAL,
        role="bar",
        connection_string="usb://mock-thermal-02",
        location_tag="bar",
        cut_type=CutType.PARTIAL,
    ))

    # Register all printers with the manager
    await mgr.register_printer(receipt)
    await mgr.register_printer(kitchen_main)
    await mgr.register_printer(kitchen_backup)
    await mgr.register_printer(bar)

    yield mgr

@pytest_asyncio.fixture
async def collector(tmp_path):
    """
    Provide a fresh DiagnosticCollector connected to a temporary test database.
    """
    from app.services.diagnostic_collector import DiagnosticCollector
    db_path = str(tmp_path / "test_diagnostic.db")
    collector = DiagnosticCollector(db_path, terminal_id="terminal-test-01")
    await collector.connect()
    yield collector
    await collector.close()