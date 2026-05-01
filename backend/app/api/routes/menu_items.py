"""
Menu Items — pricing chain write endpoints.

  PUT /{item_id}/size-pricing/{group_id}               → MENU_ITEM_SIZE_PRICING_SET
  PUT /{item_id}/option-group-override/{group_id}      → MENU_ITEM_OPTION_GROUP_OVERRIDE_SET
  PUT /{item_id}/size-price-override/{group_id}/{size} → MENU_ITEM_SIZE_PRICE_OVERRIDE_SET
"""

from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_ledger
from app.core import events as evt
from app.core.menu_projection import project_menu

router = APIRouter(prefix="/menu-items", tags=["menu-items"])


class _SizePricingBody(BaseModel):
    size_prices: Dict[str, float] = {}


class _OptionGroupOverrideBody(BaseModel):
    option_group_id: Optional[str] = None


class _SizePriceOverrideBody(BaseModel):
    price: float


async def _get_item(item_id: str, ledger):
    menu = project_menu(await ledger.get_events())
    item = next((i for i in menu.items if i.get("item_id") == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Menu item '{item_id}' not found")
    return item


@router.put("/{item_id}/size-pricing/{group_id}", status_code=200)
async def set_item_size_pricing(
    item_id: str,
    group_id: str,
    body: _SizePricingBody,
    ledger=Depends(get_ledger),
):
    """Set size-aware base price adjustments for one item relative to a drives_pricing group."""
    await _get_item(item_id, ledger)
    await ledger.emit(
        evt.EventType.MENU_ITEM_SIZE_PRICING_SET,
        {
            "item_id": item_id,
            "group_id": group_id,
            "size_prices": {k: float(v) for k, v in body.size_prices.items()},
        },
        terminal_id="overseer",
    )
    menu = project_menu(await ledger.get_events())
    return next((i for i in menu.items if i.get("item_id") == item_id), {})


@router.put("/{item_id}/option-group-override/{group_id}", status_code=200)
async def set_item_option_group_override(
    item_id: str,
    group_id: str,
    body: _OptionGroupOverrideBody,
    ledger=Depends(get_ledger),
):
    """Override which OptionGroup applies to a modifier group on a specific item."""
    await _get_item(item_id, ledger)
    await ledger.emit(
        evt.EventType.MENU_ITEM_OPTION_GROUP_OVERRIDE_SET,
        {
            "item_id": item_id,
            "group_id": group_id,
            "option_group_id": body.option_group_id,
        },
        terminal_id="overseer",
    )
    menu = project_menu(await ledger.get_events())
    return next((i for i in menu.items if i.get("item_id") == item_id), {})


@router.put("/{item_id}/size-price-override/{group_id}/{size_name}", status_code=200)
async def set_item_size_price_override(
    item_id: str,
    group_id: str,
    size_name: str,
    body: _SizePriceOverrideBody,
    ledger=Depends(get_ledger),
):
    """Set a per-item override price for a specific size on a modifier group."""
    await _get_item(item_id, ledger)
    await ledger.emit(
        evt.EventType.MENU_ITEM_SIZE_PRICE_OVERRIDE_SET,
        {
            "item_id": item_id,
            "group_id": group_id,
            "size_name": size_name,
            "price": float(body.price),
        },
        terminal_id="overseer",
    )
    menu = project_menu(await ledger.get_events())
    return next((i for i in menu.items if i.get("item_id") == item_id), {})
