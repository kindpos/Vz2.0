// Tests for the split-select interrupt in terminal/scenes/payment.js.
//
// Bug: showSplitPopup() previously called
//   SceneManager.interrupt('split-select', { params: { remaining }, onConfirm })
// which wrapped `remaining` in a nested `params` key. The split-select render
// reads `params.remaining` directly, so `remaining` resolved to `undefined` and
// all three split options showed $0.00.
//
// Fix: the params are now passed at the top level:
//   SceneManager.interrupt('split-select', { remaining, onConfirm })
//
// These tests pin the render's correct behaviour given the fixed params shape,
// verifying that the displayed amounts and the onConfirm argument are correct.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mocks ---

const registeredScenes = [];

vi.mock('../scene-manager.js', () => ({
  SceneManager: {
    interrupt:           vi.fn(),
    closeInterrupt:      vi.fn(),
    openTransactional:   vi.fn(),
    closeTransactional:  vi.fn(),
    closeAllTransactional: vi.fn(),
    mountWorking:        vi.fn(),
    unmountWorking:      vi.fn(),
    getActiveWorking:    vi.fn(() => 'payment'),
    hasInterrupt:        vi.fn(() => false),
    on:                  vi.fn(),
    off:                 vi.fn(),
    emit:                vi.fn(),
  },
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../sm2-shim.js', () => ({
  hexToRgba:         (c) => c,
  chamfer:           () => '',
  applySunkenStyle:  () => {},
  buildStyledButton: () => {
    const el = document.createElement('div');
    return { wrap: el, inner: el };
  },
  fetchWithTimeout: vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })),
}));

vi.mock('../components.js', () => ({
  buildButton: (label, opts) => {
    const el = document.createElement('button');
    el.textContent = label;
    el._onTap = opts && opts.onTap ? opts.onTap : null;
    return el;
  },
  showToast: vi.fn(),
}));

vi.mock('../app.js', () => ({
  setSceneName:  vi.fn(),
  setHeaderBack: vi.fn(),
}));

vi.mock('../numpad.js', () => ({
  buildNumpad: () => {
    const el = document.createElement('div');
    el.clear = vi.fn();
    el.setPin = vi.fn();
    el.setHint = vi.fn();
    el.setError = vi.fn();
    return el;
  },
}));

vi.mock('../order-summary.js', () => ({
  OrderSummary: {
    show:        vi.fn(),
    hide:        vi.fn(),
    updateSplit: vi.fn(),
  },
}));

vi.mock('../entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
}));

// --- Helpers ---

function getSplitSelectRender(scenes) {
  const paymentDef = scenes.find((s) => s.name === 'payment');
  if (!paymentDef) return null;
  return paymentDef.interrupts && paymentDef.interrupts['split-select'];
}

function getOptionButtons(container) {
  // Option buttons are divs with two child divs (fraction + amount).
  // They're the first 3 sibling-children of the btnRow inside the panel.
  return Array.from(container.querySelectorAll('[data-split-opt]'));
}

// Build a minimal split-select render that attaches a data-attr to each button
// so we can find them without relying on DOM structure.
// The real render uses _buildSplitOption which is a module-local; we can't
// replace it, but we can find the options by iterating divs in the button row.
function getOptionDivs(container) {
  // The btnRow contains 3 children — the 1/2, 1/3, 1/4 options.
  // Each has two text children: fraction label and amount label.
  // We find them by looking for divs whose text includes '$'.
  return Array.from(container.querySelectorAll('div'))
    .filter((el) => el.children.length === 2 &&
      el.children[1] && el.children[1].textContent.startsWith('$'));
}

// --- Tests ---

describe('terminal/scenes/payment — split-select interrupt', () => {
  let splitSelectDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    await import('./payment.js');
    const splitSelect = getSplitSelectRender(registeredScenes);
    expect(splitSelect).toBeDefined();
    splitSelectDef = splitSelect;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mount(remaining, onConfirm, onCancel) {
    const container = document.createElement('div');
    splitSelectDef.render(container, {
      remaining: remaining,
      onConfirm: onConfirm || vi.fn(),
      onCancel:  onCancel  || vi.fn(),
    });
    return container;
  }

  it('renders the correct remaining balance in the sub-line', () => {
    const container = mount(45.00);
    expect(container.textContent).toContain('$45.00');
  });

  it('renders three split options (1/2, 1/3, 1/4)', () => {
    const container = mount(45.00);
    expect(container.textContent).toContain('1/2');
    expect(container.textContent).toContain('1/3');
    expect(container.textContent).toContain('1/4');
  });

  it('1/2 option shows ceil(remaining / 2) amount', () => {
    // 45.00 / 2 = 22.50 exactly
    const container = mount(45.00);
    expect(container.textContent).toContain('$22.50');
  });

  it('1/3 option rounds up to nearest cent', () => {
    // 10.00 / 3 = 3.33… → ceil to $3.34
    const container = mount(10.00);
    expect(container.textContent).toContain('$3.34');
  });

  it('1/4 option shows ceil(remaining / 4)', () => {
    // 45.00 / 4 = 11.25 exactly
    const container = mount(45.00);
    expect(container.textContent).toContain('$11.25');
  });

  it('clicking a split option calls onConfirm with the correct amount', () => {
    const onConfirm = vi.fn();
    const container = mount(45.00, onConfirm);

    // Find option divs and trigger their pointerup.
    const opts = getOptionDivs(container);
    expect(opts.length).toBeGreaterThanOrEqual(1);

    // Trigger the first option (1/2 = $22.50).
    opts[0].dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(22.50);
  });

  it('zero remaining shows $0.00 for all splits (graceful degenerate)', () => {
    const container = mount(0);
    expect(container.textContent).toContain('$0.00');
  });
});
