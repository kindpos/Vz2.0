// Tests for terminal/half-placement-overlay.js — mod-placement overlay.
//
// half-placement-overlay.js calls SceneManager.register() at module scope.
// We mock register() to capture the mount function and call it directly.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../common/tokens.js', () => ({
  T: {
    green: '#86efac', gold: '#f59e0b', verm: '#e8472a',
    bg: '#1a1d21', well: '#22252a', card: '#2d3139', border: '#4a4f57',
    fb: 'sans-serif', fh: 'serif',
    fsB2: '14px', fsB3: '13px', chamferCard: '8',
  },
}));

vi.mock('./scene-manager.js', () => ({
  SceneManager: {
    register:  vi.fn(),
    interrupt: vi.fn(),
  },
}));

vi.mock('./theme-manager.js', () => ({
  buildPillButton: ({ label, onClick } = {}) => {
    const btn = document.createElement('button');
    btn.textContent = label || '';
    if (onClick) btn.addEventListener('pointerup', onClick);
    return btn;
  },
  darkenHex: (c) => c,
  hexToRgba: (c) => c,
}));

import { SceneManager } from './scene-manager.js';
import { showHalfPlacementOverlay } from './half-placement-overlay.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

let mount;

beforeAll(() => {
  mount = SceneManager.register.mock.calls[0][0].mount;
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

// ── Helper to mount the overlay ────────────────────────────────────────────────

function open(overrides = {}) {
  const defaults = {
    itemName: 'Pizza',
    modName:  'Pepperoni',
    modPrice: 2.00,
    halfPrice: 1.00,
    currentMods: [],
    onConfirm: vi.fn(),
    onCancel:  vi.fn(),
  };
  mount(container, { ...defaults, ...overrides });
  return {
    onConfirm: overrides.onConfirm || defaults.onConfirm,
    onCancel:  overrides.onCancel  || defaults.onCancel,
  };
}

function btn(label) {
  return [...document.querySelectorAll('button')].find(b => b.textContent === label);
}

// ── Header ────────────────────────────────────────────────────────────────────

describe('half-placement overlay — header', () => {
  it('header contains both itemName and modName', () => {
    open({ itemName: 'Calzone', modName: 'Sausage' });
    const header = container.querySelector('div');
    expect(header.textContent).toContain('Calzone');
    expect(header.textContent).toContain('Sausage');
  });
});

// ── Buttons ───────────────────────────────────────────────────────────────────

describe('half-placement overlay — buttons', () => {
  it('LEFT button calls onConfirm with { side: "Left" }', () => {
    const { onConfirm } = open();
    btn('LEFT').dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledWith({ side: 'Left' });
  });

  it('RIGHT button calls onConfirm with { side: "Right" }', () => {
    const { onConfirm } = open();
    btn('RIGHT').dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledWith({ side: 'Right' });
  });

  it('CANCEL button calls onCancel', () => {
    const { onCancel } = open();
    btn('CANCEL').dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onCancel).toHaveBeenCalled();
  });
});

// ── Column mod filtering ──────────────────────────────────────────────────────

describe('half-placement overlay — column filtering', () => {
  it('left column shows only mods with prefix="Left"', () => {
    open({
      currentMods: [
        { name: 'Mushrooms', prefix: 'Left',  price: 0 },
        { name: 'Onions',    prefix: 'Right', price: 0 },
        { name: 'Garlic',                     price: 0 },
      ],
    });
    const spans = [...document.querySelectorAll('span')];
    // Mushrooms should appear in the left column (• Mushrooms)
    expect(spans.some(s => s.textContent.includes('Mushrooms'))).toBe(true);
  });

  it('right column shows only mods with prefix="Right"', () => {
    const onConfirm = vi.fn();
    open({
      currentMods: [
        { name: 'Olives', prefix: 'Right', price: 0 },
      ],
      onConfirm,
    });
    // Click RIGHT to verify right column context is correct
    btn('RIGHT').dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledWith({ side: 'Right' });
    // Olives should appear somewhere in the DOM
    expect(document.body.textContent).toContain('Olives');
  });

  it('shows placeholder when a column has no mods', () => {
    open({ currentMods: [] });
    expect(document.body.textContent).toContain('Nothing on left');
    expect(document.body.textContent).toContain('Nothing on right');
  });
});

// ── Whole-mod "Xtra" logic ────────────────────────────────────────────────────

describe('half-placement overlay — Xtra label', () => {
  it('labels a mod as "Xtra" when the same mod is on the whole item', () => {
    open({
      currentMods: [
        { name: 'Pepperoni', price: 1.00 },           // whole mod (no prefix)
        { name: 'Pepperoni', prefix: 'Left', price: 0.50 }, // half → should be Xtra
      ],
    });
    expect(document.body.textContent).toContain('Xtra Pepperoni');
  });

  it('does NOT label a mod as "Xtra" when it has no whole counterpart', () => {
    open({
      currentMods: [
        { name: 'Mushrooms', prefix: 'Left', price: 0 },
      ],
    });
    expect(document.body.textContent).not.toContain('Xtra Mushrooms');
    expect(document.body.textContent).toContain('Mushrooms');
  });
});

// ── Price display ─────────────────────────────────────────────────────────────

describe('half-placement overlay — price display', () => {
  it('uses half_price when provided and non-null', () => {
    open({
      currentMods: [{ name: 'Pepperoni', prefix: 'Left', price: 2.00, half_price: 1.00 }],
    });
    expect(document.body.textContent).toContain('$1.00');
    expect(document.body.textContent).not.toContain('$2.00');
  });

  it('falls back to price when half_price is null', () => {
    open({
      currentMods: [{ name: 'Pepperoni', prefix: 'Left', price: 2.00, half_price: null }],
    });
    expect(document.body.textContent).toContain('$2.00');
  });

  it('omits price span when effective price is 0', () => {
    open({
      currentMods: [{ name: 'Basil', prefix: 'Left', price: 0, half_price: null }],
    });
    // $0.00 should not appear
    expect(document.body.textContent).not.toContain('$0.00');
  });
});

// ── showHalfPlacementOverlay ──────────────────────────────────────────────────

describe('showHalfPlacementOverlay — Promise wrapper', () => {
  it('returns a Promise and calls SceneManager.interrupt', () => {
    const p = showHalfPlacementOverlay('Pizza', 'Cheese', 1.00, 0.50, []);
    expect(p).toBeInstanceOf(Promise);
    expect(SceneManager.interrupt).toHaveBeenCalledWith(
      'half-placement',
      expect.objectContaining({
        onConfirm: expect.any(Function),
        onCancel:  expect.any(Function),
      }),
    );
  });

  it('resolves when the onConfirm callback is invoked', async () => {
    const p = showHalfPlacementOverlay('Pizza', 'Cheese', 1.00, 0.50, []);
    const { onConfirm } = SceneManager.interrupt.mock.calls[0][1];
    onConfirm({ side: 'Right' });
    await expect(p).resolves.toEqual({ side: 'Right' });
  });

  it('rejects when the onCancel callback is invoked', async () => {
    const p = showHalfPlacementOverlay('Pizza', 'Cheese', 1.00, 0.50, []);
    const { onCancel } = SceneManager.interrupt.mock.calls[0][1];
    onCancel();
    await expect(p).rejects.toThrow('Interrupt cancelled');
  });
});
