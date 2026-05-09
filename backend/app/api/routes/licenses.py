"""
License Management Routes

Handles license activation and status checking.
"""

import asyncio
import hashlib
import json
import logging
import os
import socket
import httpx
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/licenses", tags=["licenses"])

DEMO_MODE = os.environ.get("KINDPOS_STORE_MODE") == "demo"

LICENSE_FILE = "/home/kindpos/data/license.json"
WORKER_URL = "https://kindpos.com/api/activate"
CHECKIN_URL = "https://kindpos.com/api/checkin"
CHECKIN_INTERVAL_S = 3600  # 60 minutes


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
    """Extract hardware fingerprint from Pi: SHA256(serial + mac)."""
    try:
        serial = ""
        try:
            with open("/proc/cpuinfo", "r") as f:
                for line in f:
                    if line.startswith("Serial"):
                        serial = line.split(":")[1].strip()
                        break
        except Exception as e:
            _log.warning(f"Could not read /proc/cpuinfo: {e}")
            serial = "unknown"

        mac = ""
        try:
            with open("/sys/class/net/eth0/address", "r") as f:
                mac = f.read().strip()
        except Exception as e:
            _log.warning(f"Could not read eth0 MAC: {e}")
            mac = "unknown"

        combined = f"{serial}:{mac}"
        fingerprint = hashlib.sha256(combined.encode()).hexdigest()
        return fingerprint
    except Exception as e:
        _log.error(f"Error getting hardware fingerprint: {e}")
        raise HTTPException(status_code=500, detail="Could not read hardware fingerprint")


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


async def _perform_checkin() -> None:
    """Send periodic checkin to kindpos.com if license is active."""
    if DEMO_MODE:
        return

    license_data = _read_license_file()
    if not license_data:
        return

    license_key = license_data.get("license_key")
    if not license_key:
        return

    try:
        fingerprint = _get_hardware_fingerprint()
        ip = get_lan_ip()

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                CHECKIN_URL,
                json={
                    "license_key": license_key,
                    "hardware_fingerprint": fingerprint,
                    "ip": ip,
                },
                timeout=5.0
            )
        _log.debug(f"License checkin: {resp.status_code}")
    except Exception as e:
        _log.debug(f"License checkin failed (non-fatal): {e}")


async def start_license_checkin_loop() -> asyncio.Task:
    """Start the periodic license checkin background task."""
    async def _checkin_loop():
        while True:
            try:
                await asyncio.sleep(CHECKIN_INTERVAL_S)
                await _perform_checkin()
            except asyncio.CancelledError:
                break
            except Exception as e:
                _log.debug(f"Checkin loop error (non-fatal): {e}")

    return asyncio.create_task(_checkin_loop())


class ActivateLicenseRequest(BaseModel):
    license_key: str
    store_name: str = ""
    terminal_name: str = ""


class ActivateLicenseResponse(BaseModel):
    success: bool
    store_name: str
    terminal_name: str


@router.post("/activate", response_model=ActivateLicenseResponse)
async def activate_license(request: ActivateLicenseRequest):
    """Activate a license on this Pi."""
    if DEMO_MODE:
        return {"activated": True, "demo": True, "message": "Demo mode — no activation required"}
    hardware_fingerprint = _get_hardware_fingerprint()

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                WORKER_URL,
                json={
                    "license_key": request.license_key,
                    "hardware_fingerprint": hardware_fingerprint,
                    "store_name": request.store_name,
                    "terminal_name": request.terminal_name,
                },
                timeout=10.0
            )

        if resp.status_code != 200:
            error_data = resp.json()
            error_msg = error_data.get("error", "Activation failed")
            _log.error(f"Worker returned error: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        # Write successful activation to license file
        license_data = resp.json()
        license_data["hardware_fingerprint"] = hardware_fingerprint
        _write_license_file(license_data)
        _log.info(f"License activated: {request.license_key}")

        write_node_hostname(license_data.get("node_number", 1))

        return ActivateLicenseResponse(
            success=True,
            store_name=request.store_name,
            terminal_name=request.terminal_name
        )
    except httpx.RequestError as e:
        _log.error(f"Request error contacting Worker: {e}")
        raise HTTPException(status_code=500, detail="Could not reach licensing server")
    except HTTPException:
        raise
    except Exception as e:
        _log.error(f"Unexpected error during activation: {e}")
        raise HTTPException(status_code=500, detail="Activation failed")


@router.get("/status")
async def get_license_status():
    """Check license activation status."""
    if DEMO_MODE:
        return {"activated": True, "demo": True, "store_name": "KINDpos Demo",
                "terminal_name": "Demo Terminal", "prefix": "DM", "node_number": 1}
    license_data = _read_license_file()

    if license_data:
        return {
            "activated": True,
            **license_data
        }
    else:
        return {
            "activated": False
        }
