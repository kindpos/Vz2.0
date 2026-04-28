"""
OverseerConfigService gap tests — methods not covered by
test_overseer_config_projection.py.

Covers: get_floorplan_sections (empty, create/update/delete cycle),
get_floorplan_layout (default canvas, last-write-wins),
get_terminals (empty, merge on update), get_printers (empty, basic),
and get_routing_matrix (empty, last-event-wins).
"""

from pathlib import Path

import pytest
import pytest_asyncio

from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event
from app.services.overseer_config_service import OverseerConfigService

TEST_DB = Path("./data/test_overseer_config_extended.db")


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


async def _emit(ledger, event_type: EventType, payload: dict):
    return await ledger.append(create_event(
        event_type=event_type, terminal_id="OVERSEER", payload=payload,
    ))


# ═══════════════════════════════════════════════════════════════════════
# Floorplan sections
# ═══════════════════════════════════════════════════════════════════════

async def test_get_floorplan_sections_empty(ledger):
    svc = OverseerConfigService(ledger)
    assert await svc.get_floorplan_sections() == []


async def test_get_floorplan_sections_create_and_update(ledger):
    svc = OverseerConfigService(ledger)
    await _emit(ledger, EventType.FLOORPLAN_SECTION_CREATED, {
        "section_id": "s1", "name": "Patio", "color": "#aabbcc", "active": True,
    })
    await _emit(ledger, EventType.FLOORPLAN_SECTION_UPDATED, {
        "section_id": "s1", "name": "Back Patio", "color": "#aabbcc", "active": True,
    })

    sections = await svc.get_floorplan_sections()
    assert len(sections) == 1
    assert sections[0].name == "Back Patio"


async def test_get_floorplan_sections_delete_removes(ledger):
    svc = OverseerConfigService(ledger)
    await _emit(ledger, EventType.FLOORPLAN_SECTION_CREATED, {
        "section_id": "s2", "name": "Bar", "color": "#000000", "active": True,
    })
    await _emit(ledger, EventType.FLOORPLAN_SECTION_DELETED, {"section_id": "s2"})

    sections = await svc.get_floorplan_sections()
    assert all(s.section_id != "s2" for s in sections)


# ═══════════════════════════════════════════════════════════════════════
# Floorplan layout
# ═══════════════════════════════════════════════════════════════════════

async def test_get_floorplan_layout_default_when_empty(ledger):
    svc = OverseerConfigService(ledger)
    layout = await svc.get_floorplan_layout()

    assert layout.canvas == {"width": 1200, "height": 800}
    assert layout.tables == []
    assert layout.structures == []
    assert layout.fixtures == []


async def test_get_floorplan_layout_last_event_wins(ledger):
    svc = OverseerConfigService(ledger)
    await _emit(ledger, EventType.FLOORPLAN_LAYOUT_UPDATED, {
        "canvas": {"width": 800, "height": 600},
        "tables": [], "structures": [], "fixtures": [],
    })
    await _emit(ledger, EventType.FLOORPLAN_LAYOUT_UPDATED, {
        "canvas": {"width": 1920, "height": 1080},
        "tables": [], "structures": [], "fixtures": [],
    })

    layout = await svc.get_floorplan_layout()
    assert layout.canvas == {"width": 1920, "height": 1080}


# ═══════════════════════════════════════════════════════════════════════
# Terminals
# ═══════════════════════════════════════════════════════════════════════

async def test_get_terminals_empty(ledger):
    svc = OverseerConfigService(ledger)
    assert await svc.get_terminals() == []


async def test_get_terminals_merge_update(ledger):
    svc = OverseerConfigService(ledger)
    await _emit(ledger, EventType.TERMINAL_REGISTERED, {
        "terminal_id": "T-01", "name": "Front", "role": "terminal",
    })
    await _emit(ledger, EventType.TERMINAL_UPDATED, {
        "terminal_id": "T-01", "name": "Front Register", "role": "terminal",
    })

    terminals = await svc.get_terminals()
    assert len(terminals) == 1
    assert terminals[0].name == "Front Register"


# ═══════════════════════════════════════════════════════════════════════
# Printers
# ═══════════════════════════════════════════════════════════════════════

async def test_get_printers_empty(ledger):
    svc = OverseerConfigService(ledger)
    assert await svc.get_printers() == []


async def test_get_printers_basic(ledger):
    svc = OverseerConfigService(ledger)
    await _emit(ledger, EventType.PRINTER_REGISTERED, {
        "printer_id": "p1", "name": "Kitchen", "station": "kitchen",
        "ip_address": "192.168.1.20", "mac_address": "AA:BB:CC:DD:EE:FF",
    })

    printers = await svc.get_printers()
    assert len(printers) == 1
    assert printers[0].printer_id == "p1"
    assert printers[0].station == "kitchen"


# ═══════════════════════════════════════════════════════════════════════
# Routing matrix
# ═══════════════════════════════════════════════════════════════════════

async def test_get_routing_matrix_empty(ledger):
    svc = OverseerConfigService(ledger)
    matrix = await svc.get_routing_matrix()
    assert matrix.matrix == {}


async def test_get_routing_matrix_last_event_wins(ledger):
    svc = OverseerConfigService(ledger)
    await _emit(ledger, EventType.ROUTING_MATRIX_UPDATED, {
        "matrix": {"food": ["p1"]},
    })
    await _emit(ledger, EventType.ROUTING_MATRIX_UPDATED, {
        "matrix": {"food": ["p1", "p2"], "drinks": ["p3"]},
    })

    matrix = await svc.get_routing_matrix()
    assert matrix.matrix == {"food": ["p1", "p2"], "drinks": ["p3"]}
