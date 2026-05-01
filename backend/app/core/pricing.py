"""
Pricing Chain

Computes the total price for one item given a set of modifier selections
and the current menu state.

All arithmetic uses Decimal. ROUND_HALF_UP is applied exactly once, at
the final line_total. Never accumulate floats.
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List


def _d(v: Any) -> Decimal:
    """Convert v to Decimal safely (handles float JSON round-trips)."""
    if isinstance(v, Decimal):
        return v
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def calculate_item_price(
    item: Dict[str, Any],
    selections: List[Dict[str, Any]],
    menu_state: Any,
) -> Decimal:
    """Return the total price for one item line.

    Args:
        item: raw dict from MenuState.items (or items_map).
        selections: list of dicts describing modifier picks, each with:
            - group_id (str)
            - modifier_id (str)
            - is_micromod (bool, optional) — micromods always contribute $0
        menu_state: MenuState instance (must have modifier_groups_by_id,
            modifiers, options, option_groups, sizes populated).

    Returns:
        Decimal rounded ROUND_HALF_UP to 2 decimal places.
    """
    # ── Step 1 — Resolve active sizes ────────────────────────────────────
    # A drives_pricing group acts as the "size selector". There is at most
    # one such group per item (pizza sizes, drink sizes, etc.). Identify the
    # selected modifier from that group; its name is the "active size name"
    # and its modifier_id is the "active size id".
    active_size_name: str | None = None
    active_size_id: str | None = None
    drives_pricing_group_id: str | None = None

    for sel in selections:
        gid = sel.get("group_id")
        mid = sel.get("modifier_id")
        if not gid or not mid:
            continue
        grp = menu_state.modifier_groups_by_id.get(gid)
        if grp and grp.get("drives_pricing"):
            drives_pricing_group_id = gid
            mod = menu_state.modifiers.get(mid)
            if mod:
                active_size_name = mod.get("name")
                active_size_id = mid
            break  # only one drives_pricing group per item

    # ── Step 2 — Item base price ─────────────────────────────────────────
    # Start with item.price. If the item has price_by_size and we have an
    # active size group, overlay with the size-specific adjustment.
    base_price = _d(item.get("price", 0))

    if drives_pricing_group_id and active_size_name:
        # Check item-level price_by_size overrides first (size_price_overrides)
        size_price_overrides = item.get("size_price_overrides", {})
        grp_overrides = size_price_overrides.get(drives_pricing_group_id, {})
        if active_size_name in grp_overrides:
            base_price = _d(grp_overrides[active_size_name])
        else:
            # Fall back to item.price_by_size[group_id][size_name]
            pbz = item.get("price_by_size", {})
            grp_pbz = pbz.get(drives_pricing_group_id, {})
            if active_size_name in grp_pbz:
                base_price = _d(grp_pbz[active_size_name])

    total = base_price

    # ── Step 3 — Per-modifier line prices ────────────────────────────────
    for sel in selections:
        gid = sel.get("group_id")
        mid = sel.get("modifier_id")
        if not gid or not mid:
            continue

        # micromods always $0.00
        if sel.get("is_micromod"):
            continue

        grp = menu_state.modifier_groups_by_id.get(gid)
        if grp and grp.get("drives_pricing"):
            # The drives_pricing group itself does not add a separate charge
            continue

        mod = menu_state.modifiers.get(mid)
        if mod is None:
            continue

        # Resolve modifier base price with size awareness
        mod_price = _d(mod.get("price", 0))

        if drives_pricing_group_id and active_size_name:
            # Check per-item size_price_overrides for this modifier's group
            size_price_overrides = item.get("size_price_overrides", {})
            grp_overrides_mod = size_price_overrides.get(gid, {})
            if active_size_name in grp_overrides_mod:
                mod_price = _d(grp_overrides_mod[active_size_name])
            else:
                # Check modifier's own price_by_size[group_id][size_name]
                pbz = mod.get("price_by_size", {})
                grp_pbz_mod = pbz.get(drives_pricing_group_id, {})
                if active_size_name in grp_pbz_mod:
                    mod_price = _d(grp_pbz_mod[active_size_name])
                else:
                    # Fall back to group-level size_price_adjustments[size_name]
                    spa = grp.get("size_price_adjustments", {}) if grp else {}
                    if active_size_name in spa:
                        mod_price = _d(spa[active_size_name])

        # Resolve option adjustment
        option_adj = Decimal("0")
        # Determine which OptionGroup applies: item override first, then group default
        item_og_overrides = item.get("option_group_overrides", {})
        og_id = item_og_overrides.get(gid) or (grp.get("default_option_group_id") if grp else None)

        if og_id:
            og = menu_state.option_groups.get(og_id)
            if og and og.get("active", True):
                # The selected modifier acts as the "option key" —
                # look for an Option whose option_id matches mid
                for opt_id in og.get("option_ids", []):
                    opt = menu_state.options.get(opt_id)
                    if opt and opt.get("option_id") == mid and opt.get("active", True):
                        if opt.get("negates_price"):
                            mod_price = Decimal("0")
                        else:
                            option_adj = _d(opt.get("price_adjustment", 0))
                        break

        line_total = mod_price + option_adj
        total += line_total

    # ── Step 4 — micromods: $0.00 always (already skipped above) ─────────

    # ── Step 5 — Round and return ─────────────────────────────────────────
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
