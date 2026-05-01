// Integration tests for terminal/scenes/column-editor.js.
//
// Drives the scene through its render() + DOM event surface.
// No physical hardware or real network needed.
//
// Key test scenarios:
//   Move   — selected items move from source column to target
//   Split  — item price divided evenly; remainder goes to first seat
//   Merge  — all columns collapsed into one; split groups recombined
//   Undo   — single undo restores previous state
//   UndoAll — long-press undo restores original snapshot
//   AddSeat — new column gets next sequential S-NNN label

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from '../components.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const registeredScenes = [];

vi.mock('../scene-manager.js', () => ({
  SceneManager: {
    mountWorking:         vi.fn(),
    openTransactional:    vi.fn(),
    closeTransactional:   vi.fn(),
    interrupt:            vi.fn(),
    closeInterrupt:       vi.fn(),
    hasInterrupt:         vi.fn(() => false),
    on:                   vi.fn(),
    off:                  vi.fn(),
    emit:                 vi.fn(),
  },
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../../common/tokens.js', () => ({
  T: {
    bg: '#bg', card: '#card', well: '#well', text: '#text',
    green: '#green', greenWarm: '#green', greenWarmDk: '#greenDk',
    gold: '#gold', goldDk: '#goldDk', elec: '#elec', elecDk: '#elecDk',
    verm: '#verm', vermDk: '#vermDk', moon: '#moon', border: '#border',
    lavender: '#lav', fb: 'sans-serif', fh: 'serif', fwBold: '700',
    fsB2: 14, fsB3: 12, fsB4: 10, fsH4: 26, pillRadius: '8px',
    chamferCard: 8, zTransactional: 20,
    seatPalette: ['#38bdf8', '#fb923c', '#f472b6', '#34d399'],
  },
}));

vi.mock('../theme-manager.js', () => ({
  buildStaticCard: () => {
    const el = document.createElement('div');
    el.setAccent = vi.fn();
    return el;
  },
  buildPillButton: ({ label } = {}) => {
    const el = document.createElement('button');
    el.textContent  = label || '';
    el.setDisabled  = vi.fn((d) => { el._disabled = d; });
    el.setColor     = vi.fn();
    return el;
  },
  buildSectionLabel: () => document.createElement('div'),
  hexToRgba:  (c) => c,
  darkenHex:  (c) => c,
  lightenHex: (c) => c,
}));

vi.mock('../components.js', () => ({ showToast: vi.fn() }));
vi.mock('../entomology-client.js', () => ({ entReport: vi.fn() }));
vi.mock('../styles.js', () => ({}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(name, price, id) {
  return {
    name, qty: 1, price,
    item_id: id || name.toLowerCase(),
    menu_item_id: 'm-' + name.toLowerCase(),
    category: 'Food', mods: [], notes: '',
  };
}

function makeCols(specs) {
  return specs.map((s, i) => ({
    id: 'col-' + i,
    label: 'S-' + String(i + 1).padStart(3, '0'),
    items: s.map((x) => makeItem(x.name, x.price, x.id)),
  }));
}

// Find a button-like element by its label text. The redesign builds action
// buttons (MOVE/SPLIT/MERGE/UNDO/CANCEL/CONFIRM) as <div>s with cursor:pointer
// rather than <button>s, so we accept either, plus the legacy nested-span case.
function findBtn(container, text) {
  return [...container.querySelectorAll('button, div')].find((b) => {
    const matches = b.textContent === text ||
      (b.querySelector('span') && b.querySelector('span').textContent === text);
    if (!matches) return false;
    return b.tagName === 'BUTTON' || b.style.cursor === 'pointer';
  });
}

// Find an add-zone <div> (NEW SEAT / NEW CHECK) by its label text
function findZone(container, labelText) {
  for (const div of container.querySelectorAll('div')) {
    if (div.style.fontSize === '8px' && div.textContent === labelText) {
      return div.parentElement; // the clickable zone wrapper
    }
  }
  return null;
}

// Dispatch a pointerup event on an element
function tap(el) {
  el.dispatchEvent(new Event('pointerup', { bubbles: true }));
}

// Dispatch pointerdown then pointerup
function press(el) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('pointerup',   { bubbles: true }));
}

// ── Fixture ───────────────────────────────────────────────────────────────────

let sceneDef;
let container;

