// Tests for overseer/src/services/auth-client.js — pins the same token-storage
// contract as the terminal client, PLUS the 401/403 PIN-prompt retry flow that
// keeps Overseer config writes from dying on a stale session.
//
// The overseer module uses window.prompt + _originalFetch for its PIN prompt,
// so every test stubs window.prompt explicitly. Note: on 429 the current source
// returns early via `if (!res.ok) return false;` so the `window.alert(...)` at
// line 77 is unreachable — we pin the actual behavior (prompt returns false,
// no retry) rather than the alert the code intended to show.

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
  let promptSpy;
  let alertSpy;

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    originalFetch = window.fetch;
    fetchMock = vi.fn();
    window.fetch = fetchMock;
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
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

  // ── 401 → prompt → retry once ────────────────────────────────────

  it('on 401, prompts for PIN via _originalFetch, stores new token, and retries original request once', async () => {
    // Sequence:
    //   1) original GET /api/v1/orders → 401
    //   2) POST /api/v1/auth/verify-pin → 200 { valid: true, token: 'fresh' }
    //   3) retry GET /api/v1/orders → 200 { ok: true }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'auth' }, 401))
      .mockResolvedValueOnce(jsonResponse({ valid: true, token: 'fresh', employee_id: 'mgr1', name: 'Mel', roles: ['manager'] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    promptSpy.mockReturnValue('4321');

    const { getToken } = await import(MODULE);

    const res = await window.fetch('/api/v1/orders');

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The verify-pin call goes to the correct endpoint with a JSON body.
    const [verifyUrl, verifyInit] = fetchMock.mock.calls[1];
    expect(verifyUrl).toBe('/api/v1/auth/verify-pin');
    expect(verifyInit.method).toBe('POST');
    expect(JSON.parse(verifyInit.body)).toEqual({ pin: '4321' });

    // Token is persisted after a successful verify.
    expect(getToken()).toBe('fresh');
    // The caller sees the successful retry, not the original 401.
    expect(res.status).toBe(200);
  });

  it('on 403, the prompt message includes "Manager role required"', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'need manager' }, 403));
    promptSpy.mockReturnValue(null); // User cancels the prompt.

    await import(MODULE);
    const res = await window.fetch('/api/v1/config/tip_pools', { method: 'POST', body: '{}' });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    const promptMsg = promptSpy.mock.calls[0][0];
    expect(promptMsg).toMatch(/Manager role required/);
    // Prompt cancelled → no retry, caller sees the original 403.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
  });

  // ── 429 on PIN verify ────────────────────────────────────────────

  it('on 429 from verify-pin, prompt resolves false and no token is stored (no retry of the original)', async () => {
    // Original 401 → verify-pin returns 429. The source's `if (!res.ok) return false`
    // fires first, so alert text at line 77 is never reached. Pin actual behavior.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'auth' }, 401))
      .mockResolvedValueOnce(jsonResponse({ valid: false }, 429));
    promptSpy.mockReturnValue('4321');

    const { getToken } = await import(MODULE);
    const res = await window.fetch('/api/v1/orders');

    expect(fetchMock).toHaveBeenCalledTimes(2);   // Original + verify, no retry.
    expect(getToken()).toBeNull();                 // No setToken fired.
    expect(res.status).toBe(401);                  // Caller sees original failure.
  });

  // ── Concurrent-401 dedupe via _pinPromptInFlight ────────────────

  it('_pinPromptInFlight dedupes: two concurrent 401s fire the prompt exactly once', async () => {
    let verifyResolve;
    const verifyPromise = new Promise((resolve) => { verifyResolve = resolve; });

    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/auth/verify-pin')) {
        return verifyPromise;
      }
      // Both original requests 401 on first hit; their retries return 200.
      const call = fetchMock.mock.calls.filter(
        (c) => !String(c[0]).endsWith('/auth/verify-pin') && c[0] === url,
      ).length;
      // 1st call to each URL → 401; 2nd (retry) → 200.
      return Promise.resolve(jsonResponse({ call }, call === 1 ? 401 : 200));
    });
    promptSpy.mockReturnValue('4321');

    await import(MODULE);

    const [resA, resB] = await Promise.all([
      // Start both requests. They'll both 401, both await the single in-flight prompt.
      window.fetch('/api/v1/orders').then(async (r) => {
        // r is the first-attempt 401 if dedupe fails to retry; 200 if retry happened.
        return r;
      }),
      window.fetch('/api/v1/payouts').then(async (r) => r),
      // Resolve verify after both are awaiting.
      Promise.resolve().then(() => {
        verifyResolve(jsonResponse({ valid: true, token: 'dedupe-tok' }));
      }),
    ]);

    expect(promptSpy).toHaveBeenCalledTimes(1); // The critical assertion.
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  // ── Retry is only once ──────────────────────────────────────────

  it('retry happens at most once: if the retried request also 401s, the 401 is returned (no loop)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))                                           // 1: original
      .mockResolvedValueOnce(jsonResponse({ valid: true, token: 'x' }))                        // 2: verify-pin
      .mockResolvedValueOnce(jsonResponse({}, 401));                                          // 3: retry STILL 401
    promptSpy.mockReturnValue('4321');

    await import(MODULE);
    const res = await window.fetch('/api/v1/orders');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });
});
