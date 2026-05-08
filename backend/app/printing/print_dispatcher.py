"""
KINDpos Print Dispatcher (DEPRECATED)
Polls the print queue, resolves printer IPs, sends ESC/POS bytes over network.
Retry loop: immediate → 5s → 15s → 30s → FAILED

DEPRECATION WARNING:
This module is deprecated. Use PrinterManager with EscPosNetworkAdapter instead.
PrintDispatcher will be removed in a future release.
"""
import asyncio
import json
import logging
import socket
import aiosqlite
import os
import warnings
from typing import Dict, Optional

# Emit deprecation warning when this module is imported
warnings.warn(
    "PrintDispatcher is deprecated. Use PrinterManager with EscPosNetworkAdapter instead.",
    DeprecationWarning,
    stacklevel=2
)

from .print_queue import PrintJobQueue
from .escpos_formatter import ESCPOSFormatter
from .templates.guest_receipt import GuestReceiptTemplate
from .templates.kitchen_ticket import KitchenTicketTemplate
from .templates.clock_hours import ClockHoursTemplate
from .templates.sales_recap import SalesRecapTemplate
from .templates.server_checkout import ServerCheckoutTemplate
from ..models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity

logger = logging.getLogger("kindpos.printing.dispatcher")

# ── Hardware config DB path ────────────────────────────────────────────────────
HARDWARE_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'hardware_config.db'
)


PRINTER_PORT = 9100
RETRY_DELAYS = [0, 5, 15, 30]
MAX_ATTEMPTS = len(RETRY_DELAYS)

# Physical paper width (mm) for 80mm thermal rolls. Applies to both the
# thermal receipt printer and the TM-U220 impact printer in this fleet.
PAPER_WIDTH_80MM = 80

# Column width per printer class. Receipt = thermal (58 chars fits at our
# font size). Kitchen = TM-U220 impact (33 chars at its smallest width).
# These are deployment-specific — different fleet → different numbers, and
# should ultimately come from hardware_config rather than live here.
RECEIPT_CHARS_PER_LINE = 48
KITCHEN_CHARS_PER_LINE = 33


