"""
OptionGroups API Routes

CRUD endpoints for OptionGroup entities, including option membership management.
"""

import re
import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_ledger
from app.core.event_ledger import EventLedger
from app.core.events import EventType, create_event
from app.models.config_events import OptionGroup
from app.services.overseer_config_service import OverseerConfigService

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/option-groups", tags=["option-groups"])


def _slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


async def _broadcast(sections: List[str]) -> None:
    _log.info("config.updated sections=%s", sections)


class _OptionGroupCreate(BaseModel):
    option_group_id: Optional[str] = None
    name: str
    option_ids: List[str] = []
    active: bool = True


class _OptionGroupUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None


@router.post("", response_model=dict)
async def create_option_group(
        body: _OptionGroupCreate,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Create a new OptionGroup."""
    option_group_id = body.option_group_id or _slugify(body.name)
    payload = body.model_dump()
    payload["option_group_id"] = option_group_id
    event = create_event(
        event_type=EventType.OPTION_GROUP_CREATED,
        terminal_id="OVERSEER",
        payload=payload,
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["option_groups"])
    return {"status": "ok", "option_group_id": option_group_id, "event_id": event.sequence_number}


@router.get("", response_model=List[OptionGroup])
async def list_option_groups(ledger: EventLedger = Depends(get_ledger)):
    """List all active OptionGroups."""
    svc = OverseerConfigService(ledger)
    groups = await svc.get_option_groups()
    return [g for g in groups if g.active]


@router.get("/{option_group_id}", response_model=OptionGroup)
async def get_option_group(
        option_group_id: str,
        ledger: EventLedger = Depends(get_ledger),
):
    """Get a single OptionGroup by ID."""
    svc = OverseerConfigService(ledger)
    groups = await svc.get_option_groups()
    for g in groups:
        if g.option_group_id == option_group_id:
            return g
    raise HTTPException(status_code=404, detail=f"option_group '{option_group_id}' not found")


@router.patch("/{option_group_id}", response_model=dict)
async def update_option_group(
        option_group_id: str,
        body: _OptionGroupUpdate,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Update fields on an existing OptionGroup."""
    svc = OverseerConfigService(ledger)
    groups = await svc.get_option_groups()
    if not any(g.option_group_id == option_group_id for g in groups):
        raise HTTPException(status_code=404, detail=f"option_group '{option_group_id}' not found")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    payload = {"option_group_id": option_group_id, **fields}
    event = create_event(
        event_type=EventType.OPTION_GROUP_UPDATED,
        terminal_id="OVERSEER",
        payload=payload,
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["option_groups"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.delete("/{option_group_id}", response_model=dict)
async def deactivate_option_group(
        option_group_id: str,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Deactivate (soft-delete) an OptionGroup."""
    svc = OverseerConfigService(ledger)
    groups = await svc.get_option_groups()
    matched = next((g for g in groups if g.option_group_id == option_group_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail=f"option_group '{option_group_id}' not found")
    if not matched.active:
        raise HTTPException(status_code=409, detail=f"option_group '{option_group_id}' is already inactive")

    event = create_event(
        event_type=EventType.OPTION_GROUP_DEACTIVATED,
        terminal_id="OVERSEER",
        payload={"option_group_id": option_group_id},
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["option_groups"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.post("/{option_group_id}/options/{option_id}", response_model=dict)
async def add_option_to_group(
        option_group_id: str,
        option_id: str,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Add an option to an OptionGroup's ordered list."""
    svc = OverseerConfigService(ledger)
    groups = await svc.get_option_groups()
    matched = next((g for g in groups if g.option_group_id == option_group_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail=f"option_group '{option_group_id}' not found")
    if option_id in matched.option_ids:
        raise HTTPException(status_code=409, detail=f"option '{option_id}' already in group")

    event = create_event(
        event_type=EventType.OPTION_GROUP_OPTION_ADDED,
        terminal_id="OVERSEER",
        payload={"option_group_id": option_group_id, "option_id": option_id},
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["option_groups"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.delete("/{option_group_id}/options/{option_id}", response_model=dict)
async def remove_option_from_group(
        option_group_id: str,
        option_id: str,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Remove an option from an OptionGroup's ordered list."""
    svc = OverseerConfigService(ledger)
    groups = await svc.get_option_groups()
    matched = next((g for g in groups if g.option_group_id == option_group_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail=f"option_group '{option_group_id}' not found")
    if option_id not in matched.option_ids:
        raise HTTPException(status_code=404, detail=f"option '{option_id}' not in group")

    event = create_event(
        event_type=EventType.OPTION_GROUP_OPTION_REMOVED,
        terminal_id="OVERSEER",
        payload={"option_group_id": option_group_id, "option_id": option_id},
    )
    await ledger.append(event)
    background_tasks.add_task(_broadcast, ["option_groups"])
    return {"status": "ok", "event_id": event.sequence_number}
