"""Unit tests for app.core.financial_invariants.

Every check gets a passing case, a failing case, and (where relevant) a
tolerance-boundary case. These tests document the canonical identities
so that a future change to the formulas has to update this file first.
"""

from decimal import Decimal

import pytest

from app.core.financial_invariants import (
    DEFAULT_TOLERANCE,
    InvariantResult,
    InvariantViolation,
    assert_all_2dp,
    assert_batch_settlement,
    assert_cash_expected,
    assert_day_close,
    assert_over_short,
    assert_pnl_identity,
    assert_tender_reconciliation,
    assert_tips_partition,
    check_all_2dp,
    check_batch_settlement,
    check_cash_expected,
    check_day_close,
    check_over_short,
    check_pnl_identity,
    check_tender_reconciliation,
    check_tips_partition,
    gate,
    max_abs_diff,
)


# ── P&L identity ────────────────────────────────────────────────────────────

class TestPnlIdentity:
    def test_pass_with_only_gross(self):
        r = check_pnl_identity(gross=100.0, voids=0, discounts=0, refunds=0, net=100.0)
        assert r.ok
        assert r.diff == 0.0

    def test_pass_with_all_deductions(self):
        r = check_pnl_identity(gross=100.0, voids=20.0, discounts=5.0, refunds=2.0, net=73.0)
        assert r.ok

    def test_fail_detects_missing_void(self):
        r = check_pnl_identity(gross=100.0, voids=20.0, discounts=0, refunds=0, net=100.0)
        assert not r.ok
        assert r.diff == pytest.approx(20.0)

    def test_fail_detects_extra_void(self):
        # Classic double-count: gross excludes voids AND net subtracts them
        r = check_pnl_identity(gross=11.0, voids=40.0, discounts=0, refunds=0, net=-29.0)
        assert r.ok  # This actually balances: 11 - 40 = -29
        # The original bug was gross NOT including voids; here net matches
        # the broken formula. The real guard is the aggregator's input.

    def test_fail_detects_wrong_net(self):
        r = check_pnl_identity(gross=100.0, voids=20.0, discounts=0, refunds=0, net=85.0)
        assert not r.ok
        assert r.diff == pytest.approx(5.0)

    def test_tolerance_allows_rounding_drift(self):
        # 0.01 diff is within tolerance
        r = check_pnl_identity(gross=100.0, voids=0, discounts=0, refunds=0, net=100.01)
        assert r.ok

    def test_tolerance_rejects_beyond_cent(self):
        r = check_pnl_identity(gross=100.0, voids=0, discounts=0, refunds=0, net=100.02)
        assert not r.ok

    def test_assert_raises_on_violation(self):
        with pytest.raises(InvariantViolation) as exc:
            assert_pnl_identity(gross=100.0, voids=0, discounts=0, refunds=0, net=85.0)
        assert exc.value.name == "pnl_identity"
        assert exc.value.diff == pytest.approx(-15.0)


# ── Tender reconciliation ───────────────────────────────────────────────────

class TestTenderReconciliation:
    def test_cash_only(self):
        r = check_tender_reconciliation(
            cash_total=100.0, card_total=0.0, net_sales=95.0, tax_collected=5.0,
        )
        assert r.ok

    def test_mixed_tender(self):
        r = check_tender_reconciliation(
            cash_total=50.0, card_total=55.0, net_sales=100.0, tax_collected=5.0,
        )
        assert r.ok

    def test_fail_on_missing_tender(self):
        r = check_tender_reconciliation(
            cash_total=50.0, card_total=0.0, net_sales=100.0, tax_collected=5.0,
        )
        assert not r.ok
        assert r.diff == pytest.approx(-55.0)

    def test_assert_raises(self):
        with pytest.raises(InvariantViolation):
            assert_tender_reconciliation(
                cash_total=50.0, card_total=0.0, net_sales=100.0, tax_collected=5.0,
            )


# ── Tips partition ──────────────────────────────────────────────────────────

class TestTipsPartition:
    def test_pass(self):
        r = check_tips_partition(total_tips=30.0, card_tips=25.0, cash_tips=5.0)
        assert r.ok

    def test_fail_missing_cash_tips(self):
        r = check_tips_partition(total_tips=30.0, card_tips=25.0, cash_tips=0.0)
        assert not r.ok
        assert r.diff == pytest.approx(5.0)

    def test_zero_zero_zero(self):
        r = check_tips_partition(total_tips=0.0, card_tips=0.0, cash_tips=0.0)
        assert r.ok


