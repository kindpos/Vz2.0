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

// ── promptManagerPin ────────────────────────────────────────────────────────
// The function uses _originalFetch (captured at install time) rather than
// the intercepted window.fetch, so we set up fetchMock before importing the
// module (the module install captures window.fetch on import). All tests
// re-use the same beforeEach setup from the parent suite.

describe('overseer/src/services/auth-client — promptManagerPin', () => {
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

  it('user cancels the prompt (null) → returns false, fetch never fires', async () => {
    const { promptManagerPin } = await import(MODULE);
    vi.spyOn(window, 'prompt').mockReturnValue(null);

    const result = await promptManagerPin('Need auth');

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('429 from verify-pin → alert shown, returns false, setToken not called', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    vi.spyOn(window, 'prompt').mockReturnValue('1234');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const { promptManagerPin, getToken } = await import(MODULE);
    const result = await promptManagerPin();

    expect(result).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/wait/i);
    expect(getToken()).toBeNull();
  });

  it('valid:false response → returns false, setToken not called', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ valid: false }, 200));
    vi.spyOn(window, 'prompt').mockReturnValue('9999');

    const { promptManagerPin, getToken } = await import(MODULE);
    const result = await promptManagerPin();

    expect(result).toBe(false);
    expect(getToken()).toBeNull();
  });

  it('valid:true response → setToken called, returns true', async () => {
    const authPayload = { valid: true, token: 'mgr-tok', employee_id: 'm1', name: 'Admin', roles: ['manager'] };
    fetchMock.mockResolvedValueOnce(jsonResponse(authPayload, 200));
    vi.spyOn(window, 'prompt').mockReturnValue('5678');

    const { promptManagerPin, getToken } = await import(MODULE);
    const result = await promptManagerPin('Authorize action');

    expect(result).toBe(true);
    expect(getToken()).toBe('mgr-tok');
  });

  it('_pinPromptInFlight dedup: two concurrent calls share one prompt and one fetch', async () => {
    const authPayload = { valid: true, token: 'dedup-tok', employee_id: 'm2', name: 'Mgr', roles: ['manager'] };
    // The fetch resolves after a microtask; both callers should see the same result.
    let resolveFetch;
    fetchMock.mockImplementationOnce(
      () => new Promise((res) => { resolveFetch = () => res(jsonResponse(authPayload)); }),
    );
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('1111');

    const { promptManagerPin } = await import(MODULE);

    // Start two concurrent calls before the first resolves.
    const p1 = promptManagerPin('call-1');
    const p2 = promptManagerPin('call-2');

    // Resolve the fetch so both promises can settle.
    resolveFetch();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    // Only one prompt and one fetch despite two callers.
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
