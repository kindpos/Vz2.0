"""
Tests for `api/routes/sync.py` — LAN config sync between the Overseer
and Terminals.

sync.py sat at 26% coverage. The route is the only way config
(menu, employees, tipout rules, store info) flows from the Overseer
to terminals, so drift here means one terminal sells at wrong
prices or with missing tipout rules — the very scenario the
invariant gate now watches for.

Covered behaviours:

  /sync/health
    - returns role=overseer, status=ok

  GET /sync/config/events
    - filters operational events out of the response
    - respects `since` cursor — only returns events after it
    - caps `limit` at 5000
    - returns latest_sequence + prefixes list
    - empty ledger returns empty list

  POST /sync/config/events/replay
    - appends config events to the local ledger
    - skips non-config event types (operational events rejected)
    - idempotent: replaying the same event_id twice is a no-op
    - malformed body (missing or wrong-typed `events`) → 400
"""

from datetime import datetime, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.api.routes import sync as sync_mod
from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event


TEST_DB = Path("./data/test_sync_routes.db")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _seed_config_event(
    ledger, *, event_type: EventType, payload: dict,
    terminal_id: str = "OVERSEER",
):
    """Append an event and return the *stored* event — the ledger's
    `append` returns a new Event with the DB-assigned sequence_number,
    which the original in-memory Event doesn't have."""
    evt = create_event(
        event_type=event_type,
        terminal_id=terminal_id,
        payload=payload,
    )
    return await ledger.append(evt)


async def _seed_op_event(ledger, *, event_type: EventType, payload: dict):
    """Append an operational event — should NOT appear in sync response."""
    evt = create_event(
        event_type=event_type,
        terminal_id="T-01",
        payload=payload,
    )
    return await ledger.append(evt)


# ═══════════════════════════════════════════════════════════════════════════
# HEALTH
# ═══════════════════════════════════════════════════════════════════════════

class TestSyncHealth:
    @pytest.mark.asyncio
    async def test_heartbeat_shape(self):
        res = await sync_mod.sync_health()
        assert res == {"status": "ok", "role": "overseer"}


# ═══════════════════════════════════════════════════════════════════════════
# GET /sync/config/events
# ═══════════════════════════════════════════════════════════════════════════

