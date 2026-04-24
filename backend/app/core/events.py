"""
KINDpos Event Definitions

Events are the source of truth. Everything else is a projection.
This module defines all event types and provides factory functions
for creating properly structured events.
"""

from enum import Enum
from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field
import uuid
import hashlib
import json
from decimal import Decimal


class _DecimalEncoder(json.JSONEncoder):
    """JSON encoder that converts Decimal to float for serialization."""
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)
import json

from .money import money_round


class OrderType(str, Enum):
    """Core order types used by KINDpos."""
    DINE_IN   = "dine_in"
    TO_GO     = "to_go"
    BAR_TAB   = "bar_tab"
    DELIVERY  = "delivery"
    STAFF     = "staff"


class EventType(str, Enum):
    """All event types in the system.

    Naming convention: dot.notation lowercase (e.g. "order.created").
    New events written with dot-notation values; legacy UPPERCASE values
    accepted on read via _LEGACY_ALIASES lookup below.
    """

    # ── Order lifecycle (LEDGER_CORE) ────────────────────────────────
    ORDER_CREATED = "order.created"
    ORDER_CLOSED = "order.closed"
    ORDER_REOPENED = "order.reopened"
    ORDER_VOIDED = "order.voided"
    ORDER_TRANSFERRED = "order.transferred"
    GUEST_COUNT_UPDATED = "guest_count.updated"
    SEATS_UPDATED = "seats.updated"
    CHECK_OPENED = "check.opened"
    CHECK_NAMED = "check.named"
    CHECK_ABANDONED = "check.abandoned"
    CHECK_SPLIT = "check.split"
    CHECK_MERGED = "check.merged"

    # ── Item management (LEDGER_CORE) ────────────────────────────────
    ITEM_ADDED = "item.added"
    ITEM_REMOVED = "item.removed"
    ITEM_MODIFIED = "item.modified"
    ITEM_SENT = "item.sent"
    MODIFIER_APPLIED = "modifier.applied"

    # ── Discounts (LEDGER_CORE) ──────────────────────────────────────
    DISCOUNT_APPROVED = "discount.approved"
    DISCOUNT_VOIDED = "discount.voided"

    # ── Printing (LEDGER_OPERATIONAL / EPHEMERAL) ────────────────────
    TICKET_PRINTED = "ticket.printed"               # LEDGER_OPERATIONAL
    TICKET_PRINT_FAILED = "ticket.print_failed"     # EPHEMERAL
    TICKET_REPRINTED = "ticket.reprinted"            # LEDGER_OPERATIONAL
    PRINT_RETRYING = "print.retrying"                # EPHEMERAL
    PRINT_REROUTED = "print.rerouted"                # EPHEMERAL

    # ── Printer lifecycle (LEDGER_OPERATIONAL / EPHEMERAL) ───────────
    PRINTER_REGISTERED = "printer.registered"              # LEDGER_OPERATIONAL
    PRINTER_CONFIGURED = "printer.configured"              # LEDGER_OPERATIONAL
    PRINTER_REMOVED = "printer.removed"                    # LEDGER_OPERATIONAL
    PRINTER_ASSIGNMENT_CHANGED = "printer.assignment_changed"  # LEDGER_OPERATIONAL
    PAYMENT_PROCESSOR_CONFIGURED = "payment.processor_configured"  # LEDGER_OPERATIONAL
    PRINTER_STATUS_CHANGED = "printer.status_changed"      # EPHEMERAL
    PRINTER_ERROR = "printer.error"                        # EPHEMERAL
    PRINTER_ROLE_CREATED = "printer.role_created"          # EPHEMERAL
    PRINTER_FALLBACK_ASSIGNED = "printer.fallback_assigned"  # EPHEMERAL

    # ── Printer maintenance (EPHEMERAL) ──────────────────────────────
    PRINTER_REBOOT_STARTED = "printer.reboot_started"
    PRINTER_REBOOT_COMPLETED = "printer.reboot_completed"
    PRINTER_HEALTH_WARNING = "printer.health_warning"

    # ── Cash drawer (EPHEMERAL) ──────────────────────────────────────
    DRAWER_OPENED = "drawer.opened"
    DRAWER_OPEN_FAILED = "drawer.open_failed"

    # ── Payment processing (LEDGER_CORE) ─────────────────────────────
    PAYMENT_INITIATED = "payment.initiated"
    PAYMENT_CONFIRMED = "payment.confirmed"
    PAYMENT_DECLINED = "payment.failed"
    PAYMENT_CANCELLED = "payment.cancelled"
    PAYMENT_TIMED_OUT = "payment.timeout"
    PAYMENT_ERROR = "payment.error"

    # ── Post-authorization (LEDGER_CORE) ─────────────────────────────
    PAYMENT_REFUNDED = "payment.refunded"
    SEAT_PAID = "seat.paid"
    SEAT_TIP_ADDED = "seat.tip_added"
    SEAT_OVERPAYMENT_RESOLVED = "seat.overpayment_resolved"
    TIP_ADJUSTED = "payment.tip_adjusted"
    CASH_TIPS_DECLARED = "payment.cash_tips_declared"

    # ── Batch / Day (LEDGER_CORE) ────────────────────────────────────
    BATCH_SUBMITTED = "batch.submitted"
    DAY_OPENED = "day.opened"
    DAY_CLOSED = "day.closed"

    # ── Device (EPHEMERAL) ───────────────────────────────────────────
    DEVICE_STATUS_CHANGED = "device.status_changed"

    # ── Store Configuration (LEDGER_OPERATIONAL) ─────────────────────
    STORE_INFO_UPDATED = "store.info_updated"
    STORE_BRANDING_UPDATED = "store.branding_updated"
    STORE_THEME_SAVED = "store.theme_saved"
    STORE_THEME_DELETED = "store.theme_deleted"
    STORE_ACTIVE_THEME_SET = "store.active_theme_set"
    STORE_CC_PROCESSING_RATE_UPDATED = "store.cc_processing_rate_updated"
    STORE_TAX_RULE_CREATED = "store.tax_rule_created"
    STORE_TAX_RULE_UPDATED = "store.tax_rule_updated"
    STORE_TAX_RULE_DELETED = "store.tax_rule_deleted"
    STORE_OPERATING_HOURS_UPDATED = "store.operating_hours_updated"
    STORE_ORDER_TYPES_UPDATED = "store.order_types_updated"
    STORE_AUTO_GRATUITY_UPDATED = "store.auto_gratuity_updated"

    # ── Employee & Roles (LEDGER_OPERATIONAL) ────────────────────────
    EMPLOYEE_ROLE_CREATED = "employee.role_created"
    EMPLOYEE_ROLE_UPDATED = "employee.role_updated"
    EMPLOYEE_ROLE_DELETED = "employee.role_deleted"
    EMPLOYEE_CREATED = "employee.created"
    EMPLOYEE_UPDATED = "employee.updated"
    EMPLOYEE_DELETED = "employee.deleted"
    STAFF_PIN_CHANGED = "staff.pin_changed"
    TIPOUT_RULE_CREATED = "tipout.rule_created"
    TIPOUT_RULE_UPDATED = "tipout.rule_updated"
    TIPOUT_RULE_DELETED = "tipout.rule_deleted"
    TIPOUT_POOL_CREATED = "tipout.pool_created"
    TIPOUT_POOL_UPDATED = "tipout.pool_updated"
    TIPOUT_POOL_DELETED = "tipout.pool_deleted"

    # ── Menu management (LEDGER_OPERATIONAL) ─────────────────────────
    MENU_ITEM_CREATED = "menu.item_created"
    MENU_ITEM_UPDATED = "menu.item_updated"
    MENU_ITEM_DELETED = "menu.item_deleted"
    MENU_CATEGORY_CREATED = "menu.category_created"
    MENU_CATEGORY_UPDATED = "menu.category_updated"
    MENU_CATEGORY_DELETED = "menu.category_deleted"
    MENU_ITEM_86D = "menu.item_86d"
    MENU_ITEM_RESTORED = "menu.item_restored"
    ITEM_86ED = "item.86ed"
    ITEM_86_CLEARED = "item.86_cleared"
    MENU_ITEMS_REORDERED = "menu.items_reordered"
    MENU_CATEGORIES_REORDERED = "menu.categories_reordered"
    MODIFIER_GROUP_CREATED = "modifier.group_created"
    MODIFIER_GROUP_UPDATED = "modifier.group_updated"
    MODIFIER_GROUP_DELETED = "modifier.group_deleted"

    # ── Batch setup (LEDGER_OPERATIONAL) ─────────────────────────────
    RESTAURANT_CONFIGURED = "restaurant.configured"
    TAX_RULES_BATCH_CREATED = "tax_rules.batch_created"
    CATEGORIES_BATCH_CREATED = "categories.batch_created"
    ITEMS_BATCH_CREATED = "items.batch_created"

    # ── Floor Plan (LEDGER_OPERATIONAL) ──────────────────────────────
    FLOORPLAN_SECTION_CREATED = "floorplan.section_created"
    FLOORPLAN_SECTION_UPDATED = "floorplan.section_updated"
    FLOORPLAN_SECTION_DELETED = "floorplan.section_deleted"
    FLOORPLAN_LAYOUT_UPDATED = "floorplan.layout_updated"

    # ── Hardware (LEDGER_OPERATIONAL) ────────────────────────────────
    TERMINAL_REGISTERED = "terminal.registered"
    TERMINAL_UPDATED = "terminal.updated"
    ROUTING_MATRIX_UPDATED = "routing.matrix_updated"

    # ── System (LEDGER_OPERATIONAL) ──────────────────────────────────
    USER_LOGGED_IN = "user.logged_in"
    USER_LOGGED_OUT = "user.logged_out"
    CLOCK_IN = "clock.in"
    CLOCK_OUT = "clock.out"

    # ── Timecard (LEDGER_OPERATIONAL) ─────────────────────────────────
    # Admin-initiated clock-in/out correction. Applied over the raw
    # USER_LOGGED_IN/OUT events when computing labor summaries so the
    # ledger keeps both the original event and the correction history.
    TIMECARD_ADJUSTED = "timecard.adjusted"


