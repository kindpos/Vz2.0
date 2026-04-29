// Tests for terminal/pizza-builder-overlay.js
//
// What's testable without HexNav (HexNav is a disabled stub — no onSelect fires):
//   _halfPriceAmount      — exported pure formula
//   showPizzaBuilderOverlay — registers interrupt with SceneManager
//   mount (sync DOM)      — prefix buttons, placement buttons, CANCEL, UNDO, ADD
//   renderLog             — empty-state message; entry removal via row tap

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const registeredInterrupts = [];

const SceneManagerMock = {
  interrupt:             vi.fn((name, params) => { registeredInterrupts.push({ name, params }); }),
  closeInterrupt:        vi.fn(),
  register:              vi.fn((def) => { registeredInterrupts._def = def; }),
  on:                    vi.fn(),
  off:                   vi.fn(),
  emit:                  vi.fn(),
  openTransactional:     vi.fn(),
  closeTransactional:    vi.fn(),
  hasInterrupt:          vi.fn(() => false),
};

vi.mock('./scene-manager.js', () => ({
  SceneManager: SceneManagerMock,
  defineScene:  vi.fn((d) => d),
}));

vi.mock('../common/tokens.js', () => {
  function deep() {
    return new Proxy({}, {
      get(_, k) {
        if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => '';
        if (k === 'catColor') return () => '';
        return deep();
      },
    });
  }
  return { T: deep() };
});

vi.mock('./theme-manager.js', () => ({
  buildPillButton: (opts = {}) => {
    const btn = document.createElement('div');
    btn.textContent = opts.label || '';
    btn._opts = opts;
    if (opts.onClick) btn.addEventListener('pointerup', opts.onClick);
    return btn;
  },
  hexToRgba:  (c) => c,
  darkenHex:  (c) => c,
}));