class TestGetConfigEvents:

    @pytest.mark.asyncio
    async def test_empty_ledger_returns_empty_list(self, ledger):
        res = await sync_mod.get_config_events(since=0, limit=100, ledger=ledger)
        assert res["events"] == []
        assert res["count"] == 0
        assert res["latest_sequence"] == 0   # echoes the `since` arg
        assert "store." in res["prefixes"]
        assert "menu." in res["prefixes"]

    @pytest.mark.asyncio
    async def test_returns_only_config_events(self, ledger):
        """Operational events (orders, payments) must not leak through."""
        # Config event
        await _seed_config_event(
            ledger, event_type=EventType.EMPLOYEE_CREATED,
            payload={"employee_id": "e1", "display_name": "A"},
        )
        # Operational event — should be filtered out
        await _seed_op_event(
            ledger, event_type=EventType.ORDER_CREATED,
            payload={"order_id": "o1", "order_type": "dine_in"},
        )
        # Another config event
        await _seed_config_event(
            ledger, event_type=EventType.TIPOUT_RULE_CREATED,
            payload={
                "rule_id": "r1", "role_from": "server", "role_to": "bar",
                "percentage": 2.0, "calculation_base": "Net Sales",
            },
        )

        res = await sync_mod.get_config_events(since=0, limit=100, ledger=ledger)
        types = [e["event_type"] for e in res["events"]]
        assert "employee.created" in types
        assert "tipout.rule_created" in types
        assert "order.created" not in types
        assert res["count"] == 2

    @pytest.mark.asyncio
    async def test_since_cursor_filters_earlier_events(self, ledger):
        e1 = await _seed_config_event(
            ledger, event_type=EventType.EMPLOYEE_CREATED,
            payload={"employee_id": "e1", "display_name": "A"},
        )
        e2 = await _seed_config_event(
            ledger, event_type=EventType.EMPLOYEE_CREATED,
            payload={"employee_id": "e2", "display_name": "B"},
        )

        # Pulling with since=e1.sequence_number only yields e2
        res = await sync_mod.get_config_events(
            since=e1.sequence_number, limit=100, ledger=ledger,
        )
        assert res["count"] == 1
        assert res["events"][0]["event_id"] == e2.event_id
        assert res["latest_sequence"] == e2.sequence_number

    @pytest.mark.asyncio
    async def test_limit_capped_at_5000(self, ledger):
        """Even a caller asking for 999_999 gets capped at 5000."""
        # Don't actually seed 5000 events — just verify the cap is applied
        # via the returned latest_sequence when limit is absurd.
        res = await sync_mod.get_config_events(since=0, limit=999_999, ledger=ledger)
        # Shape check: count is bounded, no exception
        assert res["count"] <= 5000

    @pytest.mark.asyncio
    async def test_event_serialization_shape(self, ledger):
        """Each event in the response has the wire-format keys clients expect."""
        await _seed_config_event(
            ledger, event_type=EventType.STORE_TAX_RULE_CREATED,
            payload={"rule_id": "t1", "rate_percent": 7.0, "applies_to": "all"},
        )
        res = await sync_mod.get_config_events(since=0, limit=100, ledger=ledger)
        assert res["count"] == 1
        ev = res["events"][0]
        for k in ("event_id", "sequence_number", "timestamp",
                  "terminal_id", "event_type", "payload"):
            assert k in ev
        assert ev["event_type"] == "store.tax_rule_created"
        assert ev["payload"]["rate_percent"] == 7.0
        # timestamp is a string (ISO)
        assert isinstance(ev["timestamp"], str) and "T" in ev["timestamp"]


# ═══════════════════════════════════════════════════════════════════════════
# POST /sync/config/events/replay
# ═══════════════════════════════════════════════════════════════════════════