# Legacy UPPERCASE values from existing ledger data → canonical EventType
_LEGACY_ALIASES: dict[str, EventType] = {
    "ORDER_CREATED": EventType.ORDER_CREATED,
    "ORDER_CLOSED": EventType.ORDER_CLOSED,
    "ORDER_REOPENED": EventType.ORDER_REOPENED,
    "ORDER_VOIDED": EventType.ORDER_VOIDED,
    "ITEM_ADDED": EventType.ITEM_ADDED,
    "ITEM_REMOVED": EventType.ITEM_REMOVED,
    "ITEM_MODIFIED": EventType.ITEM_MODIFIED,
    "ITEM_SENT": EventType.ITEM_SENT,
    "MODIFIER_APPLIED": EventType.MODIFIER_APPLIED,
    "DISCOUNT_APPROVED": EventType.DISCOUNT_APPROVED,
    "TICKET_PRINTED": EventType.TICKET_PRINTED,
    "TICKET_PRINT_FAILED": EventType.TICKET_PRINT_FAILED,
    "TICKET_REPRINTED": EventType.TICKET_REPRINTED,
    "PRINT_RETRYING": EventType.PRINT_RETRYING,
    "PRINT_REROUTED": EventType.PRINT_REROUTED,
    "PRINTER_REGISTERED": EventType.PRINTER_REGISTERED,
    "PRINTER_STATUS_CHANGED": EventType.PRINTER_STATUS_CHANGED,
    "PRINTER_ERROR": EventType.PRINTER_ERROR,
    "PRINTER_ROLE_CREATED": EventType.PRINTER_ROLE_CREATED,
    "PRINTER_FALLBACK_ASSIGNED": EventType.PRINTER_FALLBACK_ASSIGNED,
    "PRINTER_REBOOT_STARTED": EventType.PRINTER_REBOOT_STARTED,
    "PRINTER_REBOOT_COMPLETED": EventType.PRINTER_REBOOT_COMPLETED,
    "PRINTER_HEALTH_WARNING": EventType.PRINTER_HEALTH_WARNING,
    "DRAWER_OPENED": EventType.DRAWER_OPENED,
    "DRAWER_OPEN_FAILED": EventType.DRAWER_OPEN_FAILED,
    "PAYMENT_ERROR": EventType.PAYMENT_ERROR,
    "PAYMENT_REFUNDED": EventType.PAYMENT_REFUNDED,
    "MENU_ITEM_CREATED": EventType.MENU_ITEM_CREATED,
    "MENU_ITEM_UPDATED": EventType.MENU_ITEM_UPDATED,
    "MENU_ITEM_DELETED": EventType.MENU_ITEM_DELETED,
    "MENU_CATEGORY_CREATED": EventType.MENU_CATEGORY_CREATED,
    "MENU_CATEGORY_UPDATED": EventType.MENU_CATEGORY_UPDATED,
    "MENU_CATEGORY_DELETED": EventType.MENU_CATEGORY_DELETED,
    "MODIFIER_GROUP_CREATED": EventType.MODIFIER_GROUP_CREATED,
    "MODIFIER_GROUP_UPDATED": EventType.MODIFIER_GROUP_UPDATED,
    "MODIFIER_GROUP_DELETED": EventType.MODIFIER_GROUP_DELETED,
    "TERMINAL_REGISTERED": EventType.TERMINAL_REGISTERED,
    "CHECK_ABANDONED": EventType.CHECK_ABANDONED,
    "USER_LOGGED_IN": EventType.USER_LOGGED_IN,
    "USER_LOGGED_OUT": EventType.USER_LOGGED_OUT,
}