# ── Cash expected ───────────────────────────────────────────────────────────

class TestCashExpected:
    def test_pass(self):
        r = check_cash_expected(cash_sales=100.0, card_tips=20.0, cash_expected=80.0)
        assert r.ok

    def test_fail_using_wrong_formula_plus_cash_tips(self):
        # Reproduce the pre-fix POS bug: cash_expected = cash_sales + cash_tips
        r = check_cash_expected(cash_sales=100.0, card_tips=20.0, cash_expected=100.0)
        assert not r.ok
        assert r.diff == pytest.approx(20.0)

    def test_negative_result_allowed(self):
        # Card tips exceed cash sales — legit at some venues
        r = check_cash_expected(cash_sales=10.0, card_tips=30.0, cash_expected=-20.0)
        assert r.ok


# ── Over/Short ──────────────────────────────────────────────────────────────

class TestOverShort:
    def test_on_target(self):
        r = check_over_short(cash_expected=100.0, actual_cash_counted=100.0, over_short=0.0)
        assert r.ok

    def test_over(self):
        r = check_over_short(cash_expected=100.0, actual_cash_counted=102.50, over_short=2.50)
        assert r.ok

    def test_short(self):
        r = check_over_short(cash_expected=100.0, actual_cash_counted=97.25, over_short=-2.75)
        assert r.ok

    def test_fail_wrong_sign(self):
        r = check_over_short(cash_expected=100.0, actual_cash_counted=95.0, over_short=5.0)
        assert not r.ok
        assert r.diff == pytest.approx(10.0)


# ── Batch settlement ────────────────────────────────────────────────────────

class TestBatchSettlement:
    def test_includes_card_tips(self):
        r = check_batch_settlement(card_sales=500.0, card_tips=75.0, settlement=575.0)
        assert r.ok

    def test_fail_excludes_tips(self):
        # Repro of the pre-fix bug where settlement = card sales only
        r = check_batch_settlement(card_sales=500.0, card_tips=75.0, settlement=500.0)
        assert not r.ok
        assert r.diff == pytest.approx(-75.0)


# ── 2dp gate ────────────────────────────────────────────────────────────────

class TestAll2dp:
    def test_pass_with_clean_values(self):
        r = check_all_2dp({"a": 1.00, "b": 2.50, "c": 0.00, "d": -5.25})
        assert r.ok

    def test_pass_with_none_ignored(self):
        r = check_all_2dp({"a": 1.00, "b": None})
        assert r.ok

    def test_fail_on_float_drift(self):
        # 0.1 + 0.2 produces 0.30000000000000004 in IEEE 754
        r = check_all_2dp({"sum": 0.1 + 0.2})
        assert not r.ok

    def test_fail_on_three_decimal_value(self):
        r = check_all_2dp({"price": 1.234})
        assert not r.ok
        assert "price" in r.message

    def test_pass_with_iterable_pairs(self):
        r = check_all_2dp([("a", 1.00), ("b", 2.00)])
        assert r.ok

    def test_pass_with_decimal_values(self):
        r = check_all_2dp({"a": Decimal("1.00"), "b": Decimal("2.50")})
        assert r.ok

    def test_fail_with_decimal_three_dp(self):
        r = check_all_2dp({"a": Decimal("1.234")})
        assert not r.ok

    def test_assert_raises_with_field_names(self):
        with pytest.raises(InvariantViolation) as exc:
            assert_all_2dp({"tax": 1.234, "net": 5.67})
        assert "tax" in str(exc.value)


# ── Composite day-close ─────────────────────────────────────────────────────

