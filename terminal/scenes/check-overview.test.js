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
  buildWell:       () => document.createElement('div'),
  buildPillButton: ({ label } = {}) => {
    const el = document.createElement('button');
    el.textContent = label || '';
    return el;
  },
  hexToRgba:  (c) => c,
  darkenHex:  (c) => c,
  buildCard:  () => ({
    wrap: document.createElement('div'),
    card: document.createElement('div'),
  }),
  buildStaticCard: () => {
    const el = document.createElement('div');
    el.setAccent = vi.fn();
    return el;
  },
  buildActionCard: ({ onClick } = {}) => {
    const el = document.createElement('div');
    if (onClick) el.addEventListener('pointerup', onClick);
    el.setAccent = vi.fn();
    return el;
  },
}));

vi.mock('../net.js', () => ({
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
  getTaxRate:       vi.fn(() => 0.08),
  getCashDiscount:  vi.fn(() => 0.04),
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
    const netMod     = await import('../net.js');
    const entomology = await import('../entomology-client.js');
    showToast        = components.showToast;
    fetchWithTimeout = netMod.fetchWithTimeout;
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

describe('terminal/scenes/check-overview — persistSeats', () => {
  let sceneDef;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    registeredScenes.length = 0;
    const netMod     = await import('../net.js');
    fetchWithTimeout = netMod.fetchWithTimeout;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  it('does NOT call fetch when orderId is null — empty check leaves no ledger event', async () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: null };
    state.seats = [
      { id: 'S-001', number: 1, items: [] },
      { id: 'S-002', number: 2, items: [] },
    ];
    await sceneDef.__handlers._persistSeats(state);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('PUTs seat layout when orderId is set', async () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-abc' };
    state.seats = [
      { id: 'S-001', number: 1, items: [] },
      { id: 'S-002', number: 2, items: [] },
    ];
    await sceneDef.__handlers._persistSeats(state);
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      '/api/v1/orders/order-abc/seats',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ seat_numbers: [1, 2] }) }),
      expect.any(Number),
    );
  });

  it('addSeat on a brand-new check does not trigger any fetch', async () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: null };
    state.seats  = [{ id: 'S-001', number: 1, items: [] }];
    state.topAreaEl = document.createElement('div');
    await sceneDef.__handlers._addSeat(state);
    expect(state.seats).toHaveLength(2);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug 1 — void-item DELETE timer cancelled on unmount
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — Bug 1: void-item timer cancelled on unmount', () => {
  let sceneDef;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    registeredScenes.length = 0;
    const netMod     = await import('../net.js');
    fetchWithTimeout = netMod.fetchWithTimeout;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('DELETE does not fire after scene unmounts before 4.2 s elapses', async () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-b1' };
    state.seats         = [{ id: 'S-001', number: 1, items: [{ item_id: 'item-1', name: 'Burger', price: 10 }] }];
    state.selectedItems = { '0:0': true };
    state.topAreaEl     = document.createElement('div');

    sceneDef.__handlers.handleVoid(state);

    // Unmount should cancel the pending timer via state._voidTimers
    sceneDef.unmount(state);

    fetchWithTimeout.mockClear();

    vi.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(fetchWithTimeout).not.toHaveBeenCalledWith(
      expect.stringContaining('/items/'),
      expect.objectContaining({ method: 'DELETE' }),
      expect.any(Number),
    );
  });

  it('DELETE fires when scene stays mounted past 4.2 s', async () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-b1' };
    state.seats         = [{ id: 'S-001', number: 1, items: [{ item_id: 'item-1', name: 'Burger', price: 10 }] }];
    state.selectedItems = { '0:0': true };
    state.topAreaEl     = document.createElement('div');

    sceneDef.__handlers.handleVoid(state);

    fetchWithTimeout.mockClear();

    vi.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/items/item-1'),
      expect.objectContaining({ method: 'DELETE' }),
      expect.any(Number),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug 2 — customer-name PATCH shows error on non-2xx
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — Bug 2: customer-name PATCH error handling', () => {
  let sceneDef;
  let showToast;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const components = await import('../components.js');
    const netMod     = await import('../net.js');
    showToast        = components.showToast;
    fetchWithTimeout = netMod.fetchWithTimeout;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error toast when PATCH returns non-2xx', async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 422, json: () => Promise.resolve({}) });

    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-b2' };
    sceneDef.__handlers.openNameEditor(state);

    const nameCall = SceneManagerMock.interrupt.mock.calls
      .slice().reverse()
      .find((c) => c[0] === 'co-name-input');
    expect(nameCall).toBeDefined();
    nameCall[1].onConfirm('New Name');

    await Promise.resolve();
    await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Could not save'),
      expect.anything(),
    );
  });

  it('does not toast on success', async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-b2' };
    sceneDef.__handlers.openNameEditor(state);

    const nameCall = SceneManagerMock.interrupt.mock.calls
      .slice().reverse()
      .find((c) => c[0] === 'co-name-input');
    nameCall[1].onConfirm('Good Name');

    await Promise.resolve();
    await Promise.resolve();

    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining('Could not save'),
      expect.anything(),
    );
    expect(state.customerName).toBe('Good Name');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug 3 — _refreshInFlight per-state not module-scoped
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — Bug 3: _refreshInFlight is per-state', () => {
  let sceneDef;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const netMod     = await import('../net.js');
    fetchWithTimeout = netMod.fetchWithTimeout;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('state._refreshInFlight starts false and becomes true while fetch is pending', async () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-b3' };
    state.topAreaEl = document.createElement('div');

    expect(state._refreshInFlight).toBe(false);

    // Hang the fetch so we can observe in-flight state
    fetchWithTimeout.mockImplementationOnce(() => new Promise(() => {}));
    sceneDef.__handlers.refreshOrder(state, {});

    expect(state._refreshInFlight).toBe(true);
  });

  it('two instances have independent _refreshInFlight flags', async () => {
    const stateA = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-A' };
    const stateB = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-B' };
    stateA.topAreaEl = document.createElement('div');
    stateB.topAreaEl = document.createElement('div');

    // Hang A, complete B
    let resolveA;
    fetchWithTimeout
      .mockImplementationOnce(() => new Promise((res) => { resolveA = res; }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ guest_count: 1, payments: [] }) }));

    sceneDef.__handlers.refreshOrder(stateA, {});
    await sceneDef.__handlers.refreshOrder(stateB, {});

    expect(stateA._refreshInFlight).toBe(true);   // A still pending
    expect(stateB._refreshInFlight).toBe(false);  // B completed independently

    // Resolve A
    resolveA({ ok: true, json: () => Promise.resolve({ guest_count: 1, payments: [] }) });
    await stateA._refreshPromise;
    expect(stateA._refreshInFlight).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug 4 — print/resend in-flight double-tap guard
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — Bug 4: print/resend double-tap guard', () => {
  let sceneDef;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const netMod     = await import('../net.js');
    fetchWithTimeout = netMod.fetchWithTimeout;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handlePrint double-tap fires only one fetch', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-b4' };

    sceneDef.__handlers.handlePrint(state);
    sceneDef.__handlers.handlePrint(state);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/print/receipt'),
      expect.objectContaining({ method: 'POST' }),
      expect.any(Number),
    );
  });

  it('handleResend double-tap fires only one fetch', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-b4' };

    sceneDef.__handlers.handleResend(state);
    sceneDef.__handlers.handleResend(state);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/resend'),
      expect.objectContaining({ method: 'POST' }),
      expect.any(Number),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug 5 — server-picker catch shows distinct error message
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — Bug 5: server-picker error message', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('fetch failure shows distinct error, not the empty-list message', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const container = document.createElement('div');
    sceneDef.interrupts['server-picker'].render(container, {
      excludeId: 'emp-1',
      onConfirm: vi.fn(),
      onCancel:  vi.fn(),
    });

    // Wait for the rejected fetch to propagate through .catch
    await new Promise((res) => setTimeout(res, 0));

    const text = container.textContent;
    expect(text).toContain('Failed');
    expect(text).not.toContain('No other servers clocked in');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Regression locks — selection utilities and refresh deferral
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — selection and refresh regression locks', () => {
  let sceneDef;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const netMod     = await import('../net.js');
    fetchWithTimeout = netMod.fetchWithTimeout;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshOrder defers when _seatsChain is pending — does not drop the refresh', async () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-rc' };
    state.topAreaEl = document.createElement('div');

    let resolveChain;
    state._seatsChain = new Promise((res) => { resolveChain = res; });

    fetchWithTimeout.mockResolvedValue({ ok: true, json: () => Promise.resolve({ guest_count: 1, payments: [] }) });

    const p = sceneDef.__handlers.refreshOrder(state, {});

    // While chain is pending, no fetch should have fired
    expect(fetchWithTimeout).not.toHaveBeenCalled();

    // Simulate persistSeats completing: null the chain before resolving so the
    // re-triggered refreshOrder doesn't recurse back into the deferral path.
    state._seatsChain = null;
    resolveChain();
    await p;

    // After chain resolved, the deferred refresh fires
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/orders/order-rc'),
      expect.anything(),
      expect.any(Number),
    );
  });

  it('toggleSeat on a paid seat is a silent no-op', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)) };
    state.topAreaEl = document.createElement('div');
    state.seats = [
      { id: 'S-001', number: 1, items: [{ name: 'Wine', price: 15 }] },
    ];
    state.paidSeats = { 'S-001': true };
    state.selected  = {};

    sceneDef.__handlers.toggleSeat(state, 'S-001');

    expect(state.selected['S-001']).toBeUndefined();
  });

  it('forceSelectAll skips paid seats', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)) };
    state.topAreaEl = document.createElement('div');
    state.seats = [
      { id: 'S-001', number: 1, items: [{ name: 'Burger', price: 12 }] },
      { id: 'S-002', number: 2, items: [{ name: 'Fries',  price: 5  }] },
    ];
    state.paidSeats = { 'S-002': true };

    sceneDef.__handlers.forceSelectAll(state);

    expect(state.selectedItems['0:0']).toBe(true);  // S-001 item selected
    expect(state.selectedItems['1:0']).toBeUndefined(); // S-002 item skipped (paid)
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Target 1b — openSeatPaymentInterrupt void-payment fetch guard
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — openSeatPaymentInterrupt fetch guard', () => {
  let sceneDef;
  let showToast;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    interruptCalls.length = 0;
    SceneManagerMock.interrupt.mockClear();
    const components = await import('../components.js');
    const netMod     = await import('../net.js');
    showToast        = components.showToast;
    fetchWithTimeout = netMod.fetchWithTimeout;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('shows "Void failed" toast when void POST returns ok:false', async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 422, json: () => Promise.resolve({}) });
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'ord-42' };
    state.paidSeats    = { 'S-001': true };
    state.seatPayments = { 'S-001': [{ id: 'pay-1' }] };

    sceneDef.__handlers.openSeatPaymentInterrupt(state, 'S-001', [{ id: 'pay-1' }]);

    const call = interruptCalls.find((c) => c.name === 'seat-payment');
    expect(call).toBeDefined();
    call.params.onConfirm('pay-1');
    await Promise.resolve(); await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith('Void failed', expect.anything());
    expect(state.paidSeats['S-001']).toBe(true);  // state unchanged on failure
  });

  it('shows "Void failed" toast on network rejection', async () => {
    fetchWithTimeout.mockRejectedValueOnce(new Error('network timeout'));
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'ord-42' };
    state.paidSeats    = { 'S-001': true };
    state.seatPayments = { 'S-001': [{ id: 'pay-1' }] };

    sceneDef.__handlers.openSeatPaymentInterrupt(state, 'S-001', [{ id: 'pay-1' }]);

    const call = interruptCalls.find((c) => c.name === 'seat-payment');
    call.params.onConfirm('pay-1');
    await Promise.resolve(); await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith('Void failed', expect.anything());
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Target 1c — handlePay early-return guards
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — handlePay guards', () => {
  let sceneDef;
  let showToast;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    SceneManagerMock.mountWorking.mockClear();
    const components = await import('../components.js');
    showToast = components.showToast;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('shows toast and does not navigate when orderId is null', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: null };

    sceneDef.__handlers.handlePay(state, {});

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Save items first'),
      expect.anything(),
    );
    expect(SceneManagerMock.mountWorking).not.toHaveBeenCalled();
  });

  it('shows toast and does not navigate when check is already settled', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'ord-1' };
    state.order = { status: 'closed' };

    sceneDef.__handlers.handlePay(state, {});

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Check already settled'),
      expect.anything(),
    );
    expect(SceneManagerMock.mountWorking).not.toHaveBeenCalled();
  });

  it('shows toast and does not navigate when no seats have items', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'ord-1' };
    state.seats = [{ id: 'S-001', number: 1, items: [] }];
    state.paidSeats = {};
    state.selected  = {};

    sceneDef.__handlers.handlePay(state, {});

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('No items to pay'),
      expect.anything(),
    );
    expect(SceneManagerMock.mountWorking).not.toHaveBeenCalled();
  });

  it('shows toast and does not navigate when all selected seats are already paid', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'ord-1' };
    state.seats     = [{ id: 'S-001', number: 1, items: [{ name: 'Wine', price: 15 }] }];
    state.paidSeats = { 'S-001': true };
    state.selected  = { 'S-001': true };  // explicitly selected but already paid

    sceneDef.__handlers.handlePay(state, {});

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('already paid'),
      expect.anything(),
    );
    expect(SceneManagerMock.mountWorking).not.toHaveBeenCalled();
  });
});

