"""
Tests for tax calculation edge cases in `app/core/projections.py`.

The existing suite covers basic 7% tax and flat-discount reduction.
This file closes the gap on:
  - Event-sourced tax from confirmed payment overrides computed tax
  - Tax is computed on net subtotal (after discounts), not gross
  - Modifier price added to item increases taxable base
  - Zero subtotal yields zero tax (never negative)
  - Tax rate override via project_order(tax_rate=...)
  - Multiple payments: only confirmed payments contribute captured tax
  - Precision: tax rounds half-up to 2 dp per money_round rules
"""

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio

from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    create_event,
    item_added,
    modifier_applied,
    order_closed,
    order_created,
    payment_confirmed,
    payment_initiated,
)
from app.core.projections import project_order


TEST_DB = Path("./data/test_tax_calculation.db")
TERMINAL = "terminal_tax"


@pytest.fixture(autouse=True)
def _set_tax_rate(monkeypatch):
    monkeypatch.setattr(settings, "tax_rate", 0.07)
    monkeypatch.setattr(settings, "cash_discount_rate", 0.0)


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


# ── helpers ─────────────────────────────────────────────────────────────────

async def _seed_order(ledger, *, order_id: str, price: float) -> None:
    """Seed ORDER_CREATED + ITEM_ADDED."""
    await ledger.append(order_created(
        terminal_id=TERMINAL,
        order_id=order_id,
        order_type="dine_in",
        guest_count=1,
        server_id="s1",
        correlation_id=order_id,
    ))
    await ledger.append(item_added(
        terminal_id=TERMINAL,
        order_id=order_id,
        item_id=f"{order_id}_item",
        menu_item_id="menu_item_1",
        name="Steak",
        price=price,
        quantity=1,
    ))


async def _get_order(ledger, order_id: str):
    events = await ledger.get_events_by_correlation(order_id)
    return project_order(events)


# ═══════════════════════════════════════════════════════════════════════════
# Computed tax (no confirmed payment)
# ═══════════════════════════════════════════════════════════════════════════

class TestComputedTax:

    async def test_basic_computed_tax(self, ledger):
        """$100 item × 7% = $7.00 tax when no payment captured."""
        await _seed_order(ledger, order_id="t_basic", price=100.00)
        order = await _get_order(ledger, "t_basic")
        assert order.tax == Decimal("7.00")

    async def test_tax_on_fractional_price(self, ledger):
        """$14.99 × 7% = $1.05 (rounds half-up from $1.0493)."""
        await _seed_order(ledger, order_id="t_frac", price=14.99)
        order = await _get_order(ledger, "t_frac")
        assert order.tax == Decimal("1.05")

    async def test_zero_subtotal_zero_tax(self, ledger):
        """Order with no items has zero tax."""
        await ledger.append(order_created(
            terminal_id=TERMINAL,
            order_id="t_zero",
            order_type="dine_in",
            guest_count=1,
            server_id="s1",
            correlation_id="t_zero",
        ))
        order = await _get_order(ledger, "t_zero")
        assert order.subtotal == Decimal("0.00")
        assert order.tax == Decimal("0.00")


# ═══════════════════════════════════════════════════════════════════════════
# Event-sourced tax (captured from PAYMENT_CONFIRMED)
# ═══════════════════════════════════════════════════════════════════════════

