import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path

import aiosqlite

from ...config import settings
from ..dependencies import get_ledger, get_print_dispatcher, get_printer_manager
from ...core.event_ledger import EventLedger
from ...models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity
from ...printing.print_queue import PrintJobQueue
from ...printing.escpos_formatter import ESCPOSFormatter
from ...printing.templates.guest_receipt import GuestReceiptTemplate
from ...printing.templates.kitchen_ticket import KitchenTicketTemplate
from ...services.print_context_builder import PrintContextBuilder
from ...services.routing_resolver import resolve_routing_rule
from ...services.store_config_service import StoreConfigService
from ...core.adapters.base_printer import (
    PrintJob,
    PrintJobContent,
    PrintJobType,
    PrintJobPriority,
    OrderContext,
)
from .auth import _record_diag, require_manager
from .hardware import HARDWARE_DB_PATH, _ensure_db

router = APIRouter(prefix="/print", tags=["printing"])

# In a real app, these would be managed by dependency injection
# For this task, we initialize them here or in main.py
print_queue = PrintJobQueue()
# Note: In production, PrintContextBuilder would be injected with the ledger

_logger = logging.getLogger(__name__)


def _store_now() -> datetime:
    """Return wall-clock time in the configured store timezone, falling
    back to UTC if the host lacks IANA tzdata (e.g. Windows without the
    `tzdata` package). The resolver only cares about HH:MM + weekday,
    so UTC is correct as a last-resort default; deployments that need
    accurate local-time rules should `pip install tzdata`."""
    try:
        return datetime.now(ZoneInfo(settings.store_tz))
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc)


async def _fetch_routing_rules(printer_mac: str) -> list[dict]:
    """Return all active `printer_routing` rows for `printer_mac`.

    Empty list on any read failure / missing DB — the resolver treats an
    empty list as "no rule applies" so the dispatch path falls through
    to its pre-resolver behavior unchanged."""
    try:
        async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM printer_routing"
                " WHERE printer_mac = ? AND is_active = 1",
                (printer_mac,),
            ) as cur:
                rows = await cur.fetchall()
                return [dict(r) for r in rows]
    except Exception:
        return []


def _find_ready_printer_by_mac(manager, mac: str):
    """Look up a ready printer adapter by MAC for `redirect_to_mac`.
    Returns None if no such adapter exists or it isn't ready — caller
    falls back to the originally-matched printer (§3.2)."""
    for p in manager.get_all_printers():
        if p.printer_id == mac and p.is_ready():
            return p
    return None


async def _resolve_receipt_printer(terminal_id: str) -> str:
    """Return the MAC address for this terminal's assigned receipt printer.

    Lookup order:
      1. Receipt printers in hardware_config.db assigned to terminal_id
         (stored in the `terminal_id` column added by the hardware section)
      2. First available receipt printer in hardware_config.db (any terminal)
      3. Sentinel "DEFAULT_RECEIPT" — preserves original fallback behaviour
    """
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        # Check for a terminal-specific assignment first
        async with db.execute(
            "SELECT mac FROM devices "
            "WHERE role = 'receipt' "
            "AND EXISTS ("
            "    SELECT 1 FROM json_each(terminal_ids) "
            "    WHERE value = ?"
            ") "
            "LIMIT 1",
            (terminal_id,),
        ) as cur:
            row = await cur.fetchone()
        if row:
            return row["mac"]

        # Fall back to the first receipt printer regardless of terminal
        async with db.execute(
            "SELECT mac FROM devices WHERE role = 'receipt' ORDER BY saved_at LIMIT 1"
        ) as cur:
            row = await cur.fetchone()
        if row:
            return row["mac"]

    return "DEFAULT_RECEIPT"


async def _get_print_itemized(terminal_id: str, ledger: EventLedger) -> bool:
    """Return print_itemized_copy setting from store config receipt_settings.
    Returns False if terminal_id is absent or on any error."""
    if not terminal_id:
        return False
    try:
        store_cfg = await StoreConfigService(ledger).get_projected_config()
        return bool(store_cfg.receipt_settings.get("print_itemized_copy", False))
    except Exception:
        return False


