"""
Event Ledger Robustness Tests
================================
Covers the gaps left by test_event_ledger.py's single happy-path test:

  - Idempotency: duplicate idempotency key → second append returns None,
    no duplicate row in the database
  - append_batch atomicity: all events land or none do (partial-failure
    guard is structural — we verify count after a valid batch)
  - Hash-chain verification: verify_chain on a clean ledger returns valid;
    a manually corrupted checksum is detected
  - Day-boundary mechanics: get_last_day_close_sequence returns the correct
    sequence number after a DAY_CLOSED event; events before the boundary
    are excluded from get_events_since(boundary)
  - get_events_by_type filtering works across multiple event types
  - count_events reflects appended events accurately
"""

import pytest
import pytest_asyncio
from decimal import Decimal
from pathlib import Path

from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    order_created,
    item_added,
    payment_initiated,
    payment_confirmed,
    order_closed,
    day_closed,
    batch_submitted,
    create_event,
)
from app.core.money import money_round

TEST_DB = Path("./data/test_ledger_robust.db")
TERMINAL = "t_ledger_rb"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _l:
        yield _l
    if TEST_DB.exists():
        TEST_DB.unlink()


# ─── Helpers ────────────────────────────────────────────────────────────────

def _order_evt(order_id):
    evt = order_created(
        terminal_id=TERMINAL,
        order_id=order_id,
        table="T1",
        server_id="emp_01",
        server_name="Alice",
        order_type="dine_in",
        guest_count=2,
    )
    return evt.model_copy(update={"correlation_id": order_id})


def _item_evt(order_id, item_id, price=Decimal("10.00")):
    evt = item_added(
        terminal_id=TERMINAL,
        order_id=order_id,
        item_id=item_id,
        menu_item_id="menu_1",
        name="Dish",
        price=price,
        quantity=1,
        category="food",
    )
    return evt.model_copy(update={"correlation_id": order_id})


# ─── Idempotency ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_idempotency_duplicate_append_returns_none(ledger):
    """A second event with the same idempotency_key is blocked; append returns None."""
    # Two different Event objects, same business key
    evt1 = order_created(
        terminal_id=TERMINAL, order_id="ord_idem1",
        table="T1", server_id="emp", server_name="Alice",
        order_type="dine_in", guest_count=2,
        idempotency_key="idem_key_001",
    )
    evt2 = order_created(
        terminal_id=TERMINAL, order_id="ord_idem1b",
        table="T2", server_id="emp", server_name="Alice",
        order_type="dine_in", guest_count=1,
        idempotency_key="idem_key_001",  # same key
    )
    first = await ledger.append(evt1)
    assert first is not None

    second = await ledger.append(evt2)
    assert second is None  # blocked by idempotency gate


@pytest.mark.asyncio
async def test_idempotency_no_duplicate_row(ledger):
    """After a blocked duplicate, only one event with that key is in the store."""
    evt1 = order_created(
        terminal_id=TERMINAL, order_id="ord_idem2a",
        table="T1", server_id="emp", server_name="Alice",
        order_type="dine_in", guest_count=2,
        idempotency_key="idem_key_002",
    )
    evt2 = order_created(
        terminal_id=TERMINAL, order_id="ord_idem2b",
        table="T2", server_id="emp", server_name="Alice",
        order_type="dine_in", guest_count=1,
        idempotency_key="idem_key_002",
    )
    await ledger.append(evt1)
    await ledger.append(evt2)

    events = await ledger.get_events_by_type(EventType.ORDER_CREATED)
    assert len(events) == 1


@pytest.mark.asyncio
async def test_idempotency_lookup_by_key(ledger):
    """get_event_by_idempotency_key returns the stored event for that key."""
    evt = order_created(
        terminal_id=TERMINAL, order_id="ord_idem3",
        table="T1", server_id="emp", server_name="Alice",
        order_type="dine_in", guest_count=2,
        idempotency_key="idem_key_003",
    )
    original = await ledger.append(evt)

    fetched = await ledger.get_event_by_idempotency_key("idem_key_003")
    assert fetched is not None
    assert fetched.sequence_number == original.sequence_number
    assert fetched.event_type == EventType.ORDER_CREATED


# ─── append_batch ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_append_batch_all_events_inserted(ledger):
    """append_batch inserts every event in the list atomically."""
    events = [
        _order_evt("ord_batch1"),
        _item_evt("ord_batch1", "item_1"),
        _item_evt("ord_batch1", "item_2", price=Decimal("15.00")),
    ]
    results = await ledger.append_batch(events)

    assert len(results) == 3
    assert all(r is not None for r in results)
    assert await ledger.count_events() == 3


@pytest.mark.asyncio
async def test_append_batch_sequence_numbers_are_monotonic(ledger):
    """Events from append_batch have strictly increasing sequence numbers."""
    events = [_order_evt("ord_seq"), _item_evt("ord_seq", "i1")]
    results = await ledger.append_batch(events)

    seqs = [r.sequence_number for r in results]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == len(seqs)  # all unique


# ─── Hash chain verification ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_verify_chain_clean_ledger(ledger):
    """A freshly written ledger passes verify_chain."""
    for i in range(5):
        await ledger.append(_item_evt(f"ord_{i}", f"item_{i}"))

    valid, invalid_seq = await ledger.verify_chain()
    assert valid is True
    assert invalid_seq is None  # None means no invalid sequence found


