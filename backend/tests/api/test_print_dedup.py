"""
Dedup tests for the PrinterManager path in routes/printing.py.

The audit finding: two `POST /ticket/{order_id}` (or `/receipt/{order_id}`)
calls back-to-back used to push two `PrintJob`s onto the printer adapter
with separate `uuid4()` job_ids. The fix is a 60-second `get_recent_job`
lookup against `print_queue` keyed on
`(order_id, template_id, printer_mac, copy_type)`.

These tests pin that behavior:
- second identical call returns the same job_id and does NOT call
  `printer.print_job` a second time;
- different `order_id` → two separate dispatches;
- if the first job's row aged past the 60-second window, the next call
  dispatches afresh.

Pattern matches `tests/test_printing_routes.py`: route functions are
called directly (not over HTTP) with the heavy dependencies — printer
manager, context builder, queue — replaced by lightweight test doubles.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from starlette.requests import Request

from app.api.routes import printing
from app.printing.print_queue import PrintJobQueue


# ─── fixtures ────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def queue(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PrintJobQueue]:
    """Swap the module-level print_queue singleton for one bound to a
    temp DB so each test sees an empty queue."""
    q = PrintJobQueue(db_path=str(tmp_path / "test_print_queue.db"))
    await q.connect()
    monkeypatch.setattr(printing, "print_queue", q)
    yield q
    await q.close()


def _make_printer(name: str, mac: str):
    """Return a mock printer object with the attributes the route reads."""
    p = MagicMock()
    p.name = name
    p.printer_id = mac
    p.chars_per_line = 48
    p.supports_red = False
    p.location_tag = None
    result = MagicMock()
    result.success = True
    result.message = "ok"
    p.print_job = AsyncMock(return_value=result)
    return p


@pytest.fixture
def receipt_printer(monkeypatch: pytest.MonkeyPatch):
    """Stub get_printer_manager → manager with one ready receipt printer.
    The mock printer's print_job tracks call count so dedup is testable."""
    printer = _make_printer("Front Register", "AA:BB:CC:DD:EE:01")
    manager = MagicMock()
    manager.get_ready_printers_by_role = MagicMock(return_value=[printer])
    monkeypatch.setattr(printing, "get_printer_manager", lambda: manager)
    return printer


@pytest.fixture
def kitchen_printer(monkeypatch: pytest.MonkeyPatch):
    """Stub get_printer_manager → manager with one ready kitchen printer."""
    printer = _make_printer("Kitchen Main", "AA:BB:CC:DD:EE:02")
    printer.chars_per_line = 33
    manager = MagicMock()
    manager.get_ready_printers_by_role = MagicMock(return_value=[printer])
    monkeypatch.setattr(printing, "get_printer_manager", lambda: manager)
    return printer


@pytest.fixture
def patched_builders(monkeypatch: pytest.MonkeyPatch):
    """Replace PrintContextBuilder so its async build_* methods return
    minimal dicts instantly. Avoids needing a seeded order in the
    ledger for these dedup-focused tests."""

    async def _fake_receipt(self, order_id, copy_type="customer", is_reprint=False, seat_numbers=None):
        return {"order_id": order_id, "ticket_number": "T-001", "items": [{"name": "x"}]}

    async def _fake_kitchen(
        self,
        order_id,
        station_name="Kitchen",
        is_reprint=False,
        original_fired_at=None,
        station_categories=None,
    ):
        return {
            "order_id": order_id,
            "ticket_number": "T-001",
            "items": [{"name": "x"}],
        }

    monkeypatch.setattr(
        "app.services.print_context_builder.PrintContextBuilder.build_receipt_context",
        _fake_receipt,
    )
    monkeypatch.setattr(
        "app.services.print_context_builder.PrintContextBuilder.build_kitchen_context",
        _fake_kitchen,
    )


