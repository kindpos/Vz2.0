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

    # Constant-time PIN comparison to avoid a timing side-channel that
    # could leak digits to a co-located attacker on the LAN.
    submitted = request_body.pin or ""
    for e in employees:
        if not e.active or not e.pin:
            continue
        if secrets.compare_digest(e.pin, submitted):
            token = _create_token(e.employee_id, e.display_name, e.role_ids)
            return {
                "valid": True,
                "employee_id": e.employee_id,
                "name": e.display_name,
                "roles": e.role_ids,
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
