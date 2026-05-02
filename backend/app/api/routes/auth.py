"""
KINDpos Authentication Routes

PIN verification with rate limiting and session token issuance.
"""

import logging
import time
import secrets
from collections import defaultdict
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from app.api.dependencies import get_ledger, get_diagnostic_collector
from app.config import settings as _settings
from app.core.event_ledger import EventLedger
from app.core.pin_hash import verify_pin_hash
from app.models.diagnostic_event import DiagnosticCategory, DiagnosticSeverity
from app.services.overseer_config_service import OverseerConfigService

router = APIRouter(prefix="/auth", tags=["auth"])
_log = logging.getLogger(__name__)


async def _record_diag(
    category: DiagnosticCategory,
    severity: DiagnosticSeverity,
    source: str,
    event_code: str,
    message: str,
    context: dict,
) -> None:
    """Best-effort diagnostic emission.

    Swallows failures so instrumentation never breaks the user-facing flow
    (e.g. when DiagnosticCollector isn't initialized in tests, or DB is
    mid-restart). Call from anywhere you'd otherwise drop a silent log.
    """
    collector = get_diagnostic_collector()
    if collector is None:
        return
    try:
        await collector.record(
            category=category,
            severity=severity,
            source=source,
            event_code=event_code,
            message=message,
            context=context,
        )
    except Exception:  # pragma: no cover — diagnostic must never raise
        _log.exception("diagnostic record failed [%s]", event_code)

# ── Rate Limiting ─────────────────────────────────
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 60

_attempts: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(client_id: str) -> None:
    """Raise 429 if client has exceeded MAX_ATTEMPTS in the current window."""
    now = time.monotonic()
    # Prune expired entries
    _attempts[client_id] = [t for t in _attempts[client_id] if now - t < WINDOW_SECONDS]
    if len(_attempts[client_id]) >= MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many PIN attempts. Try again in 60 seconds.",
        )


def _record_attempt(client_id: str) -> None:
    """Record a failed PIN attempt."""
    _attempts[client_id].append(time.monotonic())


# ── Session Tokens ────────────────────────────────
TOKEN_TTL_SECONDS = 8 * 60 * 60  # 8-hour shift

_sessions: dict[str, dict] = {}


def _create_token(employee_id: str, name: str, roles: list[str]) -> str:
    """Issue a new session token for an authenticated employee."""
    token = secrets.token_urlsafe(32)
    _sessions[token] = {
        "employee_id": employee_id,
        "name": name,
        "roles": roles,
        "created_at": time.monotonic(),
    }
    return token


def _prune_expired_sessions() -> None:
    """Remove expired session tokens."""
    now = time.monotonic()
    expired = [t for t, s in _sessions.items() if now - s["created_at"] > TOKEN_TTL_SECONDS]
    for t in expired:
        del _sessions[t]


def get_current_session(request: Request) -> dict:
    """Dependency: extract and validate session token from Authorization header.

    Usage in other routes:
        session = Depends(get_current_session)
        # session = {"employee_id": ..., "name": ..., "roles": [...]}
    """
    _prune_expired_sessions()
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        session = _sessions.get(token)
        if session and time.monotonic() - session["created_at"] < TOKEN_TTL_SECONDS:
            return session
    raise HTTPException(status_code=401, detail="Invalid or expired session")


def require_role(*allowed_roles: str):
    """Dependency factory: require the session to have at least one of the allowed roles.

    Usage:
        @router.get("/admin-only", dependencies=[Depends(require_role("admin", "manager"))])
    """
    def _check(session: dict = Depends(get_current_session)) -> dict:
        if not any(r in session["roles"] for r in allowed_roles):
            raise HTTPException(status_code=403, detail="Insufficient role")
        return session
    return Depends(_check)


def _extract_session(request: Request) -> Optional[dict]:
    """Pull a valid session dict off the Authorization header, or None."""
    _prune_expired_sessions()
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        sess = _sessions.get(token)
        if sess and time.monotonic() - sess["created_at"] < TOKEN_TTL_SECONDS:
            return sess
    return None


async def auth_required(request: Request) -> Optional[dict]:
    """Soft-by-default auth gate used as a route-level Depends.

    Behavior:
      - Valid bearer token → return the session dict.
      - No/expired token + settings.auth_enforced=True → record SEC-005
        and raise HTTP 401. Production default.
      - No/expired token + settings.auth_enforced=False → record SEC-005
        and return None. Transition/test default.

    Direct function-call tests (that skip FastAPI's dependency resolver)
    bypass this entirely — only TestClient flows hit it.
    """
    session = _extract_session(request)
    if session is not None:
        return session

    await _record_diag(
        category=DiagnosticCategory.SEC,
        severity=DiagnosticSeverity.WARNING,
        source=f"auth.required.{request.url.path}",
        event_code="SEC-005",
        message="Auth required but no valid token",
        context={
            "method": request.method,
            "path": request.url.path,
            "enforced": bool(getattr(_settings, "auth_enforced", True)),
        },
    )

    if getattr(_settings, "auth_enforced", True):
        raise HTTPException(status_code=401, detail="Authentication required")
    return None


_MANAGER_ROLES = {"manager", "admin", "owner"}