@pytest.fixture
def stub_render(monkeypatch: pytest.MonkeyPatch):
    """Bypass real ESC/POS rendering so the route reaches
    printer.print_job with the minimal canned contexts above.

    The real ESCPOSFormatter.__init__ does NOT accept the `supports_red`
    kwarg that printing.py currently passes — pre-existing route bug
    that's hidden by the surrounding try/except — so we neuter every
    constructor and render call on the path to printer.print_job."""

    def _no_init(self, *args, **kwargs):
        pass

    def _job_init(self, *args, **kwargs):
        # Mirror the few attributes the route reads back off the job
        # object (job_id) without enforcing the dataclass schema.
        for k, v in kwargs.items():
            object.__setattr__(self, k, v)

    monkeypatch.setattr(
        "app.api.routes.printing.PrintJob.__init__", _job_init
    )
    monkeypatch.setattr(
        "app.api.routes.printing.GuestReceiptTemplate.__init__", _no_init
    )
    monkeypatch.setattr(
        "app.api.routes.printing.GuestReceiptTemplate.render",
        lambda self, context: [],
    )
    monkeypatch.setattr(
        "app.api.routes.printing.KitchenTicketTemplate.__init__", _no_init
    )
    monkeypatch.setattr(
        "app.api.routes.printing.KitchenTicketTemplate.render",
        lambda self, context: [],
    )
    monkeypatch.setattr(
        "app.api.routes.printing.ESCPOSFormatter.__init__", _no_init
    )
    monkeypatch.setattr(
        "app.api.routes.printing.ESCPOSFormatter.format",
        lambda self, commands: b"",
    )


@pytest.fixture
def disable_itemized(monkeypatch: pytest.MonkeyPatch):
    """The receipt route may also print an itemized copy if the store
    setting is on. Force-off for these dedup tests so they only assert
    on the single primary print."""

    async def _no(*_args, **_kwargs):
        return False

    monkeypatch.setattr(printing, "_get_print_itemized", _no)


def _request_with_terminal(terminal_id: str = "T-01") -> Request:
    """Build a minimal Starlette Request carrying the X-Terminal-Id
    header the receipt route reads."""
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/print/receipt/xx",
        "headers": [(b"x-terminal-id", terminal_id.encode("ascii"))],
    }
    return Request(scope)


# ─── tests ───────────────────────────────────────────────────────────────


async def test_back_to_back_ticket_dedups_to_same_job_id(
    queue: PrintJobQueue,
    kitchen_printer,
    patched_builders,
    stub_render,
):
    """Two identical POST /ticket calls back-to-back → only one
    PrintJob is dispatched; the second call returns the same job_id."""
    resp1 = await printing.print_ticket(order_id="ord-1", void=False, ledger=None)
    resp2 = await printing.print_ticket(order_id="ord-1", void=False, ledger=None)

    assert resp1["status"] == "sent"
    assert resp2["status"] == "sent"
    assert resp1["job_ids"] == resp2["job_ids"]
    # First call dispatched once; second call short-circuited at the
    # dedup check and never reached printer.print_job.
    assert kitchen_printer.print_job.await_count == 1


async def test_back_to_back_receipt_dedups_to_same_job_id(
    queue: PrintJobQueue,
    receipt_printer,
    patched_builders,
    stub_render,
    disable_itemized,
):
    """Same dedup behavior on POST /receipt."""
    req = _request_with_terminal()
    resp1 = await printing.print_receipt(
        request=req, order_id="ord-1", copy_type="customer", ledger=None
    )
    resp2 = await printing.print_receipt(
        request=req, order_id="ord-1", copy_type="customer", ledger=None
    )

    assert resp1["status"] == "sent"
    assert resp2["status"] == "sent"
    assert resp1["job_ids"] == resp2["job_ids"]
    assert receipt_printer.print_job.await_count == 1


async def test_different_order_ids_dispatch_separately(
    queue: PrintJobQueue,
    kitchen_printer,
    patched_builders,
    stub_render,
):
    """Different order_id is a different dedup key → two distinct
    dispatches."""
    resp1 = await printing.print_ticket(order_id="ord-A", void=False, ledger=None)
    resp2 = await printing.print_ticket(order_id="ord-B", void=False, ledger=None)

    assert resp1["job_ids"] != resp2["job_ids"]
    assert kitchen_printer.print_job.await_count == 2


async def test_completed_job_outside_window_does_not_dedup(
    queue: PrintJobQueue,
    kitchen_printer,
    patched_builders,
    stub_render,
):
    """First job's created_at aged past the 60-second window → next
    call dispatches a fresh PrintJob. Reprints are allowed after the
    dedup window expires."""
    resp1 = await printing.print_ticket(order_id="ord-1", void=False, ledger=None)

    # Backdate the queue row to 90 s ago so `get_recent_job` (window=60s)
    # no longer matches it.
    old = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat()
    await queue._db.execute(
        "UPDATE print_queue SET created_at = ? WHERE job_id = ?",
        (old, resp1["job_ids"][0]),
    )
    await queue._db.commit()

    resp2 = await printing.print_ticket(order_id="ord-1", void=False, ledger=None)

    assert resp1["job_ids"] != resp2["job_ids"]
    assert kitchen_printer.print_job.await_count == 2