@router.post("/receipt/{order_id}", dependencies=[Depends(require_manager)])
async def print_receipt(
    request: Request,
    order_id: str,
    copy_type: str = "customer",   # query param: customer | merchant | itemized
    seats: str = "",               # query param: comma-separated seat numbers
    ledger: EventLedger = Depends(get_ledger),
):
    """Trigger receipt print for completed order. copy_type defaults to customer.

    `seats=1,3` switches the receipt into per-seat mode — only items on
    those seats render and totals collapse to a simple subtotal (no
    tax/tip/payment). Empty `seats` → existing whole-order behavior."""
    terminal_id = request.headers.get("X-Terminal-Id", "")
    manager = get_printer_manager()

    parsed_seats = [int(s.strip()) for s in seats.split(",") if s.strip()]
    seat_numbers = parsed_seats if parsed_seats else None

    # Fallback to print_queue (PrintDispatcher) if PrinterManager not available
    if not manager:
        builder = PrintContextBuilder(ledger)
        context = await builder.build_receipt_context(
            order_id, copy_type=copy_type, seat_numbers=seat_numbers,
        )
        printer_mac = await _resolve_receipt_printer(terminal_id)
        job_id = await print_queue.enqueue(
            order_id=order_id,
            template_id="guest_receipt",
            printer_mac=printer_mac,
            ticket_number=context.get("ticket_number", "N/A"),
            context=context,
            copy_type=copy_type,
        )
        if terminal_id and await _get_print_itemized(terminal_id, ledger):
            itemized_ctx = dict(context)
            itemized_ctx["copy_type"] = "itemized"
            await print_queue.enqueue(
                order_id=order_id,
                template_id="guest_receipt",
                printer_mac=printer_mac,
                ticket_number=itemized_ctx.get("ticket_number", "N/A"),
                context=itemized_ctx,
                copy_type="itemized",
            )
        return {"status": "queued", "job_id": job_id, "copy_type": copy_type}

    # Use PrinterManager path
    all_receipt_printers = manager.get_ready_printers_by_role("receipt")
    if not all_receipt_printers:
        return {"status": "error", "detail": "No receipt printer available"}

    # Narrow to this terminal's assigned receipt printer when one resolves;
    # fall back to the full set if no adapter matches (preserves
    # single-terminal installs without terminal_ids bindings).
    assigned_mac = await _resolve_receipt_printer(terminal_id)
    matched = [p for p in all_receipt_printers if p.printer_id == assigned_mac]
    printers = matched if matched else all_receipt_printers

    builder = PrintContextBuilder(ledger)
    context = await builder.build_receipt_context(
        order_id, copy_type=copy_type, seat_numbers=seat_numbers,
    )

    job_ids: list[str] = []
    for printer in printers:
        try:
            printer_mac = printer.printer_id

            # Audit follow-up: dedup window covers queued/sent/completed
            # within 60 s so a back-to-back identical press doesn't push
            # a second job onto the printer adapter.
            recent = await print_queue.get_recent_job(
                order_id=order_id,
                template_id="guest_receipt",
                printer_mac=printer_mac,
                copy_type=copy_type,
            )
            if recent:
                _logger.info(
                    "Dedup hit: receipt %s/%s/%s → existing job %s",
                    order_id, printer.name, copy_type, recent["job_id"],
                )
                job_ids.append(recent["job_id"])
                continue

            # HARDWARE_ROUTING.md §3 — receipts only honor the redirect
            # half of the resolver; receipts don't have a category
            # filter, so we ignore winning_rule.category_id here.
            rules = await _fetch_routing_rules(printer_mac)
            winning_rule = resolve_routing_rule(
                rules,
                category_id="",
                now=_store_now(),
            )
            dispatch_printer = printer
            if winning_rule:
                redirect_mac = (winning_rule.get("redirect_to_mac") or "").strip()
                if redirect_mac:
                    target = _find_ready_printer_by_mac(manager, redirect_mac)
                    if target is not None:
                        dispatch_printer = target
                        _logger.info(
                            "Routing redirect: receipt %s → %s (order %s)",
                            printer_mac, redirect_mac, order_id,
                        )
                    else:
                        _logger.warning(
                            "Routing redirect target %s not ready — "
                            "falling back to %s",
                            redirect_mac, printer_mac,
                        )

            chars_per_line = getattr(dispatch_printer, 'chars_per_line', 48)
            formatter = ESCPOSFormatter(chars_per_line=chars_per_line)
            template = GuestReceiptTemplate(chars_per_line=chars_per_line)
            commands = template.render(context)
            raw_bytes = formatter.format(commands)

            # Allocate the job_id via enqueue so the row exists for
            # future dedup. enqueue's own 'queued'/'sent' check also
            # collapses simultaneous concurrent calls. Status flips to
            # 'completed' (or 'failed') below before this handler returns.
            job_id = await print_queue.enqueue(
                order_id=order_id,
                template_id="guest_receipt",
                printer_mac=printer_mac,
                ticket_number=context.get('ticket_number', 'N/A'),
                context=context,
                copy_type=copy_type,
            )

            job = PrintJob(
                job_id=job_id,
                order_id=order_id,
                job_type=PrintJobType.RECEIPT,
                order_context=OrderContext.DINE_IN,
                target_role="receipt",
                target_printer_id=dispatch_printer.printer_id,
                content=PrintJobContent(body_lines=raw_bytes),
                server_name="",
                terminal_id=terminal_id,
                priority=PrintJobPriority.NORMAL,
            )

            result = await dispatch_printer.print_job(job)
            if result.success:
                await print_queue.mark_completed(job_id)
                job_ids.append(job_id)
                _logger.info(f"Receipt printed on {dispatch_printer.name}")
            else:
                await print_queue.mark_failed(job_id)
                _logger.warning(f"Receipt print failed on {dispatch_printer.name}: {result.message}")
        except Exception as e:
            _logger.error(f"Error printing receipt on {printer.name}: {e}")

    if not job_ids:
        return {"status": "error", "detail": "Failed to print on any receipt printer"}

    if terminal_id and await _get_print_itemized(terminal_id, ledger):
        itemized_ctx = dict(context)
        itemized_ctx["copy_type"] = "itemized"
        for printer in printers:
            try:
                printer_mac = printer.printer_id

                recent_itemized = await print_queue.get_recent_job(
                    order_id=order_id,
                    template_id="guest_receipt",
                    printer_mac=printer_mac,
                    copy_type="itemized",
                )
                if recent_itemized:
                    _logger.info(
                        "Dedup hit: itemized receipt %s/%s → existing job %s",
                        order_id, printer.name, recent_itemized["job_id"],
                    )
                    continue

                chars_per_line = getattr(printer, 'chars_per_line', 48)
                formatter = ESCPOSFormatter(chars_per_line=chars_per_line)
                template = GuestReceiptTemplate(chars_per_line=chars_per_line)
                commands = template.render(itemized_ctx)
                raw_bytes = formatter.format(commands)

                itemized_job_id = await print_queue.enqueue(
                    order_id=order_id,
                    template_id="guest_receipt",
                    printer_mac=printer_mac,
                    ticket_number=itemized_ctx.get('ticket_number', 'N/A'),
                    context=itemized_ctx,
                    copy_type="itemized",
                )

                job = PrintJob(
                    job_id=itemized_job_id,
                    order_id=order_id,
                    job_type=PrintJobType.RECEIPT,
                    order_context=OrderContext.DINE_IN,
                    target_role="receipt",
                    target_printer_id=printer.printer_id,
                    content=PrintJobContent(body_lines=raw_bytes),
                    server_name="",
                    terminal_id=terminal_id,
                    priority=PrintJobPriority.NORMAL,
                )
                result = await printer.print_job(job)
                if result.success:
                    await print_queue.mark_completed(itemized_job_id)
                    _logger.info(f"Itemized receipt printed on {printer.name}")
                else:
                    await print_queue.mark_failed(itemized_job_id)
                    _logger.warning(f"Itemized receipt print failed on {printer.name}: {result.message}")
            except Exception as e:
                _logger.error(f"Error printing itemized receipt on {printer.name}: {e}")

    return {"status": "sent", "printers": len(job_ids), "copy_type": copy_type, "job_ids": job_ids}

