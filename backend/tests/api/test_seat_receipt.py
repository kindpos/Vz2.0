"""
Per-seat receipt tests (PrintContextBuilder.build_receipt_context +
POST /api/v1/print/receipt/{order_id}?seats=).

A "seat receipt" is a pre-payment snapshot showing only the items on
specific seats with a subtotal, no tax/tip/payment lines, and a
seat-label header. The whole-order behavior must stay byte-identical
when seat_numbers is None / `seats=` is omitted.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

from app.api.routes import printing
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import item_added, order_created
from app.services.print_context_builder import PrintContextBuilder


TEST_DB = Path("./data/test_seat_receipt.db")
TERMINAL = "terminal_seat_receipt"


@pytest.fixture(autouse=True)
def _zero_config(monkeypatch):
    """Strip tax / cash discount so seat-subtotal math reads as integers."""
    monkeypatch.setattr(settings, "tax_rate", 0.0)
    monkeypatch.setattr(settings, "cash_discount_rate", 0.0)


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _seed_two_seat_order(ledger, order_id: str = "seat-ord-1") -> str:
    """Seed an order with three items across two seats — seat 1 carries
    two items ($5 + $7 = $12), seat 2 carries one item ($9). Returns
    the order_id."""
    await ledger.append(order_created(
        terminal_id=TERMINAL,
        order_id=order_id,
        order_type="dine_in",
        guest_count=2,
        server_id="emp_1",
        server_name="Server emp_1",
        correlation_id=order_id,
    ))
    seats_and_items = [
        (1, "Burger",  Decimal("5.00")),
        (1, "Fries",   Decimal("7.00")),
        (2, "Salad",   Decimal("9.00")),
    ]
    for idx, (seat, name, price) in enumerate(seats_and_items):
        await ledger.append(item_added(
            terminal_id=TERMINAL,
            order_id=order_id,
            item_id=f"{order_id}_it_{idx}",
            menu_item_id=f"m_{idx}",
            name=name,
            price=price,
            quantity=1,
            seat_number=seat,
        ))
    return order_id


# ─── PrintContextBuilder.build_receipt_context ────────────────────────────


async def test_seat_filter_returns_only_matching_items_and_subtotal(ledger):
    """seat_numbers=[1] → items list contains only seat-1 items, the
    subtotal sums their `subtotal` values, and the seat-receipt flags
    are stamped on the context."""
    order_id = await _seed_two_seat_order(ledger)
    builder = PrintContextBuilder(ledger)

    ctx = await builder.build_receipt_context(order_id, seat_numbers=[1])

    assert ctx["is_seat_receipt"] is True
    assert ctx["seat_label"] == "Seat 1"
    assert len(ctx["items"]) == 2
    assert {it["name"] for it in ctx["items"]} == {"Burger", "Fries"}
    assert ctx["subtotal"] == Decimal("12.00")
    assert ctx["total"] == Decimal("12.00")
    assert ctx["tax_lines"] == []
    assert ctx["tip_amount"] == Decimal("0.00")
    assert ctx["payment_method"] is None
    assert ctx["card_last_four"] is None


async def test_multi_seat_label_lists_sorted_numbers(ledger):
    """seat_numbers=[2, 1] (unsorted input) → 'Seats 1, 2'. Filtered
    items cover both seats."""
    order_id = await _seed_two_seat_order(ledger)
    builder = PrintContextBuilder(ledger)

    ctx = await builder.build_receipt_context(order_id, seat_numbers=[2, 1])

    assert ctx["seat_label"] == "Seats 1, 2"
    assert len(ctx["items"]) == 3
    # 5 + 7 + 9 = 21
    assert ctx["subtotal"] == Decimal("21.00")
    assert ctx["total"] == Decimal("21.00")


async def test_seat_numbers_none_preserves_whole_order_behavior(ledger):
    """seat_numbers=None (the default) → no is_seat_receipt flag, no
    seat_label, items list spans the whole order, totals come from the
    order-level projection (not a sum-of-items override)."""
    order_id = await _seed_two_seat_order(ledger)
    builder = PrintContextBuilder(ledger)

    ctx = await builder.build_receipt_context(order_id)

    assert "is_seat_receipt" not in ctx
    assert "seat_label" not in ctx
    assert len(ctx["items"]) == 3
    # Whole-order subtotal still comes from the projection — should match
    # the items' aggregate but via a different code path. Same total.
    assert ctx["subtotal"] == Decimal("21.00")


# ─── POST /print/receipt/{order_id}?seats= ────────────────────────────────


async def test_post_receipt_with_seats_query_param_passes_seat_numbers(
    ledger,
    monkeypatch: pytest.MonkeyPatch,
):
    """The route parses `seats=1,2` → [1, 2] and forwards it to the
    PrintContextBuilder via the seat_numbers kwarg. We don't need real
    printers — just verify the kwarg arrives at the builder."""
    order_id = await _seed_two_seat_order(ledger)

    captured: dict = {}

    async def _fake_build_receipt(self, _order_id, copy_type="customer", is_reprint=False, seat_numbers=None):
        captured["order_id"]     = _order_id
        captured["copy_type"]    = copy_type
        captured["seat_numbers"] = seat_numbers
        # Return enough shape that the route's downstream code is happy.
        return {
            "order_id": _order_id,
            "ticket_number": "T-001",
            "items": [],
            "is_seat_receipt": seat_numbers is not None,
        }

    monkeypatch.setattr(
        "app.services.print_context_builder.PrintContextBuilder.build_receipt_context",
        _fake_build_receipt,
    )

    # Force the route down the legacy fallback path (manager=None) — it
    # also calls build_receipt_context but doesn't try to actually print.
    monkeypatch.setattr(printing, "get_printer_manager", lambda: None)
    # Stub enqueue + the receipt-printer resolver so the legacy path
    # doesn't touch real hardware DB / print_queue state.
    monkeypatch.setattr(
        printing.print_queue, "enqueue", AsyncMock(return_value="job-x")
    )
    async def _resolver(_terminal_id):
        return "DEFAULT_RECEIPT"
    monkeypatch.setattr(printing, "_resolve_receipt_printer", _resolver)
    async def _no_itemized(*_a, **_kw):
        return False
    monkeypatch.setattr(printing, "_get_print_itemized", _no_itemized)

    # Build a minimal Starlette Request stand-in for direct call.
    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": f"/api/v1/print/receipt/{order_id}",
        "headers": [(b"x-terminal-id", b"T-01")],
    }
    req = Request(scope)

    resp = await printing.print_receipt(
        request=req,
        order_id=order_id,
        copy_type="customer",
        seats="1,2",
        ledger=ledger,
    )

    assert captured["seat_numbers"] == [1, 2]
    assert captured["order_id"] == order_id
    assert resp["status"] == "queued"


async def test_post_receipt_with_empty_seats_passes_none(
    ledger,
    monkeypatch: pytest.MonkeyPatch,
):
    """Empty `seats=` (or omitted) → seat_numbers=None to preserve the
    whole-order behavior."""
    order_id = await _seed_two_seat_order(ledger)

    captured: dict = {}

    async def _fake_build_receipt(self, _order_id, copy_type="customer", is_reprint=False, seat_numbers=None):
        captured["seat_numbers"] = seat_numbers
        return {"order_id": _order_id, "ticket_number": "T-001", "items": []}

    monkeypatch.setattr(
        "app.services.print_context_builder.PrintContextBuilder.build_receipt_context",
        _fake_build_receipt,
    )
    monkeypatch.setattr(printing, "get_printer_manager", lambda: None)
    monkeypatch.setattr(
        printing.print_queue, "enqueue", AsyncMock(return_value="job-x")
    )
    async def _resolver(_terminal_id):
        return "DEFAULT_RECEIPT"
    monkeypatch.setattr(printing, "_resolve_receipt_printer", _resolver)
    async def _no_itemized(*_a, **_kw):
        return False
    monkeypatch.setattr(printing, "_get_print_itemized", _no_itemized)

    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": f"/api/v1/print/receipt/{order_id}",
        "headers": [(b"x-terminal-id", b"T-01")],
    }
    req = Request(scope)

    await printing.print_receipt(
        request=req,
        order_id=order_id,
        copy_type="customer",
        seats="",
        ledger=ledger,
    )

    assert captured["seat_numbers"] is None