// ── Shared MANAGE-mode state factory ───────────────────────────────────────
//
// Used by the six MANAGE-coverage describe blocks below. Each function is
// called directly via sceneDef.__handlers — no DOM render needed except for
// functions that call rerenderTopArea (those need state.topAreaEl set).

function makeManageState(overrides) {
  return Object.assign({
    orderId:       'ord-1',
    order:         { status: 'open' },
    seats: [
      { id: 'S-001', number: 1, items: [{ item_id: 'i-1', name: 'Burger', price: 10, seat_number: 1 }] },
      { id: 'S-002', number: 2, items: [] },
    ],
    selected:      {},
    selectedItems: {},
    paidSeats:     {},
    seatPayments:  {},
    _manageMode:   true,
    _manageLog:    [],
    _manageSnapshot: null,
    _seatsChain:   null,
    _mountParams:  {},
    topAreaEl:     document.createElement('div'),
    _refreshInFlight: false,
    _lpTimers:     [],
  }, overrides);
}

// ═══════════════════════════════════════════════════════════════════
//  MANAGE — _callSplitBySeat
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — _callSplitBySeat', () => {
  let sceneDef;
  let showToast;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const components = await import('../components.js');
    const net        = await import('../net.js');
    showToast        = components.showToast;
    fetchWithTimeout = net.fetchWithTimeout;
    fetchWithTimeout.mockClear();
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('happy path: POSTs to /split-by-seat and toasts child order id', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, child_orders: [{ order_id: 'new-999' }] }),
    });
    const state = makeManageState();

    sceneDef.__handlers._callSplitBySeat(state, [1]);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/split-by-seat'),
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"seats":[1]') }),
      15000,
    );
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('new-999'), expect.anything());
  });

  it('error path: ok:false toasts the detail message', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ detail: 'check is locked' }),
    });
    const state = makeManageState();

    sceneDef.__handlers._callSplitBySeat(state, [1]);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('check is locked'), expect.anything());
  });

  it('no orderId guard: toasts "Save items first", no fetch', () => {
    const state = makeManageState({ orderId: null });

    sceneDef.__handlers._callSplitBySeat(state, [1]);

    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Save items first'), expect.anything());
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MANAGE — persistSeats and persistItemSeats
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — persistSeats / persistItemSeats', () => {
  let sceneDef;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const net = await import('../net.js');
    fetchWithTimeout = net.fetchWithTimeout;
    fetchWithTimeout.mockClear();
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('persistSeats PUTs seat numbers to /seats', async () => {
    const state = makeManageState();

    sceneDef.__handlers._persistSeats(state);
    await Promise.resolve(); await Promise.resolve();

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/seats'),
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"seat_numbers":[1,2]'),
      }),
      15000,
    );
  });

  it('persistSeats does nothing when orderId is null', () => {
    const state = makeManageState({ orderId: null });

    sceneDef.__handlers._persistSeats(state);

    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('persistItemSeats PATCHes each item that has item_id', async () => {
    const state = makeManageState();
    const items = [{ item_id: 'i-1', seat_number: 2 }, { item_id: 'i-2', seat_number: 2 }];

    await sceneDef.__handlers._persistItemSeats(state, items);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(fetchWithTimeout.mock.calls[0][0]).toContain('/items/i-1');
    expect(fetchWithTimeout.mock.calls[1][0]).toContain('/items/i-2');
    expect(fetchWithTimeout.mock.calls[0][1].body).toContain('"seat_number":2');
  });

  it('persistItemSeats skips items without item_id', async () => {
    const state = makeManageState();
    const items = [{ name: 'Draft beer', seat_number: 2 }];  // no item_id

    await sceneDef.__handlers._persistItemSeats(state, items);

    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('persistItemSeats resolves even when a PATCH is rejected', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('network'));
    const state = makeManageState();
    const items = [{ item_id: 'i-1', seat_number: 2 }];

    // Must not throw
    await expect(sceneDef.__handlers._persistItemSeats(state, items)).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MANAGE — _moveItemsToSeat
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — _moveItemsToSeat', () => {
  let sceneDef;
  let showToast;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const components = await import('../components.js');
    showToast = components.showToast;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('moves item from S-001 to S-002: source loses it, target gains it', () => {
    const state = makeManageState();
    const refs = [{ seatIdx: 0, itemIdx: 0 }];

    sceneDef.__handlers._moveItemsToSeat(state, refs, 'S-002');

    expect(state.seats[0].items).toHaveLength(0);
    expect(state.seats[1].items).toHaveLength(1);
    expect(state.seats[1].items[0].seat_number).toBe(2);
    expect(state.selectedItems).toEqual({});
    expect(state.selected).toEqual({});
  });

  it('skipLog: true suppresses the log entry', () => {
    const state = makeManageState();
    const refs = [{ seatIdx: 0, itemIdx: 0 }];

    sceneDef.__handlers._moveItemsToSeat(state, refs, 'S-002', { skipLog: true });

    expect(state._manageLog).toHaveLength(0);
    expect(state.seats[1].items).toHaveLength(1);
  });

  it('moving item to its own seat toasts "Already on" and returns 0', () => {
    const state = makeManageState();
    const refs = [{ seatIdx: 0, itemIdx: 0 }];

    const result = sceneDef.__handlers._moveItemsToSeat(state, refs, 'S-001');

    expect(result).toBe(0);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Already on'), expect.anything());
    expect(state.seats[0].items).toHaveLength(1);  // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════════
//  handleAddItems / _gotoOrderEntry
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — handleAddItems / _gotoOrderEntry', () => {
  let sceneDef;
  let showToast;
  let fetchWithTimeout;
  let entReport;
  let buildOrderEntryParams;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    interruptCalls.length = 0;
    SceneManagerMock.mountWorking.mockClear();

    const components  = await import('../components.js');
    const netMod      = await import('../net.js');
    const entomology  = await import('../entomology-client.js');
    const transitions = await import('./transitions.js');
    showToast          = components.showToast;
    fetchWithTimeout   = netMod.fetchWithTimeout;
    entReport          = entomology.entReport;
    buildOrderEntryParams = transitions.buildOrderEntryParams;

    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  function makeState(overrides = {}) {
    const base = { ...JSON.parse(JSON.stringify(sceneDef.state)), ...overrides };
    base.topAreaEl = document.createElement('div');
    return base;
  }

  it('new check (no orderId): navigates immediately without any fetch', async () => {
    const state = makeState({ orderId: null, order: null });
    await sceneDef.__handlers.handleAddItems(state, {});

    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith(
      'order-entry',
      expect.anything(),
    );
  });

  it('existing check already loaded (state.order set): navigates immediately', async () => {
    const state = makeState({
      orderId: 'ord-xyz',
      order:   { order_id: 'ord-xyz', guest_count: 2, payments: [], seat_numbers: [1, 2] },
    });
    await sceneDef.__handlers.handleAddItems(state, {});

    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith('order-entry', expect.anything());
    // Should not fire a refresh fetch — order data is already present
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('existing check not yet loaded: awaits refreshOrder before navigating', async () => {
    const orderData = { order_id: 'ord-abc', guest_count: 1, payments: [], seat_numbers: [1] };
    fetchWithTimeout.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(orderData),
    });

    // _alive must be true so refreshOrder writes state.order after the fetch
    const state = makeState({ orderId: 'ord-abc', order: null, _alive: true });
    await sceneDef.__handlers.handleAddItems(state, {});

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/orders/ord-abc'),
      expect.anything(),
      expect.any(Number),
    );
    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith('order-entry', expect.anything());
  });

  it('refresh fails (order still null after await): blocks navigation, fires UI-005', async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 500 });

    const state = makeState({ orderId: 'ord-fail', order: null });
    await sceneDef.__handlers.handleAddItems(state, {});

    expect(SceneManagerMock.mountWorking).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(entReport).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UI-005' }),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('load check'),
      expect.objectContaining({ bg: expect.anything() }),
    );
  });

  it('passes seat layout from state into buildOrderEntryParams', async () => {
    const state = makeState({
      orderId: null,
      order:   null,
      seats:   [{ id: 'S-001', number: 1, items: [] }, { id: 'S-002', number: 2, items: [] }],
      selected: { 'S-001': true },
    });
    await sceneDef.__handlers.handleAddItems(state, {});

    expect(buildOrderEntryParams).toHaveBeenCalledWith(state, expect.anything());
  });
});