@router.post("/ticket/{order_id}", dependencies=[Depends(require_manager)])
async def print_ticket(
    order_id: str,
    void: bool = False,
    ledger: EventLedger = Depends(get_ledger),
):
    """Trigger kitchen ticket for order. Pass ?void=true for void tickets.

    Routing logic:
    - Load kitchen printers from hardware_config.db (or use PrinterManager)
    - Printers with assigned categories only receive items in those categories
    - Printers with NO categories receive all items (catch-all)
    - Each printer gets a separate ticket with companion_items showing
      what the other printers are making
    """
    manager = get_printer_manager()
    builder = PrintContextBuilder(ledger)

    # Fallback to print_queue (PrintDispatcher) if PrinterManager not available
    if not manager:
        await _ensure_db()
        template_id = "kitchen_ticket_void" if void else "kitchen_ticket"

        # Load kitchen printers and their category assignments
        async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM devices WHERE type = 'kitchen' ORDER BY saved_at"
            ) as cur:
                printers = [dict(row) async for row in cur]

        # Parse category lists
        for p in printers:
            cats = p.get('categories', '')
            p['categories_list'] = [c.strip() for c in cats.split(',') if c.strip()] if cats else []

        # If no kitchen printers saved, fall back to DEFAULT_KITCHEN with all items
        if not printers:
            printers = [{'mac': 'DEFAULT_KITCHEN', 'name': 'Kitchen', 'categories_list': []}]

        # Build one ticket per printer, filtering by category
        job_ids = []
        ticket_total = len(printers)
        for idx, printer in enumerate(printers):
            cats = printer['categories_list']
            context = await builder.build_kitchen_context(
                order_id,
                station_name=printer.get('name', 'Kitchen'),
                station_categories=cats if cats else None,
            )
            context['ticket_index'] = idx + 1
            context['ticket_total'] = ticket_total
            if void:
                context["is_void"] = True
                context["void_banner"] = "** VOID **"

            # Skip printers that would get zero items for this order
            if not context.get('items'):
                continue

            job_id = await print_queue.enqueue(
                order_id=order_id,
                template_id=template_id,
                printer_mac=printer['mac'],
                ticket_number=context.get('ticket_number', 'N/A'),
                context=context,
            )
            job_ids.append(job_id)

        return {"status": "queued", "job_ids": job_ids, "printers": len(job_ids), "is_void": void}

    # Use PrinterManager path
    printers = manager.get_ready_printers_by_role("kitchen")
    if not printers:
        return {"status": "error", "detail": "No kitchen printer available"}

    template_id = "kitchen_ticket_void" if void else "kitchen_ticket"

    job_ids = []
    ticket_index = 1

    for printer in printers:
        try:
            printer_mac = printer.printer_id

            # Audit follow-up: dedup window covers queued/sent/completed
            # within 60 s so a back-to-back identical press doesn't push
            # a second job onto the printer adapter. Keyed on
            # (order_id, template_id, printer_mac, copy_type=None).
            recent = await print_queue.get_recent_job(
                order_id=order_id,
                template_id=template_id,
                printer_mac=printer_mac,
                copy_type=None,
            )
            if recent:
                _logger.info(
                    "Dedup hit: kitchen ticket %s/%s → existing job %s",
                    order_id, printer.name, recent["job_id"],
                )
                job_ids.append(recent["job_id"])
                continue

            # HARDWARE_ROUTING.md §3 — resolve printer_routing rules
            # for this printer. The dedup key above stays on the
            # originally-requested MAC so a redirected print and the
            # request-for-the-original-printer share a dedup row.
            rules = await _fetch_routing_rules(printer_mac)
            winning_rule = resolve_routing_rule(
                rules,
                category_id="",
                now=_store_now(),
            )
            dispatch_printer = printer
            station_categories: Optional[list] = None
            if winning_rule:
                redirect_mac = (winning_rule.get("redirect_to_mac") or "").strip()
                if redirect_mac:
                    target = _find_ready_printer_by_mac(manager, redirect_mac)
                    if target is not None:
                        dispatch_printer = target
                        _logger.info(
                            "Routing redirect: kitchen %s → %s (order %s)",
                            printer_mac, redirect_mac, order_id,
                        )
                    else:
                        _logger.warning(
                            "Routing redirect target %s not ready — "
                            "falling back to %s",
                            redirect_mac, printer_mac,
                        )
                rule_cat = (winning_rule.get("category_id") or "").strip()
                if rule_cat:
                    station_categories = [rule_cat]

            # Determine station name from the actual dispatch printer
            station_name = (
                getattr(dispatch_printer, 'location_tag', None)
                or dispatch_printer.name
                or "Kitchen"
            )

            # chars_per_line tracks the printer that will actually print
            chars_per_line = getattr(dispatch_printer, 'chars_per_line', 33)

            # Build context for this station — pass station_categories
            # from the winning rule if it carried a category filter.
            context = await builder.build_kitchen_context(
                order_id,
                station_name=station_name,
                station_categories=station_categories,
            )

            # Skip printers that would get zero items for this order
            if not context.get('items'):
                continue

            context['ticket_index'] = ticket_index
            context['ticket_total'] = len(printers)
            if void:
                context["is_void"] = True
                context["void_banner"] = "** VOID **"

            ticket_index += 1

            # Create template and formatter with actual printer specs
            template = KitchenTicketTemplate(chars_per_line=chars_per_line)
            formatter = ESCPOSFormatter(chars_per_line=chars_per_line)

            commands = template.render(context)
            raw_bytes = formatter.format(commands)

            # Reuse the queue's enqueue for the job_id + 'queued'/'sent'
            # dedup window. Status moves to 'completed' / 'failed' below
            # before the handler returns, so the dispatcher never picks
            # it up (and in PrinterManager mode the dispatcher isn't
            # running anyway).
            job_id = await print_queue.enqueue(
                order_id=order_id,
                template_id=template_id,
                printer_mac=printer_mac,
                ticket_number=context.get('ticket_number', 'N/A'),
                context=context,
                copy_type=None,
            )

            job = PrintJob(
                job_id=job_id,
                order_id=order_id,
                job_type=PrintJobType.KITCHEN_TICKET,
                order_context=OrderContext.DINE_IN,
                target_role="kitchen",
                target_printer_id=dispatch_printer.printer_id,
                content=PrintJobContent(body_lines=raw_bytes),
                server_name="",
                terminal_id="",
                priority=PrintJobPriority.NORMAL,
            )

            result = await dispatch_printer.print_job(job)
            if result.success:
                await print_queue.mark_completed(job_id)
                job_ids.append(job_id)
                _logger.info(f"Kitchen ticket printed on {dispatch_printer.name}")
            else:
                await print_queue.mark_failed(job_id)
                _logger.warning(f"Kitchen ticket print failed on {dispatch_printer.name}: {result.message}")
        except Exception as e:
            _logger.error(f"Error printing kitchen ticket on {printer.name}: {e}")

    if not job_ids:
        return {"status": "error", "detail": "Failed to print on any kitchen printer"}

    return {"status": "sent", "job_ids": job_ids, "printers": len(job_ids), "is_void": void}

