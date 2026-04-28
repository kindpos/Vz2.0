// Tests for terminal/order-summary.js — OrderSummary public API.
//
// order-summary.js uses module-level DOM refs (_el, _card, _paidRow, etc.).
// vi.resetModules() + dynamic import in beforeEach gives each test a clean slate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../common/tokens.js', () => ({
  T: {
    green: '#86efac', greenWarm: '#86efac', greenDk: '#4ade80',
    verm: '#e8472a', elec: '#00e5ff', gold: '#f59e0b',
    text: '#ddd', well: '#22252a', bg: '#1a1d21', card: '#2d3139',
    border: '#4a4f57',
    fb: 'sans-serif', fh: 'serif', fwBold: '700',
    fsB1: '16px', fsB2: '14px', fsB3: '13px', fsB4: '12px', fsH3: '20px',
    accentBarW: '4px', pillRadius: '8px', transitionFast: '0.1s ease',
  },
}));

vi.mock('./scene-manager.js', () => ({
  SceneManager: {
    showSummary:       vi.fn(),
    hideSummary:       vi.fn(),
    openTransactional: vi.fn(),
  },
}));

vi.mock('./theme-manager.js', () => ({
  hexToRgba: (c) => c,
  buildCard: () => {
    const wrap = document.createElement('div');
    const card = document.createElement('div');
    wrap.appendChild(card);
    return { wrap, card };
  },
  buildSectionLabel: (text) => {
    const el = document.createElement('div');
    el.textContent = text || '';
    return el;
  },
  buildDataRow: (label = '', value = '') => {
    const row = document.createElement('div');
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const val = document.createElement('span');
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    row.setValue  = (v) => { val.textContent = v; };
    row.setColor  = (c) => { val.style.color = c; };
    return row;
  },
  buildDivider: () => document.createElement('div'),
}));

// ── Test setup ────────────────────────────────────────────────────────────────

let OrderSummary, SceneManager;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="order-summary"></div>';
  const mod   = await import('./order-summary.js');
  const smMod = await import('./scene-manager.js');
  OrderSummary  = mod.OrderSummary;
  SceneManager  = smMod.SceneManager;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

// ── show / hide ───────────────────────────────────────────────────────────────

describe('OrderSummary — show / hide', () => {
  it('show() calls SceneManager.showSummary()', () => {
    OrderSummary.show({ items: [], subtotal: 0, tax: 0, cardTotal: 0, cashPrice: 0 });
    expect(SceneManager.showSummary).toHaveBeenCalledOnce();
  });

  it('hide() calls SceneManager.hideSummary()', () => {
    OrderSummary.hide();
    expect(SceneManager.hideSummary).toHaveBeenCalledOnce();
  });

  it('show() makes the wrap element visible', () => {
    OrderSummary.show({ items: [] });
    const wrap = document.querySelector('#order-summary > div');
    expect(wrap?.style.display).toBe('flex');
  });

  it('show() resets itemRenderLocked so items render again', () => {
    OrderSummary.show({ items: [{ name: 'Burger', qty: 1, unitPrice: 9.99 }] });
    OrderSummary.lockItemRender();
    // A second show() must unlock item rendering
    OrderSummary.show({ items: [{ name: 'Fries', qty: 1, unitPrice: 3.99 }] });
    const itemScroll = document.getElementById('ticket-list');
    // Items were re-rendered (new show unlocked the lock)
    expect(itemScroll.children.length).toBe(1);
  });
});

// ── lockItemRender / unlockItemRender ─────────────────────────────────────────

describe('OrderSummary — render lock', () => {
  it('lockItemRender() prevents update() from re-rendering items', () => {
    OrderSummary.show({ items: [{ name: 'Burger', qty: 1, unitPrice: 9.99 }] });
    const itemScroll = document.getElementById('ticket-list');
    const countBefore = itemScroll.children.length;

    OrderSummary.lockItemRender();
    OrderSummary.update({
      items: [
        { name: 'Burger', qty: 1, unitPrice: 9.99 },
        { name: 'Fries',  qty: 1, unitPrice: 3.99 },
      ],
    });
    expect(itemScroll.children.length).toBe(countBefore);
  });

  it('unlockItemRender() allows update() to re-render items', () => {
    OrderSummary.show({ items: [{ name: 'Burger', qty: 1, unitPrice: 9.99 }] });
    const itemScroll = document.getElementById('ticket-list');

    OrderSummary.lockItemRender();
    OrderSummary.unlockItemRender();
    OrderSummary.update({
      items: [
        { name: 'Burger', qty: 1, unitPrice: 9.99 },
        { name: 'Fries',  qty: 1, unitPrice: 3.99 },
      ],
    });
    expect(itemScroll.children.length).toBe(2);
  });
});

// ── updateSplit ───────────────────────────────────────────────────────────────