@pytest.mark.asyncio
async def test_verify_chain_detects_corruption(ledger):
    """Manually overwriting a checksum causes verify_chain to report failure."""
    import aiosqlite

    await ledger.append(_order_evt("ord_corrupt"))
    await ledger.append(_item_evt("ord_corrupt", "item_c"))

    # Tamper with the second event's checksum directly in SQLite
    async with aiosqlite.connect(str(TEST_DB)) as db:
        await db.execute(
            "UPDATE events SET checksum = 'deadbeef' "
            "WHERE sequence_number = (SELECT MAX(sequence_number) FROM events)"
        )
        await db.commit()

    # Re-open so the in-memory cache is cold
    async with EventLedger(str(TEST_DB)) as fresh:
        valid, invalid_seq = await fresh.verify_chain()

    assert valid is False
    assert invalid_seq is not None  # corruption was detected at some sequence


# ─── Day-boundary mechanics ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_last_day_close_sequence_starts_at_zero(ledger):
    """Before any DAY_CLOSED event, boundary is 0."""
    boundary = await ledger.get_last_day_close_sequence()
    assert boundary == 0


@pytest.mark.asyncio
async def test_get_last_day_close_sequence_after_close(ledger):
    """After emitting DAY_CLOSED, boundary equals its sequence number."""
    # Put some events before the close
    await ledger.append(_order_evt("ord_pre"))
    await ledger.append(_item_evt("ord_pre", "item_pre"))

    submit_evt = batch_submitted(
        terminal_id=TERMINAL,
        order_count=0,
        total_amount=Decimal("0.00"),
        cash_total=Decimal("0.00"),
        card_total=Decimal("0.00"),
        order_ids=[],
    )
    close_evt = day_closed(
        terminal_id=TERMINAL,
        date="2026-01-01",
        total_orders=0,
        total_sales=Decimal("0.00"),
        total_tips=Decimal("0.00"),
        cash_total=Decimal("0.00"),
        card_total=Decimal("0.00"),
        order_ids=[],
        payment_count=0,
    )
    results = await ledger.append_batch([submit_evt, close_evt])
    close_seq = results[-1].sequence_number

    boundary = await ledger.get_last_day_close_sequence()
    assert boundary == close_seq


@pytest.mark.asyncio
async def test_get_events_since_boundary_excludes_pre_close(ledger):
    """get_events_since(boundary) returns only events AFTER the boundary."""
    # Day 1 events
    await ledger.append(_order_evt("ord_d1"))
    await ledger.append(_item_evt("ord_d1", "item_d1"))

    # Close day 1
    submit_evt = batch_submitted(
        terminal_id=TERMINAL,
        order_count=1,
        total_amount=Decimal("10.00"),
        cash_total=Decimal("10.00"),
        card_total=Decimal("0.00"),
        order_ids=["ord_d1"],
    )
    close_evt = day_closed(
        terminal_id=TERMINAL,
        date="2026-01-01",
        total_orders=1,
        total_sales=Decimal("10.00"),
        total_tips=Decimal("0.00"),
        cash_total=Decimal("10.00"),
        card_total=Decimal("0.00"),
        order_ids=["ord_d1"],
        payment_count=1,
    )
    results = await ledger.append_batch([submit_evt, close_evt])
    boundary = results[-1].sequence_number

    # Day 2 events
    await ledger.append(_order_evt("ord_d2"))
    await ledger.append(_item_evt("ord_d2", "item_d2"))

    since_boundary = await ledger.get_events_since(boundary)
    event_types = {e.event_type for e in since_boundary}

    # Day 2 ORDER_CREATED and ITEM_ADDED should appear
    assert EventType.ORDER_CREATED in event_types
    # Day 1's ORDER_CREATED must NOT appear (it's at seq < boundary)
    day2_order_events = [
        e for e in since_boundary if e.event_type == EventType.ORDER_CREATED
    ]
    assert all(e.payload.get("order_id") == "ord_d2" for e in day2_order_events)


# ─── get_events_by_type ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_events_by_type_filters_correctly(ledger):
    """get_events_by_type only returns events of the requested type."""
    await ledger.append(_order_evt("ord_type1"))
    await ledger.append(_item_evt("ord_type1", "item_t1"))
    await ledger.append(_order_evt("ord_type2"))

    order_events = await ledger.get_events_by_type(EventType.ORDER_CREATED)
    item_events = await ledger.get_events_by_type(EventType.ITEM_ADDED)

    assert len(order_events) == 2
    assert len(item_events) == 1
    assert all(e.event_type == EventType.ORDER_CREATED for e in order_events)
    assert all(e.event_type == EventType.ITEM_ADDED for e in item_events)


# ─── count_events ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_count_events_reflects_appends(ledger):
    """count_events returns the actual number of events in the store."""
    assert await ledger.count_events() == 0

    await ledger.append(_order_evt("ord_cnt"))
    assert await ledger.count_events() == 1

    await ledger.append(_item_evt("ord_cnt", "item_cnt1"))
    await ledger.append(_item_evt("ord_cnt", "item_cnt2"))
    assert await ledger.count_events() == 3