@router.get("/queue")
async def get_queue():
    """Return all queued and failed print jobs."""
    pending = await print_queue.get_pending_jobs()
    failed = await print_queue.get_failed_jobs()
    return {"pending": pending, "failed": failed}

@router.post("/queue/{job_id}/retry", dependencies=[Depends(require_manager)])
async def retry_job(job_id: str):
    """Manually retry a failed job."""
    await print_queue.reset_for_retry(job_id)
    return {"status": "reset_for_retry", "job_id": job_id}

class ClockHoursRequest(BaseModel):
    employee_name: str
    role_name: str = ""
    action: str = "CLOCK IN"


@router.post("/clock-hours/{employee_id}", dependencies=[Depends(require_manager)])
async def print_clock_hours(
    employee_id: str,
    request: ClockHoursRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    """Print shift hours and pay-period summary on clock in/out."""
    builder = PrintContextBuilder(ledger)
    context = await builder.build_clock_hours_context(
        employee_id=employee_id,
        employee_name=request.employee_name,
        role_name=request.role_name,
        action=request.action,
    )
    # Suffix with a UTC timestamp so repeated clock in/out events within the
    # same day don't collide with a still-pending queue entry and get deduped.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    job_id = await print_queue.enqueue(
        order_id=f"clock-{employee_id}-{stamp}",
        template_id="clock_hours",
        printer_mac="DEFAULT_RECEIPT",
        ticket_number="CLK",
        context=context,
    )
    return {"status": "queued", "job_id": job_id}


