"""
License Management Routes

Handles license activation and status checking.
"""

import hashlib
import json
import logging
import os
import httpx
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/licenses", tags=["licenses"])

DEMO_MODE = os.environ.get("KINDPOS_MODE") == "demo"

LICENSE_FILE = "/home/kindpos/data/license.json"
WORKER_URL = "https://kindpos.com/api/activate"


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


class ActivateLicenseRequest(BaseModel):
    license_key: str
    store_name: str
    terminal_name: str


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
