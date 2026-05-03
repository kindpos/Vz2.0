from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from app.api.dependencies import get_ledger
from app.api.routes.auth import require_manager, require_owner
from app.core.event_ledger import EventLedger
from app.core.events import (
    user_logged_in,
    user_logged_out,
    cash_tips_declared,
    create_event,
    EventType,
)
from app.config import settings
from app.services.overseer_config_service import OverseerConfigService

router = APIRouter(prefix="/servers", tags=["staff"])


@router.get("")
async def get_servers(ledger: EventLedger = Depends(get_ledger)):
    """
    Returns active employees shaped for the terminal login roster.
    Called by the terminal UI on mount to populate the PIN login screen.
    """
    service = OverseerConfigService(ledger)
    employees = await service.get_employees()
    return {
        "servers": [
            {
                "id": e.employee_id,
                "name": e.display_name,
                "role": e.role_ids[0] if e.role_ids else "server",
                "roles": e.role_ids,
            }
            for e in employees
            if e.active
        ]
    }


# =============================================================================
# CLOCK IN / OUT
# =============================================================================

class ClockInRequest(BaseModel):
    employee_id: str
    employee_name: str
    pin: Optional[str] = None
    role: Optional[str] = None
    pool_memberships: List[str] = []
    mode: Optional[str] = None


class ClockOutRequest(BaseModel):
    employee_id: str
    employee_name: str


async def _clocked_in_ids(ledger: EventLedger) -> set:
    """Return the set of employee IDs currently clocked in."""
    login_events = await ledger.get_events_by_type(EventType.USER_LOGGED_IN)
    logout_events = await ledger.get_events_by_type(EventType.USER_LOGGED_OUT)
    all_events = sorted(login_events + logout_events, key=lambda x: x.sequence_number or 0)
    clocked_in: set = set()
    for e in all_events:
        eid = e.payload["employee_id"]
        if e.event_type == EventType.USER_LOGGED_IN:
            clocked_in.add(eid)
        else:
            clocked_in.discard(eid)
    return clocked_in


@router.post("/clock-in", dependencies=[Depends(require_owner)])
async def clock_in(request: ClockInRequest, ledger: EventLedger = Depends(get_ledger)):
    """Record a staff clock-in event."""
    if request.employee_id in await _clocked_in_ids(ledger):
        raise HTTPException(status_code=400, detail="Already clocked in")
    # TOCTOU guard: the `_clocked_in_ids` check above and the append below
    # are not transactional, so two concurrent POSTs for the same employee
    # could both pass the check and double-append. Key by
    # (employee_id, UTC minute) so the ledger's idempotency gate blocks
    # burst submissions. Minute granularity is pragmatic — nobody
    # legitimately clocks in twice in 60 seconds.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    # user.logged_in remains the session-auth event the existing
    # `_clocked_in_ids` replay relies on; clock.in is the spec-aligned
    # labor event. Both emit atomically so a reader that filters on
    # either sees the same set of clock-in moments.
    event = user_logged_in(
        terminal_id=settings.terminal_id,
        employee_id=request.employee_id,
        employee_name=request.employee_name,
        role=request.role or "",
        pool_memberships=request.pool_memberships,
        mode=request.mode or "",
        idempotency_key=f"clock_in:{request.employee_id}:{stamp}",
    )
    shift_evt = create_event(
        event_type=EventType.CLOCK_IN,
        terminal_id=settings.terminal_id,
        payload={
            "employee_id": request.employee_id,
            "employee_name": request.employee_name,
            "role": request.role or "",
            "pool_memberships": request.pool_memberships,
            "mode": request.mode or "",
        },
    )
    await ledger.append_batch([event, shift_evt])
    return {
        "success": True,
        "employee_id": request.employee_id,
        "employee_name": request.employee_name,
        "clocked_in_at": event.timestamp.isoformat(),
    }


@router.post("/clock-out", dependencies=[Depends(require_owner)])
async def clock_out(request: ClockOutRequest, ledger: EventLedger = Depends(get_ledger)):
    """Record a staff clock-out event."""
    if request.employee_id not in await _clocked_in_ids(ledger):
        raise HTTPException(status_code=400, detail="Not clocked in")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    event = user_logged_out(
        terminal_id=settings.terminal_id,
        employee_id=request.employee_id,
        employee_name=request.employee_name,
        idempotency_key=f"clock_out:{request.employee_id}:{stamp}",
    )
    shift_evt = create_event(
        event_type=EventType.CLOCK_OUT,
        terminal_id=settings.terminal_id,
        payload={
            "employee_id": request.employee_id,
            "employee_name": request.employee_name,
        },
    )
    await ledger.append_batch([event, shift_evt])
    return {
        "success": True,
        "employee_id": request.employee_id,
        "employee_name": request.employee_name,
        "clocked_out_at": event.timestamp.isoformat(),
    }


@router.get("/clocked-in")
async def get_clocked_in(ledger: EventLedger = Depends(get_ledger)):
    """Get all currently clocked-in staff by replaying login/logout events."""
    login_events = await ledger.get_events_by_type(EventType.USER_LOGGED_IN)
    logout_events = await ledger.get_events_by_type(EventType.USER_LOGGED_OUT)

    # Replay login/logout events in sequence order to determine current state
    clocked_in = {}
    all_events = sorted(login_events + logout_events, key=lambda x: x.sequence_number or 0)
    for e in all_events:
        eid = e.payload["employee_id"]
        if e.event_type == EventType.USER_LOGGED_IN:
            clocked_in[eid] = {
                "employee_id": eid,
                "employee_name": e.payload["employee_name"],
                "clocked_in_at": e.timestamp.isoformat(),
            }
        else:
            clocked_in.pop(eid, None)

    return {"staff": list(clocked_in.values())}


# =============================================================================
# CASH TIPS DECLARATION
# =============================================================================

class DeclareCashTipsRequest(BaseModel):
    server_id: str
    amount: Decimal


@router.post("/declare-cash-tips", dependencies=[Depends(require_owner)])
async def declare_cash_tips(
    request: DeclareCashTipsRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    """Record a server's self-reported cash tips at checkout (optional)."""
    if request.amount < 0:
        raise HTTPException(status_code=400, detail="Tip amount cannot be negative")
    if request.amount != request.amount.quantize(Decimal("0.01")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="amount must have at most 2 decimal places",
        )
    event = cash_tips_declared(
        terminal_id=settings.terminal_id,
        server_id=request.server_id,
        amount=request.amount,
        correlation_id=request.server_id,
    )
    await ledger.append(event)
    return {
        "success": True,
        "server_id": request.server_id,
        "amount": event.payload["amount"],
    }