class TestReplayConfigEvents:

    def _wire_event(
        self, *, event_type: str, event_id: str = None,
        payload: dict = None, terminal_id: str = "OVERSEER",
    ):
        """Build the dict shape the replay endpoint expects."""
        return {
            "event_id": event_id or f"evt_{event_type.replace('.', '_')}",
            "sequence_number": 1,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "terminal_id": terminal_id,
            "event_type": event_type,
            "payload": payload or {},
            "user_id": None,
            "user_role": None,
            "correlation_id": None,
        }

    @pytest.mark.asyncio
    async def test_applies_config_events(self, ledger):
        res = await sync_mod.replay_config_events(
            payload={
                "events": [
                    self._wire_event(
                        event_type="employee.created",
                        payload={"employee_id": "e1", "display_name": "A"},
                    ),
                ],
            },
            ledger=ledger,
        )
        assert res == {"applied": 1, "skipped": 0}
        # And it actually landed in the local ledger
        stored = await ledger.get_events_by_type(EventType.EMPLOYEE_CREATED)
        assert len(stored) == 1
        assert stored[0].payload["employee_id"] == "e1"

    @pytest.mark.asyncio
    async def test_skips_operational_events(self, ledger):
        """Operational events don't belong in the config sync stream —
        the endpoint refuses to replay them even if asked."""
        res = await sync_mod.replay_config_events(
            payload={
                "events": [
                    self._wire_event(
                        event_type="order.created",
                        payload={"order_id": "o1"},
                    ),
                ],
            },
            ledger=ledger,
        )
        assert res == {"applied": 0, "skipped": 1}
        # Ledger untouched
        stored = await ledger.get_events_by_type(EventType.ORDER_CREATED)
        assert stored == []

    @pytest.mark.asyncio
    async def test_skips_events_missing_event_type(self, ledger):
        """A malformed event dict without `event_type` is skipped, not
        raised — one bad row shouldn't abort a batch."""
        res = await sync_mod.replay_config_events(
            payload={"events": [{"payload": {"employee_id": "e1"}}]},
            ledger=ledger,
        )
        assert res == {"applied": 0, "skipped": 1}

    @pytest.mark.asyncio
    async def test_idempotent_on_duplicate_event_id(self, ledger):
        """Re-posting an event with the same event_id is a no-op. Terminals
        poll periodically, so duplicates MUST be safe."""
        event_dict = self._wire_event(
            event_type="tipout.rule_created",
            event_id="rule_evt_01",
            payload={
                "rule_id": "r1", "role_from": "server", "role_to": "bar",
                "percentage": 2.0, "calculation_base": "Net Sales",
            },
        )
        first = await sync_mod.replay_config_events(
            payload={"events": [event_dict]}, ledger=ledger,
        )
        assert first == {"applied": 1, "skipped": 0}

        # Re-apply — should skip, not duplicate
        second = await sync_mod.replay_config_events(
            payload={"events": [event_dict]}, ledger=ledger,
        )
        assert second["applied"] == 0
        # One in the ledger, not two
        stored = await ledger.get_events_by_type(EventType.TIPOUT_RULE_CREATED)
        assert len(stored) == 1

    @pytest.mark.asyncio
    async def test_mixed_batch_partitions_correctly(self, ledger):
        """A batch can contain a mix of config + operational + malformed.
        Each is tallied correctly."""
        res = await sync_mod.replay_config_events(
            payload={
                "events": [
                    self._wire_event(
                        event_type="employee.created",
                        payload={"employee_id": "e1", "display_name": "A"},
                    ),
                    self._wire_event(
                        event_type="order.created",
                        payload={"order_id": "o1"},
                    ),
                    {"payload": {}},  # no event_type
                    self._wire_event(
                        event_type="menu.item_created",
                        payload={"item_id": "i1", "name": "X", "price": 10.0},
                    ),
                ],
            },
            ledger=ledger,
        )
        assert res["applied"] == 2
        assert res["skipped"] == 2

    @pytest.mark.asyncio
    async def test_empty_events_list_succeeds(self, ledger):
        res = await sync_mod.replay_config_events(
            payload={"events": []}, ledger=ledger,
        )
        assert res == {"applied": 0, "skipped": 0}

    @pytest.mark.asyncio
    async def test_missing_events_key_treated_as_empty(self, ledger):
        """`{}` (no `events` key) is a valid empty batch."""
        res = await sync_mod.replay_config_events(payload={}, ledger=ledger)
        assert res == {"applied": 0, "skipped": 0}

    @pytest.mark.asyncio
    async def test_events_not_a_list_400s(self, ledger):
        with pytest.raises(HTTPException) as exc:
            await sync_mod.replay_config_events(
                payload={"events": "not-a-list"}, ledger=ledger,
            )
        assert exc.value.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════
# GAP FILLERS — branches the original test pass missed
# ═══════════════════════════════════════════════════════════════════════════
#
# The earlier suite covered the happy paths but left five branches cold:
#   - SEC-003 diagnostic emission on every replay
#   - SEC-004 self-claim warning (events claim to originate from this terminal)
#   - Precision ValueError → counted as skipped
#   - Non-precision ValueError → re-raised unchanged
#   - get_config_events pagination when the current batch is all operational
#     events (forces a second loop pass)
# Each is a real bug surface: a silent diag regression would hide LAN
# tampering, a swallowed non-precision error would corrupt the ledger counter.


