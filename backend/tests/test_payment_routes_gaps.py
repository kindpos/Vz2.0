"""
Coverage gaps: /sale, /batch-settle, /cash, /tip-adjust, /refund guards.

Exercises every zero-coverage guard branch identified in COVERAGE_AUDIT.md
(gaps 🔴1, 🔴2, 🔴3).

Direct-call pattern (same as test_adjust_tip_on_order.py):
    await process_sale(req, manager=mgr, validator=validator, ledger=ledger)

batch_settle calls get_payment_manager(ledger) internally (not via Depends),
so the autouse fixture resets _manager + _devices_initialized so each test
gets a fresh mock device under the test ledger.
"""

from pathlib import Path
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.api.routes.payment_routes import (
    CashPaymentRequest,
    TipAdjustRequest,
    RefundRequest,
    adjust_tip,
    batch_settle,
    process_cash_payment,
    process_refund,
    process_sale,
)
from app.config import settings
from app.core.adapters.base_payment import (
    PaymentDeviceConfig,
    PaymentDeviceType,
    TransactionRequest,
)
from app.core.adapters.mock_payment import MockPaymentDevice
from app.core.adapters.payment_manager import PaymentManager
from app.core.adapters.payment_validator import PaymentValidator
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    create_event,
    item_added,
    order_closed,
    order_created,
    order_voided,
    payment_confirmed,
    payment_initiated,
)

TEST_DB = Path("./data/test_payment_routes_gaps.db")
TERMINAL = settings.terminal_id


@pytest.fixture(autouse=True)
def _zero_rates(monkeypatch):
    monkeypatch.setattr(settings, "tax_rate", Decimal("0.00"))
    monkeypatch.setattr(settings, "cash_discount_rate", Decimal("0.00"))


@pytest.fixture(autouse=True)
def _reset_payment_globals(monkeypatch):
    """Each test gets a fresh PaymentManager and device initialisation state."""
    import app.api.routes.payment_routes as pr
    monkeypatch.setattr(pr, "_manager", None)
    monkeypatch.setattr(pr, "_validator", None)
    monkeypatch.setattr(pr, "_devices_initialized", False)


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest_asyncio.fixture
async def fast_mock(ledger):
    """PaymentManager with a zero-delay mock device pre-wired for TERMINAL."""
    mgr = PaymentManager(ledger, TERMINAL)
    mock = MockPaymentDevice()
    mock.set_delay(0, 0)
    cfg = PaymentDeviceConfig(
        device_id="mock_001",
        name="Test Mock",
        device_type=PaymentDeviceType.SMART_TERMINAL,
        ip_address="127.0.0.1",
        mac_address="00:00:00:00:00:00",
        port=9000,
        protocol="mock",
        processor_id="mock_processor",
    )
    await mock.connect(cfg)
    mgr.register_device(mock)
    mgr.map_terminal_to_device(TERMINAL, "mock_001")
    validator = PaymentValidator(ledger)
    return mgr, mock, validator


# ── Seed helpers ─────────────────────────────────────────────────────────────

async def _seed_open_order(ledger, order_id: str, amount: Decimal = Decimal("20.00")):
    await ledger.append(order_created(
        terminal_id=TERMINAL, order_id=order_id,
        guest_count=1, correlation_id=order_id,
    ))
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=order_id,
        item_id=f"{order_id}_item", menu_item_id="m1",
        name="Dish", price=amount, quantity=1,
    ))


async def _seed_card_paid_order(
    ledger,
    order_id: str,
    *,
    amount: Decimal = Decimal("20.00"),
    payment_id: str = "pay_01",
    confirmed: bool = True,
) -> str:
    await _seed_open_order(ledger, order_id, amount)
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=order_id,
        payment_id=payment_id, amount=amount, method="card",
    ))
    if confirmed:
        await ledger.append(payment_confirmed(
            terminal_id=TERMINAL, order_id=order_id,
            payment_id=payment_id,
            transaction_id=f"txn_{payment_id}",
            amount=amount, tax=Decimal("0.00"),
        ))
    return payment_id


# =============================================================================
# /sale — gap 🔴1
# =============================================================================

