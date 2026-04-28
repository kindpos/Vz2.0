"""
Extended PrinterManager tests — gaps not covered by test_printer_system.py.

Covers: bar-role routing, target_printer_id override (found and not-found),
Tier-3 emergency fallback, retry-delay verification, status transition event,
overheat health warning, unregister, fallback assignment, get_ready_printers_by_role.
"""

import app.core.adapters.printer_manager as pm_mod
from app.core.adapters.base_printer import (
    CutType,
    OrderContext,
    PrinterConfig,
    PrinterStatus,
    PrinterType,
    PrintJob,
    PrintJobContent,
    PrintJobPriority,
    PrintJobType,
)
from app.core.adapters.mock_thermal import MockThermalPrinter
from app.core.adapters.printer_manager import MAX_RETRIES, RETRY_DELAY, PrinterManager
from app.core.events import EventType


# ── conftest supplies: ledger, manager ─────────────────────────────────────────


def _job(
    role: str,
    order_id: str = "test-01",
    target_printer_id: str | None = None,
) -> PrintJob:
    """Minimal PrintJob for routing tests."""
    return PrintJob(
        order_id=order_id,
        job_type=PrintJobType.KITCHEN_TICKET,
        order_context=OrderContext.DINE_IN,
        priority=PrintJobPriority.NORMAL,
        target_role=role,
        terminal_id="terminal-01",
        server_name="Test Server",
        target_printer_id=target_printer_id,
        content=PrintJobContent(
            header_lines=["TABLE 1"],
            body_lines=["1x TEST ITEM"],
            footer_lines=[],
            metadata={},
        ),
    )


# ═══════════════════════════════════════════════════════════════════════
# 1. Bar role routes to printer-bar-01
# ═══════════════════════════════════════════════════════════════════════

async def test_bar_role_routing(manager):
    job = _job("bar", order_id="bar-routing-01")
    result = await manager.submit_job(job)

    assert result.success
    assert result.printer_id == "printer-bar-01"
    assert result.rerouted_from is None


# ═══════════════════════════════════════════════════════════════════════
# 2. target_printer_id overrides role-based routing
# ═══════════════════════════════════════════════════════════════════════

async def test_target_printer_id_override(manager):
    """Kitchen-role job routes to receipt printer when target_printer_id is set."""
    job = _job("kitchen", order_id="override-01", target_printer_id="printer-receipt-01")
    result = await manager.submit_job(job)

    assert result.success
    assert result.printer_id == "printer-receipt-01"
    assert result.rerouted_from is None


# ═══════════════════════════════════════════════════════════════════════
# 3. Tier-3 emergency fallback (different type, matching role)
# ═══════════════════════════════════════════════════════════════════════

async def test_tier3_emergency_fallback(manager):
    """
    Both IMPACT kitchen printers offline.
    A THERMAL+kitchen printer is skipped by Tier 2 (wrong type)
    but found by Tier 3 (any matching role).
    """
    # Register a 5th printer: THERMAL with role="kitchen"
    kitchen_emergency = MockThermalPrinter(
        PrinterConfig(
            printer_id="printer-kitchen-thermal",
            name="Kitchen Emergency Thermal",
            printer_type=PrinterType.THERMAL,
            role="kitchen",
            connection_string="usb://mock-thermal-99",
            cut_type=CutType.PARTIAL,
        )
    )
    await manager.register_printer(kitchen_emergency)

    # Take both IMPACT kitchen printers offline
    kitchen_main = manager.get_printer("printer-kitchen-01")
    kitchen_backup = manager.get_printer("printer-kitchen-02")
    kitchen_main.set_fail_mode("offline")
    kitchen_backup.set_fail_mode("offline")

    # Force kitchen-01 as primary; fallback chain fires because it's offline
    job = _job("kitchen", order_id="tier3-01", target_printer_id="printer-kitchen-01")
    result = await manager.submit_job(job)

    assert result.success
    assert result.rerouted_from == "printer-kitchen-01"
    assert result.printer_id == "printer-kitchen-thermal"

    # Cleanup
    kitchen_main.set_fail_mode(None)
    kitchen_backup.set_fail_mode(None)
    await manager.unregister_printer("printer-kitchen-thermal")


