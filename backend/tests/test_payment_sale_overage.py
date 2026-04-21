"""
Regression tests for the /sale overage-as-tip clamp in
`api/routes/payment_routes.py:245-272`.

When a frontend posts a card sale amount > backend balance_due —
typically because the client computed its own cardTotal from a stale
TAX_RATE — the backend clamps the sale to balance_due and routes the
overage into a TIP_ADJUSTED event. That preserves the tender identity
(Cash + Card = Net + Tax) AND keeps the operator's tip report honest
by recording the overage as a tip rather than silently inflating the
sale amount.

The handler also auto-closes the order when the clamped sale brings
balance_due to zero.
"""

from pathlib import Path
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.api.routes import payment_routes as pr
from app.api.routes.payment_routes import process_sale
from app.config import settings
from app.core.adapters.base_payment import (
    PaymentDeviceConfig,
    PaymentDeviceType,
    TransactionRequest,
    TransactionStatus,
)
from app.core.adapters.mock_payment import MockPaymentDevice, MockScenarioMode
from app.core.adapters.payment_manager import PaymentManager
from app.core.adapters.payment_validator import PaymentValidator
from app.core.event_ledger import EventLedger
from app.core.events import EventType, item_added, order_created


TEST_DB = Path("./data/test_payment_sale_overage.db")
TERMINAL = settings.terminal_id


@pytest.fixture(autouse=True)
def _zero_tax(monkeypatch):
    """Zero out tax/discount so subtotal == balance_due for clean arithmetic."""
    monkeypatch.setattr(settings, "tax_rate", Decimal("0.00"))
    monkeypatch.setattr(settings, "cash_discount_rate", Decimal("0.00"))


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _seed_ten_dollar_order(ledger, order_id: str = "o_sale_1") -> str:
    """Ledger: one order with a single $10.00 item, no tax."""
    await ledger.append(order_created(
        terminal_id=TERMINAL,
        order_id=order_id,
        order_type="dine_in",
        guest_count=1,
        correlation_id=order_id,
    ))
    await ledger.append(item_added(
        terminal_id=TERMINAL,
        order_id=order_id,
        item_id=f"{order_id}_i",
        menu_item_id="m1",
        name="Item",
        price=Decimal("10.00"),
        quantity=1,
    ))
    return order_id


@pytest_asyncio.fixture
async def sale_deps(monkeypatch, ledger):
    """Fresh PaymentManager + Validator + approve-always mock device,
    wired into the module-global singletons so `process_sale`'s
    `_ensure_devices` short-circuits to our instance."""
    mgr = PaymentManager(ledger, settings.terminal_id)
    device = MockPaymentDevice()
    device.set_delay(card=0.0, proc=0.0)
    device.set_mode(MockScenarioMode.APPROVE_ALWAYS)
    cfg = PaymentDeviceConfig(
        device_id="d_overage",
        name="Overage Test Reader",
        device_type=PaymentDeviceType.SMART_TERMINAL,
        ip_address="127.0.0.1",
        mac_address="AA:BB:CC:DD:EE:00",
        protocol="mock",
        processor_id="mock",
    )
    await device.connect(cfg)
    mgr.register_device(device)
    mgr.map_terminal_to_device(settings.terminal_id, cfg.device_id)

    validator = PaymentValidator(ledger)

    monkeypatch.setattr(pr, "_manager", mgr)
    monkeypatch.setattr(pr, "_validator", validator)
    monkeypatch.setattr(pr, "_devices_initialized", True)
    return mgr, validator


@pytest.mark.asyncio
async def test_card_overage_clamped_and_emits_tip_adjusted(ledger, sale_deps):
    """$12.50 card sale on a $10.00 order clamps the sale to $10.00 and
    emits a TIP_ADJUSTED for the $2.50 overage."""
    order_id = await _seed_ten_dollar_order(ledger)
    mgr, validator = sale_deps

    req = TransactionRequest(
        transaction_id="txn_overage_1",
        order_id=order_id,
        amount=Decimal("12.50"),
        terminal_id=settings.terminal_id,
    )
    result = await process_sale(req, manager=mgr, validator=validator, ledger=ledger)
    assert result.status == TransactionStatus.APPROVED

    events = await ledger.get_events_by_correlation(order_id)

    # PAYMENT_CONFIRMED landed at the clamped $10.00, not the requested $12.50
    confirmed = [e for e in events if e.event_type == EventType.PAYMENT_CONFIRMED]
    assert len(confirmed) == 1
    assert Decimal(str(confirmed[0].payload["amount"])) == Decimal("10.00")

    # TIP_ADJUSTED event for the $2.50 overage, keyed to the same txn
    tip_events = [e for e in events if e.event_type == EventType.TIP_ADJUSTED]
    assert len(tip_events) == 1
    assert Decimal(str(tip_events[0].payload["tip_amount"])) == Decimal("2.50")
    assert tip_events[0].payload["payment_id"] == "txn_overage_1"

    # Auto-close: order reached zero balance after the clamped sale
    closed = [e for e in events if e.event_type == EventType.ORDER_CLOSED]
    assert len(closed) == 1


@pytest.mark.asyncio
async def test_card_exact_balance_emits_no_overage_tip(ledger, sale_deps):
    """Control: paying exactly the balance_due emits no TIP_ADJUSTED
    event — the overage-as-tip path is off unless there's actual overage."""
    order_id = await _seed_ten_dollar_order(ledger, order_id="o_sale_exact")
    mgr, validator = sale_deps

    req = TransactionRequest(
        transaction_id="txn_exact_1",
        order_id=order_id,
        amount=Decimal("10.00"),
        terminal_id=settings.terminal_id,
    )
    result = await process_sale(req, manager=mgr, validator=validator, ledger=ledger)
    assert result.status == TransactionStatus.APPROVED

    events = await ledger.get_events_by_correlation(order_id)
    tip_events = [e for e in events if e.event_type == EventType.TIP_ADJUSTED]
    assert tip_events == []

    # Still auto-closes on exact payment
    closed = [e for e in events if e.event_type == EventType.ORDER_CLOSED]
    assert len(closed) == 1


@pytest.mark.asyncio
async def test_card_sale_on_already_fully_paid_rejected(ledger, sale_deps):
    """Posting a sale on an order that's already fully paid → HTTP 400."""
    order_id = await _seed_ten_dollar_order(ledger, order_id="o_sale_paid")
    mgr, validator = sale_deps

    # First, pay it off
    await process_sale(
        TransactionRequest(
            transaction_id="txn_paid_1",
            order_id=order_id,
            amount=Decimal("10.00"),
            terminal_id=settings.terminal_id,
        ),
        manager=mgr, validator=validator, ledger=ledger,
    )

    # Second sale must be rejected
    with pytest.raises(HTTPException) as exc:
        await process_sale(
            TransactionRequest(
                transaction_id="txn_paid_2",
                order_id=order_id,
                amount=Decimal("5.00"),
                terminal_id=settings.terminal_id,
            ),
            manager=mgr, validator=validator, ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "already fully paid" in exc.value.detail.lower()
