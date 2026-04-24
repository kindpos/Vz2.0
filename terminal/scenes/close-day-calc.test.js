// Regression tests for close-day-calc.js pure helpers.
//
// These pin the cash-expected formula so the "subtract cash_tips vs
// card_tips" confusion can never silently regress:
//   WRONG: cash_total - cash_tips  (cash tips stay in the drawer)
//   RIGHT: cash_total - card_tips  (CC tips are paid out from the drawer)

import { describe, it, expect } from 'vitest';
import { computeCashExpected, computeCashVariance } from './close-day-calc.js';

describe('computeCashExpected', () => {
  it('subtracts card_tips from cash_total — not cash_tips', () => {
    const summary = { cash_total: 500, card_tips: 80, cash_tips: 30 };
    // CC tips ($80) are paid out from drawer; cash tips ($30) already in drawer
    expect(computeCashExpected(summary)).toBe(420);
  });

  it('does NOT subtract cash_tips (they remain in the drawer)', () => {
    const summary = { cash_total: 200, card_tips: 0, cash_tips: 50 };
    expect(computeCashExpected(summary)).toBe(200);
  });

  it('handles zero card_tips', () => {
    expect(computeCashExpected({ cash_total: 300, card_tips: 0 })).toBe(300);
  });

  it('handles missing fields gracefully', () => {
    expect(computeCashExpected({})).toBe(0);
    expect(computeCashExpected(null)).toBe(0);
    expect(computeCashExpected(undefined)).toBe(0);
  });

  it('result can be negative when card_tips exceed cash_total', () => {
    // Edge case: busy card night with very little cash
    const summary = { cash_total: 20, card_tips: 50 };
    expect(computeCashExpected(summary)).toBe(-30);
  });
});

describe('computeCashVariance', () => {
  it('returns 0 when cashCounted is null (not yet counted)', () => {
    expect(computeCashVariance(400, null)).toBe(0);
  });

  it('returns 0 when cashCounted is "bypass"', () => {
    expect(computeCashVariance(400, 'bypass')).toBe(0);
  });

  it('returns positive variance when drawer is over', () => {
    expect(computeCashVariance(400, 415)).toBe(15);
  });

  it('returns negative variance when drawer is short', () => {
    expect(computeCashVariance(400, 392.50)).toBe(-7.5);
  });

  it('returns 0 when exact', () => {
    expect(computeCashVariance(400, 400)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    // 1/3 = 0.3333... — toFixed(2) should yield 0.33, not a long decimal
    expect(computeCashVariance(0, 1 / 3)).toBe(0.33);
  });
});
