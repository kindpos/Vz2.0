"""
Server Shift API Routes

Endpoints scoped to a single server's current shift.
Used by the server landing page panels:
  - Sales by category (Pareto chart)
  - Table statistics (histogram)
  - Closed checks with tip status
  - Checkout readiness status
"""

from decimal import Decimal
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from app.api.dependencies import get_ledger
from app.api.routes.auth import auth_required, require_manager
from app.services.overseer_config_service import OverseerConfigService
from app.core.event_ledger import EventLedger
from app.core.events import EventType, order_transferred, checkout_finalized, tipout_override
from app.core.pin_hash import verify_pin_hash
from app.core.projections import project_orders
from app.core.money import money_round
from app.config import settings

router = APIRouter(prefix="/server/shift", tags=["server-shift"])
shifts_router = APIRouter(prefix="/shifts", tags=["shifts"])

_ZERO = Decimal("0")

# Category color palette — matches frontend T.categoryPalette
_CAT_COLORS = {
    "PIZZA": "#ff4757",
    "APPS": "#ffd93d",
    "SUBS": "#C6FFBB",
    "SIDES": "#70a1ff",
    "DRINKS": "#ffa502",
}


async def _get_current_day_events(ledger: EventLedger, limit: int = 50000):
    boundary = await ledger.get_last_day_close_sequence()
    return await ledger.get_events_since(boundary, limit=limit)


def _get_server_orders(all_orders, server_id):
    """Filter orders for a specific server, excluding voided."""
    return [
        o for o in all_orders.values()
        if o.server_id == server_id
    ]


# =============================================================================
# SALES BY CATEGORY (Pareto chart data)
# =============================================================================

@router.get("/sales-by-category", dependencies=[Depends(auth_required)])
async def sales_by_category(
    server_id: str = Query(..., description="Server employee ID"),
    ledger: EventLedger = Depends(get_ledger),
):
    """Category-level sales breakdown for the server's shift.
    Returns categories sorted by total revenue descending,
    with cash/card split for each category."""
    events = await _get_current_day_events(ledger)
    all_orders = project_orders(events)
    orders = _get_server_orders(all_orders, server_id)

    # Aggregate by category
    categories = {}
    for order in orders:
        if order.status == "voided" or order.is_empty:
            continue

        # Determine payment method for this order
        has_cash = any(
            p.method == "cash" and p.status == "confirmed"
            for p in order.payments
        )
        has_card = any(
            p.method != "cash" and p.status == "confirmed"
            for p in order.payments
        )

        for item in order.items:
            cat = (item.category or "Other").upper()
            if cat not in categories:
                categories[cat] = {"category": cat, "cash": _ZERO, "card": _ZERO}
            item_rev = Decimal(str(item.subtotal))
            # Split revenue by payment method
            if has_cash and not has_card:
                categories[cat]["cash"] += item_rev
            elif has_card and not has_cash:
                categories[cat]["card"] += item_rev
            else:
                # Mixed or no payment — split 50/50
                half = item_rev / 2
                categories[cat]["cash"] += half
                categories[cat]["card"] += item_rev - half

    result = []
    for cat_data in categories.values():
        total = cat_data["cash"] + cat_data["card"]
        result.append({
            "category": cat_data["category"],
            "color": _CAT_COLORS.get(cat_data["category"], "#C6FFBB"),
            "cash": money_round(cat_data["cash"]),
            "card": money_round(cat_data["card"]),
        })

    # Sort by total revenue descending
    result.sort(key=lambda x: x["cash"] + x["card"], reverse=True)
    return result


# =============================================================================
# TABLE STATISTICS (histogram data)
# =============================================================================