def parse_event_type(raw: str) -> EventType:
    """Parse an event type string, accepting both dot-notation and legacy UPPERCASE."""
    try:
        return EventType(raw)
    except ValueError:
        if raw in _LEGACY_ALIASES:
            return _LEGACY_ALIASES[raw]
        raise


# Config event prefixes: these events represent rules authored by the Overseer
# and replicated read-only to Terminals via LAN sync.
CONFIG_EVENT_PREFIXES: tuple[str, ...] = (
    "store.",
    "employee.",
    "tipout.",
    "menu.",
    "modifier.",
    "restaurant.",
    "tax_rules.",
    "categories.",
    "items.",
    "floorplan.",
    "terminal.",
    "routing.",
)


def is_config_event(event_type: str) -> bool:
    """True if `event_type` represents a configuration event (Overseer-authored)."""
    return any(event_type.startswith(p) for p in CONFIG_EVENT_PREFIXES)


class Event(BaseModel):
    """
    Immutable event record.

    Once created, events are never modified or deleted.
    The checksum creates a hash chain for tamper detection.
    """

    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    terminal_id: str
    event_type: EventType
    payload: dict[str, Any]
    sequence_number: Optional[int] = None  # Set by EventLedger on insert
    previous_checksum: Optional[str] = None  # Hash chain
    checksum: Optional[str] = None  # Computed on insert

    # Metadata
    user_id: Optional[str] = None
    user_role: Optional[str] = None
    correlation_id: Optional[str] = None  # Links related events
    idempotency_key: Optional[str] = None  # Prevents duplicate writes

    model_config = ConfigDict(frozen=True)

    def compute_checksum(self, previous_checksum: str = "") -> str:
        """
        Compute SHA-256 checksum including previous event's checksum.
        This creates a hash chain - if any event is tampered with,
        all subsequent checksums become invalid.
        """
        data = {
            "event_id": self.event_id,
            "timestamp": self.timestamp.isoformat(),
            "terminal_id": self.terminal_id,
            "event_type": self.event_type.value,
            "payload": self.payload,
            "previous_checksum": previous_checksum,
        }
        serialized = json.dumps(data, sort_keys=True, cls=_DecimalEncoder)
        return hashlib.sha256(serialized.encode()).hexdigest()


# =============================================================================
# EVENT FACTORY FUNCTIONS
# =============================================================================
# These ensure events are created with the correct structure

def create_event(
        event_type: EventType,
        terminal_id: str,
        payload: dict[str, Any],
        user_id: Optional[str] = None,
        user_role: Optional[str] = None,
        correlation_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        **kwargs,
) -> Event:
    """Create a new event with proper structure."""
    return Event(
        terminal_id=terminal_id,
        event_type=event_type,
        payload=payload,
        user_id=user_id,
        user_role=user_role,
        correlation_id=correlation_id,
        idempotency_key=idempotency_key,
    )


# -----------------------------------------------------------------------------
# Order Events
# -----------------------------------------------------------------------------

def order_created(
        terminal_id: str,
        order_id: str,
        table: str | int | None = None,
        server_id: Optional[str] = None,
        server_name: Optional[str] = None,
        guest_count: int = 1,
        customer_name: Optional[str] = None,
        check_number: Optional[str] = None,
        seat_numbers: Optional[list[int]] = None,
        **kwargs
) -> Event:
    """Create an ORDER_CREATED event."""
    # Accept and discard order_type kwarg from legacy callers; field has
    # been removed from the active schema but tests still pass it.
    kwargs.pop("order_type", None)
    payload = {
        "order_id": order_id,
        "check_number": check_number,
        "table": table,
        "server_id": server_id,
        "server_name": server_name,
        "guest_count": guest_count,
        "customer_name": customer_name,
    }
    if seat_numbers is not None:
        payload["seat_numbers"] = list(seat_numbers)
    return create_event(
        event_type=EventType.ORDER_CREATED,
        terminal_id=terminal_id,
        payload=payload,
        **kwargs
    )


def check_opened(
        terminal_id: str,
        order_id: str,
        check_number: Optional[str] = None,
        table: str | int | None = None,
        server_id: Optional[str] = None,
        server_name: Optional[str] = None,
        guest_count: int = 1,
        seat_numbers: Optional[list[int]] = None,
        **kwargs
) -> Event:
    """CHECK_OPENED: distinct anchor for the check timeline, emitted
    alongside ORDER_CREATED so downstream replayers can separate
    check-lifecycle moments (open / named / closed / voided) from the
    underlying order-lifecycle moments."""
    payload = {
        "order_id": order_id,
        "check_number": check_number,
        "table": table,
        "server_id": server_id,
        "server_name": server_name,
        "guest_count": guest_count,
    }
    if seat_numbers is not None:
        payload["seat_numbers"] = list(seat_numbers)
    return create_event(
        event_type=EventType.CHECK_OPENED,
        terminal_id=terminal_id,
        payload=payload,
        **kwargs,
    )