describe('OrderSummary — updateSplit', () => {
  function findRowByLabel(label) {
    const lbl = [...document.querySelectorAll('span')].find(s => s.textContent === label);
    return lbl?.parentElement ?? null;
  }

  it('shows paid and remaining rows after updateSplit()', () => {
    OrderSummary.show({ cardTotal: 100, cashPrice: 90, items: [] });
    const paidRow   = findRowByLabel('Paid');
    const remainRow = findRowByLabel('Remaining');

    expect(paidRow?.style.display).toBe('none');
    expect(remainRow?.style.display).toBe('none');

    OrderSummary.updateSplit({ totalPaid: 25, remaining: 75 });

    expect(paidRow?.style.display).toBe('flex');
    expect(remainRow?.style.display).toBe('flex');
  });

  it('sets the correct dollar values on paid and remaining rows', () => {
    OrderSummary.show({ cardTotal: 100, cashPrice: 90, items: [] });
    OrderSummary.updateSplit({ totalPaid: 25.5, remaining: 74.5 });

    const paidRow   = findRowByLabel('Paid');
    const remainRow = findRowByLabel('Remaining');
    expect(paidRow?.querySelector('span:last-child')?.textContent).toBe('$25.50');
    expect(remainRow?.querySelector('span:last-child')?.textContent).toBe('$74.50');
  });
});

// ── Seat header tap ───────────────────────────────────────────────────────────

describe('OrderSummary — seat header tap', () => {
  it('onSeatHeaderTap fires with seatIdx when a seat header is tapped', () => {
    const onSeatHeaderTap = vi.fn();
    OrderSummary.show({
      collapsible: true,
      onSeatHeaderTap,
      items: [
        { seatHeader: true, seatId: 'SEAT 1', seatIdx: 2, seatTotal: 15.00 },
        { name: 'Burger', qty: 1, unitPrice: 9.99 },
      ],
    });
    const itemScroll  = document.getElementById('ticket-list');
    const seatHeader  = itemScroll.firstElementChild;
    seatHeader.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onSeatHeaderTap).toHaveBeenCalledWith(2);
  });
});

// ── Item tap ──────────────────────────────────────────────────────────────────

describe('OrderSummary — item tap', () => {
  it('onItemTap fires with the item index when a collapsible item is tapped', () => {
    const onItemTap = vi.fn();
    OrderSummary.show({
      collapsible: true,
      onItemTap,
      items: [
        { name: 'Burger', qty: 1, unitPrice: 9.99 },
        { name: 'Fries',  qty: 1, unitPrice: 3.99 },
      ],
    });
    const itemScroll = document.getElementById('ticket-list');
    // Tap the second item (forEach index 1)
    itemScroll.children[1].dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onItemTap).toHaveBeenCalledWith(1);
  });

  it('non-collapsible items do not fire onItemTap', () => {
    const onItemTap = vi.fn();
    OrderSummary.show({
      collapsible: false,
      onItemTap,
      items: [{ name: 'Burger', qty: 1, unitPrice: 9.99 }],
    });
    const itemScroll = document.getElementById('ticket-list');
    itemScroll.firstElementChild.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onItemTap).not.toHaveBeenCalled();
  });
});

// ── Back button ───────────────────────────────────────────────────────────────

describe('OrderSummary — back button', () => {
  it('onBack fires when the back button is tapped', () => {
    const onBack = vi.fn();
    OrderSummary.show({ showBack: true, onBack, items: [] });
    const backBtn = [...document.querySelectorAll('div')].find(
      el => el.textContent === '‹' && el.style.cursor === 'pointer',
    );
    backBtn?.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

// ── update() ─────────────────────────────────────────────────────────────────

describe('OrderSummary — update()', () => {
  it('update({ items }) re-renders the item list when not locked', () => {
    OrderSummary.show({ items: [{ name: 'Burger', qty: 1, unitPrice: 9.99 }] });
    const itemScroll = document.getElementById('ticket-list');
    OrderSummary.update({
      items: [
        { name: 'Burger', qty: 1, unitPrice: 9.99 },
        { name: 'Fries',  qty: 1, unitPrice: 3.99 },
      ],
    });
    expect(itemScroll.children.length).toBe(2);
  });

  it('update({ skipItems: true }) does not re-render items', () => {
    OrderSummary.show({ items: [{ name: 'Burger', qty: 1, unitPrice: 9.99 }] });
    const itemScroll  = document.getElementById('ticket-list');
    const countBefore = itemScroll.children.length;
    OrderSummary.update({
      skipItems: true,
      items: [
        { name: 'Burger', qty: 1, unitPrice: 9.99 },
        { name: 'Fries',  qty: 1, unitPrice: 3.99 },
      ],
    });
    expect(itemScroll.children.length).toBe(countBefore);
  });
});
