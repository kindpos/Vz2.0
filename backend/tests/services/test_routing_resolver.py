"""
Unit tests for `app.services.routing_resolver.resolve_routing_rule` —
the HARDWARE_ROUTING.md §3 priority cascade.

The resolver is pure: no DB, no logging. Tests construct rule dicts
in-line via the `_rule` helper, control `now` explicitly so the
time/day cases are deterministic across timezones, and assert which
specific dict instance is returned (identity check beats equality so
priority tie-breaks are easy to see).
"""

from __future__ import annotations

from datetime import datetime

from app.services.routing_resolver import resolve_routing_rule


# ─── helpers ────────────────────────────────────────────────────────────


def _rule(
    *,
    rule_type: str = "all",
    category_id: str = "",
    priority: int = 0,
    time_from: str = "",
    time_to: str = "",
    days_of_week: str = "[]",
    redirect_to_mac: str = "",
    override_active: int = 0,
    override_expires_at: str = "",
) -> dict:
    """Minimum-fill rule dict matching the printer_routing schema after
    the §2.4 migration."""
    return {
        "rule_type": rule_type,
        "category_id": category_id,
        "priority": priority,
        "time_from": time_from,
        "time_to": time_to,
        "days_of_week": days_of_week,
        "redirect_to_mac": redirect_to_mac,
        "override_active": override_active,
        "override_expires_at": override_expires_at,
    }


# Reference timestamp: 2026-05-11 is a Monday. Python weekday() = 0;
# spec day = 1.
MONDAY_NOON = datetime(2026, 5, 11, 12, 0)
SUNDAY_NOON = datetime(2026, 5, 10, 12, 0)


# ─── tier 1: manual override ────────────────────────────────────────────


def test_override_beats_time_plus_category_rule():
    """Tier 1 wins regardless of how strong the tier-2 candidate is."""
    override = _rule(override_active=1, redirect_to_mac="MAC-OVR", priority=0)
    tier2 = _rule(
        rule_type="category",
        category_id="apps",
        time_from="11:00",
        time_to="14:00",
        days_of_week="[1]",  # Monday
        priority=99,
    )
    result = resolve_routing_rule(
        [tier2, override], category_id="apps", now=MONDAY_NOON
    )
    assert result is override


def test_expired_override_falls_through_to_next_tier():
    """An override with `override_expires_at` in the past is treated as
    inactive — the catch-all behind it wins."""
    expired = _rule(
        override_active=1,
        override_expires_at="2026-05-10T00:00:00",  # yesterday
        redirect_to_mac="MAC-OVR",
    )
    catch_all = _rule(rule_type="all", priority=1)
    result = resolve_routing_rule([expired, catch_all], now=MONDAY_NOON)
    assert result is catch_all


# ─── time-window evaluation ─────────────────────────────────────────────


def test_overnight_time_window_matches_correctly():
    """22:00 → 02:00 window: 23:00 and 01:00 match; 03:00 doesn't."""
    bar = _rule(
        rule_type="all",
        time_from="22:00",
        time_to="02:00",
        days_of_week="[]",
        priority=5,
    )

    assert resolve_routing_rule([bar], now=datetime(2026, 5, 11, 23, 0)) is bar
    assert resolve_routing_rule([bar], now=datetime(2026, 5, 12, 1, 0)) is bar
    assert resolve_routing_rule([bar], now=datetime(2026, 5, 12, 3, 0)) is None


# ─── day-of-week filter ─────────────────────────────────────────────────


def test_day_of_week_filter_excludes_non_matching_day():
    """Spec uses Sun=0..Sat=6; Python's weekday() uses Mon=0..Sun=6 —
    resolver converts via `(weekday + 1) % 7`. A rule listing only
    spec-day 1 (Monday) should match on Monday and miss on Sunday."""
    monday_only = _rule(
        rule_type="category",
        category_id="apps",
        time_from="00:00",
        time_to="23:59",
        days_of_week="[1]",
        priority=10,
    )

    assert resolve_routing_rule(
        [monday_only], category_id="apps", now=MONDAY_NOON
    ) is monday_only
    assert resolve_routing_rule(
        [monday_only], category_id="apps", now=SUNDAY_NOON
    ) is None


# ─── tier ordering / priority ───────────────────────────────────────────


def test_category_match_wins_over_catch_all_across_tiers():
    """Tier 4 (category-only, no time) beats tier 5 (catch-all, no time)
    even when the catch-all has the higher integer priority — the cascade
    is tier-first, priority-within-tier."""
    catch_all = _rule(rule_type="all", priority=99)
    cat_match = _rule(rule_type="category", category_id="apps", priority=0)
    result = resolve_routing_rule(
        [catch_all, cat_match], category_id="apps", now=MONDAY_NOON
    )
    assert result is cat_match


def test_higher_priority_wins_within_same_tier():
    low = _rule(rule_type="all", priority=1)
    high = _rule(rule_type="all", priority=99)
    result = resolve_routing_rule([low, high], now=MONDAY_NOON)
    assert result is high


# ─── empty / no-match ───────────────────────────────────────────────────


def test_empty_rules_returns_none():
    assert resolve_routing_rule([], now=MONDAY_NOON) is None


def test_no_matching_rule_returns_none():
    """A category-scoped rule for `apps` cannot serve a `drinks` job and
    has no catch-all behind it — caller should print normally."""
    apps_only = _rule(rule_type="category", category_id="apps", priority=5)
    result = resolve_routing_rule(
        [apps_only], category_id="drinks", now=MONDAY_NOON
    )
    assert result is None