def order_transferred(
        terminal_id: str,
        order_id: str,
        server_id: str,
        server_name: str,
        **kwargs
) -> Event:
    """Create an ORDER_TRANSFERRED event (server reassignment)."""
    return create_event(
        event_type=EventType.ORDER_TRANSFERRED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "server_id": server_id,
            "server_name": server_name,
        },
        correlation_id=order_id,
        **kwargs
    )


def check_named(
        terminal_id: str,
        order_id: str,
        customer_name: str,
        **kwargs
) -> Event:
    """Create a CHECK_NAMED event (set/update customer name on a check)."""
    return create_event(
        event_type=EventType.CHECK_NAMED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "customer_name": customer_name,
        },
        correlation_id=order_id,
        **kwargs
    )


def guest_count_updated(
        terminal_id: str,
        order_id: str,
        guest_count: int,
        **kwargs
) -> Event:
    """Create a GUEST_COUNT_UPDATED event."""
    return create_event(
        event_type=EventType.GUEST_COUNT_UPDATED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "guest_count": guest_count,
        },
        correlation_id=order_id,
        **kwargs
    )


def seats_updated(
        terminal_id: str,
        order_id: str,
        seat_numbers: list[int],
        **kwargs
) -> Event:
    """Create a SEATS_UPDATED event — authoritative list of seats on the check.

    Unlike GUEST_COUNT_UPDATED (a scalar count), this event carries the
    actual seat numbers so seats can exist without any items attached
    (e.g. a server seats a party of 4 before ordering).
    """
    return create_event(
        event_type=EventType.SEATS_UPDATED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "seat_numbers": list(seat_numbers),
        },
        correlation_id=order_id,
        **kwargs
    )


def item_added(
        terminal_id: str,
        order_id: str,
        item_id: str,
        menu_item_id: str,
        name: str,
        price: Decimal,
        quantity: int = 1,
        category: Optional[str] = None,
        notes: Optional[str] = None,
        table: str | int | None = None,
        seat_number: Optional[int] = None,
        idempotency_key: Optional[str] = None,
        mandatory_selections: Optional[list[str]] = None,
        allergens: Optional[list[str]] = None,
        allergen_note: Optional[str] = None,
        included_removals: Optional[list[str]] = None,
        **kwargs,
) -> Event:
    """Create an ITEM_ADDED event."""
    payload = {
        "order_id": order_id,
        "item_id": item_id,
        "menu_item_id": menu_item_id,
        "name": name,
        "price": price,
        "quantity": quantity,
        "category": category,
        "notes": notes,
        "table": table,
        "seat_number": seat_number,
    }
    if mandatory_selections is not None:
        payload["mandatory_selections"] = list(mandatory_selections)
    if allergens is not None:
        payload["allergens"] = list(allergens)
    if allergen_note is not None:
        payload["allergen_note"] = allergen_note
    if included_removals is not None:
        payload["included_removals"] = list(included_removals)

    return create_event(
        event_type=EventType.ITEM_ADDED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        idempotency_key=idempotency_key,
        **kwargs,
    )


def item_sent(
        terminal_id: str,
        order_id: str,
        item_id: str,
        name: str,
        seat_number: Optional[int] = None,
        category: Optional[str] = None,
        sent_at: Optional[str] = None,
        **kwargs
) -> Event:
    """Create an ITEM_SENT event."""
    return create_event(
        event_type=EventType.ITEM_SENT,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "item_id": item_id,
            "name": name,
            "seat_number": seat_number,
            "category": category,
            "sent_at": sent_at or datetime.now(timezone.utc).isoformat(),
        },
        correlation_id=order_id,
        **kwargs
    )


def item_removed(
        terminal_id: str,
        order_id: str,
        item_id: str,
        reason: Optional[str] = None,
        voided_by: Optional[str] = None,
        **kwargs
) -> Event:
    """Create an ITEM_REMOVED event."""
    payload = {
        "order_id": order_id,
        "item_id": item_id,
        "reason": reason,
    }
    if voided_by is not None:
        payload["voided_by"] = voided_by
    return create_event(
        event_type=EventType.ITEM_REMOVED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs
    )


def item_modified(
        terminal_id: str,
        order_id: str,
        item_id: str,
        quantity: Optional[int] = None,
        price: Optional[Decimal] = None,
        notes: Optional[str] = None,
        seat_number: Optional[int] = None,
        **kwargs
) -> Event:
    """Create an ITEM_MODIFIED event."""
    payload = {
        "order_id": order_id,
        "item_id": item_id,
    }
    if quantity is not None:
        payload["quantity"] = quantity
    if price is not None:
        payload["price"] = price
    if notes is not None:
        payload["notes"] = notes
    if seat_number is not None:
        payload["seat_number"] = seat_number

    return create_event(
        event_type=EventType.ITEM_MODIFIED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs
    )


def modifier_applied(
        terminal_id: str,
        order_id: str,
        item_id: str,
        modifier_id: str,
        modifier_name: str,
        modifier_price: Decimal = Decimal("0.00"),
        action: str = "add",  # add, remove, replace
        prefix: str = None,
        half_price: Decimal = None,
        **kwargs
) -> Event:
    """Create a MODIFIER_APPLIED event."""
    payload = {
        "order_id": order_id,
        "item_id": item_id,
        "modifier_id": modifier_id,
        "modifier_name": modifier_name,
        "modifier_price": money_round(modifier_price),
        "action": action,
    }
    if prefix is not None:
        payload["prefix"] = prefix
    if half_price is not None:
        payload["half_price"] = money_round(half_price)
    return create_event(
        event_type=EventType.MODIFIER_APPLIED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs
    )


# -----------------------------------------------------------------------------
# Payment Events
# -----------------------------------------------------------------------------

def payment_initiated(
        terminal_id: str,
        order_id: str,
        payment_id: str,
        amount: Decimal,
        method: str,  # card, cash, gift_card
        seat_numbers: Optional[list[int]] = None,
        **kwargs
) -> Event:
    """Create a PAYMENT_INITIATED event."""
    payload = {
        "order_id": order_id,
        "payment_id": payment_id,
        "amount": amount,
        "method": method,
    }
    if seat_numbers:
        payload["seat_numbers"] = seat_numbers
    return create_event(
        event_type=EventType.PAYMENT_INITIATED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs
    )


