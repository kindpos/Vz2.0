"""
Endpoint tests for `POST /orders/{order_id}/discount`.

  - precision gate rejects 3dp amounts (FIN-001)
  - pending-payment guard blocks discount mid-payment
  - closed/voided orders reject
  - happy path emits DISCOUNT_APPROVED and updates order.discount_total
  - idempotency: same transaction_id returns existing result without
    a second DISCOUNT_APPROVED event
  - two distinct transaction_ids each land their own event
"""

from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.api.routes import orders as orders_mod
from app.api.routes.orders import ApplyDiscountRequest
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import EventType, order_created, item_added


TEST_DB = Path("./data/test_discount_endpoint.db")
TERMINAL = "terminal_discount"


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _open_order_with_item(ledger, order_id: str = "o1"):
    """Create an order with one $20 item so discount math has something
    to chew on."""
    await ledger.append(order_created(
        terminal_id=TERMINAL,
        order_id=order_id,
        order_type="dine_in",
        guest_count=1,
        server_id="emp_A",
        server_name="Alice",
        correlation_id=order_id,
    ))
    await ledger.append(item_added(
        terminal_id=TERMINAL,
        order_id=order_id,
        item_id=f"{order_id}_it_0",
        menu_item_id="m1",
        name="Pizza",
        price=20.00,
        quantity=1,
        category="PIZZA",
    ))
    return order_id


