"""
Sizes API Routes

CRUD endpoints for Size entities.
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
from app.models.config_events import Size
from app.services.overseer_config_service import OverseerConfigService

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/sizes", tags=["sizes"])


def _slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


async def _broadcast(sections: List[str]) -> None:
    _log.info("config.updated sections=%s", sections)


class _SizeCreate(BaseModel):
    size_id: Optional[str] = None
    name: str
    price_adjustment: Decimal = Decimal("0")
    active: bool = True


class _SizeUpdate(BaseModel):
    name: Optional[str] = None
    price_adjustment: Optional[Decimal] = None
    active: Optional[bool] = None


@router.post("", response_model=dict)
async def create_size(
        body: _SizeCreate,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Create a new Size."""
    size_id = body.size_id or _slugify(body.name)
    payload = body.model_dump()
    payload["size_id"] = size_id
    payload["price_adjustment"] = float(payload["price_adjustment"])
    event = create_event(
        event_type=EventType.SIZE_CREATED,
        terminal_id="OVERSEER",
        payload=payload,
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["sizes"])
    return {"status": "ok", "size_id": size_id, "event_id": event.sequence_number}


@router.get("", response_model=List[Size])
async def list_sizes(ledger: EventLedger = Depends(get_ledger)):
    """List all active Sizes."""
    svc = OverseerConfigService(ledger)
    sizes = await svc.get_sizes()
    return [s for s in sizes if s.active]


@router.get("/{size_id}", response_model=Size)
async def get_size(
        size_id: str,
        ledger: EventLedger = Depends(get_ledger),
):
    """Get a single Size by ID."""
    svc = OverseerConfigService(ledger)
    sizes = await svc.get_sizes()
    for s in sizes:
        if s.size_id == size_id:
            return s
    raise HTTPException(status_code=404, detail=f"size '{size_id}' not found")


@router.patch("/{size_id}", response_model=dict)
async def update_size(
        size_id: str,
        body: _SizeUpdate,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Update fields on an existing Size."""
    svc = OverseerConfigService(ledger)
    sizes = await svc.get_sizes()
    if not any(s.size_id == size_id for s in sizes):
        raise HTTPException(status_code=404, detail=f"size '{size_id}' not found")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if "price_adjustment" in fields:
        fields["price_adjustment"] = float(fields["price_adjustment"])
    payload = {"size_id": size_id, **fields}
    event = create_event(
        event_type=EventType.SIZE_UPDATED,
        terminal_id="OVERSEER",
        payload=payload,
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["sizes"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.delete("/{size_id}", response_model=dict)
async def deactivate_size(
        size_id: str,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Deactivate (soft-delete) a Size."""
    svc = OverseerConfigService(ledger)
    sizes = await svc.get_sizes()
    matched = next((s for s in sizes if s.size_id == size_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail=f"size '{size_id}' not found")
    if not matched.active:
        raise HTTPException(status_code=409, detail=f"size '{size_id}' is already inactive")

    event = create_event(
        event_type=EventType.SIZE_DEACTIVATED,
        terminal_id="OVERSEER",
        payload={"size_id": size_id},
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["sizes"])
    return {"status": "ok", "event_id": event.sequence_number}