@pytest.mark.asyncio
async def test_sale_already_fully_paid_rejected(ledger, fast_mock):
    """Guard: order is already fully paid → 400."""
    mgr, mock, validator = fast_mock
    oid = "sale-gap-paid"
    await _seed_open_order(ledger, oid, Decimal("20.00"))

    # Pay via cash first
    await process_cash_payment(CashPaymentRequest(order_id=oid, amount=Decimal("20.00")), ledger=ledger)

    req = TransactionRequest(order_id=oid, amount=Decimal("20.00"), terminal_id=TERMINAL)
    with pytest.raises(HTTPException) as exc:
        await process_sale(req, manager=mgr, validator=validator, ledger=ledger)
    assert exc.value.status_code == 400
    assert "fully paid" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_sale_inflight_guard_returns_409(ledger, fast_mock):
    """FIN-002 guard: unresolved PAYMENT_INITIATED (with transaction_id in payload) blocks a second sale."""
    mgr, mock, validator = fast_mock
    oid = "sale-gap-inflight"
    await _seed_open_order(ledger, oid, Decimal("30.00"))

    # Append a PAYMENT_INITIATED that has transaction_id in payload (mimics what
    # PaymentManager emits via _create_payment_event(request.model_dump())).
    await ledger.append(create_event(
        event_type=EventType.PAYMENT_INITIATED,
        terminal_id=TERMINAL,
        payload={
            "order_id": oid,
            "payment_id": "pay_orphan",
            "amount": Decimal("30.00"),
            "method": "card",
            "transaction_id": "txn_orphan",
        },
        correlation_id=oid,
    ))

    # New sale attempt — guard sees orphaned txn_orphan in _initiated
    req = TransactionRequest(order_id=oid, amount=Decimal("30.00"), terminal_id=TERMINAL)
    with pytest.raises(HTTPException) as exc:
        await process_sale(req, manager=mgr, validator=validator, ledger=ledger)
    assert exc.value.status_code == 409
    assert "in progress" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_sale_overage_clamped_to_tip(ledger, fast_mock):
    """Overage-as-tip: amount > balance_due routes excess into a TIP_ADJUSTED event."""
    mgr, mock, validator = fast_mock
    oid = "sale-gap-overage"
    await _seed_open_order(ledger, oid, Decimal("20.00"))

    # Request $25 on a $20 order → $5 overage routed to tip
    req = TransactionRequest(order_id=oid, amount=Decimal("25.00"), terminal_id=TERMINAL)
    result = await process_sale(req, manager=mgr, validator=validator, ledger=ledger)
    assert result.status.value == "APPROVED"

    events = await ledger.get_events_by_correlation(oid)
    tip_evts = [e for e in events if e.event_type == EventType.TIP_ADJUSTED]
    assert len(tip_evts) == 1
    assert Decimal(str(tip_evts[0].payload["tip_amount"])) == Decimal("5.00")


@pytest.mark.asyncio
async def test_sale_auto_closes_fully_paid_order(ledger, fast_mock):
    """After an approved sale that fully pays the order, ORDER_CLOSED is emitted."""
    mgr, mock, validator = fast_mock
    oid = "sale-gap-autoclose"
    await _seed_open_order(ledger, oid, Decimal("15.00"))

    req = TransactionRequest(order_id=oid, amount=Decimal("15.00"), terminal_id=TERMINAL)
    await process_sale(req, manager=mgr, validator=validator, ledger=ledger)

    events = await ledger.get_events_by_correlation(oid)
    closed_evts = [e for e in events if e.event_type == EventType.ORDER_CLOSED]
    assert len(closed_evts) == 1


# =============================================================================
# /batch-settle — gap 🔴2
# =============================================================================

@pytest.mark.asyncio
async def test_batch_settle_mock_device_returns_mock_flag(ledger):
    """With the fallback mock device, batch_settle returns using_mock=True instantly."""
    result = await batch_settle(ledger=ledger)
    assert result["success"] is True
    assert result["using_mock"] is True
    assert result["batch_id"] == "MOCK"


# =============================================================================
# /cash guards — gap 🔴3a
# =============================================================================

