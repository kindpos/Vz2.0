import asyncio
import xml.etree.ElementTree as ET
import logging
import urllib.parse
from datetime import datetime
from typing import Optional, List, Dict, Any
from decimal import Decimal
from xml.sax.saxutils import escape as _xml_escape

import httpx

from ..money import money_round
from .base_payment import (
    BasePaymentDevice,
    PaymentDeviceConfig,
    PaymentDeviceStatus,
    TransactionRequest,
    TransactionResult,
    TransactionStatus,
    BatchResult,
    BatchStatus,
    PaymentType,
    EntryMethod,
    PaymentError,
    PaymentErrorCategory
)
from ...models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity

logger = logging.getLogger("kindpos.payment.dejavoo")


async def _report_dev_event(
    severity: DiagnosticSeverity,
    event_code: str,
    message: str,
    context: dict,
) -> None:
    """Best-effort DEV-* emission from the Dejavoo adapter.

    The adapter never raises up its own diagnostic errors — a failed emit
    would interact badly with the payment flow's exception handlers. If
    the collector is absent or the record call throws, swallow silently.
    """
    # Late import to avoid circular: app.api.dependencies imports
    # PrinterManager → app.core.adapters → dejavoo_spin.
    from ...api.dependencies import get_diagnostic_collector
    collector = get_diagnostic_collector()
    if collector is None:
        return
    try:
        await collector.record(
            category=DiagnosticCategory.DEVICE,
            severity=severity,
            source="dejavoo_spin._send",
            event_code=event_code,
            message=message,
            context=context,
        )
    except Exception:  # pragma: no cover
        logger.exception("DEV-* diagnostic record failed (swallowed)")


