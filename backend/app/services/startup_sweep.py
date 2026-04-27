"""
Startup crash-recovery sweep.

When the process is killed mid-sale (power blip, SIGKILL, OS panic) the
event ledger can land with a `PAYMENT_INITIATED` that has no matching
result event — the device may have approved or declined before we died,
but the ledger doesn't know which and the order's `balance_due` stays
confused. On the next start-up, this module:

  1. loads the current business day (since last DAY_CLOSED),
  2. finds every PAYMENT_INITIATED older than `max_age_seconds` that has
     no matching PAYMENT_{CONFIRMED,DECLINED,CANCELLED,TIMED_OUT,ERROR},
  3. emits PAYMENT_TIMED_OUT for it so downstream projections stop
     treating the balance as paid-in-flight,
  4. records a FIN-008 diagnostic per sweep hit so the bug report
     captures the orphan count and the session it came from.

The sweep is idempotent — running it twice is a no-op (the second pass
sees the TIMED_OUT events we just wrote and skips). Running it when no
orphans exist is a no-op too.

Only touches today's events. Anything older than the last DAY_CLOSED is
someone else's problem (close_day already auto-voids / auto-closes the
open orders it knows about).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event
from app.models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity

logger = logging.getLogger("kindpos.startup_sweep")


# Event types that terminate an INITIATED. Any of these after a given
# transaction_id means the payment is fully resolved and we leave it.
_RESULT_TYPES = (
    EventType.PAYMENT_CONFIRMED,
    EventType.PAYMENT_DECLINED,
    EventType.PAYMENT_CANCELLED,
    EventType.PAYMENT_TIMED_OUT,
    EventType.PAYMENT_ERROR,
)


async def sweep_orphan_initiated_payments(
    ledger: EventLedger,
    *,
    max_age_seconds: int = 600,
    collector=None,  # Optional DiagnosticCollector; None is fine (tests)
    terminal_id: str = "server",
) -> int:
    """Emit PAYMENT_TIMED_OUT for any in-flight INITIATED older than the
    threshold. Returns the number of orphans resolved.

    `max_age_seconds=600` (10 min) is the default — a live payment
    shouldn't be in-flight that long under any normal flow. Tests
    pass 0 to force a sweep of everything."""
    boundary = await ledger.get_last_day_close_sequence()
    events = await ledger.get_events_since(boundary, limit=50000)

    # Group initiated by payment_id; record resolved payment_ids. Use
    # `payment_id` as the primary key because it's always set on both
    # INITIATED and result events. `transaction_id` is optional (only
    # card flows, only after the device assigns one).
    def _key(ev):
        p = ev.payload or {}
        return p.get("payment_id") or p.get("transaction_id")

    initiated: dict[str, dict] = {}
    resolved: set[str] = set()

    for ev in events:
        k = _key(ev)
        if not k:
            continue
        if ev.event_type == EventType.PAYMENT_INITIATED:
            if k not in initiated:
                initiated[k] = {
                    "payload": ev.payload,
                    "timestamp": ev.timestamp,
                    "terminal_id": ev.terminal_id,
                }
        elif ev.event_type in _RESULT_TYPES:
            resolved.add(k)

    now = datetime.now(timezone.utc)
    orphans_swept = 0

    for key, rec in initiated.items():
        if key in resolved:
            continue
        ts = rec["timestamp"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_s = (now - ts).total_seconds()
        if age_s < max_age_seconds:
            # Still within the live window — another process might be
            # working on it. Don't mark it timed-out prematurely.
            continue

        payload = dict(rec["payload"] or {})
        payload["error"] = "Crash-recovery sweep: no result after process restart"
        payload["error_code"] = "CRASH_RECOVERY_TIMEOUT"
        sweep_event = create_event(
            event_type=EventType.PAYMENT_TIMED_OUT,
            terminal_id=rec["terminal_id"] or terminal_id,
            payload=payload,
            correlation_id=payload.get("order_id"),
        )
        try:
            await ledger.append(sweep_event)
            orphans_swept += 1
            logger.warning(
                "Swept orphan PAYMENT_INITIATED: payment_id=%s order_id=%s age_s=%.0f",
                key, payload.get("order_id"), age_s,
            )
        except Exception as exc:
            logger.error(
                "Failed to sweep orphan PAYMENT_INITIATED: payment_id=%s error=%s",
                key, exc,
            )

        if collector is not None:
            try:
                await collector.record(
                    category=DiagnosticCategory.FIN,
                    severity=DiagnosticSeverity.WARNING,
                    source="startup.sweep_orphan_initiated_payments",
                    event_code="FIN-008",
                    message="Orphaned PAYMENT_INITIATED resolved at startup",
                    context={
                        "payment_id": key,
                        "order_id": payload.get("order_id"),
                        "age_seconds": round(age_s, 1),
                        "terminal_id": rec["terminal_id"],
                    },
                )
            except Exception:  # pragma: no cover — diagnostic must never raise
                logger.exception("FIN-008 diagnostic record failed")

    if orphans_swept:
        logger.warning(
            "Crash-recovery sweep resolved %d orphan PAYMENT_INITIATED event(s)",
            orphans_swept,
        )
    return orphans_swept
