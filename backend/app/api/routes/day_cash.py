"""Cash-control endpoints for the drawer.

Three manager-approved POST routes that record starting-cash float
updates, cash drops to safe, and cash payouts. Each one lands a
dedicated ledger event so day-close variance can be reconciled against
an auditable trail instead of "trust the spreadsheet".
"""

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.dependencies import get_ledger
from app.api.routes.auth import require_manager
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import (
    EventType,
    day_cash_drop,
    day_cash_float_updated,
    day_cash_payout,
)


router = APIRouter(prefix="/day/cash", tags=["day", "cash"])


class FloatUpdateRequest(BaseModel):
    amount: Decimal = Field(ge=0)
    set_by: Optional[str] = None
    reason: Optional[str] = None


class CashDropRequest(BaseModel):
    amount: Decimal = Field(gt=0)
    approved_by: Optional[str] = None
    reason: Optional[str] = None
    deposit_ref: Optional[str] = None


class CashPayoutRequest(BaseModel):
    amount: Decimal = Field(gt=0)
    recipient: str = Field(min_length=1)
    approved_by: Optional[str] = None
    reason: Optional[str] = None
    category: Optional[str] = None


async def _current_float(ledger: EventLedger) -> Decimal:
    """Latest float amount since the last day.closed boundary, or 0."""
    boundary = await ledger.get_last_day_close_sequence()
    events = await ledger.get_events_since(boundary)
    latest = Decimal("0.00")
    for e in events:
        if e.event_type == EventType.DAY_CASH_FLOAT_UPDATED:
            latest = Decimal(str(e.payload.get("amount", "0.00")))
    return latest


@router.post("/float", dependencies=[Depends(require_manager)])
async def update_cash_float(
    request: FloatUpdateRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    previous = await _current_float(ledger)
    evt = day_cash_float_updated(
        terminal_id=settings.terminal_id,
        amount=request.amount,
        previous_float=previous,
        set_by=request.set_by,
        reason=request.reason,
    )
    await ledger.append(evt)
    return {
        "success": True,
        "amount": str(request.amount),
        "previous_float": str(previous),
    }


@router.post("/drop", dependencies=[Depends(require_manager)])
async def record_cash_drop(
    request: CashDropRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    evt = day_cash_drop(
        terminal_id=settings.terminal_id,
        amount=request.amount,
        approved_by=request.approved_by,
        reason=request.reason,
        deposit_ref=request.deposit_ref,
    )
    await ledger.append(evt)
    return {
        "success": True,
        "amount": str(request.amount),
    }


@router.post("/payout", dependencies=[Depends(require_manager)])
async def record_cash_payout(
    request: CashPayoutRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    if not request.recipient.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payout recipient is required",
        )
    evt = day_cash_payout(
        terminal_id=settings.terminal_id,
        amount=request.amount,
        recipient=request.recipient.strip(),
        approved_by=request.approved_by,
        reason=request.reason,
        category=request.category,
    )
    await ledger.append(evt)
    return {
        "success": True,
        "amount": str(request.amount),
        "recipient": request.recipient.strip(),
    }
