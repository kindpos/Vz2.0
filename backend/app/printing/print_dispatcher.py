"""
KINDpos Print Dispatcher
Polls the print queue, resolves printer IPs, sends ESC/POS bytes over network.
Retry loop: immediate → 5s → 15s → 30s → FAILED
"""
import asyncio
import json
import logging
import socket
import aiosqlite
import os
from typing import Dict, Optional

from .print_queue import PrintJobQueue
from .escpos_formatter import ESCPOSFormatter
from .templates.guest_receipt import GuestReceiptTemplate
from .templates.kitchen_ticket import KitchenTicketTemplate
from .templates.clock_hours import ClockHoursTemplate
from .templates.sales_recap import SalesRecapTemplate
from .templates.server_checkout import ServerCheckoutTemplate

logger = logging.getLogger("kindpos.printing.dispatcher")

# ── Hardware config DB path ────────────────────────────────────────────────────
HARDWARE_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'hardware_config.db'
)

# ── Fallback IPs (used if hardware_config.db has no entry) ────────────────────
FALLBACK_IPS: Dict[str, str] = {
    "DEFAULT_RECEIPT": "10.0.0.186",
    "DEFAULT_KITCHEN": "10.0.0.19",
}

# Type-based fallback when a MAC-registered printer's IP can't be resolved
_TYPE_FALLBACK_IPS: Dict[str, str] = {
    "kitchen": "10.0.0.19",
    "receipt": "10.0.0.186",
}

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

        try:
            context = json.loads(job["context_json"])
            ip, port, ptype = await self._resolve_printer(printer_mac)
            raw     = self._render(template_id, context, ptype)
            await self._send(ip, port, raw)
            await self._queue.mark_completed(job_id)
            logger.info(f"Job {job_id} ({template_id}) → {ip}:{port} ✓")

        except Exception as e:
            logger.warning(f"Job {job_id} attempt {attempt} failed: {e}")
            await self._queue.reset_for_retry(job_id)
            # Preserve attempt count after reset
            try:
                await self._queue._db.execute(
                    "UPDATE print_queue SET attempt_count = ? WHERE job_id = ?",
                    (attempt, job_id)
                )
                await self._queue._db.commit()
            except Exception:
                pass
            if attempt >= MAX_ATTEMPTS:
                await self._queue.mark_failed(job_id)
                logger.error(f"Job {job_id} FAILED after {attempt} attempts: {e}")
                self._broadcast_failure(job, str(e))

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
        Resolve a printer MAC to (ip, port, type).
        Falls back to legacy DEFAULT_* sentinel keys, then type-based defaults.
        """
        # Legacy sentinel keys (used before MAC-as-identity was wired)
        if printer_mac in FALLBACK_IPS:
            ip = FALLBACK_IPS[printer_mac]
            ptype = "kitchen" if "KITCHEN" in printer_mac else "receipt"
            return ip, PRINTER_PORT, ptype

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
                        # IP missing but record exists — type-based IP fallback
                        if ptype and ptype in _TYPE_FALLBACK_IPS:
                            logger.warning(f"No IP for {printer_mac}, using {ptype} type fallback")
                            return _TYPE_FALLBACK_IPS[ptype], (port or PRINTER_PORT), ptype
        except Exception as e:
            logger.warning(f"hardware_config.db lookup failed for {printer_mac}: {e}")

        # Last resort: infer type from MAC string (unlikely but safe)
        for ttype, ip in _TYPE_FALLBACK_IPS.items():
            if ttype in printer_mac.lower():
                logger.warning(f"Using type-name fallback for {printer_mac} → {ip}")
                return ip, PRINTER_PORT, ttype

        raise ValueError(f"No IP found for printer MAC: {printer_mac}")

    # ── Network send ──────────────────────────────────────────────────────────

    async def _send(self, ip: str, port: int, data: bytes) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._send_sync, ip, port, data)

    def _send_sync(self, ip: str, port: int, data: bytes) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(5)
            s.connect((ip, port))
            s.sendall(data)