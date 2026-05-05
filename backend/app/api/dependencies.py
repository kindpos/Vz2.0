"""
FastAPI Dependencies

Shared dependencies for API routes.
The Event Ledger is managed here as a singleton.
"""

from typing import AsyncGenerator, Optional
from app.core.event_ledger import EventLedger
from app.core.ephemeral_log import EphemeralLog
from app.core.adapters.printer_manager import PrinterManager
from app.services.diagnostic_collector import DiagnosticCollector
from app.services.connection_manager import ConnectionManager
from app.services.sync_client import SyncClient
from app.printing.print_dispatcher import PrintDispatcher
from app.config import settings

# Global singleton instances (initialized on startup)
_ledger: EventLedger | None = None
_ephemeral_log: EphemeralLog | None = None
_printer_manager: PrinterManager | None = None
_diagnostic_collector: DiagnosticCollector | None = None
_print_dispatcher: PrintDispatcher | None = None
_connection_manager: ConnectionManager | None = None
_sync_client: SyncClient | None = None


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


def get_connection_manager() -> Optional[ConnectionManager]:
    """Optional dependency — returns None if ConnectionManager not initialized."""
    return _connection_manager


def set_connection_manager(cm: ConnectionManager) -> None:
    """Register a ConnectionManager instance (called during startup)."""
    global _connection_manager
    _connection_manager = cm


def get_sync_client() -> Optional[SyncClient]:
    """Optional dependency — returns None if SyncClient not initialized."""
    return _sync_client


def set_sync_client(sc: SyncClient) -> None:
    """Register a SyncClient instance (called during startup on terminal Pis)."""
    global _sync_client
    _sync_client = sc


async def check_license_activation(app) -> None:
    """
    Boot probe: check license activation status and set app.state.activated.

    Called during FastAPI startup to determine if the node is activated.
    Sets app.state.activated = True if license exists and is valid, False otherwise.
    This flag is read by the frontend to route to the activation scene if needed.
    """
    if _diagnostic_collector is None:
        app.state.activated = False
        return

    try:
        result = await _diagnostic_collector.check_license()
        app.state.activated = result.get("passed", False)
    except Exception as e:
        app.state.activated = False
        if _diagnostic_collector:
            await _diagnostic_collector.record(
                category="system",
                severity="warning",
                source="check_license_activation",
                event_code="SEC-006",
                message=f"License check failed: {str(e)}",
                context={"error": str(e)},
            )
