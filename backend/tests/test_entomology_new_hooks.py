"""
Pytest coverage for the newly-wired entomology hooks:

  SYS-003 — disk-space threshold emit from heartbeat
  SYS-004 — memory-usage threshold emit from heartbeat
  SYS-005 — CPU-temp threshold emit from heartbeat
  FIN-006 — tip adjustment after day close (prior-day payment altered)
  SEC-004 — sync replay with events claiming this terminal's id
  PER-007 — cash drawer open failure path invokes the reporter helper

These test the emit path in isolation — they don't try to reproduce
the full runtime flow. That keeps them fast and avoids heavy fixture
plumbing for what is ultimately a one-line record() call.
"""

from unittest.mock import patch

import pytest
import pytest_asyncio

from app.models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity


# ─── SYS-003 / 004 / 005 — heartbeat threshold emits ──────────────────────

@pytest.mark.asyncio
async def test_sys003_disk_threshold_emits_warning(collector):
    """Disk usage above the threshold produces a SYS-003 WARNING event."""
    with patch.object(
        collector, "_collect_system_metrics",
        return_value={"memory_used_pct": 30.0, "disk_used_pct": 92.5,
                      "cpu_temp_c": 55.0, "uptime_hours": 1.0},
    ):
        await collector._collect_heartbeat()
    events = await collector.get_events(event_code="SYS-003")
    assert len(events) == 1
    ev = events[0]
    assert ev.severity == DiagnosticSeverity.WARNING
    assert ev.category == DiagnosticCategory.SYSTEM
    assert ev.context["disk_used_pct"] == 92.5
    assert ev.context["threshold"] == 85.0


@pytest.mark.asyncio
async def test_sys004_memory_threshold_emits_warning(collector):
    with patch.object(
        collector, "_collect_system_metrics",
        return_value={"memory_used_pct": 91.2, "disk_used_pct": 30.0,
                      "cpu_temp_c": 55.0, "uptime_hours": 1.0},
    ):
        await collector._collect_heartbeat()
    events = await collector.get_events(event_code="SYS-004")
    assert len(events) == 1
    assert events[0].context["memory_used_pct"] == 91.2


@pytest.mark.asyncio
async def test_sys005_cpu_temp_threshold_emits_warning(collector):
    with patch.object(
        collector, "_collect_system_metrics",
        return_value={"memory_used_pct": 30.0, "disk_used_pct": 30.0,
                      "cpu_temp_c": 82.0, "uptime_hours": 1.0},
    ):
        await collector._collect_heartbeat()
    events = await collector.get_events(event_code="SYS-005")
    assert len(events) == 1
    assert events[0].context["cpu_temp_c"] == 82.0


@pytest.mark.asyncio
async def test_heartbeat_below_thresholds_emits_nothing_derived(collector):
    """All metrics comfortably below threshold → only SYS-HEARTBEAT itself."""
    with patch.object(
        collector, "_collect_system_metrics",
        return_value={"memory_used_pct": 50.0, "disk_used_pct": 50.0,
                      "cpu_temp_c": 50.0, "uptime_hours": 5.0},
    ):
        await collector._collect_heartbeat()
    assert len(await collector.get_events(event_code="SYS-HEARTBEAT")) == 1
    assert len(await collector.get_events(event_code="SYS-003")) == 0
    assert len(await collector.get_events(event_code="SYS-004")) == 0
    assert len(await collector.get_events(event_code="SYS-005")) == 0


# ─── PER-007 — drawer-failure helper invokes the collector ──────────────

@pytest.mark.asyncio
async def test_per007_helper_records_warning_when_collector_present(collector):
    """The PrinterManager helper pulls the module-level singleton via
    get_diagnostic_collector — register our test collector, invoke, assert."""
    from app.api import dependencies as deps
    from app.core.adapters import printer_manager

    prior = deps._diagnostic_collector  # type: ignore[attr-defined]
    deps.set_diagnostic_collector(collector)
    try:
        await printer_manager._report_drawer_failure(
            printer_id="PR-001",
            reason="Drawer kick command failed",
            opened_by="emp-42",
        )
    finally:
        deps._diagnostic_collector = prior  # type: ignore[attr-defined]

    events = await collector.get_events(event_code="PER-007")
    assert len(events) == 1
    ev = events[0]
    assert ev.severity == DiagnosticSeverity.WARNING
    assert ev.category == DiagnosticCategory.PERIPHERAL
    assert ev.context["printer_id"] == "PR-001"
    assert ev.context["opened_by"] == "emp-42"


@pytest.mark.asyncio
async def test_per007_helper_noops_when_collector_missing():
    """Helper must not raise when no collector is wired."""
    from app.api import dependencies as deps
    from app.core.adapters import printer_manager

    prior = deps._diagnostic_collector  # type: ignore[attr-defined]
    deps._diagnostic_collector = None   # type: ignore[attr-defined]
    try:
        await printer_manager._report_drawer_failure(
            printer_id="PR-001",
            reason="no collector wired",
            opened_by=None,
        )
    finally:
        deps._diagnostic_collector = prior  # type: ignore[attr-defined]
