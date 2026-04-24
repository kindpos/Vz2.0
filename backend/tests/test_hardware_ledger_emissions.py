"""Tests for ledger events emitted by /hardware/devices routes.

Each test stubs HARDWARE_DB_PATH onto a throwaway sqlite path so the
real on-disk hardware_config.db isn't touched.
"""

from __future__ import annotations

import os
from pathlib import Path

import aiosqlite
import pytest

from app.api.routes import hardware as hw
from app.core.events import EventType


@pytest.fixture
async def isolated_hw_db(tmp_path, monkeypatch):
    db_path = tmp_path / "hardware_config.db"
    monkeypatch.setattr(hw, "HARDWARE_DB_PATH", str(db_path))
    yield str(db_path)


async def _save(ledger, db, **overrides):
    payload = dict(
        mac="AA:BB:CC:DD:EE:01",
        ip="10.0.0.5",
        type="kitchen",
        name="Bar Printer",
        port=9100,
        register_id="",
        tpn="",
        auth_key="",
        categories="",
    )
    payload.update(overrides)
    record = hw.DeviceRecord(**payload)
    return await hw.save_device(device=record, ledger=ledger)


@pytest.mark.asyncio
async def test_save_device_emits_printer_configured_on_new_mac(isolated_hw_db, ledger):
    await _save(ledger, isolated_hw_db, categories="drinks,appetizers")
    events = await ledger.get_events_by_type(EventType.PRINTER_CONFIGURED)
    assert len(events) == 1
    p = events[0].payload
    assert p["mac"] == "AA:BB:CC:DD:EE:01"
    assert p["categories"] == ["drinks", "appetizers"]


@pytest.mark.asyncio
async def test_resaving_same_categories_emits_no_event(isolated_hw_db, ledger):
    await _save(ledger, isolated_hw_db, categories="drinks")
    await _save(ledger, isolated_hw_db, categories="drinks")
    configured = await ledger.get_events_by_type(EventType.PRINTER_CONFIGURED)
    changed = await ledger.get_events_by_type(EventType.PRINTER_ASSIGNMENT_CHANGED)
    assert len(configured) == 1
    assert changed == []


@pytest.mark.asyncio
async def test_changing_categories_emits_assignment_changed(isolated_hw_db, ledger):
    await _save(ledger, isolated_hw_db, categories="drinks")
    await _save(ledger, isolated_hw_db, categories="drinks,desserts")
    changed = await ledger.get_events_by_type(EventType.PRINTER_ASSIGNMENT_CHANGED)
    assert len(changed) == 1
    p = changed[0].payload
    assert p["previous_categories"] == ["drinks"]
    assert p["new_categories"] == ["drinks", "desserts"]


@pytest.mark.asyncio
async def test_delete_device_emits_printer_removed(isolated_hw_db, ledger):
    await _save(ledger, isolated_hw_db)
    await hw.delete_device(mac="aa:bb:cc:dd:ee:01", ledger=ledger)
    removed = await ledger.get_events_by_type(EventType.PRINTER_REMOVED)
    assert len(removed) == 1
    p = removed[0].payload
    assert p["mac"] == "AA:BB:CC:DD:EE:01"
    assert p["name"] == "Bar Printer"
    assert p["printer_type"] == "kitchen"


@pytest.mark.asyncio
async def test_delete_unknown_mac_emits_nothing(isolated_hw_db, ledger):
    await hw.delete_device(mac="de:ad:be:ef:00:00", ledger=ledger)
    assert await ledger.get_events_by_type(EventType.PRINTER_REMOVED) == []


@pytest.mark.asyncio
async def test_card_reader_save_emits_payment_processor_configured(isolated_hw_db, ledger):
    record = hw.DeviceRecord(
        mac="11:22:33:44:55:66",
        ip="10.0.0.9",
        type="card_reader",
        name="Dejavoo #1",
        port=9000,
        register_id="REG-7",
        tpn="TPN-SECRET",
        auth_key="KEY-SECRET",
        categories="",
    )
    await hw.save_device(device=record, ledger=ledger)

    processor = await ledger.get_events_by_type(EventType.PAYMENT_PROCESSOR_CONFIGURED)
    assert len(processor) == 1
    p = processor[0].payload
    assert p["mac"] == "11:22:33:44:55:66"
    assert p["register_id"] == "REG-7"
    # Credential material must never land in the audit payload.
    assert "tpn" not in p
    assert "auth_key" not in p

    # And a card-reader save must NOT emit printer.configured.
    assert await ledger.get_events_by_type(EventType.PRINTER_CONFIGURED) == []