def payment_confirmed(
        terminal_id: str,
        order_id: str,
        payment_id: str,
        transaction_id: str,
        amount: Decimal,
        tax: Decimal = Decimal("0.00"),
        seat_numbers: Optional[list[int]] = None,
        **kwargs
) -> Event:
    """Create a PAYMENT_CONFIRMED event.  Captures tax at payment time."""
    payload = {
        "order_id": order_id,
        "payment_id": payment_id,
        "transaction_id": transaction_id,
        "amount": amount,
        "tax": money_round(tax),
    }
    if seat_numbers:
        payload["seat_numbers"] = seat_numbers
    return create_event(
        event_type=EventType.PAYMENT_CONFIRMED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs
    )


def payment_failed(
        terminal_id: str,
        order_id: str,
        payment_id: str,
        error: str,
        error_code: Optional[str] = None,
        **kwargs
) -> Event:
    """Create a payment failure event (maps to PAYMENT_DECLINED)."""
    return create_event(
        event_type=EventType.PAYMENT_DECLINED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "payment_id": payment_id,
            "error": error,
            "error_code": error_code,
        },
        correlation_id=order_id,
        **kwargs
    )


# -----------------------------------------------------------------------------
# Order Completion Events
# -----------------------------------------------------------------------------

def order_closed(
        terminal_id: str,
        order_id: str,
        total: Decimal,
        **kwargs
) -> Event:
    """Create an ORDER_CLOSED event."""
    return create_event(
        event_type=EventType.ORDER_CLOSED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "total": money_round(total),
        },
        correlation_id=order_id,
        **kwargs
    )


def order_reopened(
        terminal_id: str,
        order_id: str,
        **kwargs
) -> Event:
    """Create an ORDER_REOPENED event."""
    return create_event(
        event_type=EventType.ORDER_REOPENED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
        },
        correlation_id=order_id,
        **kwargs
    )


def check_abandoned(
        terminal_id: str,
        order_id: str,
        reason: str = "User exited empty order",
        **kwargs
) -> Event:
    """Create a CHECK_ABANDONED event."""
    return create_event(
        event_type=EventType.CHECK_ABANDONED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "reason": reason,
        },
        correlation_id=order_id,
        **kwargs
    )


def order_voided(
        terminal_id: str,
        order_id: str,
        reason: str,
        approved_by: Optional[str] = None,
        **kwargs
) -> Event:
    """Create an ORDER_VOIDED event."""
    return create_event(
        event_type=EventType.ORDER_VOIDED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "reason": reason,
            "approved_by": approved_by,
        },
        correlation_id=order_id,
        **kwargs
    )


def check_split(
        terminal_id: str,
        order_id: str,
        *,
        operation_id: str,
        role: str,
        parent_order_id: str,
        child_order_ids: list[str],
        seat: Optional[int] = None,
        **kwargs,
) -> Event:
    """Create a CHECK_SPLIT audit event.

    Emitted once per order involved in a split-by-seat operation: once on
    the parent (role="parent") and once on each child (role="child"). All
    emissions share the same operation_id so the full operation can be
    reassembled across timelines.
    """
    payload = {
        "operation_id": operation_id,
        "role": role,
        "parent_order_id": parent_order_id,
        "child_order_ids": list(child_order_ids),
    }
    if seat is not None:
        payload["seat"] = seat
    return create_event(
        event_type=EventType.CHECK_SPLIT,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs,
    )


def check_merged(
        terminal_id: str,
        order_id: str,
        *,
        operation_id: str,
        role: str,
        target_order_id: str,
        source_order_ids: list[str],
        approved_by: Optional[str] = None,
        **kwargs,
) -> Event:
    """Create a CHECK_MERGED audit event.

    Emitted once per order involved in a merge: once on the target
    (role="target") and once on each source (role="source"). Sources emit
    BEFORE the subsequent ORDER_VOIDED so each source timeline stays
    monotone: alive → merged → voided.
    """
    return create_event(
        event_type=EventType.CHECK_MERGED,
        terminal_id=terminal_id,
        payload={
            "operation_id": operation_id,
            "role": role,
            "target_order_id": target_order_id,
            "source_order_ids": list(source_order_ids),
            "approved_by": approved_by,
        },
        correlation_id=order_id,
        **kwargs,
    )


# -----------------------------------------------------------------------------
# Print Events
# -----------------------------------------------------------------------------

def ticket_printed(
        terminal_id: str,
        order_id: str,
        printer_id: str,
        printer_name: str,
        ticket_type: str = "kitchen",  # kitchen, bar, receipt
        **kwargs
) -> Event:
    """Create a TICKET_PRINTED event."""
    return create_event(
        event_type=EventType.TICKET_PRINTED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "printer_id": printer_id,
            "printer_name": printer_name,
            "ticket_type": ticket_type,
        },
        correlation_id=order_id,
        **kwargs
    )


def ticket_print_failed(
        terminal_id: str,
        order_id: str,
        printer_id: str,
        error: str,
        will_retry: bool = True,
        **kwargs
) -> Event:
    """Create a TICKET_PRINT_FAILED event."""
    return create_event(
        event_type=EventType.TICKET_PRINT_FAILED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "printer_id": printer_id,
            "error": error,
            "will_retry": will_retry,
        },
        correlation_id=order_id,
        **kwargs
    )


def ticket_reprinted(
        terminal_id: str,
        order_id: str,
        printer_id: str,
        printer_name: str,
        original_job_id: str,
        reason: str = "",
        requested_by: Optional[str] = None,
        ticket_type: str = "kitchen",
        **kwargs
) -> Event:
    """
    Create a TICKET_REPRINTED event.
    Deliberate reprint by staff — distinct from accidental double-print.
    References the original job_id for audit trail.
    """
    return create_event(
        event_type=EventType.TICKET_REPRINTED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "printer_id": printer_id,
            "printer_name": printer_name,
            "original_job_id": original_job_id,
            "reason": reason,
            "requested_by": requested_by,
            "ticket_type": ticket_type,
        },
        correlation_id=order_id,
        **kwargs
    )


