"""
Tests for HARDWARE_ROUTING.md §4 — card-reader → terminal mapping via
`devices.terminal_ids` JSON array.

`_ensure_devices()` in payment_routes.py drives PaymentManager's
`_terminal_device_map`. The new behavior parses `terminal_ids` so a
single card reader can serve multiple terminals (the multi-terminal
restaurant case), while keeping the legacy singular `terminal_id`
column working for older rows.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterator

import pytest

from app.api.routes import payment_routes
from app.config import settings
from app.core.adapters.payment_manager import PaymentManager


# ─── fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_devices_initialized() -> Iterator[None]:
    """The _devices_initialized flag is a module-level singleton — flip
    it back to False around every test so each one re-runs the loader."""
    original = payment_routes._devices_initialized
    payment_routes._devices_initialized = False
    yield
    payment_routes._devices_initialized = original


@pytest.fixture
def hardware_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point payment_routes at a temp `hardware_config.db` and create the
    `devices` table shape the loader expects to SELECT against."""
    path = tmp_path / "hardware_config.db"
    monkeypatch.setattr(
        "app.api.routes.payment_routes.HARDWARE_DB_PATH", str(path)
    )
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(
            """
            CREATE TABLE devices (
                mac           TEXT PRIMARY KEY,
                ip            TEXT NOT NULL,
                type          TEXT NOT NULL,
                name          TEXT NOT NULL,
                port          INTEGER NOT NULL DEFAULT 9100,
                register_id   TEXT NOT NULL DEFAULT '',
                tpn           TEXT NOT NULL DEFAULT '',
                auth_key      TEXT NOT NULL DEFAULT '',
                is_active     INTEGER NOT NULL DEFAULT 1,
                saved_at      TEXT NOT NULL DEFAULT '',
                categories    TEXT NOT NULL DEFAULT '',
                terminal_id   TEXT NOT NULL DEFAULT '',
                terminal_ids  TEXT NOT NULL DEFAULT '[]',
                role          TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
    return path


@pytest.fixture(autouse=True)
def _stub_dejavoo_connect(monkeypatch: pytest.MonkeyPatch) -> None:
    """Real DejavooSPInAdapter.connect() needs a live device on the
    network — short-circuit it so the loader treats every seeded row as
    a connected reader. `config` is a read-only property backed by
    `_config`, which is what the real connect() also writes; mirror that
    so `manager.register_device(adapter)` (which reads
    `adapter.config.device_id`) sees the seeded config."""

    async def _ok(self, config):
        self._config = config
        return True

    monkeypatch.setattr(
        "app.core.adapters.dejavoo_spin.DejavooSPInAdapter.connect",
        _ok,
    )


def _seed_card_reader(
    path: Path,
    mac: str,
    *,
    terminal_ids: str,
    terminal_id: str = "",
) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(
            """
            INSERT INTO devices
                (mac, ip, type, name, port, terminal_id, terminal_ids,
                 is_active, saved_at)
            VALUES (?, '10.0.0.42', 'card_reader', 'Test Dejavoo',
                    9000, ?, ?, 1, '2026-05-01T00:00:00+00:00')
            """,
            (mac, terminal_id, terminal_ids),
        )
        conn.commit()
    finally:
        conn.close()


def _new_manager(ledger=None) -> PaymentManager:
    # _ensure_devices never calls ledger methods on the success path —
    # a None placeholder is enough to exercise the mapping logic.
    return PaymentManager(ledger, settings.terminal_id)


# ─── tests ───────────────────────────────────────────────────────────────


async def test_terminal_ids_with_single_entry_is_mapped(hardware_db: Path):
    """`terminal_ids='["T-02"]'` → manager maps T-02 → MAC."""
    mac = "AA:BB:CC:DD:EE:01"
    _seed_card_reader(hardware_db, mac, terminal_ids='["T-02"]')

    manager = _new_manager()
    await payment_routes._ensure_devices(manager)

    assert manager._terminal_device_map.get("T-02") == mac


async def test_empty_terminal_ids_keeps_backward_compat_only(
    hardware_db: Path,
):
    """`terminal_ids='[]'` must not add any extra entries, but the
    backward-compat clause still maps the current process's
    settings.terminal_id."""
    mac = "AA:BB:CC:DD:EE:02"
    _seed_card_reader(hardware_db, mac, terminal_ids="[]")

    manager = _new_manager()
    await payment_routes._ensure_devices(manager)

    assert manager._terminal_device_map.get(settings.terminal_id) == mac
    assert "T-02" not in manager._terminal_device_map


async def test_terminal_ids_with_multiple_entries_all_mapped(
    hardware_db: Path,
):
    """`terminal_ids='["T-01","T-02"]'` → both terminal_ids resolve to
    the reader. Verifies the loop in clause (b) doesn't stop at the
    first entry."""
    mac = "AA:BB:CC:DD:EE:03"
    _seed_card_reader(hardware_db, mac, terminal_ids='["T-01","T-02"]')

    manager = _new_manager()
    await payment_routes._ensure_devices(manager)

    assert manager._terminal_device_map.get("T-01") == mac
    assert manager._terminal_device_map.get("T-02") == mac