class DejavooSPInAdapter(BasePaymentDevice):
    """
    Dejavoo SPIn adapter — plain HTTP GET over LAN.

    Protocol:
        GET http://{ip}:{port}/spin/cgi.html?TerminalTransaction={url_encoded_xml}

    The XML includes RegisterId, AuthKey, and TPN inside the body.
    Response is XML wrapped in <xmp> tags.

    Concurrency model
    -----------------
    The physical device can only run one transaction at a time, so all
    transaction-starting methods (initiate_sale, initiate_refund,
    initiate_void, adjust_tip, close_batch) serialize on `_tx_lock`.
    `cancel_transaction` is deliberately NOT gated by that lock — it
    must be callable while a sale is in flight so the manager's
    timeout-cancel path can break a stuck device loose. `check_status`
    is also lock-free (observation, not mutation).

    Status lifecycle
    ----------------
    Previously every transaction finally-block forced _status back to
    IDLE, which masked stuck-device conditions (card still in the
    reader, printer hung). Now the status is only transitioned on
    observed outcomes:
      start → AWAITING_CARD / PROCESSING
      clean return → IDLE
      exception → unchanged (leave for check_status to reconcile)
    """

    def __init__(self):
        self._status = PaymentDeviceStatus.OFFLINE
        self._config: Optional[PaymentDeviceConfig] = None
        # Serializes transaction starts. One physical reader, one lock.
        self._tx_lock = asyncio.Lock()

    @property
    def status(self) -> PaymentDeviceStatus:
        return self._status

    @property
    def config(self) -> Optional[PaymentDeviceConfig]:
        return self._config

    async def connect(self, config: PaymentDeviceConfig) -> bool:
        self._config = config
        status = await self.check_status()
        return status != PaymentDeviceStatus.OFFLINE

    async def disconnect(self) -> bool:
        self._status = PaymentDeviceStatus.OFFLINE
        return True

    # ── Transactions ──────────────────────────────────────────────────────────

    async def check_status(self) -> PaymentDeviceStatus:
        if self.in_sacred_state:
            return self._status

        try:
            xml = self._build_xml("GetStatus")
            response = await self._send(xml, timeout=3.0)
            if response is not None:
                resp_msg = response.findtext("RespMSG") or ""
                if "Approved" in resp_msg or resp_msg == "Ready":
                    self._status = PaymentDeviceStatus.IDLE
                elif "Busy" in resp_msg:
                    if not self.in_sacred_state:
                        self._status = PaymentDeviceStatus.PROCESSING
                else:
                    # Any XML response means the device is reachable
                    self._status = PaymentDeviceStatus.ONLINE
            else:
                self._status = PaymentDeviceStatus.OFFLINE
        except Exception as e:
            logger.error(f"Dejavoo health check failed: {e}")
            self._status = PaymentDeviceStatus.OFFLINE

        return self._status

    def _busy_result(self, transaction_id: str) -> TransactionResult:
        """Return a standard BUSY ERROR result used by every sacred-state
        gate. A caller that tries to start a new transaction while the
        device is AWAITING_CARD / PROCESSING should see a clean ERROR —
        not silently race the device."""
        return TransactionResult(
            transaction_id=transaction_id,
            status=TransactionStatus.ERROR,
            error=PaymentError(
                category=PaymentErrorCategory.DEVICE,
                error_code="DEVICE_BUSY",
                message=f"Device is {self._status.value}; cancel the prior transaction first",
                source="DejavooSPInAdapter",
            ),
        )

    async def initiate_sale(self, request: TransactionRequest) -> TransactionResult:
        xml = self._build_xml("Sale", {
            "PaymentType": "Credit",
            "Amount": f"{money_round(request.amount):.2f}",
            "Tip": f"{money_round(request.tip_amount):.2f}",
            "Frequency": "OneTime",
            "RefId": request.transaction_id,
            "ConfirmAmount": "No",
            "PrintReceipt": "No",
            "SigCapture": "No",
        })

        async with self._tx_lock:
            if self.in_sacred_state:
                return self._busy_result(request.transaction_id)
            self._status = PaymentDeviceStatus.AWAITING_CARD
            try:
                root = await self._send(xml)
                result = self._parse_response(root, request.transaction_id)
            except Exception:
                # Don't force IDLE here — the device may still physically
                # hold the card. Bubble up; check_status reconciles next.
                raise
            # Clean return: transaction resolved, device is idle again.
            self._status = PaymentDeviceStatus.IDLE
            return result

    async def initiate_refund(self, request: TransactionRequest) -> TransactionResult:
        xml = self._build_xml("Return", {
            "PaymentType": "Credit",
            "Amount": f"{money_round(request.amount):.2f}",
            "Frequency": "OneTime",
            "RefId": request.transaction_id,
            "ConfirmAmount": "No",
            "PrintReceipt": "No",
            "SigCapture": "No",
        })
        async with self._tx_lock:
            if self.in_sacred_state:
                return self._busy_result(request.transaction_id)
            self._status = PaymentDeviceStatus.PROCESSING
            try:
                root = await self._send(xml)
                result = self._parse_response(root, request.transaction_id)
            except Exception:
                raise
            self._status = PaymentDeviceStatus.IDLE
            return result

    async def initiate_void(self, request: TransactionRequest) -> TransactionResult:
        xml = self._build_xml("Void", {
            "RefId": request.transaction_id,
            "PrintReceipt": "No",
        })
        async with self._tx_lock:
            if self.in_sacred_state:
                return self._busy_result(request.transaction_id)
            self._status = PaymentDeviceStatus.PROCESSING
            try:
                root = await self._send(xml)
                result = self._parse_response(root, request.transaction_id)
            except Exception:
                raise
            self._status = PaymentDeviceStatus.IDLE
            return result

    async def cancel_transaction(self) -> bool:
        """Break the device out of a stuck transaction. Deliberately
        NOT gated by _tx_lock — this must be callable WHILE a sale is
        in flight so the manager's timeout-cancel path works. Status
        left alone; the next check_status will reconcile."""
        xml = self._build_xml("Cancel")
        try:
            root = await self._send(xml, timeout=10.0)
            if root is not None:
                msg = root.findtext("Message") or root.findtext("RespMSG") or ""
                return "Cancel" in msg
        except Exception as e:
            logger.warning("SPIn cancel_transaction raised: %s", e)
        return False

    async def adjust_tip(self, transaction_id: str, tip_amount: Decimal) -> TransactionResult:
        xml = self._build_xml("TipAdjust", {
            "RefId": transaction_id,
            "Tip": f"{money_round(tip_amount):.2f}",
        })
        async with self._tx_lock:
            if self.in_sacred_state:
                return self._busy_result(transaction_id)
            try:
                root = await self._send(xml)
                return self._parse_response(root, transaction_id)
            except Exception as e:
                logger.error("Tip adjust failed: %s", e)
                return TransactionResult(
                    transaction_id=transaction_id,
                    status=TransactionStatus.ERROR,
                    error=PaymentError(
                        category=PaymentErrorCategory.DEVICE,
                        error_code="TIP_ADJ_ERR",
                        message=str(e),
                        source="DejavooSPInAdapter",
                    ),
                )

    async def close_batch(self) -> BatchResult:
        xml = self._build_xml("BatchClose")
        # Batch close must not race a live sale (device cannot settle
        # with a pending authorization). Same lock as the starts.
        async with self._tx_lock:
            try:
                root = await self._send(xml)
                if root is not None:
                    resp_msg = root.findtext("RespMSG") or ""
                    success = "Approved" in resp_msg
                    # Harden the numeric parses: the device has been seen to
                    # emit `""` or a non-numeric marker in exceptional cases
                    # (post-outage, firmware quirks). Without these guards
                    # the int/Decimal coercion raises into the bare except
                    # below and we return FAILED with no reason — silent
                    # settlement drift.
                    try:
                        batch_count = int(root.findtext("BatchCount") or "0")
                    except (TypeError, ValueError):
                        logger.warning("SPIn close_batch: non-numeric BatchCount=%r", root.findtext("BatchCount"))
                        batch_count = 0
                    try:
                        batch_amount = Decimal(root.findtext("BatchAmount") or "0.00")
                    except Exception:
                        logger.warning("SPIn close_batch: non-decimal BatchAmount=%r", root.findtext("BatchAmount"))
                        batch_amount = Decimal("0.00")
                    return BatchResult(
                        batch_id=root.findtext("BatchID") or "UNKNOWN",
                        transaction_count=batch_count,
                        total_amount=batch_amount,
                        status=BatchStatus.SUCCESS if success else BatchStatus.FAILED,
                        timestamp=datetime.now()
                    )
            except Exception as e:
                # The bare `pass` here used to make every close_batch
                # failure invisible. Log so the bug report picks it up.
                logger.exception("SPIn close_batch raised: %s", e)
            return BatchResult(
                batch_id="ERROR",
                transaction_count=0,
                total_amount=Decimal("0.00"),
                status=BatchStatus.FAILED,
                error=PaymentError(
                    category=PaymentErrorCategory.SYSTEM,
                    error_code="BATCH_ERR",
                    message="Batch close failed",
                    source="DejavooSPInAdapter"
                )
            )

    async def get_device_info(self) -> Dict[str, Any]:
        return {
            "adapter": "DejavooSPInAdapter",
            "protocol": "SPIn HTTP GET (LAN)",
            "config": self._config.model_dump() if self._config else None
        }

    async def get_capabilities(self) -> List[PaymentType]:
        return [PaymentType.SALE, PaymentType.REFUND, PaymentType.VOID]

    # ── Protocol layer ────────────────────────────────────────────────────────

    def _build_xml(self, trans_type: str, params: Dict[str, str] = None) -> str:
        """Build DVSPIn XML with TransType and auth fields.

        Every value is XML-escaped before being inserted. Without this,
        a RefId / transaction_id containing `&`, `<`, `>`, or a quote
        produces malformed XML that the device rejects — or worse,
        that breaks parsing asymmetrically.
        """
        parts = ["<request>"]

        # Transaction params first (matches working first_transaction.py order)
        if params:
            for k, v in params.items():
                parts.append(f"<{k}>{_xml_escape(str(v))}</{k}>")

        # TransType (not <function>)
        parts.append(f"<TransType>{_xml_escape(trans_type)}</TransType>")

        # Auth fields
        if self._config:
            if self._config.register_id:
                parts.append(f"<RegisterId>{_xml_escape(str(self._config.register_id))}</RegisterId>")
            tpn = getattr(self._config, 'tpn', None) or ''
            if tpn:
                parts.append(f"<TPN>{_xml_escape(str(tpn))}</TPN>")
            auth_key = getattr(self._config, 'auth_key', None) or ''
            if auth_key:
                parts.append(f"<AuthKey>{_xml_escape(str(auth_key))}</AuthKey>")

        parts.append("</request>")
        return "".join(parts)

    async def _send(self, xml_body: str, timeout: float = None) -> Optional[ET.Element]:
        """
        Send SPIn request as HTTP GET:
        GET http://{ip}:{port}/spin/cgi.html?TerminalTransaction={url_encoded_xml}

        Returns parsed XML Element (the <response> inside <xmp>), or None.
        """
        if not self._config:
            return None

        encoded = urllib.parse.quote(xml_body, safe='')
        url = f"http://{self._config.ip_address}:{self._config.port}/spin/cgi.html?TerminalTransaction={encoded}"

        try:
            logger.debug("SPIn → GET %s:%s : %s", self._config.ip_address, self._config.port, xml_body)

            request_timeout = timeout or 60.0
            async with httpx.AsyncClient(timeout=request_timeout) as client:
                resp = await client.get(url)
            resp.raise_for_status()

            # Handle response as bytes if no charset detected
            try:
                body = resp.text.strip()
            except Exception:
                body = resp.content.decode('utf-8', errors='replace').strip()

            logger.debug("SPIn ← %s (%d bytes) %s", resp.status_code, len(body), body)

            # Strip <xmp>...</xmp> wrapper if present
            if "<xmp>" in body:
                body = body.split("<xmp>", 1)[-1]
            if "</xmp>" in body:
                body = body.split("</xmp>", 1)[0]

            body = body.strip()
            if not body:
                logger.info("SPIn ← empty body after stripping xmp")
                return None

            # URL-decode any encoded chars in the response
            body = urllib.parse.unquote(body)
            logger.debug("SPIn resp parsed: %s", body)

            try:
                return ET.fromstring(body)
            except ET.ParseError as pe:
                # DEV-004 — malformed response. Device is reachable and the
                # HTTP layer is fine, but the XML body doesn't parse.
                await _report_dev_event(
                    severity=DiagnosticSeverity.WARNING,
                    event_code="DEV-004",
                    message=f"Malformed SPIn response: {pe}",
                    context={
                        "device_ip": self._config.ip_address,
                        "body_len": len(body),
                        "body_head": body[:120],
                    },
                )
                return None

        except httpx.TimeoutException as e:
            # DEV-002 — device didn't respond within the per-call timeout.
            # This doesn't flip _status; check_status reconciles on next poll.
            logger.error("SPIn request failed: %s: %s", type(e).__name__, e)
            await _report_dev_event(
                severity=DiagnosticSeverity.WARNING,
                event_code="DEV-002",
                message=f"SPIn request timed out after {request_timeout}s",
                context={
                    "device_ip": self._config.ip_address,
                    "timeout_s": request_timeout,
                    "exc": type(e).__name__,
                },
            )
            return None

        except (httpx.ConnectError, httpx.NetworkError) as e:
            # DEV-003 — can't reach the device at all. Set_offline() will be
            # called elsewhere; we just record the observation for the
            # dashboard. Severity is WARNING (not ERROR): check_status may
            # find the device a moment later.
            logger.error("SPIn request failed: %s: %s", type(e).__name__, e)
            await _report_dev_event(
                severity=DiagnosticSeverity.WARNING,
                event_code="DEV-003",
                message=f"SPIn device unreachable: {type(e).__name__}: {e}",
                context={
                    "device_ip": self._config.ip_address,
                    "exc": type(e).__name__,
                },
            )
            return None

        except Exception as e:
            logger.error("SPIn request failed: %s: %s", type(e).__name__, e)
            await _report_dev_event(
                severity=DiagnosticSeverity.WARNING,
                event_code="DEV-004",
                message=f"SPIn request failed ({type(e).__name__}): {e}",
                context={
                    "device_ip": self._config.ip_address,
                    "exc": type(e).__name__,
                },
            )
            return None

    def _parse_response(self, root: Optional[ET.Element], expected_inv: str) -> TransactionResult:
        if root is None:
            return TransactionResult(
                transaction_id=expected_inv,
                status=TransactionStatus.ERROR,
                error=PaymentError(
                    category=PaymentErrorCategory.NETWORK,
                    error_code="CONN_FAIL",
                    message="Could not reach payment device",
                    source="DejavooSPInAdapter"
                )
            )

        try:
            resp_msg = root.findtext("RespMSG") or root.findtext("Message") or ""
            # URL-decode response message
            resp_msg = urllib.parse.unquote(resp_msg)

            result_code = root.findtext("ResultCode") or ""
            status = TransactionStatus.ERROR
            _resp_lower = resp_msg.lower()
            if result_code == "0" or (("approved" in _resp_lower or "approval" in _resp_lower) and "not" not in _resp_lower):
                status = TransactionStatus.APPROVED
            elif "Declined" in resp_msg:
                status = TransactionStatus.DECLINED
            elif "Cancel" in resp_msg:
                status = TransactionStatus.CANCELLED

            entry_map = {
                "Swipe": EntryMethod.SWIPE,
                "Chip": EntryMethod.CHIP,
                "Contactless": EntryMethod.TAP,
                "Manual": EntryMethod.MANUAL,
            }
            entry_mode = entry_map.get(root.findtext("EntryMode") or "", EntryMethod.TAP)

            # Card details may be in ExtData (e.g. "CardType=VISA,AcntLast4=0049,Amount=0.01")
            card_brand = root.findtext("CardBrand") or root.findtext("CardType") or ""
            last_four = root.findtext("LastFour") or root.findtext("AcntLast4") or ""
            ext_data = root.findtext("ExtData") or ""
            if ext_data:
                for pair in ext_data.split(","):
                    pair = pair.strip()
                    if pair.startswith("CardType=") and not card_brand:
                        card_brand = pair.split("=", 1)[1]
                    elif pair.startswith("AcntLast4=") and not last_four:
                        last_four = pair.split("=", 1)[1]

            return TransactionResult(
                transaction_id=root.findtext("RefId") or root.findtext("InvNum") or expected_inv,
                status=status,
                authorization_code=root.findtext("AuthCode"),
                reference_number=root.findtext("Token"),
                card_brand=card_brand or None,
                last_four=last_four or None,
                entry_method=entry_mode,
                processor_response_code=result_code,
                processor_message=resp_msg,
                timestamp=datetime.now()
            )

        except Exception as e:
            return TransactionResult(
                transaction_id=expected_inv,
                status=TransactionStatus.ERROR,
                error=PaymentError(
                    category=PaymentErrorCategory.SYSTEM,
                    error_code="PARSE_FAIL",
                    message=f"Failed to parse Dejavoo response: {e}",
                    source="DejavooSPInAdapter"
                )
            )
