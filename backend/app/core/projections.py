"""
KINDpos Projections

Projections rebuild current state from events.
The Event Ledger stores what happened; projections answer "what is the current state?"

This is the magic of event sourcing:
- Events are the source of truth
- State is always derived, never stored
- Any state can be rebuilt by replaying events
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from decimal import Decimal

from .events import Event, EventType
from .money import money_round
from ..config import settings


@dataclass
class OrderItem:
    """A single item on an order."""
    item_id: str
    menu_item_id: str
    name: str
    price: Decimal
    quantity: int
    category: Optional[str] = None
    notes: Optional[str] = None
    seat_number: Optional[int] = None
    modifiers: list[dict] = field(default_factory=list)
    added_at: Optional[datetime] = None
    sent: bool = False
    sent_at: Optional[datetime] = None
    split_ref: Optional[str] = None
    voided: bool = False
    voided_at: Optional[datetime] = None

    @property
    def subtotal(self) -> Decimal:
        """Calculate item subtotal including modifiers.
        Uses Decimal to avoid float drift (e.g. 0.01 × 100)."""
        modifier_total = sum(Decimal(str(m.get("price", 0))) for m in self.modifiers)
        return (self.price + modifier_total) * self.quantity


@dataclass
class Payment:
    """A payment attempt on an order."""
    payment_id: str
    amount: Decimal
    method: str
    status: str = "pending"  # pending, confirmed, failed
    transaction_id: Optional[str] = None
    error: Optional[str] = None
    initiated_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    tip_amount: Decimal = Decimal("0.00")
    tip_adjusted: bool = False  # True once a TIP_ADJUSTED event has been applied
    tip_adjustments: list[dict] = field(default_factory=list)  # Ordered history of adjustments
    tax_amount: Decimal = Decimal("0.00")  # Tax captured at payment time
    seat_numbers: list[int] = field(default_factory=list)  # Seats covered by this payment
    card_last_four: Optional[str] = None  # Last four digits of card; null for cash


@dataclass
class SeatBalance:
    """Per-seat financial state, projected from seat-scoped events.

    Used for split-check audit: replay exactly which items, discounts, and
    payment slices belong to each seat so disputes are replayable from the
    ledger without re-running the checkout flow.
    """
    seat_number: int
    items: list["OrderItem"] = field(default_factory=list)
    discounts: list[dict] = field(default_factory=list)
    seat_payments: list[dict] = field(default_factory=list)
    is_paid: bool = False
    is_comped: bool = False
    comp_category: Optional[str] = None

    @property
    def item_subtotal(self) -> Decimal:
        return sum((i.subtotal for i in self.items if not i.voided), Decimal("0.00"))

    @property
    def discount_total(self) -> Decimal:
        return sum((Decimal(str(d.get("amount", 0))) for d in self.discounts), Decimal("0.00"))

    @property
    def amount_paid(self) -> Decimal:
        return sum(
            (Decimal(str(p.get("amount", 0))) for p in self.seat_payments
             if p.get("status") == "confirmed"),
            Decimal("0.00"),
        )

    @property
    def balance_due(self) -> Decimal:
        from app.core.money import money_round as _mr
        return _mr(max(Decimal("0.00"), self.item_subtotal - self.discount_total - self.amount_paid))


@dataclass
class Order:
    """
    Current state of an order, projected from events.

    This is NOT stored - it's computed by replaying events.
    """
    order_id: str
    check_number: Optional[str] = None
    table: Optional[str] = None
    server_id: Optional[str] = None
    server_name: Optional[str] = None
    customer_name: Optional[str] = None
    guest_count: int = 1
    status: str = "open"  # open, paid, closed, voided

    # Authoritative list of seat numbers on the check. Set explicitly via
    # ORDER_CREATED / SEATS_UPDATED, and auto-extended when an ITEM_ADDED
    # lands on a seat not yet in the list (legacy replay compatibility).
    seat_numbers: list[int] = field(default_factory=list)

    items: list[OrderItem] = field(default_factory=list)
    payments: list[Payment] = field(default_factory=list)
    discounts: list[dict] = field(default_factory=list)
    refunds: list[dict] = field(default_factory=list)

    # Per-seat financial state — populated by seat-scoped events
    seat_balances: dict = field(default_factory=dict)  # int → SeatBalance

    created_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    day_part: Optional[str] = None  # breakfast, lunch, dinner, late_night, all_day
    order_type: Optional[str] = None  # dine_in, takeout, delivery, bar, etc.

    # Printing history
    print_history: list[dict] = field(default_factory=list)

    # Tax rate — read from settings by default, overridable via project_order()
    _tax_rate: Decimal = None

    @property
    def gross_subtotal(self) -> Decimal:
        """Sum of all active (non-voided) items before discounts."""
        return sum((item.subtotal for item in self.items if not item.voided), Decimal("0.00"))

    @property
    def subtotal(self) -> Decimal:
        """Sum of all items minus discounts. Uses Decimal for exactness."""
        return money_round(max(Decimal("0.00"), self.gross_subtotal - self.discount_total))

    @property
    def discount_total(self) -> Decimal:
        """Sum of all discounts. Uses Decimal for exactness."""
        return sum((Decimal(str(d.get("amount", 0))) for d in self.discounts), Decimal("0.00"))

    @property
    def refund_total(self) -> Decimal:
        """Sum of all refunds issued on this order."""
        return sum((Decimal(str(r.get("amount", 0))) for r in self.refunds), Decimal("0.00"))

    @property
    def tax_rate(self) -> Decimal:
        if self._tax_rate is not None:
            return self._tax_rate
        return Decimal(str(settings.tax_rate))

    @property
    def tax(self) -> Decimal:
        """Tax collected — prefer event-sourced value from confirmed payments.
        Falls back to computed tax only when no payment has captured tax."""
        captured = sum((p.tax_amount for p in self.payments if p.status == "confirmed"), Decimal("0.00"))
        if captured > 0:
            return captured
        taxable = self.subtotal
        return money_round(taxable * self.tax_rate)

    @property
    def total(self) -> Decimal:
        """Final total (clamped to zero — discount cannot make total negative)."""
        raw = self.subtotal + self.tax
        return money_round(max(Decimal("0.00"), raw))

    @property
    def amount_paid(self) -> Decimal:
        """Sum of confirmed payments."""
        return sum((p.amount for p in self.payments if p.status == "confirmed"), Decimal("0.00"))

    @property
    def balance_due(self) -> Decimal:
        """Remaining balance."""
        return money_round(self.total - self.amount_paid)

    @property
    def paid_seats(self) -> list[int]:
        """Seat numbers covered by confirmed payments."""
        seats = set()
        for p in self.payments:
            if p.status == "confirmed" and p.seat_numbers:
                seats.update(p.seat_numbers)
        return sorted(seats)

    @property
    def is_empty(self) -> bool:
        """True if order has no items."""
        return len(self.items) == 0

    @property
    def is_fully_paid(self) -> bool:
        """Check if order is fully paid."""
        return self.amount_paid >= self.total


def project_order(events: list[Event], tax_rate: Decimal = None) -> Optional[Order]:
    """
    Rebuild an Order from a list of events.

    This is the core projection logic. Given all events for an order,
    replay them in sequence to compute current state.

    Args:
        tax_rate: Override the default tax rate (0.06) for this projection.
    """
    if not events:
        return None

    # Sort by sequence number to ensure correct order
    events = sorted(events, key=lambda e: e.sequence_number or 0)

    order: Optional[Order] = None

    def _seat(sn: int) -> "SeatBalance":
        """Return-or-create the SeatBalance for seat_number sn."""
        if sn not in order.seat_balances:
            order.seat_balances[sn] = SeatBalance(seat_number=sn)
        return order.seat_balances[sn]

    for event in events:
        payload = event.payload

        # --- ORDER LIFECYCLE ---

        if event.event_type == EventType.ORDER_CREATED:
            order = Order(
                order_id=payload["order_id"],
                check_number=payload.get("check_number"),
                table=payload.get("table"),
                server_id=payload.get("server_id"),
                server_name=payload.get("server_name"),
                customer_name=payload.get("customer_name"),
                guest_count=payload.get("guest_count", 1),
                seat_numbers=list(payload.get("seat_numbers") or []),
                created_at=event.timestamp,
                day_part=payload.get("day_part"),
                order_type=payload.get("order_type"),
            )
            if tax_rate is not None:
                order._tax_rate = Decimal(str(tax_rate))

        elif event.event_type == EventType.ORDER_CLOSED:
            if order:
                order.status = "closed"
                order.closed_at = event.timestamp

        elif event.event_type == EventType.ORDER_REOPENED:
            # Only reopen from closed/paid. A voided order must stay voided;
            # a stray REOPENED event (replay, out-of-order, or a UI bug) would
            # otherwise silently undo the void and make refunds look like
            # collectible receivables.
            if order and order.status in ("closed", "paid"):
                order.status = "open"
                order.closed_at = None

        elif event.event_type == EventType.ORDER_VOIDED:
            if order:
                order.status = "voided"
                order.voided_at = event.timestamp
                order.void_reason = payload.get("reason")

        elif event.event_type == EventType.CHECK_ABANDONED:
            if order:
                order.status = "voided"
                order.voided_at = event.timestamp
                order.void_reason = payload.get("reason", "Abandoned")

        elif event.event_type == EventType.ORDER_TRANSFERRED:
            if order:
                order.server_id = payload.get("server_id")
                order.server_name = payload.get("server_name")

        elif event.event_type == EventType.CHECK_NAMED:
            if order:
                order.customer_name = payload.get("customer_name")

        elif event.event_type == EventType.GUEST_COUNT_UPDATED:
            if order:
                order.guest_count = payload.get("guest_count", order.guest_count)

        elif event.event_type == EventType.SEATS_UPDATED:
            if order:
                seats = payload.get("seat_numbers")
                if seats is not None:
                    # Union with any seats already referenced by items.
                    # Prevents SEATS_UPDATED from orphaning items whose
                    # seat_number isn't in the new list (happens if the
                    # client sends a stale seat list, or a legacy order
                    # had implicit seats from ITEM_ADDED only).
                    item_seats = {
                        i.seat_number for i in order.items if i.seat_number is not None
                    }
                    order.seat_numbers = sorted(set(int(n) for n in seats) | item_seats)
                    order.guest_count = max(1, len(order.seat_numbers))

        # --- ITEMS ---

        elif event.event_type == EventType.ITEM_ADDED:
            if order:
                item = OrderItem(
                    item_id=payload["item_id"],
                    menu_item_id=payload["menu_item_id"],
                    name=payload["name"],
                    price=Decimal(str(payload["price"])),
                    quantity=payload.get("quantity", 1),
                    category=payload.get("category"),
                    notes=payload.get("notes"),
                    seat_number=payload.get("seat_number"),
                    added_at=event.timestamp,
                    split_ref=payload.get("split_ref"),
                )
                order.items.append(item)
                # Keep seat_numbers in sync for legacy events that never
                # emitted SEATS_UPDATED. Only extends — shrinking is done
                # via explicit SEATS_UPDATED.
                if item.seat_number is not None and item.seat_number not in order.seat_numbers:
                    order.seat_numbers.append(item.seat_number)
                # Per-seat balance
                if item.seat_number is not None:
                    _seat(item.seat_number).items.append(item)

        elif event.event_type == EventType.ITEM_REMOVED:
            if order:
                item_id = payload["item_id"]
                # Mark item as voided instead of removing it — preserves audit trail
                for item in order.items:
                    if item.item_id == item_id:
                        item.voided = True
                        item.voided_at = event.timestamp
                        break
                # Mark in per-seat balance as well
                for sb in order.seat_balances.values():
                    for item in sb.items:
                        if item.item_id == item_id:
                            item.voided = True
                            item.voided_at = event.timestamp
                            break

        elif event.event_type == EventType.ITEM_MODIFIED:
            if order:
                item_id = payload["item_id"]
                for item in order.items:
                    if item.item_id == item_id:
                        if "quantity" in payload:
                            item.quantity = payload["quantity"]
                        if "price" in payload:
                            item.price = Decimal(str(payload["price"]))
                        if "notes" in payload:
                            item.notes = payload["notes"]
                        if "seat_number" in payload:
                            item.seat_number = payload["seat_number"]
                        break

        elif event.event_type == EventType.MODIFIER_APPLIED:
            if order:
                item_id = payload["item_id"]
                for item in order.items:
                    if item.item_id == item_id:
                        modifier = {
                            "modifier_id": payload["modifier_id"],
                            "name": payload["modifier_name"],
                            "price": Decimal(str(payload.get("modifier_price", 0))),
                            "action": payload.get("action", "add"),
                            "prefix": payload.get("prefix"),
                            "half_price": payload.get("half_price"),
                        }
                        if payload.get("action") == "remove":
                            item.modifiers = [
                                m for m in item.modifiers
                                if m["modifier_id"] != payload["modifier_id"]
                            ]
                        else:
                            if not any(m["modifier_id"] == modifier["modifier_id"] for m in item.modifiers):
                                item.modifiers.append(modifier)
                        break

        elif event.event_type == EventType.ITEM_SENT:
            if order:
                item_id = payload["item_id"]
                for item in order.items:
                    if item.item_id == item_id:
                        item.sent = True
                        item.sent_at = event.timestamp
                        break

        # --- DISCOUNTS ---

        elif event.event_type == EventType.DISCOUNT_APPROVED:
            if order:
                order.discounts.append({
                    "type": payload.get("discount_type"),
                    "amount": Decimal(str(payload.get("amount", 0))),
                    "reason": payload.get("reason"),
                    "approved_by": payload.get("approved_by"),
                    "approved_at": event.timestamp,
                    "discount_id": payload.get("discount_id"),
                })

        elif event.event_type == EventType.DISCOUNT_VOIDED:
            if order and order.discounts:
                # Remove the discount that matches by (discount_id) first,
                # else by (type + amount). The total re-inflates naturally
                # because order.total reads the current discounts list.
                target_id = payload.get("discount_id")
                target_type = payload.get("discount_type")
                target_amt = Decimal(str(payload.get("amount", 0)))
                for i, d in enumerate(order.discounts):
                    if target_id and d.get("discount_id") == target_id:
                        order.discounts.pop(i)
                        break
                else:
                    for i, d in enumerate(order.discounts):
                        if (d.get("type") == target_type
                                and d.get("amount") == target_amt):
                            order.discounts.pop(i)
                            break

        # --- PAYMENTS ---

        elif event.event_type == EventType.PAYMENT_INITIATED:
            if order:
                pid = payload.get("payment_id") or payload.get("transaction_id")
                amt = payload.get("amount", 0)
                payment = Payment(
                    payment_id=pid,
                    amount=Decimal(str(amt)),
                    method=payload.get("method", payload.get("payment_type", "cash")),
                    status="pending",
                    initiated_at=event.timestamp,
                    seat_numbers=payload.get("seat_numbers", []),
                )
                order.payments.append(payment)

        elif event.event_type == EventType.PAYMENT_CONFIRMED:
            if order:
                pid = payload.get("payment_id") or payload.get("transaction_id")
                for payment in order.payments:
                    if payment.payment_id == pid:
                        payment.status = "confirmed"
                        payment.transaction_id = payload.get("transaction_id")
                        payment.confirmed_at = event.timestamp
                        payment.tax_amount = Decimal(str(payload.get("tax", Decimal("0.00"))))
                        payment.card_last_four = payload.get("card_last_four")
                        if payload.get("seat_numbers"):
                            payment.seat_numbers = payload["seat_numbers"]
                        # Distribute a payment slice to each covered seat.
                        # Last seat receives the remainder to avoid losing a
                        # penny when amount / N is not exactly representable
                        # (e.g. $10.00 / 3 = $3.33 * 3 = $9.99).
                        seat_nums = payload.get("seat_numbers") or []
                        if seat_nums:
                            total_pay = Decimal(str(payment.amount))
                            n = len(seat_nums)
                            distributed = Decimal("0.00")
                            for idx, sn in enumerate(seat_nums):
                                if idx == n - 1:
                                    seat_slice = money_round(total_pay - distributed)
                                else:
                                    seat_slice = money_round(total_pay / n)
                                    distributed += seat_slice
                                _seat(int(sn)).seat_payments.append({
                                    "payment_id": pid,
                                    "amount": str(seat_slice),
                                    "status": "confirmed",
                                    "confirmed_at": str(event.timestamp),
                                })
                        break

                # Auto-update order status if fully paid
                if order.is_fully_paid and order.status == "open":
                    order.status = "paid"

        # ── Seat-scoped financial events ─────────────────────────────

        elif event.event_type == EventType.SEAT_DISCOUNT_APPLIED:
            if order:
                sn = payload.get("seat_number")
                if sn is not None:
                    _seat(int(sn)).discounts.append({
                        "discount_id": payload.get("discount_id"),
                        "discount_type": payload.get("discount_type"),
                        "amount": Decimal(str(payload.get("amount", 0))),
                        "approved_by": payload.get("approved_by"),
                        "applied_at": str(event.timestamp),
                    })

        elif event.event_type == EventType.SEAT_DISCOUNT_VOIDED:
            if order:
                sn = payload.get("seat_number")
                if sn is not None:
                    sb = _seat(int(sn))
                    did = payload.get("discount_id")
                    if did:
                        sb.discounts = [d for d in sb.discounts if d.get("discount_id") != did]
                    else:
                        # Fall back to type+amount match — compare as Decimal
                        # so that int 10 and float 10.0 both match Decimal("10")
                        dtype = payload.get("discount_type")
                        amt = Decimal(str(payload.get("amount", 0)))
                        sb.discounts = [
                            d for d in sb.discounts
                            if not (d.get("discount_type") == dtype and Decimal(str(d.get("amount", 0))) == amt)
                        ]

        elif event.event_type == EventType.SEAT_COMPED:
            if order:
                sn = payload.get("seat_number")
                if sn is not None:
                    sb = _seat(int(sn))
                    sb.is_comped = True
                    sb.comp_category = payload.get("comp_category")

        elif event.event_type == EventType.SEAT_PAYMENT_VOIDED:
            if order:
                sn = payload.get("seat_number")
                pid = payload.get("payment_id")
                if sn is not None and pid:
                    sb = _seat(int(sn))
                    sb.seat_payments = [
                        p for p in sb.seat_payments if p.get("payment_id") != pid
                    ]

        elif event.event_type == EventType.SEAT_PAID:
            if order:
                sn = payload.get("seat_number")
                if sn is not None:
                    _seat(int(sn)).is_paid = True

        elif event.event_type in (
            EventType.PAYMENT_DECLINED,
            EventType.PAYMENT_CANCELLED,
            EventType.PAYMENT_TIMED_OUT,
            EventType.PAYMENT_ERROR,
        ):
            if order:
                pid = payload.get("payment_id") or payload.get("transaction_id")
                for payment in order.payments:
                    if payment.payment_id == pid:
                        payment.status = "failed"
                        payment.error = payload.get("error") or payload.get("processor_message")
                        break

                # Revert order to "open" if no longer fully paid
                if order.status == "paid" and not order.is_fully_paid:
                    order.status = "open"

        elif event.event_type == EventType.TIP_ADJUSTED:
            if order:
                pid = payload.get("payment_id")
                for payment in order.payments:
                    if payment.payment_id == pid:
                        payment.tip_adjustments.append({
                            "amount": Decimal(str(payload.get("tip_amount", "0.00"))),
                            "adjusted_at": event.timestamp,
                            "adjusted_by": payload.get("adjusted_by"),
                        })
                        payment.tip_amount = Decimal(str(payload.get("tip_amount", Decimal("0.00"))))
                        payment.tip_adjusted = True
                        break

        elif event.event_type == EventType.PAYMENT_REFUNDED:
            if order:
                order.refunds.append({
                    "payment_id": payload.get("payment_id"),
                    "amount": Decimal(str(payload.get("amount", 0))),
                    "reason": payload.get("reason"),
                    "refunded_at": event.timestamp,
                })

        # --- PRINTING ---

        elif event.event_type == EventType.TICKET_PRINTED:
            if order:
                order.print_history.append({
                    "printer_id": payload["printer_id"],
                    "printer_name": payload["printer_name"],
                    "ticket_type": payload.get("ticket_type", "kitchen"),
                    "printed_at": event.timestamp,
                })

        elif event.event_type in (EventType.CHECK_SPLIT, EventType.CHECK_MERGED):
            # Audit-only in v1 — the split/merge operations mutate state
            # via ITEM_ADDED / ITEM_REMOVED / ORDER_VOIDED, which are
            # already handled above. A future revision may project
            # lineage fields (split_to, merged_from) from these payloads.
            pass

    return order


def project_orders(events: list[Event]) -> dict[str, Order]:
    """
    Project multiple orders from a list of events.

    Groups events by order_id and projects each order.
    """
    # Group events by order_id
    events_by_order: dict[str, list[Event]] = {}

    for event in events:
        order_id = event.payload.get("order_id") or event.correlation_id
        if order_id:
            if order_id not in events_by_order:
                events_by_order[order_id] = []
            events_by_order[order_id].append(event)

    # Project each order
    orders = {}
    for order_id, order_events in events_by_order.items():
        order = project_order(order_events)
        if order:
            orders[order_id] = order

    return orders


def get_open_orders(orders: dict[str, Order]) -> list[Order]:
    """Filter to only open orders."""
    return [o for o in orders.values() if o.status == "open"]


def get_orders_by_table(orders: dict[str, Order], table: str) -> list[Order]:
    """Get orders for a specific table."""
    return [o for o in orders.values() if o.table == table and o.status in ("open", "paid")]


def get_orders_by_server(orders: dict[str, Order], server_id: str) -> list[Order]:
    """Get orders for a specific server."""
    return [o for o in orders.values() if o.server_id == server_id]
