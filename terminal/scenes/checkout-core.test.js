// Tests for the co-void-confirm interrupt in terminal/scenes/checkout-core.js.
// The interrupt was previously unregistered — both server-checkout.js and
// close-day-checks-viewer.js called SceneManager.interrupt('co-void-confirm', ...)
// and got a silent console.error + no-op because the scene didn't exist.
//
// These tests pin: heading copy (singular/plural), the reason-gate on the VOID
// button, correct reason forwarding to onConfirm, and the cancel path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mocks (vi.mock is hoisted; these run before any import) ---

const registeredScenes = [];

vi.mock('../scene-manager.js', () => ({
  SceneManager: {
    interrupt:          vi.fn(),
    closeInterrupt:     vi.fn(),
    openTransactional:  vi.fn(),
    closeTransactional: vi.fn(),
    mountWorking:       vi.fn(),
    closeTransactional: vi.fn(),
    hasInterrupt:       vi.fn(() => false),
    on:                 vi.fn(),
    off:                vi.fn(),
    emit:               vi.fn(),
  },
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../sm2-shim.js', () => ({
  hexToRgba:        (color, _alpha) => color,
  chamfer:          () => '',
  buildStyledButton: () => {
    const el = document.createElement('button');
    return { wrap: el, inner: el };
  },
  applySunkenStyle: () => {},
  fetchWithTimeout: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));

vi.mock('../components.js', () => ({
  buildButton: (label, opts) => {
    const el = document.createElement('button');
    el.textContent = label;
    // Store handler for direct invocation in tests (jsdom lacks PointerEvent).
    el._onTap = opts && opts.onTap ? opts.onTap : null;
    return el;
  },
  buildGap:  () => document.createElement('div'),
  showToast: vi.fn(),
}));

vi.mock('../app.js', () => ({
}));

vi.mock('../numpad.js', () => ({
  buildNumpad: () => document.createElement('div'),
}));

vi.mock('../theme-manager.js', () => ({
  buildCard:       () => document.createElement('div'),
  buildPillButton: ({ label } = {}) => {
    const el = document.createElement('button');
    el.textContent = label || '';
    return el;
  },
  hexToRgba:  (c) => c,
  darkenHex:  (c) => c,
}));

vi.mock('../entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
}));

// --- Helpers ---

function triggerPointerUp(el) {
  if (el._onTap) el._onTap();
}

// --- Tests ---

describe('terminal/scenes/checkout-core — co-void-confirm interrupt', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    await import('./checkout-core.js');
    sceneDef = registeredScenes.find((s) => s.name === 'co-void-confirm');
    expect(sceneDef).toBeDefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mount(checks, onConfirm, onCancel) {
    const container = document.createElement('div');
    sceneDef.render(container, {
      checks:    checks,
      onConfirm: onConfirm || vi.fn(),
      onCancel:  onCancel  || vi.fn(),
    });
    return container;
  }

  it('renders "// VOID CHECK //" heading for a single check', () => {
    const container = mount([{ checkId: 'c1' }]);
    expect(container.textContent).toContain('// VOID CHECK //');
    expect(container.textContent).not.toContain('// VOID 1');
  });

  it('renders "// VOID N CHECKS //" heading for multiple checks', () => {
    const container = mount([{ checkId: 'c1' }, { checkId: 'c2' }, { checkId: 'c3' }]);
    expect(container.textContent).toContain('// VOID 3 CHECKS //');
  });

  it('VOID button starts disabled (opacity 0.35, pointer-events none)', () => {
    const container = mount([{ checkId: 'c1' }]);
    const voidBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'VOID');
    expect(voidBtn).toBeDefined();
    expect(voidBtn.style.opacity).toBe('0.35');
    expect(voidBtn.style.pointerEvents).toBe('none');
  });

  it('VOID button becomes enabled once a non-empty reason is typed', () => {
    const container = mount([{ checkId: 'c1' }]);
    const input   = container.querySelector('input');
    const voidBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'VOID');

    input.value = 'Manager comp';
    input.dispatchEvent(new Event('input'));

    expect(voidBtn.style.opacity).toBe('1');
    expect(voidBtn.style.pointerEvents).toBe('auto');
  });

  it('VOID button reverts to disabled when reason is cleared', () => {
    const container = mount([{ checkId: 'c1' }]);
    const input   = container.querySelector('input');
    const voidBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'VOID');

    input.value = 'some reason';
    input.dispatchEvent(new Event('input'));
    expect(voidBtn.style.opacity).toBe('1');

    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    expect(voidBtn.style.opacity).toBe('0.35');
  });

  it('onConfirm is called with the trimmed reason when VOID is tapped', () => {
    const onConfirm = vi.fn();
    const container = mount([{ checkId: 'c1' }], onConfirm);
    const input   = container.querySelector('input');
    const voidBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'VOID');

    input.value = '  kitchen error  ';
    input.dispatchEvent(new Event('input'));
    triggerPointerUp(voidBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('kitchen error');
  });

  it('onConfirm is NOT called when reason is empty and VOID is tapped', () => {
    const onConfirm = vi.fn();
    const container = mount([{ checkId: 'c1' }], onConfirm);
    const voidBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'VOID');

    triggerPointerUp(voidBtn);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('CANCEL button calls onCancel', () => {
    const onCancel = vi.fn();
    const container = mount([{ checkId: 'c1' }], undefined, onCancel);
    const cancelBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'CANCEL');

    triggerPointerUp(cancelBtn);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
