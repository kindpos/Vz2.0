/* ============================================
   Tests for the Overseer login scene.

   Runs under the root-level vitest+jsdom harness (vitest.config.js).
   `fetch` is stubbed per-test so we can drive every status code
   (200/401/423/429/network) through renderLoginScene and assert the
   rendered behavior — button states, error text, callback semantics.
   ============================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderLoginScene } from './login_scene.js';
import { __resetForTests, currentUser } from './auth_state.js';

function setup() {
  document.body.innerHTML = '<div id="root"></div>';
  return document.getElementById('root');
}

function makeFetchResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? headers[k] ?? null },
    json: async () => body,
  };
}

// Helper to wait for the microtask queue + one tick. Adequate because
// login_scene awaits a single fetch() call per submit.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  __resetForTests();
});

describe('renderLoginScene — markup + a11y', () => {
  it('mounts an email input, password input, and a submit button on the gate-layer', () => {
    const root = setup();
    renderLoginScene(root, () => {});
    const email = root.querySelector('input[type="email"]');
    const password = root.querySelector('input[type="password"]');
    const button = root.querySelector('button');
    expect(email).not.toBeNull();
    expect(password).not.toBeNull();
    expect(button).not.toBeNull();
    expect(button.textContent).toBe('Log in');
  });

  it('makes the root visible and full-screen (covers underlying UI)', () => {
    const root = setup();
    root.style.display = 'none'; // simulate the index.html default
    renderLoginScene(root, () => {});
    expect(root.style.display).toBe('flex');
    expect(root.style.position).toBe('fixed');
  });

  it('blocks an empty submit with an inline error', async () => {
    const root = setup();
    const onSuccess = vi.fn();
    renderLoginScene(root, onSuccess);
    root.querySelector('button').click();
    await flush();
    const error = root.querySelector('[data-role="login-error"]');
    expect(error.textContent).toBe('Email and password required');
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('renderLoginScene — success path', () => {
  it('calls onLoginSuccess with the user on 200', async () => {
    const root = setup();
    const onSuccess = vi.fn();
    const user = {
      user_id: 'u-1',
      email: 'alex@kindpos.com',
      role: 'store_admin',
      must_change_password: false,
      session_id: 's-1',
      expires_at: '2026-05-12T00:00:00.000000Z',
    };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 200, body: user }));

    renderLoginScene(root, onSuccess);
    root.querySelector('input[type="email"]').value = 'alex@kindpos.com';
    root.querySelector('input[type="password"]').value = 'dev-password-min-12';
    root.querySelector('button').click();
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/v1/auth/login');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'alex@kindpos.com',
      password: 'dev-password-min-12',
    });
    expect(onSuccess).toHaveBeenCalledWith(user);
    expect(currentUser()).toEqual(user);
    // Password field is cleared after success.
    expect(root.querySelector('input[type="password"]').value).toBe('');
  });
});

describe('renderLoginScene — error mapping', () => {
  const driveSubmit = async (root, password = 'something-12345') => {
    root.querySelector('input[type="email"]').value = 'someone@example.com';
    root.querySelector('input[type="password"]').value = password;
    root.querySelector('button').click();
    await flush();
    return root.querySelector('[data-role="login-error"]').textContent;
  };

  it('401 → "Invalid credentials"', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 401 }));
    const root = setup();
    renderLoginScene(root, vi.fn());
    expect(await driveSubmit(root)).toBe('Invalid credentials');
  });

  it('423 → "This account is disabled"', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 423 }));
    const root = setup();
    renderLoginScene(root, vi.fn());
    expect(await driveSubmit(root)).toBe('This account is disabled');
  });

  it('429 with Retry-After surfaces the retry seconds', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        status: 429,
        headers: { 'retry-after': '42' },
      }),
    );
    const root = setup();
    renderLoginScene(root, vi.fn());
    expect(await driveSubmit(root)).toBe('Too many attempts, try again in 42 seconds');
  });

  it('429 without Retry-After falls back to a generic retry message', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 429 }));
    const root = setup();
    renderLoginScene(root, vi.fn());
    expect(await driveSubmit(root)).toBe('Too many attempts, try again later');
  });

  it('network failure → "Could not reach server"', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new TypeError('NetworkError'));
    const root = setup();
    renderLoginScene(root, vi.fn());
    expect(await driveSubmit(root)).toBe('Could not reach server');
  });

  it('unexpected 5xx falls through to "Invalid credentials" (no enumeration of server errors)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 500 }));
    const root = setup();
    renderLoginScene(root, vi.fn());
    expect(await driveSubmit(root)).toBe('Invalid credentials');
  });
});

describe('renderLoginScene — submit ergonomics', () => {
  it('disables the button and inputs while the request is in flight', async () => {
    let resolveFetch;
    global.fetch = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    const root = setup();
    renderLoginScene(root, vi.fn());
    root.querySelector('input[type="email"]').value = 'a@b.com';
    root.querySelector('input[type="password"]').value = 'longenoughpw1';
    root.querySelector('button').click();
    await flush();
    expect(root.querySelector('button').disabled).toBe(true);
    expect(root.querySelector('input[type="email"]').disabled).toBe(true);
    expect(root.querySelector('input[type="password"]').disabled).toBe(true);

    resolveFetch(makeFetchResponse({ status: 401 }));
    await flush();
    expect(root.querySelector('button').disabled).toBe(false);
  });

  it('Enter in the password field submits the form', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 200, body: { email: 'a@b.com' } }));
    const root = setup();
    const onSuccess = vi.fn();
    renderLoginScene(root, onSuccess);
    root.querySelector('input[type="email"]').value = 'a@b.com';
    const pw = root.querySelector('input[type="password"]');
    pw.value = 'longenoughpw1';
    pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalled();
  });
});
