"""
FastAPI dependencies for Overseer auth (OVERSEER_AUTH.md §5).

Resolves the session cookie, looks the row up in `accounts.db`, refreshes
its expiry (per §5.1 "refreshed on activity"), and exposes the
authenticated `User` to route handlers. `require_role` is a factory for
role-gated routes.
"""

from __future__ import annotations

from typing import Iterable, Optional

from fastapi import Cookie, Depends, HTTPException, Request, status

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
