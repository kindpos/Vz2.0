"""
FastAPI dependencies for Overseer auth (OVERSEER_AUTH.md §5).

Resolves the session cookie, looks the row up in `accounts.db`, refreshes
its expiry (per §5.1 "refreshed on activity"), and exposes the
authenticated `User` to route handlers. `require_role` is a factory for
role-gated routes.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Iterable, Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request, status

from app.persistence.accounts_db import _DB_PATH
from app.persistence.users_repository import User, UsersRepository
from app.auth.sessions import Session, SessionsRepository


SESSION_COOKIE_NAME = "kindpos_session"


def _require_db_path() -> str:
    # Re-import on each call so that tests which init the DB after import
    # still see the updated path.
    from app.persistence import accounts_db as _accounts_db_mod

    if _accounts_db_mod._DB_PATH is None:
        raise RuntimeError(
            "accounts DB not initialized; call init_accounts_db(path) before "
            "handling requests"
        )
    return str(_accounts_db_mod._DB_PATH)


def get_users_repo() -> UsersRepository:
    return UsersRepository(_require_db_path())


def get_sessions_repo() -> SessionsRepository:
    return SessionsRepository(_require_db_path())


def get_current_session(
    request: Request,
    session_cookie: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    sessions: SessionsRepository = Depends(get_sessions_repo),
) -> Session:
    """Resolve and refresh the caller's session. 401 if missing / revoked /
    expired. On success, extends `expires_at` by another 24h."""
    if not session_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    sess = sessions.get_session(session_cookie)
    if sess is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    # Refresh on activity per §5.1. We re-read to surface the new expires_at
    # in any downstream consumer that inspects the Session object.
    new_expires = sessions.refresh_session(sess.session_id)
    if new_expires is None:
        # Race: session was revoked between get and refresh.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    return Session(
        session_id=sess.session_id,
        user_id=sess.user_id,
        created_at=sess.created_at,
        expires_at=new_expires,
        ip=sess.ip,
        user_agent=sess.user_agent,
        revoked=False,
    )


def get_current_user(
    session: Session = Depends(get_current_session),
    users: UsersRepository = Depends(get_users_repo),
) -> User:
    user = users.get_user_by_id(session.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    return user


def require_terminal_token(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Validate an Overseer-issued binding token from the Authorization
    header (OVERSEER_AUTH.md §7).

    Performs the five local checks specified in §7:
      1. parse `Bearer <token>` and base64-decode the payload,
      2. verify the Ed25519 signature with the stored Overseer public key,
      3. confirm `expires_at > now`,
      4. confirm the slot is bound and active,
      5. confirm `payload.fingerprint` matches the stored hardware fingerprint.

    The revocation check (step 5 of §7's terminal-side list) is handled by
    the route itself, since the revocations list is exactly what the only
    consumer of this dependency — `GET /v1/terminals/revocations` — returns.

    Returns the verified payload dict; raises HTTP 401 on any failure.
    """
    # Lazy import to avoid a circular import at module load
    # (token_service has no FastAPI deps, but persistence imports do).
    from app.persistence.provisioning_keys import OVERSEER_PUBLIC_KEY
    from app.persistence.provisioning_repository import ProvisioningRepository
    from app.persistence.terminals_repository import get_slot_by_token_payload
    from app.services.token_service import verify_terminal_token

    def _unauthorized() -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid terminal token",
        )

    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized()
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise _unauthorized()

    db_path = _require_db_path()
    public_key_b64url = ProvisioningRepository(db_path).get_value(OVERSEER_PUBLIC_KEY)
    if not public_key_b64url:
        raise _unauthorized()

    payload = verify_terminal_token(token=token, public_key_b64url=public_key_b64url)
    if payload is None:
        raise _unauthorized()

    expires_at_raw = payload.get("expires_at")
    slot_id = payload.get("slot_id")
    fingerprint = payload.get("fingerprint")
    if not expires_at_raw or not slot_id or not fingerprint:
        raise _unauthorized()

    try:
        expires_at = datetime.fromisoformat(expires_at_raw)
    except ValueError:
        raise _unauthorized()
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise _unauthorized()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = get_slot_by_token_payload(conn, slot_id)
    finally:
        conn.close()
    if row is None or not row.get("is_active"):
        raise _unauthorized()
    if row.get("hardware_fingerprint") != fingerprint:
        raise _unauthorized()

    return payload


def require_role(*roles: str):
    """Dependency factory: 403 if the authenticated user's role is not in
    the allow-list. Usage: `Depends(require_role("store_admin"))`."""
    allowed = set(roles)

    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="forbidden",
            )
        return user

    return _checker