def print_retrying(
        terminal_id: str,
        order_id: str,
        printer_id: str,
        job_id: str,
        retry_count: int,
        error: str,
        **kwargs
) -> Event:
    """
    Create a PRINT_RETRYING event.
    Silent retry — staff doesn't see this, but the ledger records it.
    """
    return create_event(
        event_type=EventType.PRINT_RETRYING,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "printer_id": printer_id,
            "job_id": job_id,
            "retry_count": retry_count,
            "error": error,
        },
        correlation_id=order_id,
        **kwargs
    )


def print_rerouted(
        terminal_id: str,
        order_id: str,
        job_id: str,
        original_printer_id: str,
        original_printer_name: str,
        rerouted_to_printer_id: str,
        rerouted_to_printer_name: str,
        reason: str,
        fallback_tier: str = "designated",  # "designated", "same_type", "emergency"
        **kwargs
) -> Event:
    """
    Create a PRINT_REROUTED event.
    Job was sent to a fallback printer because the primary failed.

    fallback_tier indicates which level of the fallback hierarchy was used:
        - "designated": Operator-assigned backup printer
        - "same_type": Nearest printer of same type (impact/thermal) and role
        - "emergency": Any available printer of matching role (last resort)
    """
    return create_event(
        event_type=EventType.PRINT_REROUTED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "job_id": job_id,
            "original_printer_id": original_printer_id,
            "original_printer_name": original_printer_name,
            "rerouted_to_printer_id": rerouted_to_printer_id,
            "rerouted_to_printer_name": rerouted_to_printer_name,
            "reason": reason,
            "fallback_tier": fallback_tier,
        },
        correlation_id=order_id,
        **kwargs
    )


# -----------------------------------------------------------------------------
# Printer Lifecycle Events
# -----------------------------------------------------------------------------

def printer_registered(
        terminal_id: str,
        printer_id: str,
        printer_name: str,
        printer_type: str,
        connection_string: str,
        role: str = "kitchen",
        discovered_via: str = "manual",  # "manual", "mdns", "usb"
        **kwargs
) -> Event:
    """
    Create a PRINTER_REGISTERED event.
    Fired when a new printer is discovered or manually added during setup.
    """
    return create_event(
        event_type=EventType.PRINTER_REGISTERED,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "printer_name": printer_name,
            "printer_type": printer_type,
            "connection_string": connection_string,
            "role": role,
            "discovered_via": discovered_via,
        },
        **kwargs
    )


def printer_configured(
        terminal_id: str,
        mac: str,
        ip: str,
        printer_type: str,
        name: str,
        categories: Optional[list[str]] = None,
        configured_by: Optional[str] = None,
        **kwargs
) -> Event:
    """PRINTER_CONFIGURED: emitted when a new printer is saved through
    the hardware-admin endpoint. Distinct from PRINTER_REGISTERED,
    which is emitted by PrinterManager at startup when the device
    already exists in hardware_config.db."""
    payload = {
        "mac": mac.upper(),
        "ip": ip,
        "printer_type": printer_type,
        "name": name,
    }
    if categories:
        payload["categories"] = list(categories)
    if configured_by is not None:
        payload["configured_by"] = configured_by
    return create_event(
        event_type=EventType.PRINTER_CONFIGURED,
        terminal_id=terminal_id,
        payload=payload,
        **kwargs,
    )


def printer_removed(
        terminal_id: str,
        mac: str,
        name: Optional[str] = None,
        printer_type: Optional[str] = None,
        removed_by: Optional[str] = None,
        **kwargs
) -> Event:
    """PRINTER_REMOVED: emitted when a printer is deleted from
    hardware_config.db via the hardware-admin endpoint."""
    payload = {"mac": mac.upper()}
    if name is not None:
        payload["name"] = name
    if printer_type is not None:
        payload["printer_type"] = printer_type
    if removed_by is not None:
        payload["removed_by"] = removed_by
    return create_event(
        event_type=EventType.PRINTER_REMOVED,
        terminal_id=terminal_id,
        payload=payload,
        **kwargs,
    )


def printer_assignment_changed(
        terminal_id: str,
        mac: str,
        previous_categories: list[str],
        new_categories: list[str],
        changed_by: Optional[str] = None,
        **kwargs
) -> Event:
    """PRINTER_ASSIGNMENT_CHANGED: emitted when a kitchen printer's
    assigned category list changes, so routing changes ('why did this
    ticket print at bar?') are auditable from the ledger alone."""
    payload = {
        "mac": mac.upper(),
        "previous_categories": list(previous_categories),
        "new_categories": list(new_categories),
    }
    if changed_by is not None:
        payload["changed_by"] = changed_by
    return create_event(
        event_type=EventType.PRINTER_ASSIGNMENT_CHANGED,
        terminal_id=terminal_id,
        payload=payload,
        **kwargs,
    )


def payment_processor_configured(
        terminal_id: str,
        mac: str,
        ip: str,
        name: str,
        register_id: str = "",
        configured_by: Optional[str] = None,
        **kwargs
) -> Event:
    """PAYMENT_PROCESSOR_CONFIGURED: emitted when a card reader is
    saved via the hardware-admin endpoint. Critical for PCI/SOX audit
    -- processor credential changes (register_id, TPN, auth key)
    previously landed in hardware_config.db only, invisible to the
    event ledger. Payload deliberately excludes tpn and auth_key; the
    event is an audit anchor, not a credential store."""
    payload = {
        "mac": mac.upper(),
        "ip": ip,
        "name": name,
    }
    if register_id:
        payload["register_id"] = register_id
    if configured_by is not None:
        payload["configured_by"] = configured_by
    return create_event(
        event_type=EventType.PAYMENT_PROCESSOR_CONFIGURED,
        terminal_id=terminal_id,
        payload=payload,
        **kwargs,
    )


def printer_status_changed(
        terminal_id: str,
        printer_id: str,
        printer_name: str,
        previous_status: str,
        new_status: str,
        reason: Optional[str] = None,
        **kwargs
) -> Event:
    """
    Create a PRINTER_STATUS_CHANGED event.
    Tracks every status transition for diagnostics and audit.
    """
    return create_event(
        event_type=EventType.PRINTER_STATUS_CHANGED,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "printer_name": printer_name,
            "previous_status": previous_status,
            "new_status": new_status,
            "reason": reason,
        },
        **kwargs
    )


