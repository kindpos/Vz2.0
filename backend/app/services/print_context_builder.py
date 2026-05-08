import logging
import json
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List

from ..core.event_ledger import EventLedger
from ..core.projections import project_order, project_orders
from ..core.events import EventType
from decimal import Decimal
from ..core.money import money_round
from ..core.financial_invariants import (
    check_day_close,
    gate as invariant_gate,
    max_abs_diff,
)
from .store_config_service import StoreConfigService

_ZERO = Decimal('0')
_BEVERAGE_CATS = {"Drinks", "Soda", "Beverage"}
from ..config import settings

logger = logging.getLogger("kindpos.printing.context_builder")


# ── Ticket number helper ───────────────────────────────────────────────────────
async def _get_ticket_number(ledger: EventLedger, order_id: str) -> str:
    try:
        boundary    = await ledger.get_last_day_close_sequence()
        events      = await ledger.get_events_since(boundary, limit=50000)
        created_ids = [
            e.correlation_id for e in events
            if e.event_type == EventType.ORDER_CREATED
        ]
        try:
            position = created_ids.index(order_id) + 1
        except ValueError:
            position = len(created_ids) + 1
        return f"C-{position:03d}"
    except Exception as e:
        logger.warning(f"Could not derive ticket number for {order_id}: {e}")
        return "C-???"