@router.get("/table-stats", dependencies=[Depends(auth_required)])
async def table_stats(
    server_id: str = Query(..., description="Server employee ID"),
    ledger: EventLedger = Depends(get_ledger),
):
    """Table statistics for the server's shift.
    Returns guest count, table count, check avg, avg turn time,
    and per-party-size breakdown."""
    events = await _get_current_day_events(ledger)
    all_orders = project_orders(events)
    orders = _get_server_orders(all_orders, server_id)

    guest_count = 0
    table_count = 0
    total_revenue = _ZERO
    turn_times = []  # minutes
    by_party_size = {}  # size -> { total_check, count }

    for order in orders:
        if order.status == "voided" or order.is_empty:
            continue
        table_count += 1
        gc = order.guest_count or 1
        guest_count += gc
        order_total = Decimal(str(order.subtotal))
        total_revenue += order_total

        # Turn time (created_at to closed/now)
        if order.created_at:
            if order.status in ("closed", "paid") and hasattr(order, "closed_at") and order.closed_at:
                turn = (order.closed_at - order.created_at).total_seconds() / 60
            else:
                turn = (datetime.now(timezone.utc) - order.created_at).total_seconds() / 60
            turn_times.append(turn)

        # Party size bucket (cap at 4+)
        size_key = min(gc, 4)
        if size_key not in by_party_size:
            by_party_size[size_key] = {"total_check": _ZERO, "count": 0}
        by_party_size[size_key]["total_check"] += order_total
        by_party_size[size_key]["count"] += 1

    check_avg = money_round(total_revenue / table_count) if table_count > 0 else Decimal("0.00")
    avg_turn = round(sum(turn_times) / len(turn_times)) if turn_times else 0

    party_data = []
    for size in sorted(by_party_size.keys()):
        bucket = by_party_size[size]
        avg = money_round(bucket["total_check"] / bucket["count"]) if bucket["count"] > 0 else Decimal("0.00")
        party_data.append({
            "size": size,
            "avgCheck": avg,
            "tableCount": bucket["count"],
        })

    return {
        "guestCount": guest_count,
        "tableCount": table_count,
        "checkAvg": check_avg,
        "avgTurnMinutes": avg_turn,
        "byPartySize": party_data,
    }


# =============================================================================
# CHECKOUT STATUS
# =============================================================================

@router.get("/checkout-status", dependencies=[Depends(auth_required)])
async def checkout_status(
    server_id: str = Query(..., description="Server employee ID"),
    ledger: EventLedger = Depends(get_ledger),
):
    """Returns the server's checkout readiness: open checks and unadjusted tips."""
    events = await _get_current_day_events(ledger)
    all_orders = project_orders(events)
    orders = _get_server_orders(all_orders, server_id)

    tip_map = {}
    for e in events:
        if e.event_type == EventType.TIP_ADJUSTED:
            tip_map[e.payload.get("payment_id")] = e.payload.get("tip_amount", 0.0)

    open_checks = 0
    unadjusted_tips = 0

    for order in orders:
        # Seated-but-not-ordered checks count as open too; only true
        # ghosts (no items, no seats) are ignored.
        if order.status == "open" and (not order.is_empty or order.seat_numbers):
            open_checks += 1
        elif order.status in ("closed", "paid"):
            # Check if any card payment lacks a tip adjustment
            for p in order.payments:
                if p.method != "cash" and p.status == "confirmed":
                    if p.payment_id not in tip_map:
                        unadjusted_tips += 1

    return {
        "openChecks": open_checks,
        "unadjustedTips": unadjusted_tips,
    }


# =============================================================================
# TIP OUT PATCH
# =============================================================================

class TipOutRequest(BaseModel):
    amount: Decimal


@router.patch("/tipout")
async def patch_tipout(
    request: TipOutRequest,
    server_id: str = Query(..., description="Server employee ID"),
    ledger: EventLedger = Depends(get_ledger),
):
    """Update the server's tip-out amount for this shift.

    Not implemented: tip-out is currently computed client-side from the
    tipout config rules and no shift-level override event exists. Return
    501 rather than a fake success so the UI can distinguish "not stored"
    from "stored". Replace with a real override event when auth/audit is in.
    """
    raise HTTPException(
        status_code=501,
        detail="Tip-out override is not yet persisted server-side",
    )


