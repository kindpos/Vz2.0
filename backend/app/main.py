"""
KINDpos FastAPI Application

The main entry point for the backend API.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys

from app.api.routes.printing import print_queue
from app.printing.print_dispatcher import PrintDispatcher
from app.config import settings
from app.api.dependencies import init_ledger, close_ledger, set_printer_manager, get_ephemeral_log, set_print_dispatcher, get_ledger, set_diagnostic_collector, get_diagnostic_collector
from app.services.diagnostic_collector import DiagnosticCollector
from app.services.demo_seeder import seed_demo_data_if_empty
from app.core.adapters.printer_manager import PrinterManager
from app.core.adapters.mock_thermal import MockThermalPrinter
from app.core.adapters.base_printer import PrinterConfig, PrinterType, CutType
from app.api.routes import orders
from app.api.routes import system
from app.api.routes import menu
from app.api.routes import hardware
from app.api.routes import printing
from app.api.routes import payment_routes
from app.api.routes import config
from app.api.routes import staff
from app.api.routes import reporting
from app.api.routes import server_shift
from app.api.routes import auth
from app.api.routes import sync
from app.api.routes import entomology
from app.api.routes import day_cash
from app.api.routes import favorites
from app.api.routes import options as options_routes
from app.api.routes import option_groups as option_groups_routes
from app.api.routes import sizes as sizes_routes
from app.api.routes import modifier_groups as modifier_groups_routes
from app.api.routes import modifiers as modifiers_routes
from app.api.routes import menu_items as menu_items_routes
from app.api.routes.printing import print_queue


_dispatcher: PrintDispatcher = None

HARDWARE_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'hardware_config.db')


async def _init_printer_manager(ledger, ephemeral_log=None):
    """Load saved printers from hardware_config.db, fall back to mock."""
    import aiosqlite

    manager = PrinterManager(ledger, settings.terminal_id, ephemeral_log=ephemeral_log)
    printer_found = False

    if os.path.exists(HARDWARE_DB_PATH):
        try:
            async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT * FROM devices WHERE type = 'printer'") as cur:
                    rows = await cur.fetchall()
                    for row in rows:
                        device = dict(row)
                        role = "kitchen" if "kitchen" in device.get("name", "").lower() else "receipt"
                        config = PrinterConfig(
                            printer_id=device["mac"],
                            name=device.get("name", "Printer"),
                            printer_type=PrinterType.THERMAL,
                            role=role,
                            connection_string=f"{device['ip']}:{device.get('port', 9100)}",
                            cut_type=CutType.PARTIAL,
                        )
                        printer = MockThermalPrinter(config)
                        await manager.register_printer(printer)
                        printer_found = True
                        print(f"  Printer loaded: {device.get('name', device['mac'])} @ {device['ip']}")
        except Exception as e:
            print(f"  Warning: could not load printers from hardware_config.db: {e}")

    if not printer_found:
        print("  No printers configured — use Settings > Hardware to scan and add printers")

    set_printer_manager(manager)
    return manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _dispatcher

    print("Starting " + settings.app_name + " v" + settings.app_version)
    print("Terminal ID: " + settings.terminal_id)
    print("Database: " + settings.database_path)

    ledger = await init_ledger()
    print("Event Ledger initialized")

    # Entomology diagnostic collector (shares diagnostic_boot.db with KINDnostic)
    diagnostic_db_path = settings.database_path.replace(
        "event_ledger.db", "diagnostic_boot.db"
    )
    diagnostic_collector = DiagnosticCollector(
        db_path=diagnostic_db_path, terminal_id=settings.terminal_id
    )
    await diagnostic_collector.connect()
    set_diagnostic_collector(diagnostic_collector)
    print(f"DiagnosticCollector initialized at {diagnostic_db_path}")

    if settings.store_mode == "demo":
        await seed_demo_data_if_empty(ledger)
    else:
        print(f"Store mode: {settings.store_mode} — skipping demo seed")

    eph_log = await get_ephemeral_log()
    printer_manager = await _init_printer_manager(ledger, ephemeral_log=eph_log)
    print(f"PrinterManager initialized ({len(printer_manager._printers)} printers)")

    await print_queue.connect()
    print("Print Queue initialized")

    _dispatcher = PrintDispatcher(print_queue)
    await _dispatcher.start()
    set_print_dispatcher(_dispatcher)
    print("Print Dispatcher started")

    # Crash-recovery sweep: resolve any PAYMENT_INITIATED that landed
    # before a crash and never got a result event. Must run after the
    # ledger + diagnostic collector are wired so FIN-008 can be recorded.
    try:
        from app.services.startup_sweep import sweep_orphan_initiated_payments
        orphans = await sweep_orphan_initiated_payments(
            ledger,
            collector=diagnostic_collector,
            terminal_id=settings.terminal_id,
        )
        if orphans:
            print(f"Crash-recovery sweep: resolved {orphans} orphan PAYMENT_INITIATED")
    except Exception as sweep_exc:  # pragma: no cover — startup must not die
        print(f"Crash-recovery sweep failed: {sweep_exc}")

    yield

    await _dispatcher.stop()
    await print_queue.close()
    collector = get_diagnostic_collector()
    if collector is not None:
        await collector.close()
        set_diagnostic_collector(None)
    await close_ledger()
    print("Shutdown complete")

# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Nice. Dependable. Yours.",
    lifespan=lifespan,
)

# CORS middleware (allows frontend to connect)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080", "http://localhost:8000", "http://127.0.0.1:8080", "http://localhost:63342"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# Entomology: catch-all exception hook
#
# Any exception that bubbles out of a route — ledger write failure, integrity
# error, or bare bug — lands here and gets recorded as SYS-001 (for ValueError
# from the precision gate / ledger checks) or SYS-006 (everything else) before
# FastAPI's default handler serves a 500. We never suppress the raise — this
# is pure observability.
# ─────────────────────────────────────────────────────────────────────────────
from starlette.requests import Request as _StarRequest
from starlette.responses import JSONResponse as _JSONResp
from app.models.diagnostic_event import (
    DiagnosticCategory as _DiagCat,
    DiagnosticSeverity as _DiagSev,
)


@app.exception_handler(Exception)
async def _entomology_catch_all(request: _StarRequest, exc: Exception):
    collector = get_diagnostic_collector()
    if collector is not None:
        try:
            is_ledger_err = isinstance(exc, ValueError) and (
                "precision" in str(exc).lower() or "idempot" in str(exc).lower()
            )
            await collector.record(
                category=_DiagCat.SYSTEM,
                severity=_DiagSev.ERROR,
                source=f"http.{request.method}.{request.url.path}",
                event_code="SYS-001" if is_ledger_err else "SYS-006",
                message=f"{type(exc).__name__}: {exc}"[:500],
                context={
                    "method": request.method,
                    "path": request.url.path,
                    "exc_type": type(exc).__name__,
                },
            )
        except Exception:
            pass  # observability must not mask the real error
    # FastAPI's built-in handler is what would normally return 500; we mimic it
    # instead of re-raising so the response is the same shape.
    return _JSONResp(
        status_code=500,
        content={"detail": "Internal Server Error"},
    )

# Include routers
app.include_router(orders.router, prefix="/api/v1")
app.include_router(system.router, prefix="/api/v1")
app.include_router(menu.router, prefix="/api/v1")
app.include_router(hardware.router, prefix="/api/v1")
app.include_router(printing.router, prefix="/api/v1")
app.include_router(payment_routes.router, prefix="/api/v1")
app.include_router(config.router, prefix="/api/v1")
app.include_router(staff.router, prefix="/api/v1")
app.include_router(reporting.router, prefix="/api/v1")
app.include_router(server_shift.router, prefix="/api/v1")
app.include_router(server_shift.shifts_router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(sync.router, prefix="/api/v1")
app.include_router(entomology.router, prefix="/api/v1")
app.include_router(day_cash.router, prefix="/api/v1")
app.include_router(favorites.router, prefix="/api/v1")
app.include_router(options_routes.router, prefix="/api/v1")
app.include_router(option_groups_routes.router, prefix="/api/v1")
app.include_router(sizes_routes.router, prefix="/api/v1")
app.include_router(modifier_groups_routes.router, prefix="/api/v1")
app.include_router(modifiers_routes.router, prefix="/api/v1")
app.include_router(menu_items_routes.router, prefix="/api/v1")


# Serve frontend
frontend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'terminal')

@app.get("/api/v1/staff")
async def get_staff_list(ledger = Depends(get_ledger)):
    """Returns active employees for Overseer badge count."""
    from app.services.overseer_config_service import OverseerConfigService
    service = OverseerConfigService(ledger)
    employees = await service.get_employees()
    return [e for e in employees if e.active]


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": settings.app_version,
        "terminal_id": settings.terminal_id,
    }

from fastapi.responses import RedirectResponse

@app.get("/overseer")
async def overseer_redirect():
    return RedirectResponse(url="/overseer/")

overseer_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'overseer')
if os.path.exists(overseer_path):
    print(f'Serving Overseer from: {overseer_path}')
    app.mount('/overseer', StaticFiles(directory=overseer_path, html=True), name='overseer')
else:
    print(f'WARNING: Overseer not found at: {overseer_path}')

@app.get("/entomology")
async def entomology_redirect():
    return RedirectResponse(url="/entomology/")

entomology_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'entomology')
if os.path.exists(entomology_path):
    print(f'Serving Entomology from: {entomology_path}')
    app.mount('/entomology', StaticFiles(directory=entomology_path, html=True), name='entomology')
else:
    print(f'WARNING: Entomology not found at: {entomology_path}')

common_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'common')
if os.path.exists(common_path):
    print(f'Serving Common from: {common_path}')
    app.mount('/common', StaticFiles(directory=common_path), name='common')
else:
    print(f'WARNING: Common not found at: {common_path}')

if os.path.exists(frontend_path):
    print(f'Serving frontend from: {frontend_path}')
    app.mount('/', StaticFiles(directory=frontend_path, html=True), name='frontend')
else:
    print(f'WARNING: Frontend not found at: {frontend_path}')