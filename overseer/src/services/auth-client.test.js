// Tests for overseer/src/services/auth-client.js — pins the token-storage
// contract and fetch interceptor behavior. 401/403 responses are passed through
// to the caller without a PIN prompt or retry.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODULE = './auth-client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('overseer/src/services/auth-client', () => {
  let fetchMock;
  let originalFetch;

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    originalFetch = window.fetch;
    fetchMock = vi.fn();
    window.fetch = fetchMock;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Token persistence (independent from terminal storage key) ────

  it('setToken/getToken/clearToken roundtrip under the overseer-specific storage key', async () => {
    const { setToken, getToken, clearToken } = await import(MODULE);
    setToken({ token: 'ov-abc', employee_id: 'mgr1', name: 'Mel', roles: ['manager'] });
    expect(getToken()).toBe('ov-abc');
    // Independent key: the terminal's 'kindpos.session' is untouched.
    expect(sessionStorage.getItem('kindpos.session')).toBeNull();
    expect(sessionStorage.getItem('kindpos.overseer.session')).toBeTruthy();

    clearToken();
    expect(getToken()).toBeNull();
  });

  // ── Interceptor basics ──────────────────────────────────────────

  it('attaches Authorization: Bearer <token> on /api/* when a token is stored', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 200));
    const { setToken } = await import(MODULE);
    setToken({ token: 'tok-1' });

    await window.fetch('/api/v1/config/employees');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init).toBeDefined();
    expect(init.headers.get('Authorization')).toBe('Bearer tok-1');
  });

  // ── 401 / 403 pass-through (no PIN gate) ─────────────────────────

  it('on 401, returns the response directly with no prompt and no retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'auth' }, 401));
    const promptSpy = vi.spyOn(window, 'prompt');

    const { getToken } = await import(MODULE);
    const res = await window.fetch('/api/v1/orders');

    expect(promptSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken()).toBeNull();
    expect(res.status).toBe(401);
  });

  it('on 403, returns the response directly with no prompt and no retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'need manager' }, 403));
    const promptSpy = vi.spyOn(window, 'prompt');

    await import(MODULE);
    const res = await window.fetch('/api/v1/config/tip_pools', { method: 'POST', body: '{}' });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
  });
});
