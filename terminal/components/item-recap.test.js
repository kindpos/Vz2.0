// Tests for terminal/components/item-recap.js
//
// Covers the two public exports:
//   buildItemRecap(order, opts)     — full recap panel
//   buildItemRecapTotals(totals)    — standalone totals card
//
// Internal helpers verified through the public surface:
//   _fmt / _buildTotals / _buildItemCard / _buildSeatGroup / _buildBadge /
//   _buildHalves / _buildUpchargeStrip

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../common/tokens.js', () => {
  // Wraps a real String so methods like .slice() work, while nested property
  // access (e.g. T.groups.selectionGrid.radius) returns another string proxy.
  function deep(str = '#000000') {
    const s = new String(str);
    return new Proxy(s, {
      get(target, k) {
        if (k in target) return typeof target[k] === 'function'
          ? target[k].bind(target) : target[k];
        if (k === Symbol.toPrimitive || k === 'valueOf') return () => str;
        return deep();
      },
    });
  }
  return { T: deep() };
});

vi.mock('../scene-manager.js', () => ({
  SceneManager: {
    openTransactional:     vi.fn(),
    closeTransactional:    vi.fn(),
    interrupt:             vi.fn(),
    closeInterrupt:        vi.fn(),
    hasInterrupt:          vi.fn(() => false),
    on:                    vi.fn(),
    off:                   vi.fn(),
    emit:                  vi.fn(),
  },
  defineScene: vi.fn((d) => d),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSeat(seatNumber, items = []) {
  return {
    seatNumber,
    subtotal: items.reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0),
    items,
  };
}

function makeItem(overrides = {}) {
  return {
    name:     'Burger',
    price:    10,
    qty:      1,
    sent:     false,
    mods:     [],
    ...overrides,
  };
}

// ── Import ────────────────────────────────────────────────────────────────────

let buildItemRecap;
let buildItemRecapTotals;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./item-recap.js');
  buildItemRecap      = mod.buildItemRecap;
  buildItemRecapTotals = mod.buildItemRecapTotals;
});

// ── buildItemRecap — structure ────────────────────────────────────────────────

describe('buildItemRecap — structure', () => {
  it('returns a DOM element', () => {
    const el = buildItemRecap({});
    expect(el).toBeInstanceOf(Element);
  });

  it('renders one seat group per seat', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1), makeSeat(2)],
    });
    expect(el.querySelectorAll('.ir-seat-group')).toHaveLength(2);
  });

  it('renders item name in each card', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ name: 'Tacos' })])],
    });
    expect(el.textContent).toContain('Tacos');
  });

  it('renders price as qty × price', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ price: 8, qty: 1 })])],
    });
    expect(el.textContent).toContain('$8.00');
  });

  it('multiplies price by qty in the displayed amount', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ price: 5, qty: 3 })])],
    });
    expect(el.textContent).toContain('$15.00');
  });

  it('shows qty label when qty > 1', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ qty: 3 })])],
    });
    expect(el.querySelector('.ir-qty')).not.toBeNull();
    expect(el.querySelector('.ir-qty').textContent).toBe('3×');
  });

  it('omits qty label when qty is 1', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ qty: 1 })])],
    });
    expect(el.querySelector('.ir-qty')).toBeNull();
  });

  it('shows seat number in seat header', () => {
    const el = buildItemRecap({ seats: [makeSeat(3)] });
    expect(el.querySelector('.ir-seat-num').textContent).toBe('S3');
  });

  it('renders ORDER RECAP panel header by default', () => {
    const el = buildItemRecap({ seats: [] });
    expect(el.querySelector('.ir-panel-title').textContent).toBe('ORDER RECAP');
  });

  it('hideHeader suppresses the panel header', () => {
    const el = buildItemRecap({ seats: [] }, { hideHeader: true });
    expect(el.querySelector('.ir-panel-title')).toBeNull();
  });
});

// ── buildItemRecap — item card interactions ───────────────────────────────────