// ═══════════════════════════════════════════════════════════════════
//  renderSeatsGrid — Mode A vs Mode B
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — renderSeatsGrid Mode A / Mode B', () => {
  let sceneDef;
  let activeSeatCount;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const seatsMod  = await import('./seats.js');
    activeSeatCount = seatsMod.activeSeatCount;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  function makeGridState(numSeats) {
    const seats = Array.from({ length: numSeats }, (_, i) => ({
      id:     'S-' + String(i + 1).padStart(3, '0'),
      number: i + 1,
      items:  [],
    }));
    return {
      ...JSON.parse(JSON.stringify(sceneDef.state)),
      seats,
      paidSeats:     {},
      selected:      {},
      selectedItems: {},
      _tileSelSet:   new Set(),
      seatEls:       {},
      _lpTimers:     [],
    };
  }

  it('Mode B renders a 300 px right-column tiles grid', () => {
    activeSeatCount.mockReturnValue(5);
    const state     = makeGridState(5);
    const container = document.createElement('div');

    sceneDef.__handlers.renderSeatsGrid(state, container, 'B');

    // Right column: 300px wide grid
    const tilesCol = Array.from(container.children)
      .find((el) => el.style.width === '300px');
    expect(tilesCol).toBeDefined();
    expect(tilesCol.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
  });

  it('Mode B renders exactly two columns (recap + tiles)', () => {
    activeSeatCount.mockReturnValue(5);
    const state     = makeGridState(5);
    const container = document.createElement('div');

    sceneDef.__handlers.renderSeatsGrid(state, container, 'B');

    // Mode B appends exactly recapCol then tilesCol and returns
    expect(container.children.length).toBe(2);
    // First child is the recap column (no fixed width)
    expect(container.children[0].style.width).not.toBe('300px');
    // Second child is the tiles column (300px)
    expect(container.children[1].style.width).toBe('300px');
  });

  it('Mode A renders one element per seat plus the +SEAT add tile', () => {
    activeSeatCount.mockReturnValue(2);
    const state     = makeGridState(2);
    const container = document.createElement('div');

    sceneDef.__handlers.renderSeatsGrid(state, container, 'A');

    // No 300px tilesCol in Mode A
    const tilesCol = Array.from(container.children).find((el) => el.style.width === '300px');
    expect(tilesCol).toBeUndefined();
    // 2 seat cards + 1 add tile = 3 children
    expect(container.children.length).toBe(state.seats.length + 1);
  });

  it('Mode B places one compact tile per seat in the tiles grid', () => {
    activeSeatCount.mockReturnValue(5);
    const state     = makeGridState(5);
    const container = document.createElement('div');

    sceneDef.__handlers.renderSeatsGrid(state, container, 'B');

    const tilesCol = Array.from(container.children).find((el) => el.style.width === '300px');
    // tilesCol children: ALL SEATS btn + +SEAT tile + 5 seat tiles
    expect(tilesCol.children.length).toBe(5 + 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  deleteSeat guards
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — deleteSeat guards', () => {
  let sceneDef;
  let showToast;
  let fetchWithTimeout;
  let entReport;
  let activeSeatCount;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const components = await import('../components.js');
    const netMod     = await import('../net.js');
    const entomology = await import('../entomology-client.js');
    const seatsMod   = await import('./seats.js');
    showToast        = components.showToast;
    fetchWithTimeout = netMod.fetchWithTimeout;
    entReport        = entomology.entReport;
    activeSeatCount  = seatsMod.activeSeatCount;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  function makeState(overrides = {}) {
    const base = {
      ...JSON.parse(JSON.stringify(sceneDef.state)),
      seats: [
        { id: 'S-001', number: 1, items: [] },
        { id: 'S-002', number: 2, items: [] },
      ],
      paidSeats:     {},
      selected:      {},
      selectedItems: {},
      topAreaEl:     document.createElement('div'),
      seatEls:       {},
      _lpTimers:     [],
    };
    return Object.assign(base, overrides);
  }

  it('blocks delete of a paid seat and fires UI-007', async () => {
    const state = makeState({ paidSeats: { 'S-001': true } });
    activeSeatCount.mockReturnValue(2);

    sceneDef.__handlers.deleteSeat(state, 'S-001');

    expect(state.seats).toHaveLength(2);  // unchanged
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('paid seat'),
      expect.anything(),
    );
    await Promise.resolve();
    expect(entReport).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UI-007' }),
    );
  });

  it('blocks delete of a seat that still has items', () => {
    const state = makeState();
    state.seats[0].items = [{ item_id: 'i1', name: 'Burger', price: 10 }];
    activeSeatCount.mockReturnValue(2);

    sceneDef.__handlers.deleteSeat(state, 'S-001');

    expect(state.seats).toHaveLength(2);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('items'),
      expect.anything(),
    );
  });

  it('blocks delete when it is the only remaining seat', () => {
    const state = makeState({ seats: [{ id: 'S-001', number: 1, items: [] }] });
    activeSeatCount.mockReturnValue(1);

    sceneDef.__handlers.deleteSeat(state, 'S-001');

    expect(state.seats).toHaveLength(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('only seat'),
      expect.anything(),
    );
  });

  it('removes seat from state.seats on valid delete', () => {
    const state = makeState();
    activeSeatCount.mockReturnValue(2);

    sceneDef.__handlers.deleteSeat(state, 'S-001');

    expect(state.seats).toHaveLength(1);
    expect(state.seats[0].id).toBe('S-002');
  });

  it('removes deleted seat from state.selected', () => {
    const state = makeState({ selected: { 'S-001': true } });
    activeSeatCount.mockReturnValue(2);

    sceneDef.__handlers.deleteSeat(state, 'S-001');

    expect(state.selected['S-001']).toBeUndefined();
  });

  it('calls persistSeats to sync backend after valid delete', async () => {
    const state = makeState({ orderId: 'ord-del' });
    activeSeatCount.mockReturnValue(2);

    sceneDef.__handlers.deleteSeat(state, 'S-001');
    await Promise.resolve();

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/orders/ord-del/seats'),
      expect.objectContaining({ method: 'PUT' }),
      expect.any(Number),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
//  toggleItem / getSelectedSeatIds / getSelectedItemRefs
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — selection helpers', () => {
  let sceneDef;
  let toggleItemSelection;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    const seatsMod      = await import('./seats.js');
    toggleItemSelection = seatsMod.toggleItemSelection;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  function makeState(overrides = {}) {
    return {
      ...JSON.parse(JSON.stringify(sceneDef.state)),
      seats: [
        { id: 'S-001', number: 1, items: [{ item_id: 'i1', name: 'Burger', price: 10 }] },
        { id: 'S-002', number: 2, items: [{ item_id: 'i2', name: 'Fries',  price:  5 }] },
      ],
      paidSeats:     {},
      selected:      {},
      selectedItems: {},
      topAreaEl:     document.createElement('div'),
      seatEls:       {},
      _lpTimers:     [],
      ...overrides,
    };
  }

  it('toggleItem delegates to toggleItemSelection with correct seat/item indices', () => {
    const state = makeState();
    // toggleItemSelection receives the CURRENT selectedItems (empty {}), not the result.
    // The return value is assigned back to state.selectedItems.
    toggleItemSelection.mockReturnValue({ '0:0': true });

    sceneDef.__handlers.toggleItem(state, 0, 0);

    expect(toggleItemSelection).toHaveBeenCalledWith({}, 0, 0);
    expect(state.selectedItems).toEqual({ '0:0': true });
  });

  it('getSelectedSeatIds returns keys of state.selected', () => {
    const state = makeState({ selected: { 'S-001': true, 'S-002': true } });
    const ids = sceneDef.__handlers.getSelectedSeatIds(state);
    expect(ids).toEqual(expect.arrayContaining(['S-001', 'S-002']));
    expect(ids).toHaveLength(2);
  });

  it('getSelectedSeatIds returns empty array when nothing selected', () => {
    const state = makeState({ selected: {} });
    expect(sceneDef.__handlers.getSelectedSeatIds(state)).toEqual([]);
  });

  it('getSelectedItemRefs delegates to collectSelectedItemRefs with state.selectedItems', () => {
    const state = makeState({ selectedItems: { '0:0': true, '1:0': true } });
    const refs = sceneDef.__handlers.getSelectedItemRefs(state);
    expect(refs).toEqual(expect.arrayContaining([
      { seatIdx: 0, itemIdx: 0 },
      { seatIdx: 1, itemIdx: 0 },
    ]));
  });

  it('getSelectedItemRefs returns empty array when no items selected', () => {
    const state = makeState({ selectedItems: {} });
    expect(sceneDef.__handlers.getSelectedItemRefs(state)).toEqual([]);
  });
});

