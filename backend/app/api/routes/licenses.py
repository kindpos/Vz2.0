"""
License Status Routes

Handles license status checking. Licensing is now file-based via license_verifier.py,
which populates the server_license table at boot.
"""

import logging
import os

import aiosqlite
from fastapi import APIRouter, HTTPException, Request

from app.api.routes.hardware import HARDWARE_DB_PATH

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/licenses", tags=["licenses"])

DEMO_MODE = os.environ.get("KINDPOS_STORE_MODE") == "demo"


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
