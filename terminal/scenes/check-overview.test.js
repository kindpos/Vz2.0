// Integration-style tests for the discount flow in check-overview.js.
//
// The scene mounts in jsdom. We drive it through its public surface:
//   1. Render the scene with items pre-selected in state.
//   2. Call handleDiscount via sceneDef.__handlers (DISC has no primary
//      action-bar button anymore — the redesign routes it through the
//      long-press item / seat menus — so tests drive the handler direct).
//   3. Inspect the interrupt chain: disc-pin → disc-select → _applyDiscount.
//
// Tests also pin the UI-007 dead-end guard (no selection → toast, no interrupt).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mocks (hoisted before imports) ---

const registeredScenes = [];

// SceneManager.interrupt is our primary observable. Capture each call so we
// can drive the callback chain manually.
const interruptCalls = [];
const SceneManagerMock = {
  interrupt:              vi.fn((name, params) => { interruptCalls.push({ name, params }); }),
  closeInterrupt:         vi.fn(),
  openTransactional:      vi.fn(),
  closeTransactional:     vi.fn(),
  closeAllTransactional:  vi.fn(),
  mountWorking:           vi.fn(),
  unmountWorking:         vi.fn(),
  getActiveWorking:       vi.fn(() => 'check-overview'),
  getTransactionalStack:  vi.fn(() => []),
  hasInterrupt:           vi.fn(() => false),
  on:                     vi.fn(),
  off:                    vi.fn(),
  emit:                   vi.fn(),
};

vi.mock('../scene-manager.js', () => ({
  SceneManager: SceneManagerMock,
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../theme-manager.js', () => ({
  buildPillButton: ({ label } = {}) => {
    const el = document.createElement('button');
    el.textContent = label || '';
    return el;
  },
  hexToRgba:  (c) => c,
  darkenHex:  (c) => c,
  buildCard:  () => document.createElement('div'),
}));

vi.mock('../sm2-shim.js', () => ({
  hexToRgba:        (c) => c,
  fetchWithTimeout: vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({}),
  })),
}));

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
  buildGap:  () => document.createElement('div'),
  buildButton: (label) => {
    const el = document.createElement('button');
    el.textContent = label;
    return el;
  },
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
    return el;
  },
}));

vi.mock('../order-summary.js', () => ({
  OrderSummary: { show: vi.fn(), hide: vi.fn(), updateSplit: vi.fn() },
}));

vi.mock('../keyboard.js', () => ({
  showKeyboard: vi.fn(),
  hideKeyboard: vi.fn(),
}));

vi.mock('../pricing.js', () => ({
  computeTotals: vi.fn(() => ({ subtotal: 0, tax: 0, total: 0 })),
  getTaxRate:    vi.fn(() => 0.08),
}));

vi.mock('../components/item-recap.js', () => ({
  buildItemRecap:       () => document.createElement('div'),
  buildItemRecapTotals: () => document.createElement('div'),
}));

vi.mock('../entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
}));

vi.mock('../discount.js', () => ({
  computeDiscountAmount: vi.fn((lines, pct) => lines.reduce((s, l) => s + (l.price || 0), 0) * pct / 100),
  extractItemIds:        vi.fn((lines) => lines.map((l) => l.id || 'item-id')),
  buildDiscountBody:     vi.fn((pct, amount, ids, approvedBy) => ({ pct, amount, item_ids: ids, approved_by: approvedBy })),
}));

vi.mock('./transitions.js', () => ({
  buildOrderEntryParams: vi.fn(() => ({})),
}));

vi.mock('./seats.js', () => ({
  seatSubtotal:           vi.fn(() => 0),
  checkSubtotal:          vi.fn(() => 0),
  activeSeatCount:        vi.fn(() => 1),
  layoutModeFor:          vi.fn(() => 'single'),
  orderToSeats:           vi.fn(() => []),
  toggleSeatSelection:    vi.fn((sel) => sel),
  toggleItemSelection:    vi.fn((sel) => sel),
  selectAllUnpaid:        vi.fn(() => ({})),
  collectSelectedItemRefs: vi.fn((selectedItems) => {
    return Object.keys(selectedItems || {}).map((key) => {
      const [seatIdx, itemIdx] = key.split(':').map(Number);
      return { seatIdx, itemIdx };
    });
  }),
}));

vi.mock('./column-editor.js', () => ({}));

// --- Helpers ---

function buildTestState(sceneDef, overrides = {}) {
  const base = JSON.parse(JSON.stringify(sceneDef.state || {}));
  // Provide a minimal seat with one item so _applyDiscount has something to expand.
  base.seats = [{
    id:     'S-001',
    number: 1,
    items:  [{ id: 'it-1', name: 'Pizza', price: 12.00, qty: 1 }],
  }];
  return Object.assign(base, overrides);
}

// --- Tests ---

