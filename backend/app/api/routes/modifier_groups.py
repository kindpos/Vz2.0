"""
Modifier Groups — pricing chain write endpoints.

These complement the existing config push flow for the two new pricing
chain fields on modifier groups:
  POST /{group_id}/option-group          → MODIFIER_GROUP_OPTION_GROUP_SET
  PATCH /{group_id}/size-adjustments     → MODIFIER_GROUP_SIZE_ADJUSTMENTS_UPDATED
"""

from decimal import Decimal
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_ledger
from app.core import events as evt
from app.core.menu_projection import project_menu

router = APIRouter(prefix="/modifier-groups", tags=["modifier-groups"])


class _SetOptionGroupBody(BaseModel):
    option_group_id: Optional[str] = None


class _SizeAdjustmentsBody(BaseModel):
    size_price_adjustments: Dict[str, float] = {}


async def _get_group(group_id: str, ledger):
    menu = project_menu(await ledger.get_events())
    grp = menu.modifier_groups_by_id.get(group_id)
    if grp is None:
        raise HTTPException(status_code=404, detail=f"Modifier group '{group_id}' not found")
    return grp


@router.post("/{group_id}/option-group", status_code=200)
async def set_option_group(
    group_id: str,
    body: _SetOptionGroupBody,
    ledger=Depends(get_ledger),
):
    """Attach (or detach) a default OptionGroup to a modifier group."""
    await _get_group(group_id, ledger)
    await ledger.emit(
        evt.EventType.MODIFIER_GROUP_OPTION_GROUP_SET,
        {"group_id": group_id, "option_group_id": body.option_group_id},
        terminal_id="overseer",
    )
    menu = project_menu(await ledger.get_events())
    return menu.modifier_groups_by_id.get(group_id, {})


@router.patch("/{group_id}/size-adjustments", status_code=200)
async def update_size_adjustments(
    group_id: str,
    body: _SizeAdjustmentsBody,
    ledger=Depends(get_ledger),
):
    """Replace the flat size-fallback price adjustments on a modifier group."""
    await _get_group(group_id, ledger)
    await ledger.emit(
        evt.EventType.MODIFIER_GROUP_SIZE_ADJUSTMENTS_UPDATED,
        {
            "group_id": group_id,
            "size_price_adjustments": {k: float(v) for k, v in body.size_price_adjustments.items()},
        },
        terminal_id="overseer",
    )
    menu = project_menu(await ledger.get_events())
    return menu.modifier_groups_by_id.get(group_id, {})