def printer_error(
        terminal_id: str,
        printer_id: str,
        printer_name: str,
        error: str,
        error_code: Optional[str] = None,
        requires_attention: bool = True,
        **kwargs
) -> Event:
    """
    Create a PRINTER_ERROR event.
    Persistent error that couldn't be resolved by retries.
    If requires_attention is True, this triggers a manager alert.
    """
    return create_event(
        event_type=EventType.PRINTER_ERROR,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "printer_name": printer_name,
            "error": error,
            "error_code": error_code,
            "requires_attention": requires_attention,
        },
        **kwargs
    )


# -----------------------------------------------------------------------------
# Printer Configuration Events
# -----------------------------------------------------------------------------

def printer_role_created(
        terminal_id: str,
        role_name: str,
        created_by: Optional[str] = None,
        **kwargs
) -> Event:
    """
    Create a PRINTER_ROLE_CREATED event.
    Fired when an operator creates a custom role like "Pizza Station" or "Patio Bar".
    """
    return create_event(
        event_type=EventType.PRINTER_ROLE_CREATED,
        terminal_id=terminal_id,
        payload={
            "role_name": role_name,
            "created_by": created_by,
        },
        **kwargs
    )


def printer_fallback_assigned(
        terminal_id: str,
        printer_id: str,
        printer_name: str,
        fallback_printer_id: str,
        fallback_printer_name: str,
        **kwargs
) -> Event:
    """
    Create a PRINTER_FALLBACK_ASSIGNED event.
    Operator designates a specific backup printer.
    """
    return create_event(
        event_type=EventType.PRINTER_FALLBACK_ASSIGNED,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "printer_name": printer_name,
            "fallback_printer_id": fallback_printer_id,
            "fallback_printer_name": fallback_printer_name,
        },
        **kwargs
    )


# -----------------------------------------------------------------------------
# Printer Maintenance Events
# -----------------------------------------------------------------------------

def printer_reboot_started(
        terminal_id: str,
        printer_id: str,
        printer_name: str,
        reason: str = "scheduled_maintenance",
        **kwargs
) -> Event:
    """
    Create a PRINTER_REBOOT_STARTED event.
    Silent reboot during off-hours to preserve print head life.
    """
    return create_event(
        event_type=EventType.PRINTER_REBOOT_STARTED,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "printer_name": printer_name,
            "reason": reason,
        },
        **kwargs
    )


def printer_reboot_completed(
        terminal_id: str,
        printer_id: str,
        printer_name: str,
        duration_seconds: Optional[float] = None,
        **kwargs
) -> Event:
    """Create a PRINTER_REBOOT_COMPLETED event."""
    return create_event(
        event_type=EventType.PRINTER_REBOOT_COMPLETED,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "printer_name": printer_name,
            "duration_seconds": duration_seconds,
        },
        **kwargs
    )


def printer_health_warning(
        terminal_id: str,
        printer_id: str,
        printer_name: str,
        warning_type: str,
        details: Optional[str] = None,
        **kwargs
) -> Event:
    """
    Create a PRINTER_HEALTH_WARNING event.
    Proactive alert before a failure happens.
    """
    return create_event(
        event_type=EventType.PRINTER_HEALTH_WARNING,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "printer_name": printer_name,
            "warning_type": warning_type,
            "details": details,
        },
        **kwargs
    )


# -----------------------------------------------------------------------------
# Print Queue & Advanced Printing Events
# -----------------------------------------------------------------------------

def drawer_opened(
        terminal_id: str,
        printer_id: str,
        reason: str = "payment",  # "payment", "manual", "start_of_day"
        opened_by: Optional[str] = None,
        **kwargs
) -> Event:
    """
    Create a DRAWER_OPENED event.
    Cash drawers typically kick through the printer's DK port.
    Every open is logged — accountability matters.
    """
    return create_event(
        event_type=EventType.DRAWER_OPENED,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "reason": reason,
            "opened_by": opened_by,
        },
        **kwargs
    )


# -----------------------------------------------------------------------------
# Staff / Clock Events
# -----------------------------------------------------------------------------

def user_logged_in(
        terminal_id: str,
        employee_id: str,
        employee_name: str,
        role: str = "",
        pool_memberships: list = None,
        **kwargs
) -> Event:
    """Create a USER_LOGGED_IN event (clock in)."""
    return create_event(
        event_type=EventType.USER_LOGGED_IN,
        terminal_id=terminal_id,
        payload={
            "employee_id": employee_id,
            "employee_name": employee_name,
            "role": role,
            "pool_memberships": pool_memberships or [],
        },
        user_id=employee_id,
        **kwargs
    )


def user_logged_out(
        terminal_id: str,
        employee_id: str,
        employee_name: str,
        **kwargs
) -> Event:
    """Create a USER_LOGGED_OUT event (clock out)."""
    return create_event(
        event_type=EventType.USER_LOGGED_OUT,
        terminal_id=terminal_id,
        payload={
            "employee_id": employee_id,
            "employee_name": employee_name,
        },
        user_id=employee_id,
        **kwargs
    )


# -----------------------------------------------------------------------------
# Tip Adjustment Events
# -----------------------------------------------------------------------------

def tip_adjusted(
        terminal_id: str,
        order_id: str,
        payment_id: str,
        tip_amount: Decimal,
        previous_tip: Decimal = Decimal("0.00"),
        adjusted_by: Optional[str] = None,
        **kwargs
) -> Event:
    """Create a TIP_ADJUSTED event for post-payment tip adjustment."""
    payload = {
        "order_id": order_id,
        "payment_id": payment_id,
        "tip_amount": money_round(tip_amount),
        "previous_tip": money_round(previous_tip),
    }
    if adjusted_by is not None:
        payload["adjusted_by"] = adjusted_by
    return create_event(
        event_type=EventType.TIP_ADJUSTED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs
    )


