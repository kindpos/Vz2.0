"""
KINDpos FastAPI Application

The main entry point for the backend API.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys
import socket
import subprocess
from pathlib import Path
from zeroconf import Zeroconf, ServiceInfo

logger = logging.getLogger(__name__)

from app.api.routes.printing import print_queue
from app.printing.print_dispatcher import PrintDispatcher
from app.config import settings
from app.api.dependencies import init_ledger, close_ledger, set_printer_manager, get_ephemeral_log, set_print_dispatcher, get_ledger, set_diagnostic_collector, get_diagnostic_collector, check_license_activation
from app.services.diagnostic_collector import DiagnosticCollector
from app.services.demo_seeder import seed_demo_data_if_empty
from app.core.adapters.printer_manager import PrinterManager
from app.core.adapters.escpos_network import make_thermal_printer, make_kitchen_printer
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
from app.api.routes import licenses
from app.api.routes.licenses import start_license_checkin_loop
from app.api.routes.printing import print_queue


_dispatcher: PrintDispatcher = None
_checkin_task: asyncio.Task = None
_zeroconf: Zeroconf = None

# Canonical data directory — hardware_config.db lives in backend/data/
BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_ROOT / 'data'
HARDWARE_DB_PATH = str(DATA_DIR / 'hardware_config.db')


def _resolve_printer_ip(mac: str, fallback_ip: str) -> str:
    """Resolve current IP from MAC via ARP. Falls back to stored IP."""
    if not mac:
        return fallback_ip
    try:
        result = subprocess.run(
            ['arp', '-a'], capture_output=True,
            text=True, timeout=3
        )
        for line in result.stdout.splitlines():
            if mac.lower() in line.lower():
                for part in line.split():
                    part = part.strip('()')
                    if part.count('.') == 3:
                        return part
    except Exception:
        pass
    return fallback_ip


def _get_lan_ip():
  """Get the local LAN IP by connecting to an external host."""
  try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 80))
    ip = s.getsockname()[0]
    s.close()
    return ip
  except Exception:
    return '127.0.0.1'


async def _init_printer_manager(ledger, ephemeral_log=None):
    """Load saved printers from hardware_config.db, fall back to mock."""
    import aiosqlite

    manager = PrinterManager(ledger, settings.terminal_id, ephemeral_log=ephemeral_log)
    printer_found = False

    if os.path.exists(HARDWARE_DB_PATH):
        try:
            async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT * FROM devices WHERE (role IN ('kitchen', 'receipt')"
                    " OR type IN ('thermal', 'impact')) AND is_active = 1"
                ) as cur:
                    rows = await cur.fetchall()
                for row in rows:
                    device = dict(row)
                    printer_type = device.get("type", "thermal").lower()
                    device_role = device.get("role", "")
                    device_mac = device.get("mac", "")
                    stored_ip = device.get("ip", "")
                    device_ip = _resolve_printer_ip(device_mac, stored_ip)
                    if device_ip != stored_ip:
                        print(f"  MAC resolved to {device_ip} (stored: {stored_ip})")
                        if device_ip:
                            await db.execute(
                                "UPDATE devices SET ip=? WHERE mac=?", (device_ip, device_mac)
                            )
                            await db.commit()
                    device_name = device.get("name", stored_ip or "Printer")
                    device_port = int(device.get("port", 9100))
                    device_station = device.get("station") or device.get("location_tag")

                    # role takes precedence; fall back to type for legacy rows
                    use_kitchen = (
                        device_role == 'kitchen'
                        or (not device_role and printer_type == 'impact')
                    )
                    use_receipt = (
                        device_role == 'receipt'
                        or (not device_role and printer_type == 'thermal')
                    )

                    if not device_ip:
                        print(f"  Skipping printer (no IP): {device_name}")
                        continue

                    try:
                        if use_receipt:
                            device_chars_per_line = int(device.get("chars_per_line", 48))
                            device_has_drawer = bool(device.get("has_drawer", False))
                            adapter = make_thermal_printer(
                                printer_id=device.get("id") or device.get("mac", device_ip),
                                name=device_name,
                                ip=device_ip,
                                port=device_port,
                                chars_per_line=device_chars_per_line,
                                has_drawer=device_has_drawer,
                            )
                            if device_role:
                                adapter._config.role = device_role
                            if device_station:
                                adapter._config.location_tag = device_station
                        elif use_kitchen:
                            device_chars_per_line = int(device.get("chars_per_line", 33))
                            adapter = make_kitchen_printer(
                                printer_id=device.get("id") or device.get("mac", device_ip),
                                name=device_name,
                                ip=device_ip,
                                port=device_port,
                                chars_per_line=device_chars_per_line,
                                is_impact=(printer_type == 'impact'),
                            )
                            if device_role:
                                adapter._config.role = device_role
                            if device_station:
                                adapter._config.location_tag = device_station
                        else:
                            print(f"  Skipping unknown printer — role={device_role!r} type={printer_type!r}")
                            continue

                        await manager.register_printer(adapter)

                        # Load routing rules for this printer
                        try:
                            async with db.execute(
                                "SELECT * FROM printer_routing"
                                " WHERE printer_mac = ? AND is_active = 1 ORDER BY priority",
                                (device_mac,)
                            ) as rcur:
                                routing_rows = [dict(r) for r in await rcur.fetchall()]
                            adapter.routing_rules = routing_rows
                            if any(r.get('rule_type') == 'all' for r in routing_rows):
                                print(f"  Routing: ALL items → {device_name}")
                            elif routing_rows:
                                print(f"  Routing: {len(routing_rows)} rules → {device_name}")
                        except Exception:
                            adapter.routing_rules = []

                        # Attempt connection (log result but don't block startup)
                        connected = await adapter.connect()
                        if connected:
                            print(f"  Printer loaded: {device_name} @ {device_ip} (connected)")
                        else:
                            print(f"  Printer loaded: {device_name} @ {device_ip} (offline)")

                        printer_found = True

                    except Exception as e:
                        print(f"  Error loading printer {device_name}: {e}")

        except Exception as e:
            print(f"  Warning: could not load printers from hardware_config.db: {e}")

    if not printer_found:
        print("  No printers configured — use Settings > Hardware to scan and add printers")

    set_printer_manager(manager)
    return manager


async def _run_daily_retention(collector: DiagnosticCollector) -> None:
    """Run diagnostic retention once per day (every 86400 seconds)."""
    while True:
        try:
            await asyncio.sleep(86400)  # 24 hours
            archive_path = await collector.run_retention()
            if archive_path:
                print(f"Diagnostic retention: archived to {archive_path}")
        except Exception as e:
            print(f"Diagnostic retention failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _dispatcher, _checkin_task

    print("Starting " + settings.app_name + " v" + settings.app_version)
    print("Terminal ID: " + settings.terminal_id)
    print("Database: " + settings.database_path)

    # Migrate hardware_config.db from backend/ to backend/data/ (idempotent)
    _old_hardware_db = BACKEND_ROOT / 'hardware_config.db'
    _new_hardware_db = DATA_DIR / 'hardware_config.db'
    if _old_hardware_db.exists() and not _new_hardware_db.exists():
        import shutil
        shutil.move(str(_old_hardware_db), str(_new_hardware_db))
        print(f"  Migrated hardware_config.db to data/")

    ledger = await init_ledger()
    print("Event Ledger initialized")

    # Log resolved database paths
    print(f"Data directory:  {DATA_DIR}")
    print(f"Hardware DB:     {HARDWARE_DB_PATH}")

    # Entomology diagnostic collector (shares diagnostic_boot.db with KINDnostic)
    diagnostic_db_path = settings.database_path.replace(
        "event_ledger.db", "diagnostic_boot.db"
    )
    diagnostic_collector = DiagnosticCollector(
        db_path=diagnostic_db_path, terminal_id=settings.terminal_id
    )
    await diagnostic_collector.connect()
    set_diagnostic_collector(diagnostic_collector)
    await check_license_activation(app)
    print(f"DiagnosticCollector initialized at {diagnostic_db_path}")

    # Register mDNS service (kindpos.local) for network discovery
    global _zeroconf
    try:
        lan_ip = _get_lan_ip()
        _zeroconf = Zeroconf()
        service_info = ServiceInfo(
            "_http._tcp.local.",
            "KINDpos._http._tcp.local.",
            addresses=[socket.inet_aton(lan_ip)],
            port=8000,
            properties={
                "path": "/",
                "version": settings.app_version,
            },
        )
        _zeroconf.register_service(service_info)
        print(f"mDNS service registered: kindpos.local ({lan_ip}:8000)")
    except Exception as e:
        logger.warning(f"mDNS registration failed: {e}")

    # Start license checkin background task
    _checkin_task = await start_license_checkin_loop()
    print("License checkin scheduler started (60-minute interval)")

    # Start daily retention background task
    asyncio.create_task(_run_daily_retention(diagnostic_collector))
    print("Diagnostic retention scheduler started (daily)")

    if settings.store_mode == "demo":
        await seed_demo_data_if_empty(ledger)
    else:
        print(f"Store mode: {settings.store_mode} — skipping demo seed")

    eph_log = await get_ephemeral_log()
    printer_manager = await _init_printer_manager(ledger, ephemeral_log=eph_log)
    print(f"PrinterManager initialized ({len(printer_manager._printers)} printers)")

    await print_queue.connect()
    print("Print Queue initialized")

    # Only start PrintDispatcher if PrinterManager has no printers (backward compat)
    # If PrinterManager has printers, print routes will use it directly
    if len(printer_manager._printers) == 0:
        _dispatcher = PrintDispatcher(print_queue)
        await _dispatcher.start()
        set_print_dispatcher(_dispatcher)
        print("Print Dispatcher started (PrinterManager has no printers)")
    else:
        _dispatcher = None
        print("Print Dispatcher NOT started (using PrinterManager for printing)")

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

    if _checkin_task is not None and not _checkin_task.done():
        _checkin_task.cancel()
        try:
            await _checkin_task
        except asyncio.CancelledError:
            pass
    if _dispatcher is not None:
        await _dispatcher.stop()
    await print_queue.close()
    collector = get_diagnostic_collector()
    if collector is not None:
        await collector.close()
        set_diagnostic_collector(None)
    if _zeroconf is not None:
        try:
            _zeroconf.close()
            print("mDNS service unregistered")
        except Exception as e:
            print(f"WARNING: mDNS unregistration failed: {e}")
    await close_ledger()
    print("Shutdown complete")

# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Nice. Dependable. Yours.",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

# CORS middleware (allows frontend to connect)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080", "http://localhost:8000", "http://127.0.0.1:8080", "http://localhost:63342", "https://kindpos-vz2.fly.dev"],
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
app.include_router(config.discounts_router, prefix="/api/v1")
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
app.include_router(licenses.router, prefix="/api/v1")


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

@app.get("/install")
async def install_redirect():
    return RedirectResponse(url="/install/")

common_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'common')
if os.path.exists(common_path):
    print(f'Serving Common from: {common_path}')
    app.mount('/common', StaticFiles(directory=common_path), name='common')
else:
    print(f'WARNING: Common not found at: {common_path}')

install_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'install')
if os.path.exists(install_path):
    print(f'Serving Install from: {install_path}')
    app.mount('/install', StaticFiles(directory=install_path, html=True), name='install')
else:
    print(f'WARNING: Install not found at: {install_path}')

if os.path.exists(frontend_path):
    print(f'Serving frontend from: {frontend_path}')
    app.mount('/', StaticFiles(directory=frontend_path, html=True), name='frontend')
else:
    print(f'WARNING: Frontend not found at: {frontend_path}')