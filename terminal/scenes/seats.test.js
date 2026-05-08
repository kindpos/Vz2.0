// Tests for terminal/scenes/seats.js — the single source of truth for every
// seat/check interaction on check-overview. Extracted from the scene's
// render closure so the layout math, selection semantics, and backend-to-
// frontend shape conversion can be pinned independently of DOM.
//
// These tests also serve as the forensics trail for the "adding items
// combines seats" investigation — if seats ever DO combine, these tests
// scope which piece broke.

import { describe, it, expect } from 'vitest';
import {
  seatSubtotal,
  checkSubtotal,
  activeSeatCount,
  layoutModeFor,
  orderToSeats,
  toggleSeatSelection,
  toggleItemSelection,
  selectAllUnpaid,
  collectSelectedItemRefs,
} from './seats.js';

describe('seat subtotals', () => {
  it('seatSubtotal sums qty × price', () => {
    const seat = {
      items: [
        { qty: 2, price: 5 },
        { qty: 1, price: 10 },
      ],
    };
    expect(seatSubtotal(seat)).toBe(20);
  });

  it('seatSubtotal prefers effectivePrice over price (mods + discounts baked in)', () => {
    const seat = {
      items: [
        { qty: 1, price: 10, effectivePrice: 12 },   // mod upcharged
        { qty: 1, price: 10, effectivePrice: 8 },    // item discounted
      ],
    };
    expect(seatSubtotal(seat)).toBe(20);
  });

  it('seatSubtotal is 0 for an empty or missing items list', () => {
    expect(seatSubtotal({})).toBe(0);
    expect(seatSubtotal({ items: [] })).toBe(0);
    expect(seatSubtotal(null)).toBe(0);
    expect(seatSubtotal(undefined)).toBe(0);
  });

  it('checkSubtotal skips paid seats', () => {
    const seats = [
      { id: 's1', items: [{ qty: 1, price: 10 }] },
      { id: 's2', items: [{ qty: 1, price: 20 }] },
      { id: 's3', items: [{ qty: 1, price: 30 }] },
    ];
    expect(checkSubtotal(seats, { s2: true })).toBe(40); // 10 + 30
    expect(checkSubtotal(seats, {})).toBe(60);
    expect(checkSubtotal(seats, null)).toBe(60);
  });
});

describe('layout mode selection', () => {
  it('activeSeatCount ignores paid seats', () => {
    const seats = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(activeSeatCount(seats, { b: true })).toBe(2);
    expect(activeSeatCount(seats, {})).toBe(3);
    expect(activeSeatCount(seats, null)).toBe(3);
    expect(activeSeatCount([], null)).toBe(0);
  });

  it('layoutModeFor: 1-4 → A, 5+ → B', () => {
    expect(layoutModeFor(1)).toBe('A');
    expect(layoutModeFor(4)).toBe('A');
    expect(layoutModeFor(5)).toBe('B');
    expect(layoutModeFor(6)).toBe('B');
    expect(layoutModeFor(100)).toBe('B');
  });
});

