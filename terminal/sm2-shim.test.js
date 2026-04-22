// Tests for terminal/sm2-shim.js fetchWithTimeout — pins the abort-on-timeout
// guard that keeps a stalled backend from leaving spinners spinning until the
// browser default network timeout (~120s). Added in df3877d alongside the
// scene-manager teardown fix; this test keeps it honest.
//
// NOTE: sm2-shim.js has a side-effectful patchT() at import time that mutates
// the shared T token object. That's fine for test purposes — the mutations
// are additive and idempotent — but means we don't resetModules the shim
// between tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchWithTimeout } from './sm2-shim.js';

describe('terminal/sm2-shim fetchWithTimeout', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes url/opts through to fetch and resolves with the response', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
    window.fetch = fetchMock;

    const res = await fetchWithTimeout('/api/v1/ping', { method: 'POST' }, 15000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/ping');
    expect(init.method).toBe('POST');
    // Adds its own AbortSignal when caller didn't supply one.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(res.status).toBe(200);
  });

  it('aborts the fetch when the timeout elapses (reject path)', async () => {
    let capturedSignal;
    window.fetch = vi.fn((_url, init) => {
      capturedSignal = init.signal;
      // Fake a hung backend: resolve only when the signal fires.
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const pending = fetchWithTimeout('/api/v1/slow', {}, 15000);
    vi.advanceTimersByTime(15000);

    await expect(pending).rejects.toThrow(/abort/i);
    expect(capturedSignal.aborted).toBe(true);
  });

  it('defaults to 15s when no timeout is passed (does not fire before then)', async () => {
    let capturedSignal;
    window.fetch = vi.fn((_url, init) => {
      capturedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    const pending = fetchWithTimeout('/api/v1/slow'); // no timeout arg → default
    // Swallow the eventual rejection so it doesn't show as an unhandled leak.
    const silenced = pending.catch(() => {});

    vi.advanceTimersByTime(14999);
    expect(capturedSignal.aborted).toBe(false);

    vi.advanceTimersByTime(2);
    expect(capturedSignal.aborted).toBe(true);

    await silenced;
  });

  it('caller-supplied signal is honored (fetchWithTimeout does not clobber it)', async () => {
    const callerController = new AbortController();
    let seenSignal;
    window.fetch = vi.fn((_url, init) => {
      seenSignal = init.signal;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await fetchWithTimeout('/api/v1/x', { signal: callerController.signal }, 5000);

    expect(seenSignal).toBe(callerController.signal);
  });
});
