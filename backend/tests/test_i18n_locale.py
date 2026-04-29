"""
Localization / i18n consistency tests for KINDpos backend.

KINDpos is USD-only and English-only by design. These tests lock in the
invariants that make the system locale-safe:

  - All event timestamps are UTC-aware (never naive datetimes)
  - money_round() is locale-independent: always returns Decimal(2dp)
    regardless of system locale or input type
  - Reporting helpers use consistent ISO-8601 date parsing and 12-hour
    hour labels; hardcoded day-name mapping covers all 7 weekdays
  - Operating-hours lookup maps Python weekday() → correct day name
  - Date range query boundary is exclusive-end (next calendar day at 00:00)
  - Decimal accumulation never drifts from float arithmetic errors
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio

from app.api.routes.reporting import (
    _DAY_NAMES,
    _get_events_for_date,
    _get_operating_hours,
    _hour_label,
)
from app.config import settings
from app.core.event_ledger import EventLedger
from app.core.events import Event, EventType, create_event, order_created
from app.core.money import money_round


TEST_DB = Path("./data/test_i18n_locale.db")
TERMINAL = "terminal_i18n"


@pytest.fixture(autouse=True)
def _baseline_config(monkeypatch):
    monkeypatch.setattr(settings, "tax_rate", 0.07)
    monkeypatch.setattr(settings, "cash_discount_rate", 0.0)


@pytest_asyncio.fixture
async def ledger():
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


# ═══════════════════════════════════════════════════════════════════════════
# UTC timestamp invariant
# ═══════════════════════════════════════════════════════════════════════════

class TestUtcTimestampInvariant:

    async def test_order_created_timestamp_is_utc_aware(self, ledger):
        """Events carry timezone-aware UTC timestamps, never naive datetimes."""
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="utc_01",
            order_type="dine_in", guest_count=1, server_id="s1",
            correlation_id="utc_01",
        ))
        events = await ledger.get_events_by_correlation("utc_01")
        assert len(events) == 1
        ts = events[0].timestamp
        assert ts.tzinfo is not None, "Timestamp must be timezone-aware"
        assert ts.utcoffset().total_seconds() == 0, "Timestamp must be UTC"

    async def test_all_event_types_produce_utc_timestamps(self, ledger):
        """Several event factories are checked — all must use timezone.utc."""
        from app.core.events import item_added, payment_initiated
        await ledger.append(order_created(
            terminal_id=TERMINAL, order_id="utc_02",
            order_type="dine_in", guest_count=1, server_id="s1",
            correlation_id="utc_02",
        ))
        await ledger.append(item_added(
            terminal_id=TERMINAL, order_id="utc_02",
            item_id="it_utc", menu_item_id="m1",
            name="Item", price=10.00,
        ))
        await ledger.append(payment_initiated(
            terminal_id=TERMINAL, order_id="utc_02",
            payment_id="pay_utc", amount=10.00, method="cash",
        ))
        events = await ledger.get_events_by_correlation("utc_02")
        for evt in events:
            assert evt.timestamp.tzinfo is not None, (
                f"{evt.event_type} has naive timestamp"
            )
            assert evt.timestamp.utcoffset().total_seconds() == 0, (
                f"{evt.event_type} timestamp is not UTC"
            )

    async def test_timestamps_are_monotonically_non_decreasing(self, ledger):
        """Events appended sequentially must have non-decreasing timestamps."""
        for i in range(5):
            await ledger.append(create_event(
                event_type=EventType.ORDER_CREATED,
                terminal_id=TERMINAL,
                correlation_id=f"mono_{i}",
                payload={"order_id": f"mono_{i}", "order_type": "dine_in",
                         "guest_count": 1},
            ))
        mono_events = []
        for i in range(5):
            evts = await ledger.get_events_by_correlation(f"mono_{i}")
            mono_events.extend(evts)
        mono_events.sort(key=lambda e: e.sequence_number or 0)
        for a, b in zip(mono_events, mono_events[1:]):
            assert a.timestamp <= b.timestamp


# ═══════════════════════════════════════════════════════════════════════════
# money_round locale-independence
# ═══════════════════════════════════════════════════════════════════════════

class TestMoneyRoundLocaleIndependence:

    def test_always_returns_decimal(self):
        """money_round() always returns Decimal regardless of input type."""
        assert isinstance(money_round(10.0), Decimal)
        assert isinstance(money_round(10), Decimal)
        assert isinstance(money_round(Decimal("10")), Decimal)

    def test_always_exactly_two_decimal_places(self):
        for val in (0, 1, 1.5, 100.999, Decimal("7.777")):
            result = money_round(val)
            _, exp = result.as_tuple()[1], result.as_tuple()[2]
            assert exp == -2, f"money_round({val}) has wrong scale: {result}"

    def test_float_ieee754_trap_avoided(self):
        """Decimal(str(float)) path avoids IEEE 754 binary representation errors."""
        # 0.1 + 0.2 in float = 0.30000000000000004, but money_round handles it
        result = money_round(0.1 + 0.2)
        assert result == Decimal("0.30")

    def test_accumulating_dollars_stays_exact(self):
        """Summing ten $0.10 Decimal values gives exactly $1.00, not $0.99 or $1.01."""
        total = sum(money_round("0.10") for _ in range(10))
        assert total == Decimal("1.00")

    def test_none_input_returns_zero(self):
        assert money_round(None) == Decimal("0.00")

    def test_large_amount_preserves_precision(self):
        """$99,999.999 rounds correctly without precision loss."""
        result = money_round("99999.999")
        assert result == Decimal("100000.00")

    def test_tax_multiplication_rounds_half_up(self):
        """$14.99 × 7% = $1.0493 → rounds up to $1.05 (not $1.04)."""
        result = money_round(Decimal("14.99") * Decimal("0.07"))
        assert result == Decimal("1.05")

    def test_half_cent_rounds_up(self):
        """$0.005 rounds to $0.01, not $0.00 (ROUND_HALF_UP)."""
        assert money_round("0.005") == Decimal("0.01")

    def test_string_decimal_with_comma_not_supported(self):
        """European-style '1,50' is not valid — raises, not silently wrong."""
        with pytest.raises(Exception):
            money_round("1,50")


# ═══════════════════════════════════════════════════════════════════════════
# Reporting — hour label formatting
# ═══════════════════════════════════════════════════════════════════════════

class TestHourLabel:

    def test_midnight_is_12_00(self):
        assert _hour_label(0) == "12:00"

    def test_1am_is_1_00(self):
        assert _hour_label(1) == "1:00"

    def test_noon_is_12_00(self):
        assert _hour_label(12) == "12:00"

    def test_1pm_is_1_00(self):
        assert _hour_label(13) == "1:00"

    def test_11pm_is_11_00(self):
        assert _hour_label(23) == "11:00"

    def test_all_morning_hours_single_digit_label(self):
        """Hours 1-9 AM produce single-digit labels like '1:00'.."""
        for h in range(1, 10):
            label = _hour_label(h)
            assert ":" in label
            assert label.endswith(":00")

    def test_all_24_hours_produce_colon_format(self):
        """Every hour 0–23 produces a non-empty string containing ':'."""
        for h in range(24):
            label = _hour_label(h)
            assert ":" in label and len(label) >= 4


# ═══════════════════════════════════════════════════════════════════════════
# Reporting — weekday name mapping
# ═══════════════════════════════════════════════════════════════════════════

class TestDayNamesMapping:

    def test_monday_is_index_0(self):
        assert _DAY_NAMES[0] == "monday"

    def test_sunday_is_index_6(self):
        assert _DAY_NAMES[6] == "sunday"

    def test_all_seven_days_present(self):
        expected = {"monday", "tuesday", "wednesday", "thursday",
                    "friday", "saturday", "sunday"}
        assert set(_DAY_NAMES) == expected

    def test_covers_all_python_weekday_values(self):
        """datetime.weekday() returns 0–6; every value maps to a day name."""
        for dow in range(7):
            name = _DAY_NAMES[dow]
            assert name in {"monday", "tuesday", "wednesday", "thursday",
                            "friday", "saturday", "sunday"}

    def test_known_date_maps_to_correct_day(self):
        """2026-04-29 is a Wednesday (weekday()==2 → 'wednesday')."""
        d = datetime(2026, 4, 29)
        assert _DAY_NAMES[d.weekday()] == "wednesday"

    def test_saturday_maps_correctly(self):
        """2026-05-02 is a Saturday (weekday()==5 → 'saturday')."""
        d = datetime(2026, 5, 2)
        assert _DAY_NAMES[d.weekday()] == "saturday"


# ═══════════════════════════════════════════════════════════════════════════
# Reporting — date range parsing
# ═══════════════════════════════════════════════════════════════════════════

class TestDateRangeParsing:

    async def test_historical_date_returns_events_in_range(self, ledger):
        """get_events_for_date with a past date queries the correct window."""
        past_date = "2024-01-15"
        ts = datetime(2024, 1, 15, 14, 30, 0, tzinfo=timezone.utc)
        await ledger.append(Event(
            terminal_id=TERMINAL,
            event_type=EventType.ORDER_CREATED,
            payload={"order_id": "hist_01", "order_type": "dine_in", "guest_count": 1},
            correlation_id="hist_01",
            timestamp=ts,
        ))
        events = await _get_events_for_date(ledger, past_date)
        order_events = [e for e in events if e.correlation_id == "hist_01"]
        assert len(order_events) == 1

    async def test_date_boundary_excludes_next_day(self, ledger):
        """An event timestamped at 00:00:00 the NEXT day falls outside the range."""
        past_date = "2024-02-10"
        in_range_ts  = datetime(2024, 2, 10, 23, 59, 59, tzinfo=timezone.utc)
        out_range_ts = datetime(2024, 2, 11,  0,  0,  0, tzinfo=timezone.utc)
        await ledger.append(Event(
            terminal_id=TERMINAL,
            event_type=EventType.ORDER_CREATED,
            payload={"order_id": "range_in", "order_type": "dine_in", "guest_count": 1},
            correlation_id="range_in",
            timestamp=in_range_ts,
        ))
        await ledger.append(Event(
            terminal_id=TERMINAL,
            event_type=EventType.ORDER_CREATED,
            payload={"order_id": "range_out", "order_type": "dine_in", "guest_count": 1},
            correlation_id="range_out",
            timestamp=out_range_ts,
        ))
        events = await _get_events_for_date(ledger, past_date)
        corr_ids = {e.correlation_id for e in events}
        assert "range_in" in corr_ids
        assert "range_out" not in corr_ids

    def test_iso_date_format_is_yyyy_mm_dd(self):
        """The date query format is strictly YYYY-MM-DD; wrong format raises."""
        from datetime import datetime
        with pytest.raises(ValueError):
            datetime.strptime("29-04-2026", "%Y-%m-%d")   # European format rejected
        with pytest.raises(ValueError):
            datetime.strptime("04/29/2026", "%Y-%m-%d")   # US slash format rejected
        # Correct format parses fine
        d = datetime.strptime("2026-04-29", "%Y-%m-%d")
        assert d.day == 29 and d.month == 4 and d.year == 2026


# ═══════════════════════════════════════════════════════════════════════════
# Operating hours — day-of-week lookup
# ═══════════════════════════════════════════════════════════════════════════

class TestOperatingHoursLookup:

    async def test_missing_config_returns_fallback_hours(self, ledger):
        """When no store config exists, operating hours fall back to 11:00–22:00."""
        monday = datetime(2026, 4, 27, 12, 0, tzinfo=timezone.utc)  # Monday
        open_h, close_h = await _get_operating_hours(ledger, monday)
        assert open_h == 11
        assert close_h == 22

    async def test_fallback_applies_for_every_day_of_week(self, ledger):
        """Fallback 11–22 is returned for all 7 days when config is absent."""
        base = datetime(2026, 4, 27, 12, 0, tzinfo=timezone.utc)  # Monday
        for delta in range(7):
            target = base + timedelta(days=delta)
            open_h, close_h = await _get_operating_hours(ledger, target)
            assert open_h == 11 and close_h == 22
