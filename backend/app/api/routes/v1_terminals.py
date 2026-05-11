"""
Terminal binding endpoints (OVERSEER_AUTH.md §6.3, §7, §9.2).

`POST /v1/terminals/bind` — store_admin-gated. Transitions an unbound slot
to bound by writing `hardware_fingerprint`, `bound_at`, `bound_by_user_id`,
the preferred `terminal_name`, and the freshly-issued Ed25519 binding
token (§7). On success the §9.2 terminal-bound phone-home is enqueued.
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
    OVERSEER_PRIVATE_KEY,
    OVERSEER_PUBLIC_KEY,
    STORE_REF,
)
from app.persistence.provisioning_repository import ProvisioningRepository
from app.persistence.users_repository import User
from app.services.token_service import issue_terminal_token


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
    token: str
    token_expires_at: str
    overseer_public_key: str


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

        # Read provisioning values needed to sign the §7 token. Without these
        # the bind cannot complete per OVERSEER_AUTH.md §6.3 Step 3.
        provisioning_repo = ProvisioningRepository(db_path)
        store_ref = provisioning_repo.get_value(STORE_REF)
        private_key_b64url = provisioning_repo.get_value(OVERSEER_PRIVATE_KEY)
        public_key_b64url = provisioning_repo.get_value(OVERSEER_PUBLIC_KEY)
        if not store_ref or not private_key_b64url or not public_key_b64url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="overseer not provisioned for token issuance",
            )

        issued = issue_terminal_token(
            slot_id=slot_id,
            store_ref=store_ref,
            fingerprint=payload.hardware_fingerprint,
            private_key_b64url=private_key_b64url,
        )

        conn.execute(
            """
            UPDATE terminal_bindings
               SET hardware_fingerprint = ?,
                   bound_at             = ?,
                   bound_by_user_id     = ?,
                   terminal_name        = ?,
                   token                = ?,
                   token_expires_at     = ?
             WHERE slot_id = ?
            """,
            (
                payload.hardware_fingerprint,
                bound_at,
                user.user_id,
                terminal_name,
                issued["token"],
                issued["token_expires_at"],
                slot_id,
            ),
        )
        conn.commit()

        # OVERSEER_AUTH.md §9.2 — enqueue terminal-bound phone-home.
        # Skipped when the kindpos.com side hasn't been provisioned (dev installs).
        api_key = provisioning_repo.get_value(CUSTOMER_API_KEY)
        api_base = (
            provisioning_repo.get_value(KINDPOS_API_BASE) or "https://kindpos.com"
        )
        if api_key:
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
            token=issued["token"],
            token_expires_at=issued["token_expires_at"],
            overseer_public_key=public_key_b64url,
        )
    finally:
        conn.close()