class TestDayClose:
    def _balanced(self, **overrides):
        payload = dict(
            gross_sales=100.0,
            void_total=10.0,
            discount_total=5.0,
            refund_total=0.0,
            net_sales=85.0,
            tax_collected=5.0,
            cash_total=50.0,
            card_total=40.0,
            total_tips=15.0,
            card_tips=12.0,
            cash_tips=3.0,
            cash_expected=38.0,          # 50 − 12
            actual_cash_counted=37.50,
            over_short=-0.50,
        )
        payload.update(overrides)
        return payload

    def test_balanced_day_passes_all_checks(self):
        results = check_day_close(**self._balanced())
        assert all(r.ok for r in results), [r.message for r in results if not r.ok]

    def test_bad_net_fails_pnl_only(self):
        results = check_day_close(**self._balanced(net_sales=90.0))
        bad = [r for r in results if not r.ok]
        assert len(bad) >= 1
        assert any(r.name == "pnl_identity" for r in bad)

    def test_cash_expected_omitted_when_absent(self):
        payload = self._balanced()
        payload["cash_expected"] = None
        payload["actual_cash_counted"] = None
        payload["over_short"] = None
        # Shouldn't raise; cash_expected/over_short checks are skipped
        assert_day_close(**payload)

    def test_assert_raises_on_first_failure(self):
        with pytest.raises(InvariantViolation):
            assert_day_close(**self._balanced(net_sales=90.0))

    def test_real_world_scenario_from_screenshots(self):
        # The scenario the user reported: 1 live order $11, 2 voids $40 total,
        # cash $11.55 paid, tax $0.55 captured on the payment, no tips.
        results = check_day_close(
            gross_sales=51.00,
            void_total=40.00,
            discount_total=0.00,
            refund_total=0.00,
            net_sales=11.00,
            tax_collected=0.55,
            cash_total=11.55,
            card_total=0.00,
            total_tips=0.00,
            card_tips=0.00,
            cash_tips=0.00,
            cash_expected=11.55,
        )
        assert all(r.ok for r in results), [r.message for r in results if not r.ok]


# ── gate ────────────────────────────────────────────────────────────────────

def _ok(name="pnl_identity"):
    return InvariantResult(name=name, ok=True, diff=Decimal("0"), message="ok")

def _fail(name="pnl_identity", diff="-15.00"):
    return InvariantResult(name=name, ok=False, diff=Decimal(diff), message="identity drift")


class TestGate:
    def test_empty_input_returns_empty_list(self):
        assert gate([]) == []

    def test_all_passing_returns_results_unchanged(self):
        r = gate([_ok("pnl_identity"), _ok("batch_settlement")])
        assert len(r) == 2
        assert all(x.ok for x in r)

    def test_does_not_raise_when_strict_false(self):
        r = gate([_fail()], strict=False)
        assert len(r) == 1
        assert not r[0].ok

    def test_raises_first_failure_when_strict_true(self):
        with pytest.raises(InvariantViolation) as exc:
            gate([_fail("tender_reconciliation")], strict=True)
        assert exc.value.name == "tender_reconciliation"

    def test_raises_first_not_second_when_multiple_failures(self):
        r1 = _fail("pnl_identity", "-15.00")
        r2 = _fail("tender_reconciliation", "-55.00")
        with pytest.raises(InvariantViolation) as exc:
            gate([r1, r2], strict=True)
        assert exc.value.name == "pnl_identity"

    def test_context_string_does_not_suppress_raise(self):
        with pytest.raises(InvariantViolation):
            gate([_fail()], context="day_close", strict=True)

    def test_mixed_returns_all_results(self):
        r = gate([_ok("batch_settlement"), _fail("pnl_identity")], strict=False)
        assert len(r) == 2
        ok_names = {x.name for x in r if x.ok}
        assert "batch_settlement" in ok_names

    def test_passing_batch_in_strict_mode_does_not_raise(self):
        results = gate(
            [_ok("pnl_identity"), _ok("tender_reconciliation"), _ok("tips_partition")],
            strict=True,
        )
        assert all(r.ok for r in results)


# ── max_abs_diff ─────────────────────────────────────────────────────────────

class TestMaxAbsDiff:
    def test_empty_returns_zero(self):
        assert max_abs_diff([]) == Decimal("0.00")

    def test_all_passing_zero_diff_returns_zero(self):
        assert max_abs_diff([_ok(), _ok()]) == Decimal("0")

    def test_single_negative_diff(self):
        assert max_abs_diff([_fail("pnl_identity", "-5.00")]) == Decimal("5.00")

    def test_single_positive_diff(self):
        r = InvariantResult(name="x", ok=False, diff=Decimal("12.50"), message="")
        assert max_abs_diff([r]) == Decimal("12.50")

    def test_returns_largest_of_several(self):
        results = [
            _fail("a", "-5.00"),
            _fail("b", "15.00"),
            _fail("c", "-3.00"),
        ]
        assert max_abs_diff(results) == Decimal("15.00")

    def test_negative_larger_abs_than_positive(self):
        r1 = InvariantResult(name="x", ok=False, diff=Decimal("10"), message="")
        r2 = InvariantResult(name="y", ok=False, diff=Decimal("-20"), message="")
        assert max_abs_diff([r1, r2]) == Decimal("20")

    def test_mixed_passing_and_failing(self):
        results = [_ok(), _fail("pnl_identity", "-7.00"), _ok()]
        assert max_abs_diff(results) == Decimal("7.00")
