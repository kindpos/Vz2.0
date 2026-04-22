"""
Entomology API routes — PIN-gated diagnostic snapshot, recent issues,
and Excel bug-report download.

All endpoints require a valid session (reused from auth.get_current_session).
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.dependencies import get_diagnostic_collector
from app.api.routes.auth import get_current_session
from app.config import settings
from app.models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity
from app.services.diagnostic_collector import DiagnosticCollector
from app.services.entomology_report import (
    build_bug_report_workbook,
    workbook_to_bytes,
)

router = APIRouter(prefix="/entomology", tags=["entomology"])


# Make the top-level project directory importable so `kindnostic.*` resolves
# when the backend is run as a package from inside `backend/`.
_PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


def require_collector(
    collector: Optional[DiagnosticCollector] = Depends(get_diagnostic_collector),
) -> DiagnosticCollector:
    """FastAPI dependency: resolve the DiagnosticCollector or raise 503."""
    if collector is None:
        raise HTTPException(
            status_code=503,
            detail="DiagnosticCollector not initialized on this backend",
        )
    return collector


async def _heartbeat_age_seconds(collector: DiagnosticCollector) -> Optional[float]:
    """Return seconds since the most recent SYS-HEARTBEAT event, or None."""
    events = await collector.get_events(event_code="SYS-HEARTBEAT", limit=1)
    if not events:
        return None
    # get_events orders ASC by id, so .pop() would be oldest; fetch most recent
    # by querying with a tight window and taking the last element.
    events = await collector.get_events(event_code="SYS-HEARTBEAT", limit=50)
    if not events:
        return None
    latest = max(events, key=lambda e: e.timestamp)
    now = datetime.now(timezone.utc)
    if latest.timestamp.tzinfo is None:
        latest_ts = latest.timestamp.replace(tzinfo=timezone.utc)
    else:
        latest_ts = latest.timestamp
    return (now - latest_ts).total_seconds()


def _run_probes_sync() -> list[dict]:
    """
    Discover and run kindnostic probes. Returns a list of probe-status dicts
    suitable for JSON serialization.

    Called from the async route via asyncio.to_thread since probe execution
    blocks (sockets, SQLite, subprocesses).
    """
    try:
        from kindnostic.runner import discover_probes, run_probe
    except ImportError as exc:
        return [
            {
                "id": "kindnostic",
                "category": "CRITICAL",
                "status": "FAIL",
                "message": f"kindnostic package not importable: {exc}",
                "duration_ms": 0,
            }
        ]

    results: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for name, fn, category in discover_probes():
        probe_result, duration_ms = run_probe(fn, category)
        results.append(
            {
                "id": probe_result.probe_name,
                "category": category.value,
                "status": probe_result.status.value,
                "message": probe_result.message,
                "duration_ms": duration_ms,
                "last_checked": now_iso,
            }
        )
    return results


@router.get("/snapshot")
async def get_snapshot(
    session: dict = Depends(get_current_session),
    collector: DiagnosticCollector = Depends(require_collector),
) -> dict:
    """Current probe status + heartbeat age + system metrics."""
    probes = await asyncio.to_thread(_run_probes_sync)
    heartbeat_age = await _heartbeat_age_seconds(collector)
    system_metrics = collector._collect_system_metrics()

    return {
        "terminal_id": collector.terminal_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "probes": probes,
        "heartbeat_age_seconds": heartbeat_age,
        "system_metrics": system_metrics,
    }


def _serialize_event(ev) -> dict:
    return {
        "diagnostic_id": ev.diagnostic_id,
        "correlation_id": ev.correlation_id,
        "terminal_id": ev.terminal_id,
        "timestamp": ev.timestamp.isoformat(),
        "category": ev.category.value,
        "severity": ev.severity.value,
        "source": ev.source,
        "event_code": ev.event_code,
        "message": ev.message,
        "context": ev.context,
    }


@router.get("/issues")
async def get_issues(
    days: int = Query(7, ge=1, le=90),
    min_severity: str = Query("WARNING"),
    session: dict = Depends(get_current_session),
    collector: DiagnosticCollector = Depends(require_collector),
) -> dict:
    """
    Diagnostic events at severity >= `min_severity` in the last `days` days,
    grouped as { category: { event_code: [events...] } }.

    `min_severity` accepts INFO | WARNING | ERROR | CRITICAL (case-insensitive).
    Defaults to WARNING so pre-filter clients see the same result as before.
    Invalid values fall back to WARNING rather than 400ing — keeps the
    dashboard resilient to typos and future enum additions.
    """
    try:
        sev_floor = DiagnosticSeverity(min_severity.upper())
    except (ValueError, AttributeError):
        sev_floor = DiagnosticSeverity.WARNING

    since = datetime.now(timezone.utc) - timedelta(days=days)

    events = await collector.get_events_by_severity_min(
        sev_floor, since=since
    )

    grouped: dict[str, dict[str, list[dict]]] = {}
    for cat in DiagnosticCategory:
        grouped[cat.value] = {}

    for ev in events:
        by_code = grouped.setdefault(ev.category.value, {})
        by_code.setdefault(ev.event_code, []).append(_serialize_event(ev))

    # Sort each group by timestamp desc for stable UI consumption
    for by_code in grouped.values():
        for rows in by_code.values():
            rows.sort(key=lambda r: r["timestamp"], reverse=True)

    return {
        "since": since.isoformat(),
        "until": datetime.now(timezone.utc).isoformat(),
        "total": len(events),
        "groups": grouped,
    }


@router.get("/report.xlsx")
async def get_report_xlsx(
    days: int = Query(7, ge=1, le=90),
    session: dict = Depends(get_current_session),
    collector: DiagnosticCollector = Depends(require_collector),
):
    """Download an Excel bug report grouped by category × event_code."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    events = await collector.get_events_by_severity_min(
        DiagnosticSeverity.WARNING, since=since
    )

    probes = await asyncio.to_thread(_run_probes_sync)
    heartbeat_age = await _heartbeat_age_seconds(collector)
    snapshot = {
        "terminal_id": collector.terminal_id,
        "generated_at": now,
        "probes": probes,
        "heartbeat_age_seconds": heartbeat_age,
        "system_metrics": collector._collect_system_metrics(),
    }

    wb = build_bug_report_workbook(events, snapshot, (since, now))
    data = workbook_to_bytes(wb)

    filename = (
        f"kindpos-bug-report-{collector.terminal_id}-"
        f"{now.strftime('%Y%m%d-%H%M%S')}.xlsx"
    )

    def _iter_bytes():
        yield data

    return StreamingResponse(
        _iter_bytes(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# =============================================================================
# Client-side ingestion (frontend ENTnodes)
# =============================================================================
#
# Scenes run before login and the login token is not persisted by the current
# frontend, so this endpoint is intentionally unauthenticated — but locked
# down to UI-* events only so it can't be used to forge SEC/FIN/etc. records.
# Call from terminal JS like:
#
#   fetch('/api/v1/entomology/client-event', {
#     method: 'POST',
#     headers: { 'Content-Type': 'application/json' },
#     body: JSON.stringify({
#       event_code: 'UI-001',
#       severity:   'WARNING',
#       source:     'scene-manager.interrupt',
#       message:    'Interrupt stacked — prior torn down',
#       context:    { prior: 'confirm-void', next: 'tip-adjust' },
#     }),
#   });

_ALLOWED_CLIENT_SEVERITIES = {"INFO", "WARNING", "ERROR"}
_MAX_CONTEXT_BYTES = 4096


class ClientEventRequest(BaseModel):
    event_code: str = Field(..., min_length=3, max_length=40)
    severity: str = Field("WARNING")
    source: str = Field(..., min_length=1, max_length=120)
    message: str = Field(..., min_length=1, max_length=500)
    context: dict[str, Any] = Field(default_factory=dict)


@router.post("/client-event")
async def record_client_event(
    body: ClientEventRequest,
    collector: Optional[DiagnosticCollector] = Depends(get_diagnostic_collector),
) -> dict:
    """Accept a single UI-* diagnostic from the frontend.

    Locked down to UI category so a compromised browser session can't forge
    SEC/FIN findings. Returns 202 regardless of whether the collector is
    initialized — the terminal should be fire-and-forget here.
    """
    if not body.event_code.startswith("UI-"):
        raise HTTPException(400, "client-event only accepts UI-* event codes")
    if body.severity not in _ALLOWED_CLIENT_SEVERITIES:
        raise HTTPException(400, f"severity must be one of {_ALLOWED_CLIENT_SEVERITIES}")
    # Cap context size so a runaway client can't flood the SQLite row.
    try:
        import json as _json
        if len(_json.dumps(body.context)) > _MAX_CONTEXT_BYTES:
            raise HTTPException(413, "context exceeds 4KB")
    except (TypeError, ValueError):
        raise HTTPException(400, "context must be JSON-serializable")

    if collector is None:
        return {"accepted": False, "reason": "collector not initialized"}

    try:
        await collector.record(
            category=DiagnosticCategory.UI,
            severity=DiagnosticSeverity(body.severity),
            source=body.source,
            event_code=body.event_code,
            message=body.message,
            context=body.context,
        )
    except Exception:
        # Never 5xx the terminal over a diagnostic write — swallow and move on.
        return {"accepted": False, "reason": "record failed"}
    return {"accepted": True}
