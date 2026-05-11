/* ============================================
   Tests for the Overseer forced password-change scene.

   Same fixture pattern as login_scene.test.js — root-level vitest+jsdom,
   `fetch` stubbed per-test. Covers the client-side validation gate,
   the API contract, and the server-side error mapping.
   ============================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderPasswordChangeScene } from './password_change_scene.js';
import { __resetForTests } from './auth_state.js';

function setup() {
  document.body.innerHTML = '<div id="root"></div>';
  return document.getElementById('root');
}

function makeFetchResponse({ status = 204, body = null, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? headers[k] ?? null },
    json: async () => {
      if (body == null) throw new SyntaxError('no body');
      return body;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function fillForm(root, { current = 'old-password-12345', next = 'new-password-12345', confirm = null } = {}) {
  const [currentEl, newEl, confirmEl] = root.querySelectorAll('input[type="password"]');
  currentEl.value = current;
  newEl.value = next;
  confirmEl.value = confirm != null ? confirm : next;
}

function submitForm(root) {
  root.querySelector('button').click();
  return flush();
}

function readError(root) {
  return root.querySelector('[data-role="password-change-error"]').textContent;
}

beforeEach(() => {
  __resetForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  __resetForTests();
});

describe('renderPasswordChangeScene — markup', () => {
  it('mounts three password inputs and an update button', () => {
    const root = setup();
    renderPasswordChangeScene(root, () => {});
    const inputs = root.querySelectorAll('input[type="password"]');
    expect(inputs.length).toBe(3);
    expect(root.querySelector('button').textContent).toBe('Update password');
  });

  it('shows the spec-fixed heading + subhead so the user knows why this screen exists', () => {
    const root = setup();
    renderPasswordChangeScene(root, () => {});
    expect(root.textContent).toContain('Set a new password');
    expect(root.textContent).toContain('You must change your password before continuing.');
  });
});

describe('renderPasswordChangeScene — client-side validation', () => {
  it('rejects empty fields without calling the API', async () => {
    global.fetch = vi.fn();
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    await submitForm(root);
    expect(readError(root)).toBe('All fields are required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 12 chars without calling the API', async () => {
    global.fetch = vi.fn();
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    fillForm(root, { current: 'old-password-12345', next: 'short', confirm: 'short' });
    await submitForm(root);
    expect(readError(root)).toBe('New password must be at least 12 characters');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirm without calling the API', async () => {
    global.fetch = vi.fn();
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    fillForm(root, {
      current: 'old-password-12345',
      next: 'brand-new-password-1',
      confirm: 'brand-new-password-2',
    });
    await submitForm(root);
    expect(readError(root)).toBe('New password and confirmation do not match');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects new === current without calling the API', async () => {
    global.fetch = vi.fn();
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    fillForm(root, { current: 'same-password-12345', next: 'same-password-12345' });
    await submitForm(root);
    expect(readError(root)).toBe('New password must be different from current');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('renderPasswordChangeScene — success path', () => {
  it('posts to /v1/auth/password-change with credentials:include and calls onChangeSuccess', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 204 }));
    const root = setup();
    const onSuccess = vi.fn();
    renderPasswordChangeScene(root, onSuccess);
    fillForm(root, { current: 'old-password-12345', next: 'new-password-12345' });
    await submitForm(root);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/v1/auth/password-change');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      current_password: 'old-password-12345',
      new_password: 'new-password-12345',
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('clears the plaintext fields after success so a back-nav cannot redisplay them', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 204 }));
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    fillForm(root, { current: 'old-password-12345', next: 'new-password-12345' });
    await submitForm(root);
    const inputs = root.querySelectorAll('input[type="password"]');
    for (const el of inputs) expect(el.value).toBe('');
  });
});

describe('renderPasswordChangeScene — server error mapping', () => {
  const driveValidSubmit = async (root) => {
    fillForm(root, { current: 'old-password-12345', next: 'new-password-12345' });
    await submitForm(root);
    return readError(root);
  };

  it('401 → "Current password is incorrect"', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 401, body: { detail: 'invalid credentials' } }));
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    expect(await driveValidSubmit(root)).toBe('Current password is incorrect');
  });

  it('400 with length message → "New password must be at least 12 characters"', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        status: 400,
        body: { detail: 'password must be at least 12 characters' },
      }),
    );
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    expect(await driveValidSubmit(root)).toBe('New password must be at least 12 characters');
  });

  it('400 with equality message → "New password must be different from current"', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        status: 400,
        body: { detail: 'new password must differ from current password' },
      }),
    );
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    expect(await driveValidSubmit(root)).toBe('New password must be different from current');
  });

  it('400 with unrecognized detail → generic fallback', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({ status: 400, body: { detail: 'something else entirely' } }),
    );
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    expect(await driveValidSubmit(root)).toBe('Could not update password. Try again.');
  });

  it('network failure → "Could not update password. Try again."', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new TypeError('NetworkError'));
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    expect(await driveValidSubmit(root)).toBe('Could not update password. Try again.');
  });

  it('unexpected 5xx → "Could not update password. Try again."', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 500 }));
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    expect(await driveValidSubmit(root)).toBe('Could not update password. Try again.');
  });
});

describe('renderPasswordChangeScene — submit ergonomics', () => {
  it('disables button + inputs while in flight', async () => {
    let resolveFetch;
    global.fetch = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    const root = setup();
    renderPasswordChangeScene(root, vi.fn());
    fillForm(root, { current: 'old-password-12345', next: 'new-password-12345' });
    root.querySelector('button').click();
    await flush();
    expect(root.querySelector('button').disabled).toBe(true);
    for (const el of root.querySelectorAll('input[type="password"]')) {
      expect(el.disabled).toBe(true);
    }
    resolveFetch(makeFetchResponse({ status: 204 }));
    await flush();
    expect(root.querySelector('button').disabled).toBe(false);
  });

  it('Enter in the confirm field submits', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ status: 204 }));
    const root = setup();
    const onSuccess = vi.fn();
    renderPasswordChangeScene(root, onSuccess);
    fillForm(root, { current: 'old-password-12345', next: 'new-password-12345' });
    const confirmEl = root.querySelectorAll('input[type="password"]')[2];
    confirmEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalled();
  });
});