class PrintContextBuilder:
    def aggregate_orders(self, orders, tip_map):
        """Shared aggregation logic for a set of orders."""
        net_sales = _ZERO
        gross_sales = _ZERO
        void_total = _ZERO
        discount_total = _ZERO
        refund_total = _ZERO
        tax_total = _ZERO
        cash_total = _ZERO
        card_total = _ZERO
        cash_count = 0
        card_count = 0
        total_tips = _ZERO
        card_tips = _ZERO
        cash_tips = _ZERO
        total_checks = 0
        voided_count = 0
        open_count = 0
        closed_count = 0
        discount_count = 0
        guest_count = 0
        table_set = set()
        hourly = {}          # hour -> {net, checks, tables, food, drink, other}
        item_revenue = {}    # item_name -> {revenue, category, count}
        category_totals = {} # category_name -> {revenue, items_sold}
        closed_order_ids = []
        tip_amounts = []     # list of individual tip values
        # Home page additions:
        open_total = _ZERO          # sum of subtotals for open orders
        oldest_open_ts = None       # earliest created_at among open orders
        server_totals = {}          # server_id -> {name, revenue, checks, tips}

        for order in orders:
            if order.status == "voided":
                # Include voided subtotals in gross so that the canonical
                # P&L identity holds: Net = Gross − Voids − Discounts − Refunds.
                voided_count += 1
                void_total += Decimal(str(order.gross_subtotal or 0))
                gross_sales += Decimal(str(order.gross_subtotal or 0))
                continue
            if order.status == "open":
                open_count += 1
                guest_count += (order.guest_count or 0)
                if order.table:
                    table_set.add(order.table)
                # Track open-check total and oldest timestamp for home dashboard
                open_total += Decimal(str(order.subtotal or 0))
                if order.created_at:
                    if oldest_open_ts is None or order.created_at < oldest_open_ts:
                        oldest_open_ts = order.created_at
                continue

            # closed/paid from here on
            closed_count += 1
            closed_order_ids.append(order.order_id)

            total_checks += 1
            gross_sales += Decimal(str(order.gross_subtotal or 0))
            order_discount = Decimal(str(order.discount_total or 0))
            if order_discount > 0:
                discount_count += 1
            discount_total += order_discount
            refund_total += Decimal(str(order.refund_total or 0))
            tax_total += Decimal(str(order.tax or 0))
            guest_count += (order.guest_count or 0)
            if order.table:
                table_set.add(order.table)

            order_net = Decimal(str(order.subtotal or 0)) - Decimal(str(order.refund_total or 0))

            # Per-server totals
            sid = getattr(order, "server_id", None)
            if sid:
                if sid not in server_totals:
                    server_totals[sid] = {
                        "name": getattr(order, "server_name", None) or sid,
                        "revenue": _ZERO,
                        "checks": 0,
                        "tips": _ZERO,
                    }
                server_totals[sid]["revenue"] += order_net
                server_totals[sid]["checks"] += 1

            # Per-item tracking
            food_total = _ZERO
            drink_total = _ZERO
            for item in (order.items or []):
                item_sub = Decimal(str(item.subtotal or 0))
                cat = getattr(item, "category", None) or ""
                if cat in _BEVERAGE_CATS:
                    drink_total += item_sub
                else:
                    food_total += item_sub

                key = item.name
                if key not in item_revenue:
                    item_revenue[key] = {"revenue": _ZERO, "category": cat, "count": 0}
                item_revenue[key]["revenue"] += item_sub
                item_revenue[key]["count"] += (item.quantity or 0)

                cat_key = cat or "Uncategorized"
                if cat_key not in category_totals:
                    category_totals[cat_key] = {"revenue": _ZERO, "items_sold": 0}
                category_totals[cat_key]["revenue"] += item_sub
                category_totals[cat_key]["items_sold"] += (item.quantity or 0)

            other_total = order_net - food_total - drink_total
            if other_total < 0:
                other_total = _ZERO

            # Hourly bucket
            if order.created_at:
                h = order.created_at.hour
                if h not in hourly:
                    hourly[h] = {"net": _ZERO, "checks": 0, "tables": set(),
                                 "food": _ZERO, "drink": _ZERO, "other": _ZERO}
                hourly[h]["net"] += order_net
                hourly[h]["checks"] += 1
                hourly[h]["food"] += food_total
                hourly[h]["drink"] += drink_total
                hourly[h]["other"] += other_total
                if order.table:
                    hourly[h]["tables"].add(order.table)

            # Payment breakdown
            for p in (order.payments or []):
                if p.status != "confirmed":
                    continue

                # Net out refunds for this specific payment
                p_refund = _ZERO
                for r in (order.refunds or []):
                    if r.get("payment_id") == p.payment_id:
                        p_refund += Decimal(str(r.get("amount", 0) or 0))

                tip = Decimal(str(tip_map.get(p.payment_id, getattr(p, "tip_amount", 0) or 0)))
                total_tips += tip
                tip_amounts.append(tip)
                if sid and sid in server_totals:
                    server_totals[sid]["tips"] += tip

                p_tender = Decimal(str(p.amount or 0)) - p_refund
                if p.method == "cash":
                    cash_total += p_tender
                    cash_tips += tip
                    cash_count += 1
                else:
                    card_total += p_tender
                    card_tips += tip
                    card_count += 1

        net_sales = gross_sales - void_total - discount_total - refund_total

        invariant_gate(
            check_day_close(
                gross_sales=gross_sales,
                void_total=void_total,
                discount_total=discount_total,
                refund_total=refund_total,
                net_sales=net_sales,
                tax_collected=tax_total,
                cash_total=cash_total,
                card_total=card_total,
                total_tips=total_tips,
                card_tips=card_tips,
                cash_tips=cash_tips,
            ),
            context="PrintContextBuilder.aggregate_orders",
        )

        return {
            "net_sales": net_sales,
            "gross_sales": gross_sales,
            "void_total": void_total,
            "discount_total": discount_total,
            "refund_total": refund_total,
            "tax_total": tax_total,
            "total_checks": total_checks,
            "voided_count": voided_count,
            "open_count": open_count,
            "closed_count": closed_count,
            "discount_count": discount_count,
            "closed_order_ids": closed_order_ids,
            "cash_total": cash_total,
            "card_total": card_total,
            "cash_count": cash_count,
            "card_count": card_count,
            "total_tips": total_tips,
            "card_tips": card_tips,
            "cash_tips": cash_tips,
            "guest_count": guest_count,
            "table_count": len(table_set),
            "hourly": hourly,
            "item_revenue": item_revenue,
            "category_totals": category_totals,
            "tip_amounts": tip_amounts,
            "open_total": open_total,
            "oldest_open_ts": oldest_open_ts,
            "server_totals": server_totals,
        }

    def build_tip_map(self, events):
        """Build tip map from events (last-write-wins per payment_id)."""
        tip_map = {}
        for e in events:
            if e.event_type == EventType.TIP_ADJUSTED:
                tip_map[e.payload.get("payment_id")] = Decimal(str(e.payload.get("tip_amount", "0.00")))
        return tip_map

    def __init__(self, ledger: EventLedger):
        self.ledger = ledger

    # ─────────────────────────────────────────────────────────────────────────
    #  GUEST RECEIPT
    # ─────────────────────────────────────────────────────────────────────────

    async def build_receipt_context(
        self,
        order_id: str,
        copy_type: str = "customer",
        is_reprint: bool = False,
    ) -> Dict[str, Any]:

        events = await self.ledger.get_events_by_correlation(order_id)
        if not events:
            raise ValueError(f"Order {order_id} not found in ledger")

        order         = project_order(events)
        ticket_number = await _get_ticket_number(self.ledger, order_id)

        # ── Timestamps ────────────────────────────────────────────────────────
        created_at = getattr(order, "created_at", None)
        opened_at  = created_at.isoformat() if created_at else None
        closed_at  = None
        for e in reversed(events):
            if e.event_type == EventType.ORDER_CLOSED:
                closed_at = e.timestamp.isoformat()
                break

        # ── Payment info ──────────────────────────────────────────────────────
        payment_method = "cash"
        card_last_four = None
        tip_amount     = Decimal("0.00")

        for p in (order.payments or []):
            if p.status == "confirmed":
                payment_method = p.method
                tip_amount    += getattr(p, "tip_amount", Decimal("0.00"))
                if p.method == "card" and p.transaction_id:
                    card_last_four = p.transaction_id[-4:]

        # ── Items ─────────────────────────────────────────────────────────────
        items = []
        for item in (order.items or []):
            mods = []
            for m in (item.modifiers or []):
                if isinstance(m, dict):
                    mods.append({
                        "name": m.get("name", ""),
                        "price": money_round(m.get("price", 0)),
                        "prefix": m.get("prefix"),
                        "half_price": m.get("half_price"),
                    })
                else:
                    mods.append(str(m))
            items.append({
                "qty":       item.quantity,
                "name":      item.name,
                "price":     money_round(item.price),
                "subtotal":  money_round(item.subtotal),
                "modifiers": mods,
                "notes":     getattr(item, "notes", None),
                "seat":      getattr(item, "seat_number", None),
            })

        # ── Tax lines — template iterates a list ──────────────────────────────
        tax_lines = [{"label": "Tax", "amount": money_round(order.tax or 0)}]

        # ── Store config — receipt settings from ledger projection ────────────
        store_cfg = await StoreConfigService(self.ledger).get_projected_config()
        rs = store_cfg.receipt_settings
        venue = {
            "name":                    store_cfg.info.restaurant_name,
            "address":                 store_cfg.info.address_line_1,
            "phone":                   store_cfg.info.phone,
            "footer_message":          store_cfg.receipt_footer or "Thank you! Please come again.",
            "tip_suggestion_percentages": rs.get("tip_suggestions", [15, 18, 20]),
            "tip_calculation_base":    rs.get("tip_calc_base", "pretax"),
        }

        return {
            "order_id":                   order_id,
            "ticket_number":              ticket_number,
            "copy_type":                  copy_type,
            "is_reprint":                 is_reprint,
            "opened_at":                  opened_at,
            "closed_at":                  closed_at,
            "table":                      getattr(order, "table", None),
            "server_name":                getattr(order, "server_name", None),
            "customer_name":              getattr(order, "customer_name", None),
            "items":                      items,
            "subtotal":                   money_round(order.subtotal or 0),
            "discount_total":             money_round(order.discount_total or 0),
            "tax_lines":                  tax_lines,
            "total":                      money_round(order.total or 0),
            "tip_amount":                 tip_amount,
            "payment_method":             payment_method,
            "card_last_four":             card_last_four,
            "venue":                      venue,
            "tip_suggestion_percentages": venue["tip_suggestion_percentages"],
            "tip_calculation_base":       venue["tip_calculation_base"],
            "restaurant_name":            venue["name"],
            "address":                    venue["address"],
            "phone":                      venue["phone"],
            "footer_message":             venue["footer_message"],
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  KITCHEN TICKET
    # ─────────────────────────────────────────────────────────────────────────

    async def build_kitchen_context(
        self,
        order_id: str,
        station_name: str = "General",
        is_reprint: bool = False,
        original_fired_at: Optional[str] = None,
        station_categories: Optional[list[str]] = None,
    ) -> Dict[str, Any]:

        events = await self.ledger.get_events_by_correlation(order_id)
        if not events:
            raise ValueError(f"Order {order_id} not found in ledger")

        order         = project_order(events)
        ticket_number = await _get_ticket_number(self.ledger, order_id)
        fired_at      = datetime.now(timezone.utc).strftime("%I:%M %p")

        # ── Items ─────────────────────────────────────────────────────────────
        all_items = []
        seats = set()
        for item in (order.items or []):
            seat = getattr(item, "seat_number", None)
            if seat:
                seats.add(seat)
            mods = []
            for m in (item.modifiers or []):
                mods.append(m if isinstance(m, dict) else str(m))
            notes = getattr(item, "notes", None)
            all_items.append({
                "qty":                  item.quantity,
                "name":                 item.name,
                "kitchen_text":         item.name,
                "modifiers":            mods,
                "special_instructions": notes or "",
                "allergy":              "",
                "category":             getattr(item, "category", None),
                "seat":                 seat,
            })

        # ── Station filtering ─────────────────────────────────────────────────
        # When station_categories is provided, split items into this station's
        # items vs companion items (going to other stations).
        if station_categories is not None:
            cat_set = set(station_categories)
            items = [it for it in all_items if it.get("category") in cat_set]
            companion_items = [it for it in all_items if it.get("category") not in cat_set]
        else:
            items = all_items
            companion_items = []

        # ── Station-override modifier routing ──────────────────────────────────
        # Handle modifier-level routing: modifiers with station_override can be
        # dispatched to different stations than their parent item.
        current_station_lower = station_name.lower() if station_name else ""

        if current_station_lower:
            # Mark modifiers that are dispatched away from this station
            for item in items:
                for mod in item.get("modifiers", []):
                    if isinstance(mod, dict):
                        mod_station_override = mod.get("station_override")
                        if mod_station_override:
                            mod_station_lower = mod_station_override.lower()
                            if mod_station_lower != current_station_lower:
                                mod["dispatched"] = True

            # Create synthetic items for modifiers arriving at this station
            dispatched_to_here = []
            for item in all_items:
                for mod in item.get("modifiers", []):
                    if isinstance(mod, dict):
                        mod_station_override = mod.get("station_override")
                        if mod_station_override:
                            mod_station_lower = mod_station_override.lower()
                            if mod_station_lower == current_station_lower:
                                # Create synthetic item for this dispatched modifier
                                synthetic = {
                                    "name": mod.get("name") or mod.get("text", ""),
                                    "kitchen_text": mod.get("name") or mod.get("text", ""),
                                    "parent_item_name": item.get("name") or item.get("kitchen_text", ""),
                                    "seat": item.get("seat"),
                                    "qty": 1,
                                    "modifiers": [],
                                    "station_override": mod_station_override,
                                    "special_instructions": None,
                                    "allergy": None,
                                }
                                dispatched_to_here.append(synthetic)

            # Prepend dispatched items to the front of this station's items
            items = dispatched_to_here + items

        return {
            "order_id":           order_id,
            "ticket_number":      ticket_number,
            "check_number":       ticket_number,
            "ticket_type":        "REPRINT" if is_reprint else "ORIGINAL",
            "ticket_index":       1,
            "ticket_total":       1,
            "table":              getattr(order, "table", None),
            "customer_name":      getattr(order, "customer_name", None),
            "server":             getattr(order, "server_name", None),
            "server_name":        getattr(order, "server_name", None),
            "seats":              sorted(seats) if seats else None,
            "fired_at":           fired_at,
            "original_fired_at":  original_fired_at,
            "items":              items,
            "companion_items":    companion_items,
            "station_name":       station_name,
            "terminal_id":        settings.terminal_id,
            "supports_red":       False,
            "rush":               False,
            "vip":                False,
            "warnings_86":        [],
        }

    async def build_server_checkout_context(
            self,
            server_id: str,
            server_name: str = None,
            *,
            declared_cash_tips: Decimal = None,
            tip_out_overrides: dict = None,
            is_reprint: bool = False,
    ) -> Dict[str, Any]:
        """
        Build context for ServerCheckoutTemplate.

        Aggregates all orders closed by this server since the last DAY_CLOSED
        boundary event. Designed to be called at end-of-shift cashout.
        """
        # v2 resolution: if server_name is missing, we resolve it and return the specific v2 keys.
        is_v2 = (server_name is None)
        if is_v2:
            cursor = await self.ledger._db.execute(
                "SELECT json_extract(payload, '$.employee_name') FROM events "
                "WHERE event_type = 'user.logged_in' AND json_extract(payload, '$.employee_id') = ? "
                "ORDER BY sequence_number DESC LIMIT 1",
                (server_id,)
            )
            row = await cursor.fetchone()
            server_name = row[0] if row else server_id

        boundary = await self.ledger.get_last_day_close_sequence()
        all_events = await self.ledger.get_events_since(boundary, limit=50000)
        all_orders = project_orders(all_events)
        tip_map = self.build_tip_map(all_events)

        # Filter to this server's orders
        server_orders = [
            o for o in all_orders.values()
            if o.server_id == server_id
        ]

        agg = self.aggregate_orders(server_orders, tip_map)

        # CC Transactions detail for the receipt
        cc_transactions = []
        open_tip_count = 0
        for order in [o for o in server_orders if o.status == "closed"]:
            for p in (order.payments or []):
                if p.status == "confirmed" and p.method == "card":
                    amount = Decimal(str(p.amount or 0))
                    # Net out refunds per payment
                    for refund in (order.refunds or []):
                        if refund.get("payment_id") == p.payment_id:
                            amount -= Decimal(str(refund.get("amount", 0) or 0))

                    tip = money_round(tip_map.get(p.payment_id, getattr(p, "tip_amount", 0) or 0))
                    ticket_num = await _get_ticket_number(self.ledger, order.order_id)
                    tip_open = (tip == Decimal("0.00")) # Simple heuristic for "tip open"
                    if tip_open:
                        open_tip_count += 1

                    cc_transactions.append({
                        "check_number": ticket_num,
                        "card_last_four": (p.transaction_id[-4:] if p.transaction_id else "****"),
                        "total": money_round(amount),
                        "tip": tip,
                        "tip_open": tip_open,
                    })

        net_sales = agg["net_sales"]
        gross_sales = agg["gross_sales"]
        voids_total = agg["void_total"]
        discounts_total = agg["discount_total"]
        refunds_total = agg["refund_total"]
        tax_collected = agg["tax_total"]
        cash_sales = agg["cash_total"]
        card_sales = agg["card_total"]
        total_tips = agg["total_tips"]
        cc_tips_total = agg["card_tips"]
        gross_tips = cc_tips_total + (Decimal(str(declared_cash_tips)) if declared_cash_tips is not None else _ZERO)

        # ── Clock in/out ───────────────────
        clock_in = None
        clock_out = None
        for e in all_events:
            payload = e.payload or {}
            eid = payload.get("employee_id") or payload.get("server_id")
            if eid != server_id:
                continue
            if e.event_type == EventType.USER_LOGGED_IN and clock_in is None:
                clock_in = e.timestamp.isoformat() if e.timestamp else None
            elif e.event_type == EventType.USER_LOGGED_OUT:
                clock_out = e.timestamp.isoformat() if e.timestamp else None

        shift_duration = ""
        if clock_in and clock_out:
            try:
                dt_in = datetime.fromisoformat(clock_in.replace("Z", "+00:00"))
                dt_out = datetime.fromisoformat(clock_out.replace("Z", "+00:00"))
                delta = dt_out - dt_in
                hours, remainder = divmod(int(delta.total_seconds()), 3600)
                minutes = remainder // 60
                shift_duration = f"{hours}h {minutes}m"
            except Exception as _e:
                logger.warning("Could not calculate shift duration for %s: %s", server_id, _e)

        # ── Tip-out calculation ───────────────────────────────────────────────
        tip_out_presets = getattr(settings, "tip_out_presets", [])
        tip_outs = []
        total_tip_out = _ZERO

        for preset in tip_out_presets:
            role = preset.get("role", "")
            pct = Decimal(str(preset.get("percentage", "0.00")))
            basis = preset.get("basis", "net_sales")

            if basis == "net_sales":
                base_amount = net_sales
            elif basis in ("alcohol", "alcohol_sales"):
                # Use drink revenue from aggregation
                base_amount = agg["category_totals"].get("Drink", {}).get("revenue", _ZERO) + \
                              agg["category_totals"].get("Beverage", {}).get("revenue", _ZERO) + \
                              agg["category_totals"].get("Soda", {}).get("revenue", _ZERO)
            elif basis in ("food", "food_sales"):
                # Gross food sales
                base_amount = agg["gross_sales"] - (
                    agg["category_totals"].get("Drink", {}).get("revenue", _ZERO) +
                    agg["category_totals"].get("Beverage", {}).get("revenue", _ZERO) +
                    agg["category_totals"].get("Soda", {}).get("revenue", _ZERO)
                )
            else:
                base_amount = net_sales

            calculated = money_round(base_amount * (pct / 100))
            adjusted = False
            not_staffed = preset.get("not_staffed", False)
            if tip_out_overrides and role in tip_out_overrides:
                override_val = tip_out_overrides[role]
                if override_val is None:
                    not_staffed = True
                    calculated = _ZERO
                else:
                    adjusted = (override_val != calculated)
                    calculated = money_round(override_val)

            tip_outs.append({
                "role": role,
                "basis_description": f"{pct}% {basis.replace('_', ' ')}",
                "amount": calculated,
                "adjusted": adjusted,
                "not_staffed": not_staffed,
            })
            total_tip_out += calculated

        net_tips = gross_tips - total_tip_out
        cash_collected = cash_sales
        today = datetime.now(timezone.utc).strftime("%m/%d/%Y")

        # Gate the server-checkout aggregate against the canonical invariants.
        _declared_cash_tips = declared_cash_tips or Decimal("0.00")
        invariant_gate(
            check_day_close(
                gross_sales=money_round(gross_sales),
                void_total=money_round(voids_total),
                discount_total=money_round(discounts_total),
                refund_total=money_round(refunds_total),
                net_sales=money_round(net_sales),
                tax_collected=money_round(tax_collected),
                cash_total=money_round(cash_sales),
                card_total=money_round(card_sales),
                total_tips=money_round(gross_tips),
                card_tips=money_round(cc_tips_total),
                cash_tips=money_round(_declared_cash_tips),
            ),
            context="build_server_checkout_context",
        )

        if is_v2:
            return {
                "server_id": server_id,
                "server_name": server_name,
                "date": today,
                "clock_in": clock_in,
                "clock_out": clock_out,
                "shift_duration": shift_duration,
                "checks_closed": agg["closed_count"],
                "gross_sales": money_round(gross_sales),
                "voids_total": money_round(voids_total),
                "comps_total": _ZERO,
                "discounts_total": money_round(discounts_total),
                "refunds_total": money_round(refunds_total),
                "net_sales": money_round(net_sales),
                "tax_collected": money_round(tax_collected),
                "cash_sales": money_round(cash_sales),
                "card_sales": money_round(card_sales),
                "show_cc_detail": getattr(settings, "show_cc_detail", True),
                "cc_transactions": cc_transactions,
                "cc_tips_total": money_round(cc_tips_total),
                "declared_cash_tips": declared_cash_tips,
                "gross_tips": money_round(gross_tips),
                "tip_pool": None,
                "tip_outs": tip_outs,
                "total_tip_out": money_round(total_tip_out),
                "net_tips": money_round(net_tips),
                "cash_collected": money_round(cash_sales),
                "cc_tips_payout": getattr(settings, "cc_tips_payout", "cash"),
                "open_tip_count": open_tip_count,
                "checks": [
                    {
                        "check_number": o.check_number or o.order_id,
                        "total": money_round(o.subtotal + o.tax - o.discount_total - o.refund_total),
                        "tip": sum((money_round(tip_map.get(p.payment_id, getattr(p, "tip_amount", 0) or 0)) for p in o.payments if p.status == "confirmed"), _ZERO)
                    }
                    for o in server_orders if o.status == "closed"
                ]
            }

        return {
            "is_reprint": is_reprint,
            "restaurant_name": getattr(settings, "restaurant_name", "KINDpos"),
            "server_id": server_id,
            "server_name": server_name,
            "date": today,
            "clock_in": clock_in,
            "clock_out": clock_out,
            "shift_duration": shift_duration,
            "checks_closed": agg["closed_count"],
            "gross_sales": money_round(gross_sales),
            "voids_total": money_round(voids_total),
            "comps_total": _ZERO,
            "discounts_total": money_round(discounts_total),
            "refunds_total": money_round(refunds_total),
            "net_sales": money_round(net_sales),
            "tax_collected": money_round(tax_collected),
            "cash_sales": money_round(cash_sales),
            "card_sales": money_round(card_sales),
            "cc_transactions": cc_transactions,
            "cc_tips_total": money_round(cc_tips_total),
            "declared_cash_tips": declared_cash_tips,
            "gross_tips": money_round(gross_tips),
            "tip_outs": tip_outs,
            "total_tip_out": money_round(total_tip_out),
            "net_tips": money_round(net_tips),
            "cash_collected": money_round(cash_sales),
            "cash_expected": money_round(cash_sales - cc_tips_total),
            "terminal_id": settings.terminal_id,
            "require_manager_sign": getattr(settings, "require_manager_sign", True),
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  SALES RECAP CONTEXT
    # ─────────────────────────────────────────────────────────────────────────

    async def build_sales_recap_context(
            self,
            business_date: str = None,
            *,
            printed_by: str = "Manager",
            is_reprint: bool = False,
    ) -> Dict[str, Any]:
        """
        Build context for SalesRecapTemplate.

        Aggregates ALL orders since the last DAY_CLOSED boundary.
        This is a manager-only report showing the full day's performance.

        Args:
            business_date:  Optional YYYY-MM-DD date. If provided, returns v2 format.
            printed_by:     Name of the manager printing the report.
            is_reprint:     Whether this is a reprint.
        """
        is_v2 = (business_date is not None)
        if is_v2:
            # Try to fetch from stored DAY_CLOSED event first
            cursor = await self.ledger._db.execute(
                "SELECT payload FROM events WHERE event_type = 'day.closed' AND json_extract(payload, '$.date') = ?",
                (business_date,)
            )
            row = await cursor.fetchone()
            if row:
                payload = json.loads(row[0])
                return {
                    "cob_status": "Closed",
                    "total_sales": Decimal(str(payload.get("total_sales", 0))),
                    "cash_sales": Decimal(str(payload.get("cash_total", 0))),
                    "card_sales": Decimal(str(payload.get("card_total", 0))),
                    "total_tips": Decimal(str(payload.get("total_tips", 0))),
                    "total_checks": payload.get("total_orders", 0),
                }

        boundary = await self.ledger.get_last_day_close_sequence()
        all_events = await self.ledger.get_events_since(boundary, limit=50000)
        all_orders = project_orders(all_events)
        tip_map = self.build_tip_map(all_events)

        agg = self.aggregate_orders(list(all_orders.values()), tip_map)

        total_checks = agg["total_checks"]
        gross_sales = agg["gross_sales"]
        voids_total = agg["void_total"]
        voids_count = agg["voided_count"]
        comps_total = _ZERO
        comps_count = 0
        discounts_total = agg["discount_total"]
        discounts_count = agg["discount_count"]
        refunds_total = agg["refund_total"]
        tax_collected = agg["tax_total"]
        cash_sales = agg["cash_total"]
        cash_count = agg["cash_count"]
        card_sales = agg["card_total"]
        card_count = agg["card_count"]
        total_tips = agg["total_tips"]
        cash_tips = agg["cash_tips"]
        card_tips = agg["card_tips"]
        covers = agg["guest_count"]

        net_sales = agg["net_sales"]
        total_payments = money_round(cash_sales + card_sales)
        avg_check = money_round(net_sales / total_checks) if total_checks > 0 else Decimal("0.00")
        per_person_avg = money_round(net_sales / covers) if covers > 0 else Decimal("0.00")

        # ── Category sales (sorted by total descending) ───────────────────────
        category_sales = sorted(
            [
                {"name": name, "total": money_round(data["revenue"]), "count": data["items_sold"]}
                for name, data in agg["category_totals"].items()
            ],
            key=lambda c: c["total"],
            reverse=True,
        )

        # ── Tax lines ─────────────────────────────────────────────────────────
        tax_lines = [{"label": "Tax", "amount": money_round(tax_collected)}]

        # ── Daypart breakdown ─────────────────────────────────────────────────
        # Deferred: daypart bucketing once order timestamps are available
        # dayparts = [
        #     {"name": "Breakfast (6a-11a)", "sales": 0.0, "checks": 0},
        #     {"name": "Lunch (11a-3p)",     "sales": 0.0, "checks": 0},
        #     {"name": "Dinner (3p-10p)",    "sales": 0.0, "checks": 0},
        #     {"name": "Late Night (10p+)",  "sales": 0.0, "checks": 0},
        # ]
        dayparts = []

        today = datetime.now(timezone.utc).strftime("%m/%d/%Y")

        # Gate the day's aggregate against the canonical invariants. comps_total
        # folds into discounts for the P&L identity (check_pnl_identity only
        # knows gross/voids/discounts/refunds).
        invariant_gate(
            check_day_close(
                gross_sales=money_round(gross_sales),
                void_total=money_round(voids_total),
                discount_total=money_round(discounts_total + comps_total),
                refund_total=money_round(refunds_total),
                net_sales=money_round(net_sales),
                tax_collected=money_round(tax_collected),
                cash_total=money_round(cash_sales),
                card_total=money_round(card_sales),
                total_tips=money_round(total_tips),
                card_tips=money_round(card_tips),
                cash_tips=money_round(cash_tips),
            ),
            context="build_sales_recap_context",
        )

        if is_v2:
            return {
                "cob_status": "Open",
                "total_sales": money_round(gross_sales),
                "cash_sales": money_round(cash_sales),
                "card_sales": money_round(card_sales),
                "total_tips": money_round(total_tips),
                "total_checks": total_checks,
            }

        return {
            "is_reprint": is_reprint,
            "restaurant_name": getattr(settings, "restaurant_name", "KINDpos"),
            "date": today,
            "date_from": today,
            "date_to": "",
            "printed_by": printed_by,
            "printed_at": datetime.now(timezone.utc).isoformat(),
            "gross_sales": money_round(gross_sales),
            "voids_total": money_round(voids_total),
            "voids_count": voids_count,
            "comps_total": money_round(comps_total),
            "comps_count": comps_count,
            "discounts_total": money_round(discounts_total),
            "discounts_count": discounts_count,
            "refunds_total": money_round(refunds_total),
            "net_sales": money_round(net_sales),
            "tax_collected": money_round(tax_collected),
            "tax_lines": tax_lines,
            "cash_sales": money_round(cash_sales),
            "cash_count": cash_count,
            "card_sales": money_round(card_sales),
            "card_count": card_count,
            "other_payments": [],
            "total_payments": money_round(total_payments),
            "total_tips": money_round(total_tips),
            "cash_tips": money_round(cash_tips),
            "card_tips": money_round(card_tips),
            "cash_expected": money_round(cash_sales - card_tips),
            "category_sales": category_sales,
            "total_checks": total_checks,
            "avg_check": avg_check,
            "covers": covers,
            "per_person_avg": per_person_avg,
            "dayparts": dayparts,
            "terminal_id": settings.terminal_id,
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  CLOCK HOURS SUMMARY
    # ─────────────────────────────────────────────────────────────────────────

    async def build_clock_hours_context(
            self,
            employee_id: str,
            employee_name: str,
            role_name: str = "",
            action: str = "CLOCK IN",
    ) -> Dict[str, Any]:
        """
        Build context for ClockHoursTemplate.

        Calculates this-shift duration and weekly pay-period hours
        from USER_LOGGED_IN / USER_LOGGED_OUT events.
        """
        now = datetime.now(timezone.utc)

        # ── Determine pay-period window (Mon 00:00 → now) ────────────────────
        days_since_monday = now.weekday()  # 0=Mon
        period_start = (now - timedelta(days=days_since_monday)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        # Fetch all clock events within the pay period
        login_events = await self.ledger.get_events_by_type(
            EventType.USER_LOGGED_IN, since=period_start, limit=5000
        )
        logout_events = await self.ledger.get_events_by_type(
            EventType.USER_LOGGED_OUT, since=period_start, limit=5000
        )

        # Filter to this employee
        logins = sorted(
            [e for e in login_events if (e.payload or {}).get("employee_id") == employee_id],
            key=lambda e: e.timestamp,
        )
        logouts = sorted(
            [e for e in logout_events if (e.payload or {}).get("employee_id") == employee_id],
            key=lambda e: e.timestamp,
        )

        # ── Pair logins with logouts into shifts ─────────────────────────────
        shifts: List[Dict[str, Any]] = []
        logout_idx = 0
        for login_ev in logins:
            t_in = login_ev.timestamp
            t_out = None
            # Find the next logout after this login
            while logout_idx < len(logouts):
                if logouts[logout_idx].timestamp > t_in:
                    t_out = logouts[logout_idx].timestamp
                    logout_idx += 1
                    break
                logout_idx += 1
            shifts.append({"in": t_in, "out": t_out})

        # ── Current shift (the most recent for this employee) ────────────────
        current_shift_in = None
        current_shift_out = None
        current_duration = ""
        if shifts:
            last = shifts[-1]
            current_shift_in = last["in"].isoformat()
            if last["out"]:
                current_shift_out = last["out"].isoformat()
                delta = last["out"] - last["in"]
                h, rem = divmod(int(delta.total_seconds()), 3600)
                m = rem // 60
                current_duration = f"{h}h {m}m"

        # ── Daily breakdown ──────────────────────────────────────────────────
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        daily_hours: List[Dict[str, str]] = []
        total_seconds = 0

        for d in range(7):
            day_date = period_start + timedelta(days=d)
            if day_date > now:
                break
            day_end = day_date + timedelta(days=1)
            label = f"{day_names[d]} {day_date.strftime('%m/%d')}"

            # Find shifts overlapping this day
            day_shifts = [
                s for s in shifts
                if s["in"] < day_end and s["in"] >= day_date
            ]

            if not day_shifts:
                daily_hours.append({"label": label, "in": "--", "out": "--", "hours": "--"})
                continue

            day_total_secs = 0
            first_in = None
            last_out = None
            for s in day_shifts:
                t_in = s["in"]
                t_out = s["out"] or now  # still clocked in → use now
                if first_in is None:
                    first_in = t_in
                last_out = t_out
                secs = (t_out - t_in).total_seconds()
                day_total_secs += secs
                total_seconds += secs

            hrs = day_total_secs / 3600
            in_str = first_in.strftime("%I:%M%p") if first_in else "--"
            out_str = last_out.strftime("%I:%M%p") if last_out and day_shifts[-1]["out"] else "NOW"
            daily_hours.append({
                "label": label,
                "in": in_str,
                "out": out_str,
                "hours": f"{hrs:.1f}h",
            })

        total_hours = total_seconds / 3600
        period_end_date = period_start + timedelta(days=6)
        period_label = f"{period_start.strftime('%m/%d')} - {period_end_date.strftime('%m/%d')}"

        return {
            "restaurant_name": getattr(settings, "restaurant_name", "KINDpos"),
            "employee_name": employee_name,
            "role_name": role_name,
            "action": action,
            "date": now.strftime("%m/%d/%Y"),
            "time": now.strftime("%I:%M %p"),
            "clock_in": current_shift_in,
            "clock_out": current_shift_out,
            "shift_duration": current_duration,
            "period_label": period_label,
            "daily_hours": daily_hours,
            "period_total_hours": f"{total_hours:.1f}",
        }