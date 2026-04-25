// Integration-style tests for terminal/scenes/server-landing.js.
//
// The scene is mounted in jsdom. We drive it through its public surface:
//   1. register via defineScene
//   2. call render()
//   3. interact with captured pointerup handlers
//
// Coverage:
//   1. Scene registers as 'server-landing'.
//   2. Checkout button mounts 'server-checkout' working scene.
//   3. Filter cycles OPEN → CLOSED → VOID → OPEN.
//   4. Refresh guard: concurrent _refreshing prevents double fetch.
//   5. Event listener cleanup: state.el nulled + SceneManager.off called.
//   6. Tip row tap opens 'tip-adjustment' transactional.
//
// Note: server-landing no longer manages multi-select state (`selectedIds`) —
// that moved to manager-landing. Tests for that behavior were removed with
// the check-overview redesign.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mocks ---

const registeredScenes = [];

const SceneManagerMock = {
  mountWorking:       vi.fn(),
  openTransactional:  vi.fn(),
  closeTransactional: vi.fn(),
  interrupt:          vi.fn(),
  closeInterrupt:     vi.fn(),
  hasInterrupt:       vi.fn(() => false),
  on:                 vi.fn(),
  off:                vi.fn(),
  emit:               vi.fn(),
};

vi.mock('../scene-manager.js', () => ({
  SceneManager: SceneManagerMock,
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../../common/tokens.js', () => {
  const T = {
    bg: '#383c42', card: '#2e3236', well: '#22252a',
    green: '#86efac', greenDk: '#4ade80', gold: '#f5a623', goldDk: '#e09010',
    elec: '#22d3ee', elecDk: '#0ea5e9', verm: '#e8472a', vermDk: '#c03d22',
    moon: '#7e8896', moonDk: '#4a5059', moonText: '#22252a',
    lavender: '#b48efa',
    text: '#e8eaed', textMuted: 'rgba(232,234,237,0.55)',
    textDim: 'rgba(232,234,237,0.4)', border: 'rgba(232,234,237,0.08)',
    fb: 'sans-serif', fh: 'serif',
    fsB2: 14, fsB3: 12,
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
  function chamfer(px) {
    var c = px != null ? px : 10;
    return 'polygon(' + c + 'px 0%, calc(100% - ' + c + 'px) 0%, 100% ' + c + 'px, 100% calc(100% - ' + c + 'px), calc(100% - ' + c + 'px) 100%, ' + c + 'px 100%, 0% calc(100% - ' + c + 'px), 0% ' + c + 'px)';
  }
  return { T, chamfer };
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
    buildPillButton: ({ label } = {}) => {
      const el = document.createElement('button');
      el.textContent = label || '';
      el.setColor = vi.fn();
      return el;
    },
    buildFloatButton: ({ label } = {}) => {
      const el = document.createElement('button');
      el.textContent = label || '';
      el.setColor = vi.fn();
      return el;
    },
    buildSectionLabel: () => document.createElement('div'),
    hexToRgba:  (c) => c,
    lightenHex: (c) => c,
    darkenHex:  (c) => c,
  };
});

vi.mock('../app.js', () => ({
}));

vi.mock('../charts.js', () => ({
  buildSalesOverview: () => ({ wrap: document.createElement('div'), update: vi.fn() }),
  buildStatCard:      () => {
    const wrap = document.createElement('div');
    return { wrap, setValue: vi.fn() };
  },
  buildTipSparkBg: () => {
    const el = document.createElement('div');
    return { el, update: vi.fn() };
  },
}));

// --- Helpers ---

const TEST_EMP = { id: 'srv-01', name: 'Mel Server' };

const TEST_ORDERS = [
  { order_id: 'ord-1', status: 'open', server_id: 'srv-01', check_number: 'C-001', total: 30.00 },
  { order_id: 'ord-2', status: 'open', server_id: 'srv-01', check_number: 'C-002', total: 45.00 },
];

// --- Tests ---

describe('terminal/scenes/server-landing', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    SceneManagerMock.mountWorking.mockClear();
    SceneManagerMock.openTransactional.mockClear();
    SceneManagerMock.on.mockClear();
    SceneManagerMock.off.mockClear();

    global.fetch = vi.fn(() => Promise.resolve({
      ok:   true,
      json: () => Promise.resolve({}),
    }));

    await import('./server-landing.js');
    sceneDef = registeredScenes.find((s) => s.name === 'server-landing');
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
      { _refs: {} },
      stateOverrides,
    );
    const cleanup = sceneDef.render(container, TEST_EMP, state);
    return { container, state, cleanup };
  }

  // ── Scene registration ──────────────────────────────────────────────

  it("registers as 'server-landing'", () => {
    expect(sceneDef).toBeDefined();
    expect(sceneDef.name).toBe('server-landing');
  });

  // ── Checkout button ─────────────────────────────────────────────────

  it('checkout button mounts server-checkout working scene', () => {
    const { state } = mount();
    const btn = state._refs.checkoutBtn;
    expect(btn).toBeDefined();
    btn.dispatchEvent(new Event('pointerup'));
    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith(
      'server-checkout',
      expect.objectContaining({ staff: TEST_EMP }),
    );
  });

  // ── Filter cycling ──────────────────────────────────────────────────

  it('filter cycles OPEN → CLOSED → VOID → OPEN', () => {
    const { state } = mount();
    state.allOrders = TEST_ORDERS;

    const filterBtn = state._refs.filterBtn;

    filterBtn.dispatchEvent(new Event('pointerup'));
    expect(state.filter).toBe('CLOSED');

    filterBtn.dispatchEvent(new Event('pointerup'));
    expect(state.filter).toBe('VOID');

    filterBtn.dispatchEvent(new Event('pointerup'));
    expect(state.filter).toBe('OPEN');
  });

  // ── Refresh guard ───────────────────────────────────────────────────

  it('_refreshing guard prevents a second concurrent fetch', async () => {
    // Mount with _refreshing already true — the initial refresh() call should
    // bail out immediately without calling fetch.
    global.fetch = vi.fn(() => new Promise(() => {})); // never resolves
    const { state } = mount();
    // Initial mount calls refresh(); let that run.
    // Now flip the flag back and ensure a second event-driven refresh is blocked.
    state._refreshing = true;
    const callsBefore = global.fetch.mock.calls.length;
    // Simulate an 'order:updated' event firing by calling the handler.
    // The handler is registered via SceneManager.on — retrieve its call args.
    const onCall = SceneManagerMock.on.mock.calls.find(([ev]) => ev === 'order:updated');
    expect(onCall).toBeDefined();
    const handler = onCall[1];
    handler(); // fire — should be a no-op because _refreshing is true
    expect(global.fetch.mock.calls.length).toBe(callsBefore);
  });

  // ── Event listener cleanup ──────────────────────────────────────────

  it('cleanup nulls state.el and removes all SceneManager listeners', () => {
    const { state, cleanup } = mount();
    expect(state.el).toBeDefined();

    cleanup();

    expect(state.el).toBeNull();
    // off() should be called once per registered event (3 events)
    expect(SceneManagerMock.off).toHaveBeenCalledTimes(3);
    expect(SceneManagerMock.off).toHaveBeenCalledWith('order:updated', expect.any(Function));
    expect(SceneManagerMock.off).toHaveBeenCalledWith('order:closed',  expect.any(Function));
    expect(SceneManagerMock.off).toHaveBeenCalledWith('tip:adjusted',  expect.any(Function));
  });

  // ── Tip-adjustment transactional ────────────────────────────────────

  // ── Render exception isolation (S2) ─────────────────────────────────

  async function flushPromises() {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('check tile double-tap passes pin to check-overview mountWorking params', async () => {
    vi.useFakeTimers();

    const empWithPin = { id: 'srv-01', name: 'Mel Server', pin: '4321' };
    const container  = document.createElement('div');
    const state      = Object.assign(
      JSON.parse(JSON.stringify(sceneDef.state)),
      { _refs: {} },
    );
    sceneDef.render(container, empWithPin, state);

    // Drain initial fetchAllData microtasks, then override allOrders.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    state.allOrders = TEST_ORDERS;
    vi.advanceTimersByTime(300);   // past 200ms _inputIgnoreUntil guard

    // Force a synchronous renderTiles via filter cycle (OPEN→CLOSED→VOID→OPEN).
    state._refs.filterBtn.dispatchEvent(new Event('pointerup'));
    state._refs.filterBtn.dispatchEvent(new Event('pointerup'));
    state._refs.filterBtn.dispatchEvent(new Event('pointerup'));

    const tile = state._refs.tileGrid.firstChild;
    expect(tile).toBeDefined();
    tile.dispatchEvent(new Event('pointerup'));   // first tap — selects
    tile.dispatchEvent(new Event('pointerup'));   // second tap within timeout — opens

    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith(
      'check-overview',
      expect.objectContaining({ pin: '4321' }),
    );
  });

  it('render exception in renderTips does not prevent renderStats from running', async () => {
    const { state } = mount();
    await flushPromises();
    // Drop the initial mount-refresh effect so our second-refresh assertion
    // measures only the post-break behavior.
    state._refs.scGuests.setValue.mockClear();

    // Force renderTips to throw: give it a closed check so it passes the
    // empty-branch, then null unadjBadge so the `r.unadjBadge.textContent = …`
    // assignment throws.
    state.salesData  = { checks: [{ check_id: 'c1', status: 'closed', tip: 5, adjusted: false, total: 20 }] };
    state._refs.unadjBadge = null;

    const onCall = SceneManagerMock.on.mock.calls.find(([ev]) => ev === 'order:updated');
    expect(onCall).toBeDefined();
    const handler = onCall[1];
    handler();
    await flushPromises();

    // Without the try/catch wrappers, renderTips' throw bubbles up through
    // the Promise chain and short-circuits renderStats. The fix isolates
    // each render so renderStats still runs.
    expect(state._refs.scGuests.setValue).toHaveBeenCalled();
  });

  it('tip row pointerup opens inline tip-numpad (scrim + card appended to body)', async () => {
    const CHECK = { check_id: 'chk-1', status: 'closed', tip: 8.00, adjusted: false, total: 40.00 };
    global.fetch = vi.fn((url) => {
      if (String(url).indexOf('/api/v1/orders/day-summary') === 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ checks: [CHECK] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const { state } = mount();
    await flushPromises();

    const tipList = state._refs.tipList;
    expect(tipList).toBeDefined();
    const row = tipList.firstChild;
    expect(row).toBeDefined();

    const bodyChildrenBefore = document.body.children.length;
    row.dispatchEvent(new Event('pointerup'));

    // openTipNumpad appends a scrim + floating card to document.body
    expect(document.body.children.length).toBe(bodyChildrenBefore + 2);
  });

  // ── Fetch rejection / refresh-guard release ─────────────────────────

  it('fetch rejection clears _refreshing so a subsequent refresh is not blocked', async () => {
    // Reject every fetch; the catch path should release the flag.
    global.fetch = vi.fn(() => Promise.reject(new Error('network')));
    const { state } = mount();
    await flushPromises();

    expect(state._refreshing).toBe(false);

    // A follow-up event should not be blocked by a stuck flag.
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const onCall = SceneManagerMock.on.mock.calls.find(([ev]) => ev === 'order:updated');
    const handler = onCall[1];
    const callsBefore = global.fetch.mock.calls.length;
    handler();
    expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // ── Cleanup during in-flight refresh ────────────────────────────────

  it('cleanup during in-flight refresh: state.el null-check blocks post-teardown render', async () => {
    // Never-resolving fetch → refresh is perpetually in-flight at cleanup time.
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const { state, cleanup } = mount();

    expect(state.el).toBeDefined();
    cleanup();
    expect(state.el).toBeNull();

    // Let the in-flight fetch resolve; the .then callback should short-circuit
    // at the `if (!state.el) return;` gate and not touch refs.
    resolveFetch({ ok: true, json: () => Promise.resolve({}) });
    await flushPromises();

    // scGuests.setValue was called on the mount-time initial refresh's render
    // path? It can't be — the fetch never resolved before cleanup. Assert
    // no post-cleanup render fired.
    expect(state._refs.scGuests.setValue).not.toHaveBeenCalled();
  });

  // ── Double-tap timeout ──────────────────────────────────────────────

  // Cycle the filter 3 times (OPEN→CLOSED→VOID→OPEN) to force a synchronous
  // renderTiles() with whatever is currently in state.allOrders.
  function renderTilesViaFilterCycle(state) {
    const btn = state._refs.filterBtn;
    btn.dispatchEvent(new Event('pointerup'));
    btn.dispatchEvent(new Event('pointerup'));
    btn.dispatchEvent(new Event('pointerup'));
    return state._refs.tileGrid.children[0];
  }

  it('double-tap within timeout opens check-overview', async () => {
    vi.useFakeTimers();
    const { state } = mount();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    state.allOrders = TEST_ORDERS;
    vi.advanceTimersByTime(300);   // past 200ms _inputIgnoreUntil guard

    const tileA = renderTilesViaFilterCycle(state);
    expect(tileA).toBeDefined();
    SceneManagerMock.mountWorking.mockClear();

    tileA.dispatchEvent(new Event('pointerup'));   // first tap — selects
    expect(state.selectedIds).toContain('ord-1');

    vi.advanceTimersByTime(800);   // still within DOUBLE_TAP_MS (1500ms)

    tileA.dispatchEvent(new Event('pointerup'));   // second tap — opens
    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith(
      'check-overview',
      expect.objectContaining({ checkId: 'ord-1' }),
    );
  });

  it('double-tap after timeout deselects the tile instead of opening check-overview', async () => {
    vi.useFakeTimers();
    const { state } = mount();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    state.allOrders = TEST_ORDERS;
    vi.advanceTimersByTime(300);   // past 200ms _inputIgnoreUntil guard

    const tileA = renderTilesViaFilterCycle(state);
    expect(tileA).toBeDefined();
    SceneManagerMock.mountWorking.mockClear();

    tileA.dispatchEvent(new Event('pointerup'));   // first tap — selects
    expect(state.selectedIds).toContain('ord-1');

    vi.advanceTimersByTime(1600);   // past DOUBLE_TAP_MS (1500ms)

    tileA.dispatchEvent(new Event('pointerup'));   // second tap — deselects
    expect(state.selectedIds).not.toContain('ord-1');
    expect(SceneManagerMock.mountWorking).not.toHaveBeenCalled();
  });
});
