// Tests for terminal/category-grid.js — CategoryGrid constructor and public API.
//
// CategoryGrid uses only instance-level state (no module-level vars), so a fresh
// `new CategoryGrid(container, opts)` per test is sufficient — no vi.resetModules().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../common/tokens.js', () => ({
  T: {
    green: '#86efac', greenWarm: '#86efac',
    bg: '#1a1d21', well: '#22252a', card: '#2d3139', border: '#4a4f57',
    gold: '#f59e0b', fh: 'serif', fb: 'sans-serif', fwBold: '700',
    accentBarW: '4px', chamferCard: '8',
  },
}));

vi.mock('./theme-manager.js', () => ({
  hexToRgba: (c) => c,
}));

import { CategoryGrid } from './category-grid.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.innerHTML = '';
});

function gridRoot(c)       { return c.firstElementChild; }
function tiles(c)          { return [...gridRoot(c).children]; }
function tileLabel(tile)   { return tile.firstElementChild?.textContent ?? ''; }
function tileLabels(c)     { return tiles(c).map(tileLabel); }
function findTile(c, lbl)  { return tiles(c).find(t => tileLabel(t) === lbl); }
function tap(tile)         { tile.dispatchEvent(new MouseEvent('click', { bubbles: true })); }

// ── State A: initial render ───────────────────────────────────────────────────

describe('CategoryGrid — State A', () => {
  it('renders one tile per top-level category', () => {
    new CategoryGrid(container, {
      data: [{ id: 'c1', label: 'Drinks' }, { id: 'c2', label: 'Food' }],
    });
    expect(tiles(container)).toHaveLength(2);
  });

  it('sorts categories alphabetically by default', () => {
    new CategoryGrid(container, {
      data: [
        { id: 'c1', label: 'Zucchini' },
        { id: 'c2', label: 'Apple' },
        { id: 'c3', label: 'Mango' },
      ],
    });
    expect(tileLabels(container)).toEqual(['Apple', 'Mango', 'Zucchini']);
  });

  it('sort:"none" preserves insertion order', () => {
    new CategoryGrid(container, {
      sort: 'none',
      data: [{ id: 'c1', label: 'Zucchini' }, { id: 'c2', label: 'Apple' }],
    });
    expect(tileLabels(container)).toEqual(['Zucchini', 'Apple']);
  });

  it('shows no tiles for empty data', () => {
    new CategoryGrid(container, { data: [] });
    expect(tiles(container)).toHaveLength(0);
  });
});

// ── Drill navigation (State B) ────────────────────────────────────────────────

