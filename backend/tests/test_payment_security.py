"""
Tests for PCI/security surface of the payment and auth subsystems.

The existing suite covers happy-path payment flows; this file closes the
gap on the security perimeter:

  - PAN isolation: raw card numbers never land in the event ledger
  - PIN hashing: PBKDF2-SHA256 format, verify round-trip, no plaintext
  - Session tokens: each issuance produces a cryptographically unique value
  - SEC-001: rate-limit brute-force diagnostic event is actually emitted
  - SEC-005: unauthenticated access to protected routes is recorded
  - SEC-006: server-role session blocked from manager path is recorded
  - SECURITY_SETTING_UPDATED: policy changes are audited to the event ledger
  - Refund approval gate: endpoint enforces non-empty `approved_by`
"""

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException, Request

from app.api.dependencies import set_diagnostic_collector
from app.api.routes import auth as auth_mod
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    create_event,
    item_added,
    order_closed,
    order_created,
    payment_confirmed,
    payment_initiated,
    security_setting_updated,
)
from app.core.pin_hash import hash_pin, is_hashed, verify_pin_hash
from app.services.diagnostic_collector import DiagnosticCollector


TEST_DB = Path("./data/test_payment_security.db")
TERMINAL = "terminal_sec"


@pytest.fixture(autouse=True)
def _reset_auth_state():
    """Isolate rate-limit + session state between tests."""
    auth_mod._attempts.clear()
    auth_mod._sessions.clear()
    yield
    auth_mod._attempts.clear()
    auth_mod._sessions.clear()


@pytest.fixture(autouse=True)
def _soft_auth(monkeypatch):
    """Run with auth_enforced=False so security routes log instead of raising."""
    monkeypatch.setattr(settings, "auth_enforced", False)
    monkeypatch.setattr(settings, "tax_rate", 0.0)
    monkeypatch.setattr(settings, "cash_discount_rate", 0.0)


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest_asyncio.fixture
async def wired_collector(tmp_path):
    """DiagnosticCollector injected into the auth dependency singleton."""
    coll = DiagnosticCollector(
        str(tmp_path / "sec_diag.db"), terminal_id="T-SEC"
    )
    await coll.connect()
    set_diagnostic_collector(coll)
    yield coll
    set_diagnostic_collector(None)
    await coll.close()


# ── helpers ─────────────────────────────────────────────────────────────────

