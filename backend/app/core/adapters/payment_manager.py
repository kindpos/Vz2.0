import asyncio
import logging
from datetime import datetime
from typing import Dict, Optional, List, Any
from decimal import Decimal

from .base_payment import (
    BasePaymentDevice,
    PaymentDeviceConfig,
    PaymentDeviceStatus,
    TransactionRequest,
    TransactionResult,
    TransactionStatus,
    BatchResult,
    PaymentType,
    PaymentError,
    PaymentErrorCategory
)
from ..events import (
    EventType,
    Event,
    create_event
)
from ..event_ledger import EventLedger
from ..money import money_round

logger = logging.getLogger("kindpos.payment.manager")

# Module-level lock spanning the idempotency-check → device-lookup →
# PAYMENT_INITIATED append window in `initiate_sale`. Two concurrent
# calls for the same transaction_id were able to slip past
# `_check_idempotency` before either appended PAYMENT_INITIATED to the
# ledger — both would then reach `device.initiate_sale` and a double
# charge could be issued to the SPIn terminal. Held only across the
# check + append (fast); released before the 90 s device round trip
# so other terminals' sales are not serialized on the network call.
_initiate_lock = asyncio.Lock()


class PaymentManager:
    """
    The Brain — handles idempotency, event emission, device routing, 
    timeout enforcement, and deferred queue.
    """

    def __init__(self, ledger: EventLedger, terminal_id: str):
        self._ledger = ledger
        self._terminal_id = terminal_id
        self._devices: Dict[str, BasePaymentDevice] = {} # device_id -> adapter
        self._terminal_device_map: Dict[str, str] = {} # terminal_id -> device_id

    def register_device(self, device: BasePaymentDevice):
        if device.config:
            self._devices[device.config.device_id] = device
            logger.info(f"Registered payment device: {device.config.name} ({device.config.device_id})")

    def map_terminal_to_device(self, terminal_id: str, device_id: str):
        self._terminal_device_map[terminal_id] = device_id

    def get_device_for_terminal(self, terminal_id: str):
        """Return the payment device mapped to a terminal, or None."""
        device_id = self._terminal_device_map.get(terminal_id)
        if device_id and device_id in self._devices:
            return self._devices[device_id]
        return None

    async def initiate_sale(self, request: TransactionRequest, tax: Decimal = Decimal("0.00")) -> TransactionResult:
        """Core sale entry point with idempotency and event emission."""

        # Lock-protected critical section: idempotency check → device
        # lookup → PAYMENT_INITIATED append. Without the lock, two
        # concurrent calls with the same transaction_id can both see
        # "no INITIATED yet" before either has written the event, and
        # both reach the device. The lock is released before the
        # 90 s device round trip so other transactions are not serialized.
        async with _initiate_lock:
            # 5.1 Idempotency check
            existing_result = await self._check_idempotency(request.transaction_id)
            if existing_result:
                logger.info(f"Idempotency hit for {request.transaction_id}")
                return existing_result

            # Get device for this terminal
            device_id = self._terminal_device_map.get(request.terminal_id)
            if not device_id or device_id not in self._devices:
                return self._error_result(request.transaction_id, PaymentErrorCategory.SYSTEM, "NO_DEVICE", f"No payment device mapped to terminal {request.terminal_id}")

            device = self._devices[device_id]

            # 5.2 Event Emission - Initiated
            event = self._create_payment_event(EventType.PAYMENT_INITIATED, request.model_dump())
            await self._ledger.append(event)

        # 5.4 Timeout Enforcement (90s) — outside the lock so the SPIn
        # round trip doesn't block other terminals' sales.
        try:
            result = await asyncio.wait_for(device.initiate_sale(request), timeout=90.0)
        except asyncio.TimeoutError:
            logger.warning(f"Payment {request.transaction_id} timed out. Attempting cancel.")
            # Check the cancel outcome so a device stuck in AWAITING_CARD
            # is visible. The cancel itself also needs a timeout — a hung
            # device will hang this too.
            try:
                cancel_ok = await asyncio.wait_for(device.cancel_transaction(), timeout=10.0)
            except Exception as cancel_exc:
                cancel_ok = False
                logger.error(
                    "Cancel after timeout failed for %s: %s",
                    request.transaction_id, cancel_exc,
                )
            if not cancel_ok:
                logger.error(
                    "Device may still be holding %s — manual recovery may be needed",
                    request.transaction_id,
                )
            result = TransactionResult(
                transaction_id=request.transaction_id,
                status=TransactionStatus.TIMEOUT,
                timestamp=datetime.now()
            )
        except Exception as e:
            logger.error(f"Payment {request.transaction_id} failed with exception: {e}")
            result = TransactionResult(
                transaction_id=request.transaction_id,
                status=TransactionStatus.ERROR,
                error=PaymentError(
                    category=PaymentErrorCategory.SYSTEM,
                    error_code="INTERNAL_ERR",
                    message=str(e),
                    source="PaymentManager"
                )
            )

        # 5.2 Event Emission - Result (include tax captured at payment time)
        await self._emit_result_event(request, result, extra={"tax": money_round(tax)})

        return result

    async def _check_idempotency(self, transaction_id: str) -> Optional[TransactionResult]:
        """Check if transaction already exists in ledger.

        Looks at CONFIRMED / DECLINED for completed results that we can
        replay, AND at INITIATED for in-flight work. Previously we only
        checked the completed states — which left a window between
        PAYMENT_INITIATED (emitted at the start of the manager flow) and
        the result event where a retry could push a second sale onto the
        device. Returning a synthetic ERROR with error_code=IN_FLIGHT
        (see lines below) for that in-flight case tells the route
        "it's already going; don't fire another one."
        """
        # Completed (confirmed) — replay the recorded result.
        events = await self._ledger.get_events_by_type(EventType.PAYMENT_CONFIRMED)
        for e in events:
             if e.payload.get("transaction_id") == transaction_id:
                 return TransactionResult(**e.payload)

        # Completed (declined) — same replay path.
        events = await self._ledger.get_events_by_type(EventType.PAYMENT_DECLINED)
        for e in events:
             if e.payload.get("transaction_id") == transaction_id:
                 return TransactionResult(**e.payload)

        # In-flight — there's an INITIATED with no terminal result yet.
        initiated = await self._ledger.get_events_by_type(EventType.PAYMENT_INITIATED)
        for e in initiated:
            if e.payload.get("transaction_id") != transaction_id:
                continue
            # Only block if this INITIATED has no matching resolution.
            if not await self._has_terminal_result(transaction_id):
                logger.warning(
                    "Idempotency: PAYMENT_INITIATED for %s has no result yet — refusing retry",
                    transaction_id,
                )
                return TransactionResult(
                    transaction_id=transaction_id,
                    status=TransactionStatus.ERROR,
                    error=PaymentError(
                        category=PaymentErrorCategory.SYSTEM,
                        error_code="IN_FLIGHT",
                        message="Payment is still in flight on the device",
                        source="PaymentManager",
                    ),
                )

        return None

    async def _has_terminal_result(self, transaction_id: str) -> bool:
        """True if any PAYMENT_* result event exists for this txn_id."""
        for et in (
            EventType.PAYMENT_CONFIRMED,
            EventType.PAYMENT_DECLINED,
            EventType.PAYMENT_CANCELLED,
            EventType.PAYMENT_TIMED_OUT,
            EventType.PAYMENT_ERROR,
        ):
            events = await self._ledger.get_events_by_type(et)
            for e in events:
                if e.payload.get("transaction_id") == transaction_id:
                    return True
        return False

    async def _emit_result_event(self, request: TransactionRequest, result: TransactionResult, extra: dict = None):
        status_map = {
            TransactionStatus.APPROVED: EventType.PAYMENT_CONFIRMED,
            TransactionStatus.DECLINED: EventType.PAYMENT_DECLINED,
            TransactionStatus.CANCELLED: EventType.PAYMENT_CANCELLED,
            TransactionStatus.TIMEOUT: EventType.PAYMENT_TIMED_OUT,
            TransactionStatus.ERROR: EventType.PAYMENT_ERROR
        }

        event_type = status_map.get(result.status, EventType.PAYMENT_ERROR)

        payload = request.model_dump()
        payload.update(result.model_dump())
        if extra:
            payload.update(extra)

        # Rename last_four to card_last_four for consistency with PAYMENT_CONFIRMED schema
        if "last_four" in payload and event_type == EventType.PAYMENT_CONFIRMED:
            payload["card_last_four"] = payload.pop("last_four")

        event = self._create_payment_event(event_type, payload)
        await self._ledger.append(event)

    def _create_payment_event(self, event_type: EventType, payload: Dict[str, Any]) -> Event:
        # Convert any Decimals in payload to strings for JSON compatibility
        def serialize(obj):
            if isinstance(obj, Decimal):
                return str(obj)
            if isinstance(obj, datetime):
                return obj.isoformat()
            if isinstance(obj, dict):
                return {k: serialize(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [serialize(i) for i in obj]
            return obj

        serialized = serialize(payload)
        # payment_manager only ever handles card-terminal flows, so stamp
        # `method: "card"` on every event it emits. Without this, the
        # projection falls back to `payment_type` (the string "SALE") and
        # every downstream consumer that classifies with `== "card"` or
        # `== "cash"` — manager-landing's unadjusted-tip counter, the
        # receipt builder's cash/card split, server-checkout tallies —
        # silently misses the payment. The tip-adjustment UI then shows
        # these checks as "already adjusted" and the sales split shows
        # them as neither cash nor card.
        if isinstance(serialized, dict):
            serialized.setdefault("method", "card")
        return create_event(
            event_type=event_type,
            terminal_id=self._terminal_id,
            payload=serialized,
            correlation_id=serialized.get("order_id") if isinstance(serialized, dict) else None,
        )

    def _error_result(self, tx_id: str, cat: PaymentErrorCategory, code: str, msg: str) -> TransactionResult:
        return TransactionResult(
            transaction_id=tx_id,
            status=TransactionStatus.ERROR,
            error=PaymentError(category=cat, error_code=code, message=msg, source="PaymentManager")
        )