@pytest.mark.asyncio
async def test_cash_payment_missing_order_returns_404(ledger):
    """/cash on a nonexistent order_id → 404."""
    with pytest.raises(HTTPException) as exc:
        await process_cash_payment(
            CashPaymentRequest(order_id="no-such-order", amount=Decimal("10.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_cash_payment_on_closed_order_returns_400(ledger):
    """/cash on a closed order → 400."""
    oid = "cash-gap-closed"
    await _seed_open_order(ledger, oid, Decimal("10.00"))
    await ledger.append(order_closed(terminal_id=TERMINAL, order_id=oid, total=Decimal("10.00")))

    with pytest.raises(HTTPException) as exc:
        await process_cash_payment(
            CashPaymentRequest(order_id=oid, amount=Decimal("10.00")), ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "closed" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_cash_payment_on_voided_order_returns_400(ledger):
    """/cash on a voided order → 400."""
    oid = "cash-gap-voided"
    await _seed_open_order(ledger, oid, Decimal("10.00"))
    await ledger.append(order_voided(
        terminal_id=TERMINAL, order_id=oid,
        reason="test void", approved_by="mgr",
    ))

    with pytest.raises(HTTPException) as exc:
        await process_cash_payment(
            CashPaymentRequest(order_id=oid, amount=Decimal("10.00")), ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "voided" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_cash_payment_already_fully_paid_returns_400(ledger):
    """Double-tap guard: second cash payment after order is already closed → 400.

    process_cash_payment auto-closes the order on full payment, so the second
    attempt hits the 'closed' guard (which covers the fully-paid path too).
    """
    oid = "cash-gap-dblpay"
    await _seed_open_order(ledger, oid, Decimal("10.00"))

    req = CashPaymentRequest(order_id=oid, amount=Decimal("10.00"))
    await process_cash_payment(req, ledger=ledger)  # succeeds and auto-closes

    with pytest.raises(HTTPException) as exc:
        await process_cash_payment(req, ledger=ledger)  # blocked
    assert exc.value.status_code == 400
    # Order was auto-closed, so message comes from the closed-status guard
    assert "closed" in exc.value.detail.lower() or "fully paid" in exc.value.detail.lower()


# =============================================================================
# /tip-adjust guards — gap 🔴3b
# =============================================================================

@pytest.mark.asyncio
async def test_tip_adjust_negative_tip_returns_400(ledger):
    """Negative tip_amount → 400."""
    oid = "tipadj-neg"
    pid = await _seed_card_paid_order(ledger, oid)

    with pytest.raises(HTTPException) as exc:
        await adjust_tip(
            TipAdjustRequest(order_id=oid, payment_id=pid, tip_amount=Decimal("-1.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "negative" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_tip_adjust_order_not_found_returns_404(ledger):
    """Order not found → 404."""
    with pytest.raises(HTTPException) as exc:
        await adjust_tip(
            TipAdjustRequest(order_id="no-order", payment_id="pay_x", tip_amount=Decimal("2.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_tip_adjust_payment_not_found_returns_404(ledger):
    """Payment ID not on order → 404."""
    oid = "tipadj-no-pay"
    await _seed_card_paid_order(ledger, oid)

    with pytest.raises(HTTPException) as exc:
        await adjust_tip(
            TipAdjustRequest(order_id=oid, payment_id="ghost", tip_amount=Decimal("2.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_tip_adjust_non_confirmed_payment_returns_400(ledger):
    """Tip adjust on a pending (unconfirmed) payment → 400."""
    oid = "tipadj-pending"
    pid = await _seed_card_paid_order(ledger, oid, confirmed=False)

    with pytest.raises(HTTPException) as exc:
        await adjust_tip(
            TipAdjustRequest(order_id=oid, payment_id=pid, tip_amount=Decimal("2.00")),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "confirmed" in exc.value.detail.lower()


# =============================================================================
# /refund guards — gap 🔴3c
# =============================================================================

@pytest.mark.asyncio
async def test_refund_without_approved_by_returns_403(ledger):
    """Missing approved_by → 403."""
    oid = "ref-no-mgr"
    pid = await _seed_card_paid_order(ledger, oid)

    with pytest.raises(HTTPException) as exc:
        await process_refund(
            RefundRequest(order_id=oid, payment_id=pid, amount=Decimal("5.00"),
                          reason="test", approved_by=""),
            ledger=ledger,
        )
    assert exc.value.status_code == 403
    assert "approval" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_refund_order_not_found_returns_404(ledger):
    """Order not found → 404."""
    with pytest.raises(HTTPException) as exc:
        await process_refund(
            RefundRequest(order_id="no-order", payment_id="pay_x",
                          amount=Decimal("5.00"), reason="test", approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_refund_payment_not_found_returns_404(ledger):
    """Payment ID not on order → 404."""
    oid = "ref-no-pay"
    await _seed_card_paid_order(ledger, oid)

    with pytest.raises(HTTPException) as exc:
        await process_refund(
            RefundRequest(order_id=oid, payment_id="ghost",
                          amount=Decimal("5.00"), reason="test", approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_refund_non_confirmed_payment_returns_400(ledger):
    """Refund on pending payment → 400."""
    oid = "ref-pending"
    pid = await _seed_card_paid_order(ledger, oid, confirmed=False)

    with pytest.raises(HTTPException) as exc:
        await process_refund(
            RefundRequest(order_id=oid, payment_id=pid, amount=Decimal("5.00"),
                          reason="test", approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "confirmed" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_refund_over_amount_returns_400(ledger):
    """Refund amount exceeds original payment → 400."""
    oid = "ref-over"
    pid = await _seed_card_paid_order(ledger, oid, amount=Decimal("20.00"))

    with pytest.raises(HTTPException) as exc:
        await process_refund(
            RefundRequest(order_id=oid, payment_id=pid, amount=Decimal("50.00"),
                          reason="test", approved_by="mgr"),
            ledger=ledger,
        )
    assert exc.value.status_code == 400
    assert "exceed" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_refund_happy_path_emits_cash_refund_due(ledger):
    """Full refund on confirmed payment emits CASH_REFUND_DUE and returns success."""
    oid = "ref-happy"
    pid = await _seed_card_paid_order(ledger, oid, amount=Decimal("20.00"))

    result = await process_refund(
        RefundRequest(order_id=oid, payment_id=pid, amount=Decimal("20.00"),
                      reason="customer unhappy", approved_by="mgr-01"),
        ledger=ledger,
    )
    assert result["success"] is True
    assert result["refund_amount"] == Decimal("20.00")

    events = await ledger.get_events_by_correlation(oid)
    refund_evts = [e for e in events if e.event_type == EventType.PAYMENT_REFUNDED]
    assert len(refund_evts) == 1
    assert Decimal(str(refund_evts[0].payload["amount"])) == Decimal("20.00")
