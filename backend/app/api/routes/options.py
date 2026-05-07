"""
Options API Routes

CRUD endpoints for Option entities.
"""

import re
import logging
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_ledger
from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event
from app.models.config_events import Option
from app.services.overseer_config_service import OverseerConfigService

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/options", tags=["options"])


def _slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


async def _broadcast(sections: List[str]) -> None:
    _log.info("config.updated sections=%s", sections)


class _OptionCreate(BaseModel):
    option_id: Optional[str] = None
    name: str
    price_adjustment: Decimal = Decimal("0")
    negates_price: bool = False
    active: bool = True


class _OptionUpdate(BaseModel):
    name: Optional[str] = None
    price_adjustment: Optional[Decimal] = None
    negates_price: Optional[bool] = None
    active: Optional[bool] = None


@router.post("", response_model=dict)
async def create_option(
        body: _OptionCreate,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Create a new Option."""
    option_id = body.option_id or _slugify(body.name)
    payload = body.model_dump()
    payload["option_id"] = option_id
    event = create_event(
        event_type=EventType.OPTION_CREATED,
        terminal_id="OVERSEER",
        payload=payload,
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["options"])
    return {"status": "ok", "option_id": option_id, "event_id": event.sequence_number}


@router.get("", response_model=List[Option])
async def list_options(ledger: EventLedger = Depends(get_ledger)):
    """List all active Options."""
    svc = OverseerConfigService(ledger)
    options = await svc.get_options()
    return [o for o in options if o.active]


@router.get("/{option_id}", response_model=Option)
async def get_option(
        option_id: str,
        ledger: EventLedger = Depends(get_ledger),
):
    """Get a single Option by ID."""
    svc = OverseerConfigService(ledger)
    options = await svc.get_options()
    for o in options:
        if o.option_id == option_id:
            return o
    raise HTTPException(status_code=404, detail=f"option '{option_id}' not found")


@router.patch("/{option_id}", response_model=dict)
async def update_option(
        option_id: str,
        body: _OptionUpdate,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Update fields on an existing Option."""
    svc = OverseerConfigService(ledger)
    options = await svc.get_options()
    if not any(o.option_id == option_id for o in options):
        raise HTTPException(status_code=404, detail=f"option '{option_id}' not found")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    payload = {"option_id": option_id, **fields}
    event = create_event(
        event_type=EventType.OPTION_UPDATED,
        terminal_id="OVERSEER",
        payload=payload,
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["options"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.delete("/{option_id}", response_model=dict)
async def deactivate_option(
        option_id: str,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Deactivate (soft-delete) an Option."""
    svc = OverseerConfigService(ledger)
    options = await svc.get_options()
    matched = next((o for o in options if o.option_id == option_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail=f"option '{option_id}' not found")
    if not matched.active:
        raise HTTPException(status_code=409, detail=f"option '{option_id}' is already inactive")

    event = create_event(
        event_type=EventType.OPTION_DEACTIVATED,
        terminal_id="OVERSEER",
        payload={"option_id": option_id},
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["options"])
    return {"status": "ok", "event_id": event.sequence_number}