# ═══════════════════════════════════════════════════════════════════════
# 4. asyncio.sleep called exactly MAX_RETRIES-1 times with RETRY_DELAY
# ═══════════════════════════════════════════════════════════════════════

async def test_retry_delay_zeroing(ledger, monkeypatch):
    """
    Uses a standalone fresh manager with a single always-failing printer.
    Verifies the retry loop calls asyncio.sleep exactly MAX_RETRIES-1 times.
    """
    always_fail = MockThermalPrinter(
        PrinterConfig(
            printer_id="printer-always-fail",
            name="Always Fail",
            printer_type=PrinterType.THERMAL,
            role="receipt",
            connection_string="test://fail",
            cut_type=CutType.FULL,
        )
    )
    # Make print_job always fail without affecting is_ready()/_status
    monkeypatch.setattr(always_fail, "_check_failure", lambda: "deliberate_test_failure")

    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    monkeypatch.setattr(pm_mod.asyncio, "sleep", fake_sleep)

    fresh_mgr = PrinterManager(ledger=ledger, terminal_id="t-retry")
    await fresh_mgr.register_printer(always_fail)

    job = _job("receipt", order_id="retry-delay-01")
    result = await fresh_mgr.submit_job(job)

    assert not result.success
    assert len(sleep_calls) == MAX_RETRIES - 1
    assert all(d == RETRY_DELAY for d in sleep_calls)


# ═══════════════════════════════════════════════════════════════════════
# 5. PRINTER_STATUS_CHANGED emitted when check_all_printers detects change
# ═══════════════════════════════════════════════════════════════════════

async def test_printer_status_transition_emits_event(manager):
    """
    Directly set _fail_mode without calling check_status early, so the printer
    status is still ONLINE when check_all_printers() runs. The method detects
    ONLINE→OFFLINE and emits PRINTER_STATUS_CHANGED.
    """
    kitchen = manager.get_printer("printer-kitchen-01")
    assert kitchen.status == PrinterStatus.ONLINE

    # Set fail mode directly — bypasses set_fail_mode's early check_status() call
    kitchen._fail_mode = "offline"

    statuses = await manager.check_all_printers()

    assert statuses["printer-kitchen-01"] == PrinterStatus.OFFLINE

    change_events = await manager._ledger.get_events_by_type(EventType.PRINTER_STATUS_CHANGED)
    kitchen_changes = [
        e for e in change_events
        if e.payload.get("printer_id") == "printer-kitchen-01"
    ]
    assert len(kitchen_changes) >= 1
    latest = kitchen_changes[-1]
    assert latest.payload.get("previous_status") == "online"
    assert latest.payload.get("new_status") == "offline"

    # Cleanup
    kitchen._fail_mode = None
    kitchen.check_status()  # restores ONLINE


# ═══════════════════════════════════════════════════════════════════════
# 6. OVERHEATED transition emits PRINTER_HEALTH_WARNING
# ═══════════════════════════════════════════════════════════════════════

async def test_overheated_emits_health_warning(manager):
    """
    Directly set _print_count to threshold with overheat_after mode.
    check_all_printers() detects ONLINE→OVERHEATED and emits PRINTER_HEALTH_WARNING.
    """
    receipt = manager.get_printer("printer-receipt-01")

    # Set up overheat state without going through set_fail_mode (avoids early check_status)
    receipt._fail_mode = "overheat_after"
    receipt._overheat_threshold = 3
    receipt._print_count = 3  # _status still ONLINE from setup

    statuses = await manager.check_all_printers()

    assert statuses["printer-receipt-01"] == PrinterStatus.OVERHEATED

    warning_events = await manager._ledger.get_events_by_type(EventType.PRINTER_HEALTH_WARNING)
    receipt_warnings = [
        e for e in warning_events
        if e.payload.get("printer_id") == "printer-receipt-01"
    ]
    assert len(receipt_warnings) >= 1
    assert receipt_warnings[-1].payload.get("warning_type") == "overheating"

    # Cleanup
    receipt.reset()