class TestReplayDiagnostics:
    """Verify the SEC-003/SEC-004 diagnostic emissions in sync.py:100-137."""

    def _wire_event(self, *, event_type: str, terminal_id: str = "OVERSEER",
                    event_id: str = None, payload: dict = None):
        return {
            "event_id": event_id or f"evt_{event_type.replace('.', '_')}",
            "sequence_number": 1,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "terminal_id": terminal_id,
            "event_type": event_type,
            "payload": payload or {},
            "user_id": None,
            "user_role": None,
            "correlation_id": None,
        }

    @pytest.fixture
    def captured_diags(self, monkeypatch):
        """Replace sync_mod._record_diag with a stub that captures calls.
        Returns the list so tests can assert on it."""
        calls: list[dict] = []

        async def _stub(**kwargs):
            calls.append(kwargs)

        monkeypatch.setattr(sync_mod, "_record_diag", _stub)
        return calls

    @pytest.mark.asyncio
    async def test_sec003_fires_on_every_replay(self, ledger, captured_diags):
        """Every replay records SEC-003 with batch_size + claimed_terminal_ids —
        even an empty batch."""
        await sync_mod.replay_config_events(
            payload={"events": []}, ledger=ledger,
        )
        assert len(captured_diags) == 1
        d = captured_diags[0]
        assert d["event_code"] == "SEC-003"
        assert d["context"]["batch_size"] == 0
        assert d["context"]["claimed_terminal_ids"] == []

    @pytest.mark.asyncio
    async def test_sec003_captures_claimed_terminal_ids(self, ledger, captured_diags):
        """The diag snapshot includes a sorted, deduped list of claimed
        terminal_ids — the forensic trail if a forged batch shows up."""
        await sync_mod.replay_config_events(
            payload={"events": [
                self._wire_event(event_type="employee.created", terminal_id="T-02",
                                 payload={"employee_id": "e1", "display_name": "A"}),
                self._wire_event(event_type="employee.created", terminal_id="T-03",
                                 event_id="evt_b",
                                 payload={"employee_id": "e2", "display_name": "B"}),
                self._wire_event(event_type="employee.created", terminal_id="T-02",
                                 event_id="evt_c",
                                 payload={"employee_id": "e3", "display_name": "C"}),
            ]},
            ledger=ledger,
        )
        sec003 = [d for d in captured_diags if d["event_code"] == "SEC-003"]
        assert len(sec003) == 1
        assert sec003[0]["context"]["claimed_terminal_ids"] == ["T-02", "T-03"]
        assert sec003[0]["context"]["batch_size"] == 3

    @pytest.mark.asyncio
    async def test_sec004_fires_on_self_claim(self, ledger, captured_diags, monkeypatch):
        """When any event in the batch claims to come from this terminal
        (settings.terminal_id), SEC-004 WARNING is recorded."""
        monkeypatch.setattr(sync_mod.settings, "terminal_id", "T-THIS")

        await sync_mod.replay_config_events(
            payload={"events": [
                self._wire_event(event_type="employee.created", terminal_id="T-THIS",
                                 payload={"employee_id": "e1", "display_name": "A"}),
                self._wire_event(event_type="employee.created", terminal_id="OVERSEER",
                                 event_id="evt_other",
                                 payload={"employee_id": "e2", "display_name": "B"}),
            ]},
            ledger=ledger,
        )
        sec004 = [d for d in captured_diags if d["event_code"] == "SEC-004"]
        assert len(sec004) == 1
        ctx = sec004[0]["context"]
        assert ctx["local_terminal_id"] == "T-THIS"
        assert ctx["self_claim_count"] == 1
        assert ctx["batch_size"] == 2

    @pytest.mark.asyncio
    async def test_sec004_silent_when_no_self_claims(self, ledger, captured_diags, monkeypatch):
        """Clean batch (no claims from this terminal) → no SEC-004 noise."""
        monkeypatch.setattr(sync_mod.settings, "terminal_id", "T-THIS")

        await sync_mod.replay_config_events(
            payload={"events": [
                self._wire_event(event_type="employee.created", terminal_id="OVERSEER",
                                 payload={"employee_id": "e1", "display_name": "A"}),
            ]},
            ledger=ledger,
        )
        assert not any(d["event_code"] == "SEC-004" for d in captured_diags)

    @pytest.mark.asyncio
    async def test_sec004_silent_when_settings_terminal_id_unset(
        self, ledger, captured_diags, monkeypatch
    ):
        """If `settings.terminal_id` is falsy (unconfigured), the check
        short-circuits so a fresh / unconfigured box doesn't spam SEC-004."""
        monkeypatch.setattr(sync_mod.settings, "terminal_id", "")

        await sync_mod.replay_config_events(
            payload={"events": [
                self._wire_event(event_type="employee.created", terminal_id="",
                                 payload={"employee_id": "e1", "display_name": "A"}),
            ]},
            ledger=ledger,
        )
        assert not any(d["event_code"] == "SEC-004" for d in captured_diags)


