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
import uuid

from app.core.events import (
    EventType,
    day_cash_drop,
    day_cash_float_updated,
    day_cash_payout,
)
from app.core.money import money_round


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
    transaction_id: Optional[str] = None


class CashPayoutRequest(BaseModel):
    amount: Decimal = Field(gt=0)
    recipient: str = Field(min_length=1)
    approved_by: Optional[str] = None
    reason: Optional[str] = None
    category: Optional[str] = None
    transaction_id: Optional[str] = None


async def _compute_cash_variance(ledger: EventLedger) -> dict:
    """Sum cash flows since last day.closed boundary."""
    since = await ledger.get_last_day_close_sequence()
    events = await ledger.get_events_since(since, limit=10000)

    float_amount = Decimal("0.00")
    drops = Decimal("0.00")
    payouts = Decimal("0.00")
    cash_sales = Decimal("0.00")
    cash_refunds = Decimal("0.00")

    for ev in events:
        p = ev.payload
        if ev.event_type == EventType.DAY_CASH_FLOAT_UPDATED:
            float_amount = Decimal(str(p.get("amount", 0)))
        elif ev.event_type == EventType.DAY_CASH_DROP:
            drops += Decimal(str(p.get("amount", 0)))
        elif ev.event_type == EventType.DAY_CASH_PAYOUT:
            payouts += Decimal(str(p.get("amount", 0)))
        elif ev.event_type == EventType.PAYMENT_CONFIRMED:
            if p.get("method") == "cash":
                cash_sales += Decimal(str(p.get("amount", 0)))
        elif ev.event_type == EventType.PAYMENT_REFUNDED:
            if p.get("method") == "cash":
                cash_refunds += Decimal(str(p.get("amount", 0)))

    expected = float_amount + cash_sales - cash_refunds - drops - payouts
    return {
        "float": str(float_amount),
        "cash_sales": str(cash_sales),
        "cash_refunds": str(cash_refunds),
        "drops": str(drops),
        "payouts": str(payouts),
        "expected_in_drawer": str(money_round(expected)),
    }


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
    tx_id = request.transaction_id or f"drop_{uuid.uuid4().hex[:12]}"
    since = await ledger.get_last_day_close_sequence()
    events = await ledger.get_events_since(since, limit=10000)
    for e in events:
        if (e.event_type == EventType.DAY_CASH_DROP
                and e.payload.get("transaction_id") == request.transaction_id
                and request.transaction_id):
            return {"success": True, "amount": str(e.payload.get("amount"))}
    evt = day_cash_drop(
        terminal_id=settings.terminal_id,
        amount=request.amount,
        approved_by=request.approved_by,
        reason=request.reason,
        deposit_ref=request.deposit_ref,
        transaction_id=tx_id,
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
    tx_id = request.transaction_id or f"payout_{uuid.uuid4().hex[:12]}"
    since = await ledger.get_last_day_close_sequence()
    events = await ledger.get_events_since(since, limit=10000)
    for e in events:
        if (e.event_type == EventType.DAY_CASH_PAYOUT
                and e.payload.get("transaction_id") == request.transaction_id
                and request.transaction_id):
            return {
                "success": True,
                "amount": str(e.payload.get("amount")),
                "recipient": e.payload.get("recipient", ""),
            }
    evt = day_cash_payout(
        terminal_id=settings.terminal_id,
        amount=request.amount,
        recipient=request.recipient.strip(),
        approved_by=request.approved_by,
        reason=request.reason,
        category=request.category,
        transaction_id=tx_id,
    )
    await ledger.append(evt)
    return {
        "success": True,
        "amount": str(request.amount),
        "recipient": request.recipient.strip(),
    }


@router.get("/variance", dependencies=[Depends(require_manager)])
async def get_cash_variance(ledger: EventLedger = Depends(get_ledger)):
    """Compute expected cash in drawer from event history since last day close."""
    return await _compute_cash_variance(ledger)