class TestEventSourcedTax:

    async def test_confirmed_payment_tax_overrides_computed(self, ledger):
        """When a payment captures tax_amount, projection uses that instead of computing."""
        await _seed_order(ledger, order_id="t_cap", price=100.00)
        # Captured tax of $9.00 — different from computed $7.00
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="t_cap",
            payment_id="p_cap", amount=109.00, method="card",
        ))
        await ledger.append(payment_confirmed(
            terminal_id=TERMINAL, order_id="t_cap",
            payment_id="p_cap", transaction_id="txn_cap",
            amount=109.00, tax=9.00,
        ))
        order = await _get_order(ledger, "t_cap")
        assert order.tax == Decimal("9.00")  # event-sourced, not computed

    async def test_only_confirmed_payments_contribute_to_tax(self, ledger):
        """Pending payments do not contribute to event-sourced tax."""
        await _seed_order(ledger, order_id="t_pend", price=50.00)
        # Initiate but do NOT confirm
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="t_pend",
            payment_id="p_pend", amount=53.50, method="card",
        ))
        order = await _get_order(ledger, "t_pend")
        # No confirmed payment → falls back to computed: $50 × 7% = $3.50
        assert order.tax == Decimal("3.50")

    async def test_multiple_confirmed_payments_sum_tax(self, ledger):
        """Split payments: each captures tax; total tax is their sum."""
        await _seed_order(ledger, order_id="t_split", price=100.00)
        # Two seat payments, each with $3.50 tax (covers half the order)
        for i in (1, 2):
            pid = f"p_split_{i}"
            await ledger.append(payment_initiated(
                terminal_id=TERMINAL, order_id="t_split",
                payment_id=pid, amount=53.50, method="card",
            ))
            await ledger.append(payment_confirmed(
                terminal_id=TERMINAL, order_id="t_split",
                payment_id=pid, transaction_id=f"txn_split_{i}",
                amount=53.50, tax=3.50,
            ))
        order = await _get_order(ledger, "t_split")
        assert order.tax == Decimal("7.00")  # $3.50 × 2

    async def test_zero_captured_tax_falls_back_to_computed(self, ledger):
        """Captured tax of $0 (no explicit tax) falls back to computed tax."""
        await _seed_order(ledger, order_id="t_zerocap", price=100.00)
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="t_zerocap",
            payment_id="p_zc", amount=100.00, method="cash",
        ))
        # Confirm with no tax — the default is Decimal("0.00")
        await ledger.append(payment_confirmed(
            terminal_id=TERMINAL, order_id="t_zerocap",
            payment_id="p_zc", transaction_id="txn_zc",
            amount=100.00,
        ))
        order = await _get_order(ledger, "t_zerocap")
        # captured == 0 → falls back to computed
        assert order.tax == Decimal("7.00")


# ═══════════════════════════════════════════════════════════════════════════
# Tax rate override via project_order(tax_rate=...)
# ═══════════════════════════════════════════════════════════════════════════

class TestTaxRateOverride:

    async def test_explicit_tax_rate_overrides_settings(self, ledger):
        """project_order(tax_rate=0.10) overrides the 7% from settings."""
        await _seed_order(ledger, order_id="t_rate", price=100.00)
        events = await ledger.get_events_by_correlation("t_rate")
        order = project_order(events, tax_rate=Decimal("0.10"))
        assert order.tax == Decimal("10.00")

    async def test_zero_tax_rate_gives_zero_tax(self, ledger):
        """Tax rate of 0 → zero tax regardless of order total."""
        await _seed_order(ledger, order_id="t_notax", price=100.00)
        events = await ledger.get_events_by_correlation("t_notax")
        order = project_order(events, tax_rate=Decimal("0.00"))
        assert order.tax == Decimal("0.00")
        assert order.total == Decimal("100.00")


# ═══════════════════════════════════════════════════════════════════════════
# Modifiers add to taxable base
# ═══════════════════════════════════════════════════════════════════════════

class TestModifierTax:

    async def test_paid_modifier_increases_taxable_base(self, ledger):
        """$2.00 modifier on a $20.00 item → taxable base = $22.00."""
        await _seed_order(ledger, order_id="t_mod", price=20.00)
        await ledger.append(modifier_applied(
            terminal_id=TERMINAL,
            order_id="t_mod",
            item_id="t_mod_item",
            modifier_id="mod_extra",
            modifier_name="Extra Cheese",
            modifier_price=Decimal("2.00"),
        ))
        order = await _get_order(ledger, "t_mod")
        assert order.gross_subtotal == Decimal("22.00")
        assert order.tax == Decimal("1.54")  # $22.00 × 7%

    async def test_free_modifier_does_not_change_tax(self, ledger):
        """$0 modifier has no effect on tax calculation."""
        await _seed_order(ledger, order_id="t_freemod", price=20.00)
        await ledger.append(modifier_applied(
            terminal_id=TERMINAL,
            order_id="t_freemod",
            item_id="t_freemod_item",
            modifier_id="mod_no_onion",
            modifier_name="No Onion",
            modifier_price=Decimal("0.00"),
        ))
        order = await _get_order(ledger, "t_freemod")
        assert order.tax == Decimal("1.40")  # $20.00 × 7%


