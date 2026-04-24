// Tests for the co-void-confirm interrupt in terminal/scenes/checkout-core.js.
// The interrupt was previously unregistered — both server-checkout.js and
// close-day-checks-viewer.js called SceneManager.interrupt('co-void-confirm', ...)
// and got a silent console.error + no-op because the scene didn't exist.
//
// These tests pin: heading copy + count summary, the reason-gate on the VOID
// button (now driven by radio-row selection, not free text), correct reason
// forwarding to onConfirm, and the cancel path.

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
  buildCard: () => {
    const wrap = document.createElement('div');
    const card = document.createElement('div');
    wrap.appendChild(card);
    return { wrap: wrap, card: card };
  },
  buildStaticCard: () => document.createElement('div'),
  buildPillButton: ({ label } = {}) => {
    const el = document.createElement('button');
    el.textContent = label || '';
    el.setColor = () => {};
    el.setDisabled = () => {};
    return el;
  },
  hexToRgba:  (c) => c,
  darkenHex:  (c) => c,
  lightenHex: (c) => c,
}));

vi.mock('../entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
}));

// --- Helpers ---

function triggerPointerUp(el) {
  el.dispatchEvent(new Event('pointerup'));
}

// The panel is built from <div>s styled as buttons/radios. Find one by its
// visible text content.
function findByText(container, text) {
  return Array.from(container.querySelectorAll('div, button'))
    .find((el) => el.textContent === text);
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

  it('renders the "VOID CHECK" title and a "voiding 1 check" summary for a single check', () => {
    const container = mount([{ checkId: 'c1' }]);
    expect(container.textContent).toContain('VOID CHECK');
    expect(container.textContent).toContain('voiding 1 check');
    expect(container.textContent).not.toContain('voiding 1 checks');
  });

  it('renders a "voiding N checks" summary for multiple checks', () => {
    const container = mount([{ checkId: 'c1' }, { checkId: 'c2' }, { checkId: 'c3' }]);
    expect(container.textContent).toContain('VOID CHECK');
    expect(container.textContent).toContain('voiding 3 checks');
  });

  it('VOID button starts disabled (cursor:not-allowed) until a reason is chosen', () => {
    const container = mount([{ checkId: 'c1' }]);
    const voidBtn = findByText(container, 'VOID');
    expect(voidBtn).toBeDefined();
    expect(voidBtn.style.cursor).toBe('not-allowed');
  });

  it('VOID button becomes enabled once a reason row is tapped', () => {
    const container = mount([{ checkId: 'c1' }]);
    const voidBtn = findByText(container, 'VOID');

    triggerPointerUp(findByText(container, 'Duplicate order'));

    expect(voidBtn.style.cursor).toBe('pointer');
  });

  it('onConfirm is called with the chosen reason when VOID is tapped', () => {
    const onConfirm = vi.fn();
    const container = mount([{ checkId: 'c1' }], onConfirm);

    triggerPointerUp(findByText(container, 'Wrong order'));
    triggerPointerUp(findByText(container, 'VOID'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Wrong order');
  });

  it('onConfirm is NOT called when no reason is selected and VOID is tapped', () => {
    const onConfirm = vi.fn();
    const container = mount([{ checkId: 'c1' }], onConfirm);

    triggerPointerUp(findByText(container, 'VOID'));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('CANCEL button calls onCancel', () => {
    const onCancel = vi.fn();
    const container = mount([{ checkId: 'c1' }], undefined, onCancel);

    triggerPointerUp(findByText(container, 'CANCEL'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