describe('CategoryGrid — drill navigation', () => {
  it('tapping a category tile switches to State B with back tile + children', () => {
    new CategoryGrid(container, {
      data: [{
        id: 'c1', label: 'Food',
        items: [{ name: 'Burger', price: 9.99 }, { name: 'Fries', price: 3.99 }],
      }],
    });
    tap(findTile(container, 'Food'));
    const labels = tileLabels(container);
    expect(labels[0]).toBe('Food');      // back tile
    expect(labels).toContain('Burger');
    expect(labels).toContain('Fries');
  });

  it('tapping the back tile returns to State A', () => {
    new CategoryGrid(container, {
      data: [{ id: 'c1', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    tap(findTile(container, 'Food'));     // drill in
    tap(findTile(container, 'Food'));     // the back tile also has label 'Food'
    expect(tileLabels(container)).toEqual(['Food']);
  });

  it('tapping a leaf item fires onSelect with the item and empty mods', () => {
    const onSelect = vi.fn();
    new CategoryGrid(container, {
      onSelect,
      data: [{ id: 'c1', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    tap(findTile(container, 'Food'));
    tap(findTile(container, 'Burger'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Burger' }),
      {},
    );
  });

  it('renders price on item tiles when provided', () => {
    new CategoryGrid(container, {
      data: [{ id: 'c1', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    tap(findTile(container, 'Food'));
    const burgerTile = findTile(container, 'Burger');
    expect(burgerTile.children[1]?.textContent).toBe('$9.99');
  });
});

// ── Nav lock ──────────────────────────────────────────────────────────────────

describe('CategoryGrid — nav lock', () => {
  it('lockNav() prevents tile clicks from navigating', () => {
    const onSelect = vi.fn();
    const grid = new CategoryGrid(container, {
      onSelect,
      data: [{ id: 'c1', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    grid.lockNav();
    tap(findTile(container, 'Food'));
    expect(tileLabels(container)).toEqual(['Food']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('unlockNav() re-enables navigation after lockNav()', () => {
    const grid = new CategoryGrid(container, {
      data: [{ id: 'c1', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    grid.lockNav();
    grid.unlockNav();
    tap(findTile(container, 'Food'));
    expect(tileLabels(container)).toContain('Burger');
  });
});

// ── Public API ────────────────────────────────────────────────────────────────

describe('CategoryGrid — public API', () => {
  it('reset() returns to State A from State B', () => {
    const grid = new CategoryGrid(container, {
      data: [{ id: 'c1', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    tap(findTile(container, 'Food'));
    grid.reset();
    expect(tileLabels(container)).toEqual(['Food']);
  });

  it('setData() replaces data and resets to State A', () => {
    const grid = new CategoryGrid(container, {
      data: [{ id: 'c1', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    tap(findTile(container, 'Food'));
    grid.setData([{ id: 'c2', label: 'Drinks' }]);
    expect(tileLabels(container)).toEqual(['Drinks']);
  });

  it('getCatId() returns null at State A', () => {
    const grid = new CategoryGrid(container, {
      data: [{ id: 'cat-food', label: 'Food', items: [] }],
    });
    expect(grid.getCatId()).toBeNull();
  });

  it('getCatId() returns the drilled-into category id', () => {
    const grid = new CategoryGrid(container, {
      data: [{ id: 'cat-food', label: 'Food', items: [{ name: 'Burger', price: 9.99 }] }],
    });
    tap(findTile(container, 'Food'));
    expect(grid.getCatId()).toBe('cat-food');
  });

  it('destroy() removes the grid from the DOM', () => {
    const grid = new CategoryGrid(container, { data: [{ id: 'c1', label: 'Food' }] });
    expect(container.children.length).toBe(1);
    grid.destroy();
    expect(container.children.length).toBe(0);
  });

  it('setColumns() updates the grid template columns', () => {
    const grid = new CategoryGrid(container, { data: [], columns: 3 });
    grid.setColumns(5);
    expect(gridRoot(container).style.gridTemplateColumns).toBe('repeat(5, 1fr)');
  });

  it('setSort() re-renders with the new sort order', () => {
    const grid = new CategoryGrid(container, {
      data: [{ id: 'c1', label: 'Zucchini' }, { id: 'c2', label: 'Apple' }],
    });
    expect(tileLabels(container)).toEqual(['Apple', 'Zucchini']);
    grid.setSort('none');
    expect(tileLabels(container)).toEqual(['Zucchini', 'Apple']);
  });

  it('showPickList() renders a back tile and the provided items', () => {
    const grid = new CategoryGrid(container, { data: [] });
    grid.showPickList('Sides', '#86efac', '#fff', [
      { name: 'Mac', price: 3.00 },
      { name: 'Slaw', price: 2.50 },
    ]);
    const labels = tileLabels(container);
    expect(labels).toContain('Sides');
    expect(labels).toContain('Mac');
    expect(labels).toContain('Slaw');
  });
});

// ── Modifier flow ─────────────────────────────────────────────────────────────

describe('CategoryGrid — modifier flow', () => {
  const ITEM = {
    name: 'Burger',
    price: 9.99,
    requiredMods: [
      {
        id: 'g1',
        label: 'Doneness',
        choices: [
          { id: 'c1', label: 'Medium',   price: 0 },
          { id: 'c2', label: 'Well Done', price: 0 },
        ],
      },
    ],
  };

  function drillToItem(c) {
    tap(findTile(c, 'Food'));
    tap(findTile(c, 'Burger'));
  }

  it('tapping an item with requiredMods enters mod-groups view', () => {
    new CategoryGrid(container, {
      data: [{ id: 'cat', label: 'Food', items: [ITEM] }],
    });
    drillToItem(container);
    const labels = tileLabels(container);
    expect(labels).toContain('Burger');    // back tile shows item name
    expect(labels).toContain('Doneness'); // group tile
  });

  it('DONE tile is absent before any group is satisfied', () => {
    new CategoryGrid(container, {
      data: [{ id: 'cat', label: 'Food', items: [ITEM] }],
    });
    drillToItem(container);
    expect(tileLabels(container)).not.toContain('DONE');
  });

  it('tapping a group tile drills into its choices', () => {
    new CategoryGrid(container, {
      data: [{ id: 'cat', label: 'Food', items: [ITEM] }],
    });
    drillToItem(container);
    tap(findTile(container, 'Doneness'));
    const labels = tileLabels(container);
    expect(labels).toContain('Medium');
    expect(labels).toContain('Well Done');
  });

  it('picking a choice returns to groups view and shows DONE when all groups satisfied', () => {
    new CategoryGrid(container, {
      data: [{ id: 'cat', label: 'Food', items: [ITEM] }],
    });
    drillToItem(container);
    tap(findTile(container, 'Doneness'));
    tap(findTile(container, 'Medium'));
    const labels = tileLabels(container);
    expect(labels).toContain('Medium');   // group tile now shows selected label
    expect(labels).toContain('DONE');
  });

  it('single-select: picking a second choice replaces the first', () => {
    new CategoryGrid(container, {
      data: [{ id: 'cat', label: 'Food', items: [ITEM] }],
    });
    drillToItem(container);
    tap(findTile(container, 'Doneness'));
    tap(findTile(container, 'Medium'));     // pick Medium → group tile label becomes 'Medium'
    tap(findTile(container, 'Medium'));     // re-open group (tile labelled 'Medium')
    tap(findTile(container, 'Well Done')); // change pick
    const labels = tileLabels(container);
    expect(labels).toContain('Well Done');
    expect(labels).not.toContain('Medium');
  });

  it('tapping DONE fires onSelect with item + selectedMods then returns to State B', () => {
    const onSelect = vi.fn();
    new CategoryGrid(container, {
      onSelect,
      data: [{ id: 'cat', label: 'Food', items: [ITEM] }],
    });
    drillToItem(container);
    tap(findTile(container, 'Doneness'));
    tap(findTile(container, 'Medium'));
    tap(findTile(container, 'DONE'));

    expect(onSelect).toHaveBeenCalledOnce();
    const [resultItem, mods] = onSelect.mock.calls[0];
    expect(resultItem.name).toBe('Burger');
    expect(resultItem.selectedMods).toHaveLength(1);
    expect(resultItem.selectedMods[0].label).toBe('Medium');
    expect(mods).toEqual({});
  });

  it('back tile in mod-groups cancels the flow and returns to State B', () => {
    const onSelect = vi.fn();
    new CategoryGrid(container, {
      onSelect,
      data: [{ id: 'cat', label: 'Food', items: [ITEM] }],
    });
    drillToItem(container);
    tap(findTile(container, 'Burger')); // back tile in mod-groups = item name
    const labels = tileLabels(container);
    expect(labels).toContain('Burger'); // item tile is back
    expect(labels).not.toContain('Doneness');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('item with requiredMods having no choices calls onSelect directly', () => {
    const onSelect = vi.fn();
    const noChoiceItem = {
      name: 'Plain',
      price: 5.00,
      requiredMods: [{ id: 'g1', label: 'Empty', choices: [] }],
    };
    new CategoryGrid(container, {
      onSelect,
      data: [{ id: 'cat', label: 'Food', items: [noChoiceItem] }],
    });
    tap(findTile(container, 'Food'));
    tap(findTile(container, 'Plain'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Plain' }), {});
  });
});
