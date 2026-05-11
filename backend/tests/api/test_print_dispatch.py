"""
Verify the PrinterManager dispatch path actually reaches
`printer.print_job(job)` with a **real** PrintJob instance.

The prior `test_print_dedup.py` had to stub `PrintJob.__init__` and
`ESCPOSFormatter.__init__` to bypass kwarg-mismatch errors that the
route's surrounding `try/except Exception` was silently swallowing.
That meant the dedup tests passed even though the production
dispatch path raised on the very first PrintJob construction and
never reached `printer.print_job`. After the fix, the real
constructors must work — these tests pin that.
"""

from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from starlette.requests import Request

from app.api.routes import printing
from app.core.adapters.base_printer import (
    OrderContext,
    PrintJob,
    PrintJobContent,
    PrintJobPriority,
    PrintJobType,
)
from app.printing.print_queue import PrintJobQueue


# ─── fixtures ────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def queue(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[PrintJobQueue]:
    """Module-level print_queue → temp DB so each test sees an empty queue."""
    q = PrintJobQueue(db_path=str(tmp_path / "test_print_queue.db"))
    await q.connect()
    monkeypatch.setattr(printing, "print_queue", q)
    yield q
    await q.close()


def _make_printer(name: str, mac: str, chars_per_line: int = 48):
    """Mock printer adapter with the attributes the route reads. Note we
    do NOT stub print_job's *input* — it must accept a real PrintJob."""
    p = MagicMock()
    p.name = name
    p.printer_id = mac
    p.chars_per_line = chars_per_line
    p.location_tag = None
    result = MagicMock()
    result.success = True
    result.message = "ok"
    p.print_job = AsyncMock(return_value=result)
    return p


@pytest.fixture
def patched_builders(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace builder methods so they don't need a seeded order. The
    ESCPOSFormatter and PrintJob constructors are intentionally NOT
    stubbed — the whole point of these tests is that the real ones
    accept what printing.py passes."""

    async def _fake_receipt(self, order_id, copy_type="customer", is_reprint=False, seat_numbers=None):
        return {
            "order_id": order_id,
            "ticket_number": "T-001",
            "items": [{"name": "x"}],
        }

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
def stub_templates(monkeypatch: pytest.MonkeyPatch) -> None:
    """The ESC/POS templates require richer contexts than these tests
    provide — short-circuit `render` to return an empty command list.
    `ESCPOSFormatter.format([])` runs unmodified against the real
    formatter, exercising the corrected constructor signature."""

    def _no_init(self, *args, **kwargs):
        pass

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


@pytest.fixture
def receipt_printer(monkeypatch: pytest.MonkeyPatch):
    printer = _make_printer("Front Register", "AA:BB:CC:DD:EE:01", chars_per_line=48)
    manager = MagicMock()
    manager.get_ready_printers_by_role = MagicMock(return_value=[printer])
    monkeypatch.setattr(printing, "get_printer_manager", lambda: manager)
    return printer


@pytest.fixture
def kitchen_printer(monkeypatch: pytest.MonkeyPatch):
    printer = _make_printer("Kitchen Main", "AA:BB:CC:DD:EE:02", chars_per_line=33)
    manager = MagicMock()
    manager.get_ready_printers_by_role = MagicMock(return_value=[printer])
    monkeypatch.setattr(printing, "get_printer_manager", lambda: manager)
    return printer


@pytest.fixture
def itemized_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _no(*_args, **_kwargs):
        return False

    monkeypatch.setattr(printing, "_get_print_itemized", _no)


def _request_with_terminal(terminal_id: str = "T-01") -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/print/receipt/xx",
        "headers": [(b"x-terminal-id", terminal_id.encode("ascii"))],
    }
    return Request(scope)


# ─── tests ───────────────────────────────────────────────────────────────


async def test_kitchen_dispatch_reaches_printer_with_real_print_job(
    queue: PrintJobQueue,
    kitchen_printer,
    patched_builders,
    stub_templates,
):
    """print_ticket constructs a real PrintJob with the right
    dataclass fields and hands it to printer.print_job. The handler
    returns status=sent (would be `error` if any of the constructors
    raised under the surrounding try/except)."""
    resp = await printing.print_ticket(order_id="ord-1", void=False, ledger=None)

    assert resp["status"] == "sent", resp
    assert kitchen_printer.print_job.await_count == 1

    job = kitchen_printer.print_job.await_args.args[0]
    assert isinstance(job, PrintJob), f"Expected PrintJob, got {type(job)!r}"
    assert job.target_printer_id == "AA:BB:CC:DD:EE:02"
    assert job.job_type == PrintJobType.KITCHEN_TICKET
    assert job.order_context == OrderContext.DINE_IN
    assert job.target_role == "kitchen"
    assert job.priority == PrintJobPriority.NORMAL
    assert isinstance(job.content, PrintJobContent)


async def test_receipt_dispatch_reaches_printer_with_real_print_job(
    queue: PrintJobQueue,
    receipt_printer,
    patched_builders,
    stub_templates,
    itemized_disabled,
):
    """Same end-to-end check for the receipt path."""
    resp = await printing.print_receipt(
        request=_request_with_terminal(),
        order_id="ord-1",
        copy_type="customer",
        ledger=None,
    )

    assert resp["status"] == "sent", resp
    assert receipt_printer.print_job.await_count == 1

    job = receipt_printer.print_job.await_args.args[0]
    assert isinstance(job, PrintJob)
    assert job.target_printer_id == "AA:BB:CC:DD:EE:01"
    assert job.job_type == PrintJobType.RECEIPT
    assert job.target_role == "receipt"
    assert job.terminal_id == "T-01"
    assert isinstance(job.content, PrintJobContent)


async def test_receipt_itemized_loop_also_dispatches_real_print_job(
    queue: PrintJobQueue,
    receipt_printer,
    patched_builders,
    stub_templates,
    monkeypatch: pytest.MonkeyPatch,
):
    """When `print_itemized_copy` is on, the secondary loop must also
    construct a real PrintJob (this loop's bug was identical to the
    primary's; this test guards against regression of just one half)."""

    async def _yes(*_args, **_kwargs):
        return True

    monkeypatch.setattr(printing, "_get_print_itemized", _yes)

    resp = await printing.print_receipt(
        request=_request_with_terminal(),
        order_id="ord-1",
        copy_type="customer",
        ledger=None,
    )

    assert resp["status"] == "sent", resp
    # Primary (customer) + itemized = two dispatches on the same mock printer.
    assert receipt_printer.print_job.await_count == 2

    # The second call is the itemized copy — verify it's a real PrintJob too.
    itemized_job = receipt_printer.print_job.await_args_list[1].args[0]
    assert isinstance(itemized_job, PrintJob)
    assert itemized_job.job_type == PrintJobType.RECEIPT
    assert itemized_job.target_printer_id == "AA:BB:CC:DD:EE:01"
    assert isinstance(itemized_job.content, PrintJobContent)
