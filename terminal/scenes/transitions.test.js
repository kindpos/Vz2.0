// Tests for terminal/scenes/transitions.js — pins the exact param shape that
// flows between check-overview and order-entry. A typo on either side of the
// handoff (swapped keys, dropped null fallback, missing seatNumber thread-
// through) silently breaks it; without running the full scenes, these tests
// are how we catch regressions in the contract.

import { describe, it, expect } from 'vitest';
import {
  buildOrderEntryParams,
  buildCheckOverviewParams,
} from './transitions.js';

describe('check-overview → order-entry param builder', () => {
  it('threads orderId, checkNumber, employee context, and returnTo', () => {
    const state = {
      orderId: 'ord-123',
      checkNumber: 'C-456',
      seats: [{ id: 's1', number: 1 }, { id: 's2', number: 2 }],
      selected: {},
    };
    const params = {
      employeeId: 'e42',
      employeeName: 'Mel',
      pin: 'pin-hash',
      returnLanding: 'server-landing',
    };

    const p = buildOrderEntryParams(state, params);

    expect(p.recallOrderId).toBe('ord-123');
    expect(p.recallCheckNumber).toBe('C-456');
    expect(p.returnTo).toBe('check-overview');
    expect(p.employeeId).toBe('e42');
    expect(p.employeeName).toBe('Mel');
    expect(p.pin).toBe('pin-hash');
    expect(p.returnParams.returnLanding).toBe('server-landing');
    expect(p.returnParams.checkId).toBe('ord-123');
  });

  it('brand-new check (orderId null) → recallOrderId is null, not undefined', () => {
    const p = buildOrderEntryParams({ orderId: null, seats: [] }, {});
    // order-entry tests `!params.recallOrderId` — so the fallback MUST be
    // null (or any falsy) and never undefined on the wire. The downstream
    // handleSend's `if (!currentOrderId)` branch depends on this.
    expect(p.recallOrderId).toBeNull();
    expect(p.recallCheckNumber).toBeNull();
  });

  it('passes seat numbers in order so order-entry can restore the seat layout', () => {
    const p = buildOrderEntryParams({
      seats: [{ id: 'a', number: 1 }, { id: 'b', number: 2 }, { id: 'c', number: 3 }],
      selected: {},
    }, {});
    expect(p.seatNumbers).toEqual([1, 2, 3]);
  });

  it('selectedSeatNumbers contains only seats flagged in state.selected', () => {
    const p = buildOrderEntryParams({
      seats: [
        { id: 'a', number: 1 },
        { id: 'b', number: 2 },
        { id: 'c', number: 3 },
      ],
      selected: { a: true, c: true },
    }, {});
    expect(p.selectedSeatNumbers).toEqual([1, 3]);
  });

  it('handles empty / undefined state without throwing', () => {
    expect(() => buildOrderEntryParams(undefined, undefined)).not.toThrow();
    const p = buildOrderEntryParams({}, {});
    expect(p.seatNumbers).toEqual([]);
    expect(p.selectedSeatNumbers).toEqual([]);
    expect(p.recallOrderId).toBeNull();
  });
});

describe('order-entry → check-overview param builder', () => {
  it('prefers currentOrderId (order POSTed during the session)', () => {
    const p = buildCheckOverviewParams('fresh-ord', {
      recallOrderId: 'stale-ord',
      pin: 'p',
      employeeId: 'e',
      employeeName: 'Name',
      returnLanding: 'server-landing',
    });

    expect(p.checkId).toBe('fresh-ord');
    expect(p.pin).toBe('p');
    expect(p.returnLanding).toBe('server-landing');
  });

  it('falls back to sceneParams.recallOrderId if no order was POSTed (user left immediately)', () => {
    const p = buildCheckOverviewParams(null, { recallOrderId: 'orig-ord' });
    expect(p.checkId).toBe('orig-ord');
  });

  it('checkId is null (never undefined) when neither id is available — brand-new empty check', () => {
    const p = buildCheckOverviewParams(null, {});
    // check-overview does `if (!state.orderId)` on refresh; null takes
    // that branch cleanly, undefined also does but it's sloppy.
    expect(p.checkId).toBeNull();
  });

  it('threads employee + PIN so check-overview does NOT re-prompt for manager PIN', () => {
    const p = buildCheckOverviewParams('o', {
      pin: 'manager-pin-hash',
      employeeId: 'e42',
      employeeName: 'Mel',
    });
    expect(p.pin).toBe('manager-pin-hash');
    expect(p.employeeId).toBe('e42');
    expect(p.employeeName).toBe('Mel');
  });
});