describe('buildItemRecap — item card interactions', () => {
  it('unsent items render a × remove button', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ sent: false })])],
    });
    expect(el.querySelector('.ir-xbtn')).not.toBeNull();
  });

  it('sent items do not render a × remove button', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ sent: true })])],
    });
    expect(el.querySelector('.ir-xbtn')).toBeNull();
  });

  it('sent items show a ✓ prefix in the name', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({ name: 'Pizza', sent: true })])],
    });
    expect(el.querySelector('.ir-iname').textContent).toContain('✓');
  });

  it('× button click calls onRemoveItem(seatIdx, itemIdx)', () => {
    const onRemoveItem = vi.fn();
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem({ sent: false })])] },
      { onRemoveItem },
    );
    el.querySelector('.ir-xbtn').dispatchEvent(new Event('click', { bubbles: true }));
    expect(onRemoveItem).toHaveBeenCalledWith(0, 0);
  });

  it('× button click does not call onRemoveItem when callback is absent', () => {
    const el = buildItemRecap({ seats: [makeSeat(1, [makeItem({ sent: false })])] });
    expect(() => {
      el.querySelector('.ir-xbtn').dispatchEvent(new Event('click', { bubbles: true }));
    }).not.toThrow();
  });

  it('row tap calls onItemTap(seatIdx, itemIdx)', () => {
    const onItemTap = vi.fn();
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem()])] },
      { onItemTap },
    );
    el.querySelector('.ir-item-row').dispatchEvent(new Event('click', { bubbles: true }));
    expect(onItemTap).toHaveBeenCalledWith(0, 0);
  });

  it('row tap toggles the .sel class', () => {
    const onItemTap = vi.fn();
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem()])] },
      { onItemTap },
    );
    const row = el.querySelector('.ir-item-row');
    expect(row.classList.contains('sel')).toBe(false);
    row.dispatchEvent(new Event('click', { bubbles: true }));
    expect(row.classList.contains('sel')).toBe(true);
    row.dispatchEvent(new Event('click', { bubbles: true }));
    expect(row.classList.contains('sel')).toBe(false);
  });

  it('row tap does nothing when onItemTap is absent', () => {
    const el = buildItemRecap({ seats: [makeSeat(1, [makeItem()])] });
    expect(() => {
      el.querySelector('.ir-item-row').dispatchEvent(new Event('click', { bubbles: true }));
    }).not.toThrow();
  });

  it('chevron click opens item-detail transactional', async () => {
    const { SceneManager } = await import('../scene-manager.js');
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem({ name: 'Steak' })])] },
    );
    el.querySelector('.ir-chev').dispatchEvent(new Event('click', { bubbles: true }));
    expect(SceneManager.openTransactional).toHaveBeenCalledWith(
      'item-detail',
      expect.objectContaining({ item: expect.objectContaining({ name: 'Steak' }) }),
    );
  });

  it('itemSelected seeds the row with .sel if it returns true', () => {
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem()])] },
      { itemSelected: () => true },
    );
    expect(el.querySelector('.ir-item-row').classList.contains('sel')).toBe(true);
  });
});

// ── buildItemRecap — seat header interactions ─────────────────────────────────

describe('buildItemRecap — seat header', () => {
  it('non-collapsible header tap bulk-selects all item rows', () => {
    const onSeatHeaderTap = vi.fn();
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem(), makeItem({ name: 'Fries' })])] },
      { onSeatHeaderTap },
    );
    el.querySelector('.ir-seat-header').dispatchEvent(new Event('click', { bubbles: true }));
    expect(onSeatHeaderTap).toHaveBeenCalledWith(0, true);
    const rows = el.querySelectorAll('.ir-item-row');
    rows.forEach((r) => expect(r.classList.contains('sel')).toBe(true));
  });

  it('second non-collapsible header tap deselects all', () => {
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem()])] },
      { onSeatHeaderTap: vi.fn() },
    );
    const hdr = el.querySelector('.ir-seat-header');
    hdr.dispatchEvent(new Event('click', { bubbles: true })); // select all
    hdr.dispatchEvent(new Event('click', { bubbles: true })); // deselect all
    expect(el.querySelector('.ir-item-row').classList.contains('sel')).toBe(false);
  });

  it('collapsible header tap toggles .collapsed on the group', () => {
    const el = buildItemRecap(
      { seats: [makeSeat(1, [makeItem()])] },
      { collapsible: true },
    );
    const group = el.querySelector('.ir-seat-group');
    expect(group.classList.contains('collapsed')).toBe(false);
    el.querySelector('.ir-seat-header').dispatchEvent(new Event('click', { bubbles: true }));
    expect(group.classList.contains('collapsed')).toBe(true);
  });
});

