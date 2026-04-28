"""
Extended PrintContextBuilder tests — gaps not covered by test_print_context_builder.py.

Covers: build_kitchen_context basic path, station_categories filtering,
reprint flag, not-found error, build_clock_hours_context happy path,
and build_clock_hours_context with no shifts.
"""

import os
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path

from app.core.event_ledger import EventLedger
from app.core.events import (
    order_created,
    item_added,
    user_logged_in,
    user_logged_out,
)
from app.services.print_context_builder import PrintContextBuilder

TEST_DB = Path("./data/test_pcb_extended.db")
TERMINAL = "terminal-pcb"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        os.remove(TEST_DB)
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        os.remove(TEST_DB)


@pytest_asyncio.fixture
def builder(ledger):
    return PrintContextBuilder(ledger)


async def _seed_order(
    ledger: EventLedger,
    oid: str,
    items: list[dict],
) -> None:
    """Emit ORDER_CREATED + ITEM_ADDED events for the given items."""
    await ledger.append(
        order_created(
            terminal_id=TERMINAL, order_id=oid,
            server_id="srv1", server_name="Alice",
        ).model_copy(update={"correlation_id": oid})
    )
    for i, it in enumerate(items):
        await ledger.append(item_added(
            terminal_id=TERMINAL, order_id=oid,
            item_id=f"{oid}_i{i}", menu_item_id=f"m{i}",
            name=it["name"], price=it.get("price", Decimal("10.00")), quantity=1,
            category=it.get("category"),
        ))


# ═══════════════════════════════════════════════════════════════════════
# 1. build_kitchen_context — basic structure
# ═══════════════════════════════════════════════════════════════════════

async def test_kitchen_context_basic(builder, ledger):
    oid = "kctx-basic-01"
    await _seed_order(ledger, oid, [
        {"name": "Burger", "price": Decimal("12.00"), "category": "Food"},
        {"name": "Soda",   "price": Decimal("3.00"),  "category": "Drinks"},
    ])

    ctx = await builder.build_kitchen_context(oid, station_name="Hot Line")

    assert ctx["order_id"] == oid
    assert ctx["station_name"] == "Hot Line"
    assert ctx["ticket_type"] == "ORIGINAL"
    assert len(ctx["items"]) == 2
    assert ctx["companion_items"] == []
    item_names = [it["name"] for it in ctx["items"]]
    assert "Burger" in item_names
    assert "Soda" in item_names


# ═══════════════════════════════════════════════════════════════════════
# 2. build_kitchen_context — station_categories splits items
# ═══════════════════════════════════════════════════════════════════════

async def test_kitchen_context_station_filter(builder, ledger):
    oid = "kctx-filter-01"
    await _seed_order(ledger, oid, [
        {"name": "Steak",  "price": Decimal("28.00"), "category": "Grill"},
        {"name": "Salad",  "price": Decimal("9.00"),  "category": "Cold"},
        {"name": "Beer",   "price": Decimal("6.00"),  "category": "Bar"},
    ])

    ctx = await builder.build_kitchen_context(
        oid, station_name="Grill", station_categories=["Grill"]
    )

    assert len(ctx["items"]) == 1
    assert ctx["items"][0]["name"] == "Steak"
    companion_names = [it["name"] for it in ctx["companion_items"]]
    assert "Salad" in companion_names
    assert "Beer" in companion_names


# ═══════════════════════════════════════════════════════════════════════
# 3. build_kitchen_context — is_reprint sets ticket_type to REPRINT
# ═══════════════════════════════════════════════════════════════════════

async def test_kitchen_context_reprint_flag(builder, ledger):
    oid = "kctx-reprint-01"
    await _seed_order(ledger, oid, [
        {"name": "Fries", "price": Decimal("4.00"), "category": "Food"},
    ])

    ctx = await builder.build_kitchen_context(oid, is_reprint=True)

    assert ctx["ticket_type"] == "REPRINT"


# ═══════════════════════════════════════════════════════════════════════
# 4. build_kitchen_context — unknown order raises ValueError
# ═══════════════════════════════════════════════════════════════════════

async def test_kitchen_context_unknown_order_raises(builder):
    with pytest.raises(ValueError, match="not found"):
        await builder.build_kitchen_context("nonexistent-order-id")


# ═══════════════════════════════════════════════════════════════════════
# 5. build_clock_hours_context — happy path: one completed shift
# ═══════════════════════════════════════════════════════════════════════

async def test_clock_hours_one_completed_shift(builder, ledger):
    now = datetime.now(timezone.utc)
    login_evt = user_logged_in(
        terminal_id=TERMINAL,
        employee_id="emp-clock1",
        employee_name="Eve",
    ).model_copy(update={"timestamp": now - timedelta(hours=2)})
    logout_evt = user_logged_out(
        terminal_id=TERMINAL,
        employee_id="emp-clock1",
        employee_name="Eve",
    ).model_copy(update={"timestamp": now - timedelta(hours=1)})

    await ledger.append(login_evt)
    await ledger.append(logout_evt)

    ctx = await builder.build_clock_hours_context(
        employee_id="emp-clock1",
        employee_name="Eve",
        action="CLOCK OUT",
    )

    assert ctx["employee_name"] == "Eve"
    assert ctx["action"] == "CLOCK OUT"
    assert ctx["clock_in"] is not None
    assert ctx["clock_out"] is not None
    assert "1h 0m" in ctx["shift_duration"]
    assert ctx["period_label"] != ""
    # At least one day in daily_hours has an entry for today
    today_entries = [d for d in ctx["daily_hours"] if d["hours"] != "--"]
    assert len(today_entries) >= 1


# ═══════════════════════════════════════════════════════════════════════
# 6. build_clock_hours_context — no shifts → clock_in is None
# ═══════════════════════════════════════════════════════════════════════

async def test_clock_hours_no_shifts(builder):
    ctx = await builder.build_clock_hours_context(
        employee_id="emp-noshift",
        employee_name="Frank",
        action="CLOCK IN",
    )

    assert ctx["clock_in"] is None
    assert ctx["clock_out"] is None
    assert ctx["shift_duration"] == ""
    # All daily_hours entries are blank
    for d in ctx["daily_hours"]:
        assert d["hours"] == "--"
