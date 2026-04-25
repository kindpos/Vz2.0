// Tests for terminal/scenes/close-day-checks-viewer.js
// Covers bugs confirmed by the 2026-04-25 remaining-gaps probe:
//   Bug A — fetchChecksState .ok guard
//   Bug B — inverted adjusted flag
//   Bug D — _busy locks on action handlers
//   Bug E — escaped setTimeout in onVoidCheck

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks (hoisted) ──────────────────────────────────────────────

const registeredScenes = [];

const SceneManagerMock = {
  interrupt:            vi.fn(),
  closeInterrupt:       vi.fn(),
  mountWorking:         vi.fn(),
  closeTransactional:   vi.fn(),
  openTransactional:    vi.fn(),
  on:                   vi.fn(),
  off:                  vi.fn(),
  emit:                 vi.fn(),
};

vi.mock('../scene-manager.js', () => ({
  SceneManager: SceneManagerMock,
  defineScene:  (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../theme-manager.js', () => ({
  buildCard:       () => ({ wrap: document.createElement('div'), card: document.createElement('div') }),
  buildStaticCard: () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildActionCard: ({ onClick } = {}) => {
    const el = document.createElement('div');
    if (onClick) el.addEventListener('pointerup', onClick);
    el.setAccent = vi.fn();
    return el;
  },
  buildPillButton: ({ label, onClick } = {}) => {
    const el = document.createElement('button');
    el.textContent = label || '';
    if (onClick) el.addEventListener('pointerup', onClick);
    return el;
  },
  hexToRgba:   (c) => c,
  darkenHex:   (c) => c,
  lightenHex:  (c) => c,
}));

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
  buildGap:  () => document.createElement('div'),
}));

vi.mock('../../common/tokens.js', () => ({
  T: new Proxy({}, { get: (_t, k) => k === '__esModule' ? false : '#000' }),
}));

// ── Helpers ──────────────────────────────────────────────────────

function makeFetchOk(json) {
  return Promise.resolve({ ok: true,  json: () => Promise.resolve(json) });
}
function makeFetchFail(status) {
  return Promise.resolve({ ok: false, status: status || 500, json: () => Promise.resolve({}) });
}

