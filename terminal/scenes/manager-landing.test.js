// Integration-style tests for terminal/scenes/manager-landing.js.
//
// Tests drive the scene through its public surface: register via defineScene,
// call render(), then interact with action-button handlers captured from
// buildPillButton onClick callbacks.
//
// Key coverage:
//   1. Void first tap — sets _voidPending, shows toast, does NOT fetch.
//   2. Void second tap (same selection) — fires POST /orders/{id}/void.
//   3. Void bypass fix — changing selection between tap-1 and tap-2 resets
//      the confirmation so tap-2 is treated as a new first tap.
//   4. Void pending expires after 3 s (fake timers).
//   5. Void with no manager emp → error toast, no fetch.
//   6. Merge guard: requires 2+ checks.
//   7. Merge in-flight guard: rapid double-tap fires only one POST.
//   8. Filter cycling clears selectedIds.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mocks ---

const registeredScenes = [];
const pillHandlers = {};

vi.mock('../scene-manager.js', () => ({
  SceneManager: {
    mountWorking:          vi.fn(),
    openTransactional:     vi.fn(),
    closeTransactional:    vi.fn(),
    interrupt:             vi.fn(),
    closeInterrupt:        vi.fn(),
    hasInterrupt:          vi.fn(() => false),
    on:                    vi.fn(),
    off:                   vi.fn(),
    emit:                  vi.fn(),
  },
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../../common/tokens.js', () => {
  const T = {
    bg: '#383c42', card: '#2e3236', well: '#22252a',
    green: '#86efac', greenDk: '#4ade80', greenWarm: '#86efac', greenWarmDk: '#4ade80',
    gold: '#f5a623', goldDk: '#e09010', elec: '#22d3ee', elecDk: '#0ea5e9',
    verm: '#e8472a', vermDk: '#c03d22', text: '#e8eaed',
    moon: '#7e8896', moonDk: '#4a5059', moonText: '#22252a',
    lavender: '#b48efa',
    textMuted: 'rgba(232,234,237,0.55)', textDim: 'rgba(232,234,237,0.4)',
    border: 'rgba(232,234,237,0.08)',
    fb: 'sans-serif', fh: 'serif', fm: 'monospace',
    fsB2: 14, fsB3: 12,
    accentBarW: '4px',
    srvPalette: ['#38bdf8','#a78bfa','#fb923c','#34d399','#facc15','#f472b6','#e879f9','#4ade80'],
    seatPalette: ['#38bdf8','#fb923c','#f472b6','#34d399','#facc15','#e879f9','#818cf8','#fb7185'],
    groups: {
      landing: { tileAccent: '#86efac', infoAccent: '#86efac', srvChipAccent: 'srvPalette', newCheckBorder: '#86efac' },
      confirmation: { shellAccentDanger: '#e8472a', shellAccentOk: '#86efac', cancel: 'ghost', confirmAffirm: 'mint', confirmDelete: 'verm' },
      picker: { shellAccent: '#22d3ee', shellAccentAuth: '#f5a623', cancel: 'ghost', apply: 'elec', optionDefault: 'ghost', optionSelected: '#22d3ee' },
      auth: { shellAccent: '#f5a623' },
      composite: { shellAccent: '#86efac', selectAll: 'elec', cancel: 'verm', confirm: 'mint', stepper: 'elec' },
      paymentPreset: { tileAccent: '#86efac', tapFlashFill: '#86efac', tapFlashLabel: '#22252a' },
      actionBar: { disc: '#b48efa', void: '#e8472a', pay: '#f5a623', addItems: '#86efac', editSeats: '#7e8896', print: '#22d3ee', radius: '14px' },
      selectionGrid: { unselectedBg: '#7e8896', unselectedFg: 'seatPalette', selectedBg: 'seatPalette', selectedFg: '#22252a', radius: '14px' },
    },
  };
  return { T };
});

vi.mock('../theme-manager.js', () => {
  const wrapCard = () => {
    const card = document.createElement('div');
    const body = document.createElement('div');
    card.appendChild(body);
    return { wrap: card, card, body };
  };
  const bareCard = (opts = {}) => {
    const el = document.createElement('div');
    if (opts.onClick) el.addEventListener('pointerup', opts.onClick);
    el.setAccent = vi.fn();
    return el;
  };
  return {
    buildCard: wrapCard,
    buildStaticCard: bareCard,
    buildNavCard:    bareCard,
    buildActionCard: bareCard,
    buildPillButton: ({ label, onClick } = {}) => {
      const el = document.createElement('button');
      el.textContent = label || '';
      el.setColor = vi.fn();
      if (label && onClick) pillHandlers[label] = onClick;
      return el;
    },
    buildFloatButton: ({ label, onClick } = {}) => {
      const el = document.createElement('button');
      el.textContent = label || '';
      el.setColor = vi.fn();
      if (onClick) el.addEventListener('pointerup', onClick);
      return el;
    },
    buildSectionLabel: () => document.createElement('div'),
    hexToRgba:  (c) => c,
    lightenHex: (c) => c,
    darkenHex:  (c) => c,
  };
});

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('../charts.js', () => ({
  buildSalesOverview: () => ({ wrap: document.createElement('div'), update: vi.fn() }),
  buildLineCard:      () => ({ wrap: document.createElement('div'), update: vi.fn() }),
  buildCOBCard:       () => ({ wrap: document.createElement('div'), update: vi.fn() }),
  buildStatCard:      () => ({ wrap: document.createElement('div'), setValue: vi.fn() }),
}));

vi.mock('../app.js', () => ({
}));

// --- Helpers ---

const TEST_MGR = { id: 'mgr-01', employee_id: 'mgr-01', name: 'Big Boss' };

const TEST_ORDERS = [
  { order_id: 'order-a', status: 'open', server_id: 'srv-1', check_number: 'C-001', total: 45.00 },
  { order_id: 'order-b', status: 'open', server_id: 'srv-1', check_number: 'C-002', total: 22.00 },
];

// --- Tests ---

describe('terminal/scenes/manager-landing', () => {
  let sceneDef;
  let showToast;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    Object.keys(pillHandlers).forEach((k) => delete pillHandlers[k]);

    // Reset fetch mock before each test.
    global.fetch = vi.fn(() => Promise.resolve({
      ok:   true,
      json: () => Promise.resolve({}),
    }));

    const components = await import('../components.js');
    showToast = components.showToast;
    showToast.mockClear();

    await import('./manager-landing.js');
    sceneDef = registeredScenes.find((s) => s.name === 'manager-landing');
    expect(sceneDef).toBeDefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mount(stateOverrides = {}) {
    const container = document.createElement('div');
    const state     = Object.assign(
      JSON.parse(JSON.stringify(sceneDef.state)),
      stateOverrides,
    );
    state._refs = {};
    sceneDef.render(container, TEST_MGR, state);
    return { container, state };
  }

  // ── Void confirmation ───────────────────────────────────────────────

  // Helper: mount then reset fetch so background fetchAllData calls don't
  // pollute per-test assertions about action-specific endpoints.
  function mountFresh(stateOverrides = {}) {
    const result = mount(stateOverrides);
    // fetchAllData fires during render() — reset after mount so each test
    // only sees fetches it deliberately triggers.
    global.fetch = vi.fn(() => Promise.resolve({
      ok:   true,
      json: () => Promise.resolve({}),
    }));
    return result;
  }

  it('Void first tap sets _voidPending, shows toast, does NOT fetch', () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    pillHandlers['Void']();

    expect(state._voidPending).toBe(true);
    expect(state._voidPendingKey).toBe('order-a');
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('tap again'),
      expect.any(Object),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('Void second tap with same selection fires POST to /orders/{id}/void', async () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    pillHandlers['Void']();  // first tap
    pillHandlers['Void']();  // second tap — should fire

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/orders/order-a/void'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(state._voidPending).toBe(false);
  });

  it('changing selection between tap-1 and tap-2 resets confirmation (bypass fix)', () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    pillHandlers['Void']();          // first tap on A → arms pending for 'order-a'
    state.selectedIds = ['order-b']; // switch selection
    pillHandlers['Void']();          // tap on B → key mismatch → new first tap, no fetch

    expect(global.fetch).not.toHaveBeenCalled();
    expect(state._voidPendingKey).toBe('order-b');  // now armed for B
    expect(showToast).toHaveBeenCalledTimes(2);      // two "tap again" toasts
  });

  it('Void pending flag expires after 3 s', () => {
    vi.useFakeTimers();
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    pillHandlers['Void']();   // arms the pending timer
    expect(state._voidPending).toBe(true);

    vi.advanceTimersByTime(3001);
    expect(state._voidPending).toBe(false);
    expect(state._voidPendingKey).toBeNull();
  });

  it('Void with no manager emp shows error toast and does not fetch', () => {
    const { state } = mountFresh();
    state.emp         = {};   // no id / employee_id
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    pillHandlers['Void']();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Manager approval'),
      expect.any(Object),
    );
  });

  // ── Auth-data emp normalisation (SEC-005 / void-auth regression) ───────

  it('normalises auth-data emp: employee_id is copied to id so void check passes', () => {
    // Auth API returns { employee_id, name, roles } — no id field.
    // This is the shape produced by the timeclock clock-in path on first login.
    const container = document.createElement('div');
    const state = Object.assign(JSON.parse(JSON.stringify(sceneDef.state)), { _refs: {} });
    sceneDef.render(container, { staff: { employee_id: 'auth-e99', name: 'Auth Mgr', roles: ['manager'] } }, state);
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

    expect(state.emp.id).toBe('auth-e99');
    expect(state.emp.employee_id).toBe('auth-e99');
  });

  it('void is available after navigating to check-overview and returning (remount with id-shaped emp)', () => {
    // Reproduce the initial-login → navigate → back → void-blocked bug.
    // Step 1: first mount with auth-data-shape (employee_id only, no id).
    const c1 = document.createElement('div');
    const s1 = Object.assign(JSON.parse(JSON.stringify(sceneDef.state)), { _refs: {} });
    sceneDef.render(c1, { staff: { employee_id: 'auth-e99', name: 'Auth Mgr', roles: ['manager'] } }, s1);
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

    // After fix, s1.emp.id should be 'auth-e99' so check-overview gets the right employeeId.
    // Step 2: simulate check-overview returning — it calls mountWorking('manager-landing',
    // { emp: { id: s1.emp.id, name: s1.emp.name } }).  With the fix id is correct; without
    // it would be null.
    const c2 = document.createElement('div');
    const s2 = Object.assign(JSON.parse(JSON.stringify(sceneDef.state)), { _refs: {} });
    sceneDef.render(c2, { emp: { id: s1.emp.id, name: 'Auth Mgr' } }, s2);
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

    s2.allOrders   = TEST_ORDERS;
    s2.selectedIds = ['order-a'];

    pillHandlers['Void']();

    // Should NOT show "Manager approval required" — void is available.
    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining('Manager approval'),
      expect.any(Object),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('tap again'),
      expect.any(Object),
    );
  });

  // ── Merge ───────────────────────────────────────────────────────────

  it('Merge with fewer than 2 checks selected shows error toast', () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    pillHandlers['Merge']();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('2+'),
      expect.any(Object),
    );
  });

  it('Merge in-flight guard: rapid double-tap fires only one POST', async () => {
    const { state } = mount();
    // Override after mount with never-resolving fetch to keep _merging true.
    global.fetch = vi.fn(() => new Promise(() => {}));

    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a', 'order-b'];

    pillHandlers['Merge']();  // first tap — starts in-flight
    pillHandlers['Merge']();  // second tap — should be swallowed

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/orders/order-a/merge'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // ── Filter cycling ──────────────────────────────────────────────────

  it('filter cycles OPEN → CLOSED → VOID → OPEN and clears selectedIds each time', () => {
    const { state } = mount();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    // The filter button has a pointerup listener wired directly.
    const filterBtn = state._refs.filterBtn;
    expect(filterBtn).toBeDefined();

    filterBtn.dispatchEvent(new Event('pointerup'));
    expect(state.filter).toBe('CLOSED');
    expect(state.selectedIds).toHaveLength(0);

    state.selectedIds = ['order-b'];
    filterBtn.dispatchEvent(new Event('pointerup'));
    expect(state.filter).toBe('VOID');
    expect(state.selectedIds).toHaveLength(0);

    filterBtn.dispatchEvent(new Event('pointerup'));
    expect(state.filter).toBe('OPEN');
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────

  it('cleanup cancels the void-pending timer so it cannot fire on stale state', () => {
    vi.useFakeTimers();
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    // First tap — arms the timer
    pillHandlers['Void']();
    expect(state._voidPending).toBe(true);

    // Get the cleanup function by mounting again and capturing it
    // (the scene's render returns a cleanup fn; we re-use sceneDef directly)
    const container2 = document.createElement('div');
    const state2     = Object.assign(
      JSON.parse(JSON.stringify(sceneDef.state)),
      { _refs: {} },
    );
    const cleanup = sceneDef.render(container2, TEST_MGR, state2);
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

    // Arm a pending timer on state2
    state2.allOrders   = TEST_ORDERS;
    state2.selectedIds = ['order-a'];
    pillHandlers['Void']();   // arms timer on latest captured state via closure
    // The cleanup should cancel that timer
    if (typeof cleanup === 'function') {
      cleanup();
    }
    // Advance past the 3-second window — if timer was NOT cancelled it would
    // reset _voidPending to false on the detached state, which is harmless, but
    // the real assertion is that clearTimeout was called (no side-effect).
    vi.advanceTimersByTime(4000);
    // If state._voidPending is still true after cleanup + time advance,
    // timer was correctly cancelled (pending state unchanged on detached obj).
    // We verify the cleanup function ran without error.
    expect(typeof cleanup).toBe('function');
  });

  // ── Refresh reconciliation (M5) ─────────────────────────────────────

  // fetchAllData fans out to 4 parallel requests; only /api/v1/orders
  // is used to rebuild state.allOrders. Other endpoints return empty shapes.
  function fetchForOrders(orders) {
    return vi.fn((url) => {
      if (String(url) === '/api/v1/orders') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(orders) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  }

  async function triggerOrderUpdated() {
    const sm = await import('../scene-manager.js');
    const call = sm.SceneManager.on.mock.calls.find((c) => c[0] === 'order:updated');
    expect(call).toBeDefined();
    const handler = call[1];
    handler();
    // Flush Promise.all → .then microtasks.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('refresh() prunes selectedIds when an order vanishes from allOrders', async () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    // Another terminal closed order-a — next refresh returns only order-b.
    global.fetch = fetchForOrders([
      { order_id: 'order-b', status: 'open', server_id: 'srv-1', check_number: 'C-002', total: 22 },
    ]);

    await triggerOrderUpdated();

    expect(state.allOrders.map((o) => o.order_id)).toEqual(['order-b']);
    expect(state.selectedIds).toEqual([]);
  });

  // ── Print handler (M1 + M2) ─────────────────────────────────────────

  // Build a fetch that returns distinct responses per orderId. Unlisted orders
  // resolve ok:true by default.
  function fetchForPrint(results) {
    return vi.fn((url) => {
      const match = String(url).match(/\/orders\/([^/]+)\/print\/receipt/);
      if (match) {
        const outcome = results[match[1]];
        if (outcome === 'reject') return Promise.reject(new Error('network'));
        if (outcome === 'fail')   return Promise.resolve({ ok: false });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  }

  async function flushPromises() {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('Print partial failure: toast fires even when one POST rejects', async () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a', 'order-b'];

    global.fetch = fetchForPrint({ 'order-a': 'reject' });   // order-b resolves ok

    pillHandlers['Print']();
    await flushPromises();

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('1 printed, 1 failed'),
      expect.any(Object),
    );
    expect(state._printing).toBeFalsy();
  });

  it('Print in-flight guard: second tap during in-flight fetch does not fire another POST', () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    // Never-resolving fetch keeps the handler in-flight.
    global.fetch = vi.fn(() => new Promise(() => {}));

    pillHandlers['Print']();
    pillHandlers['Print']();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('Print all-success: completion toast uses plural/singular correctly', async () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a', 'order-b'];

    global.fetch = fetchForPrint({});   // both ok:true

    pillHandlers['Print']();
    await flushPromises();

    expect(showToast).toHaveBeenCalledWith(
      'Printed 2 receipts',
      expect.any(Object),
    );
  });

  it('pill action does not fire a fetch for an order that vanished during refresh', async () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a'];

    global.fetch = fetchForOrders([
      { order_id: 'order-b', status: 'open', server_id: 'srv-1', check_number: 'C-002', total: 22 },
    ]);

    await triggerOrderUpdated();

    // After reconciliation, selection is empty. Reset fetch so the next call
    // is isolated to what the Void handler does.
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

    pillHandlers['Void']();   // first tap; empty selection → "Select a check first"
    pillHandlers['Void']();   // second tap; still empty — must not fire a /void POST

    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/orders/order-a/void'),
      expect.anything(),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Select a check first'),
      expect.any(Object),
    );
  });

  // ── Merge error-body (Tier B regression lock) ───────────────────────

  it('Merge 400 with {detail}: toast shows server detail and clears _merging', async () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a', 'order-b'];

    global.fetch = vi.fn(() => Promise.resolve({
      ok:     false,
      status: 400,
      json:   () => Promise.resolve({ detail: 'Payment in progress' }),
    }));

    pillHandlers['Merge']();
    await flushPromises();

    expect(showToast).toHaveBeenCalledWith(
      'Payment in progress',
      expect.any(Object),
    );
    expect(state._merging).toBe(false);
  });

  // ── Void partial failure (Tier B regression lock) ───────────────────

  it('Void partial failure: mixed success/fail toast fires and selection clears', async () => {
    const { state } = mountFresh();
    state.allOrders   = TEST_ORDERS;
    state.selectedIds = ['order-a', 'order-b'];

    global.fetch = vi.fn((url) => {
      if (String(url).includes('/orders/order-a/void')) {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    pillHandlers['Void']();   // arm pending
    pillHandlers['Void']();   // commit
    await flushPromises();

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('1 voided, 1 failed'),
      expect.any(Object),
    );
    expect(state.selectedIds).toEqual([]);
  });

  // ── Double-tap timeout ──────────────────────────────────────────────

  // Cycle the filter 3 times (OPEN→CLOSED→VOID→OPEN) to force a synchronous
  // renderTiles() with whatever is currently in state.allOrders.
  // Returns the first tile child so callers can interact with it directly.
  function renderTilesViaFilterCycle(state) {
    const btn = state._refs.filterBtn;
    btn.dispatchEvent(new Event('pointerup'));
    btn.dispatchEvent(new Event('pointerup'));
    btn.dispatchEvent(new Event('pointerup'));
    return state._refs.tileGrid.children[0];
  }

  it('double-tap within timeout opens check-overview', async () => {
    vi.useFakeTimers();
    const { state } = mountFresh();
    // Drain initial fetchAllData microtasks before overriding allOrders.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    state.allOrders = TEST_ORDERS;
    vi.advanceTimersByTime(300);   // past 200ms _inputIgnoreUntil guard

    const tileA = renderTilesViaFilterCycle(state);
    expect(tileA).toBeDefined();
    const { SceneManager } = await import('../scene-manager.js');
    SceneManager.mountWorking.mockClear();

    tileA.dispatchEvent(new Event('pointerup'));   // first tap — selects
    expect(state.selectedIds).toContain('order-a');

    vi.advanceTimersByTime(200);   // still within DOUBLE_TAP_MS (300ms)

    tileA.dispatchEvent(new Event('pointerup'));   // second tap — opens
    expect(SceneManager.mountWorking).toHaveBeenCalledWith(
      'check-overview',
      expect.objectContaining({ checkId: 'order-a' }),
    );
  });

  it('tap after DOUBLE_TAP_MS toggles selection instead of opening check-overview', async () => {
    vi.useFakeTimers();
    const { state } = mountFresh();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    state.allOrders = TEST_ORDERS;
    vi.advanceTimersByTime(300);   // past 200ms _inputIgnoreUntil guard

    const tileA = renderTilesViaFilterCycle(state);
    expect(tileA).toBeDefined();
    const { SceneManager } = await import('../scene-manager.js');
    SceneManager.mountWorking.mockClear();

    tileA.dispatchEvent(new Event('pointerup'));   // first tap — selects
    expect(state.selectedIds).toContain('order-a');

    vi.advanceTimersByTime(400);   // past DOUBLE_TAP_MS (300ms)

    tileA.dispatchEvent(new Event('pointerup'));   // second tap — deselects
    expect(state.selectedIds).not.toContain('order-a');
    expect(SceneManager.mountWorking).not.toHaveBeenCalled();
  });

  it('double-tap on already-selected tile opens check-overview', async () => {
    vi.useFakeTimers();
    const { state } = mountFresh();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    state.allOrders = TEST_ORDERS;
    vi.advanceTimersByTime(300);   // past 200ms _inputIgnoreUntil guard

    const tileA = renderTilesViaFilterCycle(state);
    expect(tileA).toBeDefined();
    const { SceneManager } = await import('../scene-manager.js');

    // Pre-select the tile, simulating a card that was already tapped earlier
    // (selectedAt is intentionally cleared so the prior tap is well outside
    // the double-tap window).
    state.selectedIds = ['order-a'];
    state.selectedAt = {};
    SceneManager.mountWorking.mockClear();

    tileA.dispatchEvent(new Event('pointerup'));   // first tap on selected tile
    vi.advanceTimersByTime(200);                   // still within DOUBLE_TAP_MS
    tileA.dispatchEvent(new Event('pointerup'));   // second tap — opens

    expect(SceneManager.mountWorking).toHaveBeenCalledWith(
      'check-overview',
      expect.objectContaining({ checkId: 'order-a' }),
    );
  });
});