// ── buildItemRecap — mods and halves ─────────────────────────────────────────

describe('buildItemRecap — mods and halves', () => {
  it('renders mod names', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({
        mods: [{ name: 'Extra Cheese', price: 1.5, charged: true, microMods: [] }],
      })])],
    });
    expect(el.textContent).toContain('Extra Cheese');
  });

  it('renders halves grid with 1ST HALF / 2ND HALF headers', () => {
    const el = buildItemRecap({
      seats: [makeSeat(1, [makeItem({
        halves: {
          first:  [{ name: 'Pepperoni', prefix: 'ADD' }],
          second: [{ name: 'Mushroom',  prefix: null }],
        },
      })])],
    });
    expect(el.textContent).toContain('1ST HALF');
    expect(el.textContent).toContain('2ND HALF');
    expect(el.textContent).toContain('Pepperoni');
    expect(el.textContent).toContain('Mushroom');
  });
});

// ── buildItemRecap — totals block ─────────────────────────────────────────────

describe('buildItemRecap — totals block', () => {
  it('totals block is appended when order.totals is set', () => {
    const el = buildItemRecap({
      seats: [],
      totals: { subtotal: 20, tax: 1.4, total: 21.4, paid: 0 },
    });
    expect(el.querySelector('.ir-totals')).not.toBeNull();
  });

  it('totals block is absent when hideTotals is set', () => {
    const el = buildItemRecap(
      { seats: [], totals: { subtotal: 10 } },
      { hideTotals: true },
    );
    expect(el.querySelector('.ir-totals')).toBeNull();
  });
});

// ── buildItemRecapTotals ──────────────────────────────────────────────────────

describe('buildItemRecapTotals', () => {
  it('returns a .ir-totals element', () => {
    const el = buildItemRecapTotals({});
    expect(el.className).toBe('ir-totals');
  });

  it('renders SUBTOTAL with formatted value', () => {
    const el = buildItemRecapTotals({ subtotal: 18.5 });
    expect(el.textContent).toContain('SUBTOTAL');
    expect(el.textContent).toContain('$18.50');
  });

  it('renders TAX with rate percentage when taxRate is provided', () => {
    const el = buildItemRecapTotals({ tax: 1.3, taxRate: 0.07 });
    expect(el.textContent).toContain('TAX (7%)');
    expect(el.textContent).toContain('$1.30');
  });

  it('renders plain TAX label when taxRate is absent', () => {
    const el = buildItemRecapTotals({ tax: 2 });
    const labels = Array.from(el.querySelectorAll('.ir-tl')).map((e) => e.textContent);
    expect(labels).toContain('TAX');
  });

  it('renders TOTAL row', () => {
    const el = buildItemRecapTotals({ total: 21.5 });
    expect(el.textContent).toContain('TOTAL');
    expect(el.textContent).toContain('$21.50');
  });

  it('renders CASH row when cash is provided', () => {
    const el = buildItemRecapTotals({ total: 20, cash: 19.2 });
    expect(el.textContent).toContain('CASH');
    expect(el.textContent).toContain('$19.20');
  });

  it('omits CASH row when cash is null', () => {
    const el = buildItemRecapTotals({ total: 20, cash: null });
    const labels = Array.from(el.querySelectorAll('.ir-tl-strong')).map((e) => e.textContent);
    expect(labels.some((l) => l === 'CASH')).toBe(false);
  });

  it('formats zero values as $0.00', () => {
    const el = buildItemRecapTotals({ subtotal: 0, tax: 0, total: 0 });
    // Three zero amounts should appear
    const prices = Array.from(el.querySelectorAll('.ir-tv')).map((e) => e.textContent);
    expect(prices.filter((p) => p.includes('$0.00')).length).toBeGreaterThanOrEqual(3);
  });

  it('style injection is idempotent (calling twice leaves one style tag)', () => {
    buildItemRecapTotals({});
    buildItemRecapTotals({});
    const styleTags = document.querySelectorAll('#item-recap-styles');
    expect(styleTags).toHaveLength(1);
  });
});
