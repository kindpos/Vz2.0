"""
Terminal binding endpoints (OVERSEER_AUTH.md §6.3, §9.2).

`POST /v1/terminals/bind` — store_admin-gated. Transitions an unbound slot
to bound by writing `hardware_fingerprint`, `bound_at`, `bound_by_user_id`,
and (optionally) the preferred `terminal_name`. On success the §9.2
terminal-bound phone-home is enqueued via `phone_home_queue`.

Minimal slice: this does NOT yet issue the §7 Ed25519-signed binding token.
That `token`/`token_expires_at` work is deferred to a later prompt; the
columns remain NULL until then.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth.dependencies import require_role
from app.persistence.phone_home_repository import enqueue_phone_home
from app.persistence.provisioning_keys import (
    CUSTOMER_API_KEY,
    KINDPOS_API_BASE,
    STORE_REF,
)
from app.persistence.provisioning_repository import ProvisioningRepository
from app.persistence.users_repository import User


router = APIRouter(prefix="/v1/terminals", tags=["terminals"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _accounts_db_path() -> str:
    # Re-imported each call so tests that re-init the DB still resolve right —
    # mirrors the pattern in app/auth/dependencies.py and app/auth/recovery.py.
    from app.persistence import accounts_db as _accounts_db_mod

    if _accounts_db_mod._DB_PATH is None:
        raise RuntimeError(
            "accounts DB not initialized; call init_accounts_db(path) before "
            "handling requests"
        )
    return str(_accounts_db_mod._DB_PATH)


class BindRequest(BaseModel):
    hardware_fingerprint: str = Field(..., min_length=1)
    terminal_name_preferred: Optional[str] = None
    slot_id: Optional[str] = None


class BindResponse(BaseModel):
    slot_id: str
    terminal_name: str
    bound_at: str


@router.post("/bind", response_model=BindResponse)
def bind_terminal(
    payload: BindRequest,
    user: User = Depends(require_role("store_admin")),
) -> BindResponse:
    db_path = _accounts_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        # Resolve slot row. Explicit slot_id → validate; otherwise auto-pick
        # the lowest unbound active slot.
        if payload.slot_id:
            row = conn.execute(
                """
                SELECT slot_id, terminal_name, hardware_fingerprint, is_active
                  FROM terminal_bindings
                 WHERE slot_id = ?
                """,
                (payload.slot_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="slot not found"
                )
            if not row["is_active"]:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="slot inactive"
                )
            if row["hardware_fingerprint"] is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="slot already bound",
                )
        else:
            row = conn.execute(
                """
                SELECT slot_id, terminal_name
                  FROM terminal_bindings
                 WHERE hardware_fingerprint IS NULL
                   AND is_active = 1
                 ORDER BY slot_id
                 LIMIT 1
                """,
            ).fetchone()
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="no unbound slot available",
                )

        slot_id = row["slot_id"]
        terminal_name = payload.terminal_name_preferred or row["terminal_name"]
        bound_at = _now_iso()

        conn.execute(
            """
            UPDATE terminal_bindings
               SET hardware_fingerprint = ?,
                   bound_at             = ?,
                   bound_by_user_id     = ?,
                   terminal_name        = ?
             WHERE slot_id = ?
            """,
            (
                payload.hardware_fingerprint,
                bound_at,
                user.user_id,
                terminal_name,
                slot_id,
            ),
        )
        conn.commit()

        # OVERSEER_AUTH.md §9.2 — enqueue terminal-bound phone-home.
        # Skipped when provisioning hasn't been baked in (dev installs).
        provisioning_repo = ProvisioningRepository(db_path)
        store_ref = provisioning_repo.get_value(STORE_REF)
        api_key = provisioning_repo.get_value(CUSTOMER_API_KEY)
        api_base = (
            provisioning_repo.get_value(KINDPOS_API_BASE) or "https://kindpos.com"
        )
        if store_ref and api_key:
            enqueue_phone_home(
                conn,
                endpoint=f"{api_base}/api/notify/terminal-bound",
                payload={
                    "store_ref": store_ref,
                    "slot_id": slot_id,
                    "terminal_name": terminal_name,
                    "hardware_fingerprint": payload.hardware_fingerprint,
                    "bound_at": bound_at,
                },
            )

        return BindResponse(
            slot_id=slot_id,
            terminal_name=terminal_name,
            bound_at=bound_at,
        )
    finally:
        conn.close()
