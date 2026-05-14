"""
Tests for app.core.projections.project_order()

Verifies order state is correctly rebuilt from event sequences.
All tests pass tax_rate=0.07 explicitly to avoid config dependency.
"""

import pytest
from decimal import Decimal
from app.core.events import (
    EventType,
    create_event,
    order_created,
    item_added,
    item_removed,
    item_modified,
    modifier_applied,
    item_sent,
    payment_initiated,
    payment_confirmed,
    order_closed,
    order_reopened,
    order_voided,
)
from app.core.projections import project_order, project_orders, Order
from app.core.money import money_round

TAX_RATE = Decimal("0.07")
ORDER_ID = "order-test-001"
TERMINAL = "T1"


def _create_order_event():
    return order_created(
        terminal_id=TERMINAL,
        order_id=ORDER_ID,
        table="T-5",
        server_id="srv-1",
        server_name="Alice",
        order_type="dine_in",
        guest_count=2,
    )


def _add_item(item_id="item-1", name="Burger", price=Decimal("10.00"), quantity=1):
    return item_added(
        terminal_id=TERMINAL,
        order_id=ORDER_ID,
        item_id=item_id,
        menu_item_id=f"menu-{item_id}",
        name=name,
        price=price,
        quantity=quantity,
    )


class TestProjectOrder:

    def test_empty_events_returns_none(self):
        assert project_order([]) is None

    def test_order_created_basic(self):
        events = [_create_order_event()]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order is not None
        assert order.order_id == ORDER_ID
        assert order.table == "T-5"
        assert order.server_id == "srv-1"
        assert order.server_name == "Alice"
        assert order.status == "open"
        assert order.guest_count == 2

    def test_item_added_subtotal(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            _add_item("item-2", "Fries", 5.50),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.subtotal == Decimal("15.50")
        assert len(order.items) == 2

    def test_item_removed(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            item_removed(terminal_id=TERMINAL, order_id=ORDER_ID, item_id="item-1"),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert len(order.items) == 0

    def test_item_modified_quantity(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            item_modified(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                item_id="item-1",
                quantity=3,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.items[0].quantity == 3
        # subtotal = 10.00 * 3 = 30.00
        assert order.subtotal == Decimal("30.00")

    def test_modifier_applied(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            modifier_applied(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                item_id="item-1",
                modifier_id="mod-1",
                modifier_name="Extra Cheese",
                modifier_price=1.50,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        # subtotal = (10.00 + 1.50) * 1 = 11.50
        assert order.subtotal == Decimal("11.50")
        assert len(order.items[0].modifiers) == 1

    def test_modifier_removed(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            modifier_applied(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                item_id="item-1",
                modifier_id="mod-1",
                modifier_name="Extra Cheese",
                modifier_price=1.50,
            ),
            modifier_applied(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                item_id="item-1",
                modifier_id="mod-1",
                modifier_name="Extra Cheese",
                modifier_price=1.50,
                action="remove",
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert len(order.items[0].modifiers) == 0
        assert order.subtotal == Decimal("10.00")

    def test_payment_initiated_and_confirmed(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            payment_initiated(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                payment_id="p1",
                amount=10.70,
                method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                payment_id="p1",
                transaction_id="txn-1",
                amount=10.70,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert len(order.payments) == 1
        assert order.payments[0].status == "confirmed"
        assert order.amount_paid == Decimal("10.70")
        assert order.is_fully_paid

    def test_payment_failed_status(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            payment_initiated(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                payment_id="p1",
                amount=10.70,
                method="card",
            ),
            create_event(
                event_type=EventType.PAYMENT_DECLINED,
                terminal_id=TERMINAL,
                payload={"payment_id": "p1", "error": "declined"},
                correlation_id=ORDER_ID,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.payments[0].status == "failed"
        assert order.payments[0].error == "declined"

    def test_order_closed_status(self):
        events = [
            _create_order_event(),
            order_closed(terminal_id=TERMINAL, order_id=ORDER_ID, total=Decimal("0.00")),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.status == "closed"
        assert order.closed_at is not None

    def test_order_reopened(self):
        events = [
            _create_order_event(),
            order_closed(terminal_id=TERMINAL, order_id=ORDER_ID, total=Decimal("0.00")),
            order_reopened(terminal_id=TERMINAL, order_id=ORDER_ID),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.status == "open"
        assert order.closed_at is None

    def test_order_voided(self):
        events = [
            _create_order_event(),
            order_voided(
                terminal_id=TERMINAL,
                order_id=ORDER_ID,
                reason="customer complaint",
                approved_by="mgr",
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.status == "voided"
        assert order.void_reason == "customer complaint"
        assert order.voided_at is not None

    def test_discount_applied(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Steak", 50.00),
            create_event(
                event_type=EventType.DISCOUNT_APPROVED,
                terminal_id=TERMINAL,
                payload={
                    "discount_type": "comp",
                    "amount": 5.00,
                    "reason": "manager comp",
                    "approved_by": "mgr-1",
                },
                correlation_id=ORDER_ID,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.discount_total == Decimal("5.00")
        # tax should be on (50.00 - 5.00) = 45.00 * 0.07 = 3.15
        assert order.tax == money_round(Decimal("45.00") * TAX_RATE)
        # total = 50.00 - 5.00 + 3.15 = 48.15
        assert order.total == money_round(Decimal("50.00") - Decimal("5.00") + Decimal("45.00") * TAX_RATE)

    def test_split_payment_balance_due(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Steak", 50.00),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=20.00, method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn-1", amount=20.00,
            ),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p2", amount=10.00, method="cash",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p2", transaction_id="txn-2", amount=10.00,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.amount_paid == Decimal("30.00")
        expected_total = money_round(Decimal("50.00") + Decimal("50.00") * TAX_RATE)
        assert order.balance_due == money_round(expected_total - Decimal("30.00"))

    def test_fully_paid_auto_status(self):
        # When confirmed payments >= total, status should become "paid"
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
        ]
        order_preview = project_order(events, tax_rate=TAX_RATE)
        full_amount = order_preview.total

        events.extend([
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=full_amount, method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn-1", amount=full_amount,
            ),
        ])
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.status == "paid"
        assert order.is_fully_paid

    def test_tip_adjusted(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=10.70, method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn-1", amount=10.70,
            ),
            create_event(
                event_type=EventType.TIP_ADJUSTED,
                terminal_id=TERMINAL,
                payload={
                    "payment_id": "p1",
                    "tip_amount": Decimal("5.00"),
                    "previous_tip": Decimal("0.00"),
                },
                correlation_id=ORDER_ID,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.payments[0].tip_amount == Decimal("5.00")

    def test_unknown_event_type_ignored(self):
        # An event with an unrecognized type should not crash projection
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            create_event(
                event_type=EventType.USER_LOGGED_IN,
                terminal_id=TERMINAL,
                payload={"user": "someone"},
                correlation_id=ORDER_ID,
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order is not None
        assert len(order.items) == 1

    def test_tax_rate_override(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
        ]
        order = project_order(events, tax_rate=Decimal("0.10"))
        # tax = 10.00 * 0.10 = 1.00
        assert order.tax == Decimal("1.00")
        # total = 10.00 + 1.00 = 11.00
        assert order.total == Decimal("11.00")


# ───────────────────────────────────────────────────────────────────────────
# Tier-1 Fix 2 — service_charge_amount / cash_discount_amount payload wiring
# ───────────────────────────────────────────────────────────────────────────

def _confirm_payment_with_extras(
    payment_id="p1",
    amount=Decimal("10.00"),
    tax=Decimal("0.00"),
    service_charge_amount=None,
    cash_discount_amount=None,
):
    """PAYMENT_CONFIRMED via raw create_event so we can stuff payload keys
    the high-level factory does not currently surface."""
    payload = {
        "order_id": ORDER_ID,
        "payment_id": payment_id,
        "transaction_id": f"txn_{payment_id}",
        "amount": amount,
        "tax": tax,
    }
    if service_charge_amount is not None:
        payload["service_charge_amount"] = service_charge_amount
    if cash_discount_amount is not None:
        payload["cash_discount_amount"] = cash_discount_amount
    return create_event(
        event_type=EventType.PAYMENT_CONFIRMED,
        terminal_id=TERMINAL,
        payload=payload,
        correlation_id=ORDER_ID,
    )


class TestPaymentExtraFields:

    def test_service_charge_amount_propagates_from_payload(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Steak", Decimal("50.00")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=Decimal("50.00"), method="card",
            ),
            _confirm_payment_with_extras(
                amount=Decimal("50.00"),
                service_charge_amount=Decimal("2.50"),
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.payments[0].service_charge_amount == Decimal("2.50")
        assert order.surcharge_total == Decimal("2.50")

    def test_cash_discount_amount_propagates_from_payload(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Steak", Decimal("50.00")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=Decimal("50.00"), method="cash",
            ),
            _confirm_payment_with_extras(
                amount=Decimal("50.00"),
                cash_discount_amount=Decimal("1.50"),
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.payments[0].cash_discount_amount == Decimal("1.50")
        assert order.cash_discount_total == Decimal("1.50")

    def test_missing_extras_default_to_zero(self):
        """Backwards-compat: payload without the new keys keeps totals at 0."""
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=Decimal("10.00"), method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn1",
                amount=Decimal("10.00"),
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.payments[0].service_charge_amount == Decimal("0.00")
        assert order.payments[0].cash_discount_amount == Decimal("0.00")
        assert order.surcharge_total == Decimal("0.00")
        assert order.cash_discount_total == Decimal("0.00")


# ───────────────────────────────────────────────────────────────────────────
# Tier-1 Fix 3 — balance_due clamping + overpayment property
# ───────────────────────────────────────────────────────────────────────────

class TestBalanceDueAndOverpayment:

    def test_unpaid_order_has_zero_overpayment_and_positive_balance(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        # subtotal=10.00, tax=0.70, total=10.70, paid=0 → balance=10.70, overpay=0
        assert order.balance_due == Decimal("10.70")
        assert order.overpayment == Decimal("0.00")

    def test_exact_payment_zero_balance_zero_overpayment(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=Decimal("10.70"), method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn1",
                amount=Decimal("10.70"),
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        assert order.balance_due == Decimal("0.00")
        assert order.overpayment == Decimal("0.00")

    def test_underpayment_positive_balance_zero_overpayment(self):
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("10.00")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=Decimal("5.00"), method="cash",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn1",
                amount=Decimal("5.00"),
            ),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        # total = 10.70, paid = 5.00 → balance = 5.70, overpay = 0
        assert order.balance_due == Decimal("5.70")
        assert order.overpayment == Decimal("0.00")

    def test_item_removed_after_close_clamps_balance_signals_overpayment(self):
        """Sequence A from the audit: void after payment+close. balance_due
        must clamp to zero and overpayment must equal the paid amount."""
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("12.99")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=Decimal("13.90"), method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn1",
                amount=Decimal("13.90"),
            ),
            order_closed(terminal_id=TERMINAL, order_id=ORDER_ID, total=Decimal("13.90")),
            item_removed(terminal_id=TERMINAL, order_id=ORDER_ID, item_id="item-1"),
        ]
        order = project_order(events, tax_rate=TAX_RATE)
        # After the void, subtotal=0, tax falls back to computed=0 (no captured tax),
        # total=0, amount_paid=13.90 → balance clamps to 0, overpayment = 13.90.
        assert order.balance_due == Decimal("0.00")
        assert order.overpayment == Decimal("13.90")

    def test_item_removed_after_close_emits_fin009_warning(self, caplog):
        """The projection must log FIN-009 when overpayment > 0."""
        import logging
        caplog.set_level(logging.WARNING, logger="app.core.projections")
        events = [
            _create_order_event(),
            _add_item("item-1", "Burger", Decimal("12.99")),
            payment_initiated(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", amount=Decimal("13.90"), method="card",
            ),
            payment_confirmed(
                terminal_id=TERMINAL, order_id=ORDER_ID,
                payment_id="p1", transaction_id="txn1",
                amount=Decimal("13.90"),
            ),
            order_closed(terminal_id=TERMINAL, order_id=ORDER_ID, total=Decimal("13.90")),
            item_removed(terminal_id=TERMINAL, order_id=ORDER_ID, item_id="item-1"),
        ]
        project_order(events, tax_rate=TAX_RATE)
        assert any("FIN-009" in rec.message for rec in caplog.records), (
            "FIN-009 warning must fire when overpayment > 0"
        )