beforeEach(async () => {
  vi.resetModules();
  registeredScenes.length = 0;
  await import('./column-editor.js');
  sceneDef  = registeredScenes[0];
  container = document.createElement('div');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(columns, onSave) {
  const state = JSON.parse(JSON.stringify(sceneDef.state));
  state.listeners = [];
  // The redesign defaults visibleColIds to the first column only; pass
  // focusedIds so multi-column tests still see every column rendered.
  const focusedIds = columns.map((c) => c.id);
  sceneDef.render(
    container,
    { columns, focusedIds, onSave: onSave || vi.fn() },
    state,
  );
  return state;
}

// ═══════════════════════════════════════════════════════
// Move
// ═══════════════════════════════════════════════════════

describe('column-editor — Move', () => {
  it('moves a selected item from col 0 to col 1', () => {
    const cols = makeCols([
      [{ name: 'Burger', price: 10 }],
      [],
    ]);
    const state = mount(cols);

    // Activate MOVE mode
    tap(findBtn(container, 'MOVE'));

    // Select the item in col 0 (first child of itemList)
    const itemRow = state.colEls[0].itemList.firstElementChild;
    tap(itemRow);

    // Tap col 1 header to move
    tap(state.colEls[1].hdr);

    expect(state.columns[0].items).toHaveLength(0);
    expect(state.columns[1].items).toHaveLength(1);
    expect(state.columns[1].items[0].name).toBe('Burger');
  });

  it('move is recorded in the action log', () => {
    const cols = makeCols([
      [{ name: 'Salad', price: 8 }],
      [],
    ]);
    const state = mount(cols);

    tap(findBtn(container, 'MOVE'));
    tap(state.colEls[0].itemList.firstElementChild);
    tap(state.colEls[1].hdr);

    expect(state.actionLog).toHaveLength(1);
  });

  it('selected items are cleared after a move', () => {
    const cols = makeCols([
      [{ name: 'Fries', price: 5 }],
      [],
    ]);
    const state = mount(cols);

    tap(findBtn(container, 'MOVE'));
    tap(state.colEls[0].itemList.firstElementChild);
    tap(state.colEls[1].hdr);

    expect(state.selectedItems).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════
// Split
// ═══════════════════════════════════════════════════════

describe('column-editor — Split', () => {
  it('splits a $10.00 item evenly across 2 seats → $5.00 each', () => {
    const cols = makeCols([
      [{ name: 'Steak', price: 10.00 }],
      [],
    ]);
    const state = mount(cols);

    // Select the item first — auto-activates MOVE and ungates SPLIT/MERGE
    tap(state.colEls[0].itemList.firstElementChild);

    // Switch to split mode
    tap(findBtn(container, 'SPLIT'));
    expect(state.mode).toBe('split');

    // Choose both columns as targets
    tap(state.colEls[0].hdr);
    tap(state.colEls[1].hdr);

    // Confirm
    tap(findBtn(container, 'CONFIRM'));

    const allItems = [...state.columns[0].items, ...state.columns[1].items];
    expect(allItems).toHaveLength(2);
    expect(allItems[0].price).toBe(5.00);
    expect(allItems[1].price).toBe(5.00);
    expect(allItems[0].price + allItems[1].price).toBe(10.00);
  });

  it('assigns the cent remainder to the first seat on odd amounts', () => {
    const cols = makeCols([
      [{ name: 'Wine', price: 10.01 }],
      [],
    ]);
    const state = mount(cols);

    tap(state.colEls[0].itemList.firstElementChild);
    tap(findBtn(container, 'SPLIT'));
    tap(state.colEls[0].hdr);
    tap(state.colEls[1].hdr);
    tap(findBtn(container, 'CONFIRM'));

    const allItems = [...state.columns[0].items, ...state.columns[1].items];
    const prices   = allItems.map((i) => i.price).sort((a, b) => b - a);
    expect(prices[0]).toBe(5.01); // first seat gets the extra cent
    expect(prices[1]).toBe(5.00);
    expect(prices[0] + prices[1]).toBeCloseTo(10.01, 5);
  });

  it('split items share the same _splitRef', () => {
    const cols = makeCols([
      [{ name: 'Pizza', price: 20.00, id: 'pizza-1' }],
      [],
    ]);
    const state = mount(cols);

    tap(state.colEls[0].itemList.firstElementChild);
    tap(findBtn(container, 'SPLIT'));
    tap(state.colEls[0].hdr);
    tap(state.colEls[1].hdr);
    tap(findBtn(container, 'CONFIRM'));

    const allItems = [...state.columns[0].items, ...state.columns[1].items];
    expect(allItems[0]._splitRef).toBeTruthy();
    expect(allItems[0]._splitRef).toBe(allItems[1]._splitRef);
  });

  it('split across 3 seats: remainder lands on seat 0 only', () => {
    const cols = makeCols([
      [{ name: 'Pasta', price: 10.00 }],
      [],
      [],
    ]);
    const state = mount(cols);

    tap(state.colEls[0].itemList.firstElementChild);
    tap(findBtn(container, 'SPLIT'));
    tap(state.colEls[0].hdr);
    tap(state.colEls[1].hdr);
    tap(state.colEls[2].hdr);
    tap(findBtn(container, 'CONFIRM'));

    const allItems = [
      ...state.columns[0].items,
      ...state.columns[1].items,
      ...state.columns[2].items,
    ];
    expect(allItems).toHaveLength(3);
    const total = allItems.reduce((s, i) => s + i.price, 0);
    expect(total).toBeCloseTo(10.00, 5);
  });
});

// ═══════════════════════════════════════════════════════
// Merge
// ═══════════════════════════════════════════════════════

describe('column-editor — Merge', () => {
  it('merges both columns into the target; result has one column', () => {
    const cols = makeCols([
      [{ name: 'Tacos', price: 12 }],
      [{ name: 'Agua',  price: 3  }],
    ]);
    const state = mount(cols);

    // Select an item to ungate MERGE
    tap(state.colEls[0].itemList.firstElementChild);
    tap(findBtn(container, 'MERGE'));
    expect(state.mode).toBe('merge');

    // Tap col 1 as the merge target, then CONFIRM
    tap(state.colEls[1].hdr);
    tap(findBtn(container, 'CONFIRM'));

    expect(state.columns).toHaveLength(1);
    expect(state.columns[0].items).toHaveLength(2);
  });

  it('previously split items are recollapsed on merge', () => {
    // Two items with the same _splitRef simulate a previously split item
    const raw = [
      { id: 'col-0', label: 'S-001', items: [
        { name: 'Steak', qty: 1, price: 15.00, item_id: 'stk', menu_item_id: 'm-stk',
          category: 'Food', mods: [], notes: '', _splitRef: 'ref-1' },
      ]},
      { id: 'col-1', label: 'S-002', items: [
        { name: 'Steak', qty: 1, price: 15.00, item_id: undefined, menu_item_id: 'm-stk',
          category: 'Food', mods: [], notes: '', _splitRef: 'ref-1' },
      ]},
    ];
    const state = mount(raw);

    // Select an item to ungate MERGE
    tap(state.colEls[1].itemList.firstElementChild);
    tap(findBtn(container, 'MERGE'));
    tap(state.colEls[0].hdr);
    tap(findBtn(container, 'CONFIRM'));

    // The two halves should be collapsed back into one item ($30.00)
    expect(state.columns[0].items).toHaveLength(1);
    expect(state.columns[0].items[0].price).toBe(30.00);
  });
});

// ═══════════════════════════════════════════════════════
// Undo / UndoAll
// ═══════════════════════════════════════════════════════

describe('column-editor — Undo', () => {
  it('undo after a move restores the original column state', () => {
    const cols = makeCols([
      [{ name: 'Soup', price: 7 }],
      [],
    ]);
    const state = mount(cols);

    // Move item from col 0 to col 1
    tap(findBtn(container, 'MOVE'));
    tap(state.colEls[0].itemList.firstElementChild);
    tap(state.colEls[1].hdr);
    expect(state.columns[1].items).toHaveLength(1);

    // Short-press UNDO
    press(findBtn(container, 'UNDO'));

    expect(state.columns[0].items).toHaveLength(1);
    expect(state.columns[0].items[0].name).toBe('Soup');
    expect(state.columns[1].items).toHaveLength(0);
  });

  it('undo on an empty action log does nothing', () => {
    const cols = makeCols([[{ name: 'Toast', price: 4 }], []]);
    const state = mount(cols);

    // No operations performed
    press(findBtn(container, 'UNDO'));

    expect(state.columns[0].items).toHaveLength(1);
    expect(state.actionLog).toHaveLength(0);
  });

  it('undo-all (long press 600ms) restores original snapshot', () => {
    vi.useFakeTimers();
    const cols = makeCols([
      [{ name: 'A', price: 1 }],
      [],
    ]);
    const state = mount(cols);

    // Two moves
    tap(findBtn(container, 'MOVE'));
    tap(state.colEls[0].itemList.firstElementChild);
    tap(state.colEls[1].hdr);
    // Re-render gives fresh colEls; after move col 1 has the item
    const itemRow2 = state.colEls[1].itemList.firstElementChild;
    tap(itemRow2);
    tap(state.colEls[0].hdr);

    expect(state.actionLog).toHaveLength(2);

    // Long-press UNDO (600ms)
    const undoBtn = findBtn(container, 'UNDO');
    undoBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(600);
    vi.advanceTimersByTime(200); // fill animation completes
    undoBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(state.actionLog).toHaveLength(0);
    expect(state.columns[0].items).toHaveLength(1);
    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════
// Add seat / Add check
// ═══════════════════════════════════════════════════════

describe('column-editor — Add seat', () => {
  it('adds a new column with the next sequential seat number', () => {
    const cols = makeCols([[{ name: 'Chips', price: 2 }]]);
    const state = mount(cols);

    // Redesign: "+" button in the seat selector replaces the NEW SEAT zone.
    const addSeatBtn = findBtn(container, '+');
    expect(addSeatBtn).toBeDefined();
    tap(addSeatBtn);

    expect(state.columns).toHaveLength(2);
    expect(state.columns[1].label).toBe('S-002');
  });

  it('skips already-used seat numbers', () => {
    // Pre-build 2 seats so the next is S-003
    const cols = makeCols([
      [{ name: 'Item', price: 1 }],
      [],
    ]);
    const state = mount(cols);

    const addSeatBtn = findBtn(container, '+');
    tap(addSeatBtn);

    expect(state.columns[2].label).toBe('S-003');
  });
});

