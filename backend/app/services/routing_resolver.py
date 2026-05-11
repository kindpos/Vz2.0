"""
HARDWARE_ROUTING.md §3 — print-routing rule resolver.

Given the active `printer_routing` rows for one printer (caller has
already filtered by `is_active=1`) plus the optional category id of
the job being routed, pick the winning rule per the §3 priority
tiers. Returns the rule dict or `None` (no rule matches → caller
should print normally on the originally-selected printer).

Priority tiers (highest precedence first):

  1. Manual override (`override_active=1`, not expired) — beats all.
  2. Time + day + category — `time_window_matches AND day_matches
     AND category_id` matches the job's category.
  3. Time + day + catch-all — `time_window_matches AND day_matches
     AND rule_type='all'`.
  4. Category-only — `category_id` matches the job AND the rule has
     **no time window** (`time_from` / `time_to` both empty).
  5. Catch-all — `rule_type='all'` AND no time / no category set.

Within each tier the highest integer `priority` wins; first tier
that produces a winner short-circuits, the remaining tiers are not
evaluated.

This module is intentionally pure: no DB, no logging, no FastAPI
imports — the caller fetches rules and supplies them, which keeps
the resolver trivially unit-testable.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional


def _coerce_int(value, default: int = 0) -> int:
    """`priority`/`override_active` come off SQLite as ints, but defensive
    casts mean a bad row (e.g. NULL written by an older migration) doesn't
    crash the loop."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _rule_priority(rule: dict) -> int:
    return _coerce_int(rule.get("priority"), 0)


def _has_time_constraint(rule: dict) -> bool:
    return bool(rule.get("time_from") or rule.get("time_to"))


def _time_window_matches(rule: dict, now: datetime) -> bool:
    """Return True if `now` falls inside this rule's `time_from .. time_to`
    window. A rule with either bound empty is treated as unrestricted."""
    time_from = rule.get("time_from") or ""
    time_to = rule.get("time_to") or ""
    if not time_from or not time_to:
        return True
    now_hhmm = now.strftime("%H:%M")
    if time_from > time_to:
        # Overnight window (e.g. 22:00 → 02:00): match if we're past
        # `time_from` today OR before `time_to` today.
        return now_hhmm >= time_from or now_hhmm <= time_to
    return time_from <= now_hhmm <= time_to


def _day_matches(rule: dict, now: datetime) -> bool:
    """Spec uses 0=Sunday; Python's `weekday()` uses 0=Monday — convert
    to spec form before comparing. Empty / malformed list ⇒ all days."""
    raw = rule.get("days_of_week") or "[]"
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return True
    if not isinstance(parsed, list) or len(parsed) == 0:
        return True
    spec_day = (now.weekday() + 1) % 7
    return spec_day in parsed


def _override_in_effect(rule: dict, now: datetime) -> bool:
    """Tier-1 gate. `override_active=1` with no `override_expires_at` is
    indefinitely active; a non-empty expires-at past `now` disqualifies
    the override (the expired row is treated as inactive *for this
    evaluation only* — the row itself is not rewritten)."""
    if _coerce_int(rule.get("override_active"), 0) != 1:
        return False
    expires = rule.get("override_expires_at") or ""
    if not expires:
        return True
    # ISO 8601 strings sort lexically, so string comparison is sufficient
    # provided both values share the same shape (which the route guarantees
    # by always writing `datetime.utcnow().isoformat()`).
    return expires > now.isoformat()


def _category_matches(rule: dict, category_id: str) -> bool:
    rule_cat = (rule.get("category_id") or "").strip()
    job_cat = (category_id or "").strip()
    return bool(rule_cat) and bool(job_cat) and rule_cat == job_cat


def _winner(candidates: list[dict]) -> Optional[dict]:
    if not candidates:
        return None
    return max(candidates, key=_rule_priority)


def resolve_routing_rule(
    rules: list[dict],
    category_id: str = "",
    now: Optional[datetime] = None,
) -> Optional[dict]:
    """Run the §3 priority cascade. See module docstring for tier defs.
    Returns the winning rule (caller inspects `redirect_to_mac` /
    `category_id` to act on it) or `None` to mean "no rule applies".
    """
    if now is None:
        now = datetime.utcnow()
    if not rules:
        return None

    # Tier 1 — active manual override.
    tier1 = [r for r in rules if _override_in_effect(r, now)]
    winner = _winner(tier1)
    if winner is not None:
        return winner

    # Tier 2 — time + day + category match.
    tier2 = [
        r for r in rules
        if _category_matches(r, category_id)
        and _time_window_matches(r, now)
        and _day_matches(r, now)
    ]
    winner = _winner(tier2)
    if winner is not None:
        return winner

    # Tier 3 — time + day + catch-all.
    tier3 = [
        r for r in rules
        if (r.get("rule_type") or "") == "all"
        and _time_window_matches(r, now)
        and _day_matches(r, now)
    ]
    winner = _winner(tier3)
    if winner is not None:
        return winner

    # Tier 4 — category match, rule has no time constraint defined.
    tier4 = [
        r for r in rules
        if _category_matches(r, category_id)
        and not _has_time_constraint(r)
    ]
    winner = _winner(tier4)
    if winner is not None:
        return winner

    # Tier 5 — catch-all with no time / no category set.
    tier5 = [
        r for r in rules
        if (r.get("rule_type") or "") == "all"
        and not _has_time_constraint(r)
        and not (r.get("category_id") or "").strip()
    ]
    winner = _winner(tier5)
    if winner is not None:
        return winner

    return None
