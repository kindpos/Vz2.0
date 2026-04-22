// Tests for terminal/auth-client.js — pins the token-storage + fetch-interceptor
// contract so a regression in either breaks the build rather than silently 401-ing
// every /api/* request.
//
// Module shape reminders:
//   - Importing the module calls installAuthFetchInterceptor() as a side effect.
//   - The interceptor is idempotent (guarded by module-scope `_installed`).
//   - To re-enter the "pre-install" state we use vi.resetModules() between tests
//     and dynamic-import inside each test so the fresh copy wraps whatever
//     window.fetch we staged on that iteration.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('terminal/auth-client', () => {
  let fetchMock;
  let originalFetch;

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    originalFetch = window.fetch;
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    window.fetch = fetchMock;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Token persistence ───────────────────────────────────────────

  it('setToken → getToken roundtrip persists all fields', async () => {
    const { setToken, getToken, getSession } = await import('./auth-client.js');
    setToken({ token: 'abc', employee_id: 'e1', name: 'Alice', roles: ['manager'] });
    expect(getToken()).toBe('abc');
    expect(getSession()).toEqual({
      token: 'abc',
      employee_id: 'e1',
      name: 'Alice',
      roles: ['manager'],
    });
  });

  it('setToken with missing token is a no-op', async () => {
    const { setToken, getToken } = await import('./auth-client.js');
    setToken(null);
    setToken(undefined);
    setToken({});
    setToken({ employee_id: 'e1' });
    expect(getToken()).toBeNull();
  });

  it('clearToken removes the session; survives a throwing sessionStorage', async () => {
    const { setToken, getToken, clearToken } = await import('./auth-client.js');
    setToken({ token: 'abc' });
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();

    // Simulate private-mode / quota: sessionStorage.removeItem throws.
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    expect(() => clearToken()).not.toThrow();
    spy.mockRestore();
  });

  // ── Fetch interceptor ───────────────────────────────────────────

  it('installAuthFetchInterceptor is idempotent (second call does not double-wrap)', async () => {
    const mod = await import('./auth-client.js');
    // First import already installed it. Capture the wrapper.
    const wrappedFetch = window.fetch;
    expect(wrappedFetch).not.toBe(fetchMock); // Definitely wrapped now.

    // Second explicit call must be a no-op.
    mod.installAuthFetchInterceptor();
    expect(window.fetch).toBe(wrappedFetch);
  });

  it('attaches Authorization: Bearer <token> on /api/* requests when a token is stored', async () => {
    const { setToken } = await import('./auth-client.js');
    setToken({ token: 'abc123' });

    await window.fetch('/api/v1/orders');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toBeDefined();
    expect(init.headers.get('Authorization')).toBe('Bearer abc123');
  });

  it('does NOT attach Authorization for non-/api/ URLs', async () => {
    const { setToken } = await import('./auth-client.js');
    setToken({ token: 'abc123' });

    await window.fetch('/static/app.css');
    await window.fetch('https://cdn.example.com/script.js');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0][1];
    const secondInit = fetchMock.mock.calls[1][1];
    // Either no init, or headers without Authorization.
    if (firstInit && firstInit.headers) {
      expect(new Headers(firstInit.headers).has('Authorization')).toBe(false);
    }
    if (secondInit && secondInit.headers) {
      expect(new Headers(secondInit.headers).has('Authorization')).toBe(false);
    }
  });

  it('does NOT clobber a caller-supplied Authorization header', async () => {
    const { setToken } = await import('./auth-client.js');
    setToken({ token: 'stored-token' });

    await window.fetch('/api/v1/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer caller-override' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    // When the interceptor sees an existing Authorization it leaves `init.headers`
    // untouched — so it's still the original plain object, not a Headers instance.
    // Normalize via `new Headers(...)` to assert identity regardless.
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer caller-override');
  });
});
