"""
License Management Routes

Handles license activation and status checking.
"""

import hashlib
import json
import logging
import os
import socket
import sys
from datetime import datetime
import aiosqlite
import httpx
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.api.routes.hardware import HARDWARE_DB_PATH, _ensure_db

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/licenses", tags=["licenses"])

DEMO_MODE = os.environ.get("KINDPOS_STORE_MODE") == "demo"

if sys.platform == "win32":
    LICENSE_FILE = os.path.join(
        os.environ.get("APPDATA", "C:/ProgramData"),
        "KINDpos", "data", "license.json"
    )
else:
    LICENSE_FILE = "/home/kindpos/data/license.json"

WORKER_URL = "https://kindpos.com/api/activate"


def get_lan_ip() -> str:
    """Detect local network IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def write_node_hostname(node_number: int) -> None:
    """Register node hostname in Windows hosts file."""
    try:
        ip = get_lan_ip()
        hostname = f"kindpos.t{str(node_number).zfill(2)}.local"
        hosts_path = r"C:\Windows\System32\drivers\etc\hosts"

        with open(hosts_path, 'r') as f:
            existing = f.read()

        if hostname not in existing:
            with open(hosts_path, 'a') as f:
                f.write(f"\n{ip}    {hostname}")
            _log.info(f"Registered {hostname} → {ip}")
        else:
            _log.info(f"{hostname} already registered")
    except Exception as e:
        _log.warning(f"Could not write hosts file: {e}")


def _get_hardware_fingerprint() -> str:
    """Extract hardware fingerprint from Pi: SHA256(serial + mac).

    Body extracted to `app/services/hardware_fingerprint.py` per
    HARDWARE_ROUTING.md §6 — this wrapper survives only so existing
    callers keep their HTTP-500 contract on read failure.
    """
    from app.services.hardware_fingerprint import get_hardware_fingerprint

    try:
        return get_hardware_fingerprint()
    except RuntimeError as e:
        _log.error(f"Error getting hardware fingerprint: {e}")
        raise HTTPException(
            status_code=500, detail="Could not read hardware fingerprint"
        )


def _write_license_file(data: dict) -> None:
    """Write license data to file."""
    os.makedirs(os.path.dirname(LICENSE_FILE), exist_ok=True)
    with open(LICENSE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _read_license_file() -> Optional[dict]:
    """Read license data from file."""
    if not os.path.exists(LICENSE_FILE):
        return None
    try:
        with open(LICENSE_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        _log.warning(f"Could not read license file: {e}")
        return None


class ActivateLicenseRequest(BaseModel):
    license_key: str
    store_name: str = ""
    terminal_name: str = ""


class ActivateLicenseResponse(BaseModel):
    success: bool
    store_name: str
    terminal_name: str


@router.post("/activate")
async def activate_license(request: ActivateLicenseRequest, http_request: Request):
    """Validate the license key against kindpos.com/admin and self-register
    this terminal on success. License keys are issued and live on the admin
    side; this endpoint searches for the key across all admin customers,
    refuses if missing or already activated, then writes a local terminals
    row and best-effort marks the admin record as activated.
    """
    if DEMO_MODE:
        return {"activated": True, "demo": True, "message": "Demo mode — no activation required"}

    # Step 1: Get admin secret
    config_resp = await httpx.AsyncClient().get(
        'https://kindpos.com/api/admin/config',
        timeout=10.0
    )
    if not config_resp.is_success:
        raise HTTPException(status_code=503,
            detail='License server unavailable')
    admin_secret = config_resp.json().get('admin_secret', '')

    # Step 2: Fetch all customers and search for the key
    customers_resp = await httpx.AsyncClient().get(
        'https://kindpos.com/api/admin/customers',
        headers={'Authorization': f'Bearer {admin_secret}'},
        timeout=10.0
    )
    if not customers_resp.is_success:
        raise HTTPException(status_code=503,
            detail='License server unavailable')

    customers = customers_resp.json().get('customers', [])
    matched_terminal = None
    for customer in customers:
        for terminal in customer.get('terminals', []):
            if terminal.get('license_key') == request.license_key:
                matched_terminal = terminal
                break
        if matched_terminal:
            break

    if not matched_terminal:
        raise HTTPException(status_code=400, detail='License key not found')

    if str(matched_terminal.get('status', '')).upper() == 'ACTIVATED':
        raise HTTPException(status_code=409,
            detail='License key already activated on another terminal')

    # Step 3: Mark as activated on admin (best effort)
    mac_address = _get_hardware_fingerprint()
    ip_address = http_request.client.host if http_request.client else ''

    try:
        await httpx.AsyncClient().put(
            f'https://kindpos.com/api/admin/terminals/{request.license_key}',
            headers={
                'Authorization': f'Bearer {admin_secret}',
                'Content-Type': 'application/json',
            },
            json={
                'terminal_name': matched_terminal.get('terminal_name', ''),
                'node_number':   matched_terminal.get('node_number'),
                'prefix':        matched_terminal.get('prefix', ''),
                'sku':           matched_terminal.get('sku', ''),
                'mac':           mac_address,
                'ip':            ip_address,
                'status':        'ACTIVATED',
            },
            timeout=10.0
        )
    except Exception as e:
        _log.warning(f'Could not update admin record: {e}')
        # Non-fatal — continue with local activation

    # Step 4: Write to local hardware_config.db
    terminal_id = matched_terminal.get('terminal_name', '') or \\
                  f"term-{request.license_key[-8:].lower()}"
    terminal_name = matched_terminal.get('terminal_name') or terminal_id

    await _ensure_db()
    activated_at = datetime.utcnow().isoformat()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        await db.execute('''
            INSERT OR REPLACE INTO terminals
                (terminal_id, auth_key_hash, activated_at, is_active,
                 name, ip_address, mac_address, role, is_hub)
            VALUES (?, ?, ?, 1, ?, ?, ?, 'server', 0)
        ''', (
            terminal_id,
            request.license_key,
            activated_at,
            terminal_name,
            ip_address,
            mac_address,
        ))
        await db.execute('''
            INSERT OR REPLACE INTO server_license
                (id, license_key, hardware_fingerprint, activated_at, status)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            1,
            request.license_key,
            mac_address,
            activated_at,
            'active',
        ))
        await db.commit()
    _write_license_file({"license_key": request.license_key})

    _log.info(
        f'Terminal self-registered: {terminal_name} '
        f'({ip_address}) [{mac_address}]'
    )
    return {
        'status': 'activated',
        'terminal_id': terminal_id,
        'name': terminal_name,
    }


async def _has_active_server_license() -> bool:
    """Authoritative licensure check: any row in server_license with status='active'.

    Reads hardware_config.db live on every call — never a cached flag —
    so revoking a license takes effect immediately without a restart.
    """
    if DEMO_MODE:
        return True
    if not os.path.exists(HARDWARE_DB_PATH):
        return False
    try:
        async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
            async with db.execute(
                "SELECT 1 FROM server_license WHERE status = 'active' LIMIT 1"
            ) as cur:
                row = await cur.fetchone()
                return row is not None
    except aiosqlite.OperationalError:
        # Table missing → treat as unlicensed. Never swallow into "licensed".
        return False


@router.get("/status")
async def license_status(request: Request):
    """Live licensure check.

    Queries the server_license table directly. If no row has status='active',
    return HTTP 402 (Payment Required) so the frontend routes to the
    activation scene. The previous implementation read a cached
    app.state.activated flag set once at startup from license.json — that
    flag could not see revocations, deleted DBs, or any change to
    server_license, which is the bypass this endpoint is closing.
    """
    activated = await _has_active_server_license()
    request.app.state.activated = activated  # keep cache in sync for any legacy reader
    if not activated:
        raise HTTPException(
            status_code=402,
            detail="No active license found. Activate this terminal at /activation.",
        )
    return {"activated": True}
