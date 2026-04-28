// Tests for terminal/scenes/item-detail.js — render logic.
//
// item-detail.js calls defineScene() at module scope. We mock defineScene to
// capture the render function, then call it directly in each test.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../../common/tokens.js', () => ({
  T: {
    green: '#86efac', verm: '#e8472a', text: '#ddd', gold: '#f59e0b',
    bg: '#1a1d21', border: '#4a4f57',
    fb: 'sans-serif', fh: 'serif', fwBold: '700', fsB2: '14px',
  },
}));

vi.mock('../scene-manager.js', () => ({
  SceneManager: { closeTransactional: vi.fn() },
  defineScene: vi.fn(),
}));

vi.mock('../theme-manager.js', () => ({
  buildPillButton: ({ label, onClick } = {}) => {
    const btn = document.createElement('button');
    btn.textContent = label || '';
    if (onClick) btn.addEventListener('pointerup', onClick);
    return btn;
  },
  hexToRgba: (c) => c,
}));

import { SceneManager, defineScene } from '../scene-manager.js';
import './item-detail.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let render;

beforeAll(() => {
  render = defineScene.mock.calls[0][0].render;
});

let container;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ── Guard ─────────────────────────────────────────────────────────────────────

describe('item-detail render — guard', () => {
  it('returns without rendering when params.item is absent', () => {
    render(container, {});
    expect(container.children.length).toBe(0);
  });
});

// ── Price calculation ─────────────────────────────────────────────────────────

describe('item-detail render — total price', () => {
  it('shows unitPrice when there are no mods', () => {
    render(container, { item: { name: 'Burger', unitPrice: 9.99, mods: [] } });
    const price = container.children[1];
    expect(price.textContent).toBe('$9.99');
  });

  it('totals unitPrice + sum of mod prices', () => {
    render(container, {
      item: {
        name: 'Pizza',
        unitPrice: 12.00,
        mods: [{ name: 'Extra Cheese', price: 1.50 }, { name: 'Olives', price: 0.75 }],
      },
    });
    const price = container.children[1];
    expect(price.textContent).toBe('$14.25');
  });

  it('treats missing mod price as 0', () => {
    render(container, {
      item: { name: 'Salad', unitPrice: 8.00, mods: [{ name: 'No Dressing' }] },
    });
    expect(container.children[1].textContent).toBe('$8.00');
  });
});

// ── Item name ─────────────────────────────────────────────────────────────────

describe('item-detail render — item name', () => {
  it('displays the item name in the title element', () => {
    render(container, { item: { name: 'Cheeseburger', unitPrice: 10.00, mods: [] } });
    expect(container.children[0].textContent).toBe('Cheeseburger');
  });
});

// ── Modifier list ─────────────────────────────────────────────────────────────

describe('item-detail render — modifier list', () => {
  it('shows "No modifiers" when mods array is empty', () => {
    render(container, { item: { name: 'Burger', unitPrice: 9.99, mods: [] } });
    const scroll = container.children[2];
    expect(scroll.textContent).toBe('No modifiers');
  });

  it('shows "No modifiers" when mods is absent', () => {
    render(container, { item: { name: 'Burger', unitPrice: 9.99 } });
    const scroll = container.children[2];
    expect(scroll.textContent).toBe('No modifiers');
  });

  it('displays mod name with prefix prepended', () => {
    render(container, {
      item: {
        name: 'Pizza',
        unitPrice: 10.00,
        mods: [{ name: 'Pepperoni', prefix: 'Extra', price: 1.00 }],
      },
    });
    const scroll = container.children[2];
    const nameSpan = scroll.querySelector('span');
    expect(nameSpan.textContent).toBe('Extra Pepperoni');
  });

  it('displays mod name without prefix when prefix is absent', () => {
    render(container, {
      item: {
        name: 'Pizza',
        unitPrice: 10.00,
        mods: [{ name: 'Mushrooms', price: 0 }],
      },
    });
    const scroll = container.children[2];
    const nameSpan = scroll.querySelector('span');
    expect(nameSpan.textContent).toBe('Mushrooms');
  });

  it('shows "+$X.XX" price only when mod price is greater than zero', () => {
    render(container, {
      item: {
        name: 'Wrap',
        unitPrice: 8.00,
        mods: [
          { name: 'Chicken', price: 2.00 },
          { name: 'No Sauce', price: 0 },
        ],
      },
    });
    const scroll = container.children[2];
    const rows = [...scroll.children];
    const chickenRow = rows[0];
    const sauceRow   = rows[1];

    expect(chickenRow.querySelector('span:last-child').textContent).toBe('+$2.00');
    expect(sauceRow.querySelector('span:last-child').textContent).toBe('');
  });

  it('renders child exclusion rows indented under the parent mod', () => {
    render(container, {
      item: {
        name: 'Pizza',
        unitPrice: 10.00,
        mods: [
          {
            name: 'Half Topping',
            price: 0,
            children: [{ name: 'No Mushrooms' }, { name: 'No Onions' }],
          },
        ],
      },
    });
    const scroll = container.children[2];
    const childRows = [...scroll.querySelectorAll('div')].filter(d => d.children.length === 1);
    expect(childRows.some(r => r.textContent.includes('No Mushrooms'))).toBe(true);
    expect(childRows.some(r => r.textContent.includes('No Onions'))).toBe(true);
  });
});

// ── DONE button ───────────────────────────────────────────────────────────────

describe('item-detail render — DONE button', () => {
  it('DONE button calls SceneManager.closeTransactional("item-detail")', () => {
    render(container, { item: { name: 'Burger', unitPrice: 9.99, mods: [] } });
    const btn = container.querySelector('button');
    expect(btn.textContent).toBe('DONE');
    btn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(SceneManager.closeTransactional).toHaveBeenCalledWith('item-detail');
  });
});
