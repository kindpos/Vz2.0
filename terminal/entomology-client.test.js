// Tests for terminal/entomology-client.js — pins the never-throws contract,
// the offline queue + drain behavior, and the keepalive flag that lets
// unload-time diagnostic writes survive.
//
// The module registers a `window` 'online' listener at import time, and has
// module-scoped `_queue` state. vi.resetModules() between tests gives a fresh
// instance each run so the queue from one test doesn't bleed into another.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const VALID = {
  code: 'UI-001',
  source: 'scene-manager.interrupt',
  message: 'stacked',
};

// The module registers a window 'online' listener on every import. When a test
// calls vi.resetModules(), the NEXT import registers a fresh listener — but
// the previous module's listener is still bound to `window`. Each dispatch of
// 'online' would then drain every stranded module's queue. Track every 'online'
// listener we observe and strip them in beforeEach so each test sees exactly
// one module's drain effect.
const _origAdd = window.addEventListener.bind(window);
let _onlineListeners = [];
window.addEventListener = function(type, handler, opts) {
  if (type === 'online') _onlineListeners.push(handler);
  return _origAdd(type, handler, opts);
};

describe('terminal/entomology-client', () => {
  let fetchMock;
  let originalFetch;
  let originalOnlineDescriptor;

  beforeEach(() => {
    _onlineListeners.forEach((fn) => window.removeEventListener('online', fn));
    _onlineListeners = [];
    vi.resetModules();
    originalFetch = window.fetch;
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    window.fetch = fetchMock;

    // navigator.onLine is a getter in jsdom; save so we can restore.
    originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  afterEach(() => {
    window.fetch = originalFetch;
    if (originalOnlineDescriptor) {
      Object.defineProperty(navigator, 'onLine', originalOnlineDescriptor);
    } else {
      delete navigator.onLine;
    }
    vi.restoreAllMocks();
  });

  it('entReport returns a Promise that resolves (never throws) for valid input', async () => {
    const { entReport } = await import('./entomology-client.js');

    const p = entReport(VALID);
    expect(p).toBeInstanceOf(Promise);
    await expect(p).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('entReport with missing required fields resolves false and does NOT fetch', async () => {
    const { entReport } = await import('./entomology-client.js');

    await expect(entReport(null)).resolves.toBe(false);
    await expect(entReport({})).resolves.toBe(false);
    await expect(entReport({ code: 'UI-001' })).resolves.toBe(false); // no source
    await expect(entReport({ code: 'UI-001', source: 'x' })).resolves.toBe(false); // no message

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('entReport POSTs to /api/v1/entomology/client-event with keepalive: true', async () => {
    const { entReport } = await import('./entomology-client.js');

    await entReport({ ...VALID, ctx: { a: 1 }, level: 'ERROR' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/entomology/client-event');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      event_code: 'UI-001',
      severity: 'ERROR',
      source: 'scene-manager.interrupt',
      message: 'stacked',
      context: { a: 1 },
    });
  });

  it('when offline, entReport queues and does NOT fetch (resolves false)', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const { entReport } = await import('./entomology-client.js');

    await expect(entReport(VALID)).resolves.toBe(false);
    await expect(entReport({ ...VALID, code: 'UI-002' })).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the 'online' event drains queued items", async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const { entReport } = await import('./entomology-client.js');

    await entReport(VALID);
    await entReport({ ...VALID, code: 'UI-002' });
    expect(fetchMock).not.toHaveBeenCalled();

    // Flip back online and fire the event the module registered on import.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));

    // Drain is synchronous in kicking off the fetches; give microtasks a turn.
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const codes = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).event_code);
    expect(codes).toEqual(expect.arrayContaining(['UI-001', 'UI-002']));
  });
});
