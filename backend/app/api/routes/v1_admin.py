"""
Overseer admin endpoints (OVERSEER_AUTH.md §2.2 — store_admin actions).

This is the first protected admin route — it exercises the full auth chain
(cookie → session → user → role check) end-to-end so a regression in any
upstream module surfaces here as a 401/403. Future user-management endpoints
(create user, activate/deactivate, role change) land in this router.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_users_repo, require_role
from app.persistence.users_repository import User, UsersRepository


router = APIRouter(prefix="/v1/admin", tags=["admin"])


class UserOut(BaseModel):
    """Wire shape for /v1/admin/users. Explicit projection so password_hash
    is structurally impossible to leak even if the `User` dataclass gains
    fields later."""

    user_id: str
    email: str
    role: str
    must_change_password: bool
    created_at: str
    updated_at: str
    last_login_at: Optional[str]
    is_active: bool


def _to_out(u: User) -> UserOut:
    return UserOut(
        user_id=u.user_id,
        email=u.email,
        role=u.role,
        must_change_password=u.must_change_password,
        created_at=u.created_at,
        updated_at=u.updated_at,
        last_login_at=u.last_login_at,
        is_active=u.is_active,
    )


@router.get("/users", response_model=list[UserOut])
def list_admin_users(
    _admin: User = Depends(require_role("store_admin")),
    users: UsersRepository = Depends(get_users_repo),
) -> list[UserOut]:
    return [_to_out(u) for u in users.list_users()]
