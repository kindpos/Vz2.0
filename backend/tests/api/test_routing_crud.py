"""
CRUD tests for the printer_routing routes added to
`backend/app/api/routes/hardware.py` per HARDWARE_ROUTING.md §3.

Route handlers are called directly (not via HTTP) — same pattern as
`tests/test_printing_routes.py`. `HARDWARE_DB_PATH` is monkey-patched
to a temp file and `_ensure_db()` brings up the schema fresh per
test.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.api.routes import hardware


# ─── fixtures ────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def hw_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the module-level `HARDWARE_DB_PATH` at a temp DB and bring
    the schema up via the production `_ensure_db()` so the column set
    under test exactly matches what migrations produce."""
    path = tmp_path / "hardware_config.db"
    monkeypatch.setattr("app.api.routes.hardware.HARDWARE_DB_PATH", str(path))
    await hardware._ensure_db()
    return path


def _read_row(path: Path, rule_id: int) -> dict | None:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT * FROM printer_routing WHERE id = ?", (rule_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ─── POST /routing ───────────────────────────────────────────────────────


async def test_post_routing_creates_row_with_supplied_fields(hw_db: Path):
    req = hardware.CreateRoutingRuleRequest(
        printer_mac="AA:BB:CC:DD:EE:01",
        rule_type="category",
        category_id="apps",
        priority=10,
        time_from="11:00",
        time_to="14:00",
        days_of_week="[1,2,3,4,5]",
    )
    result = await hardware.create_routing_rule(req)

    assert result["printer_mac"] == "AA:BB:CC:DD:EE:01"
    assert result["rule_type"] == "category"
    assert result["category_id"] == "apps"
    assert result["priority"] == 10
    assert result["time_from"] == "11:00"
    assert result["time_to"] == "14:00"
    assert result["days_of_week"] == "[1,2,3,4,5]"
    assert result["is_active"] == 1
    assert "id" in result

    # Returned dict matches what landed in the DB.
    on_disk = _read_row(hw_db, result["id"])
    assert on_disk == result


async def test_post_routing_uses_defaults_for_omitted_fields(hw_db: Path):
    req = hardware.CreateRoutingRuleRequest(printer_mac="AA:BB:CC:DD:EE:01")
    result = await hardware.create_routing_rule(req)

    assert result["rule_type"] == "all"
    assert result["category_id"] == ""
    assert result["priority"] == 0
    assert result["time_from"] == ""
    assert result["time_to"] == ""
    assert result["days_of_week"] == "[]"
    assert result["redirect_to_mac"] == ""
    assert result["override_active"] == 0
    assert result["override_expires_at"] == ""


# ─── PUT /routing/{id} ───────────────────────────────────────────────────


async def test_put_routing_updates_only_supplied_fields(hw_db: Path):
    created = await hardware.create_routing_rule(
        hardware.CreateRoutingRuleRequest(
            printer_mac="AA:BB:CC:DD:EE:01",
            priority=0,
            category_id="apps",
        )
    )

    updated = await hardware.update_routing_rule(
        created["id"],
        hardware.UpdateRoutingRuleRequest(
            priority=50,
            redirect_to_mac="AA:BB:CC:DD:EE:99",
        ),
    )

    assert updated["priority"] == 50
    assert updated["redirect_to_mac"] == "AA:BB:CC:DD:EE:99"
    # Fields not in the patch body are preserved.
    assert updated["printer_mac"] == "AA:BB:CC:DD:EE:01"
    assert updated["category_id"] == "apps"


async def test_put_routing_404_when_rule_missing(hw_db: Path):
    with pytest.raises(HTTPException) as exc:
        await hardware.update_routing_rule(
            999, hardware.UpdateRoutingRuleRequest(priority=5)
        )
    assert exc.value.status_code == 404


# ─── DELETE /routing/{id} ────────────────────────────────────────────────


async def test_delete_routing_soft_deletes(hw_db: Path):
    created = await hardware.create_routing_rule(
        hardware.CreateRoutingRuleRequest(printer_mac="AA:BB:CC:DD:EE:01")
    )

    await hardware.delete_routing_rule(created["id"])

    on_disk = _read_row(hw_db, created["id"])
    assert on_disk is not None  # row still present
    assert on_disk["is_active"] == 0


async def test_delete_routing_404_when_rule_missing(hw_db: Path):
    with pytest.raises(HTTPException) as exc:
        await hardware.delete_routing_rule(999)
    assert exc.value.status_code == 404


# ─── POST /routing/{id}/override ─────────────────────────────────────────


async def test_post_override_activates_with_expiry(hw_db: Path):
    created = await hardware.create_routing_rule(
        hardware.CreateRoutingRuleRequest(printer_mac="AA:BB:CC:DD:EE:01")
    )

    result = await hardware.set_routing_override(
        created["id"],
        hardware.RoutingOverrideRequest(
            active=True, expires_at="2026-06-01T00:00:00"
        ),
    )
    assert result["override_active"] == 1
    assert result["override_expires_at"] == "2026-06-01T00:00:00"


async def test_post_override_clears_when_inactive(hw_db: Path):
    created = await hardware.create_routing_rule(
        hardware.CreateRoutingRuleRequest(printer_mac="AA:BB:CC:DD:EE:01")
    )
    # First activate.
    await hardware.set_routing_override(
        created["id"],
        hardware.RoutingOverrideRequest(
            active=True, expires_at="2026-06-01T00:00:00"
        ),
    )
    # Then clear.
    cleared = await hardware.set_routing_override(
        created["id"],
        hardware.RoutingOverrideRequest(active=False),
    )
    assert cleared["override_active"] == 0
    assert cleared["override_expires_at"] == ""


async def test_post_override_404_when_rule_missing(hw_db: Path):
    with pytest.raises(HTTPException) as exc:
        await hardware.set_routing_override(
            999, hardware.RoutingOverrideRequest(active=True)
        )
    assert exc.value.status_code == 404
