"""
Modifiers — pricing chain write endpoint.

  PUT /{modifier_id}/size-pricing/{group_id}  → MODIFIER_SIZE_PRICING_SET
"""

from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_ledger
from app.core import events as evt
from app.core.menu_projection import project_menu

router = APIRouter(prefix="/modifiers", tags=["modifiers"])


class _SizePricingBody(BaseModel):
    size_prices: Dict[str, float] = {}


async def _get_modifier(modifier_id: str, ledger):
    menu = project_menu(await ledger.get_events())
    mod = menu.modifiers.get(modifier_id)
    if mod is None:
        raise HTTPException(status_code=404, detail=f"Modifier '{modifier_id}' not found")
    return mod


@router.put("/{modifier_id}/size-pricing/{group_id}", status_code=200)
async def set_modifier_size_pricing(
    modifier_id: str,
    group_id: str,
    body: _SizePricingBody,
    ledger=Depends(get_ledger),
):
    """Set size-aware price adjustments for one modifier relative to a drives_pricing group."""
    await _get_modifier(modifier_id, ledger)
    await ledger.emit(
        evt.EventType.MODIFIER_SIZE_PRICING_SET,
        {
            "modifier_id": modifier_id,
            "group_id": group_id,
            "size_prices": {k: float(v) for k, v in body.size_prices.items()},
        },
        terminal_id="overseer",
    )
    menu = project_menu(await ledger.get_events())
    return menu.modifiers.get(modifier_id, {})