class TestDiscountEndpoint:

    @pytest.mark.asyncio
    async def test_happy_path_emits_event_and_reduces_balance(self, ledger, monkeypatch):
        monkeypatch.setattr(settings, "tax_rate", 0.0)
        oid = await _open_order_with_item(ledger)

        res = await orders_mod.apply_discount(
            order_id=oid,
            request=ApplyDiscountRequest(
                discount_type="10%",
                amount=Decimal("2.00"),
                reason="Manager 10% discount",
                approved_by="mgr_A",
            ),
            ledger=ledger,
        )
        assert res.discount_total == Decimal("2.00")
        # Total = subtotal - discount + tax(0) = 18.00
        assert res.total == Decimal("18.00")
        # Ledger now has a DISCOUNT_APPROVED event.
        events = await ledger.get_events_by_type(EventType.DISCOUNT_APPROVED)
        assert len(events) == 1
        assert events[0].payload["approved_by"] == "mgr_A"
        assert events[0].payload["discount_type"] == "10%"

    @pytest.mark.asyncio
    async def test_precision_gate_rejects_3dp_amount(self, ledger):
        oid = await _open_order_with_item(ledger)
        with pytest.raises(HTTPException) as exc:
            await orders_mod.apply_discount(
                order_id=oid,
                request=ApplyDiscountRequest(
                    discount_type="5%",
                    amount=Decimal("1.234"),
                    approved_by="mgr_A",
                ),
                ledger=ledger,
            )
        assert exc.value.status_code == 400
        assert "2 decimal" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_rejects_when_payment_pending(self, ledger):
        from app.core.events import payment_initiated
        oid = await _open_order_with_item(ledger)
        # Emit a PAYMENT_INITIATED with no resolution → order has a
        # pending payment; discount must be blocked while the device
        # could still settle.
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL,
            order_id=oid,
            payment_id="p_pending",
            amount=20.00,
            method="card",
        ))
        with pytest.raises(HTTPException) as exc:
            await orders_mod.apply_discount(
                order_id=oid,
                request=ApplyDiscountRequest(
                    discount_type="10%",
                    amount=Decimal("2.00"),
                    approved_by="mgr_A",
                ),
                ledger=ledger,
            )
        assert exc.value.status_code == 400
        assert "pending" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_rejects_on_closed_order(self, ledger):
        from app.core.events import order_closed
        oid = await _open_order_with_item(ledger)
        await ledger.append(order_closed(
            terminal_id=TERMINAL, order_id=oid, total=20.00,
        ))
        with pytest.raises(HTTPException) as exc:
            await orders_mod.apply_discount(
                order_id=oid,
                request=ApplyDiscountRequest(
                    discount_type="10%",
                    amount=Decimal("2.00"),
                    approved_by="mgr_A",
                ),
                ledger=ledger,
            )
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_multiple_discounts_accumulate(self, ledger, monkeypatch):
        """The endpoint doesn't cap at one discount per order; two
        separate discounts sum. This pins current behavior so a future
        "single discount only" change is a conscious choice."""
        monkeypatch.setattr(settings, "tax_rate", 0.0)
        oid = await _open_order_with_item(ledger)

        await orders_mod.apply_discount(
            order_id=oid,
            request=ApplyDiscountRequest(
                discount_type="10%", amount=Decimal("2.00"), approved_by="mgr_A",
            ),
            ledger=ledger,
        )
        res = await orders_mod.apply_discount(
            order_id=oid,
            request=ApplyDiscountRequest(
                discount_type="5%", amount=Decimal("1.00"), approved_by="mgr_A",
            ),
            ledger=ledger,
        )
        assert res.discount_total == Decimal("3.00")
        assert res.total == Decimal("17.00")

    @pytest.mark.asyncio
    async def test_rejects_on_voided_order(self, ledger):
        from app.core.events import order_voided
        oid = await _open_order_with_item(ledger)
        await ledger.append(order_voided(
            terminal_id=TERMINAL, order_id=oid, reason="test void",
        ))
        with pytest.raises(HTTPException) as exc:
            await orders_mod.apply_discount(
                order_id=oid,
                request=ApplyDiscountRequest(
                    discount_type="10%",
                    amount=Decimal("2.00"),
                    approved_by="mgr_A",
                ),
                ledger=ledger,
            )
        assert exc.value.status_code == 400
        assert "voided" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_idempotent_with_transaction_id(self, ledger, monkeypatch):
        """Same transaction_id on a second call must NOT create a second
        DISCOUNT_APPROVED event and must return the current order state."""
        monkeypatch.setattr(settings, "tax_rate", 0.0)
        oid = await _open_order_with_item(ledger)

        req = ApplyDiscountRequest(
            discount_type="10%",
            amount=Decimal("2.00"),
            approved_by="mgr_A",
            transaction_id="disc-idem-001",
        )
        r1 = await orders_mod.apply_discount(order_id=oid, request=req, ledger=ledger)
        r2 = await orders_mod.apply_discount(order_id=oid, request=req, ledger=ledger)

        assert r1.discount_total == Decimal("2.00")
        assert r2.discount_total == Decimal("2.00")
        events = await ledger.get_events_by_type(EventType.DISCOUNT_APPROVED)
        assert len(events) == 1, "retry must not create a second DISCOUNT_APPROVED"

    @pytest.mark.asyncio
    async def test_transaction_id_stored_in_event(self, ledger):
        oid = await _open_order_with_item(ledger)
        await orders_mod.apply_discount(
            order_id=oid,
            request=ApplyDiscountRequest(
                discount_type="10%",
                amount=Decimal("2.00"),
                approved_by="mgr_A",
                transaction_id="disc-store-001",
            ),
            ledger=ledger,
        )
        events = await ledger.get_events_by_type(EventType.DISCOUNT_APPROVED)
        assert events[0].payload.get("transaction_id") == "disc-store-001"

    @pytest.mark.asyncio
    async def test_two_distinct_transaction_ids_both_land(self, ledger, monkeypatch):
        """Two distinct IDs → two distinct events → cumulative discount."""
        monkeypatch.setattr(settings, "tax_rate", 0.0)
        oid = await _open_order_with_item(ledger)

        await orders_mod.apply_discount(
            order_id=oid,
            request=ApplyDiscountRequest(
                discount_type="10%", amount=Decimal("2.00"),
                approved_by="mgr_A", transaction_id="disc-A",
            ),
            ledger=ledger,
        )
        r = await orders_mod.apply_discount(
            order_id=oid,
            request=ApplyDiscountRequest(
                discount_type="5%", amount=Decimal("1.00"),
                approved_by="mgr_A", transaction_id="disc-B",
            ),
            ledger=ledger,
        )
        assert r.discount_total == Decimal("3.00")
        events = await ledger.get_events_by_type(EventType.DISCOUNT_APPROVED)
        assert len(events) == 2

    @pytest.mark.asyncio
    async def test_without_transaction_id_still_works(self, ledger, monkeypatch):
        """Legacy callers without a transaction_id must still succeed."""
        monkeypatch.setattr(settings, "tax_rate", 0.0)
        oid = await _open_order_with_item(ledger)
        res = await orders_mod.apply_discount(
            order_id=oid,
            request=ApplyDiscountRequest(
                discount_type="10%", amount=Decimal("2.00"), approved_by="mgr_A",
            ),
            ledger=ledger,
        )
        assert res.discount_total == Decimal("2.00")
