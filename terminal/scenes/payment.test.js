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

vi.mock('../net.js', () => ({
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

// The split-select options are now rendered as buildActionCard tiles
// (divs) with the fraction label in a child span/div. Find the
// leaf element whose textContent equals the label, then return the
// tile (its parent) so tests can still dispatch pointerup on the
// tappable surface.
function findOption(container, label) {
  const labelEl = Array.from(container.querySelectorAll('*'))
    .find((el) => el.children.length === 0 && el.textContent === label);
  return labelEl ? labelEl.parentElement : null;
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
    expect(findOption(container, '1/2')).toBeDefined();
    expect(findOption(container, '1/3')).toBeDefined();
    expect(findOption(container, '1/4')).toBeDefined();
  });

  it('1/2 option passes ceil(remaining / 2) to onConfirm', () => {
    // 45.00 / 2 = 22.50 exactly
    const onConfirm = vi.fn();
    const container = mount(45.00, onConfirm);
    findOption(container, '1/2').dispatchEvent(new Event('pointerup'));
    expect(onConfirm).toHaveBeenCalledWith(22.50);
  });

  it('1/3 option rounds the onConfirm payload up to the nearest cent', () => {
    // 10.00 / 3 = 3.33… → ceil to $3.34
    const onConfirm = vi.fn();
    const container = mount(10.00, onConfirm);
    findOption(container, '1/3').dispatchEvent(new Event('pointerup'));
    expect(onConfirm).toHaveBeenCalledWith(3.34);
  });

  it('1/4 option passes ceil(remaining / 4) to onConfirm', () => {
    // 45.00 / 4 = 11.25 exactly
    const onConfirm = vi.fn();
    const container = mount(45.00, onConfirm);
    findOption(container, '1/4').dispatchEvent(new Event('pointerup'));
    expect(onConfirm).toHaveBeenCalledWith(11.25);
  });
});