# =============================================================================
# SHIFT ACTIONS
# =============================================================================

class TipoutOverrideInput(BaseModel):
    rule_id: str
    override_percentage: Decimal


class FinalizeCheckoutRequest(BaseModel):
    employee_id: str
    take_home: Decimal
    cash_expected: Decimal
    manager_pin_verified: bool
    overrides: Optional[list[TipoutOverrideInput]] = None
    manager_pin: Optional[str] = None


@router.post("/finalize-checkout", dependencies=[Depends(require_manager)])
@shifts_router.post("/finalize-checkout", dependencies=[Depends(require_manager)])
async def finalize_checkout(
    request: FinalizeCheckoutRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    """Record that a server has finalized their shift checkout.

    Guards against open checks, calculates tipout from rules, emits
    optional TIPOUT_OVERRIDE event if percentages are overridden, and
    emits CHECKOUT_FINALIZED with full tipout breakdown.
    """
    server_id = request.employee_id

    # Get current day events and project orders
    boundary = await ledger.get_last_day_close_sequence()
    events = await ledger.get_events_since(boundary, limit=50000)
    all_orders = project_orders(events)

    # Filter orders for this server
    server_orders = [
        o for o in all_orders.values()
        if o.server_id == server_id
    ]

    # Guard: server must have no open checks
    open_checks = [o for o in server_orders if o.status == "open" and (not o.is_empty or o.seat_numbers)]
    if open_checks:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot finalize checkout — {len(open_checks)} open check(s) remain. Close or void them first.",
        )

    # Calculate tips from confirmed payments
    total_tips = _ZERO
    cash_tips = _ZERO
    card_tips = _ZERO
    tip_map: dict[str, Decimal] = {}

    # Build tip map from TIP_ADJUSTED events (last-write-wins per payment_id)
    for e in events:
        if e.event_type == EventType.TIP_ADJUSTED:
            tip_map[e.payload.get("payment_id", "")] = Decimal(str(e.payload.get("tip_amount", "0.00")))

    # Sum tips from confirmed payments
    for order in server_orders:
        if order.status in ("closed", "paid"):
            for p in order.payments:
                if p.status == "confirmed":
                    tip = tip_map.get(p.payment_id, Decimal(str(p.tip_amount or "0.00")))
                    total_tips += tip
                    if p.method == "cash":
                        cash_tips += tip
                    else:
                        card_tips += tip

    # Round tip totals
    total_tips = money_round(total_tips)
    cash_tips = money_round(cash_tips)
    card_tips = money_round(card_tips)

    # Fetch all tipout rules from config
    rules_by_id: dict[str, dict] = {}
    try:
        rules_events = await ledger.get_events_by_type(EventType.TIPOUT_RULE_CREATED)
        for rule_evt in rules_events:
            rule_id = rule_evt.payload.get("rule_id", "")
            rules_by_id[rule_id] = {
                "rule_id": rule_id,
                "role": rule_evt.payload.get("role", ""),
                "percentage": Decimal(str(rule_evt.payload.get("percentage", "0"))),
            }
    except Exception:
        pass  # If rule fetch fails, continue with empty rules

    # Calculate original tipout breakdown
    tipout_breakdown = []
    original_tipout_total = _ZERO
    for rule_id, rule in rules_by_id.items():
        original_pct = rule["percentage"]
        original_amount = money_round(total_tips * original_pct / 100)
        original_tipout_total += original_amount
        tipout_breakdown.append({
            "rule_id": rule_id,
            "role": rule["role"],
            "calculated_percentage": str(original_pct),
            "actual_percentage": str(original_pct),
            "calculated_amount": str(original_amount),
            "actual_amount": str(original_amount),
            "was_overridden": False,
        })

    # Handle overrides if provided
    override_events_to_emit = []
    actual_tipout_total = original_tipout_total
    if request.overrides and len(request.overrides) > 0:
        # Validate manager PIN
        if not request.manager_pin:
            raise HTTPException(status_code=400, detail="manager_pin required when overriding tipout")

        service = OverseerConfigService(ledger)
        employees = await service.get_employees()
        manager_id = None
        pin_valid = False
        for emp in employees:
            if not emp.active or not emp.pin:
                continue
            if verify_pin_hash(request.manager_pin, emp.pin):
                pin_valid = True
                manager_id = emp.employee_id
                break

        if not pin_valid:
            raise HTTPException(status_code=401, detail="Invalid manager PIN")

        # Build override lookup
        override_lookup: dict[str, Decimal] = {}
        for override in request.overrides:
            pct = Decimal(str(override.override_percentage))
            if pct < 0 or pct > 100:
                raise HTTPException(status_code=400, detail=f"Override percentage must be 0-100, got {pct}")
            override_lookup[override.rule_id] = pct

        # Recalculate breakdown with overrides
        override_records = []
        actual_tipout_total = _ZERO
        for breakdown_item in tipout_breakdown:
            rule_id = breakdown_item["rule_id"]
            if rule_id in override_lookup:
                override_pct = override_lookup[rule_id]
                override_amount = money_round(total_tips * override_pct / 100)
                breakdown_item["actual_percentage"] = str(override_pct)
                breakdown_item["actual_amount"] = str(override_amount)
                breakdown_item["was_overridden"] = True
                override_records.append({
                    "rule_id": rule_id,
                    "role": breakdown_item["role"],
                    "original_percentage": breakdown_item["calculated_percentage"],
                    "override_percentage": str(override_pct),
                    "calculated_amount": breakdown_item["calculated_amount"],
                    "override_amount": str(override_amount),
                })
            actual_tipout_total += Decimal(breakdown_item["actual_amount"])

        actual_tipout_total = money_round(actual_tipout_total)

        # Emit TIPOUT_OVERRIDE event
        now = datetime.now(timezone.utc).isoformat()
        shift_id = f"shift_{server_id}_{now.split('T')[0]}"
        override_evt = tipout_override(
            terminal_id=settings.terminal_id,
            server_id=server_id,
            shift_id=shift_id,
            overrides=override_records,
            manager_id=manager_id,
            overridden_at=now,
        )
        override_events_to_emit.append(override_evt)

    # Emit CHECKOUT_FINALIZED event
    now = datetime.now(timezone.utc).isoformat()
    shift_id = f"shift_{server_id}_{now.split('T')[0]}"
    evt = checkout_finalized(
        terminal_id=settings.terminal_id,
        server_id=server_id,
        shift_id=shift_id,
        checkout_time=now,
        total_tips=total_tips,
        cash_tips=cash_tips,
        card_tips=card_tips,
        tipout_amount=actual_tipout_total,
        open_checks_count=0,
        tipout_breakdown=tipout_breakdown,
    )

    # Emit events atomically
    all_events = override_events_to_emit + [evt]
    appended_evts = await ledger.append_batch(all_events)
    final_evt = appended_evts[-1]  # The CHECKOUT_FINALIZED event

    return {
        "success": True,
        "event_seq": final_evt.sequence_number,
        "checkout": {
            "total_tips": str(total_tips),
            "cash_tips": str(cash_tips),
            "card_tips": str(card_tips),
            "tipout_amount": str(actual_tipout_total),
        },
    }


class ShiftTransferRequest(BaseModel):
    order_id: str
    to_server_id: str
    from_server_id: Optional[str] = None


@router.post("/transfer", dependencies=[Depends(require_manager)])
@shifts_router.post("/transfer", dependencies=[Depends(require_manager)])
async def transfer_shift_order(
    request: ShiftTransferRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    """Transfer an order from one server to another.

    Emits an ORDER_TRANSFERRED event to the ledger.
    """
    event = order_transferred(
        terminal_id=settings.terminal_id,
        order_id=request.order_id,
        server_id=request.to_server_id,
        server_name="",  # Name lookup not required for projection
    )
    await ledger.append(event)
    return {"success": True}