describe('orderToSeats — backend → frontend shape', () => {
  it('seeds from order.seat_numbers so empty seats are preserved', () => {
    const seats = orderToSeats({ seat_numbers: [1, 2, 3], items: [] }, 1);
    expect(seats.map((s) => s.number)).toEqual([1, 2, 3]);
    seats.forEach((s) => expect(s.items).toEqual([]));
  });

  it('attaches items to their seat_number; preserves seats with no items', () => {
    const seats = orderToSeats({
      seat_numbers: [1, 2, 3],
      items: [
        { seat_number: 1, name: 'Burger', qty: 1, price: 12 },
        { seat_number: 2, name: 'Fries',  qty: 1, price: 4 },
      ],
    }, 1);
    expect(seats).toHaveLength(3);
    expect(seats[0].items.map((i) => i.name)).toEqual(['Burger']);
    expect(seats[1].items.map((i) => i.name)).toEqual(['Fries']);
    expect(seats[2].items).toEqual([]);
  });

  it('creates a seat on-the-fly for an item whose seat_number is missing from seat_numbers (legacy replay)', () => {
    // This is a CRITICAL path: it's what prevents "items silently land on seat 1"
    // when the backend order somehow has a mismatch between seat_numbers and
    // item seat_numbers. Every non-declared seat gets materialized.
    const seats = orderToSeats({
      seat_numbers: [1],
      items: [
        { seat_number: 1, name: 'A' },
        { seat_number: 2, name: 'B' },  // seat 2 not declared
        { seat_number: 5, name: 'C' },  // huge gap
      ],
    }, 1);
    expect(seats.map((s) => s.number)).toEqual([1, 2, 5]);
    expect(seats[0].items.map((i) => i.name)).toEqual(['A']);
    expect(seats[1].items.map((i) => i.name)).toEqual(['B']);
    expect(seats[2].items.map((i) => i.name)).toEqual(['C']);
  });

  it('pads to minSeats when the backend returns fewer', () => {
    // Fresh check: backend hasn't created an order yet, but the scene needs
    // at least 1 seat to render.
    expect(orderToSeats(null, 1).map((s) => s.number)).toEqual([1]);
    expect(orderToSeats({ seat_numbers: [], items: [] }, 2).map((s) => s.number)).toEqual([1, 2]);
    expect(orderToSeats({ seat_numbers: [1], items: [] }, 3).map((s) => s.number)).toEqual([1, 2, 3]);
  });

  it('returns seats sorted ascending by number even if backend sent them unsorted', () => {
    const seats = orderToSeats({ seat_numbers: [5, 1, 3], items: [] }, 1);
    expect(seats.map((s) => s.number)).toEqual([1, 3, 5]);
  });

  it('uses effective_price when present; falls back to price (0 is treated as absent here, matching legacy behavior)', () => {
    const seats = orderToSeats({
      seat_numbers: [1],
      items: [{ seat_number: 1, name: 'P', price: 10, effective_price: 15 }],
    }, 1);
    expect(seats[0].items[0].price).toBe(10);
    expect(seats[0].items[0].effectivePrice).toBe(15);
  });

  it('items with null / undefined / 0 seat_number default to seat 1', () => {
    const seats = orderToSeats({
      seat_numbers: [1],
      items: [
        { name: 'A' },                       // no seat_number at all
        { seat_number: null, name: 'B' },
        { seat_number: 0, name: 'C' },
      ],
    }, 1);
    expect(seats).toHaveLength(1);
    expect(seats[0].items.map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('selection toggles', () => {
  it('toggleSeatSelection adds an unselected seat', () => {
    const next = toggleSeatSelection({}, {}, 's1');
    expect(next).toEqual({ s1: true });
  });

  it('toggleSeatSelection removes a selected seat', () => {
    const next = toggleSeatSelection({ s1: true }, {}, 's1');
    expect(next).toEqual({});
  });

  it('toggleSeatSelection is a no-op on paid seats (selection is only for pending work)', () => {
    const prev = { s1: true };
    const next = toggleSeatSelection(prev, { s2: true }, 's2');
    expect(next).toEqual({ s1: true });
  });

  it('toggleSeatSelection returns a NEW map (does not mutate the input)', () => {
    const prev = { s1: true };
    const next = toggleSeatSelection(prev, {}, 's2');
    expect(next).not.toBe(prev);
    expect(prev).toEqual({ s1: true });
    expect(next).toEqual({ s1: true, s2: true });
  });

  it('toggleItemSelection toggles a "seatIdx:itemIdx" key', () => {
    const a = toggleItemSelection({}, 0, 3);
    expect(a).toEqual({ '0:3': true });
    const b = toggleItemSelection(a, 0, 3);
    expect(b).toEqual({});
    const c = toggleItemSelection(b, 1, 0);
    expect(c).toEqual({ '1:0': true });
  });

  it('selectAllUnpaid marks every unpaid seat and nothing else', () => {
    const seats = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(selectAllUnpaid(seats, { b: true })).toEqual({ a: true, c: true });
    expect(selectAllUnpaid([], null)).toEqual({});
  });

  it('collectSelectedItemRefs decodes the string keys back into {seatId, itemId}', () => {
    const refs = collectSelectedItemRefs({ '0:3': true, '2:1': true });
    expect(refs).toEqual(expect.arrayContaining([
      { seatId: '0', itemId: '3' },
      { seatId: '2', itemId: '1' },
    ]));
    expect(refs).toHaveLength(2);
  });

  it('collectSelectedItemRefs returns [] for empty / null / undefined', () => {
    expect(collectSelectedItemRefs({})).toEqual([]);
    expect(collectSelectedItemRefs(null)).toEqual([]);
    expect(collectSelectedItemRefs(undefined)).toEqual([]);
  });
});
