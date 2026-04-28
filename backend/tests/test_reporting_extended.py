"""
Reporting route tests — get_sales_summary, get_labor_summary, hourly_compare.

Covers: empty-day aggregation, hourly bucketing, tips, clock-in/out hours,
server-view, hourly_compare shape, historical date query, SEC-005/006 gate,
and manager bypass of the security gate.
"""

import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path

from starlette.requests import Request

from app.api import dependencies as deps
from app.api.routes.reporting import get_sales_summary, get_labor_summary, hourly_compare
import app.api.routes.auth as auth_mod
from app.config import settings as app_settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    order_created, item_added, order_closed,
    payment_initiated, payment_confirmed,
    tip_adjusted,
    user_logged_in, user_logged_out,
)

# ── Own ledger fixture (separate DB from conftest printer fixture) ────────────

TEST_DB = Path("./data/test_reporting_extended.db")
TERMINAL = "terminal-reporting"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest.fixture(autouse=True)
def _zero_tax(monkeypatch):
    """Zero tax so order.total == subtotal, keeping financial invariants trivial."""
    monkeypatch.setattr(app_settings, "tax_rate", 0.0)


# ── Mock request helper ───────────────────────────────────────────────────────

def _mock_request(path: str = "/reports/sales-summary", auth_header: str | None = None) -> Request:
    """Minimal Starlette Request that satisfies _extract_session + _gate_server_scope."""
    headers = []
    if auth_header:
        headers.append((b"authorization", auth_header.encode()))
    return Request({
        "type": "http",
        "method": "GET",
        "path": path,
        "query_string": b"",
        "headers": headers,
        "server": ("testserver", 8000),
    })


# ── Seed helpers ──────────────────────────────────────────────────────────────

async def _seed_order(
    ledger: EventLedger,
    oid: str,
    amount: Decimal,
    server_id: str = "srv1",
    server_name: str = "S1",
) -> None:
    """Create, pay, and close a single-item order."""
    pid = f"pay_{oid}"
    await ledger.append(order_created(
        terminal_id=TERMINAL, order_id=oid,
        server_id=server_id, server_name=server_name,
    ).model_copy(update={"correlation_id": oid}))
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=oid,
        item_id=f"{oid}_i", menu_item_id="m1",
        name="Dish", price=amount, quantity=1,
    ))
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=oid,
        payment_id=pid, amount=amount, method="card",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=oid,
        payment_id=pid, transaction_id=f"txn_{pid}",
        amount=amount, tax=Decimal("0.00"),
    ))
    await ledger.append(order_closed(
        terminal_id=TERMINAL, order_id=oid, total=amount,
    ))


# ═══════════════════════════════════════════════════════════════════════
# 1. Empty-day sales summary — all numeric fields should be zero
# ═══════════════════════════════════════════════════════════════════════

async def test_empty_day_sales_summary(ledger):
    resp = await get_sales_summary(date=TODAY, server_id=None, ledger=ledger, request=None)

    assert resp["net_sales"] == Decimal("0.00")
    assert resp["total_checks"] == 0
    assert resp["gross_sales"] == Decimal("0.00")
    assert resp["tips_collected"] == Decimal("0.00")
    assert resp["hourly_sales"] == []


# ═══════════════════════════════════════════════════════════════════════
# 2. Single order — hourly aggregation totals match seeded amount
# ═══════════════════════════════════════════════════════════════════════

async def test_single_order_hourly_aggregation(ledger):
    amount = Decimal("25.00")
    await _seed_order(ledger, "hourly-01", amount)

    resp = await get_sales_summary(date=TODAY, server_id=None, ledger=ledger, request=None)

    # Sum all hourly buckets — total net must match the one order
    total_net = sum(h["net"] for h in resp["hourly_sales"])
    total_checks = sum(h["checks"] for h in resp["hourly_sales"])

    assert total_net == amount
    assert total_checks == 1
    assert resp["total_checks"] == 1
    assert resp["net_sales"] == amount


# ═══════════════════════════════════════════════════════════════════════
# 3. Sales summary captures tip adjustments in tips_collected
# ═══════════════════════════════════════════════════════════════════════

async def test_sales_summary_with_tips(ledger):
    oid = "tips-test-01"
    pid = f"pay_{oid}"
    await _seed_order(ledger, oid, Decimal("30.00"))

    # Adjust tip on the payment
    await ledger.append(tip_adjusted(
        terminal_id=TERMINAL, order_id=oid,
        payment_id=pid, tip_amount=Decimal("5.00"),
        previous_tip=Decimal("0.00"),
    ))

    resp = await get_sales_summary(date=TODAY, server_id=None, ledger=ledger, request=None)

    assert resp["tips_collected"] == Decimal("5.00")


# ═══════════════════════════════════════════════════════════════════════
# 4. Labor summary with no clock events — empty employees list
# ═══════════════════════════════════════════════════════════════════════

async def test_labor_summary_empty(ledger):
    resp = await get_labor_summary(date=TODAY, server_id=None, ledger=ledger, request=None)

    assert resp["employees"] == []
    assert resp["total_hours"] == Decimal("0.00")
    assert resp["total_labor"] == Decimal("0.00")


# ═══════════════════════════════════════════════════════════════════════
# 5. Labor summary manager view — computes hours from clock events
# ═══════════════════════════════════════════════════════════════════════

