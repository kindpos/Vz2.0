// Tests for terminal/discount.js — pins the amount math + wire body shape
// for POST /api/v1/orders/{id}/discount. The backend already has 5 pytests
// (test_discount_endpoint.py) covering the server side; these sit on the
// JS side of the same contract so a regression can't slip in unnoticed.

import { describe, it, expect } from 'vitest';
import {
  computeDiscountAmount,
  extractItemIds,
  buildDiscountBody,
} from './discount.js';

describe('terminal/discount', () => {
  describe('computeDiscountAmount', () => {
    it('10% of a single $20 item → $2.00 (always 2dp)', () => {
      expect(computeDiscountAmount([{ price: 20, qty: 1 }], 10)).toBe(2);
    });

    it('sums modifier prices into each line before applying pct', () => {
      // (10 + 2 + 1) * 1 = 13; 15% of 13 = 1.95
      const amt = computeDiscountAmount(
        [{ price: 10, qty: 1, mods: [{ price: 2 }, { price: 1 }] }],
        15,
      );
      expect(amt).toBe(1.95);
    });

    it('respects qty on each line', () => {
      // 20 * 3 = 60; 10% = 6.00
      expect(computeDiscountAmount([{ price: 20, qty: 3 }], 10)).toBe(6);
    });

    it('rounds to exactly 2 decimal places (matches backend _validate_2dp)', () => {
      // 19.99 * 1 = 19.99; 13% = 2.5987 → rounded to 2.60
      expect(computeDiscountAmount([{ price: 19.99, qty: 1 }], 13)).toBe(2.6);

      // 33.33 * 1 = 33.33; 10% = 3.333 → 3.33
      expect(computeDiscountAmount([{ price: 33.33, qty: 1 }], 10)).toBe(3.33);

      // The function never returns a 3dp number.
      const amt = computeDiscountAmount([{ price: 19.99, qty: 1 }], 13);
      expect(String(amt).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    });

    it('empty items → 0 (not NaN, not undefined)', () => {
      expect(computeDiscountAmount([], 10)).toBe(0);
    });

    it('lines missing price or qty default to safe zeros', () => {
      expect(computeDiscountAmount([{}, { qty: 2 }, { price: 10 }], 10)).toBe(1);
    });
  });

  describe('extractItemIds', () => {
    it('returns only ids for lines that have been persisted (have item_id)', () => {
      const ids = extractItemIds([
        { item_id: 'a' },
        { item_id: 'b' },
        { /* unpersisted line, no item_id */ },
        { item_id: '' },   // falsy, should be skipped
        { item_id: 'c' },
      ]);
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('returns [] when nothing is persisted yet', () => {
      expect(extractItemIds([{}, {}])).toEqual([]);
    });
  });

  describe('buildDiscountBody', () => {
    it('produces the exact wire shape the backend expects', () => {
      expect(buildDiscountBody(10, 2.0, ['a', 'b'], 'mgr-pin-hash')).toEqual({
        discount_type: '10%',
        amount:        2.0,
        reason:        'Manager 10% discount',
        approved_by:   'mgr-pin-hash',
        item_ids:      ['a', 'b'],
      });
    });

    it('approved_by falls back to null when omitted', () => {
      const body = buildDiscountBody(15, 5, ['x'], undefined);
      expect(body.approved_by).toBeNull();
    });

    it('item_ids is null (not []) when no lines are persisted — backend has 400ed on empty arrays', () => {
      const body = buildDiscountBody(20, 4, [], 'mgr');
      expect(body.item_ids).toBeNull();
    });
  });
});
