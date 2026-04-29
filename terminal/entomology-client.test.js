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

// The module registers window listeners on every import (online, error,
// unhandledrejection). When a test calls vi.resetModules(), the NEXT import
// registers fresh listeners — but the previous module's listeners are still
// bound to `window`. Track every listener we observe and strip them in
// beforeEach so each test sees exactly one module's handler set.
const _origAdd = window.addEventListener.bind(window);
const _TRACKED = ['online', 'error', 'unhandledrejection'];
let _trackedListeners = { online: [], error: [], unhandledrejection: [] };
window.addEventListener = function(type, handler, opts) {
  if (_TRACKED.includes(type)) _trackedListeners[type].push(handler);
  return _origAdd(type, handler, opts);
};

describe('terminal/entomology-client', () => {
  let fetchMock;
  let originalFetch;
  let originalOnlineDescriptor;

  beforeEach(() => {
    _TRACKED.forEach((type) => {
      _trackedListeners[type].forEach((fn) => window.removeEventListener(type, fn));
      _trackedListeners[type] = [];
    });
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

  it('queue cap: items beyond _QUEUE_MAX (50) are silently dropped', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const { entReport } = await import('./entomology-client.js');

    // Queue 52 items (2 over the cap of 50).
    const reports = [];
    for (let i = 0; i < 52; i++) {
      reports.push(entReport({ ...VALID, code: 'UI-001', message: `msg-${i}` }));
    }
    await Promise.all(reports);
    expect(fetchMock).not.toHaveBeenCalled();

    // Drain on coming back online.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();

    // Only 50 fetches should fire — items 51 and 52 were dropped.
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });

  it("window 'error' event fires UI-011 via entReport", async () => {
    const { entReport: _unused } = await import('./entomology-client.js');

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Script blew up',
      filename: 'terminal/app.js',
      lineno: 99,
    }));

    // The error handler calls entReport which calls fetch; give the microtask a turn.
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event_code).toBe('UI-011');
    expect(body.severity).toBe('ERROR');
    expect(body.message).toMatch(/Script blew up/);
  });

  it("window 'unhandledrejection' event fires UI-011 via entReport", async () => {
    const { entReport: _unused } = await import('./entomology-client.js');

    // jsdom doesn't expose PromiseRejectionEvent; assign reason directly.
    const reason = new Error('Promise exploded');
    const silenced = Promise.reject(reason);
    silenced.catch(() => {});  // prevent test-runner "unhandled rejection" noise
    const ev = Object.assign(new Event('unhandledrejection'), {
      reason,
      promise: silenced,
    });
    reason.stack = 'Error: Promise exploded\n    at test.js:1';
    window.dispatchEvent(ev);

    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event_code).toBe('UI-011');
    expect(body.message).toMatch(/Promise exploded/);
  });

  it('global error dedup: the same source+message is only reported once', async () => {
    const { entReport: _unused } = await import('./entomology-client.js');

    // Fire the same error three times.
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'Repeated error',
        filename: 'terminal/scene.js',
        lineno: 1,
      }));
    }
    await Promise.resolve();

    // All three dispatches share the same source+message key, so only one fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