class SalesRecapRequest(BaseModel):
    printed_by: str = "Manager"


@router.post("/sales-recap", dependencies=[Depends(require_manager)])
async def print_sales_recap(
    request: SalesRecapRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    """Print end-of-day sales recap report."""
    builder = PrintContextBuilder(ledger)
    context = await builder.build_sales_recap_context(printed_by=request.printed_by)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    job_id = await print_queue.enqueue(
        order_id=f"sales-recap-{stamp}",
        template_id="sales_recap",
        printer_mac="DEFAULT_RECEIPT",
        ticket_number="RPT",
        context=context,
    )
    return {"status": "queued", "job_id": job_id}


class ServerCheckoutPrintRequest(BaseModel):
    server_name: str = ""
    declared_cash_tips: Optional[float] = None


@router.post("/server-checkout/{server_id}", dependencies=[Depends(require_manager)])
async def print_server_checkout(
    server_id: str,
    request: ServerCheckoutPrintRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    """Print server checkout report."""
    builder = PrintContextBuilder(ledger)
    context = await builder.build_server_checkout_context(
        server_id=server_id,
        server_name=request.server_name,
        declared_cash_tips=request.declared_cash_tips,
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    job_id = await print_queue.enqueue(
        order_id=f"checkout-{server_id}-{stamp}",
        template_id="server_checkout",
        printer_mac="DEFAULT_RECEIPT",
        ticket_number="CHK",
        context=context,
    )
    return {"status": "queued", "job_id": job_id}


@router.post("/test", dependencies=[Depends(require_manager)])
async def print_test(template_name: str = Body(..., embed=True), printer_mac: str = Body(..., embed=True)):
    """Fire a fixture template to a printer (test panel)."""
    # Reject any separator or traversal sequence — fixture names are bare filenames.
    if not template_name or "/" in template_name or "\\" in template_name or ".." in template_name:
        await _record_diag(
            category=DiagnosticCategory.SEC,
            severity=DiagnosticSeverity.ERROR,
            source="printing.print_test",
            event_code="SEC-002",
            message="Path-traversal attempt blocked on /print/test",
            context={"template_name": template_name[:120]},
        )
        raise HTTPException(status_code=400, detail="Invalid template name")

    fixtures_dir = (Path(__file__).resolve().parents[2] / "printing" / "fixtures").resolve()
    fixture_path = (fixtures_dir / f"{template_name}.json").resolve()
    # Confirm the resolved path is still inside the fixtures directory.
    try:
        fixture_path.relative_to(fixtures_dir)
    except ValueError:
        await _record_diag(
            category=DiagnosticCategory.SEC,
            severity=DiagnosticSeverity.ERROR,
            source="printing.print_test",
            event_code="SEC-002",
            message="Path-traversal attempt blocked on /print/test (resolve escape)",
            context={"template_name": template_name[:120]},
        )
        raise HTTPException(status_code=400, detail="Invalid template name")
    if not fixture_path.exists():
        raise HTTPException(status_code=404, detail=f"Fixture {template_name} not found")

    with open(fixture_path, 'r') as f:
        context = json.load(f)
    
    job_id = await print_queue.enqueue(
        order_id=context.get('order_id', 'TEST'),
        template_id=template_name,
        printer_mac=printer_mac,
        ticket_number=context.get('ticket_number', 'TEST'),
        context=context
    )
    return {"status": "test_job_queued", "job_id": job_id}


@router.get("/failures/stream")
async def print_failure_stream():
    """SSE endpoint that pushes print failure events to the UI in real time.

    The frontend can subscribe with:
        const es = new EventSource('/api/v1/print/failures/stream');
        es.onmessage = (e) => showToast(JSON.parse(e.data).error);
    """
    dispatcher = get_print_dispatcher()
    if not dispatcher:
        raise HTTPException(status_code=503, detail="Print dispatcher not running")

    q = dispatcher.subscribe_failures()

    async def _generate():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            dispatcher.unsubscribe_failures(q)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