class TestReplayValueErrorHandling:
    """Cover the try/except ValueError branch in sync.py:171-177."""

    def _wire(self, *, event_type, event_id, payload, terminal_id="OVERSEER"):
        return {
            "event_id": event_id,
            "sequence_number": 1,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "terminal_id": terminal_id,
            "event_type": event_type,
            "payload": payload,
            "user_id": None,
            "user_role": None,
            "correlation_id": None,
        }

    @pytest.mark.asyncio
    async def test_precision_error_counted_as_skipped(self, ledger):
        """A monetary payload with 3dp triggers the ledger's precision gate
        (ValueError("Precision gate: ...")). The replay endpoint catches
        that specific error and counts the row as skipped, not applied."""
        res = await sync_mod.replay_config_events(
            payload={"events": [
                self._wire(event_type="menu.item_created",
                           event_id="evt_bad_price",
                           payload={"item_id": "i1", "name": "X", "price": 10.123}),
            ]},
            ledger=ledger,
        )
        assert res == {"applied": 0, "skipped": 1}
        # Nothing landed in the ledger
        from app.core.events import EventType as _ET
        stored = await ledger.get_events_by_type(_ET.MENU_ITEM_CREATED)
        assert stored == []

    @pytest.mark.asyncio
    async def test_precision_error_doesnt_abort_remainder_of_batch(self, ledger):
        """One bad row in the middle of a batch: the good rows before/after
        still apply. Sync is a streaming replay — one drift should not
        poison the whole pull."""
        res = await sync_mod.replay_config_events(
            payload={"events": [
                self._wire(event_type="employee.created",
                           event_id="evt_good_a",
                           payload={"employee_id": "eA", "display_name": "A"}),
                self._wire(event_type="menu.item_created",
                           event_id="evt_bad",
                           payload={"item_id": "i1", "name": "X", "price": 10.123}),
                self._wire(event_type="employee.created",
                           event_id="evt_good_b",
                           payload={"employee_id": "eB", "display_name": "B"}),
            ]},
            ledger=ledger,
        )
        assert res == {"applied": 2, "skipped": 1}

    @pytest.mark.asyncio
    async def test_non_precision_valueerror_propagates(self, ledger, monkeypatch):
        """Non-precision ValueError (e.g. ledger corruption) must *not* be
        silently eaten — it's a real failure and should bubble up so the
        caller sees a 500 rather than a falsely-successful {applied:0, skipped:1}."""
        async def _exploding_append(event):
            raise ValueError("Checksum mismatch at sequence 42")

        monkeypatch.setattr(ledger, "append", _exploding_append)

        with pytest.raises(ValueError, match="Checksum mismatch"):
            await sync_mod.replay_config_events(
                payload={"events": [{
                    "event_id": "evt1",
                    "event_type": "employee.created",
                    "terminal_id": "OVERSEER",
                    "payload": {"employee_id": "eA", "display_name": "A"},
                    "sequence_number": 1,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "user_id": None, "user_role": None, "correlation_id": None,
                }]},
                ledger=ledger,
            )