def cash_refund_due(
        terminal_id: str,
        order_id: str,
        payment_id: str,
        amount: Decimal,
        reason: str = "Order voided after cash payment",
        **kwargs
) -> Event:
    """Create a PAYMENT_REFUNDED event for cash that must be returned."""
    return create_event(
        event_type=EventType.PAYMENT_REFUNDED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "payment_id": payment_id,
            "amount": money_round(amount),
            "method": "cash",
            "reason": reason,
        },
        correlation_id=order_id,
        **kwargs
    )


def seat_paid(
        terminal_id: str,
        order_id: str,
        seat_number: int,
        **kwargs
) -> Event:
    """SEAT_PAID: audit marker emitted when a seat's share of an order's
    balance is fully settled. Currently emitted for every seat on the
    order at auto-close (when the whole order's balance reaches zero);
    a future per-seat-balance projection can emit progressively as
    individual seats are paid off during split-check flows."""
    return create_event(
        event_type=EventType.SEAT_PAID,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "seat_number": seat_number,
        },
        correlation_id=order_id,
        **kwargs,
    )


def seat_tip_added(
        terminal_id: str,
        order_id: str,
        payment_id: str,
        tip_amount: Decimal,
        added_by: Optional[str] = None,
        **kwargs
) -> Event:
    """SEAT_TIP_ADDED: first-tip marker emitted alongside the
    tip_adjusted event when previous_tip == 0. Separating the initial
    tip entry from subsequent adjustments lets reporting distinguish
    "server entered the signed receipt tip" from "manager overrode
    the tip later."
    """
    return create_event(
        event_type=EventType.SEAT_TIP_ADDED,
        terminal_id=terminal_id,
        payload={
            "order_id": order_id,
            "payment_id": payment_id,
            "tip_amount": money_round(tip_amount),
            **({"added_by": added_by} if added_by is not None else {}),
        },
        correlation_id=order_id,
        **kwargs,
    )


def seat_overpayment_resolved(
        terminal_id: str,
        order_id: str,
        amount: Decimal,
        resolution: str,  # "change" | "tip" | "credit"
        payment_id: Optional[str] = None,
        **kwargs
) -> Event:
    """SEAT_OVERPAYMENT_RESOLVED: emitted when a payment's amount
    exceeded the remaining balance and the excess was resolved one of
    three ways: cash change back to the customer, an automatic tip on
    a credit-card overage, or a house credit.
    """
    payload = {
        "order_id": order_id,
        "amount": money_round(amount),
        "resolution": resolution,
    }
    if payment_id is not None:
        payload["payment_id"] = payment_id
    return create_event(
        event_type=EventType.SEAT_OVERPAYMENT_RESOLVED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs,
    )


def discount_voided(
        terminal_id: str,
        order_id: str,
        amount: Decimal,
        voided_by: str,
        discount_type: Optional[str] = None,
        discount_id: Optional[str] = None,
        reason: Optional[str] = None,
        **kwargs
) -> Event:
    """DISCOUNT_VOIDED: emitted when a previously-applied discount is
    removed from an order. Amount is the (positive) dollar value
    being reversed; the projection re-adds it to order.total."""
    payload = {
        "order_id": order_id,
        "amount": money_round(amount),
        "voided_by": voided_by,
    }
    if discount_type is not None:
        payload["discount_type"] = discount_type
    if discount_id is not None:
        payload["discount_id"] = discount_id
    if reason is not None:
        payload["reason"] = reason
    return create_event(
        event_type=EventType.DISCOUNT_VOIDED,
        terminal_id=terminal_id,
        payload=payload,
        correlation_id=order_id,
        **kwargs,
    )


def cash_tips_declared(
        terminal_id: str,
        server_id: str,
        amount: Decimal,
        **kwargs
) -> Event:
    """Record a server's declared cash tips at checkout (optional, self-reported)."""
    return create_event(
        event_type=EventType.CASH_TIPS_DECLARED,
        terminal_id=terminal_id,
        payload={
            "server_id": server_id,
            "amount": money_round(amount),
        },
        **kwargs
    )


def drawer_open_failed(
        terminal_id: str,
        printer_id: str,
        error: str,
        **kwargs
) -> Event:
    """Create a DRAWER_OPEN_FAILED event."""
    return create_event(
        event_type=EventType.DRAWER_OPEN_FAILED,
        terminal_id=terminal_id,
        payload={
            "printer_id": printer_id,
            "error": error,
        },
        **kwargs
    )


def batch_submitted(
        terminal_id: str,
        order_count: int,
        total_amount: Decimal,
        cash_total: Decimal,
        card_total: Decimal,
        order_ids: list[str],
        **kwargs
) -> Event:
    """Create a BATCH_SUBMITTED event for batch settlement."""
    return create_event(
        event_type=EventType.BATCH_SUBMITTED,
        terminal_id=terminal_id,
        payload={
            "order_count": order_count,
            "total_amount": money_round(total_amount),
            "cash_total": money_round(cash_total),
            "card_total": money_round(card_total),
            "order_ids": order_ids,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        },
        **kwargs
    )


def day_opened(
        terminal_id: str,
        date: str,
        **kwargs
) -> Event:
    """DAY_OPENED: anchors the start of a business day. Emitted exactly
    once per day as the first ledger write after the previous
    DAY_CLOSED (or on a cold ledger)."""
    return create_event(
        event_type=EventType.DAY_OPENED,
        terminal_id=terminal_id,
        payload={"date": date},
        **kwargs,
    )


def day_closed(
        terminal_id: str,
        date: str,
        total_orders: int,
        total_sales: Decimal,
        total_tips: Decimal,
        cash_total: Decimal,
        card_total: Decimal,
        order_ids: list[str],
        payment_count: int,
        opened_at: str | None = None,
        **kwargs
) -> Event:
    """Create a DAY_CLOSED event with full auditable day summary."""
    return create_event(
        event_type=EventType.DAY_CLOSED,
        terminal_id=terminal_id,
        payload={
            "date": date,
            "total_orders": total_orders,
            "total_sales": money_round(total_sales),
            "total_tips": money_round(total_tips),
            "cash_total": money_round(cash_total),
            "card_total": money_round(card_total),
            "order_ids": order_ids,
            "payment_count": payment_count,
            "opened_at": opened_at,
            "closed_at": datetime.now(timezone.utc).isoformat(),
        },
        **kwargs
    )