class PrintDispatcher:
    """
    Background service that drains the print queue.
    Call start() once at app startup, stop() at shutdown.
    """

    def __init__(self, queue: PrintJobQueue, poll_interval: float = 3.0):
        self._queue         = queue
        self._poll_interval = poll_interval
        self._running       = False
        self._task: Optional[asyncio.Task] = None
        self._failure_subscribers: list[asyncio.Queue] = []

        self._formatter_receipt = ESCPOSFormatter(
            paper_width=PAPER_WIDTH_80MM, chars_per_line=RECEIPT_CHARS_PER_LINE,
        )
        self._formatter_kitchen = ESCPOSFormatter(
            paper_width=PAPER_WIDTH_80MM, chars_per_line=KITCHEN_CHARS_PER_LINE,
        )
        self._templates_receipt = {
            "guest_receipt":  GuestReceiptTemplate(
                paper_width=PAPER_WIDTH_80MM, chars_per_line=RECEIPT_CHARS_PER_LINE,
            ),
            "clock_hours":    ClockHoursTemplate(
                paper_width=PAPER_WIDTH_80MM, chars_per_line=RECEIPT_CHARS_PER_LINE,
            ),
            "sales_recap":    SalesRecapTemplate(
                paper_width=PAPER_WIDTH_80MM, chars_per_line=RECEIPT_CHARS_PER_LINE,
            ),
            "server_checkout": ServerCheckoutTemplate(
                paper_width=PAPER_WIDTH_80MM, chars_per_line=RECEIPT_CHARS_PER_LINE,
            ),
        }
        _kitchen_tmpl = KitchenTicketTemplate(
            paper_width=PAPER_WIDTH_80MM, chars_per_line=KITCHEN_CHARS_PER_LINE,
        )
        self._templates_kitchen = {
            "kitchen_ticket":      _kitchen_tmpl,
            "kitchen_ticket_void": _kitchen_tmpl,  # same class; void flag set in context
        }

    def subscribe_failures(self) -> asyncio.Queue:
        """Return a queue that receives print failure dicts."""
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._failure_subscribers.append(q)
        return q

    def unsubscribe_failures(self, q: asyncio.Queue) -> None:
        try:
            self._failure_subscribers.remove(q)
        except ValueError:
            pass

    def _broadcast_failure(self, job: dict, error: str) -> None:
        msg = {
            "type": "print_failure",
            "job_id": job.get("job_id"),
            "order_id": job.get("order_id"),
            "template_id": job.get("template_id"),
            "printer_mac": job.get("printer_mac"),
            "error": error,
        }
        for q in list(self._failure_subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass  # drop if subscriber is too slow

    async def start(self) -> None:
        self._running = True
        # Reset jobs that were mid-send when the process last died so they
        # don't stay stuck in 'sent' forever. Stale threshold matches the
        # TCP socket timeout (5s) plus the maximum retry delay (30s).
        await self._queue.recover_stale_sent_jobs(stale_after_seconds=60)
        self._task    = asyncio.create_task(self._loop())
        logger.info("PrintDispatcher started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("PrintDispatcher stopped")

    # ── Main poll loop ────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        while self._running:
            try:
                jobs = await self._queue.get_pending_jobs()
                for job in jobs:
                    if not self._running:
                        break
                    await self._process_job(job)
            except Exception as e:
                logger.error(f"Dispatcher loop error: {e}")
            await asyncio.sleep(self._poll_interval)

    # ── Job processor ─────────────────────────────────────────────────────────

    async def _process_job(self, job: dict) -> None:
        job_id      = job["job_id"]
        attempt     = job.get("attempt_count", 0) + 1
        template_id = job["template_id"]
        printer_mac = job["printer_mac"]

        if attempt > MAX_ATTEMPTS:
            await self._queue.mark_failed(job_id)
            logger.error(f"Job {job_id} exceeded max attempts — marked FAILED")
            self._broadcast_failure(job, "Exceeded max retry attempts")
            return

        delay = RETRY_DELAYS[attempt - 1]
        if delay > 0:
            logger.info(f"Job {job_id} retry #{attempt} in {delay}s")
            await asyncio.sleep(delay)

        await self._queue.mark_sent(job_id, attempt)

        # ── Phase 1: render (deterministic — fail immediately, no retry) ──
        try:
            context = json.loads(job["context_json"])
            ip, port, ptype = await self._resolve_printer(printer_mac)
            raw = self._render(template_id, context, ptype)
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Job {job_id} render/config error (will not retry): {e}")
            await self._queue.mark_failed(job_id)
            self._broadcast_failure(job, f"Render error: {e}")
            return

        # ── Phase 2: network send (transient — retry up to MAX_ATTEMPTS) ──
        try:
            await self._send(ip, port, raw)
            await self._queue.mark_completed(job_id)
            logger.info(f"Job {job_id} ({template_id}) → {ip}:{port} ✓")
        except Exception as e:
            logger.warning(f"Job {job_id} attempt {attempt} failed: {e}")
            # Classify the failure for entomology. Each class maps to the
            # reserved PER-* code that matches its diagnostic meaning —
            # lets the dashboard distinguish "printer is powered off"
            # (PER-002) from "printer is unreachable over LAN" (PER-001)
            # from "printer accepted the connection but never acked the
            # payload" (PER-003).
            await self._classify_and_report(job, attempt, e)
            if attempt >= MAX_ATTEMPTS:
                await self._queue.mark_failed(job_id)
                logger.error(f"Job {job_id} FAILED after {attempt} attempts: {e}")
                self._broadcast_failure(job, str(e))
            else:
                await self._queue.bump_attempt_for_retry(job_id, attempt)

    async def _classify_and_report(self, job: dict, attempt: int, exc: Exception) -> None:
        """Best-effort print-diagnostic emission.

        Swallows its own failures — an instrumentation hiccup must never
        block a print retry. Each branch matches a reserved PER-* code so
        the entomology dashboard can surface what kind of problem this is
        without opening the queue log.
        """
        # Late import to avoid circular: app.api.dependencies pulls
        # PrintDispatcher/PrinterManager transitively.
        from ..api.dependencies import get_diagnostic_collector
        collector = get_diagnostic_collector()
        if collector is None:
            return

        # PER-003 — we got as far as opening the socket but the send/recv
        # timed out. socket.settimeout(5) at line 261 bounds this.
        if isinstance(exc, socket.timeout) or isinstance(exc, asyncio.TimeoutError):
            code = "PER-003"
            msg = "Print job timeout (printer did not ack within 5s)"
        elif isinstance(exc, ConnectionRefusedError):
            # PER-002 — printer is reachable on the network but refused the
            # connection (service off, port blocked, wrong port).
            code = "PER-002"
            msg = "Print job refused by printer endpoint (ConnectionRefusedError)"
        elif isinstance(exc, (socket.gaierror, OSError)):
            # PER-001 — any other socket / OS error. Includes "No route to
            # host", "Host is unreachable", DNS failures.
            code = "PER-001"
            msg = f"Print job connection failed: {type(exc).__name__}: {exc}"
        else:
            # Not a network error — probably a template / formatting bug.
            # Don't emit PER-* here; let it flow to the generic failure
            # broadcast + queue mark_failed path instead.
            return

        sev = (
            DiagnosticSeverity.ERROR
            if attempt >= MAX_ATTEMPTS
            else DiagnosticSeverity.WARNING
        )
        try:
            await collector.record(
                category=DiagnosticCategory.PERIPHERAL,
                severity=sev,
                source="print_dispatcher._process_job",
                event_code=code,
                message=msg,
                context={
                    "job_id": job.get("job_id"),
                    "printer_mac": job.get("printer_mac"),
                    "template_id": job.get("template_id"),
                    "attempt": attempt,
                    "max_attempts": MAX_ATTEMPTS,
                },
            )
        except Exception:
            logger.exception("PER-* diagnostic emit failed (swallowed)")

    # ── Render ────────────────────────────────────────────────────────────────

    def _render(self, template_id: str, context: dict, printer_type: str = "receipt") -> bytes:
        is_kitchen = (printer_type == "kitchen")
        templates = self._templates_kitchen if is_kitchen else self._templates_receipt
        formatter = self._formatter_kitchen if is_kitchen else self._formatter_receipt

        template = templates.get(template_id)
        if not template:
            # Fall back to the other set in case caller mis-classified
            other = self._templates_receipt if is_kitchen else self._templates_kitchen
            template = other.get(template_id)
        if not template:
            raise ValueError(f"Unknown template: {template_id}")
        commands = template.render(context)
        return formatter.format(commands)

    # ── Printer resolution ────────────────────────────────────────────────────

    async def _resolve_printer(self, printer_mac: str) -> tuple[str, int, str]:
        """
        Resolve a printer MAC to (ip, port, type) from hardware_config.db.
        hardware_config.db is the only source of printer IPs.
        """
        try:
            async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
                async with db.execute(
                    "SELECT ip, port, type FROM devices WHERE mac = ? LIMIT 1",
                    (printer_mac,)
                ) as cursor:
                    row = await cursor.fetchone()
                    if row:
                        ip, port, ptype = row
                        if ip:
                            return ip, (port or PRINTER_PORT), (ptype or "receipt")
                        raise ValueError(f"Printer {printer_mac} found but has no IP configured")
                    raise ValueError(f"Printer {printer_mac} not found in hardware_config.db")
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"hardware_config.db lookup failed for {printer_mac}: {e}")

    # ── Network send ──────────────────────────────────────────────────────────

    async def _send(self, ip: str, port: int, data: bytes) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._send_sync, ip, port, data)

    def _send_sync(self, ip: str, port: int, data: bytes) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(5)
            s.connect((ip, port))
            s.sendall(data)