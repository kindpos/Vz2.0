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

describe('terminal/scenes/check-overview — split flow', () => {
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

  it('split $10.00 item 3 ways produces $3.34, $3.33, $3.33', async () => {
    const state = JSON.parse(JSON.stringify(sceneDef.state));
    state.topAreaEl = document.createElement('div');
    state.orderId = 'order-123';
    state.seats = [
      { id: 'S-001', number: 1, items: [{ item_id: 'it-1', name: 'Steak', price: 10.00, menu_item_id: 'steak' }] },
      { id: 'S-002', number: 2, items: [] },
      { id: 'S-003', number: 3, items: [] }
    ];
    state.selected = { 'S-001': true, 'S-002': true, 'S-003': true };
    state.selectedItems = { '0:0': true };

    await sceneDef.__handlers._commitManageSplit(state);

    expect(state.seats[0].items[0].price).toBe(3.34);
    expect(state.seats[1].items[0].price).toBe(3.33);
    expect(state.seats[2].items[0].price).toBe(3.33);
    
    // Verify persistence
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/orders/order-123/items'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"price":3.34')
      }),
      expect.any(Number)
    );
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/orders/order-123/items/it-1'),
      expect.objectContaining({ method: 'DELETE' }),
      expect.any(Number)
    );
  });

  it('rolls back local state on POST failure', async () => {
    fetchWithTimeout.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }));

    const state = JSON.parse(JSON.stringify(sceneDef.state));
    state.topAreaEl = document.createElement('div');
    state.orderId = 'order-123';
    state.seats = [
      { id: 'S-001', number: 1, items: [{ item_id: 'it-1', name: 'Steak', price: 10.00 }] },
      { id: 'S-002', number: 2, items: [] }
    ];
    state.selected = { 'S-001': true, 'S-002': true };
    state.selectedItems = { '0:0': true };

    const originalSeatsJson = JSON.stringify(state.seats);

    await sceneDef.__handlers._commitManageSplit(state);

    expect(JSON.stringify(state.seats)).toBe(originalSeatsJson);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.objectContaining({ bg: expect.anything() }));
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

    // Unmount should cancel the pending timer via state._lpTimers
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
//  Bug 6 — UNDO on merge-new-check does not loop
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — Bug 6: UNDO merge-new-check no infinite loop', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('UNDO on merge-new-check-seats toasts twice with log length unchanged', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)) };
    state.topAreaEl = document.createElement('div');
    state._manageLog = [{ kind: 'merge-new-check-seats', targetCheckId: 'chk-2' }];

    sceneDef.__handlers._undoManage(state);
    sceneDef.__handlers._undoManage(state);

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(state._manageLog).toHaveLength(1);
  });

  it('UNDO on merge-new-check-items toasts and log stays at length 1', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)) };
    state.topAreaEl = document.createElement('div');
    state._manageLog = [{ kind: 'merge-new-check-items', targetCheckId: 'chk-2' }];

    sceneDef.__handlers._undoManage(state);
    sceneDef.__handlers._undoManage(state);
    sceneDef.__handlers._undoManage(state);

    expect(showToast).toHaveBeenCalledTimes(3);
    expect(state._manageLog).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug 7 — _syncSelectedFromItems called after UNDO clears selection
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — Bug 7: selection cleared correctly after UNDO', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    await import('./check-overview.js');
    sceneDef = registeredScenes.find((s) => s.name === 'check-overview');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('after undoing a move, state.selected has no stale seat selections', () => {
    const item = { item_id: 'it-1', name: 'Pizza', price: 10 };
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)) };
    state.topAreaEl = document.createElement('div');
    state.seats = [
      { id: 'S-001', number: 1, items: [] },   // item will be moved back here
      { id: 'S-002', number: 2, items: [item] },
    ];
    // Simulate: item was at S-001 idx 0, moved to S-002 idx 0
    state._manageLog = [{
      kind:         'move',
      targetSeatId: 'S-002',
      patches:      [{ fromSeatId: 'S-001', fromItemIdx: 0, item: item }],
    }];
    // Pre-undo selection reflects item at S-002
    state.selected      = { 'S-002': true };
    state.selectedItems = { '1:0': true };

    sceneDef.__handlers._undoManage(state);

    // After undo, item is back at S-001 and selection must be cleared — no stale S-002
    expect(state.selected['S-002']).toBeUndefined();
    expect(state.selected['S-001']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Regression locks — MANAGE mode lifecycle
// ═══════════════════════════════════════════════════════════════════

describe('terminal/scenes/check-overview — MANAGE mode lifecycle (regression locks)', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enterManageMode captures snapshot and sets _manageMode = true', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-mg' };
    state.topAreaEl = document.createElement('div');
    state.seats = [{ id: 'S-001', number: 1, items: [{ name: 'Pasta', price: 8 }] }];
    state.selected = { 'S-001': true };

    sceneDef.__handlers.enterManageMode(state);

    expect(state._manageMode).toBe(true);
    expect(state._manageTool).toBe('move');
    expect(state._manageLog).toHaveLength(0);
    expect(state._manageSnapshot).toBeDefined();
    expect(state._manageSnapshot.seats).toHaveLength(1);
  });

  it('exitManageMode clears _manageLog, _manageTool, _manageMode, _manageSnapshot', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)), orderId: 'order-mg' };
    state.topAreaEl = document.createElement('div');
    state._manageMode    = true;
    state._manageTool    = 'merge';
    state._manageLog     = [{ kind: 'move', targetSeatId: 'S-002', patches: [] }];
    state._manageSnapshot = { seats: [], paidSeats: {}, selected: {}, selectedItems: {} };

    sceneDef.__handlers.exitManageMode(state);

    expect(state._manageMode).toBe(false);
    expect(state._manageTool).toBe('move');
    expect(state._manageLog).toHaveLength(0);
    expect(state._manageSnapshot).toBeNull();
  });

  it('UNDO with empty log shows nothing-to-undo toast, no crash', () => {
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)) };
    state.topAreaEl = document.createElement('div');
    state._manageLog = [];

    expect(() => sceneDef.__handlers._undoManage(state)).not.toThrow();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Nothing to undo'),
      expect.anything(),
    );
  });

  it('RESET restores seats to _manageSnapshot state', () => {
    const original = [{ id: 'S-001', number: 1, items: [{ name: 'Steak', price: 20 }] }];
    const state = { ...JSON.parse(JSON.stringify(sceneDef.state)) };
    state.topAreaEl = document.createElement('div');
    state.seats = [{ id: 'S-001', number: 1, items: [] }]; // post-move: items emptied
    state._manageSnapshot = {
      seats:         JSON.parse(JSON.stringify(original)),
      paidSeats:     {},
      selected:      {},
      selectedItems: {},
    };

    sceneDef.__handlers._resetManageSession(state);

    expect(state.seats[0].items).toHaveLength(1);
    expect(state.seats[0].items[0].name).toBe('Steak');
    expect(state._manageLog).toHaveLength(0);
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