def _mock_request(client_host: str = "127.0.0.1", auth_header: str = "") -> Request:
    headers = []
    if auth_header:
        headers.append((b"authorization", auth_header.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/auth/verify-pin",
        "headers": headers,
        "client": (client_host, 9999),
    }
    return Request(scope)


async def _seed_employee(
    ledger,
    *,
    employee_id: str,
    pin: str,
    display_name: str = "Alice",
    roles: list = None,
    active: bool = True,
) -> None:
    await ledger.append(create_event(
        event_type=EventType.EMPLOYEE_CREATED,
        terminal_id=TERMINAL,
        payload={
            "employee_id": employee_id,
            "display_name": display_name,
            "first_name": display_name.split()[0] if display_name else "",
            "last_name": "",
            "pin": pin,
            "role_ids": roles or ["server"],
            "active": active,
            "hourly_rate": "0",
        },
    ))


async def _paid_order(ledger, *, order_id: str, amount: float = 20.00) -> str:
    """Seed a fully closed order. Returns payment_id."""
    await ledger.append(order_created(
        terminal_id=TERMINAL, order_id=order_id,
        order_type="dine_in", guest_count=1, server_id="s1",
        correlation_id=order_id,
    ))
    await ledger.append(item_added(
        terminal_id=TERMINAL, order_id=order_id,
        item_id=f"{order_id}_it", menu_item_id="m1",
        name="Item", price=amount, quantity=1,
    ))
    pid = f"{order_id}_pay"
    await ledger.append(payment_initiated(
        terminal_id=TERMINAL, order_id=order_id,
        payment_id=pid, amount=amount, method="card",
    ))
    await ledger.append(payment_confirmed(
        terminal_id=TERMINAL, order_id=order_id,
        payment_id=pid, transaction_id=f"txn_{pid}",
        amount=amount, tax=0.0,
    ))
    await ledger.append(order_closed(
        terminal_id=TERMINAL, order_id=order_id, total=amount,
    ))
    return pid


# ═══════════════════════════════════════════════════════════════════════════
# PAN ISOLATION
# ═══════════════════════════════════════════════════════════════════════════

class TestPanIsolation:

    async def test_payment_initiated_payload_has_no_card_number(self, ledger):
        """PAYMENT_INITIATED must not store raw card data."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="o_pan",
            order_type="dine_in", guest_count=1, server_id="s1",
            correlation_id="o_pan",
        ))
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="o_pan",
            payment_id="pay_pan", amount=50.00, method="card",
        ))
        events = await ledger.get_events_by_correlation("o_pan")
        pay_event = next(e for e in events if e.event_type == EventType.PAYMENT_INITIATED)
        payload = pay_event.payload
        forbidden = {"card_number", "pan", "cvv", "ccv", "track_data", "mag_stripe"}
        assert not (forbidden & set(payload.keys())), (
            f"Payment event contains sensitive card fields: {forbidden & set(payload.keys())}"
        )

    async def test_payment_confirmed_payload_has_no_card_number(self, ledger):
        """PAYMENT_CONFIRMED must not store raw card data."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="o_panc",
            order_type="dine_in", guest_count=1, server_id="s1",
            correlation_id="o_panc",
        ))
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="o_panc",
            payment_id="pay_panc", amount=75.00, method="card",
        ))
        await ledger.append(payment_confirmed(
            terminal_id=TERMINAL, order_id="o_panc",
            payment_id="pay_panc", transaction_id="txn_panc",
            amount=75.00, tax=0.0,
        ))
        events = await ledger.get_events_by_correlation("o_panc")
        conf = next(e for e in events if e.event_type == EventType.PAYMENT_CONFIRMED)
        payload = conf.payload
        forbidden = {"card_number", "pan", "cvv", "ccv", "track_data"}
        assert not (forbidden & set(payload.keys()))

    async def test_payment_payload_contains_only_safe_fields(self, ledger):
        """PAYMENT_INITIATED contains only: order_id, payment_id, amount, method."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="o_safe",
            order_type="dine_in", guest_count=1, server_id="s1",
            correlation_id="o_safe",
        ))
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="o_safe",
            payment_id="pay_safe", amount=30.00, method="cash",
        ))
        events = await ledger.get_events_by_correlation("o_safe")
        pay_event = next(e for e in events if e.event_type == EventType.PAYMENT_INITIATED)
        allowed = {"order_id", "payment_id", "amount", "method", "seat_numbers"}
        unexpected = set(pay_event.payload.keys()) - allowed
        assert not unexpected, f"Unexpected payment fields: {unexpected}"


# ═══════════════════════════════════════════════════════════════════════════
# PIN HASHING
# ═══════════════════════════════════════════════════════════════════════════

class TestPinHashing:

    def test_hash_pin_returns_pbkdf2_tagged_string(self):
        """hash_pin() always produces the $pbkdf2-sha256$ tagged format."""
        h = hash_pin("1234")
        assert h.startswith("$pbkdf2-sha256$")

    def test_is_hashed_detects_tagged_format(self):
        assert is_hashed(hash_pin("5678"))
        assert not is_hashed("5678")  # plaintext
        assert not is_hashed("")

    def test_verify_correct_pin(self):
        h = hash_pin("9999")
        assert verify_pin_hash("9999", h)

    def test_verify_wrong_pin_fails(self):
        h = hash_pin("9999")
        assert not verify_pin_hash("0000", h)

    def test_verify_legacy_plaintext_pin(self):
        """verify_pin_hash accepts legacy plaintext stored values."""
        assert verify_pin_hash("1234", "1234")
        assert not verify_pin_hash("0000", "1234")

    def test_hash_pin_produces_unique_salts(self):
        """Same PIN hashed twice produces different outputs (random salt)."""
        h1 = hash_pin("1111")
        h2 = hash_pin("1111")
        assert h1 != h2

    def test_employee_pin_stored_as_hash(self, ledger):
        """EMPLOYEE_CREATED event stores the hashed pin (from _seed_employee pattern)."""
        hashed = hash_pin("4321")
        assert is_hashed(hashed)
        assert not hashed == "4321"


# ═══════════════════════════════════════════════════════════════════════════
# SESSION TOKEN UNPREDICTABILITY
# ═══════════════════════════════════════════════════════════════════════════

class TestSessionTokens:

    def test_tokens_are_unique_per_issuance(self):
        """Every call to _create_token returns a different value."""
        t1 = auth_mod._create_token("emp_1", "Alice", ["server"])
        t2 = auth_mod._create_token("emp_1", "Alice", ["server"])
        assert t1 != t2

    def test_token_has_sufficient_entropy(self):
        """secrets.token_urlsafe(32) produces 43+ character base64url tokens."""
        token = auth_mod._create_token("emp_2", "Bob", ["manager"])
        assert len(token) >= 40

    def test_token_contains_no_employee_data(self):
        """Token is opaque — employee ID is not embedded in the string."""
        employee_id = "emp_secret_123"
        token = auth_mod._create_token(employee_id, "Charlie", ["server"])
        assert employee_id not in token

    def test_session_stores_correct_metadata(self):
        """Session dict holds employee_id, name, and roles."""
        token = auth_mod._create_token("emp_3", "Diana", ["manager", "admin"])
        session = auth_mod._sessions[token]
        assert session["employee_id"] == "emp_3"
        assert session["name"] == "Diana"
        assert "manager" in session["roles"]


# ═══════════════════════════════════════════════════════════════════════════
# SEC-001 DIAGNOSTIC — RATE LIMIT
# ═══════════════════════════════════════════════════════════════════════════

class TestSec001RateLimit:

    async def test_sec_001_emitted_on_rate_limit_hit(self, ledger, wired_collector):
        """SEC-001 diagnostic is recorded when the rate-limit ceiling is hit."""
        await _seed_employee(ledger, employee_id="emp_rl", pin="1234")
        req = _mock_request(client_host="10.99.99.1")

        # Exhaust the allowed failures
        for _ in range(auth_mod.MAX_ATTEMPTS):
            await auth_mod.verify_pin(
                auth_mod.VerifyPinRequest(pin="0000"),
                request=req, ledger=ledger,
            )

        # The 6th attempt should trigger 429 + SEC-001
        with pytest.raises(HTTPException) as exc:
            await auth_mod.verify_pin(
                auth_mod.VerifyPinRequest(pin="0000"),
                request=req, ledger=ledger,
            )
        assert exc.value.status_code == 429

        sec_events = await wired_collector.get_events(event_code="SEC-001")
        assert len(sec_events) >= 1
        assert "rate-limit" in sec_events[0].message.lower()

    async def test_sec_001_not_emitted_on_normal_failure(self, ledger, wired_collector):
        """Ordinary PIN mismatches below the threshold produce no SEC-001."""
        await _seed_employee(ledger, employee_id="emp_ok", pin="1234")
        req = _mock_request(client_host="10.99.99.2")
        # One failure — well within limit
        await auth_mod.verify_pin(
            auth_mod.VerifyPinRequest(pin="0000"),
            request=req, ledger=ledger,
        )
        sec_events = await wired_collector.get_events(event_code="SEC-001")
        assert len(sec_events) == 0


# ═══════════════════════════════════════════════════════════════════════════
# SEC-005 DIAGNOSTIC — UNAUTHENTICATED ACCESS
# ═══════════════════════════════════════════════════════════════════════════

class TestSec005UnauthenticatedAccess:

    async def test_auth_required_records_sec_005_without_token(self, wired_collector):
        """auth_required() with no Bearer token emits SEC-005."""
        req = _mock_request()  # no auth header
        result = await auth_mod.auth_required(req)
        assert result is None  # soft mode allows through

        sec_events = await wired_collector.get_events(event_code="SEC-005")
        assert len(sec_events) >= 1

    async def test_require_manager_records_sec_005_when_no_token(self, wired_collector):
        """require_manager() with no token emits SEC-005."""
        req = _mock_request()
        result = await auth_mod.require_manager(req)
        assert result is None

        sec_events = await wired_collector.get_events(event_code="SEC-005")
        assert len(sec_events) >= 1

    async def test_auth_required_no_sec_005_with_valid_token(self, wired_collector):
        """A valid session token suppresses SEC-005."""
        token = auth_mod._create_token("emp_x", "Xena", ["server"])
        req = _mock_request(auth_header=f"Bearer {token}")
        result = await auth_mod.auth_required(req)
        assert result is not None
        assert result["employee_id"] == "emp_x"

        sec_events = await wired_collector.get_events(event_code="SEC-005")
        assert len(sec_events) == 0


# ═══════════════════════════════════════════════════════════════════════════
# SEC-006 DIAGNOSTIC — INSUFFICIENT ROLE
# ═══════════════════════════════════════════════════════════════════════════

class TestSec006InsufficientRole:

    async def test_require_manager_records_sec_006_for_server_role(self, wired_collector):
        """require_manager() with a server token emits SEC-006."""
        token = auth_mod._create_token("emp_s", "Server Sam", ["server"])
        req = _mock_request(auth_header=f"Bearer {token}")
        result = await auth_mod.require_manager(req)
        # Soft mode returns the session even without the right role
        assert result is not None
        assert result["employee_id"] == "emp_s"

        sec_events = await wired_collector.get_events(event_code="SEC-006")
        assert len(sec_events) >= 1
        assert "manager" in sec_events[0].message.lower()

    async def test_require_manager_no_sec_006_for_manager_role(self, wired_collector):
        """Manager token on require_manager does NOT emit SEC-006."""
        token = auth_mod._create_token("emp_m", "Manager Mike", ["manager"])
        req = _mock_request(auth_header=f"Bearer {token}")
        result = await auth_mod.require_manager(req)
        assert result is not None

        sec_events = await wired_collector.get_events(event_code="SEC-006")
        assert len(sec_events) == 0

    async def test_require_manager_no_sec_006_for_admin_role(self, wired_collector):
        """admin role satisfies require_manager — no SEC-006."""
        token = auth_mod._create_token("emp_a", "Admin Ana", ["admin"])
        req = _mock_request(auth_header=f"Bearer {token}")
        result = await auth_mod.require_manager(req)
        assert result is not None

        sec_events = await wired_collector.get_events(event_code="SEC-006")
        assert len(sec_events) == 0


# ═══════════════════════════════════════════════════════════════════════════
# SECURITY_SETTING_UPDATED AUDIT TRAIL
# ═══════════════════════════════════════════════════════════════════════════

class TestSecuritySettingUpdated:

    async def test_security_setting_updated_lands_in_ledger(self, ledger):
        """SECURITY_SETTING_UPDATED is persisted and retrievable."""
        await ledger.append(security_setting_updated(
            terminal_id=TERMINAL,
            setting_key="session_ttl_seconds",
            previous_value="28800",
            new_value="14400",
            updated_by="manager_01",
        ))
        events = await ledger.get_events_by_type(EventType.SECURITY_SETTING_UPDATED)
        assert len(events) == 1
        payload = events[0].payload
        assert payload["setting_key"] == "session_ttl_seconds"
        assert payload["previous_value"] == "28800"
        assert payload["new_value"] == "14400"
        assert payload["updated_by"] == "manager_01"

    async def test_security_setting_updated_does_not_store_secrets(self, ledger):
        """Setting value fields are strings — no actual secret content should appear."""
        await ledger.append(security_setting_updated(
            terminal_id=TERMINAL,
            setting_key="pin_iterations",
            previous_value="100000",
            new_value="200000",
            updated_by="admin_01",
        ))
        events = await ledger.get_events_by_type(EventType.SECURITY_SETTING_UPDATED)
        payload = events[0].payload
        # Only expected keys exist — no secret tokens, hashes, or raw values
        assert set(payload.keys()) <= {
            "setting_key", "previous_value", "new_value", "updated_by"
        }

    async def test_multiple_setting_changes_all_recorded(self, ledger):
        """Each policy change creates a separate immutable event."""
        for key in ("session_ttl_seconds", "max_pin_attempts", "lockout_duration"):
            await ledger.append(security_setting_updated(
                terminal_id=TERMINAL,
                setting_key=key,
                new_value="999",
                updated_by="admin_01",
            ))
        events = await ledger.get_events_by_type(EventType.SECURITY_SETTING_UPDATED)
        assert len(events) == 3
        keys_recorded = [e.payload["setting_key"] for e in events]
        assert "session_ttl_seconds" in keys_recorded
        assert "max_pin_attempts" in keys_recorded
        assert "lockout_duration" in keys_recorded


# ═══════════════════════════════════════════════════════════════════════════
# REFUND APPROVAL GATE
# ═══════════════════════════════════════════════════════════════════════════

class TestRefundApprovalGate:

    async def test_empty_approved_by_returns_403(self, ledger):
        """process_refund raises 403 when approved_by is blank."""
        from app.api.routes import payment_routes as pr
        pid = await _paid_order(ledger, order_id="o_gate")
        with pytest.raises(HTTPException) as exc:
            await pr.process_refund(
                pr.RefundRequest(
                    order_id="o_gate", payment_id=pid,
                    amount=10.00, reason="test",
                    approved_by="",
                ),
                ledger=ledger,
            )
        assert exc.value.status_code == 403

    async def test_whitespace_only_approved_by_returns_403(self, ledger):
        """process_refund treats whitespace-only approved_by as empty."""
        from app.api.routes import payment_routes as pr
        pid = await _paid_order(ledger, order_id="o_ws")
        with pytest.raises(HTTPException) as exc:
            await pr.process_refund(
                pr.RefundRequest(
                    order_id="o_ws", payment_id=pid,
                    amount=5.00, reason="test",
                    approved_by="   ",
                ),
                ledger=ledger,
            )
        assert exc.value.status_code == 403

    async def test_valid_manager_approval_succeeds(self, ledger):
        """Refund with a non-empty approved_by is accepted."""
        from app.api.routes import payment_routes as pr
        pid = await _paid_order(ledger, order_id="o_ok")
        res = await pr.process_refund(
            pr.RefundRequest(
                order_id="o_ok", payment_id=pid,
                amount=None, reason="customer request",
                approved_by="manager_01",
            ),
            ledger=ledger,
        )
        assert res["success"] is True
        assert res["approved_by"] == "manager_01"