# ═══════════════════════════════════════════════════════════════════════════
# Discount reduces taxable base
# ═══════════════════════════════════════════════════════════════════════════

class TestDiscountReducesTaxableBase:

    async def test_flat_discount_reduces_tax(self, ledger):
        """$10 discount on $100 item → taxable base $90 → tax $6.30."""
        await _seed_order(ledger, order_id="t_disc", price=100.00)
        await ledger.append(create_event(
            event_type=EventType.DISCOUNT_APPROVED,
            terminal_id=TERMINAL,
            correlation_id="t_disc",
            payload={
                "order_id": "t_disc",
                "discount_type": "flat_dollar",
                "amount": Decimal("10.00"),
                "reason": "Manager discount",
                "approved_by": "mgr_1",
            },
        ))
        order = await _get_order(ledger, "t_disc")
        assert order.subtotal == Decimal("90.00")
        assert order.tax == Decimal("6.30")  # $90 × 7%

    async def test_discount_larger_than_subtotal_clamps_to_zero(self, ledger):
        """Discount exceeding subtotal clamps subtotal and tax to zero."""
        await _seed_order(ledger, order_id="t_overdisc", price=10.00)
        await ledger.append(create_event(
            event_type=EventType.DISCOUNT_APPROVED,
            terminal_id=TERMINAL,
            correlation_id="t_overdisc",
            payload={
                "order_id": "t_overdisc",
                "discount_type": "flat_dollar",
                "amount": Decimal("15.00"),
                "reason": "Comp",
                "approved_by": "mgr_1",
            },
        ))
        order = await _get_order(ledger, "t_overdisc")
        assert order.subtotal == Decimal("0.00")
        assert order.tax == Decimal("0.00")
        assert order.total == Decimal("0.00")

    async def test_discount_with_captured_tax_uses_captured_value(self, ledger):
        """Even with a discount applied, confirmed payment tax overrides computed."""
        await _seed_order(ledger, order_id="t_disc_cap", price=100.00)
        # Apply $10 discount → computed tax would be $6.30
        await ledger.append(create_event(
            event_type=EventType.DISCOUNT_APPROVED,
            terminal_id=TERMINAL,
            correlation_id="t_disc_cap",
            payload={
                "order_id": "t_disc_cap",
                "discount_type": "flat_dollar",
                "amount": Decimal("10.00"),
                "reason": "Comp",
                "approved_by": "mgr_1",
            },
        ))
        # Confirm payment with a different captured tax of $5.00
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="t_disc_cap",
            payment_id="p_dc", amount=95.00, method="card",
        ))
        await ledger.append(payment_confirmed(
            terminal_id=TERMINAL, order_id="t_disc_cap",
            payment_id="p_dc", transaction_id="txn_dc",
            amount=95.00, tax=5.00,
        ))
        order = await _get_order(ledger, "t_disc_cap")
        assert order.tax == Decimal("5.00")  # captured wins over computed


# ═══════════════════════════════════════════════════════════════════════════
# Rounding precision
# ═══════════════════════════════════════════════════════════════════════════

class TestTaxRounding:

    async def test_half_up_rounding(self, ledger):
        """$0.50 × 7% = $0.035 → rounds half-up to $0.04."""
        await _seed_order(ledger, order_id="t_round", price=0.50)
        order = await _get_order(ledger, "t_round")
        assert order.tax == Decimal("0.04")

    async def test_precision_three_item_order(self, ledger):
        """Three $11.11 items: subtotal $33.33 × 7% = $2.3331 → $2.33."""
        oid = "t_prec"
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id=oid,
            order_type="dine_in", guest_count=1, server_id="s1",
            correlation_id=oid,
        ))
        for i in range(3):
            await ledger.append(item_added(
                terminal_id=TERMINAL, order_id=oid,
                item_id=f"it_{i}", menu_item_id="m1",
                name="Item", price=11.11, quantity=1,
            ))
        order = await _get_order(ledger, oid)
        assert order.gross_subtotal == Decimal("33.33")
        assert order.tax == Decimal("2.33")