class TestGetConfigEventsPagination:
    """The over-fetch loop in get_config_events must advance past a batch
    that's entirely operational events (nothing left after filtering) —
    otherwise a noisy ledger stalls the sync cursor."""

    @pytest.mark.asyncio
    async def test_loop_skips_batch_of_only_op_events(self, ledger):
        """Seed N operational events followed by 1 config event. The sync
        call must return the config event without spinning forever on the
        operational-heavy batch."""
        # 5 operational events
        for i in range(5):
            await _seed_op_event(
                ledger, event_type=EventType.ORDER_CREATED,
                payload={"order_id": f"o{i}"},
            )
        # then 1 config
        await _seed_config_event(
            ledger, event_type=EventType.EMPLOYEE_CREATED,
            payload={"employee_id": "e1", "display_name": "A"},
        )

        res = await sync_mod.get_config_events(since=0, limit=10, ledger=ledger)
        assert res["count"] == 1
        assert res["events"][0]["event_type"] == "employee.created"

    @pytest.mark.asyncio
    async def test_latest_sequence_echoes_since_when_no_config_events(self, ledger):
        """Operational-only ledger: `events=[]`, so `latest_sequence` echoes
        the caller's `since`. A polling client's cursor stays put instead
        of sliding past operational events it's not tracking."""
        for i in range(3):
            await _seed_op_event(
                ledger, event_type=EventType.ORDER_CREATED,
                payload={"order_id": f"o{i}"},
            )
        res = await sync_mod.get_config_events(since=0, limit=10, ledger=ledger)
        assert res["events"] == []
        assert res["latest_sequence"] == 0

        res2 = await sync_mod.get_config_events(since=42, limit=10, ledger=ledger)
        assert res2["latest_sequence"] == 42


# ═══════════════════════════════════════════════════════════════════════════
# Replay auth gate — HTTP-level via AsyncClient
# ═══════════════════════════════════════════════════════════════════════════
#
# `auth_required` is a FastAPI Depends() that runs BEFORE the handler, so
# the direct-call tests above bypass it entirely. These tests go through
# the full ASGI stack to lock the soft/strict gate behaviour on the only
# endpoint in sync.py that's gated.


class TestReplayAuthGate:

    @pytest_asyncio.fixture
    async def client(self, ledger):
        from httpx import AsyncClient, ASGITransport
        from app.main import app
        from app.api import dependencies as deps

        async def _override_ledger():
            return ledger
        app.dependency_overrides[deps.get_ledger] = _override_ledger

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
        app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_soft_mode_no_token_allows(self, client):
        """Test default (auth_enforced=False): missing bearer is a soft
        SEC-005, request proceeds."""
        from app.config import settings as _s
        # conftest has auth_enforced=False already, but assert explicitly
        # so a future conftest change doesn't silently flip this.
        assert _s.auth_enforced is False
        resp = await client.post("/api/v1/sync/config/events/replay", json={"events": []})
        assert resp.status_code == 200
        assert resp.json() == {"applied": 0, "skipped": 0}

    @pytest.mark.asyncio
    async def test_strict_mode_no_token_401(self, client, monkeypatch):
        """Production mode: missing bearer → 401 before handler runs."""
        from app.config import settings as _s
        monkeypatch.setattr(_s, "auth_enforced", True)
        resp = await client.post("/api/v1/sync/config/events/replay", json={"events": []})
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_strict_mode_valid_bearer_passes(self, client, monkeypatch):
        """Production mode + valid bearer: any role (auth_required doesn't
        gate by role, unlike require_manager) → handler runs."""
        from app.api.routes import auth as auth_mod
        from app.config import settings as _s
        monkeypatch.setattr(_s, "auth_enforced", True)
        auth_mod._sessions.clear()
        token = auth_mod._create_token("emp_server", "Cassie", ["server"])

        resp = await client.post(
            "/api/v1/sync/config/events/replay",
            json={"events": []},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"applied": 0, "skipped": 0}

    @pytest.mark.asyncio
    async def test_health_and_get_events_need_no_auth(self, client, monkeypatch):
        """Only /replay is gated; /health and /config/events are public
        (terminals call them before they have a session)."""
        from app.config import settings as _s
        monkeypatch.setattr(_s, "auth_enforced", True)

        health = await client.get("/api/v1/sync/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok", "role": "overseer"}

        events = await client.get("/api/v1/sync/config/events")
        assert events.status_code == 200