# ═══════════════════════════════════════════════════════════════════════
# 7. unregister_printer removes printer from registry
# ═══════════════════════════════════════════════════════════════════════

async def test_unregister_printer(manager):
    extra = MockThermalPrinter(
        PrinterConfig(
            printer_id="printer-extra-01",
            name="Extra Printer",
            printer_type=PrinterType.THERMAL,
            role="receipt",
            connection_string="usb://mock-extra",
            cut_type=CutType.FULL,
        )
    )
    await manager.register_printer(extra)

    assert "printer-extra-01" in [p.printer_id for p in manager.get_all_printers()]

    ok = await manager.unregister_printer("printer-extra-01")
    assert ok is True

    assert "printer-extra-01" not in [p.printer_id for p in manager.get_all_printers()]
    assert manager.get_printer("printer-extra-01") is None


# ═══════════════════════════════════════════════════════════════════════
# 8. assign_fallback emits event and wires Tier-1 routing
# ═══════════════════════════════════════════════════════════════════════

async def test_assign_fallback_routes_correctly(manager):
    """
    assign_fallback() emits PRINTER_FALLBACK_ASSIGNED.
    Taking the primary offline then causes submit_job to use the Tier-1 backup.
    """
    ok = await manager.assign_fallback("printer-kitchen-01", "printer-kitchen-02")
    assert ok is True

    # Verify event
    fallback_events = await manager._ledger.get_events_by_type(
        EventType.PRINTER_FALLBACK_ASSIGNED
    )
    assert any(
        e.payload.get("printer_id") == "printer-kitchen-01"
        and e.payload.get("fallback_printer_id") == "printer-kitchen-02"
        for e in fallback_events
    )

    # Take primary offline
    kitchen_main = manager.get_printer("printer-kitchen-01")
    kitchen_main.set_fail_mode("offline")

    job = _job("kitchen", order_id="fallback-assign-01")
    result = await manager.submit_job(job)

    assert result.success
    assert result.rerouted_from == "printer-kitchen-01"
    assert result.printer_id == "printer-kitchen-02"

    # Cleanup
    kitchen_main.set_fail_mode(None)


# ═══════════════════════════════════════════════════════════════════════
# 9. get_ready_printers_by_role filters offline printers
# ═══════════════════════════════════════════════════════════════════════

async def test_get_ready_printers_by_role(manager):
    kitchen_main = manager.get_printer("printer-kitchen-01")
    kitchen_main.set_fail_mode("offline")

    ready = manager.get_ready_printers_by_role("kitchen")
    assert len(ready) == 1
    assert ready[0].printer_id == "printer-kitchen-02"

    # Both still registered
    all_kitchen = manager.get_printers_by_role("kitchen")
    assert len(all_kitchen) == 2

    # Cleanup
    kitchen_main.set_fail_mode(None)


# ═══════════════════════════════════════════════════════════════════════
# 10. Nonexistent target_printer_id falls back to role-based routing
# ═══════════════════════════════════════════════════════════════════════

async def test_target_printer_id_nonexistent_falls_back_to_role(manager):
    """
    When target_printer_id refers to an unregistered printer, _resolve_printer
    logs a warning and falls back to role-based selection.
    """
    job = _job(
        "kitchen",
        order_id="nonexistent-id-01",
        target_printer_id="printer-does-not-exist",
    )
    result = await manager.submit_job(job)

    assert result.success
    assert result.printer_id in ("printer-kitchen-01", "printer-kitchen-02")
    assert result.rerouted_from is None