// Flush promise microtasks
async function flush(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ═══════════════════════════════════════════════════════════════════
//  Bug A — fetchChecksState .ok guard
// ═══════════════════════════════════════════════════════════════════

describe('close-day-checks-viewer — Bug A: fetchChecksState .ok guard', () => {
  let sceneDef;
  let showToast;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    SceneManagerMock.interrupt.mockClear();
    const components = await import('../components.js');
    showToast = components.showToast;
    await import('./close-day-checks-viewer.js');
    sceneDef = registeredScenes.find((s) => s.name === 'close-day-checks-viewer');
    expect(sceneDef).toBeDefined();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('falls back to empty data when all three fetches return HTTP 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) });

    const state     = JSON.parse(JSON.stringify(sceneDef.state));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);
    await flush(6);

    // .ok guard throws → .catch returns fallback → openChecks is empty array, not corrupt
    expect(state.data).not.toBeNull();
    expect(state.data.openChecks).toEqual([]);
    expect(state.data.closedChecks).toEqual([]);
  });

  it('uses data normally when fetches return ok:true', async () => {
    const summary = { checks: [{ checkId: 'c-1', status: 'open', amount: 20, tip: 2 }] };
    const orders  = [{ order_id: 'c-1', status: 'open', total_amount: 20 }];
    const store   = { info: { restaurant_name: 'Test Kitchen' } };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(summary) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(orders) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(store) });

    const state     = JSON.parse(JSON.stringify(sceneDef.state));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);
    await flush(6);

    expect(state.data.openChecks).toHaveLength(1);
    expect(state.data.openChecks[0].checkId).toBe('c-1');
    expect(state.data.restaurantName).toBe('Test Kitchen');
  });

  it('falls back gracefully when fetch rejects (network error)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const state     = JSON.parse(JSON.stringify(sceneDef.state));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);
    await flush(6);

    expect(state.data.openChecks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug B — inverted adjusted flag
// ═══════════════════════════════════════════════════════════════════

describe('close-day-checks-viewer — Bug B: tip-adjusted flag', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    await import('./close-day-checks-viewer.js');
    sceneDef = registeredScenes.find((s) => s.name === 'close-day-checks-viewer');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  async function getCheck(summaryCheck, rawOrder) {
    const summary = { checks: [summaryCheck] };
    const orders  = rawOrder ? [rawOrder] : [];
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(summary) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(orders) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const state     = JSON.parse(JSON.stringify(sceneDef.state));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);
    await flush(6);
    return (state.data.openChecks[0] || state.data.closedChecks[0]);
  }

  it('adjusted is false when tip exists but sum.adjusted is not set', async () => {
    const chk = await getCheck(
      { checkId: 'c-1', status: 'open', tip: 5 },
      { order_id: 'c-1', status: 'open' }
    );
    expect(chk).toBeDefined();
    expect(chk.adjusted).toBe(false);
  });

  it('adjusted is true when sum.adjusted is explicitly true (regardless of tip)', async () => {
    const chk = await getCheck(
      { checkId: 'c-2', status: 'open', tip: 5, adjusted: true },
      { order_id: 'c-2', status: 'open' }
    );
    expect(chk.adjusted).toBe(true);
  });

  it('adjusted is false when sum.adjusted is explicitly false', async () => {
    const chk = await getCheck(
      { checkId: 'c-3', status: 'open', tip: 5, adjusted: false },
      { order_id: 'c-3', status: 'open' }
    );
    expect(chk.adjusted).toBe(false);
  });

  it('adjusted is false when tip is null and sum.adjusted is not set', async () => {
    const chk = await getCheck(
      { checkId: 'c-4', status: 'open', tip: null },
      { order_id: 'c-4', status: 'open' }
    );
    expect(chk.adjusted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug D — _busy locks on action handlers
// ═══════════════════════════════════════════════════════════════════

describe('close-day-checks-viewer — Bug D: _busy guard', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    SceneManagerMock.interrupt.mockClear();
    SceneManagerMock.mountWorking.mockClear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ checks: [] }) });
    await import('./close-day-checks-viewer.js');
    sceneDef = registeredScenes.find((s) => s.name === 'close-day-checks-viewer');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  function renderAndGetHandlers() {
    const state     = JSON.parse(JSON.stringify(sceneDef.state));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);
    return { state, handlers: state.__testHandlers };
  }

  it('onTransferChecks ignores a second call while busy', () => {
    const { state, handlers } = renderAndGetHandlers();
    const checks = [{ checkId: 'c-1', server_id: 's-1' }];

    handlers.onTransferChecks(checks);
    expect(state._busy).toBe(true);

    SceneManagerMock.interrupt.mockClear();
    handlers.onTransferChecks(checks);

    // Second call should be ignored — no new interrupt opened
    expect(SceneManagerMock.interrupt).not.toHaveBeenCalled();
  });

  it('onPrintCheck ignores a second call while busy', () => {
    const { state, handlers } = renderAndGetHandlers();
    const checks = [{ checkId: 'c-1' }];

    handlers.onPrintCheck(checks);
    expect(state._busy).toBe(true);

    const callsBefore = SceneManagerMock.interrupt.mock.calls.length;
    handlers.onPrintCheck(checks);

    // fetch count should not have increased
    const fetchCallsAfterSecond = global.fetch.mock.calls.length;
    handlers.onPrintCheck(checks);
    expect(global.fetch.mock.calls.length).toBe(fetchCallsAfterSecond);
  });

  it('onVoidCheck ignores a second call while busy', () => {
    const { state, handlers } = renderAndGetHandlers();
    const checks = [{ checkId: 'c-1' }];

    handlers.onVoidCheck(checks);
    expect(state._busy).toBe(true);

    SceneManagerMock.interrupt.mockClear();
    handlers.onVoidCheck(checks);
    expect(SceneManagerMock.interrupt).not.toHaveBeenCalled();
  });

  it('onTransferChecks clears _busy after cancel', () => {
    const { state, handlers } = renderAndGetHandlers();
    handlers.onTransferChecks([{ checkId: 'c-1' }]);
    expect(state._busy).toBe(true);

    const transferCall = SceneManagerMock.interrupt.mock.calls.find((c) => c[0] === 'co-transfer-picker');
    expect(transferCall).toBeDefined();
    transferCall[1].onCancel();

    expect(state._busy).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Bug E — escaped setTimeout in onVoidCheck
// ═══════════════════════════════════════════════════════════════════

describe('close-day-checks-viewer — Bug E: onVoidCheck setTimeout cleanup', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    registeredScenes.length = 0;
    SceneManagerMock.interrupt.mockClear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ checks: [] }) });
    await import('./close-day-checks-viewer.js');
    sceneDef = registeredScenes.find((s) => s.name === 'close-day-checks-viewer');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('timer cleared on unmount — interrupt does not fire after scene unmounts', () => {
    const state     = JSON.parse(JSON.stringify(sceneDef.state));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);
    const handlers = state.__testHandlers;

    // Trigger the flow up to the setTimeout
    handlers.onVoidCheck([{ checkId: 'c-1' }]);
    const pinCall = SceneManagerMock.interrupt.mock.calls.find((c) => c[0] === 'co-manager-pin');
    expect(pinCall).toBeDefined();
    pinCall[1].onConfirm();   // triggers setTimeout(fn, 80)

    expect(state._pendingTimer).not.toBeNull();

    // Unmount before 80ms elapses
    sceneDef.unmount(state);
    expect(state._pendingTimer).toBeNull();

    SceneManagerMock.interrupt.mockClear();
    vi.advanceTimersByTime(200);

    // co-void-confirm must NOT have been opened
    const voidConfirmCall = SceneManagerMock.interrupt.mock.calls.find((c) => c[0] === 'co-void-confirm');
    expect(voidConfirmCall).toBeUndefined();
  });

  it('timer fires normally when scene stays mounted', () => {
    const state     = JSON.parse(JSON.stringify(sceneDef.state));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);
    const handlers = state.__testHandlers;

    handlers.onVoidCheck([{ checkId: 'c-1' }]);
    const pinCall = SceneManagerMock.interrupt.mock.calls.find((c) => c[0] === 'co-manager-pin');
    pinCall[1].onConfirm();

    SceneManagerMock.interrupt.mockClear();
    vi.advanceTimersByTime(200);

    const voidConfirmCall = SceneManagerMock.interrupt.mock.calls.find((c) => c[0] === 'co-void-confirm');
    expect(voidConfirmCall).toBeDefined();
  });
});
