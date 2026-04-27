"""
Reporting API Routes

Endpoints for sales and labor reporting summaries.
Supports both current-day and historical date queries via the event ledger.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from types import SimpleNamespace
from app.services.store_config_service import StoreConfigService
from app.services.overseer_config_service import OverseerConfigService

from app.api.dependencies import get_ledger
from app.api.routes.auth import _extract_session, _record_diag
from app.core.event_ledger import EventLedger
from app.core.events import EventType
from app.core.projections import project_orders
from app.core.money import money_round
from app.services.print_context_builder import PrintContextBuilder
from app.core.financial_invariants import (
    check_day_close,
    gate as invariant_gate,
    max_abs_diff,
)
from app.config import settings as app_settings
from app.models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity
import logging

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reporting"])


_MANAGER_ROLES = {"manager", "admin", "owner"}


async def _gate_server_scope(
    request: Request, server_id: Optional[str], source: str,
) -> None:
    """Block cross-server reporting reads.

    When a `server_id` query param is present and we can see a session,
    the requester must either match the server_id or hold a manager role.
    No session + auth_enforced=True → 401 (via SEC-005 recording). No
    session + auth_enforced=False → record SEC-005 and allow (transition
    mode). Same-server or manager → allow silently.
    """
    if not server_id:
        return
    session = _extract_session(request)
    if session is None:
        await _record_diag(
            category=DiagnosticCategory.SEC,
            severity=DiagnosticSeverity.WARNING,
            source=source,
            event_code="SEC-005",
            message="Reporting server_id read with no session",
            context={"path": request.url.path, "server_id": server_id},
        )
        if getattr(app_settings, "auth_enforced", True):
            raise HTTPException(status_code=401, detail="Authentication required")
        return
    if session.get("employee_id") == server_id:
        return
    if any(r in _MANAGER_ROLES for r in (session.get("roles") or [])):
        return
    # Session present but trying to read someone else's data without manager role.
    await _record_diag(
        category=DiagnosticCategory.SEC,
        severity=DiagnosticSeverity.ERROR,
        source=source,
        event_code="SEC-006",
        message="Cross-server reporting access blocked",
        context={
            "path": request.url.path,
            "requested_server_id": server_id,
            "session_employee_id": session.get("employee_id"),
            "session_roles": session.get("roles") or [],
        },
    )
    if getattr(app_settings, "auth_enforced", True):
        raise HTTPException(
            status_code=403,
            detail="Not permitted to access another server's data",
        )

_ZERO = Decimal("0")

# Revenue category map — items in these categories count as "Beverage"
_BEVERAGE_CATS = {"Drinks", "Soda", "Beverage"}


# ── helpers ─────────────────────────────────────────────────────────────────

_DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


async def _get_operating_hours(ledger: EventLedger, target_date: datetime) -> tuple:
    """Return (open_hour, close_hour) for the given date from store config."""
    service = StoreConfigService(ledger)
    config = await service.get_projected_config()
    op_hours = config.operating_hours or {}

    dow = target_date.weekday()  # 0=Monday
    day_name = _DAY_NAMES[dow]
    day_config = op_hours.get(day_name)

    open_hour = 11   # fallback
    close_hour = 22  # fallback

    if day_config and day_config.enabled:
        if day_config.open:
            open_hour = int(day_config.open.split(":")[0])
        if day_config.close:
            close_hour = int(day_config.close.split(":")[0])

    return open_hour, close_hour


async def _get_current_day_events(ledger: EventLedger, limit: int = 50000):
    """Get events since the last day close (current business day)."""
    boundary = await ledger.get_last_day_close_sequence()
    return await ledger.get_events_since(boundary, limit=limit)


async def _get_events_for_date(ledger: EventLedger, date_str: str, limit: int = 50000):
    """Get events for a specific date — uses date range query for historical,
    current-day query for today."""
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_local = datetime.now().strftime("%Y-%m-%d")
    if date_str in (today_utc, today_local):
        return await _get_current_day_events(ledger, limit=limit)
    # Historical: query by date range
    next_day = (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    return await ledger.get_events_by_date_range(date_str, next_day, limit=limit)


def _hour_label(h: int) -> str:
    """Convert 0-23 hour to '10:00' style label."""
    if h == 0:
        return "12:00"
    if h <= 12:
        return "%d:00" % h
    return "%d:00" % (h - 12)


def _aggregate_orders(orders, tip_map):
    """Compatibility wrapper for legacy tests. Routes use PrintContextBuilder directly."""
    builder = PrintContextBuilder(None)
    return builder.aggregate_orders(orders, tip_map)


def _build_top_items(item_revenue, limit=10):
    """Build top items list sorted by revenue descending."""
    sorted_items = sorted(item_revenue.items(), key=lambda x: x[1]["revenue"], reverse=True)
    return [
        {
            "name": name,
            "revenue": money_round(data["revenue"]),
            "category": data["category"],
            "count": data["count"],
        }
        for name, data in sorted_items[:limit]
    ]


def _build_tip_buckets(tip_amounts):
    """Build tip distribution histogram buckets."""
    ranges = [
        ("$0-3", 0, 3),
        ("$3-5", 3, 5),
        ("$5-8", 5, 8),
        ("$8-12", 8, 12),
        ("$12-15", 12, 15),
        ("$15-20", 15, 20),
        ("$20+", 20, 9999),
    ]
    buckets = []
    for label, lo, hi in ranges:
        count = sum(1 for t in tip_amounts if lo <= t < hi)
        buckets.append({"range": label, "count": count})
    return buckets


def _build_tip_map(events):
    """Compatibility wrapper for legacy tests."""
    builder = PrintContextBuilder(None)
    return builder.build_tip_map(events)


# ── sales-summary ──────────────────────────────────────────────────────────

@router.get("/sales-summary")
async def get_sales_summary(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    server_id: Optional[str] = Query(None, description="Employee ID for server-specific view"),
    ledger: EventLedger = Depends(get_ledger),
    request: Request = None,
):
    """
    Sales summary from real event ledger data.
    Manager view (no server_id) returns house-level stats.
    Server view (with server_id) returns individual stats with tip details.
    """
    if request is not None:
        await _gate_server_scope(request, server_id, "reporting.sales_summary")
    all_events = await _get_events_for_date(ledger, date)
    all_orders = project_orders(all_events)
    builder = PrintContextBuilder(ledger)
    tip_map = builder.build_tip_map(all_events)

    # Filter by server if requested
    orders = list(all_orders.values())
    if server_id:
        orders = [o for o in orders if o.server_id == server_id]

    agg = builder.aggregate_orders(orders, tip_map)
    net = agg["net_sales"]
    checks = agg["total_checks"]
    check_avg = money_round(net / checks) if checks > 0 else Decimal("0.00")

    # Build hourly_sales sorted by hour — include food/drink/other breakdown
    hourly_sales = []
    for h in sorted(agg["hourly"].keys()):
        bucket = agg["hourly"][h]
        hourly_sales.append({
            "hour": _hour_label(h),
            "net": money_round(bucket["net"]),
            "checks": bucket["checks"],
            "food": money_round(bucket["food"]),
            "drink": money_round(bucket["drink"]),
            "other": money_round(bucket.get("other", Decimal("0.00"))),
        })

    # ── Last week comparison ──────────────────────────────────────────────
    last_week_hourly = []
    try:
        lw_date = (datetime.strptime(date, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
        lw_events = await _get_events_for_date(ledger, lw_date)
        lw_orders = project_orders(lw_events)
        lw_tip_map = builder.build_tip_map(lw_events)
        lw_list = list(lw_orders.values())
        if server_id:
            lw_list = [o for o in lw_list if o.server_id == server_id]
        lw_agg = builder.aggregate_orders(lw_list, lw_tip_map)
        for h in sorted(lw_agg["hourly"].keys()):
            bucket = lw_agg["hourly"][h]
            last_week_hourly.append({
                "hour": _hour_label(h),
                "net": money_round(bucket["net"]),
                "checks": bucket["checks"],
            })
    except Exception:
        _log.exception("Failed to build last-week hourly comparison; section will be empty")

    # ── Top items ─────────────────────────────────────────────────────────
    top_items = _build_top_items(agg["item_revenue"])

    # ── Peak hours heatmap (past 7 days) ──────────────────────────────────
    peak_hours = []
    try:
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        target_date = datetime.strptime(date, "%Y-%m-%d")
        # Build grid for each of the last 7 days ending on target_date
        for i in range(6, -1, -1):
            d = target_date - timedelta(days=i)
            d_str = d.strftime("%Y-%m-%d")
            d_events = await _get_events_for_date(ledger, d_str)
            d_orders = project_orders(d_events)
            d_tip_map = _build_tip_map(d_events)
            d_list = list(d_orders.values())
            if server_id:
                d_list = [o for o in d_list if o.server_id == server_id]
            d_agg = _aggregate_orders(d_list, d_tip_map)
            hours_data = []
            for h in range(11, 23):  # 11am to 10pm
                bucket = d_agg["hourly"].get(h, {})
                hours_data.append({"hour": h, "value": bucket.get("checks", 0) if isinstance(bucket, dict) and "checks" in bucket else 0})
            peak_hours.append({
                "day": day_names[d.weekday()],
                "hours": hours_data,
            })
    except Exception:
        _log.exception("Failed to build peak-hours heatmap; section will be empty")

    # ── Tip buckets ───────────────────────────────────────────────────────
    tip_buckets = _build_tip_buckets(agg["tip_amounts"])
    tip_avg = money_round(sum(agg["tip_amounts"]) / len(agg["tip_amounts"])) if agg["tip_amounts"] else Decimal("0.00")

    tax_total_f = money_round(agg["tax_total"])
    tips_total_f = money_round(agg["total_tips"])

    # Category breakdown for the Sales by Category report.
    # Each entry carries its share of net_sales so the Overseer can
    # render rows + a live "% of net" without inventing rates.
    net_sales_f = money_round(net)
    category_breakdown = []
    for cname, cdata in agg["category_totals"].items():
        rev = money_round(cdata["revenue"])
        pct = round((rev / net_sales_f) * 100, 1) if net_sales_f > 0 else 0.0
        category_breakdown.append({
            "category": cname,
            "net_sales": rev,
            "items_sold": cdata["items_sold"],
            "pct": pct,
        })
    category_breakdown.sort(key=lambda c: c["net_sales"], reverse=True)

    # ── Home page derived fields ──────────────────────────────────────────
    # Oldest open check age in minutes (None if no open checks)
    oldest_open_minutes = None
    if agg.get("oldest_open_ts"):
        delta = datetime.now(timezone.utc) - agg["oldest_open_ts"]
        oldest_open_minutes = int(delta.total_seconds() / 60)

    # Top servers by net sales (top 5)
    top_servers = []
    for server_id_key, data in (agg.get("server_totals") or {}).items():
        top_servers.append({
            "server_id": server_id_key,
            "name": data["name"],
            "revenue": money_round(data["revenue"]),
            "checks": data["checks"],
            "tips": money_round(data["tips"]),
        })
    top_servers.sort(key=lambda s: s["revenue"], reverse=True)
    top_servers = top_servers[:5]

    base = {
        "date": date,
        "net_sales": money_round(net),
        "gross_sales": money_round(agg["gross_sales"]),
        "voids_total": money_round(agg["void_total"]),
        "discounts_total": money_round(agg["discount_total"]),
        "refunds_total": money_round(agg["refund_total"]),
        "tax_collected": tax_total_f,
        "tips_collected": tips_total_f,
        "total_guests": agg["guest_count"],
        "total_checks": checks,
        "check_avg": check_avg,
        "cash_total": money_round(agg["cash_total"]),
        "card_total": money_round(agg["card_total"]),
        "cash_count": agg["cash_count"],
        "card_count": agg["card_count"],
        "hourly_sales": hourly_sales,
        "last_week_hourly": last_week_hourly,
        "top_items": top_items,
        "peak_hours": peak_hours,
        "tip_buckets": tip_buckets,
        "tip_avg": tip_avg,
        "category_breakdown": category_breakdown,
        "daily_check_avg": [],
        # Home page additions:
        "open_checks": agg["open_count"],
        "open_total": money_round(agg.get("open_total", Decimal("0.00"))),
        "oldest_open_minutes": oldest_open_minutes,
        "top_servers": top_servers,
    }

    if server_id:
        # Server-specific fields
        tipout_rate = Decimal(str(app_settings.tipout_percent)) / 100
        tips = Decimal(str(agg["total_tips"]))
        cash_t = Decimal(str(agg["cash_tips"]))
        card_t = Decimal(str(agg["card_tips"]))
        tipout = money_round(tips * tipout_rate)
        take_home = money_round(tips - tipout)

        base["total_guests"] = agg["guest_count"]
        base["total_tables"] = agg["table_count"]
        base["guests_per_table"] = (
            round(agg["guest_count"] / agg["table_count"], 1)
            if agg["table_count"] > 0 else 0.0
        )
        base["tips_collected"] = money_round(tips)
        base["tipout_amount"] = tipout
        base["cash_tips"] = money_round(cash_t)
        base["take_home"] = take_home

        # Hourly tables
        hourly_tables = []
        for h in sorted(agg["hourly"].keys()):
            bucket = agg["hourly"][h]
            hourly_tables.append({
                "hour": _hour_label(h),
                "tables": len(bucket["tables"]),
            })
        base["hourly_tables"] = hourly_tables

    return base


# ── labor-summary ──────────────────────────────────────────────────────────

@router.get("/labor-summary")
async def get_labor_summary(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    server_id: Optional[str] = Query(None, description="Employee ID for server-specific view"),
    ledger: EventLedger = Depends(get_ledger),
    request: Request = None,
):
    """
    Labor summary from real event ledger data.
    Clock-in/out times come from USER_LOGGED_IN/OUT events.
    Manager view returns house-level labor stats.
    Server view returns individual employee details.
    """
    if request is not None:
        await _gate_server_scope(request, server_id, "reporting.labor_summary")

    # ── Timecard adjustments index ──────────────────────────────────────
    # Admin corrections live as TIMECARD_ADJUSTED events. They can be
    # written on any day (e.g. an admin fixing yesterday's timecard
    # today), so we fetch them by type and index by (target_date, eid).
    # Last-write-wins per (date, eid) via sequence-number ordering.
    #
    # Payload shape:
    #   { employee_id, employee_name?, date: "YYYY-MM-DD",
    #     clock_in?: "HH:MM", clock_out?: "HH:MM", reason? }
    # A missing clock_in/clock_out means "clear that side"; both missing
    # effectively deletes the clock record for that (date, eid).
    adj_events_all = await ledger.get_events_by_type(EventType.TIMECARD_ADJUSTED)
    adj_map: dict[tuple[str, str], dict] = {}
    for e in sorted(adj_events_all, key=lambda x: x.sequence_number or 0):
        d = (e.payload or {}).get("date")
        eid = (e.payload or {}).get("employee_id")
        if not d or not eid:
            continue
        adj_map[(d, eid)] = {
            "clock_in":  e.payload.get("clock_in"),
            "clock_out": e.payload.get("clock_out"),
            "name":      e.payload.get("employee_name"),
        }

    def _parse_hhmm(d_str: str, hhmm: str):
        try:
            dt = datetime.strptime(f"{d_str}T{hhmm}", "%Y-%m-%dT%H:%M")
            return dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return None

    def _apply_timecard_adjustments(d_str, ins, outs, names):
        """Mutate ins/outs/names to reflect TIMECARD_ADJUSTED for d_str."""
        for (target_date, eid), adj in adj_map.items():
            if target_date != d_str:
                continue
            if adj.get("name"):
                names.setdefault(eid, adj["name"])
            ci = adj.get("clock_in")
            co = adj.get("clock_out")
            # clock_in
            if ci:
                ts = _parse_hhmm(d_str, ci)
                if ts is not None:
                    ins[eid] = SimpleNamespace(
                        timestamp=ts,
                        event_type=EventType.USER_LOGGED_IN,
                        payload={"employee_id": eid, "employee_name": names.get(eid, "")},
                        sequence_number=None,
                    )
            else:
                ins.pop(eid, None)
            # clock_out
            if co:
                ts = _parse_hhmm(d_str, co)
                if ts is not None:
                    outs[eid] = SimpleNamespace(
                        timestamp=ts,
                        event_type=EventType.USER_LOGGED_OUT,
                        payload={"employee_id": eid, "employee_name": names.get(eid, "")},
                        sequence_number=None,
                    )
            else:
                outs.pop(eid, None)

    # ── Raw clock events for the requested date ─────────────────────────
    day_events = await _get_events_for_date(ledger, date)

    clock_ins = {}   # eid -> login event (possibly synthetic after adj)
    clock_outs = {}  # eid -> logout event (possibly synthetic after adj)
    emp_names = {}   # eid -> name

    for e in sorted(day_events, key=lambda x: x.sequence_number or 0):
        if e.event_type == EventType.USER_LOGGED_IN:
            eid = e.payload["employee_id"]
            clock_ins[eid] = e
            emp_names[eid] = e.payload["employee_name"]
        elif e.event_type == EventType.USER_LOGGED_OUT:
            eid = e.payload["employee_id"]
            clock_outs[eid] = e
            emp_names[eid] = e.payload.get("employee_name", emp_names.get(eid, "Unknown"))

    # Overlay admin adjustments for the requested date.
    _apply_timecard_adjustments(date, clock_ins, clock_outs, emp_names)

    # Also get order data for tip calculations
    builder = PrintContextBuilder(ledger)
    all_orders = project_orders(day_events)
    tip_map = builder.build_tip_map(day_events)

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    def _calc_hours(eid):
        """Calculate hours worked for an employee."""
        login_ev = clock_ins.get(eid)
        logout_ev = clock_outs.get(eid)
        if not login_ev:
            return Decimal("0.0")
        start = login_ev.timestamp
        if logout_ev and logout_ev.timestamp > start:
            end = logout_ev.timestamp
        elif date == today_str:
            end = now  # still on clock today
        else:
            # Historical day without clock-out: assume 8 hour shift
            end = start + timedelta(hours=8)
        delta = (end - start).total_seconds() / 3600.0
        return Decimal(str(round(delta, 1)))

    def _format_time(ev):
        if not ev:
            return None
        return ev.timestamp.strftime("%H:%M")

    def _is_clocked_in(eid):
        login_ev = clock_ins.get(eid)
        logout_ev = clock_outs.get(eid)
        if not login_ev:
            return False
        if logout_ev and logout_ev.timestamp > login_ev.timestamp:
            return False
        if date != today_str:
            return False  # historical days are always "clocked out"
        return True

    # ── Weekly hours: sum hours from past 7 days ──────────────────────────
    async def _clocks_for_date(d_str):
        """Build (ins, outs, names) for d_str, with admin adjustments applied."""
        if d_str == date:
            return clock_ins, clock_outs, emp_names
        d_events = await _get_events_for_date(ledger, d_str)
        ins, outs, names = {}, {}, {}
        for e in sorted(d_events, key=lambda x: x.sequence_number or 0):
            if e.event_type == EventType.USER_LOGGED_IN:
                eid = e.payload["employee_id"]
                ins[eid] = e
                names[eid] = e.payload.get("employee_name", names.get(eid, "Unknown"))
            elif e.event_type == EventType.USER_LOGGED_OUT:
                eid = e.payload["employee_id"]
                outs[eid] = e
                names[eid] = e.payload.get("employee_name", names.get(eid, "Unknown"))
        _apply_timecard_adjustments(d_str, ins, outs, names)
        return ins, outs, names

    async def _get_weekly_hours(eid):
        """Sum hours for an employee over the past 7 days."""
        total = Decimal("0.0")
        target = datetime.strptime(date, "%Y-%m-%d")
        for i in range(7):
            d = target - timedelta(days=i)
            d_str = d.strftime("%Y-%m-%d")
            if d_str == date:
                total += _calc_hours(eid)
                continue
            ins, outs, _names = await _clocks_for_date(d_str)
            d_login = ins.get(eid)
            d_logout = outs.get(eid)
            if d_login:
                start = d_login.timestamp
                end = d_logout.timestamp if (d_logout and d_logout.timestamp > start) else start + timedelta(hours=8)
                delta = (end - start).total_seconds() / 3600.0
                total += Decimal(str(round(delta, 1)))
        return total

    # ── Weekly breakdown (for server view) ────────────────────────────────
    async def _get_weekly_breakdown(eid):
        """Build daily hours breakdown for the past 7 days."""
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        breakdown = []
        target = datetime.strptime(date, "%Y-%m-%d")
        for i in range(6, -1, -1):
            d = target - timedelta(days=i)
            d_str = d.strftime("%Y-%m-%d")
            d_in = None
            d_out = None
            d_hours = Decimal("0.0")
            if d_str == date:
                login_ev = clock_ins.get(eid)
                logout_ev = clock_outs.get(eid)
                d_in = _format_time(login_ev)
                d_out = _format_time(logout_ev) if (logout_ev and login_ev and logout_ev.timestamp > login_ev.timestamp) else None
                d_hours = _calc_hours(eid)
            else:
                ins, outs, _names = await _clocks_for_date(d_str)
                login_ev = ins.get(eid)
                logout_ev = outs.get(eid)
                if login_ev:
                    d_in = login_ev.timestamp.strftime("%H:%M")
                    if logout_ev and logout_ev.timestamp > login_ev.timestamp:
                        d_out = logout_ev.timestamp.strftime("%H:%M")
                        delta = (logout_ev.timestamp - login_ev.timestamp).total_seconds() / 3600.0
                        d_hours = Decimal(str(round(delta, 1)))
                    else:
                        d_hours = Decimal("8.0")
            breakdown.append({
                "day": day_names[d.weekday()],
                "hours": d_hours,
                "in": d_in,
                "out": d_out,
            })
        return breakdown

    if server_id:
        hours = _calc_hours(server_id)
        weekly_hours = await _get_weekly_hours(server_id)
        weekly_breakdown = await _get_weekly_breakdown(server_id)
        login_ev = clock_ins.get(server_id)
        logout_ev = clock_outs.get(server_id)

        clock_in_time = _format_time(login_ev)
        clock_out_time = None
        if logout_ev and login_ev and logout_ev.timestamp > login_ev.timestamp:
            clock_out_time = _format_time(logout_ev)

        return {
            "date": date,
            "clock_in": clock_in_time,
            "clock_out": clock_out_time,
            "today_hours": hours,
            "weekly_hours": weekly_hours,
            "weekly_breakdown": weekly_breakdown,
            "ot_projected": weekly_hours,
            "ot_buffer": max(Decimal("0.00"), Decimal("40.0") - weekly_hours),
            "ot_status": "warning" if weekly_hours >= Decimal("35.0") else "ok",
        }

    # Manager view — aggregate all employees
    all_eids = set(list(clock_ins.keys()) + list(clock_outs.keys()))

    # Load configured hourly rates for wage calculations. Missing rates
    # resolve to 0 rather than a fabricated default so the Overseer's
    # Total Labor/Labor% KPIs reflect only employees with a rate on file.
    emp_rates: dict[str, Decimal] = {}
    try:
        cfg_service = OverseerConfigService(ledger)
        for emp in await cfg_service.get_employees():
            emp_rates[emp.employee_id] = Decimal(str(emp.hourly_rate or 0))
    except Exception:
        _log.exception("Failed to load employee hourly rates; labor costs will show as $0")

    # Compute per-server tips from orders
    server_tips = {}
    for order in all_orders.values():
        if order.status == "voided":
            continue
        sid = order.server_id
        if not sid:
            continue
        for p in order.payments:
            if p.status != "confirmed":
                continue
            tip = Decimal(str(tip_map.get(p.payment_id, p.tip_amount)))
            if sid not in server_tips:
                server_tips[sid] = _ZERO
            server_tips[sid] += tip

    total_hours = _ZERO
    card_tips_total = _ZERO
    employees = []

    for eid in all_eids:
        hours = _calc_hours(eid)
        tips = Decimal(str(server_tips.get(eid, 0)))
        weekly_hours = await _get_weekly_hours(eid)
        total_hours += Decimal(str(hours))
        card_tips_total += Decimal(str(tips))

        rate = emp_rates.get(eid, Decimal("0.00"))
        gross_pay = money_round(hours * rate)

        employees.append({
            "id": eid,
            "name": emp_names.get(eid, "Unknown"),
            "hours": hours,
            "clock_in": _format_time(clock_ins.get(eid)),
            "clock_out": _format_time(clock_outs.get(eid)) if not _is_clocked_in(eid) else None,
            "tips": money_round(tips),
            "weekly_hours": weekly_hours,
            "hourly_rate": rate,
            "gross_pay": gross_pay,
        })

    tipout_percent = Decimal(str(app_settings.tipout_percent))
    total_tips_all = sum(Decimal(str(emp.get("tips", 0))) for emp in employees)
    tipout_deducted = money_round(total_tips_all * tipout_percent / Decimal("100"))
    tip_pool = money_round(total_tips_all - tipout_deducted)

    # OT alerts: anyone at or over 35 weekly hours
    ot_alerts = []
    for emp in employees:
        if emp["weekly_hours"] >= Decimal("35.0"):
            ot_alerts.append({
                "id": emp["id"],
                "name": emp["name"],
                "weekly_hours": float(emp["weekly_hours"]),
                "projected": float(emp["weekly_hours"]),
                "status": "critical" if emp["weekly_hours"] > Decimal("40") else "warning",
            })

    # ── COB trend (past 7 days) ───────────────────────────────────────────
    # Labor cost uses the configured per-employee `hourly_rate` loaded
    # above (emp_rates). Employees without a configured rate contribute
    # 0 — the percentage is intentionally low rather than fabricated
    # from a flat $15/hr estimate.
    cob_trend = []
    try:
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        target = datetime.strptime(date, "%Y-%m-%d")
        for i in range(6, -1, -1):
            d = target - timedelta(days=i)
            d_str = d.strftime("%Y-%m-%d")
            # Get sales for the day
            d_events = await _get_events_for_date(ledger, d_str)
            d_orders = project_orders(d_events)
            d_tip_map = builder.build_tip_map(d_events)
            d_agg = builder.aggregate_orders(list(d_orders.values()), d_tip_map)
            d_sales = d_agg["net_sales"]

            # Get labor cost per employee using their configured rate,
            # after admin timecard adjustments are overlaid.
            d_labor_cost = Decimal("0.00")
            d_logins, d_logouts, _d_names = await _clocks_for_date(d_str)
            for eid, login_ev in d_logins.items():
                logout_ev = d_logouts.get(eid)
                start = login_ev.timestamp
                end = logout_ev.timestamp if (logout_ev and logout_ev.timestamp > start) else start + timedelta(hours=8)
                emp_hours = (end - start).total_seconds() / 3600.0
                d_labor_cost += Decimal(str(emp_hours)) * emp_rates.get(eid, Decimal("0.00"))

            cob_pct = round(float(d_labor_cost / d_sales) * 100, 1) if d_sales > 0 else 0.0
            cob_trend.append({
                "day": day_names[d.weekday()],
                "percent": cob_pct,
            })
    except Exception:
        _log.exception("Failed to build COB trend; section will be empty")

    # Surface net_sales so the Overseer's Labor % KPI has a denominator
    # without having to fetch sales-summary separately.
    today_agg = _aggregate_orders(list(all_orders.values()), tip_map)
    net_sales_today = money_round(today_agg["net_sales"])

    total_labor_cost = money_round(
        sum(Decimal(str(e["gross_pay"])) for e in employees)
    )

    return {
        "date": date,
        "net_sales": net_sales_today,
        "total_hours": money_round(total_hours),
        "total_labor": total_labor_cost,
        "tip_pool": tip_pool,
        "card_tips_total": money_round(card_tips_total),
        "tipout_percent": tipout_percent,
        "tipout_deducted": tipout_deducted,
        "cob_percent": float(cob_trend[-1]["percent"]) if cob_trend else 0.0,
        "employees": employees,
        "ot_alerts": ot_alerts,
        "cob_trend": cob_trend,
    }


# =============================================================================
# HOURLY SALES COMPARISON (today vs last week)
# =============================================================================

@router.get("/hourly-compare")
async def hourly_compare(
    date: Optional[str] = None,
    ledger: EventLedger = Depends(get_ledger),
):
    """Return hourly sales for a given date and the same weekday last week.

    Response: { today: [{ hour, net_sales }], last_week: [{ hour, net_sales }] }
    Hour range derived from store operating hours config.
    """
    if date:
        target = datetime.strptime(date, "%Y-%m-%d")
    else:
        target = datetime.now(timezone.utc)

    # Read operating hours from store config
    open_hour, close_hour = await _get_operating_hours(ledger, target)

    compare_date = target - timedelta(days=7)
    target_str = target.strftime("%Y-%m-%d")
    compare_str = compare_date.strftime("%Y-%m-%d")

    today_hourly = await _hourly_for_date(ledger, target_str, open_hour, close_hour)
    last_week_hourly = await _hourly_for_date(ledger, compare_str, open_hour, close_hour)

    return {
        "today": today_hourly,
        "last_week": last_week_hourly,
    }


async def _hourly_for_date(ledger: EventLedger, date_str: str, open_hour: int = 11, close_hour: int = 22):
    """Build hourly net sales array for a date within operating hours."""
    events = await _get_events_for_date(ledger, date_str)
    orders = project_orders(events)

    hourly = defaultdict(lambda: Decimal("0"))
    for order in orders.values():
        if order.status == "voided":
            continue
        ts = order.created_at
        if ts:
            h = ts.hour if hasattr(ts, 'hour') else 0
        else:
            h = 0
        # Match the hourly bucket math used by _aggregate_orders:
        # net per order is subtotal − discounts − refunds. Previously
        # this returned bare subtotal as "net_sales", inflating the
        # Manager Landing sparkline against the rest of the UI.
        net = (
            Decimal(str(order.subtotal or 0))
            - Decimal(str(order.refund_total or 0))
        )
        hourly[h] += net

    result = []
    for h in range(open_hour, close_hour + 1):
        ampm = 'p' if h >= 12 else 'a'
        label = str(h - 12 if h > 12 else (12 if h == 0 else h)) + ampm
        result.append({
            "hour": label,
            "net_sales": money_round(hourly[h]),
        })

    return result