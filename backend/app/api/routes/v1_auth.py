"""
Overseer auth endpoints (OVERSEER_AUTH.md §5).

`/v1/auth/login`           §5.1 — issues a 24h HttpOnly Secure SameSite=Strict
                                   session cookie. Generic 401 on bad creds
                                   defeats user enumeration. Rate-limited
                                   per-email and per-IP.
`/v1/auth/logout`          §5.2 — revokes the caller's session.
`/v1/auth/password-change` §5.3 — authenticated; rotates password and clears
                                   `must_change_password`.
`/v1/auth/password-recovery` §5.4 — unauthenticated; one-shot recovery code
                                    rotates the password and the code in a
                                    single transaction.
`/v1/auth/me`              §5.5 — current user info for session validation
                                   on page load.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Optional

from argon2 import PasswordHasher
from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from pydantic import BaseModel, Field

from app.auth.dependencies import (
    SESSION_COOKIE_NAME,
    get_current_session,
    get_current_user,
    get_sessions_repo,
    get_users_repo,
)
from app.auth.rate_limit import (
    WINDOW_SECONDS,
    check_rate_limit,
    record_failure,
    record_success,
)
from app.auth.recovery import (
    PROVISIONING_KEY_RECOVERY_HASH,
    generate_recovery_code,
    normalize_recovery_code,
    verify_recovery_code,
)
from app.auth.sessions import Session, SessionsRepository
from app.persistence.users_repository import User, UsersRepository


router = APIRouter(prefix="/v1/auth", tags=["auth"])


SESSION_MAX_AGE_SECONDS = 24 * 60 * 60
MIN_PASSWORD_LENGTH = 12

GENERIC_AUTH_FAILURE = "invalid credentials"


# ─── request / response models ───────────────────────────────────────────


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    user_id: str
    email: str
    role: str
    must_change_password: bool
    session_id: str
    expires_at: str


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1)


class PasswordRecoveryRequest(BaseModel):
    email: str = Field(..., min_length=1)
    recovery_code: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1)


class PasswordRecoveryResponse(BaseModel):
    new_recovery_code: str


class MeResponse(BaseModel):
    user_id: str
    email: str
    role: str
    must_change_password: bool
    last_login_at: Optional[str]


# ─── helpers ─────────────────────────────────────────────────────────────


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )


def _clear_must_change_password(db_path: str, user_id: str) -> None:
    """Inline write — users_repository.py is frozen at Prompt 1, so the
    must_change_password reset happens here next to the password update."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "UPDATE users SET must_change_password = 0, updated_at = ? WHERE user_id = ?",
            (now, user_id),
        )
        conn.commit()
    finally:
        conn.close()


_RECOVERY_HASHER = PasswordHasher()


def _atomic_password_and_recovery_rotation(
    db_path: str,
    user_id: str,
    new_password_plaintext: str,
    new_recovery_code_plaintext: str,
) -> None:
    """Rotate password_hash + recovery_code_hash in a single transaction.

    §5.4 says recovery must rotate both pieces of state atomically — a crash
    in between would leave the user unable to log in with the new password
    while the new recovery code is the only remaining way in (or vice versa).
    Both writes run on the same connection so SQLite's implicit transaction
    commits them together.
    """
    new_password_hash = _RECOVERY_HASHER.hash(new_password_plaintext)
    new_recovery_hash = _RECOVERY_HASHER.hash(
        normalize_recovery_code(new_recovery_code_plaintext)
    )
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("BEGIN")
        conn.execute(
            """
            UPDATE users
               SET password_hash = ?,
                   updated_at = ?,
                   must_change_password = 0
             WHERE user_id = ?
            """,
            (new_password_hash, now, user_id),
        )
        conn.execute(
            "INSERT OR REPLACE INTO provisioning (key, value) VALUES (?, ?)",
            (PROVISIONING_KEY_RECOVERY_HASH, new_recovery_hash),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─── routes ──────────────────────────────────────────────────────────────


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    users: UsersRepository = Depends(get_users_repo),
    sessions: SessionsRepository = Depends(get_sessions_repo),
) -> LoginResponse:
    ip = _client_ip(request)

    rl = check_rate_limit(payload.email, ip)
    if not rl.allowed:
        # Surface a typical Retry-After header per RFC 6585.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too many attempts",
            headers={"Retry-After": str(rl.retry_after or WINDOW_SECONDS)},
        )

    user = users.get_user_by_email(payload.email)
    if user is None:
        record_failure(payload.email, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=GENERIC_AUTH_FAILURE,
        )

    if not user.is_active:
        # Deactivated account — distinct status per §5.1. We do not record
        # this as a rate-limit failure because the credentials may be
        # legitimate; the issue is account state.
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="account disabled",
        )

    if not users.verify_password(user.user_id, payload.password):
        record_failure(payload.email, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=GENERIC_AUTH_FAILURE,
        )

    record_success(payload.email)
    users.mark_login(user.user_id)
    session_id, expires_at = sessions.create_session(
        user_id=user.user_id,
        ip=ip,
        user_agent=request.headers.get("user-agent"),
    )
    _set_session_cookie(response, session_id)

    return LoginResponse(
        user_id=user.user_id,
        email=user.email,
        role=user.role,
        must_change_password=user.must_change_password,
        session_id=session_id,
        expires_at=expires_at,
    )


@router.post("/password-change", status_code=status.HTTP_204_NO_CONTENT)
def password_change(
    payload: PasswordChangeRequest,
    user: User = Depends(get_current_user),
    users: UsersRepository = Depends(get_users_repo),
) -> Response:
    if len(payload.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="new password must differ from current password",
        )
    if not users.verify_password(user.user_id, payload.current_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=GENERIC_AUTH_FAILURE,
        )

    users.update_password(user.user_id, payload.new_password)
    _clear_must_change_password(users.db_path, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    session: Session = Depends(get_current_session),
    sessions: SessionsRepository = Depends(get_sessions_repo),
) -> Response:
    sessions.revoke_session(session.session_id)
    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    # Best-effort clear of the cookie on the client; revocation in the DB
    # is what actually enforces logout for shared/stolen cookies.
    resp.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return resp


@router.post("/password-recovery", response_model=PasswordRecoveryResponse)
def password_recovery(
    payload: PasswordRecoveryRequest,
    users: UsersRepository = Depends(get_users_repo),
) -> PasswordRecoveryResponse:
    # New-password validation happens first so a malformed request never
    # consumes a recovery code attempt.
    if len(payload.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )

    user = users.get_user_by_email(payload.email)
    if user is None:
        # Same response shape as a wrong recovery code so callers can't
        # distinguish "unknown email" from "bad code".
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=GENERIC_AUTH_FAILURE,
        )

    if not verify_recovery_code(payload.recovery_code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=GENERIC_AUTH_FAILURE,
        )

    new_code = generate_recovery_code()
    _atomic_password_and_recovery_rotation(
        db_path=users.db_path,
        user_id=user.user_id,
        new_password_plaintext=payload.new_password,
        new_recovery_code_plaintext=new_code,
    )
    return PasswordRecoveryResponse(new_recovery_code=new_code)


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(
        user_id=user.user_id,
        email=user.email,
        role=user.role,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
    )
