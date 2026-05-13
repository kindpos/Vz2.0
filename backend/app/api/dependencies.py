"""
FastAPI Dependencies

Shared dependencies for API routes.
The Event Ledger is managed here as a singleton.
"""

import logging
from datetime import datetime
from typing import AsyncGenerator, Optional

import aiosqlite

from app.core.event_ledger import EventLedger
from app.core.ephemeral_log import EphemeralLog
from app.core.adapters.printer_manager import PrinterManager
from app.services.diagnostic_collector import DiagnosticCollector
from app.printing.print_dispatcher import PrintDispatcher
from app.config import settings

# Global singleton instances (initialized on startup)
_ledger: EventLedger | None = None
_ephemeral_log: EphemeralLog | None = None
_printer_manager: PrinterManager | None = None
_diagnostic_collector: DiagnosticCollector | None = None
_print_dispatcher: PrintDispatcher | None = None


async def get_ledger() -> EventLedger:
    """Dependency that provides the Event Ledger."""
    if _ledger is None:
        raise RuntimeError("Event Ledger not initialized")
    return _ledger


async def get_ephemeral_log() -> EphemeralLog:
    """Dependency that provides the Ephemeral Log."""
    if _ephemeral_log is None:
        raise RuntimeError("Ephemeral Log not initialized")
    return _ephemeral_log


async def init_ledger() -> EventLedger:
    """Initialize the Event Ledger and Ephemeral Log on startup."""
    global _ledger, _ephemeral_log
    _ledger = EventLedger(settings.database_path)
    await _ledger.connect()
    _ephemeral_log = EphemeralLog(
        settings.database_path.replace("event_ledger.db", "ephemeral_log.db")
    )
    await _ephemeral_log.connect()
    return _ledger


async def close_ledger() -> None:
    """Close the Event Ledger and Ephemeral Log on shutdown."""
    global _ledger, _ephemeral_log
    if _ledger:
        await _ledger.close()
        _ledger = None
    if _ephemeral_log:
        await _ephemeral_log.close()
        _ephemeral_log = None


def get_printer_manager() -> PrinterManager | None:
    """Optional dependency — returns None if PrinterManager not initialized."""
    return _printer_manager


def set_printer_manager(manager: PrinterManager) -> None:
    """Register a PrinterManager instance (called during startup)."""
    global _printer_manager
    _printer_manager = manager


def get_diagnostic_collector() -> Optional[DiagnosticCollector]:
    """Optional dependency — returns None if DiagnosticCollector not initialized."""
    return _diagnostic_collector


def set_diagnostic_collector(collector: DiagnosticCollector) -> None:
    """Register a DiagnosticCollector instance (called during startup)."""
    global _diagnostic_collector
    _diagnostic_collector = collector


def get_print_dispatcher() -> Optional[PrintDispatcher]:
    """Optional dependency — returns None if PrintDispatcher not initialized."""
    return _print_dispatcher


def set_print_dispatcher(dispatcher: PrintDispatcher) -> None:
    """Register a PrintDispatcher instance (called during startup)."""
    global _print_dispatcher
    _print_dispatcher = dispatcher


async def check_license_activation(app) -> None:
    """
    Boot probe: verify the offline-signed license file and set app.state.activated.

    Delegates to app.services.license_verifier.check_terminal_license, which
    loads /data/kindpos.lic, verifies the Ed25519 signature, and confirms the
    file is bound to this machine's hardware fingerprint. On success, upserts
    the license into the server_license table. Never raises and never blocks boot.
    """
    from app.services.license_verifier import check_terminal_license
    from app.services.hardware_fingerprint import get_hardware_fingerprint
    from app.api.routes.licenses import DEMO_MODE
    from app.api.routes.hardware import HARDWARE_DB_PATH

    log = logging.getLogger(__name__)

    if DEMO_MODE:
        app.state.activated = True
        log.info("Demo mode: license check bypassed")
        return

    ok, info = check_terminal_license()
    app.state.activated = ok

    if ok:
        log.info("License verified: %s", info)
        # Upsert into server_license so the /status endpoint recognizes the file-based license
        try:
            hardware_fp = get_hardware_fingerprint()
            activated_at = datetime.utcnow().isoformat()
            async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS server_license (
                        id                   INTEGER PRIMARY KEY,
                        license_key          TEXT NOT NULL,
                        hardware_fingerprint TEXT NOT NULL,
                        activated_at         TEXT NOT NULL,
                        status               TEXT NOT NULL DEFAULT 'active'
                    )
                    """
                )
                await db.execute(
                    """
                    INSERT OR REPLACE INTO server_license
                        (id, license_key, hardware_fingerprint, activated_at, status)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (1, info, hardware_fp, activated_at, "active"),
                )
                await db.commit()
        except Exception as e:
            log.warning("Could not write license to server_license table: %s", e)
    else:
        log.warning(
            "*** STARTUP WARNING: terminal running UNLICENSED — %s ***",
            info,
        )
        # Delete any stale active license row
        try:
            async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS server_license (
                        id                   INTEGER PRIMARY KEY,
                        license_key          TEXT NOT NULL,
                        hardware_fingerprint TEXT NOT NULL,
                        activated_at         TEXT NOT NULL,
                        status               TEXT NOT NULL DEFAULT 'active'
                    )
                    """
                )
                await db.execute("DELETE FROM server_license WHERE id = 1")
                await db.commit()
        except Exception as e:
            log.debug("Could not delete license from server_license table: %s", e)