describe('terminal/scenes/check-overview — discount flow', () => {
  let sceneDef;
  let showToast;
  let fetchWithTimeout;
  let entReport;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    interruptCalls.length = 0;
    SceneManagerMock.interrupt.mockClear();

    const components = await import('../components.js');
    const smShim     = await import('../sm2-shim.js');
    const entomology = await import('../entomology-client.js');
    showToast        = components.showToast;
    fetchWithTimeout = smShim.fetchWithTimeout;
    entReport        = entomology.entReport;

    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
    expect(sceneDef).toBeDefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderScene(stateOverrides = {}) {
    const container = document.createElement('div');
    const state     = buildTestState(sceneDef, stateOverrides);
    sceneDef.render(container, { checkId: 'order-abc' }, state);
    return { container, state };
  }

  // ── UI-007 dead-end guard ───────────────────────────────────────

  it('DISC with nothing selected fires UI-007, shows toast, and opens no interrupt', async () => {
    const { state } = renderScene(); // selectedItems={} by default → reset by render too

    expect(sceneDef.__handlers.handleDiscount).toBeDefined();
    sceneDef.__handlers.handleDiscount(state);

    expect(SceneManagerMock.interrupt).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Select'),
      expect.anything(),
    );
    await Promise.resolve();
    expect(entReport).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UI-007' }),
    );
  });

  // ── disc-pin interrupt opens ────────────────────────────────────

  it('DISC with selected items opens disc-pin interrupt', () => {
    const { state } = renderScene();
    // Both must be set AFTER render: render() resets selectedItems (line 325)
    // and overwrites state.seats via orderToSeats(null,1) (line 335) which
    // the mock returns as [].
    state.seats = [{ id: 'S-001', number: 1, items: [{ id: 'it-1', name: 'Pizza', price: 12, qty: 1 }] }];
    state.selectedItems = { '0:0': true };

    sceneDef.__handlers.handleDiscount(state);

    expect(SceneManagerMock.interrupt).toHaveBeenCalledWith('disc-pin', expect.objectContaining({
      onConfirm: expect.any(Function),
      onCancel:  expect.any(Function),
    }));
  });

  // ── disc-select opens after disc-pin confirms ───────────────────

  it('disc-pin onConfirm triggers disc-select interrupt', () => {
    const { state } = renderScene();
    state.seats = [{ id: 'S-001', number: 1, items: [{ id: 'it-1', name: 'Pizza', price: 12, qty: 1 }] }];
    state.selectedItems = { '0:0': true };

    sceneDef.__handlers.handleDiscount(state);

    const discPinCall = interruptCalls.find((c) => c.name === 'disc-pin');
    expect(discPinCall).toBeDefined();

    // Simulate manager confirming their PIN.
    discPinCall.params.onConfirm('emp-mgr-42');

    const discSelectCall = interruptCalls.find((c) => c.name === 'disc-select');
    expect(discSelectCall).toBeDefined();
    expect(discSelectCall.params.onConfirm).toBeTypeOf('function');
  });

  // ── _applyDiscount fires the correct endpoint ───────────────────

  it('disc-select onConfirm calls fetchWithTimeout on the discount endpoint', async () => {
    const { state } = renderScene();
    state.seats = [{ id: 'S-001', number: 1, items: [{ id: 'it-1', name: 'Pizza', price: 12, qty: 1 }] }];
    state.selectedItems = { '0:0': true };

    sceneDef.__handlers.handleDiscount(state);

    const discPinCall = interruptCalls.find((c) => c.name === 'disc-pin');
    discPinCall.params.onConfirm('emp-mgr-42');

    const discSelectCall = interruptCalls.find((c) => c.name === 'disc-select');
    discSelectCall.params.onConfirm({ pct: 10, label: '10%' });

    await Promise.resolve();

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/orders/order-abc/discount'),
      expect.objectContaining({ method: 'POST' }),
      expect.any(Number),
    );
  });

  // ── cancel paths are no-ops ─────────────────────────────────────

  it('disc-pin cancel does not open disc-select', () => {
    const { state } = renderScene();
    state.seats = [{ id: 'S-001', number: 1, items: [{ id: 'it-1', name: 'Pizza', price: 12, qty: 1 }] }];
    state.selectedItems = { '0:0': true };

    sceneDef.__handlers.handleDiscount(state);

    const discPinCall = interruptCalls.find((c) => c.name === 'disc-pin');
    discPinCall.params.onCancel();

    const discSelectCall = interruptCalls.find((c) => c.name === 'disc-select');
    expect(discSelectCall).toBeUndefined();
    // The initial order-data fetch fires at mount; assert the discount
    // endpoint specifically was NOT reached.
    expect(fetchWithTimeout).not.toHaveBeenCalledWith(
      expect.stringContaining('/discount'),
      expect.anything(),
      expect.anything(),
    );
  });
});