async def test_labor_summary_clock_events(ledger):
    login_evt = user_logged_in(
        terminal_id=TERMINAL,
        employee_id="emp_labor1",
        employee_name="Alice",
    ).model_copy(update={
        "timestamp": datetime.now(timezone.utc) - timedelta(minutes=90)
    })
    await ledger.append(login_evt)
    await ledger.append(user_logged_out(
        terminal_id=TERMINAL,
        employee_id="emp_labor1",
        employee_name="Alice",
    ))

    resp = await get_labor_summary(date=TODAY, server_id=None, ledger=ledger, request=None)

    emp = next((e for e in resp["employees"] if e["id"] == "emp_labor1"), None)
    assert emp is not None
    assert emp["name"] == "Alice"
    assert float(emp["hours"]) == pytest.approx(1.5, abs=0.1)
    assert emp["clock_in"] is not None
    assert emp["clock_out"] is not None


# ═══════════════════════════════════════════════════════════════════════
# 6. Labor summary server view — returns individual shift details
# ═══════════════════════════════════════════════════════════════════════

async def test_labor_summary_server_view(ledger):
    login_evt = user_logged_in(
        terminal_id=TERMINAL,
        employee_id="emp_srv1",
        employee_name="Bob",
    ).model_copy(update={
        "timestamp": datetime.now(timezone.utc) - timedelta(minutes=60)
    })
    await ledger.append(login_evt)
    await ledger.append(user_logged_out(
        terminal_id=TERMINAL,
        employee_id="emp_srv1",
        employee_name="Bob",
    ))

    resp = await get_labor_summary(
        date=TODAY, server_id="emp_srv1", ledger=ledger, request=None
    )

    assert float(resp["today_hours"]) == pytest.approx(1.0, abs=0.1)
    assert resp["clock_in"] is not None
    assert resp["clock_out"] is not None
    assert resp["ot_status"] == "ok"


# ═══════════════════════════════════════════════════════════════════════
# 7. hourly_compare — response shape has today/last_week with hour+net_sales
# ═══════════════════════════════════════════════════════════════════════

async def test_hourly_compare_shape(ledger):
    resp = await hourly_compare(date=TODAY, ledger=ledger)

    assert "today" in resp
    assert "last_week" in resp
    assert isinstance(resp["today"], list)
    assert isinstance(resp["last_week"], list)

    # Each entry must have hour label and net_sales
    for entry in resp["today"]:
        assert "hour" in entry
        assert "net_sales" in entry


# ═══════════════════════════════════════════════════════════════════════
# 8. SEC-005 emitted when server_id given with no auth session
# ═══════════════════════════════════════════════════════════════════════

async def test_sec005_unauthenticated_server_scope(ledger, collector):
    prior = deps._diagnostic_collector
    deps.set_diagnostic_collector(collector)
    try:
        auth_mod._sessions.clear()
        req = _mock_request(path="/reports/sales-summary")  # no auth header

        # auth_enforced=False (env default) so request succeeds despite no session
        resp = await get_sales_summary(
            date=TODAY, server_id="srv_x", ledger=ledger, request=req
        )
        assert "total_checks" in resp

        sec005_events = await collector.get_events(event_code="SEC-005")
        assert len(sec005_events) >= 1
    finally:
        deps._diagnostic_collector = prior


# ═══════════════════════════════════════════════════════════════════════
# 9. SEC-006 emitted on cross-server access (emp_A reading emp_B's data)
# ═══════════════════════════════════════════════════════════════════════

async def test_sec006_cross_server_access(ledger, collector):
    prior = deps._diagnostic_collector
    deps.set_diagnostic_collector(collector)
    try:
        auth_mod._sessions.clear()
        token = auth_mod._create_token("emp_A", "Alice", ["server"])
        req = _mock_request(
            path="/reports/sales-summary",
            auth_header=f"Bearer {token}",
        )

        resp = await get_sales_summary(
            date=TODAY, server_id="emp_B", ledger=ledger, request=req
        )
        # auth_enforced=False → still returns a response
        assert "total_checks" in resp

        sec006_events = await collector.get_events(event_code="SEC-006")
        assert len(sec006_events) >= 1
        assert sec006_events[-1].context.get("requested_server_id") == "emp_B"
        assert sec006_events[-1].context.get("session_employee_id") == "emp_A"
    finally:
        deps._diagnostic_collector = prior


# ═══════════════════════════════════════════════════════════════════════
# 10. Manager role bypasses the security gate — no SEC-006 emitted
# ═══════════════════════════════════════════════════════════════════════

async def test_manager_bypasses_gate(ledger, collector):
    prior = deps._diagnostic_collector
    deps.set_diagnostic_collector(collector)
    try:
        auth_mod._sessions.clear()
        token = auth_mod._create_token("emp_mgr", "Manager Bob", ["manager"])
        req = _mock_request(
            path="/reports/sales-summary",
            auth_header=f"Bearer {token}",
        )

        resp = await get_sales_summary(
            date=TODAY, server_id="some_other_emp", ledger=ledger, request=req
        )
        assert "total_checks" in resp

        sec006_events = await collector.get_events(event_code="SEC-006")
        assert len(sec006_events) == 0  # manager: silently allowed, no SEC-006
    finally:
        deps._diagnostic_collector = prior


# ═══════════════════════════════════════════════════════════════════════
# 11. Historical date query returns zero totals and does not raise
# ═══════════════════════════════════════════════════════════════════════

async def test_historical_date_query(ledger):
    last_week = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    resp = await get_sales_summary(
        date=last_week, server_id=None, ledger=ledger, request=None
    )

    assert resp["net_sales"] == Decimal("0.00")
    assert resp["total_checks"] == 0
    assert resp["date"] == last_week