async def require_manager(request: Request) -> Optional[dict]:
    """Route-level dependency: session must carry a manager/admin/owner
    role. Same soft/strict split as `auth_required`:
      - enforced + no token            → 401 + SEC-005
      - enforced + token w/o manager   → 403 + SEC-006
      - soft     + no token            → SEC-005, allow, return None
      - soft     + token w/o manager   → SEC-006, allow, return session
    """
    session = _extract_session(request)
    if session is None:
        await _record_diag(
            category=DiagnosticCategory.SEC,
            severity=DiagnosticSeverity.WARNING,
            source=f"auth.manager.{request.url.path}",
            event_code="SEC-005",
            message="Manager required but no valid token",
            context={"path": request.url.path, "method": request.method},
        )
        if getattr(_settings, "auth_enforced", True):
            raise HTTPException(status_code=401, detail="Authentication required")
        return None
    if any(r in _MANAGER_ROLES for r in (session.get("roles") or [])):
        return session
    # Authenticated but not a manager.
    await _record_diag(
        category=DiagnosticCategory.SEC,
        severity=DiagnosticSeverity.ERROR,
        source=f"auth.manager.{request.url.path}",
        event_code="SEC-006",
        message="Manager role required but session lacks it",
        context={
            "path": request.url.path,
            "session_employee_id": session.get("employee_id"),
            "session_roles": session.get("roles") or [],
        },
    )
    if getattr(_settings, "auth_enforced", True):
        raise HTTPException(status_code=403, detail="Manager role required")
    return session


# ── PIN Validation Helper ─────────────────────────

async def validate_pin_for_operation(
    pin: str,
    client_id: str,
    ledger: EventLedger,
    operation_name: str = "operation",
) -> dict:
    """Validate a PIN and return employee info or raise HTTPException.

    Returns:
        dict with keys: employee_id, name, roles

    Raises:
        HTTPException: on invalid PIN, rate limit, or no matching employee
    """
    try:
        _check_rate_limit(client_id)
    except HTTPException as exc:
        if exc.status_code == 429:
            await _record_diag(
                category=DiagnosticCategory.SEC,
                severity=DiagnosticSeverity.WARNING,
                source=f"auth.validate_pin_for_operation.{operation_name}",
                event_code="SEC-001",
                message=f"PIN rate-limit triggered for {operation_name}",
                context={
                    "client_id": client_id,
                    "operation": operation_name,
                    "attempts_in_window": len(_attempts.get(client_id, [])),
                    "window_seconds": WINDOW_SECONDS,
                },
            )
        raise

    service = OverseerConfigService(ledger)
    employees = await service.get_employees()

    submitted = pin or ""
    for e in employees:
        if not e.active or not e.pin:
            continue
        if verify_pin_hash(submitted, e.pin):
            _attempts.pop(client_id, None)
            return {
                "employee_id": e.employee_id,
                "name": e.display_name,
                "roles": e.role_ids,
            }

    _record_attempt(client_id)
    raise HTTPException(
        status_code=401,
        detail="Invalid PIN",
        headers={"X-Error-Code": "invalid_pin"},
    )


# ── Routes ────────────────────────────────────────

class VerifyPinRequest(BaseModel):
    pin: str


@router.post("/verify-pin")
async def verify_pin(
    request_body: VerifyPinRequest,
    request: Request,
    ledger: EventLedger = Depends(get_ledger),
):
    """Verify a PIN and return the matching employee with a session token.

    Rate-limited: max 5 failed attempts per 60-second window per client.
    """
    client_id = request.client.host if request.client else "unknown"
    try:
        _check_rate_limit(client_id)
    except HTTPException as exc:
        if exc.status_code == 429:
            # SEC-001 — hit the rate-limit ceiling. Worth recording because a
            # burst pattern from one IP is a plausible brute-force signal.
            await _record_diag(
                category=DiagnosticCategory.SEC,
                severity=DiagnosticSeverity.WARNING,
                source="auth.verify_pin",
                event_code="SEC-001",
                message="PIN rate-limit triggered",
                context={
                    "client_id": client_id,
                    "attempts_in_window": len(_attempts.get(client_id, [])),
                    "window_seconds": WINDOW_SECONDS,
                },
            )
        raise

    service = OverseerConfigService(ledger)
    employees = await service.get_employees()

    # Constant-time PIN verify. `verify_pin_hash` accepts both the new
    # PBKDF2-tagged format and legacy plaintext, so employees created
    # before the hashing rollout still authenticate (they'll migrate to
    # hashed form the next time their record is written via the API).
    submitted = request_body.pin or ""
    for e in employees:
        if not e.active or not e.pin:
            continue
        if verify_pin_hash(submitted, e.pin):
            _attempts.pop(client_id, None)
            token = _create_token(e.employee_id, e.display_name, e.role_ids)
            from app.services.overseer_config_service import get_roles
            all_roles = await get_roles(ledger)
            role_map = {r.role_id: r for r in all_roles}
            resolved_roles = [role_map[rid] for rid in e.role_ids if rid in role_map]
            return {
                "valid": True,
                "employee_id": e.employee_id,
                "name": e.display_name,
                "roles": [r.dict() for r in resolved_roles],
                "token": token,
            }

    _record_attempt(client_id)
    return {"valid": False}


@router.post("/logout")
async def logout(request: Request):
    """Invalidate the current session token."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        _sessions.pop(token, None)
    return {"ok": True}