vi.mock('./menu-data/universal-modifiers.js', () => ({
  PREFIXES: [
    { id: 'add', label: 'Add',   color: '#0f0', textColor: '#000' },
    { id: 'no',  label: 'No',    color: '#f00', textColor: '#fff' },
  ],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let _halfPriceAmount;
let showPizzaBuilderOverlay;
let pizzaBuilderDef;   // the SceneManager.register definition

async function loadModule() {
  vi.resetModules();
  registeredInterrupts.length = 0;
  SceneManagerMock.interrupt.mockClear();
  SceneManagerMock.register.mockClear();

  const mod = await import('./pizza-builder-overlay.js');
  _halfPriceAmount       = mod._halfPriceAmount;
  showPizzaBuilderOverlay = mod.showPizzaBuilderOverlay;

  // Capture the pizza-builder interrupt definition from register()
  const registerCall = SceneManagerMock.register.mock.calls[0];
  pizzaBuilderDef = registerCall ? registerCall[0] : null;
}

function mountOverlay(sizeItem, builderData, onConfirm, onCancel) {
  const container = document.createElement('div');
  if (pizzaBuilderDef) {
    pizzaBuilderDef.mount(container, {
      sizeItem:    sizeItem    || { label: 'Large', price: 14 },
      builderData: builderData || [],
      onConfirm:   onConfirm   || vi.fn(),
      onCancel:    onCancel    || vi.fn(),
    });
  }
  return container;
}

// Find a button in the container by its text label.
function findBtn(container, label) {
  return Array.from(container.querySelectorAll('div,button'))
    .find((el) => el.textContent.trim() === label);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('pizza-builder-overlay — _halfPriceAmount (pure formula)', () => {
  beforeEach(loadModule);

  it('halves an integer price', () => {
    expect(_halfPriceAmount(2)).toBe(1.00);
  });

  it('rounds a half-cent up to the nearest cent', () => {
    // $1.25 / 2 = $0.625 → rounds to $0.63
    expect(_halfPriceAmount(1.25)).toBe(0.63);
  });

  it('returns 0 for a free topping', () => {
    expect(_halfPriceAmount(0)).toBe(0);
  });

  it('handles fractional prices correctly', () => {
    // $3.00 → $1.50 exactly
    expect(_halfPriceAmount(3.00)).toBe(1.50);
  });
});

describe('pizza-builder-overlay — showPizzaBuilderOverlay', () => {
  beforeEach(loadModule);

  it('calls SceneManager.interrupt with "pizza-builder"', () => {
    showPizzaBuilderOverlay({ label: 'Small', price: 10 }, []);
    expect(SceneManagerMock.interrupt).toHaveBeenCalledWith(
      'pizza-builder',
      expect.objectContaining({
        onConfirm: expect.any(Function),
        onCancel:  expect.any(Function),
        params:    expect.objectContaining({ sizeItem: expect.anything() }),
      }),
    );
  });

  it('returns a Promise', () => {
    const result = showPizzaBuilderOverlay({ label: 'Small', price: 10 }, []);
    expect(result).toBeInstanceOf(Promise);
  });

  it('promise resolves when onConfirm is called', async () => {
    const p = showPizzaBuilderOverlay({ label: 'Small', price: 10 }, []);
    const { onConfirm } = SceneManagerMock.interrupt.mock.calls[0][1];
    onConfirm({ name: 'Small', unitPrice: 10, mods: [], category: 'pizza' });
    await expect(p).resolves.toMatchObject({ category: 'pizza' });
  });

  it('promise rejects when onCancel is called', async () => {
    const p = showPizzaBuilderOverlay({ label: 'Small', price: 10 }, []);
    const { onCancel } = SceneManagerMock.interrupt.mock.calls[0][1];
    onCancel();
    await expect(p).rejects.toThrow();
  });
});

describe('pizza-builder-overlay — mount DOM', () => {
  beforeEach(loadModule);

  it('renders prefix buttons (Add, No)', () => {
    const container = mountOverlay();
    expect(findBtn(container, 'Add')).toBeDefined();
    expect(findBtn(container, 'No')).toBeDefined();
  });

  it('renders placement buttons (1st, Whole, 2nd)', () => {
    const container = mountOverlay();
    expect(findBtn(container, '1st')).toBeDefined();
    expect(findBtn(container, 'Whole')).toBeDefined();
    expect(findBtn(container, '2nd')).toBeDefined();
  });

  it('renders CANCEL, UNDO, ADD action buttons', () => {
    const container = mountOverlay();
    expect(findBtn(container, 'CANCEL')).toBeDefined();
    expect(findBtn(container, 'UNDO')).toBeDefined();
    expect(findBtn(container, 'ADD')).toBeDefined();
  });

  it('CANCEL button calls onCancel', () => {
    const onCancel = vi.fn();
    const container = mountOverlay(null, null, null, onCancel);
    findBtn(container, 'CANCEL').dispatchEvent(new Event('pointerup'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('ADD button calls onConfirm with correct shape', () => {
    const onConfirm = vi.fn();
    const sizeItem = { label: 'Medium', price: 12 };
    const container = mountOverlay(sizeItem, null, onConfirm);
    findBtn(container, 'ADD').dispatchEvent(new Event('pointerup'));
    expect(onConfirm).toHaveBeenCalledWith({
      name:      'Medium',
      unitPrice: 12,
      mods:      [],        // no mods added (HexNav stub, no onSelect fired)
      category:  'pizza',
    });
  });

  it('UNDO is a no-op when no mods have been applied', () => {
    const container = mountOverlay();
    expect(() => {
      findBtn(container, 'UNDO').dispatchEvent(new Event('pointerup'));
    }).not.toThrow();
  });

  it('log shows empty-state message when no mods applied', () => {
    const container = mountOverlay();
    expect(container.textContent).toContain('Tap a topping');
  });

  it('prefix tap changes the active prefix visual state (no throw)', () => {
    const container = mountOverlay();
    expect(() => {
      findBtn(container, 'No').dispatchEvent(new Event('pointerup'));
    }).not.toThrow();
  });

  it('placement tap changes the active placement visual state (no throw)', () => {
    const container = mountOverlay();
    expect(() => {
      findBtn(container, '1st').dispatchEvent(new Event('pointerup'));
    }).not.toThrow();
  });
});